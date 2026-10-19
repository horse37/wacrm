import { getZapLeadHealthTargets } from './credentials';
import {
  claimZapLeadHeartbeatAlert,
  recordZapLeadHealthFailure,
  recordZapLeadHealthSuccess,
} from './events';

export interface ZapLeadHeartbeatSweepResult {
  checked: number;
  healthy: number;
  failed: number;
  alertsRaised: number;
}

export async function runZapLeadHeartbeatSweep(
  now = new Date()
): Promise<ZapLeadHeartbeatSweepResult> {
  const targets = await getZapLeadHealthTargets();
  const result: ZapLeadHeartbeatSweepResult = {
    checked: 0,
    healthy: 0,
    failed: 0,
    alertsRaised: 0,
  };

  for (let offset = 0; offset < targets.length; offset += 10) {
    const batch = targets.slice(offset, offset + 10);
    await Promise.all(
      batch.map(async (target) => {
        let healthy = false;
        if (target.client) {
          try {
            await target.client.request(
              'GET',
              '/api/agency/v1/health',
              undefined,
              {
                expectedStatus: 200,
              }
            );
            const current = await recordZapLeadHealthSuccess(
              target.accountId,
              target.keyId,
              now
            );
            if (!current) return;
            healthy = true;
          } catch {
            const current = await recordZapLeadHealthFailure(
              target.accountId,
              target.keyId,
              'health_request_failed',
              now
            );
            if (!current) return;
          }
        } else {
          const current = await recordZapLeadHealthFailure(
            target.accountId,
            target.keyId,
            'invalid_credentials',
            now
          );
          if (!current) return;
        }

        const alertRaised = await claimZapLeadHeartbeatAlert(
          target.accountId,
          target.keyId,
          now
        );
        result.checked += 1;
        if (healthy) result.healthy += 1;
        else result.failed += 1;
        if (alertRaised) result.alertsRaised += 1;
      })
    );
  }

  return result;
}
