import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { withLog } from "../lib/logStore";
import {
  formatAgo,
  formatIn,
  formatTime,
  prettyJson,
  useNow,
} from "../lib/format";
import type { EventDoc } from "../lib/types";
import { Button, Level, StatusPill } from "./ui";

export function EventList(props: {
  events: EventDoc[] | undefined;
  emptyText: string;
}) {
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);

  if (props.events === undefined)
    return <div className="event-list empty">Loading…</div>;
  if (props.events.length === 0)
    return <div className="event-list empty">{props.emptyText}</div>;

  return (
    <ul className="event-list">
      {props.events.map((event) => (
        <EventRow
          key={event._id}
          event={event}
          now={now}
          open={open === event.eventId}
          onToggle={() =>
            setOpen(open === event.eventId ? null : event.eventId)
          }
        />
      ))}
    </ul>
  );
}

function EventRow(props: {
  event: EventDoc;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { event, now } = props;
  const retry = useMutation(api.example.retry);

  return (
    <li className="event-row">
      <button
        className="event-summary"
        onClick={props.onToggle}
        aria-expanded={props.open}
      >
        <StatusPill status={event.status} />
        <div style={{ minWidth: 0 }}>
          <div className="event-title">{event.title}</div>
          <div className="event-meta">
            <Level level={event.level} />
            {event.functionName && <span>{event.functionName}</span>}
            {!event.handled && <span>unhandled</span>}
            {event.attempts > 1 && <span>{event.attempts} attempts</span>}
            {event.status === "retrying" && event.nextAttemptAt && (
              <span>next try {formatIn(event.nextAttemptAt, now)}</span>
            )}
          </div>
        </div>
        <span className="event-time">{formatAgo(event.createdAt, now)}</span>
      </button>

      {props.open && (
        <div className="event-detail">
          <dl className="detail-grid">
            <dt>event id</dt>
            <dd>{event.eventId}</dd>
            <dt>fingerprint</dt>
            <dd>{event.fingerprint}</dd>
            <dt>captured</dt>
            <dd>{formatTime(event.createdAt)}</dd>
            {event.settledAt && (
              <>
                <dt>settled</dt>
                <dd>
                  {formatTime(event.settledAt)} (
                  {event.settledAt - event.createdAt}ms)
                </dd>
              </>
            )}
            {event.responseStatus !== undefined && (
              <>
                <dt>Sentry response</dt>
                <dd>{event.responseStatus}</dd>
              </>
            )}
            {event.lastError && (
              <>
                <dt>last error</dt>
                <dd className="err">{event.lastError}</dd>
              </>
            )}
            {event.userId && (
              <>
                <dt>user</dt>
                <dd>{event.userId}</dd>
              </>
            )}
          </dl>
          {event.status === "failed" && (
            <div className="detail-actions">
              <Button
                size="small"
                onClick={() =>
                  void withLog(`retry(${event.eventId.slice(0, 8)})`, () =>
                    retry({ eventId: event.eventId }),
                  ).catch(() => {})
                }
              >
                Retry delivery
              </Button>
            </div>
          )}
          <pre className="payload">{prettyJson(event.payload)}</pre>
        </div>
      )}
    </li>
  );
}
