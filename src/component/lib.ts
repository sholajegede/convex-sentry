import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  DEFAULT_DEDUPE_WINDOW_MS,
  DEFAULT_MAX_ATTEMPTS,
  SDK_NAME,
  SDK_VERSION,
  kindValidator,
  levelValidator,
  parseDsn,
  parseRetryAfter,
  retryDelay,
  statusValidator,
} from "./shared.js";

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 500;
const STATUS_COUNT_CAP = 1000;

const eventValidator = v.object({
  _id: v.id("events"),
  _creationTime: v.number(),
  eventId: v.string(),
  kind: kindValidator,
  level: levelValidator,
  title: v.string(),
  fingerprint: v.string(),
  payload: v.string(),
  dsn: v.optional(v.string()),
  status: statusValidator,
  attempts: v.number(),
  maxAttempts: v.number(),
  dedupeWindowMs: v.number(),
  nextAttemptAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  responseStatus: v.optional(v.number()),
  functionName: v.optional(v.string()),
  userId: v.optional(v.string()),
  environment: v.optional(v.string()),
  handled: v.boolean(),
  createdAt: v.number(),
  settledAt: v.optional(v.number()),
});

const groupValidator = v.object({
  _id: v.id("groups"),
  _creationTime: v.number(),
  fingerprint: v.string(),
  title: v.string(),
  kind: kindValidator,
  level: levelValidator,
  functionName: v.optional(v.string()),
  count: v.number(),
  sentCount: v.number(),
  suppressedCount: v.number(),
  failedCount: v.number(),
  firstSeen: v.number(),
  lastSeen: v.number(),
  lastEventId: v.string(),
  reservedBy: v.optional(v.string()),
  reservedAt: v.optional(v.number()),
});

// ─── Capture ────────────────────────────────────────────────────────────────

export const enqueue = mutation({
  args: {
    eventId: v.string(),
    kind: kindValidator,
    level: levelValidator,
    title: v.string(),
    fingerprint: v.string(),
    payload: v.string(),
    dsn: v.optional(v.string()),
    functionName: v.optional(v.string()),
    userId: v.optional(v.string()),
    environment: v.optional(v.string()),
    handled: v.boolean(),
    dedupeWindowMs: v.optional(v.number()),
    maxAttempts: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (args.dsn !== undefined && parseDsn(args.dsn) === null) {
      throw new Error("convex-sentry: the DSN is not a valid Sentry DSN");
    }
    const id = await ctx.db.insert("events", {
      ...args,
      dedupeWindowMs: Math.max(
        0,
        args.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS,
      ),
      maxAttempts: Math.max(
        1,
        Math.floor(args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
      ),
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.lib.deliver, { id });
    return args.eventId;
  },
});

// ─── Delivery ───────────────────────────────────────────────────────────────

export const deliver = internalAction({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.lib.claim, { id: args.id });
    if (claim === null) return null;

    const dsn = parseDsn(claim.dsn);
    if (dsn === null) {
      await ctx.runMutation(internal.lib.settle, {
        id: args.id,
        outcome: "failed",
        error: "The DSN is not a valid Sentry DSN",
      });
      return null;
    }

    const envelope = [
      JSON.stringify({
        event_id: claim.eventId,
        sent_at: new Date().toISOString(),
        dsn: claim.dsn,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
      }),
      JSON.stringify({ type: "event", content_type: "application/json" }),
      claim.payload,
    ].join("\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=${SDK_NAME}/${SDK_VERSION}, sentry_key=${dsn.publicKey}`,
        },
        body: envelope,
        signal: controller.signal,
      });
    } catch (err) {
      await ctx.runMutation(internal.lib.settle, {
        id: args.id,
        outcome: "retry",
        error: truncate(err instanceof Error ? err.message : String(err)),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      await ctx.runMutation(internal.lib.settle, {
        id: args.id,
        outcome: "sent",
        responseStatus: response.status,
      });
      return null;
    }

    const body = truncate(await response.text().catch(() => ""));
    const retryable =
      response.status === 429 ||
      response.status === 408 ||
      response.status >= 500;
    await ctx.runMutation(internal.lib.settle, {
      id: args.id,
      outcome: retryable ? "retry" : "failed",
      responseStatus: response.status,
      error: `Sentry responded ${response.status}${body ? `: ${body}` : ""}`,
      retryAfterMs:
        response.status === 429 ? parseRetryAfter(response.headers) : undefined,
    });
    return null;
  },
});

