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
  computeRiskRange,
  desertRiskScore,
  desertRiskTierFromScore,
  desertRiskTierStyles,
  normalizeRiskScore,
} from './desertRisk';

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
  cardiacFacilities,
  riskRange,
}: {
  demand: number;
  supply: number;
  cardiacFacilities: number;
  riskRange: { min: number; max: number };
}) {
  if (cardiacFacilities === 0) {
    return (
      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-destructive/15 text-destructive">
        No Cardiac Care
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
  hypertension_pct: number;
  cardiac_facilities: number;
  gap_score: number;
  gap_flag: string;
  demand_score: number;
  supply_score: number;
  confidence_score: number;
};

function GapDistrictTable({
  title,
  description,
  rows,
  loading,
  rankColumn,
  riskRange,
}: {
  title: string;
  description: string;
  rows: GapTableRow[] | undefined;
  loading: boolean;
  rankColumn: 'gap' | 'desert';
  riskRange: { min: number; max: number };
}) {
  const headClass = (col: 'gap' | 'desert') =>
    `text-right${rankColumn === col ? ' text-foreground font-semibold' : ''}`;
  return (
    <Card className="shadow-sm border-border/60">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loading && <Skeleton className="h-48 w-full" />}
        {rows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>District</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Hypertension %</TableHead>
                <TableHead className="text-right">Cardiac-Capable Facilities</TableHead>
                <TableHead>Demand vs Supply</TableHead>
                <TableHead className="text-right">Data Confidence</TableHead>
                <TableHead className={headClass('desert')}>Cardiac Desert Risk</TableHead>
                <TableHead>Risk Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.district_name}-${row.state_ut}`}>
                  <TableCell className="font-medium">{row.district_name}</TableCell>
                  <TableCell>{row.state_ut}</TableCell>
                  <TableCell className="text-right">
                    {Number(row.hypertension_pct).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right">{row.cardiac_facilities}</TableCell>
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
                  </TableCell>
                  <TableCell>
                    <RiskCategoryBadge
                      demand={Number(row.demand_score)}
                      supply={Number(row.supply_score)}
                      cardiacFacilities={Number(row.cardiac_facilities)}
                      riskRange={riskRange}
                    />
                  </TableCell>
                </TableRow>
              ))}
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
  /** When false, queries are not run and placeholder content is shown. */
  enabled?: boolean;
  /** Adjust copy for scenario analysis context. */
  scenarioMode?: boolean;
  placeholder?: ReactNode;
};

export function HypertensionGapSection({
  facilitiesJson = '[]',
  enabled = true,
  scenarioMode = false,
  placeholder,
}: HypertensionGapSectionProps) {
  const queryParams = useMemo(
    () => ({ facilities_json: sql.string(facilitiesJson) }),
    [facilitiesJson],
  );

  const queryOptions = useMemo(() => ({ autoStart: enabled }), [enabled]);

  const { data: summary, loading: summaryLoading, error: summaryError } = useAnalyticsQuery(
    'hypertension_gap_summary',
    queryParams,
    queryOptions,
  );
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
  const { data: geoRows } = useAnalyticsQuery('hypertension_gap_geo', queryParams, queryOptions);

  const riskRange = useMemo(
    () => computeRiskRange((geoRows ?? []) as Array<{ demand_norm: number; supply_norm: number }>),
    [geoRows],
  );

  const geoStats = useMemo(() => {
    const rows = (geoRows ?? []) as Array<{
      district_name: string;
      state_ut: string;
      cardiac_facilities: number;
      demand_norm: number;
      supply_norm: number;
    }>;
    if (rows.length === 0) {
      return { totalCardiac: null as number | null, highest: null as null | { label: string; score: number } };
    }
    let totalCardiac = 0;
    let highest: { label: string; score: number } | null = null;
    for (const row of rows) {
      totalCardiac += Number(row.cardiac_facilities);
      const score = desertRiskScore(Number(row.demand_norm), Number(row.supply_norm));
      if (!highest || score > highest.score) {
        highest = { label: `${row.district_name}, ${row.state_ut}`, score };
      }
    }
    return { totalCardiac, highest };
  }, [geoRows]);

  const geoLoading = enabled && !geoRows;

  const summaryRow = summary?.[0];
  const qualityRow = quality?.[0];

  if (!enabled) {
    return (
      <div className="space-y-6">
        {placeholder ?? (
          <p className="text-sm text-muted-foreground">
            Add facilities and run analysis to see hypertension demand vs. cardiac supply metrics.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-foreground">
          Hypertension Demand vs. Cardiac Supply
          {scenarioMode && (
            <span className="ml-2 text-sm font-normal text-primary">(scenario)</span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          Compares NFHS-5 women&apos;s hypertension prevalence (demand) with cardiac-specialty
          facility counts (supply) at the district level. A high cardiac desert risk means
          relatively high hypertension burden combined with low cardiac supply.
          {scenarioMode && (
            <>
              {' '}
              Proposed scenario facilities are included in supply counts where capability matches
              cardiac care (cardio, cardiac, heart, or cardiology).
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
            <CardTitle className="text-sm font-medium">Total Cardiac-Capable Facilities</CardTitle>
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
            <CardTitle className="text-sm font-medium">Median Hypertension %</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold text-primary">
                {summaryRow?.median_hypertension_pct != null
                  ? `${Number(summaryRow.median_hypertension_pct).toFixed(1)}%`
                  : '—'}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Zero Cardiac Supply</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">
                {summaryRow?.districts_with_zero_cardiac_supply ?? '—'}
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
      </div>

      {(summaryError || tableError) && (
        <div className="text-destructive bg-destructive/10 p-3 rounded-md text-sm">
          {summaryError || tableError}
        </div>
      )}

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Cardiac Desert Risk Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplyDemandHeatMap facilitiesJson={facilitiesJson} enabled={enabled} />
        </CardContent>
      </Card>

      <GapDistrictTable
        title="Top 25 Cardiac Desert Districts"
        description="Ranked by cardiac desert risk (hypertension demand × lack of cardiac supply). Highlights where burden is high and cardiac care is scarce."
        rows={tableRows as GapTableRow[] | undefined}
        loading={tableLoading}
        rankColumn="desert"
        riskRange={riskRange}
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
                <span className="font-medium">Demand</span> is the NFHS-5 share of women aged 15+
                with high blood pressure (systolic ≥140 and/or diastolic ≥90 mmHg). It is a survey
                prevalence rate — not a patient count, not population-weighted, and it does not
                include men or measure actual cardiac events.
              </li>
              <li>
                <span className="font-medium">Supply</span> counts cardiac-capable facilities per
                district (1 per matching facility), then normalizes against the best-supplied
                district nationally. It does not reflect the number of beds, cardiologists,
                catheterization labs, operating capacity, patient throughput, or quality of care —
                a single small clinic and a large hospital each count as 1.
              </li>
            </ul>
            <p>
              Caveats: facility data is incomplete and urban-skewed; district name mismatches
              remain; specialty filters use JSON substring matching; hypertension is a prevalence
              proxy, not stroke incidence.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
