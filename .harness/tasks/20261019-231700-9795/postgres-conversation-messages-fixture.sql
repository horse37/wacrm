CREATE ROLE wacrm_conversation_messages_runtime
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

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  status text NOT NULL CHECK (status IN ('open', 'pending', 'closed')),
  assigned_agent_id uuid,
  last_message_text text,
  last_message_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  sender_id uuid,
  content_type text NOT NULL CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive'
  )),
  content_text text,
  media_url text,
  template_name text,
  message_id text,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  created_at timestamptz,
  reply_to_message_id uuid,
  interactive_reply_id text
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_conversation_messages_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_conversation_messages_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY conversations_select_members
  ON public.conversations FOR SELECT TO wacrm_conversation_messages_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY messages_select_account_conversations
  ON public.messages FOR SELECT TO wacrm_conversation_messages_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations AS c
      WHERE c.id = messages.conversation_id
        AND public.is_account_member(c.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_conversation_messages_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_conversation_messages_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_conversation_messages_runtime;
GRANT SELECT ON TABLE
  public.accounts,
  public.profiles,
  public.conversations,
  public.messages
  TO wacrm_conversation_messages_runtime;

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

INSERT INTO public.conversations (
  id, user_id, contact_id, account_id, status, created_at, updated_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'open',
    '2026-10-18 11:00:00+00',
    '2026-10-18 13:00:00+00'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'open',
    '2026-10-18 11:00:00+00',
    '2026-10-18 13:00:00+00'
  );

INSERT INTO public.messages (
  id, conversation_id, sender_type, sender_id, content_type, content_text,
  media_url, template_name, message_id, status, created_at,
  reply_to_message_id, interactive_reply_id
) VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'customer',
    NULL,
    'text',
    'synthetic message A1',
    NULL,
    NULL,
    'synthetic-meta-message-a1',
    'delivered',
    '2026-10-18 12:00:00+00',
    NULL,
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'agent',
    '00000000-0000-4000-8000-000000000001',
    'interactive',
    'synthetic message A2',
    NULL,
    NULL,
    'synthetic-meta-message-a2',
    'read',
    '2026-10-18 13:00:00+00',
    '30000000-0000-4000-8000-000000000001',
    'synthetic-button-id'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'customer',
    NULL,
    'text',
    'synthetic message B1',
    NULL,
    NULL,
    'synthetic-meta-message-b1',
    'delivered',
    '2026-10-18 12:30:00+00',
    NULL,
    NULL
  );
