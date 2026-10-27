CREATE ROLE wacrm_pipeline_deal_details_update_runtime
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

CREATE TABLE public.pipelines (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY,
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#3b82f6',
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  phone text NOT NULL,
  name text,
  email text,
  company text,
  avatar_url text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE TABLE public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  value numeric(12,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'USD',
  notes text,
  expected_close_date date,
  status text CHECK (status IN ('open', 'won', 'lost')),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END
$$;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_pipeline_deal_details_update_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_pipeline_deal_details_update_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY pipelines_select_members
  ON public.pipelines FOR SELECT TO wacrm_pipeline_deal_details_update_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY pipeline_stages_select_members
  ON public.pipeline_stages FOR SELECT TO wacrm_pipeline_deal_details_update_runtime
  USING (
    EXISTS (
      SELECT 1 FROM public.pipelines AS p
      WHERE p.id = pipeline_id AND public.is_account_member(p.account_id)
    )
  );
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_pipeline_deal_details_update_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY deals_select_members
  ON public.deals FOR SELECT TO wacrm_pipeline_deal_details_update_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY deals_update_agents
  ON public.deals FOR UPDATE TO wacrm_pipeline_deal_details_update_runtime
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

GRANT USAGE ON SCHEMA auth, public TO wacrm_pipeline_deal_details_update_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_pipeline_deal_details_update_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_pipeline_deal_details_update_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles, public.pipelines,
  public.pipeline_stages, public.contacts, public.deals
  TO wacrm_pipeline_deal_details_update_runtime;
GRANT UPDATE (
  title, value, currency, stage_id, contact_id, assigned_to, notes,
  expected_close_date
) ON TABLE public.deals TO wacrm_pipeline_deal_details_update_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'Synthetic Account C', '00000000-0000-4000-8000-000000000004');

INSERT INTO public.profiles (id, user_id, account_id, account_role, full_name) VALUES
  ('90000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'Synthetic Owner A'),
  ('90000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('90000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'agent', 'Synthetic Agent A'),
  ('90000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B'),
  ('90000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'admin', 'Synthetic Admin C');

INSERT INTO public.pipelines (id, user_id, account_id, name, created_at) VALUES
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Pipeline A1', '2026-10-18 10:00:00+00'),
  ('50000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Pipeline A3', '2026-10-18 10:00:00+00'),
  ('50000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Empty pipeline A4', '2026-10-17 10:00:00+00'),
  ('50000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Cross-account creator', '2026-10-18 11:00:00+00'),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Pipeline B1', '2026-10-16 10:00:00+00');

INSERT INTO public.pipeline_stages (id, pipeline_id, name, position, color, created_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Stage A1', 0, '#111111', '2026-10-18 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000001', 'Stage A1 target', 1, '#666666', '2026-10-18 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', 'Stage A3', 0, '#333333', '2026-10-18 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005', 'Cross-account creator stage', 0, '#555555', '2026-10-18 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'Stage B1', 0, '#222222', '2026-10-18 10:00:00+00');

INSERT INTO public.contacts (id, user_id, account_id, phone, name) VALUES
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '+15555550123', 'Synthetic Contact A'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '+15555550124', 'Synthetic Contact B');

INSERT INTO public.deals (
  id, user_id, account_id, pipeline_id, stage_id, contact_id, conversation_id,
  assigned_to, title, value, currency, notes, expected_close_date, status,
  created_at, updated_at
) VALUES
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Visible synthetic deal', 450.75, 'BRL', 'Do not select this private note', '2026-10-20', 'won', '2026-10-19 10:00:00+00', '2026-10-19 11:00:00+00'),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', NULL, NULL, NULL, 'Orphan synthetic deal', 0.00, NULL, NULL, NULL, NULL, NULL, NULL),
  ('70000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', NULL, '90000000-0000-4000-8000-000000000002', 'Cross-account relation deal', 50.25, 'BRL', NULL, NULL, 'open', '2026-10-20 10:00:00+00', '2026-10-20 11:00:00+00'),
  ('70000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', NULL, NULL, NULL, 'Mismatched stage deal', 12.00, 'BRL', NULL, NULL, 'open', '2026-10-21 10:00:00+00', '2026-10-21 11:00:00+00'),
  ('70000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', NULL, NULL, NULL, 'Other pipeline deal', 99.00, 'BRL', NULL, NULL, 'open', '2026-10-18 10:00:00+00', '2026-10-18 11:00:00+00'),
  ('70000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', NULL, '90000000-0000-4000-8000-000000000002', 'Account B deal', 25.00, 'USD', NULL, NULL, 'open', '2026-10-18 10:00:00+00', '2026-10-18 11:00:00+00'),
  ('70000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000005', NULL, NULL, NULL, 'Cross-account pipeline creator deal', 16.00, 'BRL', NULL, NULL, 'open', '2026-10-22 10:00:00+00', '2026-10-22 11:00:00+00'),
  ('70000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', NULL, NULL, NULL, 'Cross-account deal creator', 17.00, 'BRL', NULL, NULL, 'open', '2026-10-23 10:00:00+00', '2026-10-23 11:00:00+00');
