import { getWorkspaceClient } from '@databricks/appkit';

const SCHEMA = 'dais_2026.hackathon';
const RAW_FACILITIES =
  'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities';

export type SpecialtySuggestion = {
  specialty: string;
  context_text: string;
  source: 'ai_classify' | 'ai_query';
};

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

async function runSql(statement: string): Promise<Record<string, unknown>[]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    throw new Error('DATABRICKS_WAREHOUSE_ID is not configured');
  }

  const client = getWorkspaceClient({});
  const response = await client.statementExecution.executeStatement({
    warehouse_id: warehouseId,
    statement,
    wait_timeout: '50s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  });

  if (response.status?.state === 'FAILED') {
    throw new Error(response.status.error?.message ?? 'SQL statement failed');
  }

  const result = response.result;
  if (!result?.data_array) {
    return [];
  }
  const columns =
    response.manifest?.schema?.columns?.map((column) => column.name ?? '') ?? [];
  return result.data_array.map((row) =>
    Object.fromEntries(columns.map((name, index) => [name, row[index]])),
  );
}

function buildFacilityContextSql(facilityId: string): string {
  const id = escapeSqlString(facilityId.trim());
  return `
    SELECT
      concat_ws('\\n',
        'Facility name:', COALESCE(NULLIF(NULLIF(TRIM(f.facility_name), ''), 'null'), 'Unknown'),
        'Facility type:', COALESCE(NULLIF(NULLIF(TRIM(f.facility_type), ''), 'null'), 'unknown'),
        'Description:', COALESCE(NULLIF(TRIM(raw.description), ''), 'none')
      ) AS context_text
    FROM ${SCHEMA}.facility f
    LEFT JOIN ${RAW_FACILITIES} raw ON f.facility_id = TRIM(raw.unique_id)
    WHERE f.facility_id = '${id}'
  `;
}

function buildSpecialtyLabelsCte(): string {
  return `
    specialty_labels AS (
      SELECT collect_list(specialty) AS labels
      FROM (
        SELECT DISTINCT TRIM(specialties) AS specialty
        FROM ${SCHEMA}.specialty_category_mapping
        WHERE specialties IS NOT NULL
          AND TRIM(specialties) != ''
          AND TRIM(specialties) NOT LIKE '{%'
          AND TRIM(specialties) NOT LIKE '[%'
        ORDER BY specialty
        LIMIT 400
      )
    )
  `;
}

async function suggestWithAiClassify(facilityId: string): Promise<SpecialtySuggestion | null> {
  const id = escapeSqlString(facilityId.trim());
  const rows = await runSql(`
WITH ${buildSpecialtyLabelsCte()},
facility_ctx AS (
  ${buildFacilityContextSql(id)}
)
SELECT
  fc.context_text,
  ai_classify(fc.context_text, sl.labels) AS suggested_specialty
FROM facility_ctx fc
CROSS JOIN specialty_labels sl
`);

  const row = rows[0];
  const specialty = String(row?.suggested_specialty ?? '').trim();
  const contextText = String(row?.context_text ?? '').trim();
  if (!specialty || !contextText) {
    return null;
  }

  return {
    specialty,
    context_text: contextText,
    source: 'ai_classify',
  };
}

async function suggestWithAiQuery(facilityId: string): Promise<SpecialtySuggestion | null> {
  const id = escapeSqlString(facilityId.trim());
  const labelRows = await runSql(`
SELECT specialty
FROM (
  SELECT DISTINCT TRIM(specialties) AS specialty
  FROM ${SCHEMA}.specialty_category_mapping
  WHERE specialties IS NOT NULL
    AND TRIM(specialties) != ''
    AND TRIM(specialties) NOT LIKE '{%'
    AND TRIM(specialties) NOT LIKE '[%'
  ORDER BY specialty
  LIMIT 400
) labels
`);

  const labels = labelRows
    .map((row) => String(row.specialty ?? '').trim())
    .filter(Boolean);
  if (!labels.length) {
    throw new Error('No specialty labels found in specialty_category_mapping');
  }

  const contextRows = await runSql(buildFacilityContextSql(id));
  const contextText = String(contextRows[0]?.context_text ?? '').trim();
  if (!contextText) {
    throw new Error('Facility not found');
  }

  const prompt = [
    'You classify healthcare facilities into exactly one medical specialty.',
    'Pick the single best matching specialty from the allowed list.',
    'Respond with only the specialty name, with no extra text.',
    '',
    'Allowed specialties:',
    labels.join(', '),
    '',
    'Facility information:',
    contextText,
  ].join('\n');

  const rows = await runSql(`
SELECT ai_query(
  'databricks-claude-sonnet-4-6',
  '${escapeSqlString(prompt)}',
  failOnError => false
) AS ai_response
`);

  const response = String(rows[0]?.ai_response ?? '').trim();
  const parsed = response
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();

  const matched =
    labels.find((label) => label.toLowerCase() === parsed.toLowerCase()) ??
    labels.find((label) => parsed.toLowerCase().includes(label.toLowerCase())) ??
    parsed;

  if (!matched) {
    return null;
  }

  return {
    specialty: matched,
    context_text: contextText,
    source: 'ai_query',
  };
}

/** Infer the best specialty for a facility using Databricks AI Functions. */
export async function suggestFacilitySpecialty(
  facilityId: string,
): Promise<SpecialtySuggestion> {
  const trimmedId = facilityId.trim();
  if (!trimmedId) {
    throw new Error('facility_id is required');
  }

  try {
    const classified = await suggestWithAiClassify(trimmedId);
    if (classified) {
      return classified;
    }
  } catch (err) {
    console.warn('ai_classify specialty suggestion failed, falling back to ai_query:', err);
  }

  const queried = await suggestWithAiQuery(trimmedId);
  if (!queried) {
    throw new Error('Could not infer a specialty for this facility');
  }
  return queried;
}
