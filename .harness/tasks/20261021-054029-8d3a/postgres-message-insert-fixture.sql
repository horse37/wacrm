CREATE ROLE wacrm_whatsapp_message_runtime
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  sender_id uuid,
  content_type text NOT NULL CHECK (
    content_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'template')
  ),
  content_text text,
  media_url text,
  template_name text,
  message_id text,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  reply_to_message_id uuid REFERENCES public.messages(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO wacrm_whatsapp_message_runtime
  USING (user_id = auth.uid());
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT TO wacrm_whatsapp_message_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO wacrm_whatsapp_message_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations AS c
      WHERE c.id = messages.conversation_id
        AND public.is_account_member(c.account_id)
    )
  );
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO wacrm_whatsapp_message_runtime
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.conversations AS c
      WHERE c.id = messages.conversation_id
        AND public.is_account_member(c.account_id, 'agent')
    )
  );

GRANT USAGE ON SCHEMA public, auth TO wacrm_whatsapp_message_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_whatsapp_message_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_whatsapp_message_runtime;
GRANT SELECT ON public.profiles, public.conversations, public.messages
  TO wacrm_whatsapp_message_runtime;
GRANT INSERT ON public.messages TO wacrm_whatsapp_message_runtime;

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'agent'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'agent');

INSERT INTO public.conversations (id, account_id) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

INSERT INTO public.messages (
  id, conversation_id, sender_type, content_type, message_id, status
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'customer', 'text', 'synthetic-parent-message', 'sent'
);
