import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { kindValidator, levelValidator, statusValidator } from "./shared.js";

export default defineSchema({
  events: defineTable({
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
  })
    .index("by_eventId", ["eventId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_fingerprint", ["fingerprint", "createdAt"]),

  groups: defineTable({
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
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_lastSeen", ["lastSeen"]),
});
