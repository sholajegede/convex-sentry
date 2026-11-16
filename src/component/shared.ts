import { v, type Infer } from "convex/values";

export const levelValidator = v.union(
  v.literal("fatal"),
  v.literal("error"),
  v.literal("warning"),
  v.literal("info"),
  v.literal("debug"),
);

export const kindValidator = v.union(
  v.literal("exception"),
  v.literal("message"),
);

export const statusValidator = v.union(
  v.literal("pending"),
  v.literal("retrying"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("suppressed"),
  v.literal("local"),
);

export type Level = Infer<typeof levelValidator>;
export type Kind = Infer<typeof kindValidator>;
export type Status = Infer<typeof statusValidator>;

export type ParsedDsn = {
  publicKey: string;
  envelopeUrl: string;
};

export function parseDsn(dsn: string): ParsedDsn | null {
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.username) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!projectId) return null;
  const prefix = segments.length ? `/${segments.join("/")}` : "";
  return {
    publicKey: decodeURIComponent(url.username),
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  };
}

export const SDK_NAME = "convex-sentry";
export const SDK_VERSION = "0.0.0";

export const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const BASE_RETRY_DELAY_MS = 2_000;
export const MAX_RETRY_DELAY_MS = 5 * 60_000;

export function retryDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  }
  const exponential = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const jitter = exponential * 0.2 * Math.random();
  return Math.min(Math.round(exponential + jitter), MAX_RETRY_DELAY_MS);
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const sentryLimits = headers.get("x-sentry-rate-limits");
  if (sentryLimits) {
    const seconds = Number.parseInt(sentryLimits.split(":")[0] ?? "", 10);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return undefined;
}
