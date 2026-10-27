CREATE ROLE wacrm_automation_logs_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE public.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_user_id uuid NOT NULL
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL,
  full_name text NOT NULL
);

CREATE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role public.account_role_enum DEFAULT 'viewer'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'agent' THEN 2
        WHEN 'viewer' THEN 1
      END >= CASE min_role
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'agent' THEN 2
        WHEN 'viewer' THEN 1
      END
  )
$$;

CREATE TABLE public.automations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  execution_count integer NOT NULL DEFAULT 0,
  last_executed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text,
  phone text NOT NULL,
  email text,
  company text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  trigger_event text NOT NULL,
  steps_executed jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_automation_logs_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_automation_logs_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY automations_select_members
  ON public.automations FOR SELECT TO wacrm_automation_logs_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_automation_logs_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY automation_logs_select_members
  ON public.automation_logs FOR SELECT TO wacrm_automation_logs_runtime
  USING (public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_automation_logs_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_automation_logs_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_automation_logs_runtime;
GRANT SELECT (id, name) ON public.accounts TO wacrm_automation_logs_runtime;
GRANT SELECT (user_id, account_id, account_role) ON public.profiles
  TO wacrm_automation_logs_runtime;
GRANT SELECT (id, user_id, account_id, name) ON public.automations
  TO wacrm_automation_logs_runtime;
GRANT SELECT (
  id, automation_id, user_id, account_id, contact_id, trigger_event,
  steps_executed, status, error_message, created_at
) ON public.automation_logs TO wacrm_automation_logs_runtime;
GRANT SELECT (id, account_id, name, phone) ON public.contacts
  TO wacrm_automation_logs_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'Synthetic Account C', '00000000-0000-4000-8000-000000000004');

INSERT INTO public.profiles (id, user_id, account_id, account_role, full_name) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'Synthetic Owner A'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'agent', 'Synthetic Agent A'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B'),
('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'admin', 'Synthetic Admin C'),
('20000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000003', 'owner', 'Former Member A');

INSERT INTO public.automations (
  id, user_id, account_id, name, description, trigger_type, trigger_config,
  is_active, execution_count, last_executed_at, created_at, updated_at
) VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Synthetic automation A', NULL, 'new_message_received',
    '{"secret":"SYNTHETIC_AUTOMATION_CONFIG_MUST_NOT_LEAK"}',
    true, 3, NULL, '2026-10-19 10:00:00+00', '2026-10-19 10:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Synthetic automation B', NULL, 'keyword_match', '{}',
    true, 1, NULL, '2026-10-18 10:00:00+00', '2026-10-18 10:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    'Former member automation', NULL, 'keyword_match', '{}',
    true, 1, NULL, '2026-10-20 10:00:00+00', '2026-10-20 10:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003',
    'Synthetic automation C', NULL, 'new_contact_created', '{}',
    false, 0, NULL, '2026-10-17 10:00:00+00', '2026-10-17 10:00:00+00'
  );

INSERT INTO public.contacts (id, user_id, account_id, name, phone, email, company) VALUES
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic Contact A', '+15555550123', 'synthetic-a@example.invalid', 'Synthetic A'),
  ('60000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Synthetic Contact B', '+15555550124', 'synthetic-b@example.invalid', 'Synthetic B');

INSERT INTO public.automation_logs (
  id, automation_id, user_id, account_id, contact_id, trigger_event,
  steps_executed, status, error_message, created_at
) VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'new_message_received',
    '[{"step_id":"50000000-0000-4000-8000-000000000001","step_type":"send_message","status":"success","detail":"Synthetic delivery"},{"step_id":"50000000-0000-4000-8000-000000000002","step_type":"condition","status":"skipped"}]',
    'partial', NULL, '2026-10-20 10:00:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    NULL, 'keyword_match', '[]', 'failed', 'Synthetic failure',
    '2026-10-20 10:00:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'foreign_log_author', '[]', 'success', NULL,
    '2026-10-19 12:00:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    NULL, 'former_member_event', '[]', 'success', NULL,
    '2026-10-19 11:00:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',
    'account_b_event', '[]', 'success', NULL,
    '2026-10-20 11:00:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'foreign_contact', '[]', 'success', NULL,
    '2026-10-19 10:00:00+00'
  );

INSERT INTO public.automation_logs (
  id, automation_id, user_id, account_id, contact_id, trigger_event,
  steps_executed, status, error_message, created_at
)
SELECT
  ('45000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '30000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  NULL,
  'synthetic_generated_event',
  '[]'::jsonb,
  'success',
  NULL,
  '2026-10-01 00:00:00+00'::timestamptz + sequence * interval '1 minute'
FROM generate_series(1, 101) AS generated(sequence);
