import type { ReactNode } from 'react';

export function formatCountDelta(
  delta: number,
  options?: { lowerIsBetter?: boolean; suffix?: string },
): { text: string; improved: boolean | null } {
  const suffix = options?.suffix ?? '';
  if (delta === 0) {
    return { text: 'No change', improved: null };
  }
  const sign = delta > 0 ? '+' : '';
  const improved = options?.lowerIsBetter ? delta < 0 : delta > 0;
  return { text: `${sign}${delta.toLocaleString()}${suffix}`, improved };
}

export function deltaClassName(improved: boolean | null): string {
  if (improved === null) return 'text-muted-foreground';
  return improved ? 'text-emerald-600' : 'text-destructive';
}

type CompareMetricCardProps = {
  title: string;
  baseline: ReactNode;
  scenario: ReactNode;
  delta?: number | null;
  lowerIsBetter?: boolean;
  deltaSuffix?: string;
  loading?: boolean;
  subtitle?: ReactNode;
};

export function CompareMetricCard({
  title,
  baseline,
  scenario,
  delta,
  lowerIsBetter = false,
  deltaSuffix,
  loading,
  subtitle,
}: CompareMetricCardProps) {
  const deltaInfo =
    delta != null && Number.isFinite(delta)
      ? formatCountDelta(delta, { lowerIsBetter, suffix: deltaSuffix })
      : null;

  return (
    <div className="rounded-lg border border-border/60 bg-card shadow-sm p-4">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <>
          <div className="mt-1 text-2xl font-bold tabular-nums">{scenario}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Baseline: <span className="tabular-nums">{baseline}</span>
          </div>
          {deltaInfo && (
            <div className={`mt-1 text-xs font-medium tabular-nums ${deltaClassName(deltaInfo.improved)}`}>
              Δ {deltaInfo.text}
            </div>
          )}
          {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
        </>
      )}
    </div>
  );
}
