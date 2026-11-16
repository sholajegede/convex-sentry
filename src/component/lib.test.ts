import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test.js";
import { api } from "./_generated/api.js";
import { parseDsn, parseRetryAfter, retryDelay } from "./shared.js";

const DSN = "https://publickey@o1.ingest.sentry.io/42";

type FetchCall = { url: string; init: RequestInit };

function stubSentry(responses: Array<number | (() => Response)>) {
  const calls: FetchCall[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(i++, responses.length - 1)];
      return typeof next === "function"
        ? next()
        : new Response("{}", { status: next });
    }),
  );
  return calls;
}

function enqueueArgs(overrides: Partial<Parameters<typeof baseArgs>[0]> = {}) {
  return baseArgs(overrides);
}

function baseArgs(overrides: {
  eventId?: string;
  fingerprint?: string;
  dsn?: string | undefined;
  dedupeWindowMs?: number;
  maxAttempts?: number;
}) {
  const eventId = overrides.eventId ?? crypto.randomUUID().replace(/-/g, "");
  return {
    eventId,
    kind: "exception" as const,
    level: "error" as const,
    title: "Error: something broke",
    fingerprint: overrides.fingerprint ?? "fp_1",
    payload: JSON.stringify({ event_id: eventId, level: "error" }),
    dsn: "dsn" in overrides ? overrides.dsn : DSN,
    handled: true,
    dedupeWindowMs: overrides.dedupeWindowMs,
    maxAttempts: overrides.maxAttempts,
  };
}

async function settleAll(t: ReturnType<typeof initConvexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("delivery", () => {
  test("sends an envelope to the DSN's envelope endpoint", async () => {
    const t = initConvexTest();
    const calls = stubSentry([200]);
    const args = enqueueArgs();

    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-sentry-envelope");
    expect(headers["X-Sentry-Auth"]).toContain("sentry_key=publickey");

    const [header, item, payload] = String(calls[0].init.body).split("\n");
    expect(JSON.parse(header)).toMatchObject({
      event_id: args.eventId,
      dsn: DSN,
    });
    expect(JSON.parse(item)).toEqual({
      type: "event",
      content_type: "application/json",
    });
    expect(payload).toBe(args.payload);

    const event = await t.query(api.lib.getEvent, { eventId: args.eventId });
    expect(event).toMatchObject({
      status: "sent",
      attempts: 1,
      responseStatus: 200,
    });
  });

  test("keeps events without a DSN in Convex only", async () => {
    const t = initConvexTest();
    const calls = stubSentry([200]);
    const args = enqueueArgs({ dsn: undefined });

    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);

    expect(calls).toHaveLength(0);
    const event = await t.query(api.lib.getEvent, { eventId: args.eventId });
    expect(event?.status).toBe("local");
    const [group] = await t.query(api.lib.listGroups, {});
    expect(group.count).toBe(1);
  });

  test("retries server errors and then succeeds", async () => {
    const t = initConvexTest();
    const calls = stubSentry([503, 500, 200]);
    const args = enqueueArgs();

    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);

    expect(calls).toHaveLength(3);
    const event = await t.query(api.lib.getEvent, { eventId: args.eventId });
    expect(event).toMatchObject({ status: "sent", attempts: 3 });
    expect(event?.lastError).toBeUndefined();
  });

  test("marks the event failed after maxAttempts", async () => {
    const t = initConvexTest();
    const calls = stubSentry([503]);
    const args = enqueueArgs({ maxAttempts: 3 });

    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);

    expect(calls).toHaveLength(3);
    const event = await t.query(api.lib.getEvent, { eventId: args.eventId });
    expect(event).toMatchObject({
      status: "failed",
      attempts: 3,
      responseStatus: 503,
    });
  });

  test("does not retry a client error such as a rejected key", async () => {
    const t = initConvexTest();
    const calls = stubSentry([
      () => new Response("Unauthorized", { status: 401 }),
    ]);
    const args = enqueueArgs();

    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);

    expect(calls).toHaveLength(1);
    const event = await t.query(api.lib.getEvent, { eventId: args.eventId });
    expect(event?.status).toBe("failed");
    expect(event?.lastError).toBe("Sentry responded 401: Unauthorized");
  });

  test("retries after a network error", async () => {
    const t = initConvexTest();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (call++ === 0) throw new TypeError("fetch failed");
        return new Response("{}", { status: 200 });
      }),
    );
    const args = enqueueArgs();

    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);

    const event = await t.query(api.lib.getEvent, { eventId: args.eventId });
    expect(event).toMatchObject({ status: "sent", attempts: 2 });
  });

  test("retry() sends a failed event again", async () => {
    const t = initConvexTest();
    stubSentry([400, 200]);
    const args = enqueueArgs();

    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);
    expect(
      (await t.query(api.lib.getEvent, { eventId: args.eventId }))?.status,
    ).toBe("failed");

    expect(await t.mutation(api.lib.retry, { eventId: args.eventId })).toBe(
      true,
    );
    await settleAll(t);

    const event = await t.query(api.lib.getEvent, { eventId: args.eventId });
    expect(event?.status).toBe("sent");
    const [group] = await t.query(api.lib.listGroups, {});
    expect(group).toMatchObject({ count: 1, sentCount: 1, failedCount: 0 });
  });

  test("retry() ignores events that are not failed", async () => {
    const t = initConvexTest();
    stubSentry([200]);
    const args = enqueueArgs();
    await t.mutation(api.lib.enqueue, args);
    await settleAll(t);

    expect(await t.mutation(api.lib.retry, { eventId: args.eventId })).toBe(
      false,
    );
    expect(await t.mutation(api.lib.retry, { eventId: "missing" })).toBe(false);
  });

  test("rejects an invalid DSN at capture time", async () => {
    const t = initConvexTest();
    await expect(
      t.mutation(api.lib.enqueue, enqueueArgs({ dsn: "not-a-dsn" })),
    ).rejects.toThrow(/not a valid Sentry DSN/);
  });
});

