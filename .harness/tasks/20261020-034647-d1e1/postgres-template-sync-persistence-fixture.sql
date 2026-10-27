CREATE ROLE wacrm_template_sync_persist_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
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
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Marketing'
    CHECK (category IN ('Marketing', 'Utility', 'Authentication')),
  language text DEFAULT 'en_US',
  header_type text CHECK (header_type IN ('text', 'image', 'video', 'document')),
  header_content text,
  header_handle text,
  header_media_url text,
  body_text text NOT NULL,
  footer_text text,
  buttons jsonb CHECK (
    buttons IS NULL OR
    (jsonb_typeof(buttons) = 'array' AND jsonb_array_length(buttons) <= 10)
  ),
  sample_values jsonb,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED',
      'IN_APPEAL', 'PENDING_DELETION'
    )),
  meta_template_id text,
  quality_score text
    CHECK (quality_score IS NULL OR quality_score IN ('GREEN', 'YELLOW', 'RED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_templates_user_name_language_key
    UNIQUE (user_id, name, language)
);

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.message_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_template_sync_persist_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_template_sync_persist_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY templates_select_members
  ON public.message_templates FOR SELECT TO wacrm_template_sync_persist_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY templates_insert_admin
  ON public.message_templates FOR INSERT TO wacrm_template_sync_persist_runtime
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY templates_update_admin
  ON public.message_templates FOR UPDATE TO wacrm_template_sync_persist_runtime
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

GRANT CONNECT ON DATABASE postgres TO wacrm_template_sync_persist_runtime;
GRANT USAGE ON SCHEMA auth, public TO wacrm_template_sync_persist_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_template_sync_persist_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_template_sync_persist_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_template_sync_persist_runtime;

GRANT SELECT (id, name)
  ON TABLE public.accounts TO wacrm_template_sync_persist_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_template_sync_persist_runtime;
GRANT SELECT (id, user_id, account_id, name, language)
  ON TABLE public.message_templates TO wacrm_template_sync_persist_runtime;
GRANT INSERT (
  account_id, user_id, name, category, language, header_type, header_content,
  header_handle, body_text, footer_text, buttons, sample_values, status,
  meta_template_id, quality_score, updated_at
) ON TABLE public.message_templates TO wacrm_template_sync_persist_runtime;
GRANT UPDATE (
  account_id, user_id, name, category, language, header_type, header_content,
  header_handle, body_text, footer_text, buttons, sample_values, status,
  meta_template_id, quality_score, updated_at
) ON TABLE public.message_templates TO wacrm_template_sync_persist_runtime;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005');

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.profiles (id, user_id, account_id, account_role, full_name) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'Synthetic Owner A'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'admin', 'Synthetic Admin A'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B');

INSERT INTO public.message_templates (
  id, user_id, account_id, name, category, language, header_type,
  header_media_url, body_text, status, meta_template_id, quality_score
) VALUES
  ('30000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Appointment reminder', 'Utility', 'pt_BR', 'image', 'https://synthetic.invalid/preserved.png', 'Old body', 'PENDING_DELETION', 'SYNTHETIC_OLD_ID', 'YELLOW'),
  ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Account B only', 'Utility', 'pt_BR', NULL, NULL, 'Account B body', 'APPROVED', 'SYNTHETIC_B_ID', 'GREEN'),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Orphan match', 'Utility', 'pt_BR', NULL, NULL, 'Orphan body', 'APPROVED', 'SYNTHETIC_ORPHAN', 'GREEN'),
  ('30000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Duplicate A', 'Utility', 'en_US', NULL, NULL, 'Duplicate first', 'APPROVED', 'SYNTHETIC_DUP_A', 'GREEN'),
  ('30000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Duplicate A', 'Utility', 'en_US', NULL, NULL, 'Duplicate second', 'APPROVED', 'SYNTHETIC_DUP_B', 'GREEN');
