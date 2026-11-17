import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import {
  SDK_NAME,
  SDK_VERSION,
  parseDsn,
  type Level,
  type Status,
} from "../component/shared.js";

export type { Level, Status };

export type SentryUser = {
  id?: string;
  email?: string;
  username?: string;
  segment?: string;
};

export type Breadcrumb = {
  message?: string;
  category?: string;
  level?: Level;
  type?: string;
  data?: Record<string, unknown>;
  /** Milliseconds since epoch. Defaults to the capture time. */
  timestamp?: number;
};

export type CaptureContext = {
  level?: Level;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: SentryUser;
  breadcrumbs?: Breadcrumb[];
  /** Overrides grouping, both in Sentry and in the local issues view. */
  fingerprint?: string[];
  /** The Convex function that captured the event, shown as a tag and used for grouping. */
  functionName?: string;
  /** Defaults to `true`. `withSentry` sets it to `false` for errors it rethrows. */
  handled?: boolean;
  /** Sends this event to a different Sentry project than the default DSN. */
  dsn?: string;
};

export type SentryOptions = {
  /** Your project's DSN. Leave it unset to keep events in Convex only. */
  dsn?: string;
  environment?: string;
  release?: string;
  /** Defaults to `"convex"`. */
  serverName?: string;
  /** Tags added to every event. */
  tags?: Record<string, string>;
  /** Fraction of events to keep, from 0 to 1. Defaults to 1. */
  sampleRate?: number;
  /**
   * Events with the same fingerprint inside this window are kept locally but
   * only the first is sent to Sentry. Defaults to 60 seconds. 0 sends all.
   */
  dedupeWindowMs?: number;
  /** Delivery attempts before an event is marked failed. Defaults to 5. */
  maxAttempts?: number;
  /** Set to `false` to turn capture off, for example in tests. */
  enabled?: boolean;
  /** Change or drop an event before it is stored. Return `null` to drop it. */
  beforeSend?: (event: SentryEvent) => SentryEvent | null;
};

export type StackFrame = {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
};

export type ExceptionValue = {
  type: string;
  value: string;
  stacktrace?: { frames: StackFrame[] };
  mechanism: { type: string; handled: boolean };
};

export type SentryEvent = {
  event_id: string;
  timestamp: number;
  platform: "node";
  transaction?: string;
  level: Level;
  logger: string;
  server_name: string;
  environment?: string;
  release?: string;
  tags: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: SentryUser;
  fingerprint?: string[];
  breadcrumbs?: {
    values: Array<Omit<Breadcrumb, "timestamp"> & { timestamp: number }>;
  };
  contexts: { runtime: { name: string } };
  exception?: { values: ExceptionValue[] };
  message?: { formatted: string };
  sdk: { name: string; version: string };
};

const MAX_PAYLOAD_LENGTH = 200_000;
const MAX_STRING_LENGTH = 8_192;
const MAX_TITLE_LENGTH = 200;
const MAX_DEPTH = 6;
const MAX_CAUSES = 5;
const MAX_FRAMES = 50;

/**
 * Reports handled errors and messages from Convex mutations and actions to
 * Sentry. Each event is written to a component table first, then a scheduled
 * action delivers it, so capture works where `fetch` does not (mutations) and
 * survives the calling function returning before the request finishes.
 */
export class Sentry {
  private readonly options: SentryOptions;

  constructor(
    private component: ComponentApi,
    options: SentryOptions = {},
  ) {
    const dsn = options.dsn?.trim() || undefined;
    if (dsn !== undefined && parseDsn(dsn) === null) {
      throw new Error(
        "convex-sentry: `dsn` is not a valid Sentry DSN. Copy it from Project Settings > Client Keys in Sentry.",
      );
    }
    this.options = { ...options, dsn };
  }

  /** Records an error and queues it for delivery. Returns the event id, or `null` if it was dropped. */
  async captureException(
    ctx: RunMutationCtx,
    error: unknown,
    context: CaptureContext = {},
  ): Promise<string | null> {
    const values = exceptionValues(error, context.handled ?? true);
    const top = values[values.length - 1];
    const extra = { ...context.extra };
    const data = convexErrorData(error);
    if (data !== undefined) extra.convexErrorData = data;

    return await this.capture(ctx, {
      kind: "exception",
      level: context.level ?? "error",
      title: `${top.type}: ${top.value}`,
      groupingKey: [top.type, normalize(top.value), topInAppFunction(top)].join(
        "|",
      ),
      body: { exception: { values } },
      context: { ...context, extra },
    });
  }

  /** Records a message at the given level (default `"info"`) and queues it for delivery. */
  async captureMessage(
    ctx: RunMutationCtx,
    message: string,
    context: CaptureContext = {},
  ): Promise<string | null> {
    const formatted = truncate(message, MAX_STRING_LENGTH);
    return await this.capture(ctx, {
      kind: "message",
      level: context.level ?? "info",
      title: formatted,
      groupingKey: ["message", normalize(formatted)].join("|"),
      body: { message: { formatted } },
      context,
    });
  }

