import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema.js";
import componentSchema from "../../src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
const componentModules = import.meta.glob("../../src/component/**/*.ts");

function initConvexTest() {
  const t = convexTest(schema, modules);
  t.registerComponent("convexSentry", componentSchema, componentModules);
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a broken coupon is captured and the order still goes through", async () => {
  const t = initConvexTest();

  const result = await t.mutation(api.example.placeOrder, {
    sku: "MUG-01",
    quantity: 2,
    couponCode: "SPRING25",
    customerId: "cust_1",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(result.discountApplied).toBe(false);
  expect(result.eventId).not.toBeNull();
  const orders = await t.query(api.example.recentOrders, {});
  expect(orders).toHaveLength(1);

  const event = await t.query(api.example.getEvent, {
    eventId: result.eventId!,
  });
  expect(event).toMatchObject({
    kind: "exception",
    status: "local",
    functionName: "example:placeOrder",
    userId: "cust_1",
    handled: true,
  });
  expect(event?.title).toMatch(/^SyntaxError: /);
});

test("a valid coupon captures nothing", async () => {
  const t = initConvexTest();
  const result = await t.mutation(api.example.placeOrder, {
    sku: "MUG-01",
    quantity: 1,
    couponCode: "SAVE10",
    customerId: "cust_2",
  });
  expect(result).toMatchObject({ discountApplied: true, eventId: null });
  expect(await t.query(api.example.listEvents, {})).toEqual([]);
});

test("an action error is captured as unhandled and rethrown", async () => {
  const t = initConvexTest();

  await expect(
    t.action(api.example.syncInventory, { sku: "LAMP-2", fail: true }),
  ).rejects.toThrow(/timed out/);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const [event] = await t.query(api.example.listEvents, {});
  expect(event).toMatchObject({
    handled: false,
    functionName: "example:syncInventory",
  });
  const payload = JSON.parse(event.payload);
  expect(payload.exception.values).toHaveLength(2);
  expect(payload.exception.values[0].value).toContain("ETIMEDOUT");
});

test("a burst of the same error becomes one group", async () => {
  const t = initConvexTest();

  await t.mutation(api.example.burst, { count: 10 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const groups = await t.query(api.example.listGroups, {});
  expect(groups).toHaveLength(1);
  expect(groups[0].count).toBe(10);
  expect((await t.query(api.example.getStats, {})).local).toBe(10);
});
