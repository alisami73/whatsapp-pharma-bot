-- AMMPS Regulatory Actions table
-- Run this once in the Supabase SQL editor: https://supabase.com/dashboard/project/zefeutnibvynqmrchbjj/sql

CREATE TABLE IF NOT EXISTS ammps_actions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type       TEXT        NOT NULL CHECK (action_type IN ('recall', 'warning')),
  status            TEXT        NOT NULL DEFAULT 'published'
                                CHECK (status IN ('draft', 'published', 'archived')),

  -- Common
  title             TEXT        NOT NULL,
  geographic_scope  TEXT        DEFAULT 'national',
  created_by_name   TEXT,
  created_by_id     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Recall-specific (action_type = 'recall')
  product_name      TEXT,
  batch_number      TEXT,
  lab_name          TEXT,
  recall_date       DATE,
  recall_reason     TEXT,

  -- Warning-specific (action_type = 'warning')
  reference_number  TEXT,
  warning_content   TEXT,
  effective_date    DATE
);

ALTER TABLE ammps_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"   ON ammps_actions FOR ALL     TO service_role  USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON ammps_actions FOR SELECT  TO authenticated USING (true);
