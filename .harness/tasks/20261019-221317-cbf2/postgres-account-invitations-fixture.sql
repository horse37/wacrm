CREATE ROLE wacrm_account_invitations_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

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
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL
);

CREATE TABLE public.account_invitations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  role public.account_role_enum NOT NULL CHECK (role <> 'owner'),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
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

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_account_invitations_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_account_members
  ON public.profiles FOR SELECT TO wacrm_account_invitations_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY account_invitations_select_admins
  ON public.account_invitations FOR SELECT TO wacrm_account_invitations_runtime
  USING (public.is_account_member(account_id, 'admin'));

GRANT USAGE ON SCHEMA auth, public TO wacrm_account_invitations_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_account_invitations_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_account_invitations_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles, public.account_invitations
  TO wacrm_account_invitations_runtime;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Synthetic Account A',
    '00000000-0000-4000-8000-000000000001'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Synthetic Account B',
    '00000000-0000-4000-8000-000000000002'
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

INSERT INTO public.account_invitations (
  id, account_id, token_hash, role, created_by_user_id, label, created_at, expires_at,
  accepted_at, accepted_by_user_id
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'synthetic-hash-a-newest',
    'agent',
    '00000000-0000-4000-8000-000000000001',
    'Synthetic newest invitation A',
    now() - interval '1 hour',
    now() + interval '7 days',
    NULL,
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'synthetic-hash-a-older',
    'viewer',
    '00000000-0000-4000-8000-000000000001',
    'Synthetic older invitation A',
    now() - interval '2 hours',
    now() + interval '10 days',
    NULL,
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'synthetic-hash-a-expired',
    'agent',
    '00000000-0000-4000-8000-000000000001',
    'Synthetic expired invitation A',
    now() - interval '3 hours',
    now() - interval '1 hour',
    NULL,
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'synthetic-hash-a-accepted',
    'agent',
    '00000000-0000-4000-8000-000000000001',
    'Synthetic accepted invitation A',
    now() - interval '4 hours',
    now() + interval '5 days',
    now() - interval '30 minutes',
    '00000000-0000-4000-8000-000000000003'
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000002',
    'synthetic-hash-b-pending',
    'viewer',
    '00000000-0000-4000-8000-000000000002',
    'Synthetic pending invitation B',
    now() - interval '1 hour',
    now() + interval '7 days',
    NULL,
    NULL
  );
