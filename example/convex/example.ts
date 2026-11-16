import { action, mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { Sentry } from "../../src/client/index.js";
import { v } from "convex/values";

export const sentry = new Sentry(components.convexSentry, {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? "development",
  release: "convex-sentry-example@0.0.0",
  tags: { app: "convex-sentry-example" },
});

// A DSN with a key Sentry will never accept, so the demo can show a failed
// delivery and the retry button without breaking the real project.
const REJECTED_DSN =
  "https://00000000000000000000000000000000@o0.ingest.sentry.io/0";

const COUPON_RULES: Record<string, string> = {
  SAVE10: '{"percentOff":10}',
  SPRING25: '{"percentOff":25,',
};

const statusArg = v.optional(
  v.union(
    v.literal("pending"),
    v.literal("retrying"),
    v.literal("sent"),
    v.literal("failed"),
    v.literal("suppressed"),
    v.literal("local"),
  ),
);

// A checkout that must not fail because a coupon rule is broken. The error is
// caught, captured, and the order still goes through without the discount.
// The mutation commits, so the captured event commits with it.
export const placeOrder = mutation({
  args: {
    sku: v.string(),
    quantity: v.number(),
    couponCode: v.optional(v.string()),
    customerId: v.string(),
  },
  handler: async (ctx, args) => {
    let discountApplied = false;
    let eventId: string | null = null;

    if (args.couponCode) {
      const rule = COUPON_RULES[args.couponCode];
      if (rule !== undefined) {
        try {
          const parsed = JSON.parse(rule) as { percentOff: number };
          discountApplied = parsed.percentOff > 0;
        } catch (error) {
          eventId = await sentry.captureException(ctx, error, {
            functionName: "example:placeOrder",
            tags: { feature: "coupons" },
            extra: { couponCode: args.couponCode, rule },
            user: { id: args.customerId },
            breadcrumbs: [
              {
                category: "checkout",
                message: `Cart has ${args.quantity} × ${args.sku}`,
              },
              {
                category: "coupons",
                message: `Looking up rule for ${args.couponCode}`,
              },
            ],
          });
        }
      }
    }

    const orderId = await ctx.db.insert("orders", {
      sku: args.sku,
      quantity: args.quantity,
      couponCode: args.couponCode,
      discountApplied,
      createdAt: Date.now(),
    });
    return { orderId, discountApplied, eventId };
  },
});

// An action that calls a third party. withSentry captures the error as
// unhandled, with its cause chain, then rethrows it to the caller.
export const syncInventory = action({
  args: { sku: v.string(), fail: v.boolean() },
  handler: async (ctx, args) =>
    await sentry.withSentry(
      ctx,
      async () => {
        if (args.fail) {
          const cause = new Error("connect ETIMEDOUT 10.0.4.12:443");
          throw new Error(
            `Inventory sync for ${args.sku} timed out after 8000ms`,
            { cause },
          );
        }
        return { sku: args.sku, inStock: 42 };
      },
      { functionName: "example:syncInventory", tags: { feature: "inventory" } },
    ),
});

export const reportSlowCheckout = mutation({
  args: { durationMs: v.number() },
  handler: async (ctx, args) => {
    return await sentry.captureMessage(
      ctx,
      `Checkout took ${args.durationMs}ms`,
      {
        level: "warning",
        functionName: "example:reportSlowCheckout",
        extra: { durationMs: args.durationMs, budgetMs: 1500 },
      },
    );
  },
});

// The same error captured many times in one burst. Every copy is kept in
// Convex, but only the first inside the dedupe window is sent to Sentry.
export const burst = mutation({
  args: { count: v.number() },
  handler: async (ctx, args) => {
    const ids: Array<string | null> = [];
    for (let i = 0; i < Math.min(args.count, 25); i++) {
      ids.push(
        await sentry.captureException(
          ctx,
          new Error(`Payment webhook for invoice ${1000 + i} had no signature`),
          { functionName: "example:burst", tags: { feature: "webhooks" } },
        ),
      );
    }
    return ids;
  },
});

export const sendWithRejectedKey = mutation({
  args: {},
  handler: async (ctx) => {
    return await sentry.captureException(
      ctx,
      new Error("Nightly report export failed"),
      { functionName: "example:sendWithRejectedKey", dsn: REJECTED_DSN },
    );
  },
});

export const retry = mutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => await sentry.retry(ctx, args),
});

export const cleanup = mutation({
  args: { olderThanMs: v.number() },
  handler: async (ctx, args) => await sentry.cleanup(ctx, args),
});

export const listEvents = query({
  args: { status: statusArg, limit: v.optional(v.number()) },
  handler: async (ctx, args) => await sentry.listEvents(ctx, args),
});

export const listGroups = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => await sentry.listGroups(ctx, args),
});

export const listEventsForGroup = query({
  args: { fingerprint: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => await sentry.listEventsForGroup(ctx, args),
});

export const getEvent = query({
  args: { eventId: v.string() },
  handler: async (ctx, args) => await sentry.getEvent(ctx, args),
});

export const getStats = query({
  args: {},
  handler: async (ctx) => await sentry.getStats(ctx),
});

export const recentOrders = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("orders").order("desc").take(5),
});

export const getSetup = query({
  args: {},
  handler: async () => {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return { connected: false as const };
    try {
      const url = new URL(dsn);
      return {
        connected: true as const,
        host: url.host,
        projectId: url.pathname.split("/").filter(Boolean).pop() ?? "",
      };
    } catch {
      return { connected: false as const };
    }
  },
});