export const claim = internalMutation({
  args: { id: v.id("events") },
  returns: v.union(
    v.null(),
    v.object({ eventId: v.string(), dsn: v.string(), payload: v.string() }),
  ),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id);
    if (!event || (event.status !== "pending" && event.status !== "retrying"))
      return null;

    const now = Date.now();
    const firstPass = event.status === "pending" && event.attempts === 0;
    const group = firstPass
      ? await recordInGroup(ctx, event, now)
      : await getGroup(ctx, event.fingerprint);

    if (event.dsn === undefined) {
      await ctx.db.patch(event._id, { status: "local", settledAt: now });
      return null;
    }

    if (firstPass && group) {
      const reserved =
        group.reservedBy !== undefined &&
        group.reservedBy !== event.eventId &&
        group.reservedAt !== undefined &&
        now - group.reservedAt < event.dedupeWindowMs;
      if (reserved) {
        await ctx.db.patch(event._id, { status: "suppressed", settledAt: now });
        await ctx.db.patch(group._id, {
          suppressedCount: group.suppressedCount + 1,
        });
        return null;
      }
      await ctx.db.patch(group._id, {
        reservedBy: event.eventId,
        reservedAt: now,
      });
    }

    await ctx.db.patch(event._id, { attempts: event.attempts + 1 });
    return { eventId: event.eventId, dsn: event.dsn, payload: event.payload };
  },
});

export const settle = internalMutation({
  args: {
    id: v.id("events"),
    outcome: v.union(
      v.literal("sent"),
      v.literal("retry"),
      v.literal("failed"),
    ),
    responseStatus: v.optional(v.number()),
    error: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id);
    if (!event) return null;
    const now = Date.now();
    const group = await getGroup(ctx, event.fingerprint);

    if (args.outcome === "sent") {
      await ctx.db.patch(event._id, {
        status: "sent",
        responseStatus: args.responseStatus,
        lastError: undefined,
        nextAttemptAt: undefined,
        settledAt: now,
      });
      if (group)
        await ctx.db.patch(group._id, { sentCount: group.sentCount + 1 });
      return null;
    }

    if (args.outcome === "retry" && event.attempts < event.maxAttempts) {
      const delay = retryDelay(event.attempts, args.retryAfterMs);
      await ctx.db.patch(event._id, {
        status: "retrying",
        responseStatus: args.responseStatus,
        lastError: args.error,
        nextAttemptAt: now + delay,
      });
      await ctx.scheduler.runAfter(delay, internal.lib.deliver, {
        id: event._id,
      });
      return null;
    }

    await ctx.db.patch(event._id, {
      status: "failed",
      responseStatus: args.responseStatus,
      lastError: args.error,
      nextAttemptAt: undefined,
      settledAt: now,
    });
    if (group) {
      await ctx.db.patch(group._id, {
        failedCount: group.failedCount + 1,
        ...(group.reservedBy === event.eventId
          ? { reservedBy: undefined, reservedAt: undefined }
          : {}),
      });
    }
    return null;
  },
});

export const retry = mutation({
  args: { eventId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (!event || event.status !== "failed" || event.dsn === undefined)
      return false;

    await ctx.db.patch(event._id, {
      status: "retrying",
      attempts: 0,
      lastError: undefined,
      nextAttemptAt: undefined,
      settledAt: undefined,
    });
    const group = await getGroup(ctx, event.fingerprint);
    if (group && group.failedCount > 0) {
      await ctx.db.patch(group._id, { failedCount: group.failedCount - 1 });
    }
    await ctx.scheduler.runAfter(0, internal.lib.deliver, { id: event._id });
    return true;
  },
});

// ─── Retention ──────────────────────────────────────────────────────────────

const SETTLED_STATUSES = ["sent", "suppressed", "failed", "local"] as const;

const cleanupArgs = {
  olderThanMs: v.number(),
  batchSize: v.optional(v.number()),
};
const cleanupResult = v.object({ deleted: v.number(), hasMore: v.boolean() });

export const cleanup = mutation({
  args: cleanupArgs,
  returns: cleanupResult,
  handler: async (ctx, args) => await runCleanup(ctx, args),
});

export const cleanupBatch = internalMutation({
  args: cleanupArgs,
  returns: cleanupResult,
  handler: async (ctx, args) => await runCleanup(ctx, args),
});

