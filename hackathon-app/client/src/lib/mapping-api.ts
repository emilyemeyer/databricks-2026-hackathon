export type FacilitySpecialtyMapping = {
  facility_id: string;
  specialty: string;
};

export type HealthIndicatorSpecialtyMapping = {
  indicator_key: string;
  specialty_category: string;
};

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function upsertFacilitySpecialty(mapping: FacilitySpecialtyMapping): Promise<void> {
  const res = await fetch('/api/mappings/facility-specialty', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function deleteFacilitySpecialty(mapping: FacilitySpecialtyMapping): Promise<void> {
  const res = await fetch('/api/mappings/facility-specialty', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function upsertHealthIndicatorSpecialty(
  mapping: HealthIndicatorSpecialtyMapping,
): Promise<void> {
  const res = await fetch('/api/mappings/health-indicator-specialty', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function deleteHealthIndicatorSpecialty(
  mapping: HealthIndicatorSpecialtyMapping,
): Promise<void> {
  const res = await fetch('/api/mappings/health-indicator-specialty', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function upsertSpecialtyCategory(mapping: {
  specialty: string;
  category: string;
}): Promise<void> {
  const res = await fetch('/api/mappings/specialty-category', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function updateDqGapStatus(input: {
  gap_id: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution_notes?: string;
}): Promise<void> {
  const res = await fetch('/api/dq/gaps/status', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function resolveDqGap(input: {
  gap_id: string;
  fix_action: string;
  payload: Record<string, string>;
}): Promise<void> {
  const res = await fetch('/api/dq/gaps/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function updateFacilityField(input: {
  facility_id: string;
  field_name: string;
  corrected_value: string;
}): Promise<void> {
  const res = await fetch('/api/facility/corrections', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function refreshDqSnapshot(): Promise<void> {
  const res = await fetch('/api/dq/refresh', { method: 'POST' });
  if (!res.ok) throw new Error(await parseError(res));
}

export type SpecialtySuggestion = {
  specialty: string;
  context_text: string;
  source: 'ai_classify' | 'ai_query';
};

export async function suggestFacilitySpecialty(facilityId: string): Promise<SpecialtySuggestion> {
  const res = await fetch('/api/dq/gaps/suggest-specialty', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facility_id: facilityId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as SpecialtySuggestion;
}
