import {
  formatNumberCompact,
  formatPercent,
  formatPercentRaw,
  latestQuarter,
  latestYear,
  margin,
  resolveKpi,
  screenerLatestMetric,
  tableValueOrDash,
  type KpiResolution,
} from "../data/helpers/dhammaFinancials";
import {
  annualFinancialsSnapshot,
  balanceSheetSnapshot,
  cashFlowSnapshot,
  quarterlyFinancialsSnapshot,
  screenerNormalizedSnapshot,
} from "../data/helpers/snapshotLoader";
import type { PeriodView } from "./PeriodToggle";
import { SourceBadge } from "./SourceBadge";

interface KpiSummaryCardsProps {
  companyId: string | null;
  periodView: PeriodView;
}

interface CardModel {
  label: string;
  resolution: KpiResolution;
  format: (n: number) => string;
  hint: string;
}

function buildCards(
  companyId: string | null,
  periodView: PeriodView
): CardModel[] {
  if (!companyId) return defaultEmptyCards();

  const screenerPeriodType = periodView === "quarters" ? "quarter" : "year";
  const screenerRows = screenerNormalizedSnapshot.rows;

  const latestQ = latestQuarter(quarterlyFinancialsSnapshot.rows, companyId);
  const latestY = latestYear(annualFinancialsSnapshot.rows, companyId);
  const pAndL = periodView === "years" ? latestY : latestQ;
  const officialPeriodLabel = pAndL
    ? `${pAndL.period.kind === "quarter" ? pAndL.period.quarter : "FY"}` +
      ` ${String(pAndL.period.fiscalYear).slice(-2)}`
    : null;

  const balance = balanceSheetSnapshot.rows
    .filter((row) => row.companyId === companyId)
    .sort((a, b) =>
      a.period.periodEndDate.localeCompare(b.period.periodEndDate)
    )
    .at(-1);

  const cashFlow = cashFlowSnapshot.rows
    .filter((row) => row.companyId === companyId)
    .sort((a, b) =>
      a.period.periodEndDate.localeCompare(b.period.periodEndDate)
    )
    .at(-1);

  // Revenue: official P&L → Screener (revenue canonical, period-type-matched)
  const revenue = resolveKpi({
    official: { value: pAndL?.revenue ?? null, periodLabel: officialPeriodLabel },
    screener: screenerLatestMetric(screenerRows, companyId, "revenue", screenerPeriodType),
  });

  // EBITDA margin: official derivation first, then Screener OPM (already %)
  const officialEbitdaMargin = margin(pAndL?.ebitda ?? null, pAndL?.revenue ?? null);
  const screenerOpm = screenerLatestMetric(
    screenerRows,
    companyId,
    "opm",
    screenerPeriodType
  );
  const ebitdaMargin = resolveKpi({
    official: { value: officialEbitdaMargin, periodLabel: officialPeriodLabel },
    screener: screenerOpm,
  });
  // OPM from Screener is already in percentage points; official margin is a fraction.
  const ebitdaMarginFormat =
    ebitdaMargin.provenance === "screener-import"
      ? formatPercentRaw
      : formatPercent;

  // PAT margin: official derivation only — Screener "Net Profit" alone is
  // not safely combinable with imported revenue without confirming both
  // came from the same period.
  const officialPatMargin = margin(
    pAndL?.patAttributableToOwners ?? pAndL?.pat ?? null,
    pAndL?.revenue ?? null
  );
  const screenerSales = screenerLatestMetric(
    screenerRows,
    companyId,
    "revenue",
    screenerPeriodType
  );
  const screenerPat = screenerLatestMetric(
    screenerRows,
    companyId,
    "pat",
    screenerPeriodType
  );
  const screenerPatMargin: KpiResolution["value"] =
    screenerSales &&
    screenerPat &&
    screenerSales.value !== null &&
    screenerPat.value !== null &&
    screenerSales.value > 0 &&
    screenerSales.periodLabel === screenerPat.periodLabel
      ? screenerPat.value / screenerSales.value
      : null;
  const patMargin = resolveKpi({
    official: { value: officialPatMargin, periodLabel: officialPeriodLabel },
    screener:
      screenerPatMargin === null
        ? null
        : {
            value: screenerPatMargin,
            periodLabel: screenerPat?.periodLabel ?? null,
            sourceFile: screenerPat?.sourceFile ?? null,
            sourceSheet: screenerPat?.sourceSheet ?? null,
          },
  });

  // EPS
  const eps = resolveKpi({
    official: { value: pAndL?.epsBasic ?? null, periodLabel: officialPeriodLabel },
    screener: screenerLatestMetric(screenerRows, companyId, "eps", screenerPeriodType),
  });

  // CFO — Screener publishes only annual CFO, so the Screener fallback
  // is "year" regardless of period view.
  const cfo = resolveKpi({
    official: { value: cashFlow?.cfo ?? null, periodLabel: officialPeriodLabel },
    screener: screenerLatestMetric(screenerRows, companyId, "cfo", "year"),
  });

  // Net debt: official net-debt → official borrowings → Screener borrowings
  const officialNetDebt = balance?.netDebt ?? balance?.borrowingsTotal ?? null;
  const netDebt = resolveKpi({
    official: { value: officialNetDebt, periodLabel: officialPeriodLabel },
    screener: screenerLatestMetric(screenerRows, companyId, "borrowings", "year"),
  });

  return [
    { label: "Revenue", resolution: revenue, format: formatNumberCompact, hint: hintFor(revenue, "Reported revenue") },
    { label: "EBITDA Margin", resolution: ebitdaMargin, format: ebitdaMarginFormat, hint: hintFor(ebitdaMargin, "EBITDA / Revenue") },
    { label: "PAT Margin", resolution: patMargin, format: formatPercent, hint: hintFor(patMargin, "PAT / Revenue") },
    { label: "EPS", resolution: eps, format: (n) => n.toFixed(2), hint: hintFor(eps, "Basic EPS as filed") },
    { label: "CFO", resolution: cfo, format: formatNumberCompact, hint: hintFor(cfo, "Net cash from operations") },
    { label: "Net Debt / Borrowings", resolution: netDebt, format: formatNumberCompact, hint: hintFor(netDebt, balance?.netDebt != null ? "Net debt" : "Total borrowings") },
  ];
}

function hintFor(resolution: KpiResolution, baseHint: string): string {
  if (resolution.value === null) return "Awaiting extraction or import";
  const period = resolution.periodLabel;
  return period ? `${baseHint} · ${period}` : baseHint;
}

function defaultEmptyCards(): CardModel[] {
  const labels = [
    "Revenue",
    "EBITDA Margin",
    "PAT Margin",
    "EPS",
    "CFO",
    "Net Debt / Borrowings",
  ];
  return labels.map((label) => ({
    label,
    resolution: { value: null, provenance: "pending", periodLabel: null },
    format: formatNumberCompact,
    hint: "Select a company to load metrics",
  }));
}

export function KpiSummaryCards({
  companyId,
  periodView,
}: KpiSummaryCardsProps) {
  const cards = buildCards(companyId, periodView);
  return (
    <section className="kpi-cards" aria-label="Key performance indicators">
      {cards.map((card) => (
        <div key={card.label} className="kpi-card">
          <div className="kpi-card__header">
            <span className="kpi-card__label">{card.label}</span>
            <SourceBadge provenance={card.resolution.provenance} />
          </div>
          <div className="kpi-card__value">
            {tableValueOrDash(card.resolution.value, card.format)}
          </div>
          <div className="kpi-card__hint">{card.hint}</div>
        </div>
      ))}
    </section>
  );
}
