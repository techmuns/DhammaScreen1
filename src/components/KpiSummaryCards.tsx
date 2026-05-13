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
  const id: string = companyId;

  const screenerPeriodType = periodView === "quarters" ? "quarter" : "year";
  const screenerRows = screenerNormalizedSnapshot.rows;

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

  // Revenue / Sales
  const revenue = resolveKpi({
    official: { value: pAndL?.revenue ?? null, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("revenue", screenerPeriodType),
    screenerImport: latestImported("revenue", screenerPeriodType),
  });

  // Operating Margin (OPM %)
  const officialOpMargin = margin(pAndL?.ebitda ?? null, pAndL?.revenue ?? null);
  const operatingMargin = resolveKpi({
    official: { value: officialOpMargin, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("opm", screenerPeriodType),
    screenerImport: latestImported("opm", screenerPeriodType),
  });
  // Screener OPM is already in percentage points; official derivation is a fraction.
  const operatingMarginFormat =
    operatingMargin.provenance === "screener-fetch" ||
    operatingMargin.provenance === "screener-import"
      ? formatPercentRaw
      : formatPercent;

  // Net Profit (absolute, not margin) — straight from Screener / filings.
  const netProfit = resolveKpi({
    official: {
      value: pAndL?.patAttributableToOwners ?? pAndL?.pat ?? null,
      periodLabel: officialPeriodLabel,
    },
    screenerFetch: latestFetched("pat", screenerPeriodType),
    screenerImport: latestImported("pat", screenerPeriodType),
  });

  // EPS
  const eps = resolveKpi({
    official: { value: pAndL?.epsBasic ?? null, periodLabel: officialPeriodLabel },
    screenerFetch: latestFetched("eps", screenerPeriodType),
    screenerImport: latestImported("eps", screenerPeriodType),
  });

  // CFO — Screener only publishes annual CFO. Even on the quarterly toggle
  // the fallback is the latest annual figure; label spells that out.
  const cfoFetch = latestFetched("cfo", "year");
  const cfoImport = latestImported("cfo", "year");
  const cfo = resolveKpi({
    official: { value: cashFlow?.cfo ?? null, periodLabel: officialPeriodLabel },
    screenerFetch: cfoFetch,
    screenerImport: cfoImport,
  });

  // Borrowings — annual-only from Screener for the same reason.
  const borrowingsFetch = latestFetched("borrowings", "year");
  const borrowingsImport = latestImported("borrowings", "year");
  const borrowings = resolveKpi({
    official: {
      value: balance?.netDebt ?? balance?.borrowingsTotal ?? null,
      periodLabel: officialPeriodLabel,
    },
    screenerFetch: borrowingsFetch,
    screenerImport: borrowingsImport,
  });

  return [
    {
      label: "Revenue / Sales",
      resolution: revenue,
      format: formatNumberCompact,
      hint: hintFor(revenue, "Reported revenue", periodView),
    },
    {
      label: "Operating Margin",
      resolution: operatingMargin,
      format: operatingMarginFormat,
      hint: hintFor(
        operatingMargin,
        operatingMargin.provenance === "screener-fetch" ||
          operatingMargin.provenance === "screener-import"
          ? "Screener OPM %"
          : "Derived: EBITDA / Revenue",
        periodView
      ),
    },
    {
      label: "Net Profit",
      resolution: netProfit,
      format: formatNumberCompact,
      hint: hintFor(netProfit, "Net profit attributable to owners", periodView),
    },
    {
      label: "EPS",
      resolution: eps,
      format: (n) => n.toFixed(2),
      hint: hintFor(eps, "Basic EPS", periodView),
    },
    {
      label: "CFO",
      resolution: cfo,
      format: formatNumberCompact,
      hint:
        cfo.provenance === "screener-fetch" ||
        cfo.provenance === "screener-import"
          ? `Annual cash from operations · ${cfo.periodLabel ?? "—"}`
          : hintFor(cfo, "Net cash from operations", periodView),
    },
    {
      label: "Borrowings",
      resolution: borrowings,
      format: formatNumberCompact,
      hint:
        borrowings.provenance === "screener-fetch" ||
        borrowings.provenance === "screener-import"
          ? `Annual borrowings · ${borrowings.periodLabel ?? "—"}`
          : hintFor(
              borrowings,
              balance?.netDebt != null ? "Net debt" : "Total borrowings",
              periodView
            ),
    },
  ];
}

function hintFor(
  resolution: KpiResolution,
  baseHint: string,
  _periodView: PeriodView
): string {
  if (resolution.value === null) return "Awaiting extraction or import";
  const period = resolution.periodLabel;
  return period ? `${baseHint} · ${period}` : baseHint;
}

function defaultEmptyCards(): CardModel[] {
  const labels = [
    "Revenue / Sales",
    "Operating Margin",
    "Net Profit",
    "EPS",
    "CFO",
    "Borrowings",
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
