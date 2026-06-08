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
import { WidgetCard } from "./components/WidgetCard";
import {
  formatGenerationTimestamp,
  latestGeneratedAt,
} from "./data/helpers/dhammaFinancials";
import {
  ALL_SNAPSHOT_METAS,
  companyMasterSnapshot,
} from "./data/helpers/snapshotLoader";

export function App() {
  const companies = companyMasterSnapshot.rows;
  const [companyId, setCompanyId] = useState<string | null>(
    companies[0]?.companyId ?? null
  );
  const [periodView, setPeriodView] = useState<PeriodView>("quarters");

  const selectedCompany =
    companies.find((c) => c.companyId === companyId) ?? null;
  const tickerLabel = selectedCompany?.nseSymbol ?? null;
  const companyLabel = selectedCompany?.displayName ?? null;
  const lastUpdated = formatGenerationTimestamp(
    latestGeneratedAt(ALL_SNAPSHOT_METAS.map((meta) => ({ meta })))
  );

  return (
    <div className="dashboard-shell">
      <DashboardHeader
        title="Dhamma Earnings"
        ticker={tickerLabel}
        company={companyLabel}
        lastUpdated={lastUpdated}
        actions={<PeriodToggle value={periodView} onChange={setPeriodView} />}
      />

      <main className="dashboard-main">
        {/* Row 1: filters / context + data source status */}
        <div className="widget-grid widget-grid--wide">
          <WidgetCard
            title="Company"
            subtitle="Selected company defines every metric, table, and benchmark below."
            bodyPadding="padded"
          >
            <CompanySelector
              companies={companies}
              value={companyId}
              onChange={setCompanyId}
            />
          </WidgetCard>

          <WidgetCard
            title="Data source status"
            subtitle="Live snapshot of each pipeline — what's flowing and what isn't."
            bodyPadding="padded"
          >
            <DataStatusPanel />
          </WidgetCard>
        </div>

        {/* Row 2: KPI peer benchmarks */}
        <KpiSummaryCards companyId={companyId} periodView={periodView} />

        {/* Source precedence note — sits between KPIs and the wide statement card. */}
        <p className="source-precedence-note">
          Dashboard uses cached <strong>consolidated</strong> Screener
          financials for current numbers — never live-fetched. Official
          filing extraction is discovery-only for now: filings are
          catalogued in the provenance panel below, but financial rows are
          not yet parsed out of the source documents. Reconcile any number
          against the original filing before quoting it externally.
        </p>

        {/* Row 3: Primary analysis — wide financial statements card. */}
        <WidgetCard
          title="Financial statements"
          subtitle="P&L, revenue mix, balance sheet, and cash flow for the selected company."
          span={2}
          bodyPadding="flush"
        >
          <FinancialStatementTables
            companyId={companyId}
            periodView={periodView}
          />
        </WidgetCard>

        {/* Row 4: Supporting insight — guidance tracker */}
        <WidgetCard
          title="Guidance tracker"
          subtitle="Lines up management commentary against reported actuals."
          bodyPadding="flush"
        >
          <GuidanceTrackerPanel
            companyId={companyId}
            companies={companies}
          />
        </WidgetCard>

        {/* Row 5: Source / provenance */}
        <WidgetCard
          title="Data provenance"
          subtitle="Cached snapshots only — the UI never live-fetches."
          span={2}
          bodyPadding="flush"
        >
          <DataProvenancePanel />
        </WidgetCard>
      </main>
    </div>
  );
}
