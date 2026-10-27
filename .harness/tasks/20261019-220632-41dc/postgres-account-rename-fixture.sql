CREATE ROLE wacrm_account_rename_runtime
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
  owner_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL
);

CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_account_rename_runtime
  USING (public.is_account_member(id));
CREATE POLICY accounts_update_admins
  ON public.accounts FOR UPDATE TO wacrm_account_rename_runtime
  USING (public.is_account_member(id, 'admin'))
  WITH CHECK (public.is_account_member(id, 'admin'));
CREATE POLICY profiles_select_account_members
  ON public.profiles FOR SELECT TO wacrm_account_rename_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_account_rename_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_account_rename_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_account_rename_runtime;
GRANT SELECT, UPDATE ON TABLE public.accounts TO wacrm_account_rename_runtime;
GRANT SELECT ON TABLE public.profiles TO wacrm_account_rename_runtime;

INSERT INTO public.accounts (id, name, owner_user_id, created_at, updated_at) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Synthetic Account A',
    '00000000-0000-4000-8000-000000000001',
    '2026-10-01 12:00:00+00',
    '2026-10-01 12:00:00+00'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Synthetic Account B',
    '00000000-0000-4000-8000-000000000002',
    '2026-10-01 13:00:00+00',
    '2026-10-01 13:00:00+00'
  );

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'owner'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'viewer'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'owner'
  );
