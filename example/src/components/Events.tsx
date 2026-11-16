import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { STATUSES, statusLabel, type Status } from "../lib/types";
import { EventList } from "./EventList";

export function Events() {
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const events = useQuery(api.example.listEvents, { status, limit: 100 });

  return (
    <>
      <div className="filters">
        <button
          className={`chip${status === undefined ? " active" : ""}`}
          onClick={() => setStatus(undefined)}
        >
          all
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`chip${status === s ? " active" : ""}`}
            onClick={() => setStatus(s)}
          >
            {statusLabel(s)}
          </button>
        ))}
      </div>
      <EventList
        events={events}
        emptyText={
          status ? `No ${statusLabel(status)} events.` : "Nothing captured yet."
        }
      />
    </>
  );
}
