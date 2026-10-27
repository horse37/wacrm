CREATE ROLE wacrm_whatsapp_conversation_runtime
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
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
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
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  last_message_text text,
  last_message_at timestamptz,
  updated_at timestamptz NOT NULL
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY conversations_update ON public.conversations
  FOR UPDATE USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));
GRANT USAGE ON SCHEMA public, auth TO wacrm_whatsapp_conversation_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_whatsapp_conversation_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_whatsapp_conversation_runtime;
GRANT SELECT ON public.profiles, public.conversations
  TO wacrm_whatsapp_conversation_runtime;
GRANT UPDATE ON public.conversations TO wacrm_whatsapp_conversation_runtime;
INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'agent');
INSERT INTO public.conversations (
  id, account_id, last_message_text, last_message_at, updated_at
) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'old A', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'old B', '2026-10-20T11:00:00Z', '2026-10-20T11:00:00Z');