  /**
   * Runs `fn` inside an action. If it throws, the error is captured as
   * unhandled and then rethrown. Actions only, because a mutation that throws
   * rolls back its own writes, including the captured event.
   */
  async withSentry<T>(
    ctx: ActionLikeCtx,
    fn: () => Promise<T>,
    context: CaptureContext = {},
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      await this.captureException(ctx, error, { handled: false, ...context });
      throw error;
    }
  }

  async getEvent(ctx: RunQueryCtx, args: { eventId: string }) {
    return await ctx.runQuery(this.component.lib.getEvent, args);
  }

  async listEvents(
    ctx: RunQueryCtx,
    args: { status?: Status; limit?: number } = {},
  ) {
    return await ctx.runQuery(this.component.lib.listEvents, args);
  }

  async listEventsForGroup(
    ctx: RunQueryCtx,
    args: { fingerprint: string; limit?: number },
  ) {
    return await ctx.runQuery(this.component.lib.listEventsForGroup, args);
  }

  async listGroups(ctx: RunQueryCtx, args: { limit?: number } = {}) {
    return await ctx.runQuery(this.component.lib.listGroups, args);
  }

  async getStats(ctx: RunQueryCtx) {
    return await ctx.runQuery(this.component.lib.getStats, {});
  }

  /** Queues a failed event for delivery again. Returns `false` if the event is not in the failed state. */
  async retry(ctx: RunMutationCtx, args: { eventId: string }) {
    return await ctx.runMutation(this.component.lib.retry, args);
  }

  /** Deletes settled events older than `olderThanMs`, in batches. Call it from a cron. */
  async cleanup(
    ctx: RunMutationCtx,
    args: { olderThanMs: number; batchSize?: number },
  ) {
    return await ctx.runMutation(this.component.lib.cleanup, args);
  }

  private async capture(
    ctx: RunMutationCtx,
    input: {
      kind: "exception" | "message";
      level: Level;
      title: string;
      groupingKey: string;
      body: Pick<SentryEvent, "exception" | "message">;
      context: CaptureContext;
    },
  ): Promise<string | null> {
    if (this.options.enabled === false) return null;
    const sampleRate = this.options.sampleRate ?? 1;
    if (sampleRate < 1 && Math.random() >= sampleRate) return null;

    const { context } = input;
    const now = Date.now();
    const tags: Record<string, string> = {
      runtime: "convex",
      ...this.options.tags,
      ...context.tags,
      ...(context.functionName ? { function: context.functionName } : {}),
    };

    let event: SentryEvent | null = {
      event_id: randomHex(16),
      timestamp: now / 1000,
      platform: "node",
      transaction: context.functionName,
      level: input.level,
      logger: "convex",
      server_name: this.options.serverName ?? "convex",
      environment: this.options.environment,
      release: this.options.release,
      tags,
      extra:
        context.extra && Object.keys(context.extra).length
          ? sanitizeRecord(context.extra)
          : undefined,
      user: context.user,
      fingerprint: context.fingerprint,
      breadcrumbs: context.breadcrumbs?.length
        ? {
            values: context.breadcrumbs.map(
              ({ timestamp, data, ...crumb }) => ({
                ...crumb,
                ...(data ? { data: sanitizeRecord(data) } : {}),
                timestamp: (timestamp ?? now) / 1000,
              }),
            ),
          }
        : undefined,
      contexts: { runtime: { name: "convex" } },
      ...input.body,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    };

    if (this.options.beforeSend) {
      event = this.options.beforeSend(event);
      if (event === null) return null;
    }

    const dsn = context.dsn?.trim() || this.options.dsn;
    const fingerprint = context.fingerprint?.length
      ? hash(context.fingerprint.join("|"))
      : hash(
          `${input.kind}|${input.groupingKey}|${context.functionName ?? ""}`,
        );

    try {
      return await ctx.runMutation(this.component.lib.enqueue, {
        eventId: event.event_id,
        kind: input.kind,
        level: event.level,
        title: truncate(input.title, MAX_TITLE_LENGTH),
        fingerprint,
        payload: fitPayload(event),
        dsn,
        functionName: context.functionName,
        userId: context.user?.id,
        environment: event.environment,
        handled: context.handled ?? true,
        dedupeWindowMs: this.options.dedupeWindowMs,
        maxAttempts: this.options.maxAttempts,
      });
    } catch (err) {
      console.error("convex-sentry: could not record the event", err);
      return null;
    }
  }
}

// ─── Exceptions ─────────────────────────────────────────────────────────────

