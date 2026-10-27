DO $$
DECLARE
  domain_table text;
  sequence_no integer := 0;
  caller_id uuid;
  personal_account_id uuid;
  v_token_hash text;
  preserved_rows bigint;
  domain_token_chars text[] := ARRAY['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'f'];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = '00000000-0000-4000-8000-000000000003'
      AND account_id = '10000000-0000-4000-8000-000000000001'
      AND account_role = 'agent'
  ) THEN
    RAISE EXCEPTION 'successful redemption did not move caller profile';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = '20000000-0000-4000-8000-000000000100'
  ) THEN
    RAISE EXCEPTION 'successful redemption did not delete empty personal account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_invitations
    WHERE token_hash = repeat('a', 64)
      AND accepted_at IS NOT NULL
      AND accepted_by_user_id = '00000000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'successful redemption did not accept invite for caller';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.account_invitations
    WHERE token_hash = repeat('b', 64)
      AND accepted_at IS NULL
      AND expires_at <= NOW()
  ) THEN
    RAISE EXCEPTION 'expired invite changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_invitations
    WHERE token_hash = repeat('c', 64)
      AND accepted_at IS NOT NULL
      AND accepted_by_user_id = '00000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'used invite changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = '00000000-0000-4000-8000-000000000031'
      AND account_id = '10000000-0000-4000-8000-000000000001'
      AND account_role = 'owner'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.account_invitations
    WHERE token_hash = repeat('d', 64) AND accepted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'same-account conflict changed profile or invite';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = '00000000-0000-4000-8000-000000000004'
      AND account_id = '10000000-0000-4000-8000-000000000002'
      AND account_role = 'agent'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.account_invitations
    WHERE token_hash = repeat('e', 64) AND accepted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'shared-account conflict changed profile or invite';
  END IF;

  FOREACH domain_table IN ARRAY ARRAY[
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
    sequence_no := sequence_no + 1;
    caller_id := ('00000000-0000-4000-8000-' || lpad((sequence_no + 10)::text, 12, '0'))::uuid;
    personal_account_id := ('20000000-0000-4000-8000-' || lpad(sequence_no::text, 12, '0'))::uuid;
    v_token_hash := repeat(domain_token_chars[sequence_no], 64);

    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = caller_id
        AND account_id = personal_account_id
        AND account_role = 'owner'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.accounts WHERE id = personal_account_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.account_invitations
      WHERE account_invitations.token_hash = v_token_hash AND accepted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'domain-data refusal changed profile, account, or invite for %', domain_table;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE account_id = $1', domain_table)
      INTO preserved_rows USING personal_account_id;
    IF preserved_rows <> 1 THEN
      RAISE EXCEPTION 'domain-data row was not preserved for %', domain_table;
    END IF;
  END LOOP;
END;
$$;
