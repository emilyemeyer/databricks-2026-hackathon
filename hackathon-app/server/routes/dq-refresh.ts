import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWorkspaceClient } from '@databricks/appkit';

const SCHEMA = 'dais_2026.hackathon';
const WAIT_TIMEOUT = '50s';
const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_MS = 180_000;

type StatementResponse = Awaited<
  ReturnType<ReturnType<typeof getWorkspaceClient>['statementExecution']['executeStatement']>
>;

function parseStatementRows(response: StatementResponse): Record<string, unknown>[] {
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

async function waitForStatement(
  client: ReturnType<typeof getWorkspaceClient>,
  statementId: string,
): Promise<StatementResponse> {
  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    const response = await client.statementExecution.getStatement(statementId);
    const state = response.status?.state;
    if (state === 'SUCCEEDED') {
      return response;
    }
    if (state === 'FAILED' || state === 'CANCELED' || state === 'CLOSED') {
      throw new Error(response.status?.error?.message ?? `SQL statement ${state?.toLowerCase() ?? 'failed'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('SQL statement timed out waiting for completion');
}

async function runSqlStatement(statement: string): Promise<Record<string, unknown>[]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    throw new Error('DATABRICKS_WAREHOUSE_ID is not configured');
  }

  const client = getWorkspaceClient({});
  let response = await client.statementExecution.executeStatement({
    warehouse_id: warehouseId,
    statement,
    wait_timeout: WAIT_TIMEOUT,
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  });

  const state = response.status?.state;
  if (state === 'PENDING' || state === 'RUNNING') {
    if (!response.statement_id) {
      throw new Error('SQL statement did not return a statement id while still running');
    }
    response = await waitForStatement(client, response.statement_id);
  }

  if (response.status?.state === 'FAILED') {
    throw new Error(response.status.error?.message ?? 'SQL statement failed');
  }

  return parseStatementRows(response);
}

function loadSqlStatements(fileName: string): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(moduleDir, '../sql', fileName);
  const sql = readFileSync(sqlPath, 'utf-8').replace(/\$\{TARGET\}/g, SCHEMA);
  const withoutComments = sql
    .split('\n')
    .filter((line: string) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((part: string) => part.trim())
    .filter((part: string) => part.length > 0);
}

function loadDqRefreshStatements(): string[] {
  return loadSqlStatements('seed_unmapped_facility_specialty_categories.sql')
    .concat(loadSqlStatements('correct_dq_demo_data.sql'))
    .concat(loadSqlStatements('seed_demo_dirty_data.sql'))
    .concat(loadSqlStatements('refresh_dq_snapshot.sql'))
    .concat(loadSqlStatements('merge_dq_gap_from_staging.sql'));
}

async function dqGapStagingExists(): Promise<boolean> {
  const rows = await runSqlStatement(`SHOW TABLES IN ${SCHEMA} LIKE 'dq_gap_staging'`);
  return rows.some((row) => String(row.tableName ?? row.table_name ?? '') === 'dq_gap_staging');
}

/** Finish merge when a prior refresh built dq_gap_staging but did not complete. */
async function recoverOrphanedGapStaging(): Promise<void> {
  if (!(await dqGapStagingExists())) {
    return;
  }

  for (const statement of loadSqlStatements('merge_dq_gap_from_staging.sql')) {
    await runSqlStatement(statement);
  }
}

let refreshInFlight: Promise<void> | null = null;

/** Recompute dq_metrics and merge dq_gap from current facility + mapping tables. */
export async function refreshDqSnapshot(): Promise<void> {
  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }

  refreshInFlight = (async () => {
    await recoverOrphanedGapStaging();
    for (const statement of loadDqRefreshStatements()) {
      await runSqlStatement(statement);
    }
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}
