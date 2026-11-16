import { useEffect, useRef, useSyncExternalStore } from "react";
import { subscribe, getEntries } from "../lib/logStore";
import { formatTime } from "../lib/format";

export function Console() {
  const entries = useSyncExternalStore(subscribe, getEntries);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <aside className="console">
      <div className="console-header">
        <h3>Activity</h3>
        <p>
          Calls this page makes into the example's Convex functions. Delivery to
          Sentry happens afterwards in a scheduled action, so watch the Events
          tab for each event's status.
        </p>
      </div>
      <div className="console-log" ref={logRef}>
        {entries.length === 0 && (
          <div className="empty">Nothing yet. Trigger a scenario.</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`log-entry ${entry.status === "err" ? "err" : entry.status === "ok" ? "ok" : ""}`}
          >
            <div className="log-top">
              <span>{formatTime(entry.at)}</span>
              <span>
                {entry.status === "pending"
                  ? "…"
                  : entry.status === "ok"
                    ? "ok"
                    : "error"}
              </span>
            </div>
            <div className="log-title">{entry.title}</div>
            {entry.detail && <div className="log-detail">{entry.detail}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}
