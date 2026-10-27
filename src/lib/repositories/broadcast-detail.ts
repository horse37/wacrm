import 'server-only';

import type { QueryResultRow } from 'pg';
import type { BroadcastStatus, RecipientStatus } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface BroadcastDetail {
  id: string;
  name: string;
  template_name: string;
  status: BroadcastStatus;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  created_at: string;
}

export interface BroadcastDetailContact {
  name: string | null;
  phone: string;
}

export interface BroadcastDetailRecipient {
  id: string;
  status: RecipientStatus;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  error_message: string | null;
  contact: BroadcastDetailContact | null;
}

export interface BroadcastDetailData {
  broadcast: BroadcastDetail;
  recipients: BroadcastDetailRecipient[];
}

interface BroadcastDetailRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  template_name: string | null;
  status: string | null;
  total_recipients: number | string | null;
  sent_count: number | string | null;
  delivered_count: number | string | null;
  read_count: number | string | null;
  replied_count: number | string | null;
  failed_count: number | string | null;
  created_at: string | null;
}

interface BroadcastDetailRecipientRow extends QueryResultRow {
  id: string | null;
  broadcast_id: string | null;
  contact_id: string | null;
  status: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  error_message: string | null;
  joined_contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

const broadcastStatuses = new Set<BroadcastStatus>([
  'draft',
  'scheduled',
  'sending',
  'sent',
  'failed',
]);
const recipientStatuses = new Set<RecipientStatus>([
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
]);

function uuidString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function requestedUuid(value: unknown): string {
  try {
    return uuidString(value);
  } catch {
    throw new AppError('bad_request');
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function broadcastStatus(value: unknown): BroadcastStatus {
  if (
    typeof value !== 'string' ||
    !broadcastStatuses.has(value as BroadcastStatus)
  ) {
    throw new AppError('db_error');
  }
  return value as BroadcastStatus;
}

function recipientStatus(value: unknown): RecipientStatus {
  if (
    typeof value !== 'string' ||
    !recipientStatuses.has(value as RecipientStatus)
  ) {
    throw new AppError('db_error');
  }
  return value as RecipientStatus;
}

function nonNegativeInteger(value: unknown): number {
  const count = typeof value === 'string' ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new AppError('db_error');
  }
  return count;
}

function timestampString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new AppError('db_error');
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return timestampString(value);
}

function toBroadcastDetail(
  row: BroadcastDetailRow,
  expectedId: string
): BroadcastDetail {
  const id = uuidString(row.id);
  if (id !== expectedId) throw new AppError('db_error');

  return {
    id,
    name: requiredString(row.name),
    template_name: requiredString(row.template_name),
    status: broadcastStatus(row.status),
    total_recipients: nonNegativeInteger(row.total_recipients),
    sent_count: nonNegativeInteger(row.sent_count),
    delivered_count: nonNegativeInteger(row.delivered_count),
    read_count: nonNegativeInteger(row.read_count),
    replied_count: nonNegativeInteger(row.replied_count),
    failed_count: nonNegativeInteger(row.failed_count),
    created_at: timestampString(row.created_at),
  };
}

function toBroadcastDetailRecipient(
  row: BroadcastDetailRecipientRow,
  expectedBroadcastId: string
): BroadcastDetailRecipient {
  const id = uuidString(row.id);
  if (uuidString(row.broadcast_id) !== expectedBroadcastId) {
    throw new AppError('db_error');
  }

  const contactId = row.contact_id === null ? null : uuidString(row.contact_id);
  const joinedContactId =
    row.joined_contact_id === null ? null : uuidString(row.joined_contact_id);
  let contact: BroadcastDetailContact | null = null;
  if (joinedContactId !== null) {
    if (contactId === null || joinedContactId !== contactId) {
      throw new AppError('db_error');
    }
    contact = {
      name: optionalString(row.contact_name),
      phone: requiredString(row.contact_phone),
    };
  } else if (row.contact_name !== null || row.contact_phone !== null) {
    throw new AppError('db_error');
  }

  return {
    id,
    status: recipientStatus(row.status),
    sent_at: optionalTimestamp(row.sent_at),
    delivered_at: optionalTimestamp(row.delivered_at),
    read_at: optionalTimestamp(row.read_at),
    replied_at: optionalTimestamp(row.replied_at),
    error_message: optionalString(row.error_message),
    contact,
  };
}

/** Load the minimal header and recipient history for one account broadcast. */
export function createPostgresBroadcastDetailRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  getForBroadcast: (broadcastId: string) => Promise<BroadcastDetailData>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function getForBroadcast(
    broadcastIdInput: string
  ): Promise<BroadcastDetailData> {
    const context = await guards.requireAccount();
    const broadcastId = requestedUuid(broadcastIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const parentQuery = await transaction.query<BroadcastDetailRow>(
        `SELECT
           b.id::text AS id,
           b.name,
           b.template_name,
           b.status,
           b.total_recipients,
           b.sent_count,
           b.delivered_count,
           b.read_count,
           b.replied_count,
           b.failed_count,
           CASE
             WHEN b.created_at IS NULL THEN NULL
             ELSE to_char(
               b.created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           END AS created_at
         FROM public.broadcasts AS b
         WHERE b.account_id = $1
           AND b.id = $2
         LIMIT 2`,
        [context.accountId, broadcastId]
      );

      if (parentQuery.rows.length === 0) throw new AppError('not_found');
      if (parentQuery.rows.length !== 1) throw new AppError('conflict');
      const broadcast = toBroadcastDetail(parentQuery.rows[0], broadcastId);

      const recipientsQuery =
        await transaction.query<BroadcastDetailRecipientRow>(
          `SELECT
           r.id::text AS id,
           r.broadcast_id::text AS broadcast_id,
           r.contact_id::text AS contact_id,
           r.status,
           CASE
             WHEN r.sent_at IS NULL THEN NULL
             ELSE to_char(
               r.sent_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           END AS sent_at,
           CASE
             WHEN r.delivered_at IS NULL THEN NULL
             ELSE to_char(
               r.delivered_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           END AS delivered_at,
           CASE
             WHEN r.read_at IS NULL THEN NULL
             ELSE to_char(
               r.read_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           END AS read_at,
           CASE
             WHEN r.replied_at IS NULL THEN NULL
             ELSE to_char(
               r.replied_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           END AS replied_at,
           r.error_message,
           c.id::text AS joined_contact_id,
           c.name AS contact_name,
           c.phone AS contact_phone
         FROM public.broadcast_recipients AS r
         INNER JOIN public.broadcasts AS b
           ON b.id = r.broadcast_id
         LEFT JOIN public.contacts AS c
           ON c.id = r.contact_id
          AND c.account_id = b.account_id
         WHERE r.broadcast_id = $1
           AND b.id = $1
           AND b.account_id = $2
         ORDER BY r.created_at DESC, r.id DESC`,
          [broadcastId, context.accountId]
        );

      return {
        broadcast,
        recipients: recipientsQuery.rows.map((row) =>
          toBroadcastDetailRecipient(row, broadcastId)
        ),
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { getForBroadcast };
}
