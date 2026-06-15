import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Badge,
} from '@databricks/appkit-ui/react';
import { Copy, ExternalLink, Trash2 } from 'lucide-react';
import {
  deleteScenario,
  duplicateScenario,
  listScenarios,
} from '../../lib/scenario-api';
import type { ScenarioSummary } from '../../types/scenario';

export function LakebasePage() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listScenarios();
      setScenarios(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scenarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDuplicate = async (id: number) => {
    setBusyId(id);
    try {
      await duplicateScenario(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate scenario');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyId(id);
    try {
      await deleteScenario(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scenario');
    } finally {
      setBusyId(null);
    }
  };

  const totalFacilities = scenarios.reduce((sum, s) => sum + s.facility_count, 0);

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Lakebase Scenario Library</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Persistent scenario plans stored in managed Postgres — relational schema, transactional
          saves, and per-user connections via Lakebase OBO.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>Saved scenarios</CardDescription>
            <CardTitle className="text-3xl">{loading ? '—' : scenarios.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>Total proposed facilities</CardDescription>
            <CardTitle className="text-3xl">{loading ? '—' : totalFacilities}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>Storage</CardDescription>
            <CardTitle className="text-base font-medium pt-2">
              <code className="text-sm">app.scenarios</code> +{' '}
              <code className="text-sm">app.scenario_facilities</code>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Saved scenarios</CardTitle>
            <CardDescription>
              Create and edit scenarios on the Scenario page; manage copies and deletions here.
            </CardDescription>
          </div>
          <Button asChild>
            <Link to="/scenario">Open scenario builder</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="text-destructive bg-destructive/10 p-3 rounded-md mb-4">{error}</div>
          )}

          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={`sk-${i}`} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!loading && scenarios.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No scenarios saved yet. Build one on the Scenario page and click Save to Lakebase.
            </p>
          )}

          {!loading && scenarios.length > 0 && (
            <div className="space-y-3">
              {scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{scenario.name}</span>
                      <Badge variant="secondary">{scenario.facility_count} facilities</Badge>
                    </div>
                    {scenario.description && (
                      <p className="text-sm text-muted-foreground mt-1">{scenario.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Updated {new Date(scenario.updated_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/scenario?load=${scenario.id}`}>
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Open
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === scenario.id}
                      onClick={() => void handleDuplicate(scenario.id)}
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Duplicate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === scenario.id}
                      onClick={() => void handleDelete(scenario.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
