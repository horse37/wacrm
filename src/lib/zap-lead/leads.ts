import { z } from 'zod';
import {
  getZapLeadReadClientForCurrentAccount,
  getZapLeadWriteClientForCurrentAccount,
} from './credentials';

const leadCaptureRequestSchema = z
  .object({
    contactName: z.string().trim().min(1).max(160),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    email: z.email().optional(),
    campaignCode: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);

const agencyPageCursorSchema = z
  .object({
    at: z.iso.datetime(),
    id: z.uuid(),
  })
  .strict();

function isValidAgencyPageCursor(cursor: string): boolean {
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor) return false;
    return agencyPageCursorSchema.safeParse(
      JSON.parse(decoded.toString('utf8'))
    ).success;
  } catch {
    return false;
  }
}

const leadListQuerySchema = z
  .object({
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .refine(isValidAgencyPageCursor)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const leadSummarySchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  name: z.string(),
  phone: z.string(),
  stage: z.object({ name: z.string() }).nullable(),
  sellerId: z.uuid().nullable(),
  departmentId: z.uuid().nullable(),
  campaignCode: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const leadPageResponseSchema = z.object({
  apiVersion: z.string(),
  data: z.object({
    items: z.array(leadSummarySchema),
    nextCursor: z.string().nullable(),
  }),
});

const leadDetailResponseSchema = z.object({
  apiVersion: z.string(),
  data: leadSummarySchema.extend({
    email: z.email().nullable(),
  }),
});

export type ZapLeadSummary = z.infer<typeof leadSummarySchema>;
export type ZapLeadDetail = z.infer<typeof leadDetailResponseSchema>['data'];
export type ZapLeadPage = z.infer<typeof leadPageResponseSchema>['data'];
const AGENCY_LEADS_PATH = '/api/agency/v1/leads';

export async function listZapLeadLeads(
  input: unknown = {}
): Promise<ZapLeadPage | null> {
  const query = leadListQuerySchema.parse(input);
  const client = await getZapLeadReadClientForCurrentAccount();
  if (!client) return null;

  const search = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) search.set('cursor', query.cursor);

  const response = await client.get<unknown>(`${AGENCY_LEADS_PATH}?${search.toString()}`);
  return leadPageResponseSchema.parse(response).data;
}

export async function getZapLeadLeadDetail(
  leadId: string
): Promise<ZapLeadDetail | null> {
  const id = z.uuid().parse(leadId);
  const client = await getZapLeadReadClientForCurrentAccount();
  if (!client) return null;

  const response = await client.get<unknown>(`${AGENCY_LEADS_PATH}/${id}`);
  return leadDetailResponseSchema.parse(response).data;
}

export async function createZapLeadLeadForCurrentAccount(
  input: unknown,
  idempotencyKey: string
): Promise<string | null> {
  const lead = leadCaptureRequestSchema.parse(input);
  const key = idempotencyKeySchema.parse(idempotencyKey);
  const client = await getZapLeadWriteClientForCurrentAccount();
  if (!client) return null;

  const response = await client.createLead<unknown>(
    { ...lead, source: 'wacrm_form' },
    key
  );
  return leadDetailResponseSchema.parse(response).data.id;
}
