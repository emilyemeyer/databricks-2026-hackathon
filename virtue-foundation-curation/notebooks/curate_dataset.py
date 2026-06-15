# Databricks notebook source
# MAGIC %md
# MAGIC # Virtue Foundation — 5-table data model
# MAGIC
# MAGIC Writes to `dais_2026.hackathon`:
# MAGIC - **facility** — cleaned facilities (refreshed each run)
# MAGIC - **health_indicator** — pivoted NFHS indicators (refreshed each run)
# MAGIC - **specialty_category_mapping** — existing; not modified
# MAGIC - **facility_specialty** — seeded once; app-editable thereafter
# MAGIC - **health_indicator_specialty** — seeded once; app-editable thereafter
# MAGIC - **dq_metrics** — refreshed each run (quality scorecard)
# MAGIC - **dq_gap** — refreshed each run; preserves user dismiss/resolve status

# COMMAND ----------

dbutils.widgets.text("raw_catalog", "databricks_virtue_foundation_dataset_dais_2026")
dbutils.widgets.text("raw_schema", "virtue_foundation_dataset")
dbutils.widgets.text("target_catalog", "dais_2026")
dbutils.widgets.text("target_schema", "hackathon")

RAW = f"{dbutils.widgets.get('raw_catalog')}.{dbutils.widgets.get('raw_schema')}"
TARGET = f"{dbutils.widgets.get('target_catalog')}.{dbutils.widgets.get('target_schema')}"

print(f"Raw: {RAW}")
print(f"Target: {TARGET}")

# COMMAND ----------

import os
from pyspark.sql import functions as F

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {TARGET}")

# Drop legacy tables from the previous model
LEGACY_TABLES = [
    "agg_district_supply",
    "agg_district_supply_demand_gap",
    "bridge_pincode_district",
    "dim_facility",
    "dim_facility_capability",
    "dim_facility_category",
    "dim_facility_duplicates",
    "dim_facility_specialty",
    "dim_facility_staging",
    "dim_geography",
    "dq_facility_profile",
    "dq_join_coverage",
    "fact_nfhs_district_indicators",
    "ref_district_aliases",
    "ref_operator_type",
    "ref_specialty_category_mapping",
    "ref_state_ut",
    "stg_facilities",
    "stg_nfhs_indicators",
    "stg_pincode_directory",
]
for table in LEGACY_TABLES:
    spark.sql(f"DROP TABLE IF EXISTS {TARGET}.{table}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Inline reference data (not persisted)

# COMMAND ----------

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(notebook_path))
ref_base = f"/Workspace{bundle_root}/data/reference"

ref_state_ut = (
    spark.read.option("header", True).csv(f"{ref_base}/ref_state_ut.csv")
    .dropDuplicates(["alias"])
)
ref_district_aliases = spark.read.option("header", True).csv(f"{ref_base}/ref_district_aliases.csv")
ref_state_ut.createOrReplaceTempView("ref_state_ut")
ref_district_aliases.createOrReplaceTempView("ref_district_aliases")

spark.sql("""
CREATE OR REPLACE TEMP VIEW ref_pincode_district AS
WITH pincode_stats AS (
  SELECT
    CAST(pincode AS STRING) AS pincode,
    TRIM(district) AS district_raw,
    TRIM(statename) AS state_raw,
    COUNT(*) AS rows_per_pincode,
    COUNT(DISTINCT TRIM(district)) AS districts_per_pincode
  FROM """ + RAW + """.india_post_pincode_directory
  WHERE pincode IS NOT NULL
  GROUP BY CAST(pincode AS STRING), TRIM(district), TRIM(statename)
),
normalized AS (
  SELECT
    p.pincode,
    p.district_raw,
    p.state_raw,
    ps.rows_per_pincode,
    ps.districts_per_pincode,
    COALESCE(rs.canonical_state_ut, INITCAP(LOWER(p.state_raw))) AS state_ut,
    COALESCE(da.canonical_district, p.district_raw) AS district_name
  FROM (
    SELECT DISTINCT CAST(pincode AS STRING) AS pincode, TRIM(district) AS district_raw, TRIM(statename) AS state_raw
    FROM """ + RAW + """.india_post_pincode_directory
    WHERE pincode IS NOT NULL
  ) p
  INNER JOIN pincode_stats ps
    ON p.pincode = ps.pincode AND p.district_raw = ps.district_raw AND p.state_raw = ps.state_raw
  LEFT JOIN ref_state_ut rs ON UPPER(TRIM(p.state_raw)) = UPPER(TRIM(rs.alias))
  LEFT JOIN ref_district_aliases da
    ON UPPER(TRIM(p.district_raw)) = UPPER(TRIM(da.alias))
    AND COALESCE(rs.canonical_state_ut, INITCAP(LOWER(p.state_raw))) = da.canonical_state_ut
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY pincode
      ORDER BY district_name, state_ut, district_raw
    ) AS rn
  FROM normalized
)
SELECT
  pincode,
  district_name,
  state_ut,
  districts_per_pincode > 1 AS pincode_is_ambiguous
FROM ranked
WHERE rn = 1
""")

