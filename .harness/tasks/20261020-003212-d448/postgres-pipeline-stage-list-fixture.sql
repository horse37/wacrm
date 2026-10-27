CREATE ROLE wacrm_pipeline_stage_list_runtime
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

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_pipeline_stage_list_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_pipeline_stage_list_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY pipelines_select_members
  ON public.pipelines FOR SELECT TO wacrm_pipeline_stage_list_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY pipeline_stages_select_members
  ON public.pipeline_stages FOR SELECT TO wacrm_pipeline_stage_list_runtime
  USING (
    EXISTS (
      SELECT 1 FROM public.pipelines AS p
      WHERE p.id = pipeline_id AND public.is_account_member(p.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_pipeline_stage_list_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_pipeline_stage_list_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_pipeline_stage_list_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles, public.pipelines,
  public.pipeline_stages TO wacrm_pipeline_stage_list_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'Synthetic Account C', '00000000-0000-4000-8000-000000000004');

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'admin');

INSERT INTO public.pipelines (id, user_id, account_id, name, created_at) VALUES
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Pipeline A1', '2026-10-18 10:00:00+00'),
  ('50000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Pipeline A3', '2026-10-18 10:00:00+00'),
  ('50000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Cross-account creator', '2026-10-18 11:00:00+00'),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Pipeline B1', '2026-10-16 10:00:00+00'),
  ('50000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'Pipeline C1', '2026-10-19 10:00:00+00');

INSERT INTO public.pipeline_stages (id, pipeline_id, name, position, color, created_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'First by ID', 0, '#111111', '2026-10-18 11:00:00+00'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'Second by ID', 0, '#222222', '2026-10-18 09:00:00+00'),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'Null timestamp', 2, '#333333', NULL),
  ('60000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000003', 'Other pipeline', 0, '#444444', '2026-10-18 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005', 'Cross-account creator stage', 0, '#555555', '2026-10-18 10:00:00+00'),
  ('60000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000002', 'Account B stage', 0, '#666666', '2026-10-18 10:00:00+00');
