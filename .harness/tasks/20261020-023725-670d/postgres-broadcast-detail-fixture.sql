CREATE ROLE wacrm_broadcast_detail_runtime
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

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  phone text NOT NULL,
  name text,
  email text,
  company text
);

CREATE TABLE public.broadcasts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'en_US',
  template_variables jsonb,
  audience_filter jsonb,
  status text NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  total_recipients integer NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  delivered_count integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  read_count integer NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  replied_count integer NOT NULL DEFAULT 0 CHECK (replied_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.broadcast_recipients (
  id uuid PRIMARY KEY,
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  error_message text,
  whatsapp_message_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_broadcast_detail_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_broadcast_detail_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_broadcast_detail_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY broadcasts_select_members
  ON public.broadcasts FOR SELECT TO wacrm_broadcast_detail_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY broadcast_recipients_select_members
  ON public.broadcast_recipients FOR SELECT TO wacrm_broadcast_detail_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.broadcasts AS b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND public.is_account_member(b.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_broadcast_detail_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_broadcast_detail_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_broadcast_detail_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_broadcast_detail_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_broadcast_detail_runtime;
GRANT SELECT (id, account_id, name, phone)
  ON TABLE public.contacts TO wacrm_broadcast_detail_runtime;
GRANT SELECT (
  id, account_id, user_id, name, template_name, status, total_recipients,
  sent_count, delivered_count, read_count, replied_count, failed_count, created_at
) ON TABLE public.broadcasts TO wacrm_broadcast_detail_runtime;
GRANT SELECT (
  id, broadcast_id, contact_id, status, sent_at, delivered_at,
  read_at, replied_at, error_message, created_at
) ON TABLE public.broadcast_recipients TO wacrm_broadcast_detail_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'Synthetic Account C', '00000000-0000-4000-8000-000000000004');

INSERT INTO public.profiles (id, user_id, account_id, account_role, full_name) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'Synthetic Owner A'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'agent', 'Synthetic Agent A'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'admin', 'Synthetic Admin C');

INSERT INTO public.contacts (id, account_id, phone, name, email, company) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '15550000001', 'Synthetic Contact A', 'synthetic-a@example.invalid', 'Synthetic Company A'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '15550000002', 'Synthetic Contact B', 'synthetic-b@example.invalid', 'Synthetic Company B');

INSERT INTO public.broadcasts (
  id, user_id, account_id, name, template_name, template_language,
  template_variables, audience_filter, status, total_recipients,
  sent_count, delivered_count, read_count, replied_count, failed_count, created_at
) VALUES
  (
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    'Synthetic campaign A', 'appointment_reminder', 'pt_BR',
    '{"secret":"SYNTHETIC_TEMPLATE_VARIABLES_MUST_NOT_LEAK"}',
    '{"secret":"SYNTHETIC_AUDIENCE_FILTER_MUST_NOT_LEAK"}',
    'sending', 10, 7, 4, 2, 1, 0, '2026-10-20 10:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Foreign creator broadcast', 'new_listing', 'pt_BR', '{}', '{}',
    'sent', 1, 1, 1, 0, 0, 0, '2026-10-21 10:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Synthetic campaign B', 'appointment_reminder', 'pt_BR', '{}', '{}',
    'scheduled', 1, 0, 0, 0, 0, 0, '2026-10-21 10:00:00+00'
  );

INSERT INTO public.broadcast_recipients (
  id, broadcast_id, contact_id, status, sent_at, delivered_at, read_at,
  replied_at, error_message, whatsapp_message_id, created_at
) VALUES
  (
    '40000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000001',
    'delivered', '2026-10-20 10:01:00+00', '2026-10-20 10:02:00+00', NULL,
    NULL, NULL, 'SYNTHETIC_WAMID_MUST_NOT_LEAK', '2026-10-20 10:05:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    NULL,
    'failed', NULL, NULL, NULL, NULL, 'Synthetic delivery error', NULL,
    '2026-10-20 10:05:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000002',
    'sent', '2026-10-20 10:03:00+00', NULL, NULL, NULL, NULL, NULL,
    '2026-10-20 10:05:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000004',
    NULL,
    'sent', '2026-10-21 10:01:00+00', NULL, NULL, NULL, NULL, NULL,
    '2026-10-21 10:05:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000002',
    'pending', NULL, NULL, NULL, NULL, NULL, NULL,
    '2026-10-21 10:05:00+00'
  );
