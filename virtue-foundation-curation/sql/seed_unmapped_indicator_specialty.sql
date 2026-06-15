-- Map unmapped NFHS indicators to supply specialty categories (best-effort keyword rules).
-- Replace ${TARGET} with e.g. dais_2026.hackathon.

INSERT INTO ${TARGET}.health_indicator_specialty (indicator_key, specialty_category)
SELECT
  hi.indicator_key,
  CASE
    -- Pediatrics & child health (before endocrine — child growth metrics contain overweight/stunted/etc.)
    WHEN hi.indicator_key RLIKE '^(child_|children_|prev_diarrhoea_2wk_child|total_child_)' THEN 'Pediatrics & Child Health'
    WHEN hi.indicator_key RLIKE '(child_u5|child_6_|child_9_|child_12_|child_24_|breastfeed|breastfed|breastfeeding|vaccinat|vaccine|penta|polio|rotavirus|bcg|mcv|diarrhoea|diarrhea)' THEN 'Pediatrics & Child Health'
    -- Cardiovascular
    WHEN hi.indicator_key RLIKE '(_bp_|blood_pressure|high_bp)' THEN 'Cardiovascular Care'
    -- Endocrine & metabolic
    WHEN hi.indicator_key RLIKE '(blood_sugar|bmi|overweight|obese|underweight|whr)' THEN 'Endocrine & Metabolic Care'
  -- Cancer screening
    WHEN hi.indicator_key RLIKE '(breast_exam|cervical_screen|oral_cancer)' THEN 'Cancer Care (Oncology)'
  -- Respiratory
    WHEN hi.indicator_key RLIKE '(respiratory_infection|_ari_|fever_or_symptoms_of_ari)' THEN 'Respiratory & Pulmonary Care'
  -- Women's health (maternal, reproductive, FP)
    WHEN hi.indicator_key RLIKE '(^fp_|family_planning|unmet_spacing|unmet_total|pregnant_|mothers_|mother_|anc_visit|pnc_from|mcp_card|institutional_birth|home_birth|delivery|births_|csection|sex_ratio|menstrual_hygiene|w15_19_who_were_already_mothers|w20_24_married|registered_pregnancies)' THEN 'Women's Health'
    WHEN hi.indicator_key RLIKE 'average_out_of_pocket_expenditure_per_delivery' THEN 'Women's Health'
  -- Mental / behavioral (substance use)
    WHEN hi.indicator_key RLIKE '(alcohol|tobacco)' THEN 'Mental Health & Behavioral Health'
  -- Primary care / general population health
    WHEN hi.indicator_key RLIKE '(anaemic|anaemia|literacy|schooled|schooling|hh_|household|population_below|deaths_in_the_last|civil_reg|iodized_salt|health_insurance|health_worker)' THEN 'Primary Care & General Medicine'
    WHEN hi.indicator_key RLIKE 'current_users_ever_told_about_side_effects' THEN 'Primary Care & General Medicine'
    ELSE 'Primary Care & General Medicine'
  END AS specialty_category
FROM (SELECT DISTINCT indicator_key FROM ${TARGET}.health_indicator) hi
LEFT JOIN ${TARGET}.health_indicator_specialty his ON hi.indicator_key = his.indicator_key
WHERE his.indicator_key IS NULL;