spark.sql("""
CREATE OR REPLACE TEMP VIEW ref_geography AS
SELECT DISTINCT
  md5(concat_ws('|', TRIM(district_name), COALESCE(rs.canonical_state_ut, TRIM(state_ut)))) AS district_id,
  TRIM(district_name) AS district_name,
  COALESCE(rs.canonical_state_ut, TRIM(state_ut)) AS state_ut
FROM """ + RAW + """.nfhs_5_district_health_indicators n
LEFT JOIN ref_state_ut rs ON TRIM(n.state_ut) = rs.alias
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ## facility

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE TABLE {TARGET}.facility AS
WITH base AS (
  SELECT
    TRIM(f.unique_id) AS facility_id,
    TRIM(f.name) AS facility_name,
    TRIM(f.address_stateOrRegion) AS state_ut_raw,
    CASE
      WHEN f.address_zipOrPostcode RLIKE '^[1-9][0-9]{{5}}$' THEN TRIM(f.address_zipOrPostcode)
      WHEN REGEXP_REPLACE(TRIM(f.address_zipOrPostcode), '[^0-9]', '') RLIKE '^[1-9][0-9]{{5}}$'
        THEN LPAD(REGEXP_REPLACE(TRIM(f.address_zipOrPostcode), '[^0-9]', ''), 6, '0')
      ELSE NULL
    END AS pincode,
    TRIM(f.operatorTypeId) AS operator_type_raw,
    CASE
      WHEN LOWER(TRIM(f.operatorTypeId)) IN ('public', 'government') THEN 'public'
      WHEN LOWER(TRIM(f.operatorTypeId)) = 'private' THEN 'private'
      ELSE 'unknown'
    END AS operator_type,
    TRY_CAST(REGEXP_REPLACE(f.numberDoctors, '[^0-9.]', '') AS INT) AS doctors_count,
    TRY_CAST(REGEXP_REPLACE(f.capacity, '[^0-9.]', '') AS INT) AS bed_count,
    CASE
      WHEN f.latitude BETWEEN 6 AND 38 AND f.longitude BETWEEN 68 AND 98 THEN f.latitude
      WHEN f.longitude BETWEEN 6 AND 38 AND f.latitude BETWEEN 68 AND 98 THEN f.longitude
      ELSE NULL
    END AS lat,
    CASE
      WHEN f.latitude BETWEEN 6 AND 38 AND f.longitude BETWEEN 68 AND 98 THEN f.longitude
      WHEN f.longitude BETWEEN 6 AND 38 AND f.latitude BETWEEN 68 AND 98 THEN f.latitude
      ELSE NULL
    END AS lon,
    CASE
      WHEN f.latitude BETWEEN 6 AND 38 AND f.longitude BETWEEN 68 AND 98 THEN true
      WHEN f.longitude BETWEEN 6 AND 38 AND f.latitude BETWEEN 68 AND 98 THEN true
      ELSE false
    END AS coord_valid,
    TRIM(f.facilityTypeId) AS facility_type,
    TRIM(f.specialties) AS specialties_raw,
    TRIM(f.cluster_id) AS cluster_id,
    (
      CASE WHEN f.name IS NOT NULL AND TRIM(f.name) != '' THEN 1 ELSE 0 END +
      CASE WHEN f.operatorTypeId IS NOT NULL AND TRIM(f.operatorTypeId) NOT IN ('', 'null') THEN 1 ELSE 0 END +
      CASE WHEN f.numberDoctors IS NOT NULL AND TRIM(f.numberDoctors) NOT IN ('', 'null') THEN 1 ELSE 0 END +
      CASE WHEN f.capacity IS NOT NULL AND TRIM(f.capacity) NOT IN ('', 'null') THEN 1 ELSE 0 END +
      CASE WHEN f.address_zipOrPostcode IS NOT NULL AND TRIM(f.address_zipOrPostcode) NOT IN ('', 'null') THEN 1 ELSE 0 END +
      CASE WHEN f.latitude IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN f.longitude IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN f.specialties IS NOT NULL AND TRIM(f.specialties) NOT IN ('', 'null') THEN 1 ELSE 0 END
    ) AS completeness_score
  FROM {RAW}.facilities f
),
with_geo AS (
  SELECT
    b.*,
    g.district_id,
    g.district_name,
    g.state_ut,
    CASE
      WHEN g.district_id IS NOT NULL AND NOT COALESCE(p.pincode_is_ambiguous, false) THEN 'high'
      WHEN g.district_id IS NOT NULL THEN 'medium'
      WHEN rs.canonical_state_ut IS NOT NULL THEN 'low'
      ELSE 'unmatched'
    END AS join_confidence
  FROM base b
  LEFT JOIN ref_pincode_district p ON b.pincode = p.pincode
  LEFT JOIN ref_state_ut rs ON TRIM(b.state_ut_raw) = rs.alias
  LEFT JOIN ref_geography g
    ON UPPER(TRIM(COALESCE(p.district_name, ''))) = UPPER(TRIM(g.district_name))
    AND COALESCE(p.state_ut, rs.canonical_state_ut) = g.state_ut
),
deduped AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(cluster_id), ''), facility_id)
      ORDER BY completeness_score DESC, facility_id
    ) AS rn
  FROM with_geo
)
SELECT
  facility_id,
  facility_name,
  state_ut_raw,
  state_ut,
  district_id,
  district_name,
  pincode,
  operator_type_raw,
  operator_type,
  doctors_count,
  bed_count,
  lat,
  lon,
  coord_valid,
  facility_type,
  specialties_raw,
  join_confidence
FROM deduped
WHERE rn = 1
""")

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {TARGET}.facility_correction (
  facility_id STRING NOT NULL,
  facility_name STRING,
  pincode STRING,
  operator_type STRING,
  facility_type STRING,
  doctors_count INT,
  bed_count INT,
  specialties_raw STRING,
  state_ut STRING,
  district_name STRING,
  updated_at TIMESTAMP
)
USING DELTA
""")

spark.sql(f"""
MERGE INTO {TARGET}.facility AS f
USING {TARGET}.facility_correction AS c
ON f.facility_id = c.facility_id
WHEN MATCHED THEN UPDATE SET
  facility_name = COALESCE(c.facility_name, f.facility_name),
  pincode = COALESCE(c.pincode, f.pincode),
  operator_type = COALESCE(c.operator_type, f.operator_type),
  operator_type_raw = COALESCE(c.operator_type, f.operator_type_raw),
  facility_type = COALESCE(c.facility_type, f.facility_type),
  doctors_count = COALESCE(c.doctors_count, f.doctors_count),
  bed_count = COALESCE(c.bed_count, f.bed_count),
  specialties_raw = COALESCE(c.specialties_raw, f.specialties_raw),
  state_ut = COALESCE(c.state_ut, f.state_ut),
  district_name = COALESCE(c.district_name, f.district_name)
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ## health_indicator (pivoted / long format)