describe("dedupe", () => {
  test("sends only the first event per fingerprint inside the window", async () => {
    const t = initConvexTest();
    const calls = stubSentry([200]);

    for (let i = 0; i < 5; i++)
      await t.mutation(api.lib.enqueue, enqueueArgs());
    await settleAll(t);

    expect(calls).toHaveLength(1);
    const suppressed = await t.query(api.lib.listEvents, {
      status: "suppressed",
    });
    expect(suppressed).toHaveLength(4);
    const [group] = await t.query(api.lib.listGroups, {});
    expect(group).toMatchObject({ count: 5, sentCount: 1, suppressedCount: 4 });
  });

  test("sends again once the window has passed", async () => {
    const t = initConvexTest();
    const calls = stubSentry([200]);

    await t.mutation(api.lib.enqueue, enqueueArgs({ dedupeWindowMs: 1_000 }));
    await settleAll(t);
    vi.advanceTimersByTime(1_500);
    await t.mutation(api.lib.enqueue, enqueueArgs({ dedupeWindowMs: 1_000 }));
    await settleAll(t);

    expect(calls).toHaveLength(2);
  });

  test("a window of 0 sends every event", async () => {
    const t = initConvexTest();
    const calls = stubSentry([200]);

    for (let i = 0; i < 3; i++) {
      await t.mutation(api.lib.enqueue, enqueueArgs({ dedupeWindowMs: 0 }));
    }
    await settleAll(t);

    expect(calls).toHaveLength(3);
  });

  test("different fingerprints are not deduplicated", async () => {
    const t = initConvexTest();
    const calls = stubSentry([200]);

    await t.mutation(api.lib.enqueue, enqueueArgs({ fingerprint: "a" }));
    await t.mutation(api.lib.enqueue, enqueueArgs({ fingerprint: "b" }));
    await settleAll(t);

    expect(calls).toHaveLength(2);
    expect(await t.query(api.lib.listGroups, {})).toHaveLength(2);
  });

  test("a failed delivery releases the window for the next event", async () => {
    const t = initConvexTest();
    const calls = stubSentry([400, 200]);

    await t.mutation(api.lib.enqueue, enqueueArgs());
    await settleAll(t);
    await t.mutation(api.lib.enqueue, enqueueArgs());
    await settleAll(t);

    expect(calls).toHaveLength(2);
    const sent = await t.query(api.lib.listEvents, { status: "sent" });
    expect(sent).toHaveLength(1);
  });
});

