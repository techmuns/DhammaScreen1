// KPI peer-benchmark cards.
//
// Replaces the earlier standalone PeerComparisonTable. Each card lines the
// selected company up against the rest of its peer group on one financial
// KPI and surfaces: self value · peer average · rank · position vs peers
// · mini per-peer strip. All values come from the cached Screener fetch
// rows; the dashboard never live-fetches.

import {
  buildPeerBenchmark,
  formatNumberCompact,
  formatPercentRaw,
  positionLabel,
  tableValueOrDash,
  type PeerBenchmark,
  type PeerBenchmarkPosition,
} from "../data/helpers/dhammaFinancials";
import {
  companyMasterSnapshot,
  screenerNormalizedSnapshot,
} from "../data/helpers/snapshotLoader";
import type { PeriodView } from "./PeriodToggle";
import { SourceBadge } from "./SourceBadge";

interface KpiSummaryCardsProps {
  companyId: string | null;
  periodView: PeriodView;
}

type CardKind = "value" | "growth-yoy";

interface CardSpec {
  key: string;
  label: string;
  canonical: string;
  kind: CardKind;
  // "follow-toggle" matches the dashboard's period toggle. "annual" forces
  // annual data regardless of the toggle (used for ROCE / CFO / Borrowings
  // which Screener only publishes annually).
  periodScope: "follow-toggle" | "annual";
  format: "number" | "percent-points" | "percent-raw";
  hint: string;
}

const CARD_SPECS: CardSpec[] = [
  {
    key: "revenue_growth",
    label: "Revenue Growth (YoY)",
    canonical: "revenue",
    kind: "growth-yoy",
    periodScope: "follow-toggle",
    format: "percent-points",
    hint: "Year-on-year change in revenue",
  },
  {
    key: "opm",
    label: "Operating Margin",
    canonical: "opm",
    kind: "value",
    periodScope: "follow-toggle",
    format: "percent-raw",
    hint: "Latest OPM %",
  },
  {
    key: "net_profit_growth",
    label: "Net Profit Growth (YoY)",
    canonical: "pat",
    kind: "growth-yoy",
    periodScope: "follow-toggle",
    format: "percent-points",
    hint: "Year-on-year change in net profit",
  },
  {
    key: "eps_growth",
    label: "EPS Growth (YoY)",
    canonical: "eps",
    kind: "growth-yoy",
    periodScope: "follow-toggle",
    format: "percent-points",
    hint: "Year-on-year change in basic EPS",
  },
  {
    key: "roce",
    label: "ROCE",
    canonical: "roce",
    kind: "value",
    periodScope: "annual",
    format: "percent-raw",
    hint: "Annual return on capital employed",
  },
  {
    key: "cfo",
    label: "CFO",
    canonical: "cfo",
    kind: "value",
    periodScope: "annual",
    format: "number",
    hint: "Annual cash from operations",
  },
  {
    key: "borrowings",
    label: "Borrowings",
    canonical: "borrowings",
    kind: "value",
    periodScope: "annual",
    format: "number",
    hint: "Latest annual borrowings",
  },
];

function formatterFor(format: CardSpec["format"]): (n: number) => string {
  switch (format) {
    case "percent-points":
      return (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
    case "percent-raw":
      return (n) => formatPercentRaw(n, 1);
    case "number":
      return formatNumberCompact;
  }
}

interface BenchmarkCardModel {
  spec: CardSpec;
  benchmark: PeerBenchmark;
}

function buildCards(
  companyId: string | null,
  periodView: PeriodView
): BenchmarkCardModel[] {
  if (!companyId) return [];
  const companies = companyMasterSnapshot.rows;
  const screenerRows = screenerNormalizedSnapshot.rows;

  return CARD_SPECS.map((spec) => {
    const periodType =
      spec.periodScope === "annual"
        ? "year"
        : periodView === "quarters"
          ? "quarter"
          : "year";
    const benchmark = buildPeerBenchmark({
      companies,
      screenerRows,
      companyId,
      canonical: spec.canonical,
      kind: spec.kind,
      periodType,
    });
    return { spec, benchmark };
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function KpiSummaryCards({
  companyId,
  periodView,
}: KpiSummaryCardsProps) {
  const cards = buildCards(companyId, periodView);

  if (cards.length === 0) {
    return (
      <section className="kpi-benchmarks" aria-label="KPI peer benchmarks">
        <div className="kpi-benchmarks__head">
          <h2 className="section-title">KPI peer benchmarks</h2>
          <span className="section-subtitle">
            Select a company to compare against the tracked IT peer group.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="kpi-benchmarks" aria-label="KPI peer benchmarks">
      <div className="kpi-benchmarks__head">
        <h2 className="section-title">KPI peer benchmarks</h2>
        <span className="section-subtitle">
          Selected company vs. tracked IT peer group. Source: cached Screener fetch.
        </span>
      </div>
      <div className="kpi-benchmarks__grid">
        {cards.map((card) => (
          <BenchmarkCard key={card.spec.key} card={card} />
        ))}
      </div>
    </section>
  );
}

function BenchmarkCard({ card }: { card: BenchmarkCardModel }) {
  const { spec, benchmark } = card;
  const format = formatterFor(spec.format);
  return (
    <article className="benchmark-card">
      <header className="benchmark-card__header">
        <span className="benchmark-card__label">{spec.label}</span>
        <SourceBadge provenance="screener-fetch" />
      </header>

      <div className="benchmark-card__primary">
        <div className="benchmark-card__value-block">
          <span className="benchmark-card__value">
            {tableValueOrDash(benchmark.selfValue, format)}
          </span>
          <span className="benchmark-card__period">
            {benchmark.selfPeriod ?? "—"}
          </span>
        </div>
        <div className="benchmark-card__rank">
          <span className="benchmark-card__rank-number">
            {benchmark.rank !== null ? `${benchmark.rank}` : "—"}
          </span>
          <span className="benchmark-card__rank-of">
            {benchmark.rankOf > 0 ? `/ ${benchmark.rankOf}` : ""}
          </span>
        </div>
      </div>

      <div className="benchmark-card__secondary">
        <span className="benchmark-card__peer-avg">
          Peer avg{" "}
          <strong>{tableValueOrDash(benchmark.peerAverage, format)}</strong>
        </span>
        <PositionChip position={benchmark.position} />
      </div>

      <ul className="benchmark-card__peers">
        {benchmark.peerEntries.map((peer) => (
          <li
            key={peer.companyId}
            className={`benchmark-card__peer ${
              peer.isSelf ? "benchmark-card__peer--self" : ""
            }`}
          >
            <span className="benchmark-card__peer-name">{peer.displayName}</span>
            <span className="benchmark-card__peer-value">
              {tableValueOrDash(peer.value, format)}
            </span>
          </li>
        ))}
      </ul>

      <p className="benchmark-card__hint">{spec.hint}</p>
    </article>
  );
}

const POSITION_CLASS: Record<PeerBenchmarkPosition, string> = {
  above: "position-chip position-chip--above",
  below: "position-chip position-chip--below",
  "in-line": "position-chip position-chip--in-line",
  pending: "position-chip position-chip--pending",
};

function PositionChip({ position }: { position: PeerBenchmarkPosition }) {
  return <span className={POSITION_CLASS[position]}>{positionLabel(position)}</span>;
}
