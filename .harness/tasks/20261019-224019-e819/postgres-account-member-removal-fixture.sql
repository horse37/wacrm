CREATE ROLE wacrm_account_member_removal_runtime
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text NOT NULL,
  full_name text,
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

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_account_member_removal_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_account_members
  ON public.profiles FOR SELECT TO wacrm_account_member_removal_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY profiles_update_self
  ON public.profiles FOR UPDATE TO wacrm_account_member_removal_runtime
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Disposable copy of migration 018's existing member-removal contract.
CREATE FUNCTION public.remove_account_member(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id uuid;
  v_caller_role public.account_role_enum;
  v_target_account_id uuid;
  v_target_role public.account_role_enum;
  v_target_name text;
  v_target_email text;
  v_new_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

GRANT USAGE ON SCHEMA auth, public TO wacrm_account_member_removal_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_account_member_removal_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_account_member_removal_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_account_member_removal_runtime;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid)
  TO wacrm_account_member_removal_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles
  TO wacrm_account_member_removal_runtime;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005'),
  ('00000000-0000-4000-8000-000000000006');

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

INSERT INTO public.profiles (user_id, email, full_name, account_id, account_role) VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'owner-a@example.invalid',
    'Synthetic Owner A',
    '10000000-0000-4000-8000-000000000001',
    'owner'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'owner-b@example.invalid',
    'Synthetic Owner B',
    '10000000-0000-4000-8000-000000000002',
    'owner'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'member-a@example.invalid',
    'Synthetic Member A',
    '10000000-0000-4000-8000-000000000001',
    'agent'
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'viewer-a@example.invalid',
    'Synthetic Viewer A',
    '10000000-0000-4000-8000-000000000001',
    'viewer'
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'admin-a@example.invalid',
    'Synthetic Admin A',
    '10000000-0000-4000-8000-000000000001',
    'admin'
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    'agent-a@example.invalid',
    'Synthetic Agent A',
    '10000000-0000-4000-8000-000000000001',
    'agent'
  );
