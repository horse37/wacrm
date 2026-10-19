'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

interface IntegrationStatus {
  configured: boolean;
  apiBaseUrl: string | null;
  generation: string | null;
  heartbeat: {
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastErrorCode: string | null;
    alertSentAt: string | null;
  };
}

type LiveConnectionState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

interface RealtimeNotice {
  eventType: 'conversation.message.created' | 'lead.stage.changed';
  occurredAt: string;
}

interface RegistrationResponse {
  registrationCode: string;
  webhookUrl: string;
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || 'The request could not be completed.';
}

export function ZapLeadIntegrationPanel() {
  const [status, setStatus] = useState<IntegrationStatus>({
    configured: false,
    apiBaseUrl: null,
    generation: null,
    heartbeat: {
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      alertSentAt: null,
    },
  });
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [registration, setRegistration] = useState<RegistrationResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [liveConnection, setLiveConnection] =
    useState<LiveConnectionState>('disabled');
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [realtimeNotice, setRealtimeNotice] = useState<RealtimeNotice | null>(
    null
  );
  const latestHeartbeatFailure =
    status.heartbeat.lastFailureAt &&
    (!status.heartbeat.lastSuccessAt ||
      Date.parse(status.heartbeat.lastFailureAt) >
        Date.parse(status.heartbeat.lastSuccessAt));

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch('/api/zap-lead/registration', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error(await readError(response));
      const next = (await response.json()) as IntegrationStatus;
      setStatus(next);
      setApiBaseUrl(next.apiBaseUrl ?? '');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error(
        error instanceof Error ? error.message : 'Could not load integration.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch('/api/zap-lead/registration', {
            cache: 'no-store',
          });
          if (response.ok) {
            setStatus((await response.json()) as IntegrationStatus);
          }
        } catch {
          // Keep the last known heartbeat until the next status refresh.
        }
      })();
    }, 60_000);

    if (!status.configured) {
      setLiveConnection('disabled');
      setRealtimeNotice(null);
      return () => window.clearInterval(refreshTimer);
    }

    setRealtimeNotice(null);
    setLiveConnection('connecting');
    const source = new EventSource('/api/zap-lead/events/stream');
    const markConnected = () => setLiveConnection('connected');
    const handleEvent = (event: Event) => {
      markConnected();
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          eventType?: unknown;
          occurredAt?: unknown;
        };
        if (
          (payload.eventType === 'conversation.message.created' ||
            payload.eventType === 'lead.stage.changed') &&
          typeof payload.occurredAt === 'string'
        ) {
          setRealtimeNotice({
            eventType: payload.eventType,
            occurredAt: payload.occurredAt,
          });
        }
      } catch {
        // Ignore malformed local stream notifications.
      }
    };

    source.onopen = markConnected;
    source.onerror = () => setLiveConnection('reconnecting');
    source.addEventListener('ready', markConnected);
    source.addEventListener('resync', () => {
      setLiveConnection('reconnecting');
    });
    source.addEventListener('conversation.message.created', handleEvent);
    source.addEventListener('lead.stage.changed', handleEvent);

    return () => {
      window.clearInterval(refreshTimer);
      source.close();
    };
  }, [status.configured, status.generation, connectionVersion]);

  async function generateCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setRegistration(null);
    setCopied(false);
    try {
      const response = await fetch('/api/zap-lead/registration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as RegistrationResponse;
      setRegistration(payload);
      setStatus({
        configured: true,
        apiBaseUrl,
        generation: null,
        heartbeat: {
          lastSuccessAt: null,
          lastFailureAt: null,
          lastErrorCode: null,
          alertSentAt: null,
        },
      });
      setConnectionVersion((version) => version + 1);
      toast.success('Registration code generated. Copy it into Zap Lead now.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not generate code.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyCode() {
    if (!registration) return;
    try {
      await navigator.clipboard.writeText(registration.registrationCode);
      setCopied(true);
      toast.success('Registration code copied.');
    } catch {
      toast.error('Clipboard access is unavailable. Select and copy the code.');
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setRegistration(null);
    try {
      const response = await fetch('/api/zap-lead/registration', {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await readError(response));
      setStatus({
        configured: false,
        apiBaseUrl: null,
        generation: null,
        heartbeat: {
          lastSuccessAt: null,
          lastFailureAt: null,
          lastErrorCode: null,
          alertSentAt: null,
        },
      });
      setApiBaseUrl('');
      toast.success('Zap Lead credentials removed from this account.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not disconnect Zap Lead.'
      );
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section className="space-y-6">
      <SettingsPanelHead
        title="Zap Lead integration"
        description="Connect this workspace to a Zap Lead installation."
      />

      <Card>
        <CardHeader>
          <CardTitle>Installation registration</CardTitle>
          <CardDescription>
            Generate a private registration code for one Zap Lead installation.
            Only account admins can create or remove this connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${status.configured ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
            />
            {loading
              ? 'Checking saved configuration…'
              : status.configured
                ? 'Credentials are stored for this workspace.'
                : 'No installation is registered.'}
          </div>

          {status.configured ? (
            <div className="border-border space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">Live updates</span>
                <span aria-live="polite" className="text-muted-foreground">
                  {liveConnection === 'connected'
                    ? 'Connected'
                    : liveConnection === 'reconnecting'
                      ? 'Reconnecting…'
                      : 'Connecting…'}
                </span>
              </div>
              {realtimeNotice ? (
                <p className="text-muted-foreground text-xs">
                  Last event: {realtimeNotice.eventType} at{' '}
                  {new Date(realtimeNotice.occurredAt).toLocaleString()}.
                </p>
              ) : null}

              <div className="space-y-2">
                <h3 className="text-sm font-medium">Heartbeat</h3>
                {status.heartbeat.alertSentAt ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      No successful heartbeat for over 10 minutes
                    </AlertTitle>
                    <AlertDescription>
                      Alert raised at{' '}
                      {new Date(status.heartbeat.alertSentAt).toLocaleString()}.
                      {status.heartbeat.lastErrorCode
                        ? ` Last check: ${status.heartbeat.lastErrorCode}.`
                        : ''}
                    </AlertDescription>
                  </Alert>
                ) : latestHeartbeatFailure ? (
                  <p className="text-muted-foreground text-sm">
                    Last heartbeat check failed at{' '}
                    {new Date(status.heartbeat.lastFailureAt!).toLocaleString()}
                    .
                  </p>
                ) : status.heartbeat.lastSuccessAt ? (
                  <p className="text-muted-foreground text-sm">
                    Last successful check:{' '}
                    {new Date(status.heartbeat.lastSuccessAt).toLocaleString()}.
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Waiting for the first heartbeat check.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={generateCode}>
            <div className="space-y-2">
              <Label htmlFor="zap-lead-api-url">Zap Lead public URL</Label>
              <Input
                id="zap-lead-api-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://zap-lead.example.com"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                required
                disabled={loading || saving || disconnecting}
              />
              <p className="text-muted-foreground text-xs">
                Enter the HTTPS origin only, without a path or query string.
              </p>
            </div>

            <Button
              type="submit"
              disabled={
                loading || saving || disconnecting || !apiBaseUrl.trim()
              }
            >
              {saving ? <Loader2 className="animate-spin" /> : null}
              {status.configured
                ? 'Generate replacement code'
                : 'Generate registration code'}
            </Button>
          </form>

          {registration ? (
            <Alert>
              <AlertTitle>Copy this code into Zap Lead now</AlertTitle>
              <AlertDescription>
                It contains a secret and appears only in this response. Paste it
                into Zap Lead under Settings → Agency. Generating a replacement
                switches this workspace to the new credential immediately.
              </AlertDescription>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <textarea
                  aria-label="Zap Lead registration code"
                  className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 font-mono text-xs break-all"
                  readOnly
                  value={registration.registrationCode}
                />
                <Button type="button" variant="outline" onClick={copyCode}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Copied' : 'Copy code'}
                </Button>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                Webhook destination: {registration.webhookUrl}
              </p>
            </Alert>
          ) : null}

          {status.configured ? (
            <div className="border-border border-t pt-4">
              <Button
                type="button"
                variant="destructive"
                onClick={disconnect}
                disabled={loading || saving || disconnecting}
              >
                {disconnecting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
                Remove saved credentials
              </Button>
              <p className="text-muted-foreground mt-2 text-xs">
                This removes credentials from this workspace. Disconnect the
                installation in Zap Lead too to stop webhook delivery.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
