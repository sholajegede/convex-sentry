import { Card } from "./ui";

const STEPS = [
  {
    title: "Capture",
    body: "captureException or captureMessage runs in your mutation or action and builds a Sentry event.",
  },
  {
    title: "Write",
    body: "The event is inserted into the component's table in the same transaction as your own writes.",
  },
  {
    title: "Deliver",
    body: "A scheduled action posts it to Sentry's envelope endpoint, retrying 5xx, 429 and network errors.",
  },
  {
    title: "Watch",
    body: "Status, attempts and grouping stay queryable from Convex, so this page updates live.",
  },
];

export function Overview(props: { onStart: () => void }) {
  return (
    <>
      <Card
        title="What this example shows"
        description={
          <>
            Convex's built-in Sentry integration reports errors that escape a
            function. This component covers the errors your code catches on
            purpose, like a broken coupon that should not block a checkout, plus
            warnings and messages you want in the same place. Open the{" "}
            <strong>Scenarios</strong> tab, trigger a few, and watch each event
            move from queued to sent in the <strong>Events</strong> tab.
          </>
        }
      >
        <div className="flow">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flow-step">
              <div className="n">0{i + 1}</div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Good to know">
        <ul className="check-list">
          <li>
            <strong>Mutations:</strong> capture an error you handle and let the
            mutation commit. If the mutation throws afterwards, Convex rolls
            back every write, the captured event included.
          </li>
          <li>
            <strong>Actions:</strong> <code>withSentry</code> captures an error
            as unhandled and rethrows it. Action writes are not rolled back, so
            the event survives.
          </li>
          <li>
            <strong>Dedupe:</strong> events with the same fingerprint inside 60
            seconds are all kept here, but only the first is sent, so an error
            storm does not burn your Sentry quota.
          </li>
          <li>
            <strong>No DSN:</strong> events stay in Convex with the status
            "local only". This is useful in development and on plans without the
            built-in integration.
          </li>
        </ul>
        <div style={{ marginTop: "1rem" }}>
          <button className="btn" onClick={props.onStart}>
            Open the scenarios
          </button>
        </div>
      </Card>
    </>
  );
}
