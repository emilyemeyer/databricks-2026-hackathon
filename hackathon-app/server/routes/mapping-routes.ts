import { z } from 'zod';
import type { Application } from 'express';
import { getWorkspaceClient } from '@databricks/appkit';
import {
  FacilityFieldUpdateBody,
  buildFacilityCorrectionMerge,
  buildFacilityFieldUpdate,
  buildFacilitySpecialtyResync,
  isFacilityEditableField,
  normalizeFacilityFieldValue,
  validateFacilityFieldValue,
} from './facility-corrections';
import { refreshDqSnapshot } from './dq-refresh';
import { suggestFacilitySpecialty } from './suggest-specialty';

const SCHEMA = 'dais_2026.hackathon';

interface AppKitWithServer {
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const FacilitySpecialtyBody = z.object({
  facility_id: z.string().min(1),
  specialty: z.string().min(1),
});

const HealthIndicatorSpecialtyBody = z.object({
  indicator_key: z.string().min(1),
  specialty_category: z.string().min(1),
});

const SpecialtyCategoryBody = z.object({
  specialty: z.string().min(1),
  category: z.string().min(1),
});

const DqGapStatusBody = z.object({
  gap_id: z.string().min(1),
  status: z.enum(['open', 'resolved', 'dismissed']),
  resolution_notes: z.string().optional(),
});

async function runSql(statement: string): Promise<Record<string, unknown>[]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    throw new Error('DATABRICKS_WAREHOUSE_ID is not configured');
  }

  const client = getWorkspaceClient({});
  const response = await client.statementExecution.executeStatement({
    warehouse_id: warehouseId,
    statement,
    wait_timeout: '30s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  });

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

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

async function resolveFacilityIdFromGap(gapId: string, payloadFacilityId?: string): Promise<string> {
  const rows = await runSql(
    `SELECT entity_type, CAST(entity_key AS STRING) AS entity_key
     FROM ${SCHEMA}.dq_gap
     WHERE gap_id = '${escapeSqlString(gapId.trim())}'`,
  );
  const row = rows[0];
  if (row?.entity_type === 'facility' && row.entity_key) {
    return String(row.entity_key);
  }
  return payloadFacilityId?.trim() ?? '';
}

async function applyFacilityFieldUpdate(payload: Record<string, string>): Promise<void> {
  const parsed = FacilityFieldUpdateBody.safeParse({
    facility_id: payload.facility_id,
    field_name: payload.field_name,
    corrected_value: payload.corrected_value ?? '',
  });
  if (!parsed.success) {
    throw new Error('facility_id, field_name, and corrected_value are required');
  }

  const { facility_id, field_name, corrected_value } = parsed.data;
  if (!isFacilityEditableField(field_name)) {
    throw new Error(`Field ${field_name} cannot be edited`);
  }

  const normalized = normalizeFacilityFieldValue(field_name, corrected_value);
  const validationError = validateFacilityFieldValue(field_name, normalized);
  if (validationError) {
    throw new Error(validationError);
  }

  const exists = await runSql(
    `SELECT COUNT(*) AS n FROM ${SCHEMA}.facility WHERE facility_id = '${escapeSqlString(facility_id.trim())}'`,
  );
  if (Number(exists[0]?.n ?? 0) === 0) {
    throw new Error(`Facility not found: ${facility_id}`);
  }

  await runSql(buildFacilityCorrectionMerge(facility_id, field_name, normalized));
  await runSql(buildFacilityFieldUpdate(facility_id, field_name, normalized));
  if (field_name === 'specialties_raw') {
    await runSql(buildFacilitySpecialtyResync(facility_id));
  }
}

async function afterDqMutation(): Promise<void> {
  await refreshDqSnapshot();
}

export async function setupMappingRoutes(appkit: AppKitWithServer) {
  appkit.server.extend((app) => {
    app.get('/api/mappings/facility-specialty', async (_req, res) => {
      try {
        const rows = await runSql(
          `SELECT facility_id, specialty FROM ${SCHEMA}.facility_specialty ORDER BY facility_id, specialty`,
        );
        res.json(rows);
      } catch (err) {
        console.error('Failed to list facility_specialty:', err);
        res.status(500).json({ error: 'Failed to list facility specialty mappings' });
      }
    });

    app.put('/api/mappings/facility-specialty', async (req, res) => {
      try {
        const parsed = FacilitySpecialtyBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'facility_id and specialty are required' });
          return;
        }
        const { facility_id, specialty } = parsed.data;
        await runSql(
          `MERGE INTO ${SCHEMA}.facility_specialty AS target
           USING (SELECT '${escapeSqlString(facility_id.trim())}' AS facility_id, '${escapeSqlString(specialty.trim())}' AS specialty) AS source
           ON target.facility_id = source.facility_id AND target.specialty = source.specialty
           WHEN NOT MATCHED THEN INSERT (facility_id, specialty) VALUES (source.facility_id, source.specialty)`,
        );
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to upsert facility_specialty:', err);
        res.status(500).json({ error: 'Failed to save facility specialty mapping' });
      }
    });

    app.delete('/api/mappings/facility-specialty', async (req, res) => {
      try {
        const parsed = FacilitySpecialtyBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'facility_id and specialty are required' });
          return;
        }
        const { facility_id, specialty } = parsed.data;
        await runSql(
          `DELETE FROM ${SCHEMA}.facility_specialty
           WHERE facility_id = '${escapeSqlString(facility_id.trim())}'
             AND specialty = '${escapeSqlString(specialty.trim())}'`,
        );
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to delete facility_specialty:', err);
        res.status(500).json({ error: 'Failed to delete facility specialty mapping' });
      }
    });

    app.get('/api/mappings/health-indicator-specialty', async (_req, res) => {
      try {
        const rows = await runSql(
          `SELECT indicator_key, specialty_category FROM ${SCHEMA}.health_indicator_specialty ORDER BY indicator_key, specialty_category`,
        );
        res.json(rows);
      } catch (err) {
        console.error('Failed to list health_indicator_specialty:', err);
        res.status(500).json({ error: 'Failed to list health indicator specialty mappings' });
      }
    });

    app.put('/api/mappings/health-indicator-specialty', async (req, res) => {
      try {
        const parsed = HealthIndicatorSpecialtyBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'indicator_key and specialty_category are required' });
          return;
        }
        const { indicator_key, specialty_category } = parsed.data;
        await runSql(
          `MERGE INTO ${SCHEMA}.health_indicator_specialty AS target
           USING (SELECT '${escapeSqlString(indicator_key.trim())}' AS indicator_key, '${escapeSqlString(specialty_category.trim())}' AS specialty_category) AS source
           ON target.indicator_key = source.indicator_key AND target.specialty_category = source.specialty_category
           WHEN NOT MATCHED THEN INSERT (indicator_key, specialty_category) VALUES (source.indicator_key, source.specialty_category)`,
        );
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to upsert health_indicator_specialty:', err);
        res.status(500).json({ error: 'Failed to save health indicator specialty mapping' });
      }
    });

    app.delete('/api/mappings/health-indicator-specialty', async (req, res) => {
      try {
        const parsed = HealthIndicatorSpecialtyBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'indicator_key and specialty_category are required' });
          return;
        }
        const { indicator_key, specialty_category } = parsed.data;
        await runSql(
          `DELETE FROM ${SCHEMA}.health_indicator_specialty
           WHERE indicator_key = '${escapeSqlString(indicator_key.trim())}'
             AND specialty_category = '${escapeSqlString(specialty_category.trim())}'`,
        );
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to delete health_indicator_specialty:', err);
        res.status(500).json({ error: 'Failed to delete health indicator specialty mapping' });
      }
    });

    app.put('/api/mappings/specialty-category', async (req, res) => {
      try {
        const parsed = SpecialtyCategoryBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'specialty and category are required' });
          return;
        }
        const { specialty, category } = parsed.data;
        await runSql(
          `MERGE INTO ${SCHEMA}.specialty_category_mapping AS target
           USING (SELECT '${escapeSqlString(specialty.trim())}' AS specialties, '${escapeSqlString(category.trim())}' AS category) AS source
           ON target.specialties = source.specialties
           WHEN NOT MATCHED THEN INSERT (specialties, category) VALUES (source.specialties, source.category)`,
        );
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to upsert specialty_category_mapping:', err);
        res.status(500).json({ error: 'Failed to save specialty category mapping' });
      }
    });

    app.put('/api/facility/corrections', async (req, res) => {
      try {
        const parsed = FacilityFieldUpdateBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'facility_id, field_name, and corrected_value are required' });
          return;
        }
        await applyFacilityFieldUpdate({
          facility_id: parsed.data.facility_id,
          field_name: parsed.data.field_name,
          corrected_value: parsed.data.corrected_value,
        });
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to update facility correction:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to update facility',
        });
      }
    });

    app.post('/api/dq/gaps/suggest-specialty', async (req, res) => {
      try {
        const parsed = z.object({ facility_id: z.string().min(1) }).safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'facility_id is required' });
          return;
        }

        const suggestion = await suggestFacilitySpecialty(parsed.data.facility_id);
        res.json(suggestion);
      } catch (err) {
        console.error('Failed to suggest facility specialty:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to suggest specialty',
        });
      }
    });

    app.post('/api/dq/refresh', async (_req, res) => {
      try {
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to refresh dq snapshot:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to refresh data quality metrics',
        });
      }
    });

    app.put('/api/dq/gaps/status', async (req, res) => {
      try {
        const parsed = DqGapStatusBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'gap_id and status are required' });
          return;
        }
        const { gap_id, status, resolution_notes } = parsed.data;
        const notesClause = resolution_notes
          ? `'${escapeSqlString(resolution_notes.trim())}'`
          : 'resolution_notes';
        await runSql(
          `UPDATE ${SCHEMA}.dq_gap
           SET status = '${escapeSqlString(status)}',
               resolution_notes = ${notesClause},
               updated_at = current_timestamp()
           WHERE gap_id = '${escapeSqlString(gap_id.trim())}'`,
        );
        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to update dq_gap status:', err);
        res.status(500).json({ error: 'Failed to update data quality gap status' });
      }
    });

    app.post('/api/dq/gaps/resolve', async (req, res) => {
      try {
        const body = z
          .object({
            gap_id: z.string().min(1),
            fix_action: z.string().min(1),
            payload: z.record(z.string(), z.string()),
          })
          .safeParse(req.body);
        if (!body.success) {
          res.status(400).json({ error: 'gap_id, fix_action, and payload are required' });
          return;
        }

        const { gap_id, fix_action, payload } = body.data;
        const facilityGapId =
          fix_action === 'update_facility_field' || fix_action === 'add_facility_specialty'
            ? await resolveFacilityIdFromGap(gap_id, payload.facility_id)
            : payload.facility_id?.trim() ?? '';

        if (fix_action === 'add_specialty_category_mapping') {
          const specialty = payload.specialty?.trim();
          const category = payload.category?.trim();
          if (!specialty || !category) {
            res.status(400).json({ error: 'specialty and category are required' });
            return;
          }
          await runSql(
            `MERGE INTO ${SCHEMA}.specialty_category_mapping AS target
             USING (SELECT '${escapeSqlString(specialty)}' AS specialties, '${escapeSqlString(category)}' AS category) AS source
             ON target.specialties = source.specialties
             WHEN NOT MATCHED THEN INSERT (specialties, category) VALUES (source.specialties, source.category)`,
          );
        } else if (fix_action === 'add_health_indicator_specialty') {
          const indicatorKey = payload.indicator_key?.trim();
          const specialtyCategory = payload.specialty_category?.trim();
          if (!indicatorKey || !specialtyCategory) {
            res.status(400).json({ error: 'indicator_key and specialty_category are required' });
            return;
          }
          await runSql(
            `MERGE INTO ${SCHEMA}.health_indicator_specialty AS target
             USING (SELECT '${escapeSqlString(indicatorKey)}' AS indicator_key, '${escapeSqlString(specialtyCategory)}' AS specialty_category) AS source
             ON target.indicator_key = source.indicator_key AND target.specialty_category = source.specialty_category
             WHEN NOT MATCHED THEN INSERT (indicator_key, specialty_category) VALUES (source.indicator_key, source.specialty_category)`,
          );
        } else if (fix_action === 'add_facility_specialty') {
          const specialty = payload.specialty?.trim();
          if (!facilityGapId || !specialty) {
            res.status(400).json({ error: 'facility_id and specialty are required' });
            return;
          }
          await applyFacilityFieldUpdate({
            facility_id: facilityGapId,
            field_name: 'specialties_raw',
            corrected_value: specialty,
          });
        } else if (fix_action === 'update_facility_field') {
          await applyFacilityFieldUpdate({
            ...payload,
            facility_id: facilityGapId || payload.facility_id,
          });
        } else if (fix_action === 'delete_health_indicator_specialty') {
          const indicatorKey = payload.indicator_key?.trim();
          const specialtyCategory = payload.specialty_category?.trim();
          if (!indicatorKey || !specialtyCategory) {
            res.status(400).json({ error: 'indicator_key and specialty_category are required' });
            return;
          }
          await runSql(
            `DELETE FROM ${SCHEMA}.health_indicator_specialty
             WHERE indicator_key = '${escapeSqlString(indicatorKey)}'
               AND specialty_category = '${escapeSqlString(specialtyCategory)}'`,
          );
        } else if (fix_action === 'dismiss_only') {
          await runSql(
            `UPDATE ${SCHEMA}.dq_gap
             SET status = 'dismissed',
                 resolution_notes = 'Dismissed by user — not auto-fixable in app',
                 updated_at = current_timestamp()
             WHERE gap_id = '${escapeSqlString(gap_id.trim())}'`,
          );
          await afterDqMutation();
          res.status(204).send();
          return;
        } else {
          res.status(400).json({ error: `Unsupported fix_action: ${fix_action}` });
          return;
        }

        await afterDqMutation();
        res.status(204).send();
      } catch (err) {
        console.error('Failed to resolve dq_gap:', err);
        res.status(500).json({ error: 'Failed to resolve data quality gap' });
      }
    });
  });
}
