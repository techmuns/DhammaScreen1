// KPI peer-benchmark cards.
//
// Each card lines the selected company up against the rest of its peer
// group on one financial KPI and surfaces a *compact* slice of the data:
//   - self value · self period
//   - peer median · rank
//   - best peer / self / worst peer mini-list
//   - a direction-aware position chip ("Higher than peer median" etc.)
//   - peer count footer + per-metric hint
// The full peer list is intentionally hidden — it bloated the page.
//
// Reporting-basis policy (Step 12): every value is sourced from rows
// where `reportingBasis === "consolidated"`. The shared helpers enforce
// this; if no consolidated rows exist for a company, every metric falls
// back to em-dash and the section shows a warning.
//
// Metric direction (Step 14): some metrics are "higher is better"
// (margins, growth, ROCE, CFO conversion); some are "lower is better"
// (borrowings). The CardSpec carries the direction, the helpers compute
// the corresponding sentiment, and the position chip flips colour
// accordingly. Wording stays "Higher / Lower than peer median" either
// way — only the colour changes.

import {
  buildPeerBenchmark,
  consolidatedScreenerRowCount,
  formatNumberCompact,
  formatPercentRaw,
  positionLabel,
  tableValueOrDash,
  type MetricDirection,
  type PeerBenchmark,
  type PeerBenchmarkPeerEntry,
  type PeerBenchmarkPosition,
  type PeerBenchmarkSentiment,
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

type CardKind = "value" | "growth-yoy" | "ratio-cfo-conversion";

interface CardSpec {
  key: string;
  label: string;
  canonical: string;
  kind: CardKind;
  // "follow-toggle" matches the dashboard's period toggle. "annual" forces
  // annual data regardless of the toggle (used for ROCE / CFO / Borrowings
  // which Screener only publishes annually).
  periodScope: "follow-toggle" | "annual";
  format: "number" | "percent-points" | "percent-raw" | "ratio";
  direction: MetricDirection;
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
    direction: "higher-is-better",
    hint: "Year-on-year change in revenue",
  },
  {
    key: "opm",
    label: "Operating Margin",
    canonical: "opm",
    kind: "value",
    periodScope: "follow-toggle",
    format: "percent-raw",
    direction: "higher-is-better",
    hint: "Latest OPM %",
  },
  {
    key: "net_profit_growth",
    label: "Net Profit Growth (YoY)",
    canonical: "pat",
    kind: "growth-yoy",
    periodScope: "follow-toggle",
    format: "percent-points",
    direction: "higher-is-better",
    hint: "Year-on-year change in net profit",
  },
  {
    key: "eps_growth",
    label: "EPS Growth (YoY)",
    canonical: "eps",
    kind: "growth-yoy",
    periodScope: "follow-toggle",
    format: "percent-points",
    direction: "higher-is-better",
    hint: "Year-on-year change in basic EPS",
  },
  {
    key: "roce",
    label: "ROCE",
    canonical: "roce",
    kind: "value",
    periodScope: "annual",
    format: "percent-raw",
    direction: "higher-is-better",
    hint: "Annual return on capital employed",
  },
  {
    key: "cfo_conversion",
    label: "CFO Conversion",
    // canonical is unused for the ratio kind, but kept for the spec shape.
    canonical: "cfo",
    kind: "ratio-cfo-conversion",
    periodScope: "annual",
    format: "ratio",
    direction: "higher-is-better",
    hint:
      "CFO / Net Profit (preferred) or CFO / Revenue (fallback). Higher means more of the reported profit converted to cash.",
  },
  {
    key: "borrowings",
    label: "Borrowings",
    canonical: "borrowings",
    kind: "value",
    periodScope: "annual",
    format: "number",
    direction: "lower-is-better",
    hint: "Latest annual borrowings. Lower is better.",
  },
];

