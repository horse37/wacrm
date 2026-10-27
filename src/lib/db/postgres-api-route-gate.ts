const postgresBackedRoutePrefixes = [
  '/api/account',
  '/api/automations',
  '/api/flows',
  '/api/invitations',
  '/api/whatsapp',
  '/api/zap-lead/events',
  '/api/zap-lead/registration',
] as const;

export const postgresAppApiEnabledEnv = 'WACRM_POSTGRES_APP_API_ENABLED';

export function isPostgresBackedApiPath(pathname: string): boolean {
  return postgresBackedRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function shouldBlockPostgresBackedApi(
  pathname: string,
  environment: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return (
    isPostgresBackedApiPath(pathname) &&
    environment[postgresAppApiEnabledEnv] !== '1'
  );
}
