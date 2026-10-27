CREATE ROLE wacrm_message_reaction_runtime
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

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id text
);

CREATE TABLE public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'agent')),
  actor_id uuid,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, actor_type, actor_id)
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_message_reaction_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_message_reaction_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY conversations_select_members
  ON public.conversations FOR SELECT TO wacrm_message_reaction_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY messages_select_members
  ON public.messages FOR SELECT TO wacrm_message_reaction_runtime
  USING (EXISTS (
    SELECT 1 FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND public.is_account_member(conversation.account_id)
  ));
CREATE POLICY message_reactions_select_members
  ON public.message_reactions FOR SELECT TO wacrm_message_reaction_runtime
  USING (EXISTS (
    SELECT 1
    FROM public.messages AS message
    INNER JOIN public.conversations AS conversation
      ON conversation.id = message.conversation_id
    WHERE message.id = message_reactions.message_id
      AND public.is_account_member(conversation.account_id)
  ));
CREATE POLICY message_reactions_modify_members
  ON public.message_reactions FOR ALL TO wacrm_message_reaction_runtime
  USING (EXISTS (
    SELECT 1
    FROM public.messages AS message
    INNER JOIN public.conversations AS conversation
      ON conversation.id = message.conversation_id
    WHERE message.id = message_reactions.message_id
      AND public.is_account_member(conversation.account_id, 'agent')
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.messages AS message
    INNER JOIN public.conversations AS conversation
      ON conversation.id = message.conversation_id
    WHERE message.id = message_reactions.message_id
      AND public.is_account_member(conversation.account_id, 'agent')
  ));

GRANT CONNECT ON DATABASE postgres TO wacrm_message_reaction_runtime;
GRANT USAGE ON SCHEMA auth, public TO wacrm_message_reaction_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_message_reaction_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_message_reaction_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_message_reaction_runtime;

GRANT SELECT (id, name)
  ON TABLE public.accounts TO wacrm_message_reaction_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_message_reaction_runtime;
GRANT SELECT (id, user_id, account_id)
  ON TABLE public.conversations TO wacrm_message_reaction_runtime;
GRANT SELECT (id, conversation_id, message_id)
  ON TABLE public.messages TO wacrm_message_reaction_runtime;
GRANT SELECT (id, message_id, conversation_id, actor_type, actor_id, emoji)
  ON TABLE public.message_reactions TO wacrm_message_reaction_runtime;
GRANT INSERT (message_id, conversation_id, actor_type, actor_id, emoji)
  ON TABLE public.message_reactions TO wacrm_message_reaction_runtime;
GRANT UPDATE (conversation_id, emoji)
  ON TABLE public.message_reactions TO wacrm_message_reaction_runtime;
GRANT DELETE ON TABLE public.message_reactions TO wacrm_message_reaction_runtime;

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
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'agent', 'Synthetic Agent A'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B');

INSERT INTO public.conversations (id, account_id, user_id) VALUES
  ('21000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.messages (id, conversation_id, message_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'SYNTHETIC_EXTERNAL_MESSAGE_A'),
  ('30000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', NULL),
  ('30000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000002', 'SYNTHETIC_EXTERNAL_MESSAGE_B');

INSERT INTO public.message_reactions (
  id, message_id, conversation_id, actor_type, actor_id, emoji
) VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'customer', NULL, '❤️'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'agent', '00000000-0000-4000-8000-000000000003', '👎');
