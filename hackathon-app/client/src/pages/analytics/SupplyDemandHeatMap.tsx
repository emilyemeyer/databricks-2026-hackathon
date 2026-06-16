import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router';
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
  categorySupplyBeds,
  computeRiskRange,
  desertRiskScore,
  desertRiskTierFromScore,
  desertRiskTierLabel,
  normalizeRiskScore,
} from './desertRisk';
import { districtRegionKey, parseRegionKeyDisplay, prepareDistrictGeoJson, type GeoJsonCollection } from './districtMatching';
import { DEFAULT_ANALYTICS_SPECIALTY, isAllSpecialtyCategories, specialtyCategoryLabel } from './analyticsConstants';
import type { DistrictSelection } from '../../lib/scenario-navigation';

const INDIA_GEOJSON_PATH = '/geo/india-districts.geojson';

type GeoRow = {
  district_name: string;
  state_ut: string;
  demand_pct: number | string;
  households_surveyed: number | string;
  category_facilities: number | string;
  category_bed_capacity?: number | string;
  expected_beds?: number | string;
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
  demand_pct: number;
  category_facilities: number;
  category_bed_capacity?: number;
  expected_beds?: number;
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
const TOP_RANKED_NEEDS = 10;

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
  demand_pct?: number;
  households_surveyed?: number;
  category_facilities?: number;
  category_bed_capacity?: number;
  expected_beds?: number;
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
  return category;
}

