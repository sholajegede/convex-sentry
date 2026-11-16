import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function SetupBanner() {
  const setup = useQuery(api.example.getSetup);
  if (setup === undefined) return null;

  if (!setup.connected) {
    return (
      <div className="banner">
        <span className="dot-indicator" />
        <div>
          <strong>No DSN set, so events stay in Convex.</strong> Everything
          below still works and shows up in the Events and Issues tabs. To send
          events to Sentry, run{" "}
          <code>npx convex env set SENTRY_DSN https://…</code> with the DSN from
          your Sentry project's Client Keys page.
        </div>
      </div>
    );
  }

  return (
    <div className="banner connected">
      <span className="dot-indicator" />
      <div>
        <strong>Connected.</strong> Events go to Sentry project{" "}
        <code>{setup.projectId}</code> at <code>{setup.host}</code>. Open the
        project's Issues page next to this tab to see them arrive.
      </div>
    </div>
  );
}
