import { useEffect, useRef, useState } from "react";

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
import { SdkStatusPanel } from "./components/SdkStatusPanel";
import { WidgetCard } from "./components/WidgetCard";
import {
  formatGenerationTimestamp,
  latestGeneratedAt,
} from "./data/helpers/dhammaFinancials";
import {
  ALL_SNAPSHOT_METAS,
  companyMasterSnapshot,
} from "./data/helpers/snapshotLoader";
import { useMunshotSdk } from "./sdk/useMunshotSdk";

const DASHBOARD_ID = "dhamma-earnings-1";
const DASHBOARD_NAME = "Dhamma Earnings Dashboard 1";

export function App() {
  const companies = companyMasterSnapshot.rows;
  const [companyId, setCompanyId] = useState<string | null>(
    companies[0]?.companyId ?? null
  );
  const [periodView, setPeriodView] = useState<PeriodView>("quarters");

  const sdk = useMunshotSdk({
    dashboardId: DASHBOARD_ID,
    dashboardName: DASHBOARD_NAME,
  });

  // 6. Host-pushed ticker → drive the selected company. We do this from
  // App.tsx (not the hook) because only the dashboard knows the company
  // master and what counts as a match.
  useEffect(() => {
    const hostTicker = pickHostTicker(sdk.context);
    if (!hostTicker) return;
    const match = companies.find(
      (c) =>
        (c.nseSymbol && c.nseSymbol === hostTicker) ||
        c.companyId === hostTicker
    );
    if (match && match.companyId !== companyId) {
      setCompanyId(match.companyId);
    }
    // companies is build-time static so it's safe to exclude from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk.context]);

  // Publish dashboard.* telemetry when the user changes inputs. Guarded
  // on a "ready to emit" ref so we don't fire on mount before the SDK is
  // connected.
  const didConnect = useRef(false);
  useEffect(() => {
    if (sdk.status === "connected") {
      didConnect.current = true;
    }
  }, [sdk.status]);

  useEffect(() => {
    if (!didConnect.current) return;
    if (!companyId) return;
    const company = companies.find((c) => c.companyId === companyId);
    sdk.publish("portfolio.ticker.select", {
      companyId,
      ticker: company?.nseSymbol ?? null,
      displayName: company?.displayName ?? null,
      source: "dashboard-user",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    if (!didConnect.current) return;
    sdk.publish("analytics.filter.change", {
      filter: "period",
      value: periodView,
      dashboardId: DASHBOARD_ID,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodView]);

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
        sdkStatus={sdk.status}
        actions={<PeriodToggle value={periodView} onChange={setPeriodView} />}
      />

      <main className="dashboard-main">
        {/* Row 1: filters / context + Munshot SDK status + data source status */}
        <div className="widget-grid widget-grid--wide">
          <WidgetCard
            title="Company"
            subtitle="Selected company drives every metric, table, and benchmark below."
            bodyPadding="padded"
          >
            <CompanySelector
              companies={companies}
              value={companyId}
              onChange={setCompanyId}
            />
          </WidgetCard>

          <WidgetCard
            title="Munshot SDK"
            subtitle="Host integration · use the buttons to verify the round-trip."
            bodyPadding="flush"
          >
            <SdkStatusPanel sdk={sdk} dashboardId={DASHBOARD_ID} />
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

function pickHostTicker(context: unknown): string | null {
  if (!context || typeof context !== "object") return null;
  const ctx = context as Record<string, unknown>;
  for (const key of ["ticker", "symbol", "nseSymbol"]) {
    const v = ctx[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
