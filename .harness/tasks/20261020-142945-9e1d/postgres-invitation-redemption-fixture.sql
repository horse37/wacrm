CREATE ROLE wacrm_invitation_redemption_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

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
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  account_role public.account_role_enum NOT NULL
);

CREATE TABLE public.account_invitations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  token_hash text NOT NULL UNIQUE,
  role public.account_role_enum NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES auth.users(id)
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'contacts',
    'conversations',
    'broadcasts',
    'automations',
    'flows',
    'pipelines',
    'message_templates',
    'tags',
    'custom_fields',
    'contact_notes',
    'whatsapp_config'
  ] LOOP
    EXECUTE format(
      'CREATE TABLE public.%I (id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE)',
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_self
  ON public.profiles FOR SELECT TO wacrm_invitation_redemption_runtime
  USING (user_id = auth.uid());
CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_invitation_redemption_runtime
  USING (
    id IN (
      SELECT account_id
      FROM public.profiles
      WHERE user_id = auth.uid()
    )
  );

-- Disposable copy of migration 019's SECURITY DEFINER redemption contract.
CREATE FUNCTION public.redeem_invitation(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id uuid;
  v_old_account_owner uuid;
  v_has_data boolean;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash = repeat('f', 63) || 'a' THEN
  RAISE EXCEPTION 'Synthetic permission failure' USING ERRCODE = '42501';
END IF;SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA auth, public TO wacrm_invitation_redemption_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_invitation_redemption_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_invitation_redemption_runtime;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text)
  TO wacrm_invitation_redemption_runtime;
GRANT SELECT ON TABLE public.accounts, public.profiles
  TO wacrm_invitation_redemption_runtime;

INSERT INTO auth.users (id)
SELECT ('00000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid
FROM generate_series(1, 21) AS value
UNION ALL
SELECT '00000000-0000-4000-8000-000000000031'::uuid
UNION ALL
SELECT '00000000-0000-4000-8000-000000000032'::uuid;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Invite Target', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Shared Account', '00000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000100', 'Synthetic Empty Personal Account', '00000000-0000-4000-8000-000000000003');

INSERT INTO public.accounts (id, name, owner_user_id)
SELECT
  ('20000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'Synthetic Account With Domain Data ' || value,
  ('00000000-0000-4000-8000-' || lpad((value + 10)::text, 12, '0'))::uuid
FROM generate_series(1, 11) AS value;

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000100', 'owner'),
  ('00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'agent'),
  ('00000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000002', 'admin');

INSERT INTO public.profiles (user_id, account_id, account_role)
SELECT
  ('00000000-0000-4000-8000-' || lpad((value + 10)::text, 12, '0'))::uuid,
  ('20000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'owner'
FROM generate_series(1, 11) AS value;

INSERT INTO public.account_invitations (
  id, account_id, token_hash, role, expires_at, accepted_at, accepted_by_user_id
) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', repeat('a', 64), 'agent', NOW() + INTERVAL '7 days', NULL, NULL),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', repeat('b', 64), 'viewer', NOW() - INTERVAL '1 day', NULL, NULL),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', repeat('c', 64), 'agent', NOW() + INTERVAL '7 days', NOW() - INTERVAL '1 day', '00000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', repeat('d', 64), 'agent', NOW() + INTERVAL '7 days', NULL, NULL),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', repeat('e', 64), 'agent', NOW() + INTERVAL '7 days', NULL, NULL);

INSERT INTO public.account_invitations (
  id, account_id, token_hash, role, expires_at
)
SELECT
  ('40000000-0000-4000-8000-' || lpad((value + 10)::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  repeat(token_char, 64),
  'agent',
  NOW() + INTERVAL '7 days'
FROM unnest(ARRAY['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'f'])
  WITH ORDINALITY AS cases(token_char, value);

INSERT INTO public.contacts (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
INSERT INTO public.conversations (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');
INSERT INTO public.broadcasts (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003');
INSERT INTO public.automations (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004');
INSERT INTO public.flows (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005');
INSERT INTO public.pipelines (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000006');
INSERT INTO public.message_templates (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000007');
INSERT INTO public.tags (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000008');
INSERT INTO public.custom_fields (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000009');
INSERT INTO public.contact_notes (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000010');
INSERT INTO public.whatsapp_config (id, account_id) VALUES
  ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000011');
