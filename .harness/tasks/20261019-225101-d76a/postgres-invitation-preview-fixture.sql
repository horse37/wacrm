CREATE ROLE wacrm_invitation_preview_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE TYPE public.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public.account_invitations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  token_hash text NOT NULL UNIQUE,
  role public.account_role_enum NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations FORCE ROW LEVEL SECURITY;

-- Disposable copy of migration 019's existing public preview contract.
CREATE FUNCTION public.peek_invitation(p_token_hash text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name text;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name
  FROM accounts
  WHERE id = v_inv.account_id;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.peek_invitation(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO wacrm_invitation_preview_runtime;
GRANT EXECUTE ON FUNCTION public.peek_invitation(text)
  TO wacrm_invitation_preview_runtime;

INSERT INTO public.accounts (id, name) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Synthetic Invitation Account'
  );

INSERT INTO public.account_invitations (
  id, account_id, token_hash, role, expires_at, accepted_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'agent',
    NOW() + INTERVAL '7 days',
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'viewer',
    NOW() - INTERVAL '1 day',
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'admin',
    NOW() + INTERVAL '7 days',
    NOW() - INTERVAL '1 day'
  );
