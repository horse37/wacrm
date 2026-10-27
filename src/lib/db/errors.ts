export const dbErrorCodes = [
  'unauthorized',
  'forbidden',
  'bad_request',
  'not_found',
  'conflict',
  'db_error',
] as const;

export type DbErrorCode = (typeof dbErrorCodes)[number];

export type AppErrorReason = 'insufficient_role';

const safeMessages: Record<DbErrorCode, string> = {
  unauthorized: 'Authentication is required.',
  forbidden: 'The operation is not allowed.',
  bad_request: 'The request is invalid.',
  not_found: 'The requested resource was not found.',
  conflict: 'The operation conflicts with existing data.',
  db_error: 'The database operation failed.',
};

export class AppError extends Error {
  readonly code: DbErrorCode;
  readonly sqlState: '42501' | undefined;
  readonly reason: AppErrorReason | undefined;
  readonly routine: string | undefined;

  constructor(
    code: DbErrorCode,
    sqlState?: '42501',
    reason?: AppErrorReason,
    routine?: string
  ) {
    super(safeMessages[code]);
    this.name = 'AppError';
    this.code = code;
    this.sqlState = sqlState;
    this.reason = reason;
    this.routine = routine;
    if (reason) {
      Object.defineProperty(this, 'reason', { enumerable: false });
    }
    if (routine) {
      Object.defineProperty(this, 'routine', { enumerable: false });
    }
  }
}

export type DbResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export function dbSuccess<T>(data: T): DbResult<T> {
  return { ok: true, data };
}

export function dbFailure(error: AppError): DbResult<never> {
  return { ok: false, error };
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    return new AppError('conflict');
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '22023'
  ) {
    return new AppError('bad_request');
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '42501'
  ) {
    const routine =
      'routine' in error && typeof error.routine === 'string'
        ? error.routine
        : undefined;
    return new AppError('db_error', '42501', undefined, routine);
  }
  return new AppError('db_error');
}