# COMMAND ----------

nfhs_raw = spark.table(f"{RAW}.nfhs_5_district_health_indicators")
nfhs_cols = [f"n.`{c}`" for c in nfhs_raw.columns if c not in ("district_name", "state_ut")]

nfhs_base = spark.sql(f"""
SELECT
  md5(concat_ws('|', TRIM(n.district_name), COALESCE(rs.canonical_state_ut, TRIM(n.state_ut)))) AS district_id,
  TRIM(n.district_name) AS district_name,
  COALESCE(rs.canonical_state_ut, TRIM(n.state_ut)) AS state_ut,
  {', '.join(nfhs_cols)}
FROM {RAW}.nfhs_5_district_health_indicators n
LEFT JOIN ref_state_ut rs ON TRIM(n.state_ut) = rs.alias
""")

meta_cols = {
    "district_id",
    "district_name",
    "state_ut",
    "households_surveyed",
    "women_15_49_interviewed",
    "men_15_54_interviewed",
}
indicator_cols = [c for c in nfhs_base.columns if c not in meta_cols]

frames = []
for col_name in indicator_cols:
    dtype = dict(nfhs_base.dtypes)[col_name]
    raw_col = F.col(f"`{col_name}`")
    if dtype == "string":
        value_expr = F.when(F.trim(raw_col) == "*", F.lit(None).cast("double")).otherwise(
            F.expr(f"try_cast(regexp_replace(trim(`{col_name}`), '[()]', '') as double)")
        )
        suppressed_expr = F.trim(raw_col) == "*"
    else:
        value_expr = raw_col.cast("double")
        suppressed_expr = F.lit(False)

    frames.append(
        nfhs_base.select(
            F.col("district_id"),
            F.col("district_name"),
            F.col("state_ut"),
            F.lit(col_name).alias("indicator_key"),
            value_expr.alias("indicator_value"),
            suppressed_expr.alias("is_suppressed"),
            raw_col.cast("string").alias("indicator_raw"),
        )
    )

