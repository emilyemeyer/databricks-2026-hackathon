import type {
  SavedScenario,
  ScenarioFacilityInput,
  ScenarioSummary,
} from '../types/scenario';

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function listScenarios(): Promise<ScenarioSummary[]> {
  const res = await fetch('/api/lakebase/scenarios');
  return parseJson<ScenarioSummary[]>(res);
}

export async function getScenario(id: number): Promise<SavedScenario> {
  const res = await fetch(`/api/lakebase/scenarios/${id}`);
  return parseJson<SavedScenario>(res);
}

export async function createScenario(payload: {
  name: string;
  description?: string;
  facilities: ScenarioFacilityInput[];
}): Promise<SavedScenario> {
  const res = await fetch('/api/lakebase/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<SavedScenario>(res);
}

export async function updateScenario(
  id: number,
  payload: {
    name?: string;
    description?: string;
    facilities?: ScenarioFacilityInput[];
  },
): Promise<SavedScenario> {
  const res = await fetch(`/api/lakebase/scenarios/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<SavedScenario>(res);
}

export async function duplicateScenario(id: number): Promise<SavedScenario> {
  const res = await fetch(`/api/lakebase/scenarios/${id}/duplicate`, { method: 'POST' });
  return parseJson<SavedScenario>(res);
}

export async function deleteScenario(id: number): Promise<void> {
  const res = await fetch(`/api/lakebase/scenarios/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${res.statusText}`);
  }
}

export function facilitiesToAnalyticsJson(facilities: ScenarioFacilityInput[]): string {
  return JSON.stringify(
    facilities.map((f) => ({
      district_name: f.district_name,
      state_ut: f.state_ut,
      capability: f.capability,
      capacity: f.capacity,
    })),
  );
}
