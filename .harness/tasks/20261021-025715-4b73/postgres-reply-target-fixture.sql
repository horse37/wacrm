CREATE ROLE wacrm_whatsapp_reply_runtime
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
  account_id uuid NOT NULL
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  message_id text
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;

CREATE POLICY reply_profiles_select
  ON public.profiles FOR SELECT TO wacrm_whatsapp_reply_runtime
  USING (user_id = auth.uid());
CREATE POLICY reply_conversations_select
  ON public.conversations FOR SELECT TO wacrm_whatsapp_reply_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY reply_messages_select
  ON public.messages FOR SELECT TO wacrm_whatsapp_reply_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations AS c
      WHERE c.id = conversation_id
        AND public.is_account_member(c.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_whatsapp_reply_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_whatsapp_reply_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_whatsapp_reply_runtime;
GRANT SELECT ON public.conversations, public.messages TO wacrm_whatsapp_reply_runtime;

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');

INSERT INTO public.conversations (id, account_id) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

INSERT INTO public.messages (id, conversation_id, message_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'synthetic-provider-message-a'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', NULL),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'synthetic-provider-message-b');
