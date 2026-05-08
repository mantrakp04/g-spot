/**
 * Gmail API error class + Retry-After parsing.
 *
 * Centralised so every call site shares the same surface for circuit-breaker
 * and retry decisions.
 */

export class GmailApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public retryAfter?: number,
    public reason?: string,
    public detail?: string,
  ) {
    const suffix = reason || detail
      ? ` — ${[reason, detail].filter(Boolean).join(": ")}`
      : "";
    super(`Gmail API error: ${status} ${statusText}${suffix}`);
    this.name = "GmailApiError";
  }

  get isRateLimit(): boolean {
    if (this.status === 429) return true;
    if (this.status === 403 && this.reason) {
      return (
        this.reason === "rateLimitExceeded"
        || this.reason === "userRateLimitExceeded"
        || this.reason === "quotaExceeded"
        || this.reason === "dailyLimitExceeded"
      );
    }
    return false;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;

  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

function parseRetryAfterFromDetail(detail: string | undefined): number | undefined {
  if (!detail) return undefined;

  const match = detail.match(/\bRetry after\s+([^\s.]+(?:\.\d+)?Z?)/i);
  if (!match?.[1]) return undefined;

  const retryAt = Date.parse(match[1]);
  if (!Number.isFinite(retryAt)) return undefined;

  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

export function parseGmailRetryAfterSeconds(input: {
  header?: string | null;
  detail?: string;
}): number | undefined {
  return parseRetryAfterHeader(input.header ?? null)
    ?? parseRetryAfterFromDetail(input.detail);
}

export async function buildGmailApiError(res: Response): Promise<GmailApiError> {
  const body = await res.text().catch(() => "");
  let reason: string | undefined;
  let detail: string | undefined;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    reason = parsed.error?.errors?.[0]?.reason;
    detail = parsed.error?.message;
  } catch {
    detail = body.slice(0, 200);
  }

  return new GmailApiError(
    res.status,
    res.statusText,
    parseGmailRetryAfterSeconds({
      header: res.headers.get("Retry-After"),
      detail,
    }),
    reason,
    detail,
  );
}
