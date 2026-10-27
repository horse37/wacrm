CREATE ROLE wacrm_account_invitation_revoke_runtime
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
  ON public.accounts FOR SELECT TO wacrm_account_invitation_revoke_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_account_members
  ON public.profiles FOR SELECT TO wacrm_account_invitation_revoke_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY account_invitations_select_admins
  ON public.account_invitations FOR SELECT TO wacrm_account_invitation_revoke_runtime
  USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY account_invitations_delete_admins
  ON public.account_invitations FOR DELETE TO wacrm_account_invitation_revoke_runtime
  USING (public.is_account_member(account_id, 'admin'));

GRANT USAGE ON SCHEMA auth, public TO wacrm_account_invitation_revoke_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_account_invitation_revoke_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_account_invitation_revoke_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles
  TO wacrm_account_invitation_revoke_runtime;
GRANT SELECT, DELETE ON TABLE public.account_invitations
  TO wacrm_account_invitation_revoke_runtime;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004');

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
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'owner'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'agent'
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'viewer'
  );

INSERT INTO public.account_invitations (
  id, account_id, token_hash, role, created_by_user_id, label, expires_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    repeat('a', 64), 'agent', '00000000-0000-4000-8000-000000000001',
    'Synthetic invitation A', now() + interval '7 days'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    repeat('b', 64), 'viewer', '00000000-0000-4000-8000-000000000002',
    'Synthetic invitation B', now() + interval '7 days'
  );
