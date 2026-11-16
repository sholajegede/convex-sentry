import { useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { errorMessage, withLog } from "../lib/logStore";
import { Button, Card } from "./ui";
import { EventList } from "./EventList";

type Result = { tone: "ok" | "err"; text: string } | null;

function useRunner() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  async function run(title: string, fn: () => Promise<string>) {
    setBusy(true);
    setResult(null);
    try {
      const text = await withLog(title, fn);
      setResult({ tone: "ok", text });
    } catch (err) {
      setResult({ tone: "err", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return { busy, result, run };
}

function Scenario(props: {
  title: string;
  kind: string;
  description: ReactNode;
  result: Result;
  children: ReactNode;
}) {
  return (
    <Card className="scenario">
      <div className="scenario-head">
        <h2>{props.title}</h2>
        <span className="kind-tag">{props.kind}</span>
      </div>
      <p className="card-desc">{props.description}</p>
      <div className="scenario-controls">{props.children}</div>
      {props.result && (
        <div className="scenario-result">
          <span className={props.result.tone}>
            {props.result.tone === "ok" ? "✓ " : "✗ "}
          </span>
          {props.result.text}
        </div>
      )}
    </Card>
  );
}

function CheckoutScenario(props: { customerId: string }) {
  const placeOrder = useMutation(api.example.placeOrder);
  const [coupon, setCoupon] = useState("SPRING25");
  const { busy, result, run } = useRunner();

  return (
    <Scenario
      title="Broken coupon at checkout"
      kind="mutation · handled"
      description={
        <>
          The <code>SPRING25</code> rule is malformed JSON. The mutation catches
          the parse error, captures it with the cart as breadcrumbs, and still
          places the order without the discount.
        </>
      }
      result={result}
    >
      <select value={coupon} onChange={(e) => setCoupon(e.target.value)}>
        <option value="SPRING25">SPRING25 (broken rule)</option>
        <option value="SAVE10">SAVE10 (valid rule)</option>
      </select>
      <Button
        disabled={busy}
        onClick={() =>
          run(`placeOrder(${coupon})`, async () => {
            const r = await placeOrder({
              sku: "MUG-01",
              quantity: 2,
              couponCode: coupon,
              customerId: props.customerId,
            });
            return r.eventId
              ? `Order placed without discount. Captured ${r.eventId.slice(0, 12)}…`
              : "Order placed with discount. Nothing to capture.";
          })
        }
      >
        Place order
      </Button>
    </Scenario>
  );
}

function InventoryScenario() {
  const syncInventory = useAction(api.example.syncInventory);
  const { busy, result, run } = useRunner();

  return (
    <Scenario
      title="Inventory sync times out"
      kind="action · unhandled"
      description={
        <>
          An action calls a supplier API that times out. <code>withSentry</code>{" "}
          captures the error and its cause chain, then rethrows it, so the
          client still sees the failure.
        </>
      }
      result={result}
    >
      <Button
        disabled={busy}
        onClick={() =>
          run("syncInventory(fail)", async () => {
            await syncInventory({ sku: "LAMP-2", fail: true });
            return "Sync finished";
          })
        }
      >
        Run sync
      </Button>
    </Scenario>
  );
}

function SlowCheckoutScenario() {
  const report = useMutation(api.example.reportSlowCheckout);
  const [duration, setDuration] = useState(3200);
  const { busy, result, run } = useRunner();

  return (
    <Scenario
      title="Slow checkout warning"
      kind="captureMessage"
      description="Not every event is an exception. This sends a warning-level message when a checkout goes over its time budget."
      result={result}
    >
      <input
        type="number"
        value={duration}
        min={0}
        step={100}
        onChange={(e) => setDuration(Number(e.target.value))}
        aria-label="Checkout duration in milliseconds"
      />
      <span className="mono" style={{ color: "var(--text-dim)" }}>
        ms
      </span>
      <Button
        disabled={busy}
        onClick={() =>
          run(`reportSlowCheckout(${duration})`, async () => {
            const id = await report({ durationMs: duration });
            return id ? `Captured ${id.slice(0, 12)}…` : "Dropped";
          })
        }
      >
        Send warning
      </Button>
    </Scenario>
  );
}

function BurstScenario() {
  const burst = useMutation(api.example.burst);
  const { busy, result, run } = useRunner();

  return (
    <Scenario
      title="Webhook error storm"
      kind="dedupe"
      description="Ten webhooks fail the same way in one mutation. All ten are kept here, grouped as one issue, and only the first is sent to Sentry."
      result={result}
    >
      <Button
        disabled={busy}
        onClick={() =>
          run("burst(10)", async () => {
            const ids = await burst({ count: 10 });
            return `Captured ${ids.filter(Boolean).length} events`;
          })
        }
      >
        Fire 10 errors
      </Button>
    </Scenario>
  );
}

function RejectedKeyScenario() {
  const send = useMutation(api.example.sendWithRejectedKey);
  const { busy, result, run } = useRunner();

  return (
    <Scenario
      title="Delivery to a rejected key"
      kind="failure path"
      description="This event goes to a DSN whose key Sentry rejects. A 4xx is not retried, so the event is marked failed and keeps the response. Retry it from the Events tab."
      result={result}
    >
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          run("sendWithRejectedKey()", async () => {
            const id = await send({});
            return id ? `Captured ${id.slice(0, 12)}…` : "Dropped";
          })
        }
      >
        Send it
      </Button>
    </Scenario>
  );
}

export function Scenarios(props: {
  customerId: string;
  onOpenEvents: () => void;
}) {
  const events = useQuery(api.example.listEvents, { limit: 6 });

  return (
    <>
      <div className="scenario-grid">
        <CheckoutScenario customerId={props.customerId} />
        <InventoryScenario />
        <SlowCheckoutScenario />
        <BurstScenario />
        <RejectedKeyScenario />
        <Card className="scenario" title="Retention">
          <p className="card-desc">
            Settled events are kept until you delete them. In an app you call{" "}
            <code>sentry.cleanup()</code> from a daily cron. It deletes in
            batches and reschedules itself until done.
          </p>
        </Card>
      </div>

      <div className="section-title">
        Live feed ·{" "}
        <button className="chip" onClick={props.onOpenEvents}>
          see all events
        </button>
      </div>
      <EventList
        events={events}
        emptyText="Nothing captured yet. Trigger a scenario above."
      />
    </>
  );
}
