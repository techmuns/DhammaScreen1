import { useState } from "react";

import {
  formatNumberCompact,
  formatPercent,
  formatPercentRaw,
  growthQoQ,
  growthYoY,
  lastNQuarters,
  lastNYears,
  margin,
  revenueMix,
  screenerStatementRows,
  tableValueOrDash,
  type ScreenerPeriodSlice,
} from "../data/helpers/dhammaFinancials";
import {
  annualFinancialsSnapshot,
  balanceSheetSnapshot,
  cashFlowSnapshot,
  quarterlyFinancialsSnapshot,
  screenerNormalizedSnapshot,
  segmentRevenueSnapshot,
} from "../data/helpers/snapshotLoader";
import {
  metricLabel,
  type CanonicalMetric,
} from "../data/helpers/screenerMapping";
import type {
  AnnualFinancialRow,
  BalanceSheetRow,
  CashFlowRow,
  FinancialPeriod,
  QuarterlyFinancialRow,
  ScreenerSheetType,
} from "../data/types/dhammaDashboard";
import { EmptyState } from "./EmptyState";
import type { PeriodView } from "./PeriodToggle";
import { SourceBadge } from "./SourceBadge";

type StatementTab = "pl" | "mix" | "bs" | "cfs";

interface FinancialStatementTablesProps {
  companyId: string | null;
  periodView: PeriodView;
}

const TABS: { id: StatementTab; label: string }[] = [
  { id: "pl", label: "P&L" },
  { id: "mix", label: "Revenue Mix" },
  { id: "bs", label: "Balance Sheet" },
  { id: "cfs", label: "Cash Flow" },
];

function formatPeriod(period: FinancialPeriod): string {
  if (period.kind === "quarter") {
    return `${period.quarter} FY${String(period.fiscalYear).slice(-2)}`;
  }
  return `FY${String(period.fiscalYear).slice(-2)}`;
}

export function FinancialStatementTables({
  companyId,
  periodView,
}: FinancialStatementTablesProps) {
  const [tab, setTab] = useState<StatementTab>("pl");

  return (
    <section className="statements" aria-label="Financial statements">
      <div className="statements__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`statements__tab ${tab === t.id ? "statements__tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="statements__body">
        {tab === "pl" && (
          <ProfitLossTable companyId={companyId} periodView={periodView} />
        )}
        {tab === "mix" && (
          <RevenueMixTable companyId={companyId} periodView={periodView} />
        )}
        {tab === "bs" && (
          <BalanceSheetTable companyId={companyId} periodView={periodView} />
        )}
        {tab === "cfs" && (
          <CashFlowTable companyId={companyId} periodView={periodView} />
        )}
      </div>
    </section>
  );
}

interface BaseTableProps {
  companyId: string | null;
  periodView: PeriodView;
}

type PlRow = QuarterlyFinancialRow | AnnualFinancialRow;

// ---------------------------------------------------------------------------
// P&L
// ---------------------------------------------------------------------------

function ProfitLossTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const officialRows: PlRow[] =
    periodView === "quarters"
      ? lastNQuarters(quarterlyFinancialsSnapshot.rows, companyId, 5)
      : lastNYears(annualFinancialsSnapshot.rows, companyId, 5);

  if (officialRows.length > 0) {
    return renderOfficialPl(officialRows, periodView);
  }

  const screenerSheet: ScreenerSheetType =
    periodView === "quarters" ? "quarterly_results" : "profit_and_loss";
  const slices = pickScreenerSlices(companyId, screenerSheet, 5);

  if (slices) {
    return renderScreenerPl(slices.slices, slices.provenance);
  }

  return (
    <EmptyState
      title="No P&L data yet"
      message="Discovery is wired but filing extraction has not produced rows for this company yet."
      hint={
        periodView === "quarters"
          ? "Quarterly P&L will populate once NSE/BSE filings are parsed or the automated Screener fetch returns consolidated rows for this company. Non-consolidated rows are excluded by policy."
          : "Annual P&L will populate from Q4 / annual report extraction or from the consolidated Screener fetch. Non-consolidated rows are excluded by policy."
      }
    />
  );
}

// Prefer fetch slices, then fall back to import slices. Returns null if both empty.
function pickScreenerSlices(
  companyId: string,
  sheetType: ScreenerSheetType,
  n: number
): { slices: ScreenerPeriodSlice[]; provenance: "screener-fetch" | "screener-import" } | null {
  const fetched = screenerStatementRows(
    screenerNormalizedSnapshot.rows,
    companyId,
    sheetType,
    n,
    "fetch"
  );
  if (fetched.length > 0) return { slices: fetched, provenance: "screener-fetch" };
  const imported = screenerStatementRows(
    screenerNormalizedSnapshot.rows,
    companyId,
    sheetType,
    n,
    "import"
  );
  if (imported.length > 0) return { slices: imported, provenance: "screener-import" };
  return null;
}

