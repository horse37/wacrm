import 'server-only';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { AppError, dbFailure, dbSuccess, toAppError } from './errors';
import type { DbResult } from './errors';
import { getPostgresPool } from './postgres-pool';

export interface DbQueryResult<Row extends QueryResultRow> {
  rows: Row[];
  rowCount: number | null;
}

export interface DbTransaction {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<DbQueryResult<Row>>;
}

export async function queryDb<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = []
): Promise<DbResult<DbQueryResult<Row>>> {
  try {
    const result = await getPostgresPool().query<Row>(text, [...values]);
    return dbSuccess({ rows: result.rows, rowCount: result.rowCount });
  } catch (error) {
    return dbFailure(toAppError(error));
  }
}

export async function withTransaction<T>(
  operation: (transaction: DbTransaction) => Promise<T>
): Promise<DbResult<T>> {
  let client: PoolClient | undefined;
  let transactionStarted = false;
  let releaseError: Error | undefined;
  let transactionQueryError: AppError | undefined;

  try {
    client = await getPostgresPool().connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const transaction: DbTransaction = {
      async query<Row extends QueryResultRow = QueryResultRow>(
        text: string,
        values: readonly unknown[] = []
      ): Promise<DbQueryResult<Row>> {
        try {
          const result: QueryResult<Row> = await client!.query<Row>(text, [
            ...values,
          ]);
          return { rows: result.rows, rowCount: result.rowCount };
        } catch (error) {
          const appError = toAppError(error);
          transactionQueryError ??= appError;
          throw appError;
        }
      },
    };

    const data = await operation(transaction);
    if (transactionQueryError) throw transactionQueryError;
    await client.query('COMMIT');
    transactionStarted = false;
    return dbSuccess(data);
  } catch (error) {
    let resultError = transactionQueryError ?? toAppError(error);

    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
        transactionStarted = false;
      } catch (rollbackError) {
        releaseError =
          rollbackError instanceof Error
            ? rollbackError
            : new Error('PostgreSQL transaction rollback failed');
        resultError = new AppError('db_error');
      }
    }

    return dbFailure(resultError);
  } finally {
    client?.release(releaseError);
  }
}