export function exceptionValues(
  error: unknown,
  handled: boolean,
): ExceptionValue[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (
    current !== undefined &&
    current !== null &&
    chain.length < MAX_CAUSES
  ) {
    if (chain.includes(current)) break;
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }

  // Sentry expects the root cause first and the error that was thrown last.
  return chain.reverse().map((item, index) => {
    const isOuter = index === chain.length - 1;
    const mechanism = { type: isOuter ? SDK_NAME : "chained", handled };
    if (item instanceof Error) {
      const frames = parseStack(item.stack);
      return {
        type: item.name || "Error",
        value: truncate(item.message || "(no message)", MAX_STRING_LENGTH),
        ...(frames.length ? { stacktrace: { frames } } : {}),
        mechanism,
      };
    }
    return {
      type: "Error",
      value: truncate(describe(item), MAX_STRING_LENGTH),
      mechanism,
    };
  });
}

/** Parses a V8 stack trace into Sentry frames, oldest call first. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    const body = line.slice(3).replace(/^async\s+/, "");
    const withFunction = body.match(/^(.*?)\s+\((.*):(\d+):(\d+)\)$/);
    const bare = body.match(/^(.*):(\d+):(\d+)$/);
    let frame: StackFrame | null = null;
    if (withFunction) {
      frame = {
        function: withFunction[1],
        filename: withFunction[2],
        lineno: Number(withFunction[3]),
        colno: Number(withFunction[4]),
      };
    } else if (bare) {
      frame = {
        filename: bare[1],
        lineno: Number(bare[2]),
        colno: Number(bare[3]),
      };
    } else if (body.length) {
      frame = { function: body };
    }
    if (frame) {
      frame.in_app = isInApp(frame.filename);
      frames.push(frame);
    }
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames.reverse();
}

function isInApp(filename: string | undefined): boolean {
  if (!filename) return false;
  return !/node_modules|^node:|^native|^internal\/|<anonymous>/.test(filename);
}

function topInAppFunction(value: ExceptionValue): string {
  const frames = value.stacktrace?.frames ?? [];
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].in_app && frames[i].function) return frames[i].function!;
  }
  return "";
}

function convexErrorData(error: unknown): unknown {
  if (
    error instanceof Error &&
    error.name === "ConvexError" &&
    "data" in error
  ) {
    return sanitize(
      (error as Error & { data: unknown }).data,
      0,
      new WeakSet(),
    );
  }
  return undefined;
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(sanitize(value, 0, new WeakSet()));
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

// ─── Serialization ──────────────────────────────────────────────────────────

function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return sanitize(record, 0, new WeakSet()) as Record<string, unknown>;
}

function sanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case "string":
      return truncate(value, MAX_STRING_LENGTH);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return `${value.toString()}n`;
    case "function":
      return `[Function ${value.name || "anonymous"}]`;
    case "symbol":
      return value.toString();
  }
  const obj = value as object;
  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Object]";
  seen.add(obj);
  if (obj instanceof Error) return { name: obj.name, message: obj.message };
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof ArrayBuffer) return `[ArrayBuffer ${obj.byteLength}]`;
  if (Array.isArray(obj))
    return obj.slice(0, 100).map((item) => sanitize(item, depth + 1, seen));
  if (obj instanceof Map) {
    return sanitize(Object.fromEntries(obj), depth, seen);
  }
  if (obj instanceof Set) return sanitize([...obj], depth, seen);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(obj).slice(0, 100)) {
    out[key] = sanitize(item, depth + 1, seen);
  }
  return out;
}

function fitPayload(event: SentryEvent): string {
  let json = JSON.stringify(event);
  if (json.length <= MAX_PAYLOAD_LENGTH) return json;
  const slimmer: SentryEvent = { ...event, breadcrumbs: undefined };
  json = JSON.stringify(slimmer);
  if (json.length <= MAX_PAYLOAD_LENGTH) return json;
  slimmer.extra = { truncated: "extra data was too large to send" };
  json = JSON.stringify(slimmer);
  if (json.length <= MAX_PAYLOAD_LENGTH) return json;
  if (slimmer.exception) {
    slimmer.exception = {
      values: slimmer.exception.values.map(
        ({ stacktrace: _stacktrace, ...value }) => ({
          ...value,
          value: truncate(value.value, 1_000),
        }),
      ),
    };
  }
  if (slimmer.message)
    slimmer.message = { formatted: truncate(slimmer.message.formatted, 1_000) };
  return JSON.stringify(slimmer);
}

// ─── Grouping ───────────────────────────────────────────────────────────────

/** Replaces ids, numbers, and hex strings so similar messages group together. */
export function normalize(message: string): string {
  return message
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<uuid>",
    )
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\b[a-z0-9]{31,32}\b/g, "<id>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .slice(0, 500);
}

function hash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Capture methods only call ctx.runMutation, so they accept any mutation or
// action ctx. Typing them structurally keeps them assignable from an app
// whose DataModel has its own tables.
type RunMutationCtx = {
  runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
};

type RunQueryCtx = {
  runQuery: GenericActionCtx<GenericDataModel>["runQuery"];
};

type ActionLikeCtx = RunMutationCtx & {
  runAction: GenericActionCtx<GenericDataModel>["runAction"];
};
