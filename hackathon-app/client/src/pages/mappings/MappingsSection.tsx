import { useState } from 'react';
import {
  useAnalyticsQuery,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import {
  deleteFacilitySpecialty,
  deleteHealthIndicatorSpecialty,
  upsertFacilitySpecialty,
  upsertHealthIndicatorSpecialty,
} from '../../lib/mapping-api';
import { toDisplayString } from '../../lib/display-value';

function FacilityMappingsTable({
  busy,
  onRemove,
}: {
  busy: boolean;
  onRemove: (mapping: { facility_id: string; specialty: string }) => Promise<void>;
}) {
  const { data, loading, error } = useAnalyticsQuery('mapping_facility_specialty');

  if (error) {
    return <div className="text-destructive text-sm bg-destructive/10 p-2 rounded-md">{error}</div>;
  }
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">No facility specialty mappings yet.</p>;
  }

  return (
    <div className="overflow-x-auto max-h-96">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Facility</TableHead>
            <TableHead>Specialty</TableHead>
            <TableHead>Category</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const specialty = toDisplayString(row.specialty);
            return (
              <TableRow key={`${row.facility_id}-${specialty}`}>
                <TableCell>
                  <div className="font-medium text-sm">{row.facility_name ?? row.facility_id}</div>
                  <div className="text-xs text-muted-foreground font-mono">{row.facility_id}</div>
                </TableCell>
                <TableCell>{specialty}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.specialty_category ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRemove({ facility_id: row.facility_id, specialty })}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function IndicatorMappingsTable({
  busy,
  onRemove,
}: {
  busy: boolean;
  onRemove: (mapping: { indicator_key: string; specialty_category: string }) => Promise<void>;
}) {
  const { data, loading, error } = useAnalyticsQuery('mapping_health_indicator_specialty');

  if (error) {
    return <div className="text-destructive text-sm bg-destructive/10 p-2 rounded-md">{error}</div>;
  }
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">No health indicator mappings yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Indicator key</TableHead>
            <TableHead>Specialty category</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow key={`${row.indicator_key}-${row.specialty_category}`}>
              <TableCell className="font-mono text-xs">{row.indicator_key}</TableCell>
              <TableCell>{row.specialty_category}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void onRemove({
                      indicator_key: row.indicator_key,
                      specialty_category: row.specialty_category,
                    })
                  }
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function MappingsSection({ onChanged }: { onChanged?: () => void }) {
  const { data: categories, loading: categoriesLoading } = useAnalyticsQuery('specialty_categories');

  const [facilityId, setFacilityId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [indicatorKey, setIndicatorKey] = useState('');
  const [specialtyCategory, setSpecialtyCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [facilityRefreshKey, setFacilityRefreshKey] = useState(0);
  const [indicatorRefreshKey, setIndicatorRefreshKey] = useState(0);

  const runAction = async (action: () => Promise<void>, onSuccess: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      onSuccess();
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-md">{actionError}</div>
      )}

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Facility → specialty</CardTitle>
          <CardDescription>
            Rows in <code className="text-xs">facility_specialty</code>, enriched with{' '}
            <code className="text-xs">specialty_category_mapping</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="facility-id">Facility ID</Label>
              <Input
                id="facility-id"
                placeholder="UUID from facility table"
                value={facilityId}
                onChange={(e) => setFacilityId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="specialty">Specialty code</Label>
              <Input
                id="specialty"
                placeholder="e.g. cardiology"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={busy || !facilityId.trim() || !specialty.trim()}
                onClick={() =>
                  void runAction(
                    () =>
                      upsertFacilitySpecialty({
                        facility_id: facilityId.trim(),
                        specialty: specialty.trim(),
                      }),
                    () => setFacilityRefreshKey((key) => key + 1),
                  )
                }
              >
                Add mapping
              </Button>
            </div>
          </div>

          <FacilityMappingsTable
            key={facilityRefreshKey}
            busy={busy}
            onRemove={(mapping) =>
              runAction(() => deleteFacilitySpecialty(mapping), () =>
                setFacilityRefreshKey((key) => key + 1),
              )
            }
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Health indicator → specialty category</CardTitle>
          <CardDescription>
            Rows in <code className="text-xs">health_indicator_specialty</code> link NFHS indicator
            keys to supply categories used in gap analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="indicator-key">Indicator key</Label>
              <Input
                id="indicator-key"
                placeholder="NFHS column name"
                value={indicatorKey}
                onChange={(e) => setIndicatorKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Specialty category</Label>
              {categoriesLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={specialtyCategory} onValueChange={setSpecialtyCategory}>
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {(categories ?? []).map((row) => (
                      <SelectItem key={row.specialty_category} value={row.specialty_category}>
                        {row.specialty_category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={busy || !indicatorKey.trim() || !specialtyCategory}
                onClick={() =>
                  void runAction(
                    () =>
                      upsertHealthIndicatorSpecialty({
                        indicator_key: indicatorKey.trim(),
                        specialty_category: specialtyCategory,
                      }),
                    () => setIndicatorRefreshKey((key) => key + 1),
                  )
                }
              >
                Add mapping
              </Button>
            </div>
          </div>

          <IndicatorMappingsTable
            key={indicatorRefreshKey}
            busy={busy}
            onRemove={(mapping) =>
              runAction(() => deleteHealthIndicatorSpecialty(mapping), () =>
                setIndicatorRefreshKey((key) => key + 1),
              )
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
