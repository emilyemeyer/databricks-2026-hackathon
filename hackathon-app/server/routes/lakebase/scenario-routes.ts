import { z } from 'zod';
import type { Application, Request } from 'express';

interface PgLikeClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

interface PgLikePool {
  connect(): Promise<PgLikeClient>;
}

interface LakebaseHandle {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  pool: PgLikePool;
}

interface AppKitWithLakebase {
  lakebase: LakebaseHandle & {
    asUser(req: Request): LakebaseHandle;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const TABLE_EXISTS_SQL = `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'app' AND table_name = 'scenarios'
`;

const SETUP_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS app`;

const CREATE_SCENARIOS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app.scenarios (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CREATE_FACILITIES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app.scenario_facilities (
    id SERIAL PRIMARY KEY,
    scenario_id INT NOT NULL REFERENCES app.scenarios(id) ON DELETE CASCADE,
    district_name TEXT NOT NULL,
    state_ut TEXT NOT NULL,
    capability TEXT NOT NULL DEFAULT '',
    capacity INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0
  )
`;

const ADD_DESCRIPTION_COLUMN_SQL = `
  ALTER TABLE app.scenarios ADD COLUMN IF NOT EXISTS description TEXT
`;

const FacilityBody = z.object({
  district_name: z.string().min(1),
  state_ut: z.string().min(1),
  capability: z.string(),
  capacity: z.number().int().min(0),
});

const SaveScenarioBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  facilities: z.array(FacilityBody).min(1),
});

const UpdateScenarioBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  facilities: z.array(FacilityBody).min(1).optional(),
});

type FacilityRow = {
  id: number;
  scenario_id: number;
  district_name: string;
  state_ut: string;
  capability: string;
  capacity: number;
  sort_order: number;
};

type LakebaseQueryable = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

function mapFacilityRow(row: Record<string, unknown>): FacilityRow {
  return {
    id: Number(row.id),
    scenario_id: Number(row.scenario_id),
    district_name: String(row.district_name),
    state_ut: String(row.state_ut),
    capability: String(row.capability),
    capacity: Number(row.capacity),
    sort_order: Number(row.sort_order),
  };
}

