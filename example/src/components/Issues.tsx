import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatAgo, useNow } from "../lib/format";
import type { GroupDoc } from "../lib/types";
import { EventList } from "./EventList";
import { Level } from "./ui";

export function Issues() {
  const groups = useQuery(api.example.listGroups, { limit: 50 });
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(5000);

  if (groups === undefined)
    return <div className="event-list empty">Loading…</div>;
  if (groups.length === 0) {
    return (
      <div className="event-list empty">
        No issues yet. Each fingerprint becomes one issue here.
      </div>
    );
  }

  return (
    <ul className="event-list">
      {groups.map((group) => (
        <li key={group._id} className="event-row">
          <button
            className="event-summary issue"
            style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
            onClick={() =>
              setOpen(open === group.fingerprint ? null : group.fingerprint)
            }
            aria-expanded={open === group.fingerprint}
          >
            <div style={{ minWidth: 0 }}>
              <div className="event-title">{group.title}</div>
              <div className="event-meta">
                <Level level={group.level} />
                {group.functionName && <span>{group.functionName}</span>}
                <span>first {formatAgo(group.firstSeen, now)}</span>
                <span>last {formatAgo(group.lastSeen, now)}</span>
              </div>
              <DeliveryBar group={group} />
            </div>
            <div className="issue-count" title="events captured">
              {group.count}
            </div>
          </button>
          {open === group.fingerprint && (
            <GroupEvents fingerprint={group.fingerprint} />
          )}
        </li>
      ))}
    </ul>
  );
}

function DeliveryBar(props: { group: GroupDoc }) {
  const { count, sentCount, suppressedCount, failedCount } = props.group;
  const other = Math.max(0, count - sentCount - suppressedCount - failedCount);
  const segments = [
    { key: "sent", value: sentCount, label: "sent" },
    { key: "suppressed", value: suppressedCount, label: "deduplicated" },
    { key: "failed", value: failedCount, label: "failed" },
    { key: "local", value: other, label: "local or in flight" },
  ].filter((s) => s.value > 0);

  return (
    <>
      <div className="delivery-bar">
        {segments.map((s) => (
          <span
            key={s.key}
            className={s.key}
            style={{ width: `${(s.value / Math.max(count, 1)) * 100}%` }}
          />
        ))}
      </div>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.key}>
            {s.value} {s.label}
          </span>
        ))}
      </div>
    </>
  );
}

function GroupEvents(props: { fingerprint: string }) {
  const events = useQuery(api.example.listEventsForGroup, {
    fingerprint: props.fingerprint,
    limit: 20,
  });
  return (
    <div className="event-detail" style={{ paddingTop: "1rem" }}>
      <EventList events={events} emptyText="No events kept for this issue." />
    </div>
  );
}
