import { useMemo, type ReactNode } from 'react';
import { sql } from '@databricks/appkit-ui/js';
import {
  useAnalyticsQuery,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { SupplyDemandHeatMap } from './SupplyDemandHeatMap';
import {
  BEDS_PER_BURDEN_UNIT,
  categorySupplyBeds,
  computeRiskRange,
  desertRiskScore,
  desertRiskTierFromScore,
  desertRiskTierStyles,
  normalizeRiskScore,
} from './desertRisk';
import { CompareMetricCard } from './scenarioCompare';
import { DEFAULT_ANALYTICS_SPECIALTY, isAllSpecialtyCategories, specialtyCategoryLabel } from './analyticsConstants';
import type { DistrictSelection } from '../../lib/scenario-navigation';

function confidenceLabel(score: number): string {
  if (score >= 0.75) return 'High';
  if (score >= 0.5) return 'Medium';
  return 'Low';
}

function DemandSupplyBar({ demand, supply }: { demand: number; supply: number }) {
  const width = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div className="w-36 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Demand
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: width(demand) }} />
        </div>
        <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {demand.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Supply
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: width(supply) }} />
        </div>
        <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {supply.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function DesertRiskCell({
  demand,
  supply,
  riskRange,
}: {
  demand: number;
  supply: number;
  riskRange: { min: number; max: number };
}) {
  const risk = desertRiskScore(demand, supply);
  const normalized = normalizeRiskScore(risk, riskRange.min, riskRange.max);
  return <span className="font-medium tabular-nums">{normalized.toFixed(2)}</span>;
}

function RiskCategoryBadge({
  demand,
  supply,
  categoryBedCapacity,
  specialtyCategory,
  riskRange,
}: {
  demand: number;
  supply: number;
  categoryBedCapacity: number;
  specialtyCategory: string;
  riskRange: { min: number; max: number };
}) {
  if (categoryBedCapacity === 0) {
    return (
      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-destructive/15 text-destructive">
        {isAllSpecialtyCategories(specialtyCategory)
          ? 'No mapped supply'
          : `No ${specialtyCategory} supply`}
      </span>
    );
  }
  const risk = desertRiskScore(demand, supply);
  const tier = desertRiskTierFromScore(risk, riskRange.min, riskRange.max);
  const labels: Record<string, string> = {
    high: 'High Risk',
    moderate: 'Moderate Risk',
    low: 'Low Risk',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${desertRiskTierStyles(tier)}`}>
      {labels[tier]}
    </span>
  );
}

type GapTableRow = {
  district_name: string;
  state_ut: string;
  demand_pct: number;
  category_facilities: number;
  category_bed_capacity?: number;
  gap_score: number;
  gap_flag: string;
  demand_score: number;
  supply_score: number;
  confidence_score: number;
};

function GapDistrictTable({
  title,
  description,
  specialtyCategory,
  facilitiesLabel,
  rows,
  baselineRows,
  loading,
  rankColumn,
  riskRange,
  compareMode = false,
  onDistrictClick,
}: {
  title: string;
  description: string;
  specialtyCategory: string;
  facilitiesLabel: string;
  rows: GapTableRow[] | undefined;
  baselineRows?: GapTableRow[];
  loading: boolean;
  rankColumn: 'gap' | 'desert';
  riskRange: { min: number; max: number };
  compareMode?: boolean;
  onDistrictClick?: (district: DistrictSelection) => void;
}) {
  const baselineByKey = useMemo(() => {
    const map = new Map<string, GapTableRow>();
    for (const row of baselineRows ?? []) {
      map.set(`${row.district_name}-${row.state_ut}`, row);
    }
    return map;
  }, [baselineRows]);

  const headClass = (col: 'gap' | 'desert') =>
    `text-right${rankColumn === col ? ' text-foreground font-semibold' : ''}`;
  return (
    <Card className="shadow-sm border-border/60">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          {description}
          {onDistrictClick && (
            <span className="block mt-1 text-xs">
              Click a district to open Scenario with state and district pre-filled in the new facility
              form.
            </span>
          )}
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loading && <Skeleton className="h-48 w-full" />}
        {rows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>District</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Demand %</TableHead>
                <TableHead className="text-right">{facilitiesLabel}</TableHead>
                {compareMode && <TableHead className="text-right">Δ Beds</TableHead>}
                <TableHead>Demand vs Supply</TableHead>
                <TableHead className="text-right">Data Confidence</TableHead>
                <TableHead className={headClass('desert')}>Desert risk</TableHead>
                <TableHead>Risk Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const baseline = baselineByKey.get(`${row.district_name}-${row.state_ut}`);
                const rowBeds = categorySupplyBeds(row);
                const baselineBeds = baseline ? categorySupplyBeds(baseline) : 0;
                const bedDelta = baseline != null ? rowBeds - baselineBeds : 0;
                const baselineRisk =
                  baseline != null
                    ? desertRiskScore(Number(baseline.demand_score), Number(baseline.supply_score))
                    : null;
                const scenarioRisk = desertRiskScore(
                  Number(row.demand_score),
                  Number(row.supply_score),
                );
                const riskDelta =
                  baselineRisk != null ? scenarioRisk - baselineRisk : 0;

                return (
                <TableRow
                  key={`${row.district_name}-${row.state_ut}`}
                  className={onDistrictClick ? 'cursor-pointer hover:bg-muted/50' : undefined}
                  onClick={
                    onDistrictClick
                      ? () =>
                          onDistrictClick({
                            district_name: row.district_name,
                            state_ut: row.state_ut,
                          })
                      : undefined
                  }
                >
                  <TableCell className="font-medium">
                    {onDistrictClick ? (
                      <span className="text-primary underline-offset-2 hover:underline">
                        {row.district_name}
                      </span>
                    ) : (
                      row.district_name
                    )}
                  </TableCell>
                  <TableCell>{row.state_ut}</TableCell>
                  <TableCell className="text-right">
                    {Number(row.demand_pct).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right">
                    {compareMode && baseline != null ? (
                      <span className="tabular-nums">
                        {baselineBeds.toLocaleString()} → {rowBeds.toLocaleString()}
                      </span>
                    ) : (
                      rowBeds.toLocaleString()
                    )}
                  </TableCell>
                  {compareMode && (
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        bedDelta > 0
                          ? 'text-emerald-600'
                          : bedDelta < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {bedDelta > 0 ? `+${bedDelta.toLocaleString()}` : bedDelta === 0 ? '—' : bedDelta.toLocaleString()}
                    </TableCell>
                  )}
                  <TableCell>
                    <DemandSupplyBar
                      demand={Number(row.demand_score)}
                      supply={Number(row.supply_score)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium">
                      {confidenceLabel(Number(row.confidence_score))}
                    </span>
                    <span className="text-muted-foreground ml-1">
                      ({Number(row.confidence_score).toFixed(2)})
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DesertRiskCell
                      demand={Number(row.demand_score)}
                      supply={Number(row.supply_score)}
                      riskRange={riskRange}
                    />
                    {compareMode && riskDelta !== 0 && (
                      <div
                        className={`text-xs tabular-nums ${
                          riskDelta < 0 ? 'text-emerald-600' : 'text-destructive'
                        }`}
                      >
                        {riskDelta > 0 ? '+' : ''}
                        {riskDelta.toFixed(3)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <RiskCategoryBadge
                      demand={Number(row.demand_score)}
                      supply={Number(row.supply_score)}
                      categoryBedCapacity={rowBeds}
                      specialtyCategory={specialtyCategory}
                      riskRange={riskRange}
                    />
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export type HypertensionGapSectionProps = {
  /** Raw JSON array of scenario facilities; pass `[]` for baseline analytics. */
  facilitiesJson?: string;
  specialtyCategory?: string;
  /** Bumps analytics queries when the user re-runs scenario analysis. */
  runKey?: number;
  /** When false, queries are not run and placeholder content is shown. */
  enabled?: boolean;
  /** Adjust copy for scenario analysis context. */
  scenarioMode?: boolean;
  placeholder?: ReactNode;
  /** When set (analytics page), district clicks navigate to scenario builder. */
  onDistrictClick?: (district: DistrictSelection) => void;
};

export function HypertensionGapSection({
  facilitiesJson = '[]',
  specialtyCategory = DEFAULT_ANALYTICS_SPECIALTY,
  runKey = 0,
  enabled = true,
  scenarioMode = false,
  placeholder,
  onDistrictClick,
}: HypertensionGapSectionProps) {
  const categoryLabel = specialtyCategoryLabel(specialtyCategory);
  const isAllCategories = isAllSpecialtyCategories(specialtyCategory);
  const facilitiesLabel = isAllCategories
    ? 'Mapped specialty beds'
    : `${categoryLabel} beds`;

  const queryParams = useMemo(
    () => ({
      facilities_json: sql.string(facilitiesJson),
      specialty_category: sql.string(specialtyCategory),
      _run: sql.string(String(runKey)),
    }),
    [facilitiesJson, specialtyCategory, runKey],
  );

  const baselineParams = useMemo(
    () => ({
      facilities_json: sql.string('[]'),
      specialty_category: sql.string(specialtyCategory),
      _run: sql.string(String(runKey)),
    }),
    [specialtyCategory, runKey],
  );

  const queryOptions = useMemo(() => ({ autoStart: enabled }), [enabled]);
  const baselineQueryOptions = useMemo(
    () => ({ autoStart: enabled && scenarioMode }),
    [enabled, scenarioMode],
  );

  const { data: summary, loading: summaryLoading, error: summaryError } = useAnalyticsQuery(
    'hypertension_gap_summary',
    queryParams,
    queryOptions,
  );
  const {
    data: baselineSummary,
    loading: baselineSummaryLoading,
  } = useAnalyticsQuery('hypertension_gap_summary', baselineParams, baselineQueryOptions);

  const { data: quality, loading: qualityLoading } = useAnalyticsQuery(
    'hypertension_gap_data_quality',
    undefined,
    queryOptions,
  );
  const { data: tableRows, loading: tableLoading, error: tableError } = useAnalyticsQuery(
    'hypertension_gap_table',
    queryParams,
    queryOptions,
  );
  const {
    data: baselineTableRows,
    loading: baselineTableLoading,
  } = useAnalyticsQuery('hypertension_gap_table', baselineParams, baselineQueryOptions);

  const { data: geoRows, loading: geoQueryLoading } = useAnalyticsQuery(
    'hypertension_gap_geo',
    queryParams,
    queryOptions,
  );
  const {
    data: baselineGeoRows,
    loading: baselineGeoQueryLoading,
  } = useAnalyticsQuery('hypertension_gap_geo', baselineParams, baselineQueryOptions);

  const computeGeoStats = (
    rows: Array<{
      district_name: string;
      state_ut: string;
      category_facilities: number;
      category_bed_capacity?: number;
      demand_norm: number;
      supply_norm: number;
    }> | undefined,
  ) => {
    if (!rows || rows.length === 0) {
      return { totalCardiac: null as number | null, highest: null as null | { label: string; score: number } };
    }
    let totalCardiac = 0;
    let highest: { label: string; score: number } | null = null;
    for (const row of rows) {
      totalCardiac += categorySupplyBeds(row);
      const score = desertRiskScore(Number(row.demand_norm), Number(row.supply_norm));
      if (!highest || score > highest.score) {
        highest = { label: `${row.district_name}, ${row.state_ut}`, score };
      }
    }
    return { totalCardiac, highest };
  };

  const riskRange = useMemo(
    () =>
      computeRiskRange(
        ((scenarioMode ? baselineGeoRows : geoRows) ?? []) as Array<{
          demand_norm: number;
          supply_norm: number;
        }>,
      ),
    [baselineGeoRows, geoRows, scenarioMode],
  );

  const geoStats = useMemo(
    () =>
      computeGeoStats(
        (geoRows ?? []) as Array<{
          district_name: string;
          state_ut: string;
          category_facilities: number;
          demand_norm: number;
          supply_norm: number;
        }>,
      ),
    [geoRows],
  );

  const baselineGeoStats = useMemo(
    () =>
      computeGeoStats(
        (baselineGeoRows ?? []) as Array<{
          district_name: string;
          state_ut: string;
          category_facilities: number;
          demand_norm: number;
          supply_norm: number;
        }>,
      ),
    [baselineGeoRows],
  );

  const geoLoading = enabled && (geoQueryLoading || (scenarioMode && baselineGeoQueryLoading));

  const summaryRow = summary?.[0];
  const baselineSummaryRow = baselineSummary?.[0];
  const qualityRow = quality?.[0];

  if (!enabled) {
    return (
      <div className="space-y-6">
        {placeholder ?? (
          <p className="text-sm text-muted-foreground">
            Add facilities and run analysis to see specialty demand vs. supply metrics.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-foreground">
          {categoryLabel} — Demand vs. Supply
          {scenarioMode && (
            <span className="ml-2 text-sm font-normal text-primary">(scenario)</span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          {isAllCategories ? (
            <>
              Compares aggregate NFHS district health demand (all mapped indicators) with category
              bed capacity (supply). Demand scales with both prevalence and NFHS surveyed households
              in the district — larger populations require more beds for the same adequacy.
            </>
          ) : (
            <>
              Compares NFHS-5 district health indicators mapped to{' '}
              <strong>{categoryLabel}</strong> via{' '}
              <code className="text-xs">health_indicator_specialty</code> (demand) with category bed
              capacity (supply). Demand burden is prevalence × surveyed households, so districts
              with more people need more beds to close the same gap.
            </>
          )}
          {scenarioMode && (
            <>
              {' '}
              Results compare baseline (current supply) with your scenario (baseline plus proposed
              facilities). Proposed bed capacity is added to category supply and compared to local
              demand — large investments can fully close a district gap.
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {scenarioMode ? (
          <>
            <CompareMetricCard
              title={isAllCategories ? 'Total mapped specialty beds' : `Total ${categoryLabel} beds`}
              loading={geoLoading}
              baseline={
                baselineGeoStats.totalCardiac != null
                  ? baselineGeoStats.totalCardiac.toLocaleString()
                  : '—'
              }
              scenario={
                geoStats.totalCardiac != null ? geoStats.totalCardiac.toLocaleString() : '—'
              }
              delta={
                baselineGeoStats.totalCardiac != null && geoStats.totalCardiac != null
                  ? geoStats.totalCardiac - baselineGeoStats.totalCardiac
                  : null
              }
            />
            <CompareMetricCard
              title={isAllCategories ? 'Zero mapped supply districts' : `Zero ${categoryLabel} supply districts`}
              loading={summaryLoading || baselineSummaryLoading}
              baseline={baselineSummaryRow?.districts_with_zero_category_supply ?? '—'}
              scenario={summaryRow?.districts_with_zero_category_supply ?? '—'}
              delta={
                baselineSummaryRow?.districts_with_zero_category_supply != null &&
                summaryRow?.districts_with_zero_category_supply != null
                  ? Number(summaryRow.districts_with_zero_category_supply) -
                    Number(baselineSummaryRow.districts_with_zero_category_supply)
                  : null
              }
              lowerIsBetter
            />
            <CompareMetricCard
              title="High Desert Risk Districts"
              loading={summaryLoading || baselineSummaryLoading}
              baseline={baselineSummaryRow?.districts_high_gap_or_no_supply ?? '—'}
              scenario={summaryRow?.districts_high_gap_or_no_supply ?? '—'}
              delta={
                baselineSummaryRow?.districts_high_gap_or_no_supply != null &&
                summaryRow?.districts_high_gap_or_no_supply != null
                  ? Number(summaryRow.districts_high_gap_or_no_supply) -
                    Number(baselineSummaryRow.districts_high_gap_or_no_supply)
                  : null
              }
              lowerIsBetter
              subtitle={
                summaryRow?.districts_analyzed != null &&
                summaryRow?.districts_high_gap_or_no_supply != null &&
                Number(summaryRow.districts_analyzed) > 0
                  ? `${(
                      (Number(summaryRow.districts_high_gap_or_no_supply) /
                        Number(summaryRow.districts_analyzed)) *
                      100
                    ).toFixed(0)}% of districts (scenario)`
                  : undefined
              }
            />
            <Card className="shadow-sm border-border/60 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Highest Risk District</CardTitle>
              </CardHeader>
              <CardContent>
                {geoLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                        Baseline
                      </p>
                      <p className="font-semibold text-destructive leading-tight">
                        {baselineGeoStats.highest?.label ?? '—'}
                      </p>
                      {baselineGeoStats.highest && (
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                          Risk{' '}
                          {normalizeRiskScore(
                            baselineGeoStats.highest.score,
                            riskRange.min,
                            riskRange.max,
                          ).toFixed(2)}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                        Scenario
                      </p>
                      <p className="font-semibold text-destructive leading-tight">
                        {geoStats.highest?.label ?? '—'}
                      </p>
                      {geoStats.highest && (
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                          Risk{' '}
                          {normalizeRiskScore(
                            geoStats.highest.score,
                            riskRange.min,
                            riskRange.max,
                          ).toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            <CompareMetricCard
              title="Median demand %"
              loading={summaryLoading || baselineSummaryLoading}
              baseline={
                baselineSummaryRow?.median_demand_pct != null
                  ? `${Number(baselineSummaryRow.median_demand_pct).toFixed(1)}%`
                  : '—'
              }
              scenario={
                summaryRow?.median_demand_pct != null
                  ? `${Number(summaryRow.median_demand_pct).toFixed(1)}%`
                  : '—'
              }
              delta={
                baselineSummaryRow?.median_demand_pct != null &&
                summaryRow?.median_demand_pct != null
                  ? Number(summaryRow.median_demand_pct) -
                    Number(baselineSummaryRow.median_demand_pct)
                  : null
              }
              deltaSuffix="%"
              lowerIsBetter
            />
          </>
        ) : (
          <>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Highest Risk District</CardTitle>
          </CardHeader>
          <CardContent>
            {geoLoading ? <Skeleton className="h-8 w-32" /> : (
              <>
                <div className="text-lg font-bold text-destructive leading-tight">
                  {geoStats.highest?.label ?? '—'}
                </div>
                {geoStats.highest && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Desert risk{' '}
                    {normalizeRiskScore(geoStats.highest.score, riskRange.min, riskRange.max).toFixed(
                      2,
                    )}{' '}
                    (highest nationally)
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {isAllCategories ? 'Total mapped specialty beds' : `Total ${categoryLabel} beds`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {geoLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">
                {geoStats.totalCardiac != null
                  ? geoStats.totalCardiac.toLocaleString()
                  : '—'}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Median demand %</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold text-primary">
                {summaryRow?.median_demand_pct != null
                  ? `${Number(summaryRow.median_demand_pct).toFixed(1)}%`
                  : '—'}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Zero category supply</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">
                {summaryRow?.districts_with_zero_category_supply ?? '—'}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">High Desert Risk Districts</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold text-destructive">
                  {summaryRow?.districts_high_gap_or_no_supply ?? '—'}
                </div>
                {summaryRow?.districts_high_gap_or_no_supply != null &&
                  summaryRow?.districts_analyzed != null &&
                  Number(summaryRow.districts_analyzed) > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {(
                        (Number(summaryRow.districts_high_gap_or_no_supply) /
                          Number(summaryRow.districts_analyzed)) *
                        100
                      ).toFixed(0)}
                      % of districts
                    </div>
                  )}
              </>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Districts Analyzed</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">
                {summaryRow?.districts_analyzed != null
                  ? Number(summaryRow.districts_analyzed).toLocaleString()
                  : '—'}
              </div>
            )}
          </CardContent>
        </Card>
          </>
        )}
      </div>

      {(summaryError || tableError) && (
        <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
          {summaryError || tableError}
        </div>
      )}

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>
            {scenarioMode
              ? `${categoryLabel} desert risk — baseline vs scenario`
              : `${categoryLabel} desert risk heat map`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SupplyDemandHeatMap
            facilitiesJson={facilitiesJson}
            specialtyCategory={specialtyCategory}
            runKey={runKey}
            enabled={enabled}
            compareMode={scenarioMode}
            onDistrictClick={onDistrictClick}
          />
        </CardContent>
      </Card>

      <GapDistrictTable
        title={isAllCategories ? 'Top 25 desert districts (all categories)' : `Top 25 ${categoryLabel} desert districts`}
        description={
          scenarioMode
            ? 'Scenario rankings with baseline → scenario bed counts and risk deltas. Negative risk Δ means improved supply vs. demand balance.'
            : isAllCategories
              ? 'Ranked by aggregate desert risk across all mapped demand and supply. Highlights districts with high overall burden and scarce mapped facilities.'
              : `Ranked by desert risk (category demand × lack of ${categoryLabel} supply). Highlights districts where burden is high and category supply is scarce.`
        }
        specialtyCategory={specialtyCategory}
        facilitiesLabel={facilitiesLabel}
        rows={tableRows as GapTableRow[] | undefined}
        baselineRows={scenarioMode ? (baselineTableRows as GapTableRow[] | undefined) : undefined}
        loading={tableLoading || (scenarioMode && baselineTableLoading)}
        rankColumn="desert"
        riskRange={riskRange}
        compareMode={scenarioMode}
        onDistrictClick={onDistrictClick}
      />

      <Card className="shadow-sm border-border/60 bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">Data Quality (v1)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          {qualityLoading && <Skeleton className="h-16 w-full" />}
          {qualityRow && (
            <ul className="list-disc pl-5 space-y-1">
              <li>
                {Number(qualityRow.facilities_pincode_match_pct).toFixed(1)}% of facilities
                matched to a pincode ({qualityRow.facilities_matched_to_pincode} /{' '}
                {qualityRow.facilities_total})
              </li>
              <li>
                {Number(qualityRow.nfhs_districts_with_facilities_pct).toFixed(1)}% of NFHS
                districts have at least one matched facility ({qualityRow.nfhs_districts_with_facilities}{' '}
                / {qualityRow.nfhs_districts_total})
              </li>
              <li>{qualityRow.nfhs_districts_unmatched} districts have zero matched facilities</li>
            </ul>
          )}
          <div className="pt-2 space-y-2">
            <p className="font-medium text-foreground">How to read supply &amp; demand</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-medium">Demand</span>{' '}
                {isAllCategories ? (
                  <>
                    averages all NFHS-5 indicator values with any{' '}
                    <code className="text-xs">health_indicator_specialty</code> mapping, multiplied
                    by surveyed households to estimate burden. Larger districts need more beds for
                    the same prevalence rate.
                  </>
                ) : (
                  <>
                    averages NFHS-5 indicator values mapped to <strong>{categoryLabel}</strong> in{' '}
                    <code className="text-xs">health_indicator_specialty</code>, then multiplies by
                    surveyed households for population-weighted burden.
                  </>
                )}
              </li>
              <li>
                <span className="font-medium">Supply</span>{' '}
                {isAllCategories ? (
                  <>
                    sums category bed capacity per district (facility{' '}
                    <code className="text-xs">bed_count</code>, default 25 when missing). Scenario
                    facilities add entered bed counts. Expected beds = (prevalence % ÷ 100) ×
                    households × {BEDS_PER_BURDEN_UNIT}; supply adequacy is actual beds ÷ expected,
                    capped at 1.0.
                  </>
                ) : (
                  <>
                    sums <strong>{categoryLabel}</strong> bed capacity per district (mapped facility
                    beds plus scenario bed counts). Expected beds = (prevalence % ÷ 100) × households
                    × {BEDS_PER_BURDEN_UNIT}; supply adequacy is actual beds ÷ expected, capped at
                    1.0.
                  </>
                )}
              </li>
            </ul>
            <p>
              Caveats: facility data is incomplete and urban-skewed; district name mismatches may
              remain; unmapped indicators or specialties reduce coverage for some categories.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
