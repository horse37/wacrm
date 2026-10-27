CREATE ROLE wacrm_inbox_templates_runtime
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

CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  category text NOT NULL,
  language text,
  header_type text,
  header_content text,
  body_text text NOT NULL,
  footer_text text,
  buttons jsonb,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  header_handle text,
  header_media_url text,
  sample_values jsonb,
  meta_template_id text,
  rejection_reason text,
  quality_score text,
  submission_error text
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_inbox_templates_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_inbox_templates_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY templates_select_members
  ON public.message_templates FOR SELECT TO wacrm_inbox_templates_runtime
  USING (public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_inbox_templates_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_inbox_templates_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_inbox_templates_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_inbox_templates_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_inbox_templates_runtime;
GRANT SELECT (
  id, user_id, account_id, name, category, language, header_type,
  header_content, body_text, footer_text, buttons, status, created_at
)
  ON TABLE public.message_templates TO wacrm_inbox_templates_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.profiles (id, user_id, account_id, account_role, full_name) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'Synthetic Owner A'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B');

INSERT INTO public.message_templates (
  id, user_id, account_id, name, category, language, header_type,
  header_content, body_text, footer_text, buttons, status, created_at,
  header_handle, header_media_url, sample_values, meta_template_id,
  rejection_reason, quality_score, submission_error
) VALUES
  (
    '30000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'Appointment reminder', 'Utility', 'en_US', 'text', 'Hello {{1}}',
    'Your visit is at {{1}}.', 'Reply if you have questions.',
    '[{"type":"URL","text":"Open listing","url":"https://example.test/{{1}}"},{"type":"QUICK_REPLY","text":"Confirm"}]',
    'APPROVED', '2026-10-20 12:00:00+00',
    'SYNTHETIC_HEADER_HANDLE_MUST_NOT_LEAK',
    'SYNTHETIC_MEDIA_URL_MUST_NOT_LEAK',
    '{"body":["Synthetic sample"]}',
    'SYNTHETIC_META_ID_MUST_NOT_LEAK',
    'SYNTHETIC_REJECTION_MUST_NOT_LEAK', 'GREEN',
    'SYNTHETIC_SUBMISSION_ERROR_MUST_NOT_LEAK'
  ),
  (
    '30000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'Tied timestamp', 'Marketing', NULL, NULL, NULL,
    'A short update.', NULL, NULL, 'APPROVED', '2026-10-20 12:00:00+00',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'Pending template', 'Utility', 'pt_BR', NULL, NULL,
    'Pending body.', NULL, NULL, 'PENDING', '2026-10-20 13:00:00+00',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Other user template', 'Utility', 'pt_BR', NULL, NULL,
    'Not owned by viewer.', NULL, NULL, 'APPROVED', '2026-10-20 14:00:00+00',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Account B template', 'Utility', 'en_US', NULL, NULL,
    'Other account.', NULL, NULL, 'APPROVED', '2026-10-20 15:00:00+00',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'Missing creator profile', 'Utility', 'en_US', NULL, NULL,
    'Must be excluded by creator join.', NULL, NULL, 'APPROVED', '2026-10-20 16:00:00+00',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL
  );
