CREATE ROLE wacrm_message_reaction_target_runtime
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
  owner_user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL
);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  phone text
);

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  contact_id uuid REFERENCES public.contacts(id)
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  message_id text
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

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_message_reaction_target_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_message_reaction_target_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_message_reaction_target_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY conversations_select_members
  ON public.conversations FOR SELECT TO wacrm_message_reaction_target_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY messages_select_members
  ON public.messages FOR SELECT TO wacrm_message_reaction_target_runtime
  USING (EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    WHERE conversation.id = messages.conversation_id
      AND public.is_account_member(conversation.account_id)
  ));

GRANT CONNECT ON DATABASE postgres TO wacrm_message_reaction_target_runtime;
GRANT USAGE ON SCHEMA auth, public TO wacrm_message_reaction_target_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_message_reaction_target_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_message_reaction_target_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_message_reaction_target_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts
  TO wacrm_message_reaction_target_runtime;
GRANT SELECT (user_id, account_id, account_role) ON TABLE public.profiles
  TO wacrm_message_reaction_target_runtime;
GRANT SELECT (id, account_id, phone) ON TABLE public.contacts
  TO wacrm_message_reaction_target_runtime;
GRANT SELECT (id, account_id, user_id, contact_id) ON TABLE public.conversations
  TO wacrm_message_reaction_target_runtime;
GRANT SELECT (id, conversation_id, message_id) ON TABLE public.messages
  TO wacrm_message_reaction_target_runtime;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004');

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.profiles (id, user_id, account_id, account_role) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'agent'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');

INSERT INTO public.contacts (id, account_id, phone) VALUES
  ('21000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '+15555550123'),
  ('21000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', NULL),
  ('21000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '+15555550999');

INSERT INTO public.conversations (id, account_id, user_id, contact_id) VALUES
  ('22000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001'),
  ('22000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002'),
  ('22000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003'),
  ('22000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001');

INSERT INTO public.messages (id, conversation_id, message_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', 'SYNTHETIC_PROVIDER_MESSAGE_A'),
  ('30000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001', NULL),
  ('30000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000002', 'SYNTHETIC_NO_PHONE_PROVIDER_ID'),
  ('30000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000003', 'SYNTHETIC_PROVIDER_MESSAGE_B'),
  ('30000000-0000-4000-8000-000000000005', '22000000-0000-4000-8000-000000000004', 'SYNTHETIC_INCONSISTENT_CREATOR');
