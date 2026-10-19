-- Store one encrypted Zap Lead installation per WACRM account.
CREATE TABLE IF NOT EXISTS public.zap_lead_integrations (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  api_base_url TEXT NOT NULL CHECK (api_base_url ~ '^https://'),
  encrypted_registration TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.zap_lead_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zap_lead_integrations_admin_select"
  ON public.zap_lead_integrations;
CREATE POLICY "zap_lead_integrations_admin_select"
  ON public.zap_lead_integrations
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "zap_lead_integrations_admin_insert"
  ON public.zap_lead_integrations;
CREATE POLICY "zap_lead_integrations_admin_insert"
  ON public.zap_lead_integrations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "zap_lead_integrations_admin_update"
  ON public.zap_lead_integrations;
CREATE POLICY "zap_lead_integrations_admin_update"
  ON public.zap_lead_integrations
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "zap_lead_integrations_admin_delete"
  ON public.zap_lead_integrations;
CREATE POLICY "zap_lead_integrations_admin_delete"
  ON public.zap_lead_integrations
  FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.zap_lead_integrations TO authenticated;