function renderOfficialPl(rows: PlRow[], periodView: PeriodView) {
  return (
    <>
      <TableHeader provenance="official-filing" note="P&L from NSE/BSE filings" />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Metric</th>
              {rows.map((row) => (
                <th key={row.period.periodEndDate}>{formatPeriod(row.period)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <OfficialPlRow label="Revenue" rows={rows} pick={(r) => r.revenue} />
            <OfficialPlRow label="EBITDA" rows={rows} pick={(r) => r.ebitda} />
            <OfficialPlRow
              label="EBITDA margin"
              rows={rows}
              pick={(r) => margin(r.ebitda, r.revenue)}
              format={formatPercent}
            />
            <OfficialPlRow label="PAT" rows={rows} pick={(r) => r.patAttributableToOwners ?? r.pat} />
            <OfficialPlRow
              label="PAT margin"
              rows={rows}
              pick={(r) => margin(r.patAttributableToOwners ?? r.pat, r.revenue)}
              format={formatPercent}
            />
            <OfficialPlRow label="EPS (basic)" rows={rows} pick={(r) => r.epsBasic} format={(n) => n.toFixed(2)} />
            <GrowthRow label="YoY revenue growth" rows={rows} pick={(r) => r.revenue} kind="yoy" periodView={periodView} />
            {periodView === "quarters" && (
              <GrowthRow label="QoQ revenue growth" rows={rows} pick={(r) => r.revenue} kind="qoq" periodView={periodView} />
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Screener P&L row order. Mirrors the order Screener prints, with a
// derived "Net margin" row appended (clearly labelled) since the client
// brief calls for PAT-margin visibility.
const SCREENER_PL_METRICS: CanonicalMetric[] = [
  "revenue",
  "operating_profit",
  "opm",
  "other_income",
  "interest",
  "depreciation",
  "pbt",
  "pat",
  "eps",
];

function renderScreenerPl(
  slices: ScreenerPeriodSlice[],
  provenance: "screener-fetch" | "screener-import"
) {
  const sourceFile = slices[0]?.sourceFile ?? "";
  // Step 12 policy: helpers only return rows where reportingBasis ===
  // "consolidated", so the badge can safely state Consolidated here.
  const note =
    provenance === "screener-fetch"
      ? `P&L from Screener fetch · Consolidated · ${sourceFile}`
      : `P&L from Screener export · Consolidated · ${sourceFile}`;
  return (
    <>
      <TableHeader provenance={provenance} note={note} />
      <div className="table-wrap">
        <table className="data-table data-table--statement">
          <thead>
            <tr>
              <th className="metric-col">Metric</th>
              {slices.map((slice) => (
                <th key={slice.periodSortKey} className="num">
                  {slice.period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCREENER_PL_METRICS.map((canonical) => (
              <tr key={canonical}>
                <td className="metric-col">
                  {metricLabel(canonical)}
                  {canonical === "opm" ? <span className="metric-unit"> (%)</span> : null}
                </td>
                {slices.map((slice) => (
                  <td key={slice.periodSortKey} className="num">
                    {tableValueOrDash(
                      slice.values[canonical] ?? null,
                      canonical === "opm"
                        ? formatPercentRaw
                        : canonical === "eps"
                          ? (n) => n.toFixed(2)
                          : formatNumberCompact
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {/* Derived: Net margin = Net Profit / Sales, per-period when both exist. */}
            <tr className="row--derived">
              <td className="metric-col">
                Net margin <span className="metric-derived">(derived)</span>
              </td>
              {slices.map((slice) => {
                const sales = slice.values["revenue"];
                const pat = slice.values["pat"];
                const m =
                  sales !== null &&
                  sales !== undefined &&
                  pat !== null &&
                  pat !== undefined &&
                  Number.isFinite(sales) &&
                  Number.isFinite(pat) &&
                  sales > 0
                    ? (pat / sales) * 100
                    : null;
                return (
                  <td key={slice.periodSortKey} className="num">
                    {tableValueOrDash(m, formatPercentRaw)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Revenue mix — official only (Screener doesn't ship segment mix)
// ---------------------------------------------------------------------------

function RevenueMixTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const latestPnL =
    periodView === "quarters"
      ? lastNQuarters(quarterlyFinancialsSnapshot.rows, companyId, 1)[0]
      : lastNYears(annualFinancialsSnapshot.rows, companyId, 1)[0];

  const mix = latestPnL
    ? revenueMix(segmentRevenueSnapshot.rows, companyId, latestPnL.period)
    : null;

  if (!mix || mix.length === 0) {
    return (
      <EmptyState
        title="Segment revenue mix · pending source"
        message="Per-segment revenue is not part of the Screener consolidated dataset — it lives in investor presentations and the segment-disclosure block of annual reports. That extraction pipeline is queued for the official-filings module and is not yet wired."
        hint="The Screener fetch is healthy; this section will turn on once investor-presentation / annual-report parsing produces segment rows. Until then, segment mix renders as em-dash by policy — never an inferred or fabricated split."
      />
    );
  }

  return (
    <>
      <TableHeader
        provenance="official-filing"
        note="Segment disclosure block of filings"
        unit="₹ crore; mix shown as %"
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Revenue</th>
              <th>Mix %</th>
            </tr>
          </thead>
          <tbody>
            {mix.map((entry) => (
              <tr key={entry.segmentNameNormalized}>
                <td>{entry.segmentNameNormalized}</td>
                <td className="num">{tableValueOrDash(entry.revenue, formatNumberCompact)}</td>
                <td className="num">{tableValueOrDash(entry.share, formatPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------

const SCREENER_BS_METRICS: CanonicalMetric[] = [
  "share_capital",
  "reserves",
  "borrowings",
  "other_liabilities",
  "total_liabilities",
  "fixed_assets",
  "cwip",
  "investments",
  "other_assets",
  "total_assets",
];

function BalanceSheetTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const officialRows = filterAndSortByPeriod(
    balanceSheetSnapshot.rows.filter((r) => r.companyId === companyId),
    periodView,
    5
  );

  if (officialRows.length > 0) {
    return (
      <>
        <TableHeader
          provenance="official-filing"
          note="Balance sheet from filings / annual reports"
          unit="₹ crore"
        />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                {officialRows.map((row) => (
                  <th key={row.period.periodEndDate}>{formatPeriod(row.period)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <BsRow label="Total assets" rows={officialRows} pick={(r) => r.totalAssets} />
              <BsRow
                label="Total equity"
                rows={officialRows}
                pick={(r) => r.totalEquityAttributableToOwners ?? r.totalEquity}
              />
              <BsRow label="Borrowings" rows={officialRows} pick={(r) => r.borrowingsTotal} />
              <BsRow label="Cash & equivalents" rows={officialRows} pick={(r) => r.cashAndEquivalents} />
              <BsRow label="Net debt" rows={officialRows} pick={(r) => r.netDebt} />
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // Balance sheet is annual in Screener; if the user is on the quarterly
  // toggle and there are no quarterly official rows, still surface the
  // annual Screener rows for visibility (clearly badged).
  const pick = pickScreenerSlices(companyId, "balance_sheet", 5);
  if (pick) {
    return renderScreenerStatement(
      pick.slices,
      SCREENER_BS_METRICS,
      "Balance sheet",
      pick.provenance
    );
  }

  return (
    <EmptyState
      title="No balance sheet rows yet"
      message="Balance sheet rows will populate once filings are parsed or a Screener export is provided."
    />
  );
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

const SCREENER_CFS_METRICS: CanonicalMetric[] = [
  "cfo",
  "cfi",
  "cff",
  "net_cash_flow",
];

function CashFlowTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const officialRows = filterAndSortByPeriod(
    cashFlowSnapshot.rows.filter((r) => r.companyId === companyId),
    periodView,
    5
  );

  const note =
    periodView === "quarters"
      ? "Most Indian filers do not publish a quarterly CFS; dashes here are expected for periods that weren't filed."
      : "Annual CFS sourced from annual reports or imported Screener exports.";

  if (officialRows.length > 0) {
    return (
      <>
        <TableHeader provenance="official-filing" note={note} unit="₹ crore" />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                {officialRows.map((row) => (
                  <th key={row.period.periodEndDate}>{formatPeriod(row.period)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CfRow label="CFO" rows={officialRows} pick={(r) => r.cfo} />
              <CfRow label="Working capital changes" rows={officialRows} pick={(r) => r.workingCapitalChanges} />
              <CfRow label="CFI" rows={officialRows} pick={(r) => r.cfi} />
              <CfRow label="CFF" rows={officialRows} pick={(r) => r.cff} />
            </tbody>
          </table>
        </div>
      </>
    );
  }

  const pick = pickScreenerSlices(companyId, "cash_flow", 5);
  if (pick) {
    return renderScreenerStatement(
      pick.slices,
      SCREENER_CFS_METRICS,
      "Cash flow",
      pick.provenance
    );
  }

  return (
    <EmptyState
      title="No cash flow rows yet"
      message="Condensed CFS rows will populate once filings/annual reports are parsed or a Screener export is provided."
      hint={note}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function renderScreenerStatement(
  slices: ScreenerPeriodSlice[],
  metrics: CanonicalMetric[],
  label: string,
  provenance: "screener-fetch" | "screener-import"
) {
  const sourceFile = slices[0]?.sourceFile ?? "";
  // Step 12 policy: helpers only return rows where reportingBasis ===
  // "consolidated", so the badge can safely state Consolidated here.
  const note =
    provenance === "screener-fetch"
      ? `${label} from Screener fetch · Consolidated · ${sourceFile}`
      : `${label} from Screener export · Consolidated · ${sourceFile}`;
  // renderScreenerStatement is only used by BS and CFS today — neither
  // sheet has EPS/margin rows, so the precise unit is just "₹ crore".
  return (
    <>
      <TableHeader provenance={provenance} note={note} unit="₹ crore" />
      <div className="table-wrap">
        <table className="data-table data-table--statement">
          <thead>
            <tr>
              <th className="metric-col">Item</th>
              {slices.map((slice) => (
                <th key={slice.periodSortKey} className="num">
                  {slice.period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((canonical) => (
              <tr key={canonical}>
                <td className="metric-col">{metricLabel(canonical)}</td>
                {slices.map((slice) => (
                  <td key={slice.periodSortKey} className="num">
                    {tableValueOrDash(
                      slice.values[canonical] ?? null,
                      formatNumberCompact
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SelectCompany() {
  return (
    <EmptyState
      title="Select a company"
      message="Pick a company from the selector to view its statements."
    />
  );
}

interface TableHeaderProps {
  provenance: "official-filing" | "screener-fetch" | "screener-import";
  note: string;
  unit?: string;
}

// Default unit hint — covers P&L / BS / CFS. EPS and margins are the
// per-row exceptions and the rule line says so directly so a reader
// doesn't have to infer it from formatting.
const DEFAULT_UNIT_HINT = "₹ crore, except EPS and margins";

function TableHeader({ provenance, note, unit }: TableHeaderProps) {
  const unitHint = unit ?? DEFAULT_UNIT_HINT;
  return (
    <div className="table-header">
      <SourceBadge provenance={provenance} />
      <span className="table-header__note">{note}</span>
      <span className="table-header__unit">{unitHint}</span>
    </div>
  );
}

interface OfficialPlRowProps<T> {
  label: string;
  rows: ReadonlyArray<T>;
  pick: (row: T) => number | null;
  format?: (n: number) => string;
}

function OfficialPlRow<T>({
  label,
  rows,
  pick,
  format = formatNumberCompact,
}: OfficialPlRowProps<T>) {
  return (
    <tr>
      <td>{label}</td>
      {rows.map((row, i) => (
        <td key={i} className="num">
          {tableValueOrDash(pick(row), format)}
        </td>
      ))}
    </tr>
  );
}

interface GrowthRowProps {
  label: string;
  rows: ReadonlyArray<PlRow>;
  pick: (row: PlRow) => number | null;
  kind: "yoy" | "qoq";
  periodView: PeriodView;
}

function GrowthRow({ label, rows, pick, kind, periodView }: GrowthRowProps) {
  return (
    <tr>
      <td>{label}</td>
      {rows.map((row, i) => {
        const current = pick(row);
        let priorIndex: number;
        if (kind === "qoq") {
          priorIndex = i - 1;
        } else {
          priorIndex = periodView === "quarters" ? i - 4 : i - 1;
        }
        const prior = priorIndex >= 0 ? pick(rows[priorIndex]) : null;
        const value =
          kind === "qoq" ? growthQoQ(current, prior) : growthYoY(current, prior);
        return (
          <td key={i} className="num">
            {tableValueOrDash(value, formatPercent)}
          </td>
        );
      })}
    </tr>
  );
}

interface BsRowProps {
  label: string;
  rows: ReadonlyArray<BalanceSheetRow>;
  pick: (row: BalanceSheetRow) => number | null;
}

function BsRow({ label, rows, pick }: BsRowProps) {
  return (
    <tr>
      <td>{label}</td>
      {rows.map((row) => (
        <td key={row.period.periodEndDate} className="num">
          {tableValueOrDash(pick(row), formatNumberCompact)}
        </td>
      ))}
    </tr>
  );
}

interface CfRowProps {
  label: string;
  rows: ReadonlyArray<CashFlowRow>;
  pick: (row: CashFlowRow) => number | null;
}

function CfRow({ label, rows, pick }: CfRowProps) {
  return (
    <tr>
      <td>{label}</td>
      {rows.map((row) => (
        <td key={row.period.periodEndDate} className="num">
          {tableValueOrDash(pick(row), formatNumberCompact)}
        </td>
      ))}
    </tr>
  );
}

function filterAndSortByPeriod<T extends { period: FinancialPeriod }>(
  rows: T[],
  periodView: PeriodView,
  n: number
): T[] {
  const kind = periodView === "quarters" ? "quarter" : "annual";
  const sorted = rows
    .filter((r) => r.period.kind === kind)
    .sort((a, b) =>
      a.period.periodEndDate.localeCompare(b.period.periodEndDate)
    );
  return sorted.slice(-n);
}