health_indicator = frames[0]
for frame in frames[1:]:
    health_indicator = health_indicator.unionByName(frame)

health_indicator.write.format("delta").mode("overwrite").saveAsTable(f"{TARGET}.health_indicator")
print(f"Wrote {TARGET}.health_indicator ({health_indicator.count()} rows)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Editable mapping tables (seed only when empty)

# COMMAND ----------

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {TARGET}.facility_specialty (
  facility_id STRING NOT NULL,
  specialty STRING NOT NULL
)
USING DELTA
""")

facility_specialty_count = spark.table(f"{TARGET}.facility_specialty").count()
if facility_specialty_count == 0:
    spark.sql(f"""
    INSERT INTO {TARGET}.facility_specialty
    SELECT DISTINCT
      f.facility_id,
      specialty
    FROM {TARGET}.facility f
    LATERAL VIEW explode(
      CASE
        WHEN f.specialties_raw IS NOT NULL AND f.specialties_raw LIKE '[%'
        THEN from_json(f.specialties_raw, 'ARRAY<STRING>')
        ELSE array()
      END
    ) t AS specialty
    WHERE specialty IS NOT NULL AND TRIM(specialty) != ''
    """)
    print(f"Seeded {TARGET}.facility_specialty")
else:
    print(f"Skipped seeding {TARGET}.facility_specialty ({facility_specialty_count} existing rows)")

spark.sql(f"""
UPDATE {TARGET}.facility_specialty
SET specialty = regexp_extract(specialty, '"([^"]+)"\\s*:\\s*"\\1"', 1)
WHERE specialty RLIKE '^\\\\{{.*\\\\}}$'
  AND regexp_extract(specialty, '"([^"]+)"\\s*:\\s*"\\1"', 1) != ''
""")

# COMMAND ----------

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {TARGET}.health_indicator_specialty (
  indicator_key STRING NOT NULL,
  specialty_category STRING NOT NULL
)
USING DELTA
""")

indicator_specialty_count = spark.table(f"{TARGET}.health_indicator_specialty").count()
if indicator_specialty_count == 0:
    seed_rows = [
        ("w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct", "Cardiovascular Care"),
        ("w15_plus_with_mildly_high_bp_sys_140_159_mmhg_and_or_dia_90_pct", "Cardiovascular Care"),
        ("w15_plus_with_moderately_or_severely_high_bp_sys_gte_160_mm_pct", "Cardiovascular Care"),
        ("m15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct", "Cardiovascular Care"),
        ("w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct", "Endocrine & Metabolic Care"),
        ("women_age_15_years_and_above_with_high_141_160_mg_dl_blood_pct", "Endocrine & Metabolic Care"),
        ("w15_plus_with_very_high_gt_160_mg_dl_blood_sugar_pct", "Endocrine & Metabolic Care"),
        ("m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct", "Endocrine & Metabolic Care"),
        ("non_pregnant_w15_49_who_are_anaemic_lt_12_0_g_dl_22_pct", "Primary Care & General Medicine"),
        ("all_w15_49_who_are_anaemic_pct", "Primary Care & General Medicine"),
        ("child_12_23m_fully_vaccinated_based_on_information_from_vax_pct", "Pediatrics & Child Health"),
    ]
    seed_df = spark.createDataFrame(seed_rows, ["indicator_key", "specialty_category"])
    seed_df.write.format("delta").mode("append").saveAsTable(f"{TARGET}.health_indicator_specialty")
    print(f"Seeded {TARGET}.health_indicator_specialty")
