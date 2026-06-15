export type DesertRiskTier = 'high' | 'moderate' | 'low';

export function desertRiskScore(demandNorm: number, supplyNorm: number): number {
  return demandNorm * (1 - supplyNorm);
}

export function normalizeRiskScore(risk: number, minRisk: number, maxRisk: number): number {
  if (maxRisk <= minRisk) return 0;
  return (risk - minRisk) / (maxRisk - minRisk);
}

/** Bucket normalized desert risk into High / Moderate / Low (thirds of national range). */
export function desertRiskTierFromScore(
  risk: number,
  minRisk: number,
  maxRisk: number,
): DesertRiskTier {
  const normalized = normalizeRiskScore(risk, minRisk, maxRisk);
  if (normalized >= 0.66) return 'high';
  if (normalized >= 0.33) return 'moderate';
  return 'low';
}

export function desertRiskTierLabel(tier: DesertRiskTier): string {
  const labels: Record<DesertRiskTier, string> = {
    high: 'High',
    moderate: 'Moderate',
    low: 'Low',
  };
  return labels[tier];
}

export function desertRiskTierStyles(tier: DesertRiskTier): string {
  const styles: Record<DesertRiskTier, string> = {
    high: 'bg-destructive/15 text-destructive',
    moderate: 'bg-amber-500/15 text-amber-600',
    low: 'bg-emerald-500/15 text-emerald-600',
  };
  return styles[tier];
}

export function computeRiskRange(
  rows: Array<{ demand_norm: number | string; supply_norm: number | string }>,
): { min: number; max: number } {
  const risks = rows.map((row) =>
    desertRiskScore(Number(row.demand_norm), Number(row.supply_norm)),
  );
  if (risks.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...risks), max: Math.max(...risks) };
}
