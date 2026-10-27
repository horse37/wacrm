CREATE ROLE wacrm_template_manager_catalog_runtime
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
  category text NOT NULL CHECK (category IN ('Marketing', 'Utility', 'Authentication')),
  status text CHECK (status IN (
    'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED',
    'IN_APPEAL', 'PENDING_DELETION'
  )),
  language text,
  quality_score text CHECK (quality_score IS NULL OR quality_score IN ('GREEN', 'YELLOW', 'RED')),
  body_text text NOT NULL,
  footer_text text,
  rejection_reason text,
  submission_error text,
  meta_template_id text,
  created_at timestamptz DEFAULT now(),
  header_handle text,
  sample_values jsonb
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_template_manager_catalog_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_template_manager_catalog_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY templates_select_members
  ON public.message_templates FOR SELECT TO wacrm_template_manager_catalog_runtime
  USING (public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_template_manager_catalog_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_template_manager_catalog_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_template_manager_catalog_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_template_manager_catalog_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_template_manager_catalog_runtime;
GRANT SELECT (
  id, user_id, account_id, name, category, status, language, quality_score,
  body_text, footer_text, rejection_reason, submission_error, meta_template_id, created_at
) ON TABLE public.message_templates TO wacrm_template_manager_catalog_runtime;

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

INSERT INTO public.message_templates (
  id, user_id, account_id, name, category, status, language, quality_score,
  body_text, footer_text, rejection_reason, submission_error, meta_template_id,
  created_at, header_handle, sample_values
) VALUES
  (
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Newest template', 'Marketing', 'PENDING', 'pt_BR', 'GREEN', 'Olá {{1}}',
    NULL, NULL, NULL, NULL, '2026-10-20 10:00:00+00',
    'SYNTHETIC_HEADER_HANDLE_MUST_NOT_LEAK',
    '{"body":["SYNTHETIC_SAMPLE_MUST_NOT_LEAK"]}'
  ),
  (
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Tie-break template', 'Authentication', 'APPROVED', 'en_US', NULL,
    'Código {{1}}', NULL, NULL, NULL, 'SYNTHETIC_META_TEMPLATE_ID',
    '2026-10-20 10:00:00+00', NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Older template', 'Utility', NULL, NULL, NULL, 'Confirmação', 'Até logo',
    'Synthetic rejection reason', 'Synthetic submission error', NULL,
    '2026-10-20 09:00:00+00', NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    'Other account member template', 'Utility', 'APPROVED', 'pt_BR', NULL,
    'Não deve aparecer para owner', NULL, NULL, NULL, NULL,
    '2026-10-21 10:00:00+00', NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Account B template', 'Marketing', 'APPROVED', 'pt_BR', NULL,
    'Conta B', NULL, NULL, NULL, NULL, '2026-10-22 10:00:00+00', NULL, NULL
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Mismatched creator profile', 'Marketing', 'APPROVED', 'pt_BR', NULL,
    'Criador em outra conta', NULL, NULL, NULL, NULL,
    '2026-10-23 10:00:00+00', NULL, NULL
  );
