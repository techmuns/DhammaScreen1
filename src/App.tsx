export function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="app-eyebrow">Dhamma Capital</span>
        <h1 className="app-title">Earnings Dashboard 1</h1>
      </header>
      <section className="app-status">
        <p>
          Dhamma Dashboard 1 foundation ready. Data audit, schema, helpers, and
          ingestion scaffold created.
        </p>
        <p className="app-status-note">
          UI intentionally minimal at this step. See{" "}
          <code>docs/dhamma-dashboard-1-plan.md</code> and{" "}
          <code>docs/dhamma-dashboard-1-metric-audit.md</code>.
        </p>
      </section>
    </main>
  );
}
