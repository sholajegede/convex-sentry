import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

export type EventDoc = FunctionReturnType<
  typeof api.example.listEvents
>[number];
export type GroupDoc = FunctionReturnType<
  typeof api.example.listGroups
>[number];
export type Status = EventDoc["status"];

export const STATUSES: Status[] = [
  "pending",
  "retrying",
  "sent",
  "failed",
  "suppressed",
  "local",
];

const STATUS_LABELS: Record<Status, string> = {
  pending: "queued",
  retrying: "retrying",
  sent: "sent",
  failed: "failed",
  suppressed: "deduplicated",
  local: "local only",
};

export function statusLabel(status: Status): string {
  return STATUS_LABELS[status];
}
