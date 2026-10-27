CREATE ROLE wacrm_contact_tags_runtime
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

CREATE TABLE public.tags (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE public.contact_tags (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT NOW(),
  UNIQUE (contact_id, tag_id)
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_contact_tags_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_contact_tags_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_contact_tags_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY tags_select_members
  ON public.tags FOR SELECT TO wacrm_contact_tags_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY contact_tags_select_members
  ON public.contact_tags FOR SELECT TO wacrm_contact_tags_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts AS c
      WHERE c.id = contact_tags.contact_id
        AND public.is_account_member(c.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_contact_tags_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_contact_tags_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_contact_tags_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles, public.contacts,
  public.tags, public.contact_tags TO wacrm_contact_tags_runtime;

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

INSERT INTO public.tags (id, user_id, account_id, name, color, created_at) VALUES
  (
    '60000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Synthetic A1', '#10b981', '2026-10-18 10:00:00+00'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Synthetic A2', '#3b82f6', '2026-10-18 10:00:00+00'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Synthetic B1', '#ef4444', '2026-10-18 11:00:00+00'
  );

INSERT INTO public.contact_tags (id, contact_id, tag_id, created_at) VALUES
  (
    '80000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '2026-10-18 12:00:00+00'
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '2026-10-18 12:00:00+00'
  ),
  (
    '80000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000003',
    '2026-10-18 13:00:00+00'
  ),
  (
    '80000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000003',
    '2026-10-18 14:00:00+00'
  );
