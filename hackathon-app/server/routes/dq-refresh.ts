import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWorkspaceClient } from '@databricks/appkit';

const SCHEMA = 'dais_2026.hackathon';

async function runSqlStatement(statement: string): Promise<void> {
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
}

function loadDqRefreshStatements(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(moduleDir, '../sql/refresh_dq_snapshot.sql');
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

let refreshInFlight: Promise<void> | null = null;

/** Recompute dq_metrics and merge dq_gap from current facility + mapping tables. */
export async function refreshDqSnapshot(): Promise<void> {
  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }

  refreshInFlight = (async () => {
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