function formatterFor(format: CardSpec["format"]): (n: number) => string {
  switch (format) {
    case "percent-points":
      return (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
    case "percent-raw":
      return (n) => formatPercentRaw(n, 1);
    case "ratio":
      // CFO-to-PAT ~ 1.0 = good; CFO-to-Revenue ~ 0.15 also common — the
      // same x.xx format reads naturally for both.
      return (n) => `${n.toFixed(2)}x`;
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
      direction: spec.direction,
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
            Consolidated data only.
          </span>
        </div>
      </section>
    );
  }

  // Surface the consolidated-data warning when the snapshot has zero
  // consolidated rows for the selected company. This typically happens
  // immediately after the Step 12 cutover, before the first scheduled
  // GitHub Action consolidated fetch has landed.
  const consolidatedRowCount =
    companyId !== null
      ? consolidatedScreenerRowCount(
          screenerNormalizedSnapshot.rows,
          companyId
        )
      : 0;
  const consolidatedWarning =
    companyId !== null && consolidatedRowCount === 0;

  return (
    <section className="kpi-benchmarks" aria-label="KPI peer benchmarks">
      <div className="kpi-benchmarks__head">
        <h2 className="section-title">KPI peer benchmarks</h2>
        <span className="section-subtitle">
          Selected company vs. tracked IT peer group. Consolidated data only.
          Source: cached Screener fetch · Consolidated.
        </span>
      </div>
      {consolidatedWarning && (
        <div
          className="kpi-benchmarks__warning"
          role="status"
          aria-live="polite"
        >
          No consolidated Screener rows for this company yet. Standalone /
          legacy rows are excluded by policy. Run the consolidated fetch
          workflow to populate.
        </div>
      )}
      <div className="kpi-benchmarks__grid">
        {cards.map((card) => (
          <BenchmarkCard key={card.spec.key} card={card} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Single benchmark card
// ---------------------------------------------------------------------------

function BenchmarkCard({ card }: { card: BenchmarkCardModel }) {
  const { spec, benchmark } = card;
  const format = formatterFor(spec.format);

  // Build the compact 3-row strip: best · self · worst. If self IS the
  // best or worst, drop the duplicate row so the card stays clean.
  const stripRows = compactStrip(benchmark);

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
          Peer median{" "}
          <strong>{tableValueOrDash(benchmark.peerMedian, format)}</strong>
        </span>
        <PositionChip
          position={benchmark.position}
          sentiment={benchmark.sentiment}
        />
      </div>

      <ul className="benchmark-card__peers benchmark-card__peers--compact">
        {stripRows.map((row) => (
          <li
            key={row.tag}
            className={`benchmark-card__peer benchmark-card__peer--${row.tag}${
              row.entry.isSelf ? " benchmark-card__peer--self" : ""
            }`}
          >
            <span className="benchmark-card__peer-tag">{row.label}</span>
            <span className="benchmark-card__peer-name">
              {row.entry.displayName}
            </span>
            <span className="benchmark-card__peer-value">
              {tableValueOrDash(row.entry.value, format)}
            </span>
          </li>
        ))}
      </ul>

      <p className="benchmark-card__hint">
        <span className="benchmark-card__peer-count">
          Peer count: {benchmark.peerCount}
        </span>
        <span className="benchmark-card__hint-dot"> · </span>
        {spec.hint}
      </p>
    </article>
  );
}

// Build the compact strip "best · self · worst", deduplicating when the
// self row coincides with best or worst (so we never repeat the same
// company within one card). If anything is missing (e.g. self has no
// value yet) the strip just shows what exists.
interface StripRow {
  tag: "best" | "self" | "worst";
  label: string;
  entry: PeerBenchmarkPeerEntry;
}

function compactStrip(benchmark: PeerBenchmark): StripRow[] {
  const out: StripRow[] = [];
  const selfEntry =
    benchmark.peerEntries.find((e) => e.isSelf) ?? null;
  const best = benchmark.bestPeer;
  const worst = benchmark.worstPeer;
  const seen = new Set<string>();

  function push(tag: StripRow["tag"], label: string, entry: PeerBenchmarkPeerEntry | null) {
    if (!entry) return;
    if (seen.has(entry.companyId)) return;
    seen.add(entry.companyId);
    out.push({ tag, label, entry });
  }

  push("best", "Best", best);
  push("self", "Selected", selfEntry);
  push("worst", "Worst", worst);
  return out;
}

const POSITION_TEXT_CLASS: Record<PeerBenchmarkSentiment, string> = {
  positive: "position-chip position-chip--positive",
  negative: "position-chip position-chip--negative",
  neutral: "position-chip position-chip--neutral",
  pending: "position-chip position-chip--pending",
};

function PositionChip({
  position,
  sentiment,
}: {
  position: PeerBenchmarkPosition;
  sentiment: PeerBenchmarkSentiment;
}) {
  return (
    <span className={POSITION_TEXT_CLASS[sentiment]}>
      {positionLabel(position)}
    </span>
  );
}

