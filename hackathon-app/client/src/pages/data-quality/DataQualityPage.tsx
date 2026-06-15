import { useEffect, useMemo, useState } from 'react';
import {
  useAnalyticsQuery,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { sql } from '@databricks/appkit-ui/js';
import { resolveDqGap, refreshDqSnapshot, suggestFacilitySpecialty, updateDqGapStatus } from '../../lib/mapping-api';
import { isRenderableSpecialtyCode, parseJsonRecord, toDisplayString, toRawString, toSpecialtyDisplayString } from '../../lib/display-value';
import { MappingsSection } from '../mappings/MappingsSection';

const EXCLUDED_METRIC_GROUPS = new Set(['health_indicator', 'inventory']);
const GAP_TABLE_MAX_HEIGHT = '32.5rem';

const FACILITY_TYPE_OPTIONS = [
  'hospital',
  'clinic',
  'dentist',
  'doctor',
  'pharmacy',
  'nursing_home',
];

function specialtiesRawToInput(value: unknown): string {
  const text = toRawString(value);
  if (!text) return '';
  if (!isRenderableSpecialtyCode(text)) return '';
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => toSpecialtyDisplayString(item))
          .filter(isRenderableSpecialtyCode)
          .join(', ');
      }
    } catch {
      return toSpecialtyDisplayString(text);
    }
  }
  return toSpecialtyDisplayString(text);
}

function fieldLabel(fieldName: string): string {
  return fieldName.replaceAll('_', ' ');
}

type DqGapRow = {
  gap_id: string;
  gap_type: string;
  severity: string;
  entity_type: string;
  entity_key: unknown;
  entity_label: unknown;
  field_name: string | null;
  current_value: unknown;
  suggested_fix: string | null;
  fix_action: string;
  fix_payload: unknown;
  status: string;
};

function parsePayload(payload: unknown): Record<string, string> {
  return parseJsonRecord(payload);
}

function gapTypeLabel(gapType: string): string {
  return gapType.replaceAll('_', ' ');
}

function supportsAiSpecialtySuggest(gap: DqGapRow): boolean {
  if (gap.gap_type === 'facility_without_specialty') return true;
  if (gap.fix_action !== 'update_facility_field') return false;
  const fieldName = parsePayload(gap.fix_payload).field_name || toDisplayString(gap.field_name);
  return fieldName === 'specialties_raw';
}

function severityVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (severity === 'critical') return 'destructive';
  if (severity === 'warn') return 'secondary';
  return 'outline';
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'pass') return 'default';
  if (status === 'warn') return 'secondary';
  if (status === 'fail') return 'destructive';
  return 'outline';
}

function formatMetricValue(value: number | null, unit: string | null): string {
  if (value == null) return '—';
  if (unit === 'percent') return `${value}%`;
  return String(value);
}

