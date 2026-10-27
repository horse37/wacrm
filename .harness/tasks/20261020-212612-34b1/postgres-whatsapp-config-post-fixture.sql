ALTER TABLE public.whatsapp_config
  ADD COLUMN user_id uuid,
  ADD COLUMN connected_at timestamptz,
  ADD COLUMN registered_at timestamptz,
  ADD COLUMN subscribed_apps_at timestamptz,
  ADD COLUMN last_registration_error text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.profiles
SET account_role = 'admin'
WHERE user_id = '00000000-0000-4000-8000-000000000004';
INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  (
    '00000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    'admin'
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    'agent'
  );

UPDATE public.whatsapp_config AS config
SET user_id = profile.user_id,
    connected_at = '2026-10-20T12:00:00Z'
FROM public.profiles AS profile
WHERE profile.account_id = config.account_id
  AND profile.account_role = 'owner';

UPDATE public.whatsapp_config
SET registered_at = '2026-10-19T12:00:00Z'
WHERE account_id = '10000000-0000-4000-8000-000000000001';
UPDATE public.whatsapp_config
SET user_id = '00000000-0000-4000-8000-000000000005'
WHERE account_id = '10000000-0000-4000-8000-000000000001';

ALTER TABLE public.whatsapp_config
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN user_id SET NOT NULL,
  ADD CONSTRAINT whatsapp_config_phone_number_id_key UNIQUE (phone_number_id);

CREATE POLICY whatsapp_config_insert_admin
  ON public.whatsapp_config FOR INSERT TO wacrm_whatsapp_config_runtime
  WITH CHECK (public.is_account_member(account_id, 'admin'));

CREATE POLICY whatsapp_config_update_admin
  ON public.whatsapp_config FOR UPDATE TO wacrm_whatsapp_config_runtime
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

GRANT INSERT (
  account_id,
  user_id,
  phone_number_id,
  waba_id,
  access_token,
  verify_token,
  status,
  connected_at,
  registered_at,
  subscribed_apps_at,
  last_registration_error,
  updated_at
) ON public.whatsapp_config TO wacrm_whatsapp_config_runtime;

GRANT UPDATE (
  phone_number_id,
  waba_id,
  access_token,
  verify_token,
  status,
  connected_at,
  registered_at,
  subscribed_apps_at,
  last_registration_error,
  updated_at
) ON public.whatsapp_config TO wacrm_whatsapp_config_runtime;
