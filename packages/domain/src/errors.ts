export type DomainErrorCode =
  | 'IDENTITY_CONFLICT'
  | 'RECURRENCE_INVALID_DATE'
  | 'RECURRENCE_INVALID_MONTH_DAY'
  | 'RECURRENCE_INVALID_RANGE'
  | 'RECURRENCE_INVALID_WEEKDAYS'
  | 'REMINDER_INVALID_STATE'
  | 'REMINDER_REQUIRES_DUE_TIME'
  | 'REMINDER_TASK_INACTIVE'
  | 'REMINDER_TOO_LATE'
  | 'TASK_INVALID_STATE'
  | 'TASK_MISSING_ORIGINAL_STATE'
  | 'TASK_MISSING_PURGE_TIME'
  | 'TASK_NOT_TRASHED'
  | 'WECHAT_LOGIN_FAILED'
  | 'WECHAT_NOT_CONFIGURED'
  | 'WECHAT_WEB_LOGIN_FAILED'
  | 'WECHAT_WEB_NOT_CONFIGURED';

export class DomainError extends Error {
  public readonly code: DomainErrorCode;

  public constructor(code: DomainErrorCode) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
  }
}
