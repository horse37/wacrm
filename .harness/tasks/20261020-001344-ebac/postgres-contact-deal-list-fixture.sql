CREATE ROLE wacrm_contact_deals_runtime
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
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL
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

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id)
);

CREATE TABLE public.pipelines (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  created_at timestamptz
);

CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY,
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id),
  name text NOT NULL,
  position integer NOT NULL,
  color text NOT NULL,
  created_at timestamptz
);

CREATE TABLE public.deals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id),
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid,
  assigned_to uuid,
  title text NOT NULL,
  value numeric(12, 2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  notes text,
  expected_close_date date,
  status text CHECK (status IN ('open', 'won', 'lost')),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_contact_deals_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_contact_deals_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_contact_deals_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY pipelines_select_members
  ON public.pipelines FOR SELECT TO wacrm_contact_deals_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY stages_select_members
  ON public.pipeline_stages FOR SELECT TO wacrm_contact_deals_runtime
  USING (
    EXISTS (
      SELECT 1 FROM public.pipelines AS p
      WHERE p.id = pipeline_stages.pipeline_id
        AND public.is_account_member(p.account_id)
    )
  );
CREATE POLICY deals_select_members
  ON public.deals FOR SELECT TO wacrm_contact_deals_runtime
  USING (public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_contact_deals_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_contact_deals_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_contact_deals_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles, public.contacts,
  public.pipelines, public.pipeline_stages, public.deals
  TO wacrm_contact_deals_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'Synthetic Account C', '00000000-0000-4000-8000-000000000004');

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'admin');

INSERT INTO public.contacts (id, user_id, account_id) VALUES
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

INSERT INTO public.pipelines (id, user_id, account_id, name, created_at) VALUES
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Pipeline A', '2026-10-18 10:00:00+00'),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Pipeline B', '2026-10-18 10:00:00+00');

INSERT INTO public.pipeline_stages (id, pipeline_id, name, position, color, created_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Stage A', 1, '#123456', '2026-10-18 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'Stage B', 1, '#654321', '2026-10-18 10:00:00+00');

INSERT INTO public.deals
  (id, user_id, account_id, pipeline_id, stage_id, contact_id, conversation_id, assigned_to,
   title, value, currency, notes, expected_close_date, status, created_at, updated_at)
VALUES
  ('90000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', NULL, NULL, 'Synthetic deal A1', 100.00, 'USD', 'First synthetic deal', '2026-12-01', 'open', '2026-10-18 12:00:00+00', '2026-10-18 12:30:00+00'),
  ('90000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic deal A2', 123.45, 'CAD', NULL, '2026-11-30', 'won', '2026-10-18 12:00:00+00', NULL),
  ('90000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', NULL, NULL, 'Synthetic deal A3', 0.00, NULL, NULL, NULL, NULL, '2026-10-18 11:00:00+00', NULL),
  ('90000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', NULL, NULL, 'Cross-account contact deal', 1.00, 'USD', NULL, NULL, 'open', '2026-10-18 14:00:00+00', NULL),
  ('90000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', NULL, NULL, 'Cross-account pipeline deal', 2.00, 'USD', NULL, NULL, 'open', '2026-10-18 15:00:00+00', NULL),
  ('90000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', NULL, NULL, 'Mismatched stage deal', 3.00, 'USD', NULL, NULL, 'open', '2026-10-18 16:00:00+00', NULL),
  ('90000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003', NULL, NULL, 'Synthetic deal B1', 200.00, 'USD', NULL, NULL, 'open', '2026-10-18 13:00:00+00', NULL);
