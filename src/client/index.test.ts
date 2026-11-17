import { describe, expect, test, vi } from "vitest";
import {
  Sentry,
  exceptionValues,
  normalize,
  parseStack,
  type SentryEvent,
} from "./index.js";
import { components } from "./setup.test.js";

const DSN = "https://publickey@o1.ingest.sentry.io/42";

type EnqueueArgs = {
  eventId: string;
  kind: "exception" | "message";
  level: string;
  title: string;
  fingerprint: string;
  payload: string;
  dsn?: string;
  functionName?: string;
  userId?: string;
  handled: boolean;
};

function fakeCtx() {
  const calls: EnqueueArgs[] = [];
  const runMutation = vi.fn(async (_ref: unknown, args: EnqueueArgs) => {
    calls.push(args);
    return args.eventId;
  });
  const ctx = { runMutation, runAction: vi.fn(), runQuery: vi.fn() } as any;
  return {
    ctx,
    calls,
    payload: (i = 0) => JSON.parse(calls[i].payload) as SentryEvent,
  };
}

const V8_STACK = `Error: Coupon rule is malformed
    at parseRule (../convex/coupons.ts:14:11)
    at async handler (../convex/orders.ts:30:5)
    at async invokeFunction (../../node_modules/convex/src/server/impl/registration_impl.ts:80:11)
    at ../convex/orders.ts:31:2`;

describe("parseStack", () => {
  test("parses V8 frames oldest first and marks library frames", () => {
    const frames = parseStack(V8_STACK);
    expect(frames).toEqual([
      { filename: "../convex/orders.ts", lineno: 31, colno: 2, in_app: true },
      {
        function: "invokeFunction",
        filename:
          "../../node_modules/convex/src/server/impl/registration_impl.ts",
        lineno: 80,
        colno: 11,
        in_app: false,
      },
      {
        function: "handler",
        filename: "../convex/orders.ts",
        lineno: 30,
        colno: 5,
        in_app: true,
      },
      {
        function: "parseRule",
        filename: "../convex/coupons.ts",
        lineno: 14,
        colno: 11,
        in_app: true,
      },
    ]);
  });

  test("returns no frames for a missing stack", () => {
    expect(parseStack(undefined)).toEqual([]);
    expect(parseStack("Error: no frames here")).toEqual([]);
  });
});

describe("exceptionValues", () => {
  test("orders a cause chain root first", () => {
    const root = new Error("connect ETIMEDOUT");
    const outer = new TypeError("sync failed", { cause: root });
    const values = exceptionValues(outer, false);
    expect(values.map((v) => [v.type, v.value, v.mechanism])).toEqual([
      ["Error", "connect ETIMEDOUT", { type: "chained", handled: false }],
      ["TypeError", "sync failed", { type: "convex-sentry", handled: false }],
    ]);
  });

  test("stops on a circular cause", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause: unknown }).cause = b;
    expect(exceptionValues(b, true)).toHaveLength(2);
  });

  test("describes thrown non-errors", () => {
    expect(exceptionValues("plain string", true)[0]).toMatchObject({
      type: "Error",
      value: "plain string",
    });
    expect(exceptionValues({ code: 42 }, true)[0].value).toBe('{"code":42}');
  });
});

describe("normalize", () => {
  test("replaces ids and numbers so similar messages group", () => {
    expect(normalize("Invoice 1042 failed")).toBe(
      normalize("Invoice 7 failed"),
    );
    expect(normalize("user 3f2b1c9e-1d2a-4b3c-8d4e-5f6a7b8c9d0e missing")).toBe(
      "user <uuid> missing",
    );
    expect(normalize("Order j578yk26a0yp0zgsstft63eaks8jazrp not found")).toBe(
      "Order <id> not found",
    );
  });
});

