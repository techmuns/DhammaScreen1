import { useState } from "react";

import {
  formatNumberCompact,
  formatPercent,
  growthQoQ,
  growthYoY,
  lastNQuarters,
  lastNYears,
  margin,
  revenueMix,
  tableValueOrDash,
} from "../data/helpers/dhammaFinancials";
import {
  annualFinancialsSnapshot,
  balanceSheetSnapshot,
  cashFlowSnapshot,
  quarterlyFinancialsSnapshot,
  segmentRevenueSnapshot,
} from "../data/helpers/snapshotLoader";
import type {
  AnnualFinancialRow,
  BalanceSheetRow,
  CashFlowRow,
  FinancialPeriod,
  QuarterlyFinancialRow,
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

// ---------------------------------------------------------------------------
// P&L
// ---------------------------------------------------------------------------

interface BaseTableProps {
  companyId: string | null;
  periodView: PeriodView;
}

type PlRow = QuarterlyFinancialRow | AnnualFinancialRow;

function ProfitLossTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const rows: PlRow[] =
    periodView === "quarters"
      ? lastNQuarters(quarterlyFinancialsSnapshot.rows, companyId, 5)
      : lastNYears(annualFinancialsSnapshot.rows, companyId, 5);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No P&L data yet"
        message="Discovery is wired but filing extraction has not produced rows for this company yet."
        hint={
          periodView === "quarters"
            ? "Quarterly P&L will populate once NSE/BSE filings are parsed."
            : "Annual P&L will populate from Q4 / annual report extraction."
        }
      />
    );
  }

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
            <MetricRow label="Revenue" rows={rows} pick={(r) => r.revenue} />
            <MetricRow label="EBITDA" rows={rows} pick={(r) => r.ebitda} />
            <MetricRow
              label="EBITDA margin"
              rows={rows}
              pick={(r) => margin(r.ebitda, r.revenue)}
              format={formatPercent}
            />
            <MetricRow label="PAT" rows={rows} pick={(r) => r.patAttributableToOwners ?? r.pat} />
            <MetricRow
              label="PAT margin"
              rows={rows}
              pick={(r) => margin(r.patAttributableToOwners ?? r.pat, r.revenue)}
              format={formatPercent}
            />
            <MetricRow label="EPS (basic)" rows={rows} pick={(r) => r.epsBasic} format={(n) => n.toFixed(2)} />
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

// ---------------------------------------------------------------------------
// Revenue mix
// ---------------------------------------------------------------------------

function RevenueMixTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const latestPnL =
    periodView === "quarters"
      ? lastNQuarters(quarterlyFinancialsSnapshot.rows, companyId, 1)[0]
      : lastNYears(annualFinancialsSnapshot.rows, companyId, 1)[0];

  const mix = latestPnL
    ? revenueMix(
        segmentRevenueSnapshot.rows,
        companyId,
        latestPnL.period
      )
    : null;

  if (!mix || mix.length === 0) {
    return (
      <EmptyState
        title="No segment mix yet"
        message="Segment revenue requires the segment-disclosure block from filings to be extracted and normalized."
        hint="A per-company segment alias map is pending; see metric audit."
      />
    );
  }

  return (
    <>
      <TableHeader provenance="official-filing" note="Segment disclosure block of filings" />
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

function BalanceSheetTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const rows = filterAndSortByPeriod(
    balanceSheetSnapshot.rows.filter((r) => r.companyId === companyId),
    periodView,
    5
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No balance sheet rows yet"
        message="Balance sheet rows will populate once filings are parsed."
      />
    );
  }

  return (
    <>
      <TableHeader provenance="official-filing" note="Balance sheet from filings / annual reports" />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              {rows.map((row) => (
                <th key={row.period.periodEndDate}>{formatPeriod(row.period)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <BsRow label="Total assets" rows={rows} pick={(r) => r.totalAssets} />
            <BsRow
              label="Total equity"
              rows={rows}
              pick={(r) => r.totalEquityAttributableToOwners ?? r.totalEquity}
            />
            <BsRow label="Borrowings" rows={rows} pick={(r) => r.borrowingsTotal} />
            <BsRow label="Cash & equivalents" rows={rows} pick={(r) => r.cashAndEquivalents} />
            <BsRow label="Net debt" rows={rows} pick={(r) => r.netDebt} />
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

function CashFlowTable({ companyId, periodView }: BaseTableProps) {
  if (!companyId) return <SelectCompany />;
  const rows = filterAndSortByPeriod(
    cashFlowSnapshot.rows.filter((r) => r.companyId === companyId),
    periodView,
    5
  );

  const note =
    periodView === "quarters"
      ? "Most Indian filers do not publish a quarterly CFS; dashes here are expected for the periods that weren't filed."
      : "Annual CFS sourced from annual reports.";

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No cash flow rows yet"
        message="Condensed CFS rows will populate once filings/annual reports are parsed."
        hint={note}
      />
    );
  }

  return (
    <>
      <TableHeader provenance="official-filing" note={note} />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              {rows.map((row) => (
                <th key={row.period.periodEndDate}>{formatPeriod(row.period)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CfRow label="CFO" rows={rows} pick={(r) => r.cfo} />
            <CfRow label="Working capital changes" rows={rows} pick={(r) => r.workingCapitalChanges} />
            <CfRow label="CFI" rows={rows} pick={(r) => r.cfi} />
            <CfRow label="CFF" rows={rows} pick={(r) => r.cff} />
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function SelectCompany() {
  return (
    <EmptyState
      title="Select a company"
      message="Pick a company from the selector to view its statements."
    />
  );
}

interface TableHeaderProps {
  provenance: "official-filing" | "screener-import";
  note: string;
}

function TableHeader({ provenance, note }: TableHeaderProps) {
  return (
    <div className="table-header">
      <SourceBadge provenance={provenance} />
      <span className="table-header__note">{note}</span>
    </div>
  );
}

interface MetricRowProps<T> {
  label: string;
  rows: ReadonlyArray<T>;
  pick: (row: T) => number | null;
  format?: (n: number) => string;
}

function MetricRow<T>({
  label,
  rows,
  pick,
  format = formatNumberCompact,
}: MetricRowProps<T>) {
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
  // YoY needs prior-year-same-period. For quarterly: index - 4. For annual:
  // index - 1. QoQ only meaningful for quarterly: index - 1.
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
