-- Disposable reproduction of migration 017's flow_runs SELECT-only policy.
-- This fixture is used only inside an ephemeral PostgreSQL container; it is
-- not an application migration and grants no persistent database privileges.
BEGIN;

CREATE ROLE wacrm_runtime NOLOGIN;

CREATE TABLE public.flow_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  status text NOT NULL,
  ended_at timestamptz,
  end_reason text
);

CREATE FUNCTION public.is_account_member(candidate_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT candidate_account_id = '10000000-0000-4000-8000-000000000001'::uuid
$function$;

ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY flow_runs_select
  ON public.flow_runs
  FOR SELECT TO wacrm_runtime
  USING (public.is_account_member(account_id));

-- Model the application's possible UPDATE table privilege while deliberately
-- omitting an UPDATE policy, as migration 017 does for flow_runs.
GRANT SELECT, UPDATE ON public.flow_runs TO wacrm_runtime;

INSERT INTO public.flow_runs (id, account_id, contact_id, status)
VALUES (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'active'
);

SET ROLE wacrm_runtime;
DO $test$
DECLARE
  visible_active_runs integer;
  updated_runs integer;
BEGIN
  SELECT count(*)
  INTO visible_active_runs
  FROM public.flow_runs
  WHERE account_id = '10000000-0000-4000-8000-000000000001'::uuid
    AND contact_id = '40000000-0000-4000-8000-000000000001'::uuid
    AND status = 'active';

  IF visible_active_runs <> 1 THEN
    RAISE EXCEPTION 'expected one visible active flow run, got %', visible_active_runs;
  END IF;

  UPDATE public.flow_runs
  SET status = 'paused_by_agent'
  WHERE account_id = '10000000-0000-4000-8000-000000000001'::uuid
    AND contact_id = '40000000-0000-4000-8000-000000000001'::uuid
    AND status = 'active';
  GET DIAGNOSTICS updated_runs = ROW_COUNT;

  IF updated_runs <> 0 THEN
    RAISE EXCEPTION 'expected missing UPDATE policy to filter row, updated %', updated_runs;
  END IF;
END
$test$;

RESET ROLE;
ROLLBACK;