describe("Sentry client", () => {
  test("rejects an invalid DSN at construction", () => {
    expect(() => new Sentry(components.convexSentry, { dsn: "nope" })).toThrow(
      /not a valid Sentry DSN/,
    );
    expect(
      () => new Sentry(components.convexSentry, { dsn: "  " }),
    ).not.toThrow();
  });

  test("captureException builds a Sentry event with context", async () => {
    const sentry = new Sentry(components.convexSentry, {
      dsn: DSN,
      environment: "production",
      release: "app@1.2.3",
      tags: { team: "payments" },
    });
    const { ctx, calls, payload } = fakeCtx();

    const id = await sentry.captureException(
      ctx,
      new Error("Card declined: 4012"),
      {
        functionName: "orders:charge",
        tags: { feature: "checkout" },
        extra: { attempt: 2, nested: { deep: true } },
        user: { id: "user_1" },
        breadcrumbs: [
          { category: "cart", message: "added item", timestamp: 1_000 },
        ],
      },
    );

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(calls[0]).toMatchObject({
      eventId: id,
      kind: "exception",
      level: "error",
      title: "Error: Card declined: 4012",
      dsn: DSN,
      functionName: "orders:charge",
      userId: "user_1",
      handled: true,
    });
    const event = payload();
    expect(event).toMatchObject({
      event_id: id,
      platform: "node",
      transaction: "orders:charge",
      level: "error",
      environment: "production",
      release: "app@1.2.3",
      server_name: "convex",
      tags: {
        runtime: "convex",
        team: "payments",
        feature: "checkout",
        function: "orders:charge",
      },
      extra: { attempt: 2, nested: { deep: true } },
      user: { id: "user_1" },
      breadcrumbs: {
        values: [{ category: "cart", message: "added item", timestamp: 1 }],
      },
      sdk: { name: "convex-sentry" },
    });
    expect(event.exception?.values[0].type).toBe("Error");
  });

  test("captureMessage defaults to info and keeps the text", async () => {
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const { ctx, calls, payload } = fakeCtx();

    await sentry.captureMessage(ctx, "Checkout took 3200ms", {
      level: "warning",
    });

    expect(calls[0]).toMatchObject({
      kind: "message",
      level: "warning",
      title: "Checkout took 3200ms",
    });
    expect(payload().message).toEqual({ formatted: "Checkout took 3200ms" });

    await sentry.captureMessage(ctx, "Started nightly job");
    expect(calls[1].level).toBe("info");
  });

  test("similar errors share a fingerprint, different ones do not", async () => {
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const { ctx, calls } = fakeCtx();

    await sentry.captureException(ctx, new Error("Invoice 1 has no signature"));
    await sentry.captureException(ctx, new Error("Invoice 2 has no signature"));
    await sentry.captureException(ctx, new Error("Webhook body was empty"));
    await sentry.captureException(ctx, new Error("x"), {
      fingerprint: ["custom"],
    });
    await sentry.captureException(ctx, new Error("y"), {
      fingerprint: ["custom"],
    });

    expect(calls[0].fingerprint).toBe(calls[1].fingerprint);
    expect(calls[2].fingerprint).not.toBe(calls[0].fingerprint);
    expect(calls[3].fingerprint).toBe(calls[4].fingerprint);
  });

  test("records ConvexError data", async () => {
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const { ctx, payload } = fakeCtx();
    const error = Object.assign(new Error('{"code":"LIMIT"}'), {
      name: "ConvexError",
      data: { code: "LIMIT" },
    });

    await sentry.captureException(ctx, error);
    expect(payload().extra).toEqual({ convexErrorData: { code: "LIMIT" } });
  });

  test("survives circular and odd extra values", async () => {
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const { ctx, payload } = fakeCtx();
    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;

    await sentry.captureMessage(ctx, "odd", {
      extra: {
        loop,
        big: 10n,
        fn: function namedFn() {},
        when: new Date(0),
        tags: new Set(["a"]),
      },
    });

    expect(payload().extra).toEqual({
      loop: { name: "loop", self: "[Circular]" },
      big: "10n",
      fn: "[Function namedFn]",
      when: "1970-01-01T00:00:00.000Z",
      tags: ["a"],
    });
  });

  test("routes an event to another DSN when asked", async () => {
    const other = "https://otherkey@o2.ingest.sentry.io/7";
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const { ctx, calls } = fakeCtx();

    await sentry.captureMessage(ctx, "to the other project", { dsn: other });
    expect(calls[0].dsn).toBe(other);
  });

  test("keeps events local when no DSN is configured", async () => {
    const sentry = new Sentry(components.convexSentry);
    const { ctx, calls } = fakeCtx();

    await sentry.captureMessage(ctx, "local only");
    expect(calls[0].dsn).toBeUndefined();
  });

  test("beforeSend can change or drop an event", async () => {
    const sentry = new Sentry(components.convexSentry, {
      dsn: DSN,
      beforeSend: (event) =>
        event.message?.formatted.includes("drop me")
          ? null
          : { ...event, user: { id: "[redacted]" } },
    });
    const { ctx, calls, payload } = fakeCtx();

    expect(await sentry.captureMessage(ctx, "drop me")).toBeNull();
    await sentry.captureMessage(ctx, "keep me", {
      user: { id: "user_1", email: "a@b.co" },
    });

    expect(calls).toHaveLength(1);
    expect(payload().user).toEqual({ id: "[redacted]" });
  });

  test("sampleRate and enabled skip capture", async () => {
    const { ctx, calls } = fakeCtx();
    const disabled = new Sentry(components.convexSentry, {
      dsn: DSN,
      enabled: false,
    });
    expect(await disabled.captureMessage(ctx, "nope")).toBeNull();

    const sampled = new Sentry(components.convexSentry, {
      dsn: DSN,
      sampleRate: 0.5,
    });
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);
    expect(await sampled.captureMessage(ctx, "dropped")).toBeNull();
    expect(await sampled.captureMessage(ctx, "kept")).not.toBeNull();
    random.mockRestore();

    expect(calls.map((c) => c.title)).toEqual(["kept"]);
  });

  test("a failure to record never throws into the caller", async () => {
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const ctx = {
      runMutation: vi.fn().mockRejectedValue(new Error("boom")),
    } as any;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sentry.captureMessage(ctx, "hello")).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("oversized payloads are trimmed to fit", async () => {
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const { ctx, calls, payload } = fakeCtx();
    const extra = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`k${i}`, "x".repeat(8_000)]),
    );

    await sentry.captureMessage(ctx, "big", {
      extra,
      breadcrumbs: Array.from({ length: 50 }, () => ({
        message: "y".repeat(8_000),
      })),
    });

    expect(calls[0].payload.length).toBeLessThanOrEqual(200_000);
    expect(payload().breadcrumbs).toBeUndefined();
    expect(payload().extra).toEqual({
      truncated: "extra data was too large to send",
    });
  });

  test("withSentry captures as unhandled and rethrows", async () => {
    const sentry = new Sentry(components.convexSentry, { dsn: DSN });
    const { ctx, calls } = fakeCtx();

    await expect(
      sentry.withSentry(
        ctx,
        async () => {
          throw new Error("upstream down");
        },
        { functionName: "inventory:sync" },
      ),
    ).rejects.toThrow("upstream down");
    expect(calls[0]).toMatchObject({
      handled: false,
      functionName: "inventory:sync",
    });

    expect(await sentry.withSentry(ctx, async () => 7)).toBe(7);
    expect(calls).toHaveLength(1);
  });
});