function QueryErrorAlert({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-md">{error}</div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function MetricsGrid({ refreshKey, onRetry }: { refreshKey: number; onRetry: () => void }) {
  const params = useMemo(
    () => ({ _refresh: sql.string(String(refreshKey)) }),
    [refreshKey],
  );
  const { data, loading, error } = useAnalyticsQuery('dq_metrics', params);

  if (error) {
    return <QueryErrorAlert error={error} onRetry={onRetry} />;
  }
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!data?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No metrics yet. Run the Virtue Foundation curation job to populate{' '}
        <code className="text-xs">dq_metrics</code>.
      </p>
    );
  }

  const groups = data.reduce<Record<string, typeof data>>((acc, row) => {
    const group = row.metric_group ?? 'other';
    if (EXCLUDED_METRIC_GROUPS.has(group)) return acc;
    acc[group] ??= [];
    acc[group].push(row);
    return acc;
  }, {});

  const visibleGroups = Object.entries(groups).filter(([, rows]) => rows.length > 0);
  if (!visibleGroups.length) {
    return <p className="text-sm text-muted-foreground">No facility or mapping metrics to display.</p>;
  }

  return (
    <div className="space-y-6">
      {visibleGroups.map(([group, rows]) => (
        <div key={group}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            {group.replaceAll('_', ' ')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((row) => (
              <Card key={row.metric_key} className="shadow-sm border-border/60">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{row.metric_label}</p>
                      <p className="text-2xl font-bold mt-1">
                        {formatMetricValue(row.actual_value, row.unit)}
                      </p>
                      {row.expected_value != null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Target: {formatMetricValue(row.expected_value, row.unit)}
                        </p>
                      )}
                    </div>
                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{row.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GapFixDialog({
  gap,
  categories,
  categoriesLoading,
  specialtyOptions,
  specialtiesLoading,
  open,
  busy,
  onOpenChange,
  onResolve,
  onDismiss,
}: {
  gap: DqGapRow | null;
  categories: string[];
  categoriesLoading: boolean;
  specialtyOptions: string[];
  specialtiesLoading: boolean;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (payload: Record<string, string>) => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const defaults = gap ? parsePayload(gap.fix_payload) : {};
  const entityKey = gap ? toRawString(gap.entity_key) : '';
  const entityLabel = gap ? toRawString(gap.entity_label) : '';

  const [specialty, setSpecialty] = useState('');
  const [category, setCategory] = useState('');
  const [indicatorKey, setIndicatorKey] = useState('');
  const [specialtyCategory, setSpecialtyCategory] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [facilitySpecialty, setFacilitySpecialty] = useState('');
  const [correctedValue, setCorrectedValue] = useState('');
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestError, setAiSuggestError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const resetForm = (row: DqGapRow) => {
    const rowDefaults = parsePayload(row.fix_payload);
    const key = toRawString(row.entity_key);
    setSpecialty(rowDefaults.specialty || key);
    setCategory('');
    setIndicatorKey(rowDefaults.indicator_key || key);
    setSpecialtyCategory('');
    setFacilityId(rowDefaults.facility_id || key);
    setFacilitySpecialty('');
    setCorrectedValue(
      specialtiesRawToInput(rowDefaults.current_value || row.current_value),
    );
    setAiSuggestError(null);
    setAiSuggestion(null);
  };

  useEffect(() => {
    if (open && gap) resetForm(gap);
  }, [open, gap?.gap_id]);

  if (!gap) return null;

  const fieldName = defaults.field_name || toRawString(gap.field_name);
  const facilityFieldId = defaults.facility_id || entityKey;
  const facilityDescription = defaults.description?.trim();
  const canAiSuggest = supportsAiSpecialtySuggest(gap);

  const runAiSuggest = async () => {
    const targetFacilityId = facilityFieldId.trim();
    if (!targetFacilityId) return;

    setAiSuggesting(true);
    setAiSuggestError(null);
    try {
      const suggestion = await suggestFacilitySpecialty(targetFacilityId);
      setAiSuggestion(suggestion.specialty);
      if (gap.fix_action === 'add_facility_specialty') {
        setFacilitySpecialty(suggestion.specialty);
      } else {
        setCorrectedValue(suggestion.specialty);
      }
    } catch (err) {
      setAiSuggestError(err instanceof Error ? err.message : 'AI suggestion failed');
    } finally {
      setAiSuggesting(false);
    }
  };

  const primaryLabel =
    gap.fix_action === 'delete_health_indicator_specialty'
      ? 'Remove bad mapping'
      : gap.fix_action === 'add_specialty_category_mapping'
        ? 'Map specialty'
        : gap.fix_action === 'add_health_indicator_specialty'
          ? 'Map indicator'
          : gap.fix_action === 'add_facility_specialty'
            ? 'Add specialty'
            : 'Save to facility';

  const canSubmit = (() => {
    switch (gap.fix_action) {
      case 'add_specialty_category_mapping':
        return specialty.trim().length > 0 && category.length > 0;
      case 'add_health_indicator_specialty':
        return indicatorKey.trim().length > 0 && specialtyCategory.length > 0;
      case 'add_facility_specialty':
        return facilityId.trim().length > 0 && facilitySpecialty.trim().length > 0;
      case 'update_facility_field':
        return correctedValue.trim().length > 0;
      case 'delete_health_indicator_specialty':
        return true;
      default:
        return false;
    }
  })();

  const submit = async () => {
    switch (gap.fix_action) {
      case 'add_specialty_category_mapping':
        await onResolve({ specialty: specialty.trim(), category });
        break;
      case 'add_health_indicator_specialty':
        await onResolve({
          indicator_key: indicatorKey.trim(),
          specialty_category: specialtyCategory,
        });
        break;
      case 'add_facility_specialty':
        await onResolve({
          facility_id: facilityId.trim(),
          specialty: facilitySpecialty.trim(),
        });
        break;
      case 'update_facility_field':
        await onResolve({
          facility_id: facilityFieldId,
          field_name: fieldName,
          corrected_value: correctedValue.trim(),
        });
        break;
      case 'delete_health_indicator_specialty':
        await onResolve({
          indicator_key: defaults.indicator_key || entityKey,
          specialty_category: defaults.specialty_category ?? '',
        });
        break;
      default:
        break;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Badge variant={severityVariant(gap.severity)}>{gap.severity}</Badge>
            {gapTypeLabel(gap.gap_type)}
          </DialogTitle>
          <DialogDescription>{gap.suggested_fix ?? 'Edit the source data to resolve this gap.'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <p className="font-medium">{entityLabel || entityKey || '—'}</p>
          {entityKey && <p className="text-xs text-muted-foreground font-mono">{entityKey}</p>}
          {facilityDescription ? (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{facilityDescription}</p>
          ) : null}
          {specialtiesRawToInput(gap.current_value) || toDisplayString(gap.current_value) ? (
            <p className="text-xs text-muted-foreground">
              Current: {specialtiesRawToInput(gap.current_value) || toDisplayString(gap.current_value)}
            </p>
          ) : null}
        </div>

        <div className="space-y-4 py-2">
          {canAiSuggest && (
            <div className="space-y-2 rounded-md border border-border/60 p-3 bg-muted/30">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">AI specialty guess</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || aiSuggesting || !facilityFieldId.trim()}
                  onClick={() => void runAiSuggest()}
                >
                  {aiSuggesting ? 'Suggesting…' : 'Suggest with AI'}
                </Button>
              </div>
              {aiSuggestion ? (
                <p className="text-sm">
                  Suggested: <span className="font-medium">{aiSuggestion}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Uses facility name, type, and description to pick the best matching specialty.
                </p>
              )}
              {aiSuggestError ? (
                <p className="text-xs text-destructive">{aiSuggestError}</p>
              ) : null}
            </div>
          )}

          {gap.fix_action === 'add_specialty_category_mapping' && (
            <>
              <div className="space-y-2">
                <Label>Specialty</Label>
                <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                {categoriesLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 z-[200]" position="popper">
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </>
          )}

          {gap.fix_action === 'add_health_indicator_specialty' && (
            <>
              <div className="space-y-2">
                <Label>Indicator key</Label>
                <Input value={indicatorKey} onChange={(e) => setIndicatorKey(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Specialty category</Label>
                {categoriesLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={specialtyCategory} onValueChange={setSpecialtyCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 z-[200]" position="popper">
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </>
          )}

          {gap.fix_action === 'add_facility_specialty' && (
            <>
              <div className="space-y-2">
                <Label>Facility ID</Label>
                <Input value={facilityId} onChange={(e) => setFacilityId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Specialty</Label>
                {specialtiesLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={facilitySpecialty} onValueChange={setFacilitySpecialty}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select specialty" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {specialtyOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </>
          )}

          {gap.fix_action === 'update_facility_field' && fieldName === 'specialties_raw' && (
            <div className="space-y-2">
              <Label>Specialty</Label>
              {specialtiesLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={correctedValue} onValueChange={setCorrectedValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select specialty" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {specialtyOptions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {gap.fix_action === 'update_facility_field' && fieldName === 'operator_type' && (
            <div className="space-y-2">
              <Label>{fieldLabel(fieldName)}</Label>
              <Select value={correctedValue} onValueChange={setCorrectedValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Select operator type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">public</SelectItem>
                  <SelectItem value="private">private</SelectItem>
                  <SelectItem value="unknown">unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {gap.fix_action === 'update_facility_field' && fieldName === 'facility_type' && (
            <div className="space-y-2">
              <Label>{fieldLabel(fieldName)}</Label>
              <Select value={correctedValue} onValueChange={setCorrectedValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Select facility type" />
                </SelectTrigger>
                <SelectContent>
                  {FACILITY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {gap.fix_action === 'update_facility_field' &&
            fieldName !== 'operator_type' &&
            fieldName !== 'facility_type' &&
            fieldName !== 'specialties_raw' && (
              <div className="space-y-2">
                <Label>{fieldLabel(fieldName)}</Label>
                <Input
                  value={correctedValue}
                  placeholder={
                    fieldName === 'pincode'
                      ? '110001'
                      : undefined
                  }
                  onChange={(e) => setCorrectedValue(e.target.value)}
                />
              </div>
            )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={busy} onClick={() => void onDismiss()}>
            Dismiss gap
          </Button>
          {gap.fix_action !== 'dismiss_only' && (
            <Button
              disabled={busy || !canSubmit}
              variant={gap.fix_action === 'delete_health_indicator_specialty' ? 'destructive' : 'default'}
              onClick={() => void submit()}
            >
              {primaryLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GapsPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const gapParams = useMemo(
    () => ({ _refresh: sql.string(String(refreshKey)) }),
    [refreshKey],
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [selectedGap, setSelectedGap] = useState<DqGapRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: gaps, loading, error } = useAnalyticsQuery('dq_gaps_open', gapParams);
  const { data: categories, loading: categoriesLoading } = useAnalyticsQuery('specialty_categories', undefined, {
    autoStart: dialogOpen,
  });
  const { data: specialtyRows, loading: specialtiesLoading } = useAnalyticsQuery(
    'specialty_options',
    undefined,
    { autoStart: dialogOpen },
  );

  const categoryOptions = useMemo(
    () =>
      (categories ?? [])
        .map((row) => toRawString(row.specialty_category).trim())
        .filter((item) => item.length > 0),
    [categories],
  );

  const specialtyOptions = useMemo(
    () =>
      (specialtyRows ?? [])
        .map((row) => toSpecialtyDisplayString(row.specialty))
        .filter(isRenderableSpecialtyCode),
    [specialtyRows],
  );

  const filteredGaps = useMemo(() => {
    const rows = (gaps ?? []) as DqGapRow[];
    if (filter === 'all') return rows;
    return rows.filter((gap) => gap.gap_type === filter);
  }, [gaps, filter]);

  const gapTypes = useMemo(() => {
    const rows = (gaps ?? []) as DqGapRow[];
    return [...new Set(rows.map((gap) => gap.gap_type))];
  }, [gaps]);

  const openGap = (gap: DqGapRow) => {
    setSelectedGap(gap);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedGap(null);
  };

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      closeDialog();
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <QueryErrorAlert error={error} onRetry={onChanged} />;
  }
  if (loading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-md">{actionError}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm">Filter</Label>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All open gaps</SelectItem>
            {gapTypes.map((gapType) => (
              <SelectItem key={gapType} value={gapType}>
                {gapTypeLabel(gapType)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filteredGaps.length} open</span>
      </div>

      {!filteredGaps.length ? (
        <p className="text-sm text-muted-foreground">No open data quality gaps. Nice work.</p>
      ) : (
        <div
          className="overflow-auto border border-border/60 rounded-md"
          style={{ maxHeight: GAP_TABLE_MAX_HEIGHT }}
        >
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Suggested fix</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGaps.map((gap) => {
                const entityKey = toRawString(gap.entity_key);
                const entityLabel = toRawString(gap.entity_label);
                const gapPayload = parsePayload(gap.fix_payload);
                const description = gapPayload.description?.trim();
                return (
                  <TableRow
                    key={gap.gap_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openGap(gap)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={severityVariant(gap.severity)}>{gap.severity}</Badge>
                        <span className="text-sm">{gapTypeLabel(gap.gap_type)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{entityLabel || entityKey || '—'}</div>
                      {entityKey && entityKey !== entityLabel && (
                        <div className="text-xs text-muted-foreground font-mono">{entityKey}</div>
                      )}
                      {description ? (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</div>
                      ) : null}
                      {specialtiesRawToInput(gap.current_value) || toDisplayString(gap.current_value) ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          Current: {specialtiesRawToInput(gap.current_value) || toDisplayString(gap.current_value)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {gap.suggested_fix ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">Click a row to edit and resolve the gap.</p>

      <GapFixDialog
        gap={selectedGap}
        categories={categoryOptions}
        categoriesLoading={categoriesLoading}
        specialtyOptions={specialtyOptions}
        specialtiesLoading={specialtiesLoading}
        open={dialogOpen}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) closeDialog();
          else setDialogOpen(true);
        }}
        onResolve={(payload) =>
          runAction(() =>
            resolveDqGap({
              gap_id: selectedGap!.gap_id,
              fix_action: selectedGap!.fix_action,
              payload,
            }),
          )
        }
        onDismiss={() =>
          runAction(() =>
            updateDqGapStatus({
              gap_id: selectedGap!.gap_id,
              status: 'dismissed',
              resolution_notes: 'Dismissed by user',
            }),
          )
        }
      />
    </div>
  );
}

export function DataQualityPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshAll = () => setRefreshKey((key) => key + 1);

  const manualRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshDqSnapshot();
      refreshAll();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Data Quality</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Review facility and mapping quality, resolve gaps, and manage specialty mappings in one
            place.
          </p>
        </div>
        <Button variant="outline" disabled={refreshing} onClick={() => void manualRefresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh scorecard'}
        </Button>
      </div>

      {refreshError && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-md">{refreshError}</div>
      )}

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Quality scorecard</CardTitle>
          <CardDescription>
            Facility, mapping, and geographic metrics. Refreshes after you resolve gaps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MetricsGrid refreshKey={refreshKey} onRetry={refreshAll} />
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Actionable gaps</CardTitle>
          <CardDescription>
            Click a row to open the editor. Fixes update{' '}
            <code className="text-xs">facility</code> and mapping tables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GapsPanel refreshKey={refreshKey} onChanged={refreshAll} />
        </CardContent>
      </Card>

      <div>
        <h3 className="text-lg font-semibold mb-4">Specialty mappings</h3>
        <MappingsSection onChanged={refreshAll} />
      </div>
    </div>
  );
}
