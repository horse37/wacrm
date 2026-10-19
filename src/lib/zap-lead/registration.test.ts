import { describe, expect, it } from 'vitest';
import {
  createRegistrationCode,
  generateZapLeadRegistration,
  parseRegistrationCode,
  type ZapLeadRegistration,
} from './registration';

const registration: ZapLeadRegistration = {
  version: 1,
  keyId: 'ak_000000000000000000000000',
  secret: 'test_secret_for_local_fixture_0001',
  webhookUrl: 'https://agency.example.test/api/zap-lead/webhook',
  events: ['lead.created', 'analysis.completed'],
};

describe('Zap Lead registration code', () => {
  it('round-trips the versioned payload without changing UTF-8 values', () => {
    const code = createRegistrationCode(registration);

    expect(code.startsWith('zap-lead-agency:v1:')).toBe(true);
    expect(parseRegistrationCode(code)).toEqual(registration);
  });

  it('rejects a code with another prefix', () => {
    expect(() => parseRegistrationCode('other:v1:abc')).toThrow(
      'Invalid Zap Lead registration code'
    );
  });

  it('rejects malformed or incomplete payloads', () => {
    expect(() => parseRegistrationCode('zap-lead-agency:v1:%%%')).toThrow(
      'Invalid Zap Lead registration code'
    );
    expect(() =>
      createRegistrationCode({ ...registration, secret: 'short' })
    ).toThrow('Invalid Zap Lead registration payload');
    expect(() =>
      createRegistrationCode({
        ...registration,
        events: ['unrecognized.event'],
      })
    ).toThrow('Invalid Zap Lead registration payload');
  });

  it('generates a fresh registration code with the selected webhook and allowed events', () => {
    const first = generateZapLeadRegistration(
      'https://agency.example.test/api/zap-lead/webhook'
    );
    const second = generateZapLeadRegistration(
      'https://agency.example.test/api/zap-lead/webhook'
    );
    const parsed = parseRegistrationCode(first);

    expect(parsed.webhookUrl).toBe(
      'https://agency.example.test/api/zap-lead/webhook'
    );
    expect(parsed.events).toEqual([
      'lead.created',
      'lead.stage.changed',
      'lead.stage.pending_confirmation',
      'response.deadline.exceeded',
      'lead.assigned',
      'seller.channel.disconnected',
      'analysis.completed',
    ]);
    expect(parsed.keyId).toMatch(/^ak_[\da-f]{24}$/);
    expect(parsed.secret).toMatch(/^[A-Za-z\d_-]{32,128}$/);
    expect(second).not.toBe(first);
  });
});
