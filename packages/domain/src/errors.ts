export class DomainError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
  }
}