async function runCleanup(
  ctx: MutationCtx,
  args: { olderThanMs: number; batchSize?: number },
): Promise<{ deleted: number; hasMore: boolean }> {
  const cutoff = Date.now() - Math.max(0, args.olderThanMs);
  const batchSize = Math.min(
    Math.max(1, Math.floor(args.batchSize ?? 200)),
    1000,
  );
  let deleted = 0;
  let hasMore = false;

  for (const status of SETTLED_STATUSES) {
    const remaining = batchSize - deleted;
    if (remaining <= 0) {
      hasMore = true;
      break;
    }
    const stale = await ctx.db
      .query("events")
      .withIndex("by_status", (q) =>
        q.eq("status", status).lt("createdAt", cutoff),
      )
      .take(remaining + 1);
    if (stale.length > remaining) hasMore = true;
    for (const event of stale.slice(0, remaining)) {
      await ctx.db.delete(event._id);
      deleted++;
    }
  }

  if (!hasMore) {
    const staleGroups = await ctx.db
      .query("groups")
      .withIndex("by_lastSeen", (q) => q.lt("lastSeen", cutoff))
      .take(batchSize + 1);
    for (const group of staleGroups.slice(0, batchSize))
      await ctx.db.delete(group._id);
    if (staleGroups.length > batchSize) hasMore = true;
  }

  if (hasMore) {
    await ctx.scheduler.runAfter(0, internal.lib.cleanupBatch, {
      olderThanMs: args.olderThanMs,
      batchSize,
    });
  }
  return { deleted, hasMore };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export const getEvent = query({
  args: { eventId: v.string() },
  returns: v.union(v.null(), eventValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("events")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
  },
});

export const listEvents = query({
  args: { status: v.optional(statusValidator), limit: v.optional(v.number()) },
  returns: v.array(eventValidator),
  handler: async (ctx, args) => {
    const limit = clampLimit(args.limit);
    if (args.status !== undefined) {
      const status = args.status;
      return await ctx.db
        .query("events")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("events").order("desc").take(limit);
  },
});

export const listEventsForGroup = query({
  args: { fingerprint: v.string(), limit: v.optional(v.number()) },
  returns: v.array(eventValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("events")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .order("desc")
      .take(clampLimit(args.limit));
  },
});

export const listGroups = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(groupValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groups")
      .withIndex("by_lastSeen")
      .order("desc")
      .take(clampLimit(args.limit));
  },
});

export const getStats = query({
  args: {},
  returns: v.object({
    groups: v.number(),
    captured: v.number(),
    sent: v.number(),
    suppressed: v.number(),
    failed: v.number(),
    queued: v.number(),
    local: v.number(),
  }),
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").collect();
    const totals = groups.reduce(
      (acc, g) => ({
        captured: acc.captured + g.count,
        sent: acc.sent + g.sentCount,
        suppressed: acc.suppressed + g.suppressedCount,
        failed: acc.failed + g.failedCount,
      }),
      { captured: 0, sent: 0, suppressed: 0, failed: 0 },
    );
    const [pending, retrying, local] = await Promise.all(
      (["pending", "retrying", "local"] as const).map((status) =>
        ctx.db
          .query("events")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(STATUS_COUNT_CAP)
          .then((rows) => rows.length),
      ),
    );
    return {
      groups: groups.length,
      ...totals,
      queued: pending + retrying,
      local,
    };
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getGroup(ctx: MutationCtx, fingerprint: string) {
  return await ctx.db
    .query("groups")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
    .unique();
}

async function recordInGroup(
  ctx: MutationCtx,
  event: Doc<"events">,
  now: number,
) {
  const existing = await getGroup(ctx, event.fingerprint);
  if (existing) {
    await ctx.db.patch(existing._id, {
      title: event.title,
      level: event.level,
      functionName: event.functionName ?? existing.functionName,
      count: existing.count + 1,
      lastSeen: now,
      lastEventId: event.eventId,
    });
    return await ctx.db.get(existing._id);
  }
  const id = await ctx.db.insert("groups", {
    fingerprint: event.fingerprint,
    title: event.title,
    kind: event.kind,
    level: event.level,
    functionName: event.functionName,
    count: 1,
    sentCount: 0,
    suppressedCount: 0,
    failedCount: 0,
    firstSeen: now,
    lastSeen: now,
    lastEventId: event.eventId,
  });
  return await ctx.db.get(id);
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(1, Math.floor(limit ?? 50)), 500);
}

function truncate(text: string): string {
  return text.length > MAX_ERROR_LENGTH
    ? `${text.slice(0, MAX_ERROR_LENGTH)}…`
    : text;
}
