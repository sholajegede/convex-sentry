import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { LogoMark } from "./ui";

export type Tab = "overview" | "scenarios" | "events" | "issues";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "scenarios", label: "Scenarios" },
  { id: "events", label: "Events" },
  { id: "issues", label: "Issues" },
];

export function Header(props: { tab: Tab; onTab: (tab: Tab) => void }) {
  const stats = useQuery(api.example.getStats);

  const cells = [
    { key: "captured", label: "captured", value: stats?.captured },
    { key: "sent", label: "sent to Sentry", value: stats?.sent },
    { key: "suppressed", label: "deduplicated", value: stats?.suppressed },
    { key: "failed", label: "failed", value: stats?.failed },
    { key: "queued", label: "in flight", value: stats?.queued },
  ];

  return (
    <header className="hero">
      <div className="hero-stats">
        {cells.map((cell) => (
          <div key={cell.key} className={`stat ${cell.key}`}>
            <div className="stat-value">{cell.value ?? "–"}</div>
            <div className="stat-label">{cell.label}</div>
          </div>
        ))}
      </div>

      <div className="hero-main">
        <div className="wordmark">
          <LogoMark /> convex-sentry
        </div>
        <h1 className="hero-title">
          Every <span className="hl">handled error</span>
          <br />
          in Convex, in Sentry
        </h1>
        <p className="hero-sub">
          Capture errors and messages from mutations and actions. Each event is
          written to Convex first, then delivered to Sentry with retries, so
          nothing is lost when a function returns early or Sentry is briefly
          down.
        </p>
      </div>

      <div className="hero-stripe" />

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab${props.tab === tab.id ? " active" : ""}`}
            onClick={() => props.onTab(tab.id)}
          >
            {tab.label}
            {tab.id === "issues" && stats && stats.groups > 0 && (
              <span className="count">{stats.groups}</span>
            )}
          </button>
        ))}
      </nav>
    </header>
  );
}