function formatRankedDemandNeeds(categories: DistrictDemandCategory[]): string {
  if (categories.length === 0) {
    return '<span style="color:#9ca3af">No ranked demand data for this district</span>';
  }

  const rows = categories
    .slice(0, TOP_RANKED_NEEDS)
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
  const hasCategoryMetrics =
    info.desert_risk_score !== undefined &&
    info.demand_pct !== undefined &&
    info.confidence_score !== undefined;

  const sections = [
    `<div style="font-size:14px;font-weight:700;margin-bottom:2px">${info.district_name}</div>`,
    `<div style="color:#6b7280;margin-bottom:6px">${info.state_ut}</div>`,
    rankedNeeds,
  ];

  if (hasCategoryMetrics) {
    const tier = desertRiskTierFromScore(info.desert_risk_score!, riskRange.min, riskRange.max);
    sections.push(
      '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;color:#374151;font-size:11px;line-height:1.6">',
      `Desert risk: ${info.desert_risk_score!.toFixed(3)} (${desertRiskTierLabel(tier)}) · intensity ${info.desert_risk_norm!.toFixed(2)}`,
      `<br/>Demand: ${info.demand_pct!.toFixed(1)}% · ${Number(info.households_surveyed ?? 0).toLocaleString()} NFHS households`,
      `<br/>Beds: ${(info.category_bed_capacity ?? info.category_facilities ?? 0).toLocaleString()} / ${Math.round(Number(info.expected_beds ?? 0)).toLocaleString()} expected · ${info.total_facilities} facilities`,
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
      demand_pct: Number(row.demand_pct),
      households_surveyed: Number(row.households_surveyed),
      category_facilities: Number(row.category_facilities),
      category_bed_capacity: categorySupplyBeds(row),
      expected_beds: Number(row.expected_beds ?? 0),
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

function formatCompareDistrictTooltip(
  baseline: GeoRow | undefined,
  scenario: GeoRow,
  riskRange: { min: number; max: number },
  rankedNeeds: DistrictDemandCategory[],
): string {
  const scenarioDemand = Number(scenario.demand_norm);
  const scenarioSupply = Number(scenario.supply_norm);
  const scenarioRisk = desertRiskScore(scenarioDemand, scenarioSupply);
  const scenarioNorm = normalizeRiskScore(scenarioRisk, riskRange.min, riskRange.max);

  const baselineDemand = baseline ? Number(baseline.demand_norm) : scenarioDemand;
  const baselineSupply = baseline ? Number(baseline.supply_norm) : scenarioSupply;
  const baselineRisk = desertRiskScore(baselineDemand, baselineSupply);
  const baselineNorm = normalizeRiskScore(baselineRisk, riskRange.min, riskRange.max);
  const normalizedRiskDelta = scenarioNorm - baselineNorm;
  const scenarioBeds = categorySupplyBeds(scenario);
  const baselineBeds = baseline ? categorySupplyBeds(baseline) : scenarioBeds;
  const bedDelta = baseline ? scenarioBeds - baselineBeds : 0;
  const scenarioExpected = Math.round(Number(scenario.expected_beds ?? 0));
  const baselineExpected = Math.round(Number(baseline?.expected_beds ?? scenario.expected_beds ?? 0));

  const sections = [
    `<div style="font-size:14px;font-weight:700;margin-bottom:2px">${scenario.district_name}</div>`,
    `<div style="color:#6b7280;margin-bottom:6px">${scenario.state_ut}</div>`,
    formatRankedDemandNeeds(rankedNeeds),
    '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:11px;line-height:1.6">',
    `<div><strong>Baseline</strong> · risk ${baselineNorm.toFixed(2)} · beds ${baselineBeds.toLocaleString()} / ${baselineExpected.toLocaleString()} expected</div>`,
    `<div><strong>Scenario</strong> · risk ${scenarioNorm.toFixed(2)} · beds ${scenarioBeds.toLocaleString()} / ${scenarioExpected.toLocaleString()} expected</div>`,
    `<div style="margin-top:4px;font-weight:600;color:${normalizedRiskDelta < 0 ? '#059669' : normalizedRiskDelta > 0 ? '#dc2626' : '#6b7280'}">Δ risk ${normalizedRiskDelta > 0 ? '+' : ''}${normalizedRiskDelta.toFixed(2)} · Δ beds ${bedDelta > 0 ? '+' : ''}${bedDelta.toLocaleString()}</div>`,
    '</div>',
  ];
  return sections.join('');
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

/** Symmetric visualMap span so the largest |Δ| in the scenario saturates the palette. */
function computeDeltaColorExtent(deltas: number[]): { min: number; max: number } {
  const magnitudes = deltas.map(Math.abs).filter((d) => d > 1e-9);
  if (magnitudes.length === 0) {
    return { min: -0.01, max: 0.01 };
  }
  const peak = Math.max(...magnitudes);
  // Scale to ~85% of peak so the biggest change hits full green/red, not pale tints.
  const span = Math.max(peak * 0.85, 0.001);
  return { min: -span, max: span };
}

const DELTA_MAP_COLORS = ['#006837', '#41ab5d', '#d9d9d9', '#f03b20', '#990000'];
const RISK_MAP_COLORS = ['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027'];
const NO_DATA_MAP_COLOR = '#e8e4dc';


type MapViewMode = 'delta' | 'baseline' | 'scenario';

type SupplyDemandHeatMapProps = {
  facilitiesJson?: string;
  specialtyCategory?: string;
  runKey?: number;
  enabled?: boolean;
  /** When true, fetch baseline and show baseline / scenario / change views. */
  compareMode?: boolean;
  /** Analytics only: click a district to open scenario builder. */
  onDistrictClick?: (district: DistrictSelection) => void;
};

export function SupplyDemandHeatMap({
  facilitiesJson = '[]',
  specialtyCategory = DEFAULT_ANALYTICS_SPECIALTY,
  runKey = 0,
  enabled = true,
  compareMode = false,
  onDistrictClick,
}: SupplyDemandHeatMapProps) {
  const categoryLabel = specialtyCategoryLabel(specialtyCategory);
  const isAllCategories = isAllSpecialtyCategories(specialtyCategory);

  const baselineParams = useMemo(
    () => ({
      facilities_json: sql.string('[]'),
      specialty_category: sql.string(specialtyCategory),
      _run: sql.string(String(runKey)),
    }),
    [specialtyCategory, runKey],
  );
  const queryParams = useMemo(
    () => ({
      facilities_json: sql.string(facilitiesJson),
      specialty_category: sql.string(specialtyCategory),
      _run: sql.string(String(runKey)),
    }),
    [facilitiesJson, specialtyCategory, runKey],
  );
  const { data, loading, error } = useAnalyticsQuery('hypertension_gap_geo', queryParams, {
    autoStart: enabled,
  });
  const {
    data: baselineData,
    loading: baselineLoading,
    error: baselineError,
  } = useAnalyticsQuery('hypertension_gap_geo', baselineParams, {
    autoStart: enabled && compareMode,
  });
  const {
    data: demandRankedData,
    loading: demandRankedLoading,
    error: demandRankedError,
  } = useAnalyticsQuery('district_demand_ranked', undefined, {
    autoStart: enabled,
  });
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapView, setMapView] = useState<MapViewMode>(compareMode ? 'delta' : 'scenario');
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

  useEffect(() => {
    if (compareMode) {
      setMapView('delta');
    }
  }, [compareMode, facilitiesJson, runKey]);

  const scenarioRows = (data ?? []) as GeoRow[];
  const baselineRows = (baselineData ?? []) as GeoRow[];

  const mapSourceRows = useMemo(() => {
    if (!compareMode) return scenarioRows;
    if (mapView === 'baseline') return baselineRows;
    return scenarioRows;
  }, [baselineRows, compareMode, mapView, scenarioRows]);

  const allRows = mapSourceRows;
  const demandByDistrict = useMemo(
    () => buildDemandByDistrict((demandRankedData ?? []) as DemandRankRow[]),
    [demandRankedData],
  );

  const riskRange = useMemo(() => {
    if (compareMode && mapView === 'scenario') {
      return computeRiskRange(scenarioRows);
    }
    if (compareMode) {
      return computeRiskRange(baselineRows);
    }
    return computeRiskRange(allRows);
  }, [allRows, baselineRows, compareMode, mapView, scenarioRows]);

  const baselineByKey = useMemo(() => {
    const map = new Map<string, GeoRow>();
    for (const row of baselineRows) {
      map.set(districtKey(row.district_name, row.state_ut), row);
    }
    return map;
  }, [baselineRows]);

  const scenarioByKey = useMemo(() => {
    const map = new Map<string, GeoRow>();
    for (const row of scenarioRows) {
      map.set(districtKey(row.district_name, row.state_ut), row);
    }
    return map;
  }, [scenarioRows]);

  const districtByRegionKey = useMemo(() => {
    const map = new Map<string, DistrictSelection>();
    for (const row of allRows) {
      map.set(districtKey(row.district_name, row.state_ut), {
        district_name: row.district_name,
        state_ut: row.state_ut,
      });
    }
    return map;
  }, [allRows]);

  const handleMapClick = useCallback(
    (params: { name?: string }) => {
      if (!onDistrictClick || !params.name) return;
      const district = districtByRegionKey.get(params.name);
      if (district) onDistrictClick(district);
    },
    [districtByRegionKey, onDistrictClick],
  );

  const chartEvents = useMemo(
    () => (onDistrictClick ? { click: handleMapClick } : undefined),
    [handleMapClick, onDistrictClick],
  );

  const filteredRows = useMemo(
    () =>
      mapSourceRows.filter((row) => {
        if (!selectedLevels.includes(confidenceBucket(Number(row.confidence_score)))) {
          return false;
        }
        if (selectedDistricts.length > 0) {
          return selectedDistricts.includes(districtKey(row.district_name, row.state_ut));
        }
        return true;
      }),
    [mapSourceRows, selectedDistricts, selectedLevels],
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

    const isDeltaView = compareMode && mapView === 'delta';

    const mapData: DistrictMapPoint[] = filteredRows.map((row) => {
      const key = districtKey(row.district_name, row.state_ut);
      const baseline = baselineByKey.get(key);
      const scenario = scenarioByKey.get(key) ?? row;

      const demandNorm = Number(
        compareMode && mapView === 'baseline' ? row.demand_norm : scenario.demand_norm,
      );
      const supplyNorm = Number(
        compareMode && mapView === 'baseline' ? row.supply_norm : scenario.supply_norm,
      );
      const risk = desertRiskScore(demandNorm, supplyNorm);
      const desertRiskNorm = normalizeRiskScore(risk, riskRange.min, riskRange.max);

      let value = desertRiskNorm;
      if (isDeltaView) {
        if (baseline) {
          const baselineRisk = desertRiskScore(
            Number(baseline.demand_norm),
            Number(baseline.supply_norm),
          );
          const baselineNorm = normalizeRiskScore(baselineRisk, riskRange.min, riskRange.max);
          value = desertRiskNorm - baselineNorm;
        } else {
          value = 0;
        }
      }

      const demandInfo = demandByDistrict.get(key);
      return {
        name: key,
        value,
        district_name: scenario.district_name,
        state_ut: scenario.state_ut,
        demand_pct: Number(scenario.demand_pct),
        category_facilities: Number(scenario.category_facilities),
        category_bed_capacity: categorySupplyBeds(scenario),
        expected_beds: Number(scenario.expected_beds ?? 0),
        total_facilities: Number(scenario.total_facilities),
        demand_norm: demandNorm,
        supply_norm: supplyNorm,
        desert_risk_score: risk,
        desert_risk_norm: desertRiskNorm,
        confidence_score: Number(scenario.confidence_score),
        ranked_needs: demandInfo?.categories ?? [],
      };
    });

    const deltaExtent = isDeltaView
      ? computeDeltaColorExtent(mapData.map((point) => point.value))
      : null;

    const visualMap = isDeltaView
      ? {
          show: true,
          type: 'continuous' as const,
          min: deltaExtent!.min,
          max: deltaExtent!.max,
          precision: 3,
          calculable: true,
          orient: 'vertical' as const,
          right: 16,
          top: 'center',
          text: ['Worse', 'Improved'],
          inRange: {
            color: DELTA_MAP_COLORS,
          },
          outOfRange: {
            color: NO_DATA_MAP_COLOR,
          },
        }
      : {
          show: true,
          type: 'continuous' as const,
          min: 0,
          max: 1,
          precision: 2,
          calculable: true,
          orient: 'vertical' as const,
          right: 16,
          top: 'center',
          text: ['High Risk', 'Low Risk'],
          inRange: {
            color: RISK_MAP_COLORS,
          },
          outOfRange: {
            color: NO_DATA_MAP_COLOR,
          },
        };

    return {
      tooltip: {
        trigger: 'item',
        confine: true,
        padding: 12,
        extraCssText: 'max-width: 320px; white-space: normal; line-height: 1.4;',
        formatter: (params: { name?: string }) => {
          const regionKey = params.name;
          if (!regionKey) return '';

          if (compareMode) {
            const scenario = scenarioByKey.get(regionKey) ?? filteredRows.find(
              (r) => districtKey(r.district_name, r.state_ut) === regionKey,
            );
            if (scenario) {
              const demandInfo = demandByDistrict.get(regionKey);
              return formatCompareDistrictTooltip(
                baselineByKey.get(regionKey),
                scenario,
                riskRange,
                demandInfo?.categories ?? [],
              );
            }
          }

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
      visualMap,
      series: [
        {
          name: isDeltaView ? 'Risk change' : 'Desert risk by district',
          type: 'map',
          map: 'india_districts',
          roam: true,
          cursor: onDistrictClick ? 'pointer' : 'default',
          scaleLimit: { min: 1, max: 8 },
          layoutCenter: ['50%', '50%'],
          layoutSize: '85%',
          label: { show: false },
          itemStyle: {
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
  }, [
    baselineByKey,
    compareMode,
    demandByDistrict,
    filteredRows,
    mapReady,
    mapView,
    onDistrictClick,
    riskRange,
    scenarioByKey,
    tooltipByRegion,
  ]);

  if (loading || demandRankedLoading || (compareMode && baselineLoading) || !mapReady) {
    return (
      <div className="flex h-[620px] items-center justify-center text-sm text-muted-foreground">
        {mapError ? `Map error: ${mapError}` : 'Loading heat map…'}
      </div>
    );
  }

  if (error || demandRankedError || baselineError) {
    return (
      <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
        {error ?? baselineError ?? demandRankedError}
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
        {compareMode && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <Label className="text-sm font-medium shrink-0 sm:w-36">Map view</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mapView}
              onValueChange={(value) => {
                if (value) setMapView(value as MapViewMode);
              }}
              className="flex-1 justify-start"
            >
              <ToggleGroupItem value="delta" aria-label="Risk change">
                Change (Δ)
              </ToggleGroupItem>
              <ToggleGroupItem value="baseline" aria-label="Baseline risk">
                Baseline
              </ToggleGroupItem>
              <ToggleGroupItem value="scenario" aria-label="Scenario risk">
                Scenario
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <Label className="text-sm font-medium shrink-0 sm:w-36">Data confidence</Label>
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={selectedLevels}
              onValueChange={(value) => setSelectedLevels(value as ConfidenceLevel[])}
              className="justify-start"
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
            <Link
              to="/data-quality"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Improve Data Quality
            </Link>
          </div>
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
          Showing {filteredRows.length} of {scenarioRows.length} districts.
          {compareMode ? (
            <>
              {' '}
              {mapView === 'delta'
                ? 'Change view scales colors to the largest risk shift in this scenario (green = improved, red = worse, gray = no change).'
                : mapView === 'baseline'
                  ? `Baseline ${categoryLabel} desert risk before proposed facilities.`
                  : `Scenario desert risk after proposed ${isAllCategories ? 'mapped' : categoryLabel} facilities are added to supply.`}
              {' '}
              Hover any district for baseline vs scenario facility counts and risk deltas.
            </>
          ) : (
            <>
              {' '}
              Each district is shaded by relative {categoryLabel} desert risk (demand × lack of
              supply). Hover any district to see ranked NFHS demand categories for that district.
              {onDistrictClick && ' Click a district to model a new facility in Scenario.'}
            </>
          )}
        </p>
      </div>

      {filteredRows.length === 0 ? (
        <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
          No districts match the selected confidence levels — select a level above to see data.
        </div>
      ) : (
        option && (
          <ReactECharts
            option={option}
            style={{ height: 620, width: '100%' }}
            notMerge
            onEvents={chartEvents}
          />
        )
      )}

      <p className="text-xs text-muted-foreground text-center">
        {compareMode && mapView === 'delta'
          ? 'Change view: saturated green/red scaled to the largest Δ in this scenario; gray = unchanged districts.'
          : `District color: red = high ${categoryLabel} desert risk, yellow = moderate, green = low risk.${
              onDistrictClick ? ' Click a district to open Scenario.' : ''
            }`}
      </p>
    </div>
  );
}