describe("queries and retention", () => {
  test("getStats sums groups and counts queued events", async () => {
    const t = initConvexTest();
    stubSentry([200]);

    await t.mutation(api.lib.enqueue, enqueueArgs({ fingerprint: "a" }));
    await t.mutation(api.lib.enqueue, enqueueArgs({ fingerprint: "a" }));
    await t.mutation(
      api.lib.enqueue,
      enqueueArgs({ fingerprint: "b", dsn: undefined }),
    );

    expect((await t.query(api.lib.getStats, {})).queued).toBe(3);
    await settleAll(t);

    expect(await t.query(api.lib.getStats, {})).toEqual({
      groups: 2,
      captured: 3,
      sent: 1,
      suppressed: 1,
      failed: 0,
      queued: 0,
      local: 1,
    });
  });

  test("listEventsForGroup returns a group's events newest first", async () => {
    const t = initConvexTest();
    stubSentry([200]);
    const first = enqueueArgs({ fingerprint: "a" });
    const second = enqueueArgs({ fingerprint: "a" });
    await t.mutation(api.lib.enqueue, first);
    vi.advanceTimersByTime(10);
    await t.mutation(api.lib.enqueue, second);
    await t.mutation(api.lib.enqueue, enqueueArgs({ fingerprint: "b" }));

    const events = await t.query(api.lib.listEventsForGroup, {
      fingerprint: "a",
    });
    expect(events.map((e) => e.eventId)).toEqual([
      second.eventId,
      first.eventId,
    ]);
    await settleAll(t);
  });

  test("cleanup deletes settled events and stale groups, not queued ones", async () => {
    const t = initConvexTest();
    stubSentry([200]);

    for (let i = 0; i < 3; i++) {
      await t.mutation(
        api.lib.enqueue,
        enqueueArgs({ fingerprint: `fp_${i}`, dsn: undefined }),
      );
    }
    await settleAll(t);
    vi.advanceTimersByTime(10_000);
    const queued = enqueueArgs({ fingerprint: "fresh" });
    await t.mutation(api.lib.enqueue, queued);

    const result = await t.mutation(api.lib.cleanup, {
      olderThanMs: 5_000,
      batchSize: 2,
    });
    expect(result).toEqual({ deleted: 2, hasMore: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const remaining = await t.query(api.lib.listEvents, {});
    expect(remaining.map((e) => e.eventId)).toEqual([queued.eventId]);
    const groups = await t.query(api.lib.listGroups, {});
    expect(groups.map((g) => g.fingerprint)).toEqual(["fresh"]);
  });
});

describe("helpers", () => {
  test("parseDsn handles SaaS and self-hosted DSNs", () => {
    expect(parseDsn("https://abc@o1.ingest.us.sentry.io/123")).toEqual({
      publicKey: "abc",
      envelopeUrl: "https://o1.ingest.us.sentry.io/api/123/envelope/",
    });
    expect(
      parseDsn("https://abc:legacysecret@sentry.example.com/errors/7"),
    ).toEqual({
      publicKey: "abc",
      envelopeUrl: "https://sentry.example.com/errors/api/7/envelope/",
    });
    expect(parseDsn("https://o1.ingest.sentry.io/123")).toBeNull();
    expect(parseDsn("https://abc@o1.ingest.sentry.io/")).toBeNull();
    expect(parseDsn("ftp://abc@host/1")).toBeNull();
    expect(parseDsn("nope")).toBeNull();
  });

  test("retryDelay backs off and honors Retry-After", () => {
    expect(retryDelay(1)).toBeGreaterThanOrEqual(2_000);
    expect(retryDelay(1)).toBeLessThan(2_500);
    expect(retryDelay(3)).toBeGreaterThanOrEqual(8_000);
    expect(retryDelay(30)).toBe(300_000);
    expect(retryDelay(1, 15_000)).toBe(15_000);
  });

  test("parseRetryAfter reads Sentry's rate limit header first", () => {
    expect(
      parseRetryAfter(new Headers({ "x-sentry-rate-limits": "60:error:key" })),
    ).toBe(60_000);
    expect(parseRetryAfter(new Headers({ "retry-after": "12" }))).toBe(12_000);
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });
});
