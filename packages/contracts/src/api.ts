export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export interface ApiMeta {
  readonly cursor?: string;
  readonly hasMore?: boolean;
}

export type ApiResponse<T> =
  | {
      readonly success: true;
      readonly data: T;
      readonly error: null;
      readonly meta: ApiMeta;
    }
  | {
      readonly success: false;
      readonly data: null;
      readonly error: ApiError;
      readonly meta: ApiMeta;
    };
