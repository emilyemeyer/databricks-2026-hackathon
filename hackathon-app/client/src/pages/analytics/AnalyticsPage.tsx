import { useMemo } from 'react';
import {
  useAnalyticsQuery,
  AreaChart,
  LineChart,
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

function HypertensionGapSection() {
  const { data: summary, loading: summaryLoading, error: summaryError } =
    useAnalyticsQuery('hypertension_gap_summary');
  const { data: quality, loading: qualityLoading } =
    useAnalyticsQuery('hypertension_gap_data_quality');
  const { data: tableRows, loading: tableLoading, error: tableError } =
    useAnalyticsQuery('hypertension_gap_table');
  const { data: geoRows } = useAnalyticsQuery('hypertension_gap_geo');

  const riskRange = useMemo(
    () => computeRiskRange((geoRows ?? []) as Array<{ demand_norm: number; supply_norm: number }>),
    [geoRows],
  );

  const summaryRow = summary?.[0];
  const qualityRow = quality?.[0];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-foreground">
          Hypertension Demand vs. Cardiac Supply
        </h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          Compares NFHS-5 women&apos;s hypertension prevalence (demand) with cardiac-specialty
          facility counts (supply) at the district level. A high cardiac desert risk means
          relatively high hypertension burden combined with low cardiac supply.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <SupplyDemandHeatMap />
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
          <p className="pt-2">
            Caveats: facility data is incomplete and urban-skewed; district name mismatches remain;
            specialty filters use JSON substring matching; hypertension is a prevalence proxy, not
            stroke incidence.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function AnalyticsPage() {
  const { data: summary, loading: summaryLoading, error: summaryError } =
    useAnalyticsQuery('facility_summary');

  const summaryRow = summary?.[0];

  return (
    <div className="space-y-10 w-full max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Virtue Foundation Analytics</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Healthcare facilities across India from the DAIS 2026 hackathon dataset.
        </p>
      </div>

      <HypertensionGapSection />

      <div className="border-t pt-8 space-y-6">
        <h3 className="text-xl font-semibold text-foreground">Facility Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <CardTitle>Dataset Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-8 w-1/2" />
                </div>
              )}
              {summaryError && (
                <div className="text-destructive bg-destructive/10 p-3 rounded-md">
                  Error: {summaryError}
                </div>
              )}
              {summaryRow && (
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Total facilities</div>
                    <div className="text-3xl font-bold text-primary">
                      {Number(summaryRow.total_facilities).toLocaleString()}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">States</div>
                      <div className="text-xl font-semibold">{summaryRow.states_covered}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Facility types</div>
                      <div className="text-xl font-semibold">{summaryRow.facility_types}</div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 md:col-span-2 flex min-w-0">
            <CardHeader>
              <CardTitle>Top States by Facility Count</CardTitle>
            </CardHeader>
            <CardContent>
              <AreaChart queryKey="facilities_by_state" />
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60 flex min-w-0 md:col-span-2">
            <CardHeader>
              <CardTitle>Facilities by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart queryKey="facilities_by_type" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
