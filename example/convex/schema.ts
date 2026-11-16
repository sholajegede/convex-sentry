import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  orders: defineTable({
    sku: v.string(),
    quantity: v.number(),
    couponCode: v.optional(v.string()),
    discountApplied: v.boolean(),
    createdAt: v.number(),
  }),
});
