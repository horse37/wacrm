CREATE ROLE wacrm_automation_claim_job
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE TABLE public.automation_pending_executions (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  contact_id uuid,
  log_id uuid,
  parent_step_id uuid,
  branch text CHECK (branch IN ('yes', 'no')),
  next_step_position integer NOT NULL CHECK (next_step_position >= 0),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  private_payload text NOT NULL DEFAULT 'SYNTHETIC_PRIVATE_PAYLOAD'
);

ALTER TABLE public.automation_pending_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_pending_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_pending_claim_select
  ON public.automation_pending_executions
  FOR SELECT TO wacrm_automation_claim_job
  USING (true);

CREATE POLICY automation_pending_claim_update
  ON public.automation_pending_executions
  FOR UPDATE TO wacrm_automation_claim_job
  USING (status = 'pending')
  WITH CHECK (status = 'running');

GRANT USAGE ON SCHEMA public TO wacrm_automation_claim_job;
GRANT SELECT ON TABLE public.automation_pending_executions
  TO wacrm_automation_claim_job;
GRANT UPDATE (status) ON TABLE public.automation_pending_executions
  TO wacrm_automation_claim_job;

INSERT INTO public.automation_pending_executions (
  id, automation_id, account_id, user_id, contact_id, log_id,
  parent_step_id, branch, next_step_position, context, status, run_at
) VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, 0, '{"vars":{"batch":1}}', 'pending', '2026-10-20T09:00:00Z'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'yes', 4, '{"message_text":"Synthetic fixture"}', 'pending', '2026-10-20T09:00:00Z'),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', NULL, NULL, NULL, 'no', 2, '{}', 'pending', '2026-10-20T10:00:00Z'),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, 8, '{}', 'pending', '2026-10-20T12:00:00Z'),
  ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, 9, '{}', 'running', '2026-10-20T08:00:00Z'),
  ('40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, 10, '{}', 'pending', '2026-10-20T15:00:00Z'),
  ('40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, 11, '{}', 'pending', '2026-10-20T11:00:00Z');

INSERT INTO public.automation_pending_executions (
  id, automation_id, account_id, user_id, next_step_position, status, run_at
)
SELECT
  ('40000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  1,
  'pending',
  '2026-10-20T13:30:00Z'
FROM generate_series(101, 110) AS value;
