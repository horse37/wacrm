-- Synthetic RLS policy probe only. It uses a transaction-scoped SELECT grant,
-- SET ROLE authenticated, and a manually set claim. It does not validate
-- trusted identity establishment, Supabase Auth, or account isolation for
-- wacrm_runtime/job (those roles intentionally have CONNECT only).
-- It proves only the historical profiles RLS policy with a synthetic claim.
-- Run in the disposable PostgreSQL fixture after migrations; transaction rolls back all rows/grants.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
ALTER TABLE auth.users ENABLE TRIGGER USER;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Synthetic A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'Synthetic B', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic Owner A', 'a@example.invalid', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Synthetic Agent A', 'b@example.invalid', '11111111-1111-4111-8111-111111111111', 'agent'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Synthetic Owner B', 'c@example.invalid', '22222222-2222-4222-8222-222222222222', 'owner');

-- Supabase supplies grants separately from this migration chain. Model only the required read grant here.
GRANT SELECT ON public.profiles TO authenticated;
DO $test$
BEGIN
  IF has_table_privilege('wacrm_runtime', 'public.profiles', 'SELECT') OR
     has_table_privilege('wacrm_job', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'runtime/job must not read profiles before a reviewed grant matrix';
  END IF;
  RAISE NOTICE 'runtime/job access boundary SUCCESS: profiles SELECT denied';
END
$test$;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  visible_count integer;
  foreign_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM public.profiles;
  SELECT count(*) INTO foreign_count
    FROM public.profiles
   WHERE account_id = '22222222-2222-4222-8222-222222222222';
  IF visible_count <> 2 OR foreign_count <> 0 THEN
    RAISE EXCEPTION 'account isolation failed: visible %, foreign %', visible_count, foreign_count;
  END IF;
  RAISE NOTICE 'account isolation SUCCESS: same_account_visible=2 other_account_visible=0';
END
$test$;
ROLLBACK;
