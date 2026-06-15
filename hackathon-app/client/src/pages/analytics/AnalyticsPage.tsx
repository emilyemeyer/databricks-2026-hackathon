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
import { SupplyDemandGeoMap } from './SupplyDemandGeoMap';

function GapFlagBadge({ flag }: { flag: string }) {
  const styles: Record<string, string> = {
    no_supply: 'bg-destructive/15 text-destructive',
    high_gap: 'bg-primary/15 text-primary',
    low_demand_high_supply: 'bg-muted text-muted-foreground',
    balanced: 'bg-secondary text-secondary-foreground',
  };
  const label = flag.replace(/_/g, ' ');
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[flag] ?? styles.balanced}`}>
      {label}
    </span>
  );
}

function HypertensionGapSection() {
  const { data: summary, loading: summaryLoading, error: summaryError } =
    useAnalyticsQuery('hypertension_gap_summary');
  const { data: quality, loading: qualityLoading } =
    useAnalyticsQuery('hypertension_gap_data_quality');
  const { data: tableRows, loading: tableLoading, error: tableError } =
    useAnalyticsQuery('hypertension_gap_table');

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
          facility counts (supply) at the district level. A positive gap score means relatively
          high hypertension burden and low cardiac supply — not acute event incidence.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Median hypertension %</CardTitle>
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
            <CardTitle className="text-sm font-medium">Zero cardiac supply</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">
                {summaryRow?.districts_with_zero_cardiac_supply ?? '—'}
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
          <CardTitle>Supply vs. Demand by District</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplyDemandGeoMap />
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Top 25 High-Gap Districts</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {tableLoading && <Skeleton className="h-48 w-full" />}
          {tableRows && tableRows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>District</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Hypertension %</TableHead>
                  <TableHead className="text-right">Cardiac facilities</TableHead>
                  <TableHead className="text-right">Gap score</TableHead>
                  <TableHead>Flag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((row) => (
                  <TableRow key={`${row.district_name}-${row.state_ut}`}>
                    <TableCell className="font-medium">{row.district_name}</TableCell>
                    <TableCell>{row.state_ut}</TableCell>
                    <TableCell className="text-right">
                      {Number(row.hypertension_pct).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">{row.cardiac_facilities}</TableCell>
                    <TableCell className="text-right">
                      {Number(row.gap_score).toFixed(3)}
                    </TableCell>
                    <TableCell>
                      <GapFlagBadge flag={String(row.gap_flag)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border/60 bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">Data quality (v1)</CardTitle>
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
