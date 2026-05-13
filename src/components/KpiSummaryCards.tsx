import {
  formatNumberCompact,
  formatPercent,
  latestQuarter,
  latestYear,
  margin,
  tableValueOrDash,
  type DataProvenance,
} from "../data/helpers/dhammaFinancials";
import {
  annualFinancialsSnapshot,
  balanceSheetSnapshot,
  cashFlowSnapshot,
  quarterlyFinancialsSnapshot,
} from "../data/helpers/snapshotLoader";
import type { PeriodView } from "./PeriodToggle";
import { SourceBadge } from "./SourceBadge";

interface KpiSummaryCardsProps {
  companyId: string | null;
  periodView: PeriodView;
}

interface CardModel {
  label: string;
  value: string;
  provenance: DataProvenance;
  hint: string;
}

function buildCards(
  companyId: string | null,
  periodView: PeriodView
): CardModel[] {
  if (!companyId) return defaultEmptyCards();

  const latestQ = latestQuarter(quarterlyFinancialsSnapshot.rows, companyId);
  const latestY = latestYear(annualFinancialsSnapshot.rows, companyId);

  const usingYear = periodView === "years";
  const pAndL = usingYear ? latestY : latestQ;

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

  return [
    {
      label: "Revenue",
      value: tableValueOrDash(pAndL?.revenue ?? null, formatNumberCompact),
      provenance: pAndL ? "official-filing" : "pending",
      hint: pAndL
        ? `${usingYear ? "Latest FY" : "Latest quarter"} reported`
        : "Awaiting extraction",
    },
    {
      label: "EBITDA Margin",
      value: tableValueOrDash(
        margin(pAndL?.ebitda ?? null, pAndL?.revenue ?? null),
        formatPercent
      ),
      provenance: pAndL ? "official-filing" : "pending",
      hint: "Derived: EBITDA / Revenue",
    },
    {
      label: "PAT Margin",
      value: tableValueOrDash(
        margin(pAndL?.patAttributableToOwners ?? pAndL?.pat ?? null, pAndL?.revenue ?? null),
        formatPercent
      ),
      provenance: pAndL ? "official-filing" : "pending",
      hint: "Derived: PAT / Revenue",
    },
    {
      label: "EPS",
      value: tableValueOrDash(pAndL?.epsBasic ?? null, (n) => n.toFixed(2)),
      provenance: pAndL ? "official-filing" : "pending",
      hint: "Basic EPS as filed",
    },
    {
      label: "CFO",
      value: tableValueOrDash(cashFlow?.cfo ?? null, formatNumberCompact),
      provenance: cashFlow ? "official-filing" : "pending",
      hint: "Net cash from operations",
    },
    {
      label: "Net Debt / Borrowings",
      value: tableValueOrDash(
        balance?.netDebt ?? balance?.borrowingsTotal ?? null,
        formatNumberCompact
      ),
      provenance: balance ? "official-filing" : "pending",
      hint: balance?.netDebt != null ? "Net debt" : "Total borrowings (net debt audit)",
    },
  ];
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
    value: "—",
    provenance: "pending",
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
            <SourceBadge provenance={card.provenance} />
          </div>
          <div className="kpi-card__value">{card.value}</div>
          <div className="kpi-card__hint">{card.hint}</div>
        </div>
      ))}
    </section>
  );
}
