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
  type ScreenerLatestMetric,
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
  // Re-bind to a non-null local so the closures below see the narrowed type.
  const id: string = companyId;

  const screenerPeriodType = periodView === "quarters" ? "quarter" : "year";
  const screenerRows = screenerNormalizedSnapshot.rows;

  // Helpers that pre-bind sourceMethod so the per-card resolution stays compact.
  const latestFetched = (canonical: string, pType: "quarter" | "year") =>
    screenerLatestMetric(screenerRows, id, canonical, pType, "fetch");
  const latestImported = (canonical: string, pType: "quarter" | "year") =>
    screenerLatestMetric(screenerRows, id, canonical, pType, "import");

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

  // Revenue
  const revenue = resolveKpi({
    official: { value: pAndL?.revenue ?? null, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("revenue", screenerPeriodType),
    screenerImport: latestImported("revenue", screenerPeriodType),
  });

  // EBITDA margin
  const officialEbitdaMargin = margin(pAndL?.ebitda ?? null, pAndL?.revenue ?? null);
  const ebitdaMargin = resolveKpi({
    official: { value: officialEbitdaMargin, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("opm", screenerPeriodType),
    screenerImport: latestImported("opm", screenerPeriodType),
  });
  // OPM (Screener) is in percentage points; official derivation is a fraction.
  const ebitdaMarginFormat =
    ebitdaMargin.provenance === "screener-fetch" ||
    ebitdaMargin.provenance === "screener-import"
      ? formatPercentRaw
      : formatPercent;

  // PAT margin: derive only when Sales and Net Profit come from the same
  // Screener period, then compute. Otherwise fall back to dash.
  function deriveScreenerPatMargin(
    method: "fetch" | "import"
  ): ScreenerLatestMetric | null {
    const sales = screenerLatestMetric(screenerRows, id, "revenue", screenerPeriodType, method);
    const pat = screenerLatestMetric(screenerRows, id, "pat", screenerPeriodType, method);
    if (
      !sales ||
      !pat ||
      sales.value === null ||
      pat.value === null ||
      sales.value <= 0 ||
      sales.periodLabel !== pat.periodLabel
    ) {
      return null;
    }
    return {
      value: pat.value / sales.value,
      periodLabel: pat.periodLabel,
      sourceFile: pat.sourceFile,
      sourceSheet: pat.sourceSheet,
    };
  }
  const officialPatMargin = margin(
    pAndL?.patAttributableToOwners ?? pAndL?.pat ?? null,
    pAndL?.revenue ?? null
  );
  const patMargin = resolveKpi({
    official: { value: officialPatMargin, periodLabel: officialPeriodLabel },
    screenerFetch: deriveScreenerPatMargin("fetch"),
    screenerImport: deriveScreenerPatMargin("import"),
  });

  // EPS
  const eps = resolveKpi({
    official: { value: pAndL?.epsBasic ?? null, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("eps", screenerPeriodType),
    screenerImport: latestImported("eps", screenerPeriodType),
  });

  // CFO — Screener publishes annually only.
  const cfo = resolveKpi({
    official: { value: cashFlow?.cfo ?? null, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("cfo", "year"),
    screenerImport: latestImported("cfo", "year"),
  });

  // Net debt: official net-debt → official borrowings → Screener borrowings
  const officialNetDebt = balance?.netDebt ?? balance?.borrowingsTotal ?? null;
  const netDebt = resolveKpi({
    official: { value: officialNetDebt, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("borrowings", "year"),
    screenerImport: latestImported("borrowings", "year"),
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