async function withTransaction<T>(
  pool: PgLikePool,
  fn: (client: PgLikeClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function fetchScenarioWithFacilities(
  db: LakebaseQueryable,
  scenarioId: number,
): Promise<Record<string, unknown> | null> {
  const scenarioResult = await db.query(
    'SELECT id, name, description, created_at, updated_at FROM app.scenarios WHERE id = $1',
    [scenarioId],
  );
  if (scenarioResult.rows.length === 0) return null;

  const facilitiesResult = await db.query(
    `SELECT id, scenario_id, district_name, state_ut, capability, capacity, sort_order
     FROM app.scenario_facilities
     WHERE scenario_id = $1
     ORDER BY sort_order, id`,
    [scenarioId],
  );

  return {
    ...scenarioResult.rows[0],
    facilities: facilitiesResult.rows.map(mapFacilityRow),
  };
}

async function replaceScenarioFacilities(
  client: PgLikeClient,
  scenarioId: number,
  facilities: z.infer<typeof FacilityBody>[],
): Promise<void> {
  await client.query('DELETE FROM app.scenario_facilities WHERE scenario_id = $1', [scenarioId]);
  if (facilities.length === 0) return;

  const districtNames = facilities.map((f) => f.district_name.trim());
  const stateUts = facilities.map((f) => f.state_ut.trim());
  const capabilities = facilities.map((f) => f.capability.trim());
  const capacities = facilities.map((f) => f.capacity);
  const sortOrders = facilities.map((_, index) => index);

  await client.query(
    `INSERT INTO app.scenario_facilities
      (scenario_id, district_name, state_ut, capability, capacity, sort_order)
     SELECT $1, d, s, c, cap, ord
     FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[])
       AS t(d, s, c, cap, ord)`,
    [scenarioId, districtNames, stateUts, capabilities, capacities, sortOrders],
  );
}

export async function setupScenarioLakebaseRoutes(appkit: AppKitWithLakebase) {
  try {
    const { rows } = await appkit.lakebase.query(TABLE_EXISTS_SQL);
    if (rows.length > 0) {
      await appkit.lakebase.query(ADD_DESCRIPTION_COLUMN_SQL);
      console.log('[lakebase] Scenario tables already exist, skipping setup');
    } else {
      await appkit.lakebase.query(SETUP_SCHEMA_SQL);
      await appkit.lakebase.query(CREATE_SCENARIOS_TABLE_SQL);
      await appkit.lakebase.query(CREATE_FACILITIES_TABLE_SQL);
      console.log('[lakebase] Created schema and scenario tables');
    }
  } catch (err) {
    console.warn('[lakebase] Scenario table setup failed:', (err as Error).message);
    console.warn('[lakebase] Scenario routes will be registered but may return errors');
  }

  appkit.server.extend((app) => {
    const dbForRequest = (req: Request): LakebaseQueryable => appkit.lakebase.asUser(req);

    app.get('/api/lakebase/scenarios', async (req, res) => {
      try {
        const result = await dbForRequest(req).query(
          `SELECT s.id, s.name, s.description, s.created_at, s.updated_at,
                  COUNT(f.id)::int AS facility_count
           FROM app.scenarios s
           LEFT JOIN app.scenario_facilities f ON f.scenario_id = s.id
           GROUP BY s.id
           ORDER BY s.updated_at DESC`,
        );
        res.json(result.rows);
      } catch (err) {
        console.error('Failed to list scenarios:', err);
        res.status(500).json({ error: 'Failed to list scenarios' });
      }
    });

    app.get('/api/lakebase/scenarios/:id', async (req, res) => {
      try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }
        const scenario = await fetchScenarioWithFacilities(dbForRequest(req), id);
        if (!scenario) {
          res.status(404).json({ error: 'Scenario not found' });
          return;
        }
        res.json(scenario);
      } catch (err) {
        console.error('Failed to get scenario:', err);
        res.status(500).json({ error: 'Failed to get scenario' });
      }
    });

    app.post('/api/lakebase/scenarios', async (req, res) => {
      try {
        const parsed = SaveScenarioBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'name and at least one facility are required' });
          return;
        }

        const userDb = appkit.lakebase.asUser(req);
        const scenarioId = await withTransaction(userDb.pool, async (client) => {
          const created = await client.query(
            `INSERT INTO app.scenarios (name, description)
             VALUES ($1, $2)
             RETURNING id`,
            [parsed.data.name.trim(), parsed.data.description?.trim() ?? null],
          );
          const id = Number(created.rows[0].id);
          await replaceScenarioFacilities(client, id, parsed.data.facilities);
          return id;
        });

        const scenario = await fetchScenarioWithFacilities(userDb, scenarioId);
        res.status(201).json(scenario);
      } catch (err) {
        console.error('Failed to create scenario:', err);
        res.status(500).json({ error: 'Failed to create scenario' });
      }
    });

    app.put('/api/lakebase/scenarios/:id', async (req, res) => {
      try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }

        const parsed = UpdateScenarioBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid scenario payload' });
          return;
        }
        if (
          parsed.data.name === undefined &&
          parsed.data.description === undefined &&
          parsed.data.facilities === undefined
        ) {
          res.status(400).json({ error: 'Nothing to update' });
          return;
        }

        const userDb = appkit.lakebase.asUser(req);

        try {
          await withTransaction(userDb.pool, async (client) => {
            if (parsed.data.name !== undefined || parsed.data.description !== undefined) {
              const updated = await client.query(
                `UPDATE app.scenarios
                 SET name = COALESCE($1, name),
                     description = COALESCE($2, description),
                     updated_at = NOW()
                 WHERE id = $3
                 RETURNING id`,
                [
                  parsed.data.name?.trim() ?? null,
                  parsed.data.description?.trim() ?? null,
                  id,
                ],
              );
              if (updated.rows.length === 0) {
                throw new Error('NOT_FOUND');
              }
            } else {
              const exists = await client.query('SELECT id FROM app.scenarios WHERE id = $1', [id]);
              if (exists.rows.length === 0) {
                throw new Error('NOT_FOUND');
              }
            }

            if (parsed.data.facilities) {
              await replaceScenarioFacilities(client, id, parsed.data.facilities);
            }

            await client.query('UPDATE app.scenarios SET updated_at = NOW() WHERE id = $1', [id]);
          });
        } catch (err) {
          if (err instanceof Error && err.message === 'NOT_FOUND') {
            res.status(404).json({ error: 'Scenario not found' });
            return;
          }
          throw err;
        }

        const scenario = await fetchScenarioWithFacilities(userDb, id);
        res.json(scenario);
      } catch (err) {
        console.error('Failed to update scenario:', err);
        res.status(500).json({ error: 'Failed to update scenario' });
      }
    });

    app.post('/api/lakebase/scenarios/:id/duplicate', async (req, res) => {
      try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }

        const userDb = appkit.lakebase.asUser(req);
        const source = await fetchScenarioWithFacilities(userDb, id);
        if (!source) {
          res.status(404).json({ error: 'Scenario not found' });
          return;
        }

        const facilities = (source.facilities as FacilityRow[]).map((f) => ({
          district_name: f.district_name,
          state_ut: f.state_ut,
          capability: f.capability,
          capacity: f.capacity,
        }));

        const newId = await withTransaction(userDb.pool, async (client) => {
          const created = await client.query(
            `INSERT INTO app.scenarios (name, description)
             VALUES ($1, $2)
             RETURNING id`,
            [`${String(source.name)} (copy)`, source.description ?? null],
          );
          const scenarioId = Number(created.rows[0].id);
          await replaceScenarioFacilities(client, scenarioId, facilities);
          return scenarioId;
        });

        const scenario = await fetchScenarioWithFacilities(userDb, newId);
        res.status(201).json(scenario);
      } catch (err) {
        console.error('Failed to duplicate scenario:', err);
        res.status(500).json({ error: 'Failed to duplicate scenario' });
      }
    });

    app.delete('/api/lakebase/scenarios/:id', async (req, res) => {
      try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
          res.status(400).json({ error: 'Invalid id' });
          return;
        }
        const result = await dbForRequest(req).query(
          'DELETE FROM app.scenarios WHERE id = $1 RETURNING id',
          [id],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Scenario not found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error('Failed to delete scenario:', err);
        res.status(500).json({ error: 'Failed to delete scenario' });
      }
    });
  });
}