else:
    print(f"Skipped seeding {TARGET}.health_indicator_specialty ({indicator_specialty_count} existing rows)")

# Fix known bad seed key if present from an earlier run.
spark.sql(f"""
UPDATE {TARGET}.health_indicator_specialty
SET indicator_key = 'women_age_15_years_and_above_with_high_141_160_mg_dl_blood_pct'
WHERE indicator_key = 'w15_plus_with_high_141_160_mg_dl_blood_pct'
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Strip markdown wrappers from specialty strings (*__, **, etc.)

# COMMAND ----------

markup_sql_path = f"/Workspace{bundle_root}/sql/clean_specialty_markup.sql"
with open(markup_sql_path, encoding="utf-8") as markup_file:
    markup_sql = markup_file.read().replace("${TARGET}", TARGET)

for statement in [part.strip() for part in markup_sql.split(";") if part.strip()]:
    spark.sql(statement)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Correct specialty typos (opthalmology, gastroentrology, etc.)

# COMMAND ----------

typo_sql_path = f"/Workspace{bundle_root}/sql/correct_specialty_typos.sql"
with open(typo_sql_path, encoding="utf-8") as typo_file:
    typo_sql = typo_file.read().replace("${TARGET}", TARGET)

for statement in [part.strip() for part in typo_sql.split(";") if part.strip()]:
    spark.sql(statement)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Normalize specialty spelling (case variants)

# COMMAND ----------

normalize_sql_path = f"/Workspace{bundle_root}/sql/normalize_specialties.sql"
with open(normalize_sql_path, encoding="utf-8") as normalize_file:
    normalize_sql = normalize_file.read().replace("${TARGET}", TARGET)

for statement in [part.strip() for part in normalize_sql.split(";") if part.strip()]:
    spark.sql(statement)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Map unmapped health indicators to specialty categories

# COMMAND ----------

unmap_sql_path = f"/Workspace{bundle_root}/sql/seed_unmapped_indicator_specialty.sql"
with open(unmap_sql_path, encoding="utf-8") as unmap_file:
    unmap_sql = unmap_file.read().replace("${TARGET}", TARGET)

for statement in [part.strip() for part in unmap_sql.split(";") if part.strip()]:
    spark.sql(statement)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Sync facility_specialty from specialties_raw (backfill parseable values)

# COMMAND ----------

sync_fs_sql_path = f"/Workspace{bundle_root}/sql/sync_facility_specialty_from_raw.sql"
with open(sync_fs_sql_path, encoding="utf-8") as sync_fs_file:
    sync_fs_sql = sync_fs_file.read().replace("${TARGET}", TARGET)

for statement in [part.strip() for part in sync_fs_sql.split(";") if part.strip()]:
    spark.sql(statement)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Data quality metrics and actionable gaps

# COMMAND ----------

dq_sql_path = f"/Workspace{bundle_root}/sql/build_dq_tables.sql"
with open(dq_sql_path, encoding="utf-8") as dq_file:
    dq_sql = dq_file.read().replace("${TARGET}", TARGET)

for statement in [part.strip() for part in dq_sql.split(";") if part.strip()]:
    spark.sql(statement)

dq_summary = spark.sql(f"""
SELECT
  (SELECT COUNT(*) FROM {TARGET}.dq_metrics) AS metric_count,
  (SELECT COUNT(*) FROM {TARGET}.dq_gap WHERE status = 'open') AS open_gaps,
  (SELECT COUNT(*) FROM {TARGET}.dq_gap WHERE status = 'dismissed') AS dismissed_gaps
""")
display(dq_summary)

# COMMAND ----------

summary = spark.sql(f"""
SELECT 'facility' AS table_name, COUNT(*) AS row_count FROM {TARGET}.facility
UNION ALL SELECT 'health_indicator', COUNT(*) FROM {TARGET}.health_indicator
UNION ALL SELECT 'specialty_category_mapping', COUNT(*) FROM {TARGET}.specialty_category_mapping
UNION ALL SELECT 'facility_specialty', COUNT(*) FROM {TARGET}.facility_specialty
UNION ALL SELECT 'health_indicator_specialty', COUNT(*) FROM {TARGET}.health_indicator_specialty
UNION ALL SELECT 'dq_metrics', COUNT(*) FROM {TARGET}.dq_metrics
UNION ALL SELECT 'dq_gap', COUNT(*) FROM {TARGET}.dq_gap
ORDER BY table_name
""")
display(summary)

print("Curation complete.")
