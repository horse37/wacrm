import 'server-only';

import type { QueryResultRow } from 'pg';
import type { Contact } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface ContactListPageOptions {
  page: number;
  pageSize?: number;
  search?: string;
}

interface ContactListRow extends QueryResultRow {
  total_count: string;
  id: string | null;
  user_id: string | null;
  account_id: string | null;
  phone: string | null;
  phone_normalized: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function uuidString(value: unknown): string {
  if (!isUuid(value)) throw new AppError('db_error');
  return value.toLowerCase();
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value);
}

function timestampString(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function parseCount(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new AppError('db_error');
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new AppError('db_error');
  return count;
}

function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function normalizeOptions(options: ContactListPageOptions): {
  pageSize: number;
  offset: number;
  searchPattern: string | null;
} {
  if (!options || typeof options !== 'object')
    throw new AppError('bad_request');

  const { page, search } = options;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new AppError('bad_request');
  }

  const offset = page * pageSize;
  if (!Number.isSafeInteger(offset)) throw new AppError('bad_request');
  if (search !== undefined && typeof search !== 'string') {
    throw new AppError('bad_request');
  }

  const trimmedSearch = search?.trim();
  const searchPattern = trimmedSearch
    ? `%${escapeLikeLiteral(trimmedSearch)}%`
    : null;

  return { pageSize, offset, searchPattern };
}

function hasContactProjection(row: ContactListRow): boolean {
  return [
    row.user_id,
    row.account_id,
    row.phone,
    row.phone_normalized,
    row.name,
    row.email,
    row.company,
    row.avatar_url,
    row.created_at,
    row.updated_at,
  ].some((value) => value !== null);
}

function toContact(row: ContactListRow, accountId: string): Contact {
  const id = uuidString(row.id);
  const userId = uuidString(row.user_id);
  const rowAccountId = uuidString(row.account_id);
  if (rowAccountId !== accountId.toLowerCase()) throw new AppError('db_error');

  return {
    id,
    user_id: userId,
    account_id: rowAccountId,
    phone: requiredString(row.phone),
    phone_normalized: optionalString(row.phone_normalized),
    name: optionalString(row.name),
    email: optionalString(row.email),
    company: optionalString(row.company),
    avatar_url: optionalString(row.avatar_url),
    created_at: timestampString(row.created_at),
    updated_at: timestampString(row.updated_at),
  };
}

/** Read one account-scoped contacts page and its exact count from one snapshot. */
export function createPostgresContactListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  listPage: (
    options: ContactListPageOptions
  ) => Promise<{ contacts: Contact[]; totalCount: number }>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listPage(
    options: ContactListPageOptions
  ): Promise<{ contacts: Contact[]; totalCount: number }> {
    const context = await guards.requireAccount();
    const normalized = normalizeOptions(options);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ContactListRow>(
        `WITH filtered AS MATERIALIZED (
           SELECT
             c.id,
             c.user_id,
             c.account_id,
             c.phone,
             c.phone_normalized,
             c.name,
             c.email,
             c.company,
             c.avatar_url,
             c.created_at,
             c.updated_at
           FROM public.contacts AS c
           WHERE c.account_id = $1
             AND (
               $2::text IS NULL
               OR c.name ILIKE $2 ESCAPE E'\\\\'
               OR c.phone ILIKE $2 ESCAPE E'\\\\'
               OR c.email ILIKE $2 ESCAPE E'\\\\'
             )
         ),
         page AS MATERIALIZED (
           SELECT *
           FROM filtered AS c
           ORDER BY c.created_at DESC NULLS FIRST, c.id ASC
           LIMIT $3 OFFSET $4
         )
         SELECT
           (SELECT COUNT(*)::text FROM filtered) AS total_count,
           p.id::text AS id,
           p.user_id::text AS user_id,
           p.account_id::text AS account_id,
           p.phone,
           p.phone_normalized,
           p.name,
           p.email,
           p.company,
           p.avatar_url,
           p.created_at,
           p.updated_at
         FROM (VALUES (true)) AS result_anchor(singleton)
         LEFT JOIN page AS p ON TRUE
         ORDER BY p.created_at DESC NULLS FIRST, p.id ASC`,
        [
          context.accountId,
          normalized.searchPattern,
          normalized.pageSize,
          normalized.offset,
        ]
      );

      if (query.rows.length === 0) throw new AppError('db_error');
      const totalCount = parseCount(query.rows[0].total_count);
      const contacts = query.rows.flatMap((row) => {
        if (parseCount(row.total_count) !== totalCount) {
          throw new AppError('db_error');
        }
        if (row.id === null) {
          if (hasContactProjection(row)) throw new AppError('db_error');
          return [];
        }
        return [toContact(row, context.accountId)];
      });

      return { contacts, totalCount };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listPage };
}
