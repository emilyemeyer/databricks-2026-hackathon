import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
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

type HeatPoint = {
  value: [number, number, number];
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
};

type ConfidenceLevel = 'high' | 'medium' | 'low';

const ALL_CONFIDENCE_LEVELS: ConfidenceLevel[] = ['high', 'medium', 'low'];

const TOP_N_DISTRICTS = 25;

function districtKey(districtName: string, stateUt: string): string {
  return `${districtName}__${stateUt}`;
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


export function SupplyDemandHeatMap() {
  const { data, loading, error } = useAnalyticsQuery('hypertension_gap_geo');
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
        const geoJson = await res.json();
        if (cancelled) return;
        echarts.registerMap('india_districts', geoJson);
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

  const option = useMemo(() => {
    if (!mapReady || filteredRows.length === 0) return null;

    const heatData: HeatPoint[] = filteredRows.map((row) => {
      const demandNorm = Number(row.demand_norm);
      const supplyNorm = Number(row.supply_norm);
      const risk = desertRiskScore(demandNorm, supplyNorm);
      return {
        value: [Number(row.longitude), Number(row.latitude), risk],
        district_name: row.district_name,
        state_ut: row.state_ut,
        hypertension_pct: Number(row.hypertension_pct),
        cardiac_facilities: Number(row.cardiac_facilities),
        total_facilities: Number(row.total_facilities),
        demand_norm: demandNorm,
        supply_norm: supplyNorm,
        desert_risk_score: risk,
        desert_risk_norm: 0,
        confidence_score: Number(row.confidence_score),
      };
    });

    for (const point of heatData) {
      const normalized = normalizeRiskScore(point.desert_risk_score, riskRange.min, riskRange.max);
      point.desert_risk_norm = normalized;
      point.value[2] = normalized;
    }

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: { data?: HeatPoint }) => {
          const row = params.data;
          if (!row?.district_name) return '';
          const tier = desertRiskTierFromScore(row.desert_risk_score, riskRange.min, riskRange.max);
          return [
            `<strong>${row.district_name}</strong>, ${row.state_ut}`,
            `Desert Risk: ${row.desert_risk_score.toFixed(3)} (${desertRiskTierLabel(tier)})`,
            `Relative intensity: ${row.desert_risk_norm.toFixed(2)} (0 = lowest, 1 = highest nationally)`,
            `Hypertension: ${row.hypertension_pct.toFixed(1)}%`,
            `Cardiac-Capable Facilities: ${row.cardiac_facilities} (${row.total_facilities} Total Matched Facilities)`,
            `Demand ${row.demand_norm.toFixed(2)} · Supply ${row.supply_norm.toFixed(2)} (normalized)`,
            `Data Confidence: ${confidenceLabel(row.confidence_score)} (${row.confidence_score.toFixed(2)})`,
          ].join('<br/>');
        },
      },
      geo: {
        map: 'india_districts',
        roam: true,
        zoom: 1,
        center: [82, 23],
        layoutCenter: ['50%', '50%'],
        layoutSize: '85%',
        itemStyle: {
          areaColor: '#f5f3ef',
          borderColor: '#c4bdb4',
          borderWidth: 0.6,
        },
        emphasis: {
          itemStyle: { areaColor: '#eeede9' },
        },
      },
      visualMap: {
        show: true,
        type: 'continuous',
        min: 0,
        max: 1,
        precision: 2,
        dimension: 2,
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
          name: 'Desert risk heat',
          type: 'heatmap',
          coordinateSystem: 'geo',
          data: heatData,
          pointSize: 7,
          blurSize: 9,
        },
      ],
    };
  }, [filteredRows, mapReady, riskRange]);

  if (loading || !mapReady) {
    return (
      <div className="flex h-[620px] items-center justify-center text-sm text-muted-foreground">
        {mapError ? `Map error: ${mapError}` : 'Loading heat map…'}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
        {error}
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
          Showing {filteredRows.length} of {allRows.length} districts. Heat intensity reflects the
          relative cardiac desert risk (hypertension demand × lack of cardiac supply). Dark red
          zones concentrate where hypertension burden is high and cardiac care availability is low.
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
        Heat color: red = high cardiac desert risk (high hypertension + low cardiac supply),
        yellow = moderate, green = low risk.
      </p>
    </div>
  );
}
