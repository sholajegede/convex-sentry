/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { batchSize?: number; olderThanMs: number },
        { deleted: number; hasMore: boolean },
        Name
      >;
      enqueue: FunctionReference<
        "mutation",
        "internal",
        {
          dedupeWindowMs?: number;
          dsn?: string;
          environment?: string;
          eventId: string;
          fingerprint: string;
          functionName?: string;
          handled: boolean;
          kind: "exception" | "message";
          level: "fatal" | "error" | "warning" | "info" | "debug";
          maxAttempts?: number;
          payload: string;
          title: string;
          userId?: string;
        },
        string,
        Name
      >;
      getEvent: FunctionReference<
        "query",
        "internal",
        { eventId: string },
        null | {
          _creationTime: number;
          _id: string;
          attempts: number;
          createdAt: number;
          dedupeWindowMs: number;
          dsn?: string;
          environment?: string;
          eventId: string;
          fingerprint: string;
          functionName?: string;
          handled: boolean;
          kind: "exception" | "message";
          lastError?: string;
          level: "fatal" | "error" | "warning" | "info" | "debug";
          maxAttempts: number;
          nextAttemptAt?: number;
          payload: string;
          responseStatus?: number;
          settledAt?: number;
          status:
            | "pending"
            | "retrying"
            | "sent"
            | "failed"
            | "suppressed"
            | "local";
          title: string;
          userId?: string;
        },
        Name
      >;
      getStats: FunctionReference<
        "query",
        "internal",
        {},
        {
          captured: number;
          failed: number;
          groups: number;
          local: number;
          queued: number;
          sent: number;
          suppressed: number;
        },
        Name
      >;
      listEvents: FunctionReference<
        "query",
        "internal",
        {
          limit?: number;
          status?:
            | "pending"
            | "retrying"
            | "sent"
            | "failed"
            | "suppressed"
            | "local";
        },
        Array<{
          _creationTime: number;
          _id: string;
          attempts: number;
          createdAt: number;
          dedupeWindowMs: number;
          dsn?: string;
          environment?: string;
          eventId: string;
          fingerprint: string;
          functionName?: string;
          handled: boolean;
          kind: "exception" | "message";
          lastError?: string;
          level: "fatal" | "error" | "warning" | "info" | "debug";
          maxAttempts: number;
          nextAttemptAt?: number;
          payload: string;
          responseStatus?: number;
          settledAt?: number;
          status:
            | "pending"
            | "retrying"
            | "sent"
            | "failed"
            | "suppressed"
            | "local";
          title: string;
          userId?: string;
        }>,
        Name
      >;
      listEventsForGroup: FunctionReference<
        "query",
        "internal",
        { fingerprint: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          attempts: number;
          createdAt: number;
          dedupeWindowMs: number;
          dsn?: string;
          environment?: string;
          eventId: string;
          fingerprint: string;
          functionName?: string;
          handled: boolean;
          kind: "exception" | "message";
          lastError?: string;
          level: "fatal" | "error" | "warning" | "info" | "debug";
          maxAttempts: number;
          nextAttemptAt?: number;
          payload: string;
          responseStatus?: number;
          settledAt?: number;
          status:
            | "pending"
            | "retrying"
            | "sent"
            | "failed"
            | "suppressed"
            | "local";
          title: string;
          userId?: string;
        }>,
        Name
      >;
      listGroups: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          count: number;
          failedCount: number;
          fingerprint: string;
          firstSeen: number;
          functionName?: string;
          kind: "exception" | "message";
          lastEventId: string;
          lastSeen: number;
          level: "fatal" | "error" | "warning" | "info" | "debug";
          reservedAt?: number;
          reservedBy?: string;
          sentCount: number;
          suppressedCount: number;
          title: string;
        }>,
        Name
      >;
      retry: FunctionReference<
        "mutation",
        "internal",
        { eventId: string },
        boolean,
        Name
      >;
    };
  };
