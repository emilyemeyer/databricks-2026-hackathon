import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';

const INDIA_GEOJSON_PATH = '/geo/india-districts.geojson';

type GeoRow = {
  district_name: string;
  state_ut: string;
  hypertension_pct: number | string;
  cardiac_facilities: number | string;
  total_facilities: number | string;
  demand_norm: number | string;
  supply_norm: number | string;
  balance_ratio: number | string;
  latitude: number | string;
  longitude: number | string;
};

export function SupplyDemandGeoMap() {
  const { data, loading, error } = useAnalyticsQuery('hypertension_gap_geo');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

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

  const option = useMemo(() => {
    const rows = (data ?? []) as GeoRow[];
    if (!mapReady || rows.length === 0) return null;

    const scatterData = rows.map((row) => {
      const balance = Number(row.balance_ratio);
      const lng = Number(row.longitude);
      const lat = Number(row.latitude);
      return {
        name: `${row.district_name}, ${row.state_ut}`,
        value: [lng, lat, balance],
        district_name: row.district_name,
        state_ut: row.state_ut,
        hypertension_pct: Number(row.hypertension_pct),
        cardiac_facilities: Number(row.cardiac_facilities),
        balance_ratio: balance,
      };
    });

    const balances = scatterData.map((d) => d.value[2]);
    const minBal = Math.min(...balances, -0.5);
    const maxBal = Math.max(...balances, 0.5);

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: {
          data?: {
            district_name?: string;
            state_ut?: string;
            hypertension_pct?: number;
            cardiac_facilities?: number;
            balance_ratio?: number;
          };
        }) => {
          const row = params.data;
          if (!row?.district_name) return '';
          const bal = row.balance_ratio ?? 0;
          const relation = bal >= 0 ? 'Supply > demand' : 'Supply < demand';
          return [
            `<strong>${row.district_name}</strong>, ${row.state_ut}`,
            `Hypertension: ${row.hypertension_pct?.toFixed(1)}%`,
            `Cardiac facilities: ${row.cardiac_facilities}`,
            `Balance: ${bal.toFixed(3)} (${relation})`,
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
          symbolSize: (val: number[]) => 6 + Math.min(Math.abs(val[2]) * 14, 12),
          encode: { value: 2 },
        },
      ],
    };
  }, [data, mapReady]);

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

  if (!option) return null;

  return (
    <div className="w-full">
      <ReactECharts option={option} style={{ height: 480, width: '100%' }} notMerge />
      <p className="text-xs text-muted-foreground mt-2 text-center">
        Each dot is a district centroid. Green = cardiac supply exceeds hypertension burden; red =
        demand exceeds supply (darker = larger imbalance).
      </p>
    </div>
  );
}
