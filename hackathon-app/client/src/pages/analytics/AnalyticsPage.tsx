import {
  useAnalyticsQuery,
  AreaChart,
  LineChart,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';

export function AnalyticsPage() {
  const { data: summary, loading: summaryLoading, error: summaryError } =
    useAnalyticsQuery('facility_summary');

  const summaryRow = summary?.[0];

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Virtue Foundation Analytics</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Healthcare facilities across India from the DAIS 2026 hackathon dataset.
        </p>
      </div>

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
  );
}
