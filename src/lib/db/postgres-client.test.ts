import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, dbErrorCodes } from './errors';

const mocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(),
    connect: vi.fn(),
  };

  return { client, pool };
});

vi.mock('server-only', () => ({}));
vi.mock('./postgres-pool', () => ({
  getPostgresPool: () => mocks.pool,
}));

import { queryDb, withTransaction } from './postgres-client';

describe('PostgreSQL DB contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pool.connect.mockResolvedValue(mocks.client);
    mocks.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.client.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns query rows and count while keeping SQL values separate', async () => {
    const rows = [{ id: 'synthetic-id' }];
    mocks.pool.query.mockResolvedValue({ rows, rowCount: 1 });

    const result = await queryDb<{ id: string }>(
      'SELECT id FROM app.users WHERE id = $1',
      ['synthetic-id']
    );

    expect(mocks.pool.query).toHaveBeenCalledWith(
      'SELECT id FROM app.users WHERE id = $1',
      ['synthetic-id']
    );
    expect(result).toEqual({ ok: true, data: { rows, rowCount: 1 } });
  });

  it('maps unique violations to a safe conflict result', async () => {
    mocks.pool.query.mockRejectedValue(
      Object.assign(new Error('duplicate key detail'), { code: '23505' })
    );

    const result = await queryDb('INSERT INTO app.users (id) VALUES ($1)', [
      'synthetic-id',
    ]);

    expect(result).toEqual({
      ok: false,
      error: new AppError('conflict'),
    });
    expect(JSON.stringify(result)).not.toContain('duplicate key detail');
  });

  it('maps invalid parameter SQLSTATEs to a safe bad request', async () => {
    mocks.pool.query.mockRejectedValue(
      Object.assign(new Error('private parameter details'), { code: '22023' })
    );

    const result = await queryDb('SELECT public.rpc($1)', ['synthetic']);

    expect(result).toEqual({
      ok: false,
      error: new AppError('bad_request'),
    });
    expect(JSON.stringify(result)).not.toContain('private parameter details');
  });

  it('maps unknown database errors without exposing driver messages', async () => {
    mocks.pool.query.mockRejectedValue(new Error('private connection detail'));

    const result = await queryDb('SELECT 1');

    expect(result).toEqual({ ok: false, error: new AppError('db_error') });
    expect(JSON.stringify(result)).not.toContain('private connection detail');
  });

  it('exposes the planned domain and database error categories', () => {
    expect(dbErrorCodes).toEqual([
      'unauthorized',
      'forbidden',
      'bad_request',
      'not_found',
      'conflict',
      'db_error',
    ]);
  });

  it('commits a successful transaction and releases its client once', async () => {
    const rows = [{ id: 'synthetic-id' }];
    mocks.client.query.mockImplementation(async (text: string) =>
      text === 'SELECT id FROM app.users WHERE id = $1'
        ? { rows, rowCount: 1 }
        : { rows: [], rowCount: null }
    );

    const result = await withTransaction(async (transaction) => {
      const selected = await transaction.query<{ id: string }>(
        'SELECT id FROM app.users WHERE id = $1',
        ['synthetic-id']
      );
      return selected.rows[0]?.id;
    });

    expect(result).toEqual({ ok: true, data: 'synthetic-id' });
    expect(mocks.client.query.mock.calls.map(([text]) => text)).toEqual([
      'BEGIN',
      'SELECT id FROM app.users WHERE id = $1',
      'COMMIT',
    ]);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
    expect(mocks.client.release).toHaveBeenCalledWith(undefined);
  });

  it('rolls back a failed operation and preserves its typed error', async () => {
    const result = await withTransaction(async () => {
      throw new AppError('not_found');
    });

    expect(result).toEqual({ ok: false, error: new AppError('not_found') });
    expect(mocks.client.query.mock.calls.map(([text]) => text)).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it('maps transaction query failures and rolls the transaction back', async () => {
    mocks.client.query.mockImplementation(async (text: string) => {
      if (text.startsWith('INSERT')) {
        throw Object.assign(new Error('duplicate key detail'), {
          code: '23505',
        });
      }
      return { rows: [], rowCount: null };
    });

    const result = await withTransaction(async (transaction) => {
      await transaction.query('INSERT INTO app.users (id) VALUES ($1)', [
        'synthetic-id',
      ]);
      return 'unreachable';
    });

    expect(result).toEqual({ ok: false, error: new AppError('conflict') });
    expect(mocks.client.query.mock.calls.map(([text]) => text)).toEqual([
      'BEGIN',
      'INSERT INTO app.users (id) VALUES ($1)',
      'ROLLBACK',
    ]);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it('does not report success when the callback catches a transaction query error', async () => {
    mocks.client.query.mockImplementation(async (text: string) => {
      if (text.startsWith('INSERT')) {
        throw Object.assign(new Error('duplicate key detail'), {
          code: '23505',
        });
      }
      return { rows: [], rowCount: null };
    });

    const result = await withTransaction(async (transaction) => {
      try {
        await transaction.query('INSERT INTO app.users (id) VALUES ($1)', [
          'synthetic-id',
        ]);
      } catch {
        return 'callback swallowed query failure';
      }

      return 'insert succeeded';
    });

    expect(result).toEqual({ ok: false, error: new AppError('conflict') });
    expect(mocks.client.query.mock.calls.map(([text]) => text)).toEqual([
      'BEGIN',
      'INSERT INTO app.users (id) VALUES ($1)',
      'ROLLBACK',
    ]);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it('discards a client when rollback itself fails', async () => {
    const rollbackFailure = new Error('rollback connection detail');
    mocks.client.query.mockImplementation(async (text: string) => {
      if (text === 'ROLLBACK') throw rollbackFailure;
      return { rows: [], rowCount: null };
    });

    const result = await withTransaction(async () => {
      throw new AppError('conflict');
    });

    expect(result).toEqual({ ok: false, error: new AppError('db_error') });
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
    expect(mocks.client.release).toHaveBeenCalledWith(rollbackFailure);
  });

  it('releases a client if BEGIN fails without claiming a rollback', async () => {
    mocks.client.query.mockRejectedValueOnce(new Error('begin failed'));

    const result = await withTransaction(async () => 'unreachable');

    expect(result).toEqual({ ok: false, error: new AppError('db_error') });
    expect(mocks.client.query.mock.calls.map(([text]) => text)).toEqual([
      'BEGIN',
    ]);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });
});
