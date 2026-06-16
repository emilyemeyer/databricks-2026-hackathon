import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { sql } from '@databricks/appkit-ui/js';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import {
  computeRiskRange,
  desertRiskScore,
  desertRiskTierFromScore,
  desertRiskTierLabel,
  normalizeRiskScore,
} from './desertRisk';
import { districtRegionKey, parseRegionKeyDisplay, prepareDistrictGeoJson, type GeoJsonCollection } from './districtMatching';

const INDIA_GEOJSON_PATH = '/geo/india-districts.geojson';

type GeoRow = {
  district_name: string;
  state_ut: string;
  hypertension_pct: number | string;
  households_surveyed: number | string;
  cardiac_facilities: number | string;
  total_facilities: number | string;
  demand_norm: number | string;
  supply_norm: number | string;
  balance_ratio: number | string;
  confidence_score: number | string;
  pincode_count: number | string;
  latitude: number | string;
  longitude: number | string;
};

type DistrictMapPoint = {
  name: string;
  value: number;
  district_name: string;
  state_ut: string;
  hypertension_pct: number;
  cardiac_facilities: number;
  total_facilities: number;
  demand_norm: number;
  supply_norm: number;
  desert_risk_score: number;
  desert_risk_norm: number;
  confidence_score: number;
  ranked_needs: DistrictDemandCategory[];
};

type ConfidenceLevel = 'high' | 'medium' | 'low';

const ALL_CONFIDENCE_LEVELS: ConfidenceLevel[] = ['high', 'medium', 'low'];

const TOP_N_DISTRICTS = 25;

const CATEGORY_LABELS: Record<string, string> = {
  primary_care: 'Primary Care',
  cardiology: 'Cardiology',
  oncology: 'Oncology',
  endocrinology: 'Endocrinology',
  nutrition: 'Nutrition',
  neurology: 'Neurology',
  nephrology: 'Nephrology',
  pulmonology: 'Pulmonology',
  obgyn: "Women's Health (OB/GYN)",
  pediatrics: 'Pediatrics',
};

type DemandRankRow = {
  district_name: string;
  state_ut: string;
  category: string;
  demand_score: number | string;
  category_rank_in_district: number | string;
};

type DistrictDemandInfo = {
  district_name: string;
  state_ut: string;
  categories: DistrictDemandCategory[];
};

type DistrictTooltipInfo = {
  district_name: string;
  state_ut: string;
  ranked_needs: DistrictDemandCategory[];
  desert_risk_score?: number;
  desert_risk_norm?: number;
  hypertension_pct?: number;
  cardiac_facilities?: number;
  total_facilities?: number;
  demand_norm?: number;
  supply_norm?: number;
  confidence_score?: number;
};

type DistrictDemandCategory = {
  category: string;
  demand_score: number;
  category_rank_in_district: number;
};

function districtKey(districtName: string, stateUt: string): string {
  return districtRegionKey(districtName, stateUt);
}

function formatCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatRankedDemandNeeds(categories: DistrictDemandCategory[]): string {
  if (categories.length === 0) {
    return '<span style="color:#9ca3af">No ranked demand data for this district</span>';
  }

  const rows = categories
    .map((item) => {
      const label = formatCategoryLabel(item.category);
      return [
        '<tr>',
        `<td style="padding:2px 8px 2px 0;color:#6b7280;width:20px">${item.category_rank_in_district}</td>`,
        `<td style="padding:2px 8px 2px 0">${label}</td>`,
        `<td style="padding:2px 0;text-align:right;font-weight:600">${item.demand_score.toFixed(1)}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');

  return [
    '<div style="margin-top:6px">',
    '<div style="font-weight:600;margin-bottom:4px">Ranked health needs</div>',
    '<table style="width:100%;border-collapse:collapse;font-size:12px">',
    '<thead>',
    '<tr style="color:#6b7280;font-size:11px">',
    '<th style="text-align:left;padding:0 8px 4px 0">#</th>',
    '<th style="text-align:left;padding:0 8px 4px 0">Category</th>',
    '<th style="text-align:right;padding:0 0 4px 0">Demand</th>',
    '</tr>',
    '</thead>',
    `<tbody>${rows}</tbody>`,
    '</table>',
    '</div>',
  ].join('');
}

function formatDistrictTooltip(info: DistrictTooltipInfo, riskRange: { min: number; max: number }): string {
  const rankedNeeds = formatRankedDemandNeeds(info.ranked_needs);
  const hasCardiacMetrics =
    info.desert_risk_score !== undefined &&
    info.hypertension_pct !== undefined &&
    info.confidence_score !== undefined;

  const sections = [
    `<div style="font-size:14px;font-weight:700;margin-bottom:2px">${info.district_name}</div>`,
    `<div style="color:#6b7280;margin-bottom:6px">${info.state_ut}</div>`,
    rankedNeeds,
  ];

  if (hasCardiacMetrics) {
    const tier = desertRiskTierFromScore(info.desert_risk_score!, riskRange.min, riskRange.max);
    sections.push(
      '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;color:#374151;font-size:11px;line-height:1.6">',
      `Desert risk: ${info.desert_risk_score!.toFixed(3)} (${desertRiskTierLabel(tier)}) · intensity ${info.desert_risk_norm!.toFixed(2)}`,
      `<br/>Hypertension: ${info.hypertension_pct!.toFixed(1)}% · Cardiac facilities: ${info.cardiac_facilities} / ${info.total_facilities}`,
      `<br/>Demand ${info.demand_norm!.toFixed(2)} · Supply ${info.supply_norm!.toFixed(2)} · Confidence: ${confidenceLabel(info.confidence_score!)} (${info.confidence_score!.toFixed(2)})`,
      '</div>',
    );
  }

  return sections.join('');
}

function buildDemandByDistrict(rows: DemandRankRow[]): Map<string, DistrictDemandInfo> {
  const byDistrict = new Map<string, DistrictDemandInfo>();
  for (const row of rows) {
    const key = districtKey(row.district_name, row.state_ut);
    const entry: DistrictDemandCategory = {
      category: row.category,
      demand_score: Number(row.demand_score),
      category_rank_in_district: Number(row.category_rank_in_district),
    };
    const existing = byDistrict.get(key);
    if (existing) {
      existing.categories.push(entry);
    } else {
      byDistrict.set(key, {
        district_name: row.district_name,
        state_ut: row.state_ut,
        categories: [entry],
      });
    }
  }
  for (const info of byDistrict.values()) {
    info.categories.sort((a, b) => a.category_rank_in_district - b.category_rank_in_district);
  }
  return byDistrict;
}

function buildTooltipByRegion(
  demandByDistrict: Map<string, DistrictDemandInfo>,
  cardiacRows: GeoRow[],
  riskRange: { min: number; max: number },
): Map<string, DistrictTooltipInfo> {
  const tooltips = new Map<string, DistrictTooltipInfo>();

  for (const [key, demand] of demandByDistrict) {
    tooltips.set(key, {
      district_name: demand.district_name,
      state_ut: demand.state_ut,
      ranked_needs: demand.categories,
    });
  }

  for (const row of cardiacRows) {
    const key = districtKey(row.district_name, row.state_ut);
    const demandNorm = Number(row.demand_norm);
    const supplyNorm = Number(row.supply_norm);
    const risk = desertRiskScore(demandNorm, supplyNorm);
    const existing = tooltips.get(key);
    const cardiacMetrics = {
      desert_risk_score: risk,
      desert_risk_norm: normalizeRiskScore(risk, riskRange.min, riskRange.max),
      hypertension_pct: Number(row.hypertension_pct),
      cardiac_facilities: Number(row.cardiac_facilities),
      total_facilities: Number(row.total_facilities),
      demand_norm: demandNorm,
      supply_norm: supplyNorm,
      confidence_score: Number(row.confidence_score),
    };

    if (existing) {
      tooltips.set(key, { ...existing, ...cardiacMetrics });
    } else {
      tooltips.set(key, {
        district_name: row.district_name,
        state_ut: row.state_ut,
        ranked_needs: [],
        ...cardiacMetrics,
      });
    }
  }

  return tooltips;
}

function confidenceLabel(score: number): string {
  if (score >= 0.75) return 'High';
  if (score >= 0.5) return 'Medium';
  return 'Low';
}

function confidenceBucket(score: number): ConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}


type SupplyDemandHeatMapProps = {
  facilitiesJson?: string;
  enabled?: boolean;
};

export function SupplyDemandHeatMap({
  facilitiesJson = '[]',
  enabled = true,
}: SupplyDemandHeatMapProps) {
  const queryParams = useMemo(
    () => ({ facilities_json: sql.string(facilitiesJson) }),
    [facilitiesJson],
  );
  const { data, loading, error } = useAnalyticsQuery('hypertension_gap_geo', queryParams, {
    autoStart: enabled,
  });
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedLevels, setSelectedLevels] = useState<ConfidenceLevel[]>(ALL_CONFIDENCE_LEVELS);
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [districtPickerOpen, setDistrictPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadMap() {
      try {
        const res = await fetch(INDIA_GEOJSON_PATH);
        if (!res.ok) throw new Error(`Failed to load map (${res.status})`);
        const geoJson = (await res.json()) as GeoJsonCollection;
        if (cancelled) return;
        echarts.registerMap(
          'india_districts',
          prepareDistrictGeoJson(geoJson) as Parameters<typeof echarts.registerMap>[1],
        );
        setMapReady(true);
      } catch (e) {
        if (!cancelled) {
          setMapError(e instanceof Error ? e.message : 'Failed to load map');
        }
      }
    }
    void loadMap();
    return () => {
      cancelled = true;
    };
  }, []);

  const allRows = (data ?? []) as GeoRow[];
  const demandByDistrict = useMemo(
    () => buildDemandByDistrict((demandRankedData ?? []) as DemandRankRow[]),
    [demandRankedData],
  );

  const riskRange = useMemo(() => computeRiskRange(allRows), [allRows]);

  const filteredRows = useMemo(
    () =>
      allRows.filter((row) => {
        if (!selectedLevels.includes(confidenceBucket(Number(row.confidence_score)))) {
          return false;
        }
        if (selectedDistricts.length > 0) {
          return selectedDistricts.includes(districtKey(row.district_name, row.state_ut));
        }
        return true;
      }),
    [allRows, selectedLevels, selectedDistricts],
  );

  const tooltipByRegion = useMemo(
    () => buildTooltipByRegion(demandByDistrict, filteredRows, riskRange),
    [demandByDistrict, filteredRows, riskRange],
  );

  // Top districts ranked by cardiac desert risk (demand × lack of supply),
  // matching the "Top 25 Cardiac Desert Districts" table.
  const topDistricts = useMemo(
    () =>
      allRows
        .map((row) => ({
          key: districtKey(row.district_name, row.state_ut),
          district_name: row.district_name,
          state_ut: row.state_ut,
          risk: desertRiskScore(Number(row.demand_norm), Number(row.supply_norm)),
        }))
        .sort((a, b) => b.risk - a.risk)
        .slice(0, TOP_N_DISTRICTS),
    [allRows],
  );

  const option = useMemo(() => {
    if (!mapReady || filteredRows.length === 0) return null;

    const mapData: DistrictMapPoint[] = filteredRows.map((row) => {
      const demandNorm = Number(row.demand_norm);
      const supplyNorm = Number(row.supply_norm);
      const risk = desertRiskScore(demandNorm, supplyNorm);
      const desertRiskNorm = normalizeRiskScore(risk, riskRange.min, riskRange.max);
      const key = districtKey(row.district_name, row.state_ut);
      const demandInfo = demandByDistrict.get(key);
      return {
        name: key,
        value: desertRiskNorm,
        district_name: row.district_name,
        state_ut: row.state_ut,
        hypertension_pct: Number(row.hypertension_pct),
        cardiac_facilities: Number(row.cardiac_facilities),
        total_facilities: Number(row.total_facilities),
        demand_norm: demandNorm,
        supply_norm: supplyNorm,
        desert_risk_score: risk,
        desert_risk_norm: desertRiskNorm,
        confidence_score: Number(row.confidence_score),
        ranked_needs: demandInfo?.categories ?? [],
      };
    });

    return {
      tooltip: {
        trigger: 'item',
        confine: true,
        padding: 12,
        extraCssText: 'max-width: 320px; white-space: normal; line-height: 1.4;',
        formatter: (params: { name?: string }) => {
          const regionKey = params.name;
          if (!regionKey) return '';

          const info = tooltipByRegion.get(regionKey);
          if (info) {
            return formatDistrictTooltip(info, riskRange);
          }

          const { district, state } = parseRegionKeyDisplay(regionKey);
          if (!district) {
            return `<strong>${state}</strong><br/><span style="color:#9ca3af">No district-level data</span>`;
          }
          return `<strong>${district}</strong>, ${state}<br/><span style="color:#9ca3af">No demand data available for this district</span>`;
        },
      },
      visualMap: {
        show: true,
        type: 'continuous',
        min: 0,
        max: 1,
        precision: 2,
        calculable: true,
        orient: 'vertical',
        right: 16,
        top: 'center',
        text: ['High Risk', 'Low Risk'],
        inRange: {
          color: ['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027'],
        },
      },
      series: [
        {
          name: 'Desert risk by district',
          type: 'map',
          map: 'india_districts',
          roam: true,
          scaleLimit: { min: 1, max: 8 },
          layoutCenter: ['50%', '50%'],
          layoutSize: '85%',
          label: { show: false },
          itemStyle: {
            areaColor: '#f5f3ef',
            borderColor: '#c4bdb4',
            borderWidth: 0.6,
          },
          emphasis: {
            label: { show: false },
            itemStyle: {
              borderColor: '#1f2937',
              borderWidth: 1.2,
            },
          },
          select: { disabled: true },
          data: mapData,
        },
      ],
    };
  }, [demandByDistrict, filteredRows, mapReady, riskRange, tooltipByRegion]);

  if (loading || demandRankedLoading || !mapReady) {
    return (
      <div className="flex h-[620px] items-center justify-center text-sm text-muted-foreground">
        {mapError ? `Map error: ${mapError}` : 'Loading heat map…'}
      </div>
    );
  }

  if (error || demandRankedError) {
    return (
      <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
        {error ?? demandRankedError}
      </div>
    );
  }

  const toggleDistrict = (key: string) => {
    setSelectedDistricts((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const districtButtonLabel =
    selectedDistricts.length === 0
      ? 'All districts'
      : `${selectedDistricts.length} district${selectedDistricts.length === 1 ? '' : 's'} selected`;

  return (
    <div className="w-full space-y-4">
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <Label className="text-sm font-medium shrink-0 sm:w-36">Data confidence</Label>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={selectedLevels}
            onValueChange={(value) => setSelectedLevels(value as ConfidenceLevel[])}
            className="flex-1 justify-start"
          >
            <ToggleGroupItem value="high" aria-label="High confidence">
              High
            </ToggleGroupItem>
            <ToggleGroupItem value="medium" aria-label="Medium confidence">
              Medium
            </ToggleGroupItem>
            <ToggleGroupItem value="low" aria-label="Low confidence">
              Low
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <Label className="text-sm font-medium shrink-0 sm:w-36">Top 25 Districts</Label>
          <Popover open={districtPickerOpen} onOpenChange={setDistrictPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                role="combobox"
                aria-expanded={districtPickerOpen}
                className="justify-between sm:w-80"
              >
                {districtButtonLabel}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search top 25 districts…" />
                <CommandList>
                  <CommandEmpty>No district found.</CommandEmpty>
                  <CommandGroup>
                    {topDistricts.map((d, index) => {
                      const isSelected = selectedDistricts.includes(d.key);
                      return (
                        <CommandItem
                          key={d.key}
                          value={`${d.district_name} ${d.state_ut}`}
                          onSelect={() => toggleDistrict(d.key)}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                          />
                          <span className="flex-1">
                            {index + 1}. {d.district_name}, {d.state_ut}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selectedDistricts.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDistricts([])}>
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Showing {filteredRows.length} of {allRows.length} districts. Each district is shaded by
          relative cardiac desert risk (hypertension demand × lack of cardiac supply). Hover any
          district to see all 10 ranked health needs from NFHS demand categories.
        </p>
      </div>

      {filteredRows.length === 0 ? (
        <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
          No districts match the selected confidence levels — select a level above to see data.
        </div>
      ) : (
        option && <ReactECharts option={option} style={{ height: 620, width: '100%' }} notMerge />
      )}

      <p className="text-xs text-muted-foreground text-center">
        District color: red = high cardiac desert risk (high hypertension + low cardiac supply),
        yellow = moderate, green = low risk. Gray districts have no data for the current filters.
      </p>
    </div>
  );
}
