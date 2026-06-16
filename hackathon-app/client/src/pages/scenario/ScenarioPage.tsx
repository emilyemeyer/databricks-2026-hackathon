import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
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
  Textarea,
  Badge,
} from '@databricks/appkit-ui/react';
import { Plus, X } from 'lucide-react';
import {
  createScenario,
  facilitiesToAnalyticsJson,
  getScenario,
  listScenarios,
  updateScenario,
} from '../../lib/scenario-api';
import type { ScenarioFacilityInput, ScenarioSummary } from '../../types/scenario';
import { HypertensionGapSection } from '../analytics/HypertensionGapSection';
import { SpecialtyCategorySelect } from '../analytics/SpecialtyCategorySelect';
import { DEFAULT_ANALYTICS_SPECIALTY } from '../analytics/analyticsConstants';

type DraftFacility = ScenarioFacilityInput & { clientId: string };

function newClientId(): string {
  return `facility-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ScenarioPage() {
  const { data: districts, loading: districtsLoading, error: districtsError } =
    useAnalyticsQuery('district_options');

  const [savedScenarios, setSavedScenarios] = useState<ScenarioSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [lakebaseError, setLakebaseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [activeScenarioId, setActiveScenarioId] = useState<number | null>(null);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDescription, setScenarioDescription] = useState('');
  const [facilities, setFacilities] = useState<DraftFacility[]>([]);

  const [selectedStateUt, setSelectedStateUt] = useState('');
  const [selectedDistrictKey, setSelectedDistrictKey] = useState('');
  const [capability, setCapability] = useState('');
  const [capacity, setCapacity] = useState('100');

  const [runId, setRunId] = useState(0);
  const [specialtyCategory, setSpecialtyCategory] = useState(DEFAULT_ANALYTICS_SPECIALTY);
  const [searchParams, setSearchParams] = useSearchParams();

  const loadScenario = useCallback(async (id: number) => {
    try {
      const scenario = await getScenario(id);
      setActiveScenarioId(scenario.id);
      setScenarioName(scenario.name);
      setScenarioDescription(scenario.description ?? '');
      setFacilities(
        scenario.facilities.map((f) => ({
          clientId: newClientId(),
          district_name: f.district_name,
          state_ut: f.state_ut,
          capability: f.capability,
          capacity: f.capacity,
        })),
      );
      setRunId(0);
      setLakebaseError(null);
    } catch (err) {
      setLakebaseError(err instanceof Error ? err.message : 'Failed to load scenario');
    }
  }, []);

  const refreshSavedScenarios = useCallback(async () => {
    setSavedLoading(true);
    try {
      const scenarios = await listScenarios();
      setSavedScenarios(scenarios);
      setLakebaseError(null);
    } catch (err) {
      setLakebaseError(err instanceof Error ? err.message : 'Failed to load saved scenarios');
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSavedScenarios();
  }, [refreshSavedScenarios]);

  useEffect(() => {
    const loadId = searchParams.get('load');
    if (!loadId) return;
    const id = Number.parseInt(loadId, 10);
    if (!Number.isFinite(id)) return;
    void loadScenario(id);
    setSearchParams({}, { replace: true });
  }, [loadScenario, searchParams, setSearchParams]);

  useEffect(() => {
    const stateUt = searchParams.get('state_ut');
    const districtName = searchParams.get('district_name');
    const specialty = searchParams.get('specialty_category');

    if (specialty) {
      setSpecialtyCategory(specialty);
    }

    if (!stateUt || !districtName || !districts) {
      return;
    }

    const match = districts.find(
      (d) => d.state_ut === stateUt && d.district_name === districtName,
    );
    if (!match) {
      return;
    }

    setSelectedStateUt(match.state_ut);
    setSelectedDistrictKey(match.district_key);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('state_ut');
        next.delete('district_name');
        next.delete('specialty_category');
        return next;
      },
      { replace: true },
    );

    requestAnimationFrame(() => {
      document.getElementById('add-facility')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [districts, searchParams, setSearchParams]);

  const stateOptions = useMemo(() => {
    if (!districts) return [];
    const states = [...new Set(districts.map((d) => d.state_ut))];
    return states.sort((a, b) => a.localeCompare(b));
  }, [districts]);

  const districtsInState = useMemo(() => {
    if (!districts || !selectedStateUt) return [];
    return districts
      .filter((d) => d.state_ut === selectedStateUt)
      .sort((a, b) => a.district_name.localeCompare(b.district_name));
  }, [districts, selectedStateUt]);

  const selectedDistrict = useMemo(
    () => districtsInState.find((d) => d.district_key === selectedDistrictKey),
    [districtsInState, selectedDistrictKey],
  );

  const facilityInputs: ScenarioFacilityInput[] = useMemo(
    () =>
      facilities.map(({ district_name, state_ut, capability, capacity }) => ({
        district_name,
        state_ut,
        capability,
        capacity,
      })),
    [facilities],
  );

  const scenarioFacilitiesJson = useMemo(
    () => facilitiesToAnalyticsJson(facilityInputs),
    [facilityInputs],
  );

  const analysisEnabled = runId > 0 && facilities.length > 0;

  const canAddFacility =
    !!selectedDistrict &&
    capability.trim().length > 0 &&
    Number.parseInt(capacity, 10) >= 0;

  const canSave =
    scenarioName.trim().length > 0 && facilities.length > 0 && !saving;

  const canRun = facilities.length > 0;

  const addFacility = () => {
    if (!selectedDistrict || !canAddFacility) return;
    const parsedCapacity = Number.parseInt(capacity, 10);
    setFacilities((prev) => [
      ...prev,
      {
        clientId: newClientId(),
        district_name: selectedDistrict.district_name,
        state_ut: selectedDistrict.state_ut,
        capability: capability.trim(),
        capacity: Number.isFinite(parsedCapacity) ? parsedCapacity : 0,
      },
    ]);
    setCapability('');
    setCapacity('100');
    setSelectedStateUt('');
    setSelectedDistrictKey('');
  };

  const removeFacility = (clientId: string) => {
    setFacilities((prev) => prev.filter((f) => f.clientId !== clientId));
  };

  const resetBuilder = () => {
    setActiveScenarioId(null);
    setScenarioName('');
    setScenarioDescription('');
    setFacilities([]);
    setRunId(0);
    setLakebaseError(null);
  };

  const saveScenario = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        name: scenarioName.trim(),
        description: scenarioDescription.trim() || undefined,
        facilities: facilityInputs,
      };

      const saved = activeScenarioId
        ? await updateScenario(activeScenarioId, payload)
        : await createScenario(payload);

      setActiveScenarioId(saved.id);
      setScenarioName(saved.name);
      setScenarioDescription(saved.description ?? '');
      await refreshSavedScenarios();
      setLakebaseError(null);
    } catch (err) {
      setLakebaseError(err instanceof Error ? err.message : 'Failed to save scenario');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Scenario Analysis</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Build multi-facility scenarios against cleaned{' '}
          <code className="text-xs">health_indicator</code> demand and{' '}
          <code className="text-xs">facility</code> supply data. Saved scenarios persist in Lakebase
          Postgres.
        </p>
      </div>

      <SpecialtyCategorySelect
        value={specialtyCategory}
        onValueChange={setSpecialtyCategory}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6 xl:col-span-1">
          <Card id="add-facility" className="shadow-sm border-border/60 scroll-mt-6">
            <CardHeader>
              <CardTitle>New facility</CardTitle>
              <CardDescription>Add one or more proposed facilities to this scenario.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="state">State / UT</Label>
                {districtsLoading && <Skeleton className="h-10 w-full" />}
                {districtsError && (
                  <div className="text-destructive text-sm bg-destructive/10 p-2 rounded-md">
                    {districtsError}
                  </div>
                )}
                {districts && (
                  <Select
                    value={selectedStateUt}
                    onValueChange={(value) => {
                      setSelectedStateUt(value);
                      setSelectedDistrictKey('');
                    }}
                  >
                    <SelectTrigger id="state" className="w-full">
                      <SelectValue placeholder="Select a state" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {stateOptions.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="district">District</Label>
                {districtsLoading && <Skeleton className="h-10 w-full" />}
                {districts && (
                  <Select
                    value={selectedDistrictKey}
                    onValueChange={setSelectedDistrictKey}
                    disabled={!selectedStateUt}
                  >
                    <SelectTrigger id="district" className="w-full">
                      <SelectValue
                        placeholder={
                          selectedStateUt ? 'Select a district' : 'Choose a state first'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {districtsInState.map((d) => (
                        <SelectItem key={d.district_key} value={d.district_key}>
                          {d.district_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  Districts from <code className="text-xs">dais_2026.hackathon.health_indicator</code>.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="capability">Capability</Label>
                <Textarea
                  id="capability"
                  placeholder="e.g. Cardiology, 24/7 emergency, NICU"
                  value={capability}
                  onChange={(e) => setCapability(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="capacity">Capacity (beds)</Label>
                <Input
                  id="capacity"
                  type="number"
                  min={0}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                variant="secondary"
                disabled={!canAddFacility}
                onClick={addFacility}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add facility to scenario
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <CardTitle>Scenario workspace</CardTitle>
              <CardDescription>
                Saved in Lakebase with relational facility rows and transactional writes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="scenario-name">Scenario name</Label>
                <Input
                  id="scenario-name"
                  placeholder="e.g. Sikkim cardiac expansion"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scenario-description">Description (optional)</Label>
                <Textarea
                  id="scenario-description"
                  placeholder="Planning notes for this scenario"
                  value={scenarioDescription}
                  onChange={(e) => setScenarioDescription(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="saved-scenario">Load saved scenario</Label>
                {savedLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select
                    value={activeScenarioId ? String(activeScenarioId) : ''}
                    onValueChange={(value) => {
                      if (value) void loadScenario(Number.parseInt(value, 10));
                    }}
                  >
                    <SelectTrigger id="saved-scenario" className="w-full">
                      <SelectValue placeholder="Choose from Lakebase…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {savedScenarios.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name} ({s.facility_count} facilities)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" disabled={!canSave} onClick={() => void saveScenario()}>
                  {saving ? 'Saving…' : activeScenarioId ? 'Update in Lakebase' : 'Save to Lakebase'}
                </Button>
                <Button variant="outline" onClick={resetBuilder}>
                  New
                </Button>
              </div>

              {lakebaseError && (
                <div className="text-destructive text-sm bg-destructive/10 p-2 rounded-md">
                  {lakebaseError}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-2">
          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <CardTitle>
                Facilities in scenario
                {facilities.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {facilities.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Each row is stored in <code className="text-xs">app.scenario_facilities</code> when
                saved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {facilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No facilities yet. Add at least one facility, then save to Lakebase or run
                  analysis.
                </p>
              ) : (
                <div className="space-y-2">
                  {facilities.map((facility, index) => (
                    <div
                      key={facility.clientId}
                      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/40"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          {index + 1}. {facility.district_name}, {facility.state_ut}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {facility.capability || 'No capability specified'}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {facility.capacity.toLocaleString()} beds
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFacility(facility.clientId)}
                        aria-label="Remove facility"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                className="w-full mt-4"
                disabled={!canRun}
                onClick={() => setRunId((id) => id + 1)}
              >
                Run scenario analysis
              </Button>
            </CardContent>
          </Card>

          <HypertensionGapSection
            facilitiesJson={scenarioFacilitiesJson}
            specialtyCategory={specialtyCategory}
            runKey={runId}
            enabled={analysisEnabled}
            scenarioMode
            placeholder={
              <p className="text-sm text-muted-foreground">
                Add facilities and run analysis to see specialty demand vs. supply metrics, heat
                map, and top desert districts — with your proposed bed capacity included in supply
                counts.
              </p>
            }
          />
        </div>
      </div>
    </div>
  );
}
