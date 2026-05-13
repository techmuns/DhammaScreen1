import { useState } from "react";

import { CompanySelector } from "./components/CompanySelector";
import { DashboardHeader } from "./components/DashboardHeader";
import { DataProvenancePanel } from "./components/DataProvenancePanel";
import { DataStatusPanel } from "./components/DataStatusPanel";
import { FinancialStatementTables } from "./components/FinancialStatementTables";
import { GuidanceTrackerPanel } from "./components/GuidanceTrackerPanel";
import { KpiSummaryCards } from "./components/KpiSummaryCards";
// Note: PeerComparisonTable is intentionally NOT rendered. Peer comparison
// is now folded into KpiSummaryCards as per-KPI benchmarks. The file is
// kept in src/components/PeerComparisonTable.tsx for reference / future
// reactivation if the client asks for a standalone table.
import { PeriodToggle, type PeriodView } from "./components/PeriodToggle";
import { companyMasterSnapshot } from "./data/helpers/snapshotLoader";

export function App() {
  const companies = companyMasterSnapshot.rows;
  const [companyId, setCompanyId] = useState<string | null>(
    companies[0]?.companyId ?? null
  );
  const [periodView, setPeriodView] = useState<PeriodView>("quarters");

  return (
    <div className="dashboard-shell">
      <DashboardHeader />

      <section className="dashboard-controls" aria-label="Controls">
        <CompanySelector
          companies={companies}
          value={companyId}
          onChange={setCompanyId}
        />
        <PeriodToggle value={periodView} onChange={setPeriodView} />
      </section>

      <DataStatusPanel />

      <KpiSummaryCards companyId={companyId} periodView={periodView} />

      <p className="source-precedence-note">
        Dashboard uses cached <strong>consolidated</strong> Screener
        financials for current numbers — never live-fetched. Official
        filing extraction is discovery-only for now: filings are catalogued
        in the manifest below, but financial rows are not yet parsed out of
        the source documents. Reconcile any number against the original
        filing before quoting it externally.
      </p>

      <FinancialStatementTables
        companyId={companyId}
        periodView={periodView}
      />

      <GuidanceTrackerPanel companyId={companyId} companies={companies} />

      <DataProvenancePanel />

      <footer className="dashboard-footer">
        <p>
          Dashboard 1 · Consolidated Screener financials, cached. Official
          filing snapshots remain discovery-only and never co-mingle with
          fetched rows. Missing values render as “—”, never zero.
        </p>
      </footer>
    </div>
  );
}
