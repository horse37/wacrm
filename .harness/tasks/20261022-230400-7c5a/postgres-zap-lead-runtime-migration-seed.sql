-- Synthetic rows for migration-parity validation on disposable PostgreSQL.
-- Disable only the test Auth trigger so IDs/accounts stay deterministic.
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'owner-a@example.test',
    '{"full_name":"Synthetic owner A"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'viewer-a@example.test',
    '{"full_name":"Synthetic viewer A"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'owner-b@example.test',
    '{"full_name":"Synthetic owner B"}'::jsonb
  );

INSERT INTO public.accounts (id, name, owner_user_id)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Synthetic account A',
    '00000000-0000-4000-8000-000000000001'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Synthetic account B',
    '00000000-0000-4000-8000-000000000003'
  );

INSERT INTO public.profiles (
  user_id,
  full_name,
  email,
  account_id,
  account_role
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'Synthetic owner A',
    'owner-a@example.test',
    '10000000-0000-4000-8000-000000000001',
    'owner'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'Synthetic viewer A',
    'viewer-a@example.test',
    '10000000-0000-4000-8000-000000000001',
    'viewer'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'Synthetic owner B',
    'owner-b@example.test',
    '10000000-0000-4000-8000-000000000002',
    'owner'
  );

ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

INSERT INTO public.zap_lead_integrations (
  account_id,
  api_base_url,
  key_id,
  encrypted_registration
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'https://synthetic-a.example.test',
    'ak_aaaaaaaaaaaaaaaaaaaaaaaa',
    'synthetic-encrypted-registration-a'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'https://synthetic-b.example.test',
    'ak_bbbbbbbbbbbbbbbbbbbbbbbb',
    'synthetic-encrypted-registration-b'
  );

INSERT INTO public.zap_lead_integration_state (
  account_id,
  integration_key_id,
  last_success_at,
  last_error_code,
  alert_sent_at,
  last_sse_cursor_id
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'ak_aaaaaaaaaaaaaaaaaaaaaaaa',
    '2026-10-20T09:00:00Z',
    'synthetic-a',
    '2026-10-20T09:05:00Z',
    '18fae01a-a5b8-4a7e-95af-453810e49dc9'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'ak_bbbbbbbbbbbbbbbbbbbbbbbb',
    '2026-10-20T10:00:00Z',
    'synthetic-b',
    '2026-10-20T10:05:00Z',
    '28fae01a-a5b8-4a7e-95af-453810e49dc9'
  );
