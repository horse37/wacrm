CREATE ROLE wacrm_contact_custom_values_runtime
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

CREATE TABLE public.custom_fields (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  field_name text NOT NULL
);

CREATE TABLE public.contact_custom_values (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  custom_field_id uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  value text,
  UNIQUE (contact_id, custom_field_id)
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_fields FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contact_custom_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_custom_values FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_contact_custom_values_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_contact_custom_values_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_contact_custom_values_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY custom_fields_select_members
  ON public.custom_fields FOR SELECT TO wacrm_contact_custom_values_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY contact_custom_values_select_members
  ON public.contact_custom_values FOR SELECT TO wacrm_contact_custom_values_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS c
      WHERE c.id = contact_custom_values.contact_id
        AND public.is_account_member(c.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_contact_custom_values_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_contact_custom_values_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_contact_custom_values_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles, public.contacts,
  public.custom_fields, public.contact_custom_values
  TO wacrm_contact_custom_values_runtime;

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
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Synthetic Account C',
    '00000000-0000-4000-8000-000000000004'
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
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003',
    'admin'
  );

INSERT INTO public.contacts (id, user_id, account_id) VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002'
  );

INSERT INTO public.custom_fields (id, user_id, account_id, field_name) VALUES
  (
    '70000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Synthetic field A1'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Synthetic field A2'
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Synthetic field B1'
  );

INSERT INTO public.contact_custom_values (id, contact_id, custom_field_id, value) VALUES
  (
    '90000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000002',
    'Synthetic value A2'
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    NULL
  ),
  (
    '90000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000003',
    'Cross-account link must not escape'
  ),
  (
    '90000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000003',
    'Synthetic value B1'
  );
