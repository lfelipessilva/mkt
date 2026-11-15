export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    statusCode = 400,
    code = "bad_request",
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export const isAppError = (error: unknown): error is AppError =>
  error instanceof AppError;
