-- These functions are trigger-only. Revoke direct EXECUTE from PUBLIC and the
-- API roles as platform defaults may grant named roles EXECUTE explicitly.
-- Existing triggers remain installed; the disposable probe verifies they fire.
REVOKE ALL ON FUNCTION public._bcast_bump(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.broadcast_recipient_aggregate_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;

-- RLS policies call this SECURITY DEFINER helper. Remove any PUBLIC/anon
-- defaults, then allow only the roles explicitly used by those policies.
REVOKE ALL ON FUNCTION public.is_account_member(UUID, public.account_role_enum)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, public.account_role_enum)
  TO authenticated, service_role;

-- Migration 005 retains this function for an authorized operator to repair
-- broadcast counters after drift; the incremental trigger does not call it.
-- Keep direct RPC execution limited to the function owner. Operator access
-- must use a controlled database session that can SET ROLE to that owner.
REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
