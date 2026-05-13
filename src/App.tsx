import { useState } from "react";

import { CompanySelector } from "./components/CompanySelector";
import { DashboardHeader } from "./components/DashboardHeader";
import { DataProvenancePanel } from "./components/DataProvenancePanel";
import { DataStatusPanel } from "./components/DataStatusPanel";
import { FinancialStatementTables } from "./components/FinancialStatementTables";
import { GuidanceTrackerPanel } from "./components/GuidanceTrackerPanel";
import { KpiSummaryCards } from "./components/KpiSummaryCards";
import { PeerComparisonTable } from "./components/PeerComparisonTable";
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
        The dashboard reads cached snapshots only — it does not fetch
        Screener live. Resolution order: <strong>Official filing</strong>{" "}
        → <strong>Screener fetch</strong> → <strong>Screener import</strong>.
        Imported and fetched rows are labelled separately and should be
        reconciled against official filings before production use.
      </p>

      <FinancialStatementTables
        companyId={companyId}
        periodView={periodView}
      />

      <PeerComparisonTable companyId={companyId} />

      <GuidanceTrackerPanel companyId={companyId} companies={companies} />

      <DataProvenancePanel />

      <footer className="dashboard-footer">
        <p>
          Dashboard 1 · Source-first foundation. Imported (Screener) data is
          surfaced separately and is never merged into official snapshots.
          Missing values render as “—”, never zero.
        </p>
      </footer>
    </div>
  );
}
