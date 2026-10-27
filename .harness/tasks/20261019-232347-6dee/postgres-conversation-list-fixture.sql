CREATE ROLE wacrm_conversation_list_runtime
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
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  phone text NOT NULL,
  phone_normalized text GENERATED ALWAYS AS (regexp_replace(phone, '[^0-9]', '', 'g')) STORED,
  name text,
  email text,
  company text,
  avatar_url text,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  status text NOT NULL CHECK (status IN ('open', 'pending', 'closed')),
  assigned_agent_id uuid,
  last_message_text text,
  last_message_at timestamptz,
  unread_count integer DEFAULT 0,
  created_at timestamptz,
  updated_at timestamptz
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_conversation_list_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_conversation_list_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_conversation_list_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY conversations_select_members
  ON public.conversations FOR SELECT TO wacrm_conversation_list_runtime
  USING (public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_conversation_list_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_conversation_list_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_conversation_list_runtime;
GRANT SELECT ON TABLE
  public.accounts,
  public.profiles,
  public.contacts,
  public.conversations
  TO wacrm_conversation_list_runtime;

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
    'agent'
  );

INSERT INTO public.contacts (
  id, user_id, account_id, phone, name, email, company, avatar_url, created_at, updated_at
) VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '+1 (555) 000-0001',
    'Synthetic contact A1',
    'contact-a1@example.invalid',
    'Synthetic company A',
    NULL,
    '2026-10-18 10:00:00+00',
    '2026-10-18 10:00:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '+1 (555) 000-0002',
    'Synthetic contact A2',
    NULL,
    NULL,
    NULL,
    '2026-10-18 10:01:00+00',
    '2026-10-18 10:01:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '+1 (555) 000-0003',
    'Synthetic contact A3',
    NULL,
    NULL,
    NULL,
    '2026-10-18 10:02:00+00',
    '2026-10-18 10:02:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '+1 (555) 000-0004',
    'Synthetic contact B1',
    NULL,
    NULL,
    NULL,
    '2026-10-18 10:03:00+00',
    '2026-10-18 10:03:00+00'
  );

INSERT INTO public.conversations (
  id, user_id, contact_id, account_id, status, assigned_agent_id,
  last_message_text, last_message_at, unread_count, created_at, updated_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'open', NULL, 'Synthetic latest A1', '2026-10-18 13:00:00+00', 2,
    '2026-10-18 11:00:00+00', '2026-10-18 13:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'pending', '00000000-0000-4000-8000-000000000001', 'Synthetic no timestamp A2', NULL, 0,
    '2026-10-18 11:01:00+00', '2026-10-18 11:01:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'closed', NULL, 'Synthetic older A3', '2026-10-18 12:00:00+00', NULL,
    '2026-10-18 11:02:00+00', '2026-10-18 11:02:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    'open', NULL, 'Synthetic latest B1', '2026-10-18 14:00:00+00', 1,
    '2026-10-18 11:03:00+00', '2026-10-18 14:00:00+00'
  );
