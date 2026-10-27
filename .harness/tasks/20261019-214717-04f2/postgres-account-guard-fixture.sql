CREATE ROLE wacrm_guard_runtime
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
  name text NOT NULL
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_read_own_user
  ON public.profiles FOR SELECT TO wacrm_guard_runtime
  USING (user_id = auth.uid());

CREATE POLICY accounts_read_membership
  ON public.accounts FOR SELECT TO wacrm_guard_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.account_id = accounts.id
        AND p.user_id = auth.uid()
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_guard_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_guard_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles TO wacrm_guard_runtime;

INSERT INTO public.accounts (id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B');

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'agent');
