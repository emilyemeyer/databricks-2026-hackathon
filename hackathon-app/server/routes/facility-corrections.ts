import { z } from 'zod';
import { cleanSpecialtyMarkup } from '../../shared/specialty-clean';

const SCHEMA = 'dais_2026.hackathon';

export const FACILITY_EDITABLE_FIELDS = [
  'facility_name',
  'pincode',
  'operator_type',
  'facility_type',
  'doctors_count',
  'bed_count',
  'specialties_raw',
  'state_ut',
  'district_name',
] as const;

export type FacilityEditableField = (typeof FACILITY_EDITABLE_FIELDS)[number];

const INTEGER_FIELDS = new Set<FacilityEditableField>(['doctors_count', 'bed_count']);
const OPERATOR_TYPES = new Set(['public', 'private', 'unknown']);

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function isFacilityEditableField(field: string): field is FacilityEditableField {
  return (FACILITY_EDITABLE_FIELDS as readonly string[]).includes(field);
}

export function specialtiesInputToRaw(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '[]';
  if (trimmed.startsWith('[')) return trimmed;
  const parts = trimmed
    .split(',')
    .map((part) => cleanSpecialtyMarkup(part))
    .filter(Boolean);
  return JSON.stringify(parts);
}

export function buildFacilityCorrectionMerge(
  facilityId: string,
  fieldName: FacilityEditableField,
  rawValue: string,
): string {
  const id = escapeSqlString(facilityId.trim());
  const valueLiteral = INTEGER_FIELDS.has(fieldName)
    ? `CAST('${escapeSqlString(rawValue)}' AS INT)`
    : `'${escapeSqlString(rawValue)}'`;

  return `
MERGE INTO ${SCHEMA}.facility_correction AS target
USING (
  SELECT '${id}' AS facility_id, ${valueLiteral} AS ${fieldName}
) AS source
ON target.facility_id = source.facility_id
WHEN MATCHED THEN UPDATE SET
  ${fieldName} = source.${fieldName},
  updated_at = current_timestamp()
WHEN NOT MATCHED THEN INSERT (
  facility_id, ${fieldName}, updated_at
) VALUES (
  source.facility_id, source.${fieldName}, current_timestamp()
)`;
}

export function buildFacilityFieldUpdate(
  facilityId: string,
  fieldName: FacilityEditableField,
  rawValue: string,
): string {
  const id = escapeSqlString(facilityId.trim());
  const valueExpr = INTEGER_FIELDS.has(fieldName)
    ? `CAST('${escapeSqlString(rawValue)}' AS INT)`
    : `'${escapeSqlString(rawValue)}'`;

  const extra =
    fieldName === 'operator_type'
      ? `, operator_type_raw = '${escapeSqlString(rawValue)}'`
      : '';

  return `
UPDATE ${SCHEMA}.facility
SET ${fieldName} = ${valueExpr}${extra}
WHERE facility_id = '${id}'`;
}

export function buildFacilitySpecialtyResync(facilityId: string): string {
  const id = escapeSqlString(facilityId.trim());
  return `
DELETE FROM ${SCHEMA}.facility_specialty WHERE facility_id = '${id}';
INSERT INTO ${SCHEMA}.facility_specialty
SELECT DISTINCT
  f.facility_id,
  TRIM(
    regexp_replace(
      regexp_replace(TRIM(specialty), '^[*_]+', ''),
      '[*_]+$', '')
  ) AS specialty
FROM ${SCHEMA}.facility f
LATERAL VIEW explode(
  CASE
    WHEN f.specialties_raw IS NOT NULL AND f.specialties_raw LIKE '[%'
    THEN from_json(f.specialties_raw, 'ARRAY<STRING>')
    ELSE array()
  END
) t AS specialty
WHERE f.facility_id = '${id}'
  AND specialty IS NOT NULL
  AND TRIM(
    regexp_replace(
      regexp_replace(TRIM(specialty), '^[*_]+', ''),
      '[*_]+$', '')
  ) != ''`;
}

export const FacilityFieldUpdateBody = z.object({
  facility_id: z.string().min(1),
  field_name: z.string().min(1),
  corrected_value: z.string(),
});

export function validateFacilityFieldValue(
  fieldName: FacilityEditableField,
  correctedValue: string,
): string | null {
  if (fieldName === 'operator_type' && !OPERATOR_TYPES.has(correctedValue)) {
    return 'operator_type must be public, private, or unknown';
  }
  if (fieldName === 'pincode' && !/^[1-9][0-9]{5}$/.test(correctedValue)) {
    return 'pincode must be a 6-digit Indian pincode';
  }
  if (INTEGER_FIELDS.has(fieldName) && Number.isNaN(Number.parseInt(correctedValue, 10))) {
    return `${fieldName} must be a whole number`;
  }
  if (fieldName === 'facility_name' && !correctedValue.trim()) {
    return 'facility_name cannot be empty';
  }
  if (fieldName === 'specialties_raw') {
    const raw = specialtiesInputToRaw(correctedValue);
    if (raw === '[]') {
      return 'At least one specialty is required';
    }
  }
  return null;
}

export function normalizeFacilityFieldValue(
  fieldName: FacilityEditableField,
  correctedValue: string,
): string {
  const trimmed = correctedValue.trim();
  if (fieldName === 'specialties_raw') {
    return specialtiesInputToRaw(trimmed);
  }
  if (INTEGER_FIELDS.has(fieldName)) {
    return String(Number.parseInt(trimmed, 10));
  }
  return trimmed;
}
