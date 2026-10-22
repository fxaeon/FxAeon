export type ErrorCode =
  | 'invalid-input' | 'unavailable' | 'wrong-chain' | 'wallet-changed'
  | 'user-rejected' | 'expired' | 'policy' | 'economics' | 'simulation'
  | 'insufficient-funds' | 'nonce-changed' | 'busy' | 'cancelled'
  | 'receipt-unverified' | 'submission-unknown' | 'reverted';

/** Only authored, safe text crosses the domain/UI boundary. */
export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
  }
}

export function safeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AppError('cancelled', 'This request was cancelled.');
  }
  return new AppError('unavailable', 'The request could not be verified. Please try again.', { cause: error });
}

export function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('cancelled', 'This request was cancelled.');
}
