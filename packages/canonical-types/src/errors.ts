/**
 * Generic provider-error taxonomy. Every `packages/adapters/*` REST client
 * throws (a subclass of) `VoiceProviderError` — core code catches on this
 * canonical shape, never a provider SDK's own error class (CLAUDE.md Rule 2).
 */

export const PROVIDER_ERROR_CODES = [
  "auth",
  "rate_limit",
  "validation",
  "not_found",
  "conflict",
  "timeout",
  "network",
  "server_error",
  "unknown",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export interface VoiceProviderErrorOptions {
  code: ProviderErrorCode;
  provider: string;
  /** Whether a caller may safely retry the same request unmodified. */
  retryable: boolean;
  /** Upstream HTTP status, when the error came from a REST response. */
  httpStatus?: number;
  cause?: unknown;
}

export class VoiceProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(message: string, options: VoiceProviderErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "VoiceProviderError";
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable;
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }
}

/** Raised when a signature-verified boundary (webhook, tool-call) fails verification — always fail-closed. */
export class SignatureVerificationError extends VoiceProviderError {
  constructor(provider: string, reason: string, cause?: unknown) {
    super(`${provider} signature verification failed: ${reason}`, {
      code: "auth",
      provider,
      retryable: false,
      cause,
    });
    this.name = "SignatureVerificationError";
  }
}

/** Raised when a payload fails its Zod boundary validator — the shape didn't match what Rule 1 assumed. */
export class PayloadValidationError extends VoiceProviderError {
  constructor(provider: string, context: string, cause?: unknown) {
    super(`${provider} payload validation failed (${context})`, {
      code: "validation",
      provider,
      retryable: false,
      cause,
    });
    this.name = "PayloadValidationError";
  }
}

/** Raised by a template compiler that refuses to emit a config missing the verbatim disclosure line (G1/G2). */
export class DisclosureGateError extends Error {
  constructor(templateName: string, compileTarget: string) {
    super(
      `refusing to compile/publish template '${templateName}' for target '${compileTarget}': ` +
        "disclosure_line is not present verbatim in the first agent turn (G1/G2 publish gate)",
    );
    this.name = "DisclosureGateError";
  }
}
