import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { Label, Slider, useAnalyticsQuery } from '@databricks/appkit-ui/react';

const INDIA_GEOJSON_PATH = '/geo/india-districts.geojson';

const POP_SIZE_MIN = 5;
const POP_SIZE_MAX = 38;

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

type ScatterPoint = {
  name: string;
  value: [number, number, number];
  district_name: string;
  state_ut: string;
  hypertension_pct: number;
  households_surveyed: number;
  pincode_count: number;
  cardiac_facilities: number;
  total_facilities: number;
  balance_ratio: number;
  confidence_score: number;
};

function logSymbolSize(value: number, min: number, max: number): number {
  if (max <= min) return (POP_SIZE_MIN + POP_SIZE_MAX) / 2;
  const safeMin = Math.max(min, 1);
  const safeMax = Math.max(max, 1);
  const safeValue = Math.max(value, 1);
  const logMin = Math.log(safeMin);
  const logMax = Math.log(safeMax);
  if (logMax <= logMin) return (POP_SIZE_MIN + POP_SIZE_MAX) / 2;
  const t = (Math.log(safeValue) - logMin) / (logMax - logMin);
  return POP_SIZE_MIN + t * (POP_SIZE_MAX - POP_SIZE_MIN);
}

function confidenceLabel(score: number): string {
  if (score >= 0.75) return 'High';
  if (score >= 0.5) return 'Medium';
  return 'Low';
}

export function SupplyDemandGeoMap() {
  const { data, loading, error } = useAnalyticsQuery('hypertension_gap_geo');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [minConfidence, setMinConfidence] = useState(0);

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

  const filteredRows = useMemo(
    () => allRows.filter((row) => Number(row.confidence_score) >= minConfidence),
    [allRows, minConfidence],
  );

  const sizeBounds = useMemo(() => {
    const values = filteredRows.map((r) => Number(r.pincode_count));
    if (values.length === 0) return { min: 1, max: 1 };
    return { min: Math.max(Math.min(...values), 1), max: Math.max(Math.max(...values), 1) };
  }, [filteredRows]);

  const option = useMemo(() => {
    if (!mapReady || filteredRows.length === 0) return null;

    const scatterData: ScatterPoint[] = filteredRows.map((row) => {
      const balance = Number(row.balance_ratio);
      return {
        name: `${row.district_name}, ${row.state_ut}`,
        value: [Number(row.longitude), Number(row.latitude), balance],
        district_name: row.district_name,
        state_ut: row.state_ut,
        hypertension_pct: Number(row.hypertension_pct),
        households_surveyed: Number(row.households_surveyed),
        pincode_count: Number(row.pincode_count),
        cardiac_facilities: Number(row.cardiac_facilities),
        total_facilities: Number(row.total_facilities),
        balance_ratio: balance,
        confidence_score: Number(row.confidence_score),
      };
    });

    const balances = scatterData.map((d) => d.value[2]);
    const minBal = Math.min(...balances, -0.5);
    const maxBal = Math.max(...balances, 0.5);

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: { data?: ScatterPoint }) => {
          const row = params.data;
          if (!row?.district_name) return '';
          const bal = row.balance_ratio;
          const relation = bal >= 0 ? 'Supply > demand' : 'Supply < demand';
          return [
            `<strong>${row.district_name}</strong>, ${row.state_ut}`,
            `Households surveyed: ${row.households_surveyed.toLocaleString()}`,
            `Postal areas: ${row.pincode_count.toLocaleString()} pincodes`,
            `Hypertension: ${row.hypertension_pct.toFixed(1)}%`,
            `Cardiac facilities: ${row.cardiac_facilities} (${row.total_facilities} total)`,
            `Balance: ${bal.toFixed(3)} (${relation})`,
            `Confidence: ${confidenceLabel(row.confidence_score)} (${row.confidence_score.toFixed(2)})`,
          ].join('<br/>');
        },
      },
      geo: {
        map: 'india_districts',
        roam: true,
        zoom: 1.15,
        center: [82, 23],
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
        min: minBal,
        max: maxBal,
        dimension: 2,
        calculable: true,
        orient: 'vertical',
        right: 16,
        top: 'center',
        text: ['Supply > demand', 'Supply < demand'],
        inRange: {
          color: ['#7f0000', '#e57373', '#f5f5f5', '#81c784', '#1b5e20'],
        },
      },
      series: [
        {
          name: 'District balance',
          type: 'scatter',
          coordinateSystem: 'geo',
          data: scatterData,
          symbolSize: (_val: number[], params: { data?: ScatterPoint }) => {
            const scale = params.data?.pincode_count ?? 1;
            return logSymbolSize(scale, sizeBounds.min, sizeBounds.max);
          },
          encode: { value: 2 },
        },
      ],
    };
  }, [filteredRows, mapReady, sizeBounds]);

  if (loading || !mapReady) {
    return (
      <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground">
        {mapError ? `Map error: ${mapError}` : 'Loading geographic view…'}
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

  const sliderLabel =
    minConfidence === 0
      ? 'Show all districts'
      : minConfidence >= 0.75
        ? 'High confidence only'
        : `Confidence ≥ ${(minConfidence * 100).toFixed(0)}%`;

  return (
    <div className="w-full space-y-4">
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <Label htmlFor="confidence-slider" className="text-sm font-medium shrink-0 sm:w-36">
            Data confidence
          </Label>
          <Slider
            id="confidence-slider"
            className="flex-1"
            min={0}
            max={100}
            step={5}
            value={[Math.round(minConfidence * 100)]}
            onValueChange={(v) => setMinConfidence((v[0] ?? 0) / 100)}
          />
          <span className="text-xs text-muted-foreground sm:w-40 shrink-0">{sliderLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Showing {filteredRows.length} of {allRows.length} districts. Confidence blends NFHS
          survey sample size (60%) with matched facility coverage (40%). Dot size = district
          scale by pincode count (log scale; NFHS household samples are nearly uniform).
        </p>
      </div>

      {filteredRows.length === 0 ? (
        <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
          No districts meet this confidence threshold — lower the slider to see more data.
        </div>
      ) : (
        option && <ReactECharts option={option} style={{ height: 480, width: '100%' }} notMerge />
      )}

      <p className="text-xs text-muted-foreground text-center">
        Color: green = supply &gt; demand, red = supply &lt; demand. Size: larger dot = more
        postal pincodes in the district (log scale).
      </p>
    </div>
  );
}
