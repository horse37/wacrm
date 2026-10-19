'use client';

import { useRef, useState, type SyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';

type FormState =
  | 'idle'
  | 'pending'
  | 'success'
  | 'error'
  | 'unavailable'
  | 'forbidden';

export function ZapLeadLeadForm() {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const payloadFingerprint = useRef<string | null>(null);
  const [state, setState] = useState<FormState>('idle');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      contactName: String(values.get('contactName') ?? '').trim(),
      phone: String(values.get('phone') ?? '').trim(),
      ...(String(values.get('email') ?? '').trim()
        ? { email: String(values.get('email')).trim() }
        : {}),
      ...(String(values.get('campaignCode') ?? '').trim()
        ? { campaignCode: String(values.get('campaignCode')).trim() }
        : {}),
    };
    const fingerprint = JSON.stringify(payload);
    let requestKey = idempotencyKey.current;
    if (requestKey === null || payloadFingerprint.current !== fingerprint) {
      requestKey = crypto.randomUUID();
      idempotencyKey.current = requestKey;
      payloadFingerprint.current = fingerprint;
    }

    setState('pending');
    try {
      const response = await fetch('/api/zap-lead/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestKey,
        },
        body: fingerprint,
        cache: 'no-store',
      });
      if (response.status === 404) {
        setState('unavailable');
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) throw new Error('Lead submission failed');

      form.reset();
      idempotencyKey.current = null;
      payloadFingerprint.current = null;
      setState('success');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <section className="border-border bg-card rounded-xl border p-5 shadow-sm">
      <h2 className="text-foreground text-lg font-semibold">Cadastrar lead</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Os dados são enviados ao Zap Lead e não ficam salvos nesta agência.
      </p>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="grid gap-1 text-sm">
          <span>Nome</span>
          <input
            autoComplete="name"
            className="border-input bg-background rounded-md border px-3 py-2"
            maxLength={160}
            name="contactName"
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Telefone com código do país</span>
          <input
            autoComplete="tel"
            className="border-input bg-background rounded-md border px-3 py-2"
            maxLength={16}
            name="phone"
            pattern="\+[1-9][0-9]{7,14}"
            placeholder="+5511999990101"
            required
            title="Use formato internacional, por exemplo +5511999990101"
            type="tel"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>E-mail (opcional)</span>
          <input
            autoComplete="email"
            className="border-input bg-background rounded-md border px-3 py-2"
            maxLength={254}
            name="email"
            type="email"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Código da campanha (opcional)</span>
          <input
            className="border-input bg-background rounded-md border px-3 py-2"
            maxLength={80}
            name="campaignCode"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            disabled={state === 'pending'}
            type="submit"
          >
            {state === 'pending' ? 'Enviando…' : 'Enviar lead'}
          </button>
          {state === 'success' && (
            <p className="mt-3 text-sm" role="status">
              Lead enviado ao Zap Lead.
            </p>
          )}
          {state === 'unavailable' && (
            <p className="text-destructive mt-3 text-sm" role="alert">
              Configure a integração Zap Lead antes de enviar leads.
            </p>
          )}
          {state === 'forbidden' && (
            <p className="text-destructive mt-3 text-sm" role="alert">
              Seu perfil não tem permissão para cadastrar leads.
            </p>
          )}
          {state === 'error' && (
            <p className="text-destructive mt-3 text-sm" role="alert">
              Não foi possível enviar o lead. Tente novamente.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
