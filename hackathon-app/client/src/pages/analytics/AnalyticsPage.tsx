import { HypertensionGapSection } from './HypertensionGapSection';

export function AnalyticsPage() {
  return (
    <div className="space-y-10 w-full max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Virtue Foundation Analytics</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cleaned facility metrics from{' '}
          <code className="text-xs">dais_2026.hackathon.facility</code>.
        </p>
      </div>

      <HypertensionGapSection />
    </div>
  );
}
