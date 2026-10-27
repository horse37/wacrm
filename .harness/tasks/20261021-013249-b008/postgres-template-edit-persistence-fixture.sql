CREATE ROLE wacrm_template_edit_runtime
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role text NOT NULL
);
CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  name text NOT NULL,
  category text NOT NULL,
  language text NOT NULL,
  header_type text,
  header_content text,
  header_media_url text,
  header_handle text,
  body_text text NOT NULL,
  footer_text text,
  buttons jsonb,
  sample_values jsonb,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  meta_template_id text,
  submission_error text,
  rejection_reason text,
  quality_score text,
  last_submitted_at timestamptz
);
CREATE TABLE public.whatsapp_config (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id),
  access_token text NOT NULL
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_config FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_member_read ON public.accounts FOR SELECT
  USING (id = (SELECT p.account_id FROM public.profiles AS p WHERE p.user_id = auth.uid() LIMIT 1));
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY templates_account_read ON public.message_templates FOR SELECT
  USING (account_id = (SELECT p.account_id FROM public.profiles AS p WHERE p.user_id = auth.uid() LIMIT 1));
CREATE POLICY templates_admin_update ON public.message_templates FOR UPDATE
  USING (account_id = (SELECT p.account_id FROM public.profiles AS p WHERE p.user_id = auth.uid() AND p.account_role = 'admin' LIMIT 1))
  WITH CHECK (account_id = (SELECT p.account_id FROM public.profiles AS p WHERE p.user_id = auth.uid() AND p.account_role = 'admin' LIMIT 1));
CREATE POLICY whatsapp_config_account_read ON public.whatsapp_config FOR SELECT
  USING (account_id = (SELECT p.account_id FROM public.profiles AS p WHERE p.user_id = auth.uid() LIMIT 1));

GRANT USAGE ON SCHEMA public, auth TO wacrm_template_edit_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_template_edit_runtime;
GRANT SELECT ON public.accounts, public.profiles, public.message_templates, public.whatsapp_config TO wacrm_template_edit_runtime;
GRANT UPDATE (category, header_type, header_content, header_media_url, header_handle, body_text, footer_text, buttons, sample_values, status, submission_error, rejection_reason, last_submitted_at)
  ON public.message_templates TO wacrm_template_edit_runtime;

INSERT INTO public.accounts (id, name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Synthetic Account A'),
  ('00000000-0000-4000-8000-000000000002', 'Synthetic Account B');
INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000002', 'admin');
INSERT INTO public.message_templates (
  id, account_id, user_id, name, category, language, header_type, header_content,
  header_media_url, header_handle, body_text, footer_text, buttons, sample_values,
  status, meta_template_id, submission_error, rejection_reason, last_submitted_at
) VALUES
  ('30000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'appointment_reminder', 'Utility', 'pt_BR', 'text', 'Original header {{1}}', NULL, NULL, 'Original body {{1}}.', NULL, '[]', '{"body":["cliente"]}', 'APPROVED', 'SYNTHETIC_META_ID_A', 'Previous synthetic error', 'Previous synthetic rejection', '2026-10-19T12:00:00Z'),
  ('30000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000021', 'other_account_template', 'Utility', 'pt_BR', 'text', 'Other {{1}}', NULL, NULL, 'Other body {{1}}.', NULL, '[]', '{"body":["cliente"]}', 'APPROVED', 'SYNTHETIC_META_ID_B', NULL, NULL, '2026-10-19T12:00:00Z');
INSERT INTO public.whatsapp_config (account_id, access_token)
VALUES ('00000000-0000-4000-8000-000000000001', 'synthetic-encrypted-token-A');
