export function isAllowedDashboardHost(hostHeader, port) {
  if (typeof hostHeader !== 'string' || !Number.isInteger(port)) return false;

  const match = /^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i.exec(
    hostHeader.trim()
  );
  if (!match) return false;

  return !match[2] || Number(match[2]) === port;
}

export function renderDashboardPage(template, bootstrap) {
  return template.replace('__INITIAL_STATUS__', () => bootstrap);
}
