import { useState } from "react";
import "./theme.css";
import { Header, type Tab } from "./components/Header";
import { SetupBanner } from "./components/SetupBanner";
import { Overview } from "./components/Overview";
import { Scenarios } from "./components/Scenarios";
import { Events } from "./components/Events";
import { Issues } from "./components/Issues";
import { Console } from "./components/Console";

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [customerId] = useState(
    () => `cust_${Math.random().toString(36).slice(2, 8)}`,
  );

  return (
    <div className="shell">
      <main className="main">
        <Header tab={tab} onTab={setTab} />
        <SetupBanner />
        {tab === "overview" && <Overview onStart={() => setTab("scenarios")} />}
        {tab === "scenarios" && (
          <Scenarios
            customerId={customerId}
            onOpenEvents={() => setTab("events")}
          />
        )}
        {tab === "events" && <Events />}
        {tab === "issues" && <Issues />}
      </main>
      <Console />
    </div>
  );
}
