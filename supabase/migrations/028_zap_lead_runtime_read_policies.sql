-- Install the PostgreSQL runtime read contract used by Zap Lead readers.
-- Runtime role creation and credential provisioning remain deployment-owned.
DO $runtime_role_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS runtime_role
    WHERE runtime_role.rolname = 'wacrm_runtime'
      AND NOT runtime_role.rolsuper
      AND NOT runtime_role.rolbypassrls
      AND NOT runtime_role.rolcreatedb
      AND NOT runtime_role.rolcreaterole
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS granted_role
        WHERE (
          granted_role.rolsuper OR
          granted_role.rolbypassrls OR
          granted_role.rolcreatedb OR
          granted_role.rolcreaterole OR
          granted_role.rolname IN (
            'wacrm_owner',
            'wacrm_migrator',
            'wacrm_job',
            'postgres',
            'service_role',
            'supabase_admin'
          ) OR
          granted_role.oid IN (
            SELECT protected_relation.relowner
            FROM pg_catalog.pg_class AS protected_relation
            WHERE protected_relation.oid IN (
              pg_catalog.to_regclass('public.zap_lead_integrations'),
              pg_catalog.to_regclass('public.zap_lead_integration_state')
            )
          )
        )
          AND pg_catalog.pg_has_role(
            runtime_role.oid,
            granted_role.oid,
            'MEMBER'
          )
      )
  ) THEN
    RAISE EXCEPTION
      'wacrm_runtime must be a non-privileged role without privileged memberships before applying migration 028';
  END IF;
END
$runtime_role_preflight$;

GRANT USAGE ON SCHEMA public TO wacrm_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(
  UUID,
  public.account_role_enum
) TO wacrm_runtime;

ALTER TABLE public.zap_lead_integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_integration_state FORCE ROW LEVEL SECURITY;

-- SECURITY DEFINER maintenance functions are owned by the non-login table
-- owner. Keep those functions operational while FORCE RLS is enabled.
DROP POLICY IF EXISTS zap_lead_integrations_owner_manage
  ON public.zap_lead_integrations;
CREATE POLICY zap_lead_integrations_owner_manage
  ON public.zap_lead_integrations
  FOR ALL TO postgres
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS zap_lead_integration_state_owner_manage
  ON public.zap_lead_integration_state;
CREATE POLICY zap_lead_integration_state_owner_manage
  ON public.zap_lead_integration_state
  FOR ALL TO postgres
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS zap_lead_integrations_runtime_admin_select
  ON public.zap_lead_integrations;
CREATE POLICY zap_lead_integrations_runtime_admin_select
  ON public.zap_lead_integrations
  FOR SELECT TO wacrm_runtime
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS zap_lead_integrations_runtime_webhook_key_select
  ON public.zap_lead_integrations;
CREATE POLICY zap_lead_integrations_runtime_webhook_key_select
  ON public.zap_lead_integrations
  FOR SELECT TO wacrm_runtime
  USING (
    key_id = NULLIF(
      pg_catalog.current_setting(
        'app.wacrm_zap_lead_webhook_key_id',
        true
      ),
      ''
    )
  );

DROP POLICY IF EXISTS zap_lead_integration_state_runtime_admin_select
  ON public.zap_lead_integration_state;
CREATE POLICY zap_lead_integration_state_runtime_admin_select
  ON public.zap_lead_integration_state
  FOR SELECT TO wacrm_runtime
  USING (public.is_account_member(account_id, 'admin'));

REVOKE ALL PRIVILEGES ON TABLE public.zap_lead_integrations
  FROM wacrm_runtime;
REVOKE SELECT (created_at, updated_at)
  ON TABLE public.zap_lead_integrations
  FROM wacrm_runtime;
GRANT SELECT (
  account_id,
  api_base_url,
  encrypted_registration,
  key_id
)
  ON TABLE public.zap_lead_integrations
  TO wacrm_runtime;

REVOKE ALL PRIVILEGES ON TABLE public.zap_lead_integration_state
  FROM wacrm_runtime;
REVOKE SELECT (
  last_webhook_received_at,
  last_event_id,
  last_event_type,
  last_event_at,
  updated_at
)
  ON TABLE public.zap_lead_integration_state
  FROM wacrm_runtime;
GRANT SELECT (
  account_id,
  integration_key_id,
  last_success_at,
  last_failure_at,
  last_error_code,
  alert_sent_at,
  last_sse_cursor_id
)
  ON TABLE public.zap_lead_integration_state
  TO wacrm_runtime;
