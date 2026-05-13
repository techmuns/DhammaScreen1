// Data provenance panel.
//
// Client-demo polish (Step 15): the panel shows a single-line summary by
// default — consolidated rows, companies attempted, official filings
// discovered, last refresh — and tucks the per-snapshot detail table
// behind a <details> element. The detail tables are the same as before;
// they're just not in the demo viewer's face on first paint.

import {
  consolidatedScreenerRowCount,
  formatGenerationTimestamp,
  latestGeneratedAt,
} from "../data/helpers/dhammaFinancials";
import {
  ALL_SNAPSHOT_METAS,
  filingManifestSnapshot,
  screenerFetchStatusSnapshot,
  screenerNormalizedSnapshot,
} from "../data/helpers/snapshotLoader";
import type { SnapshotMeta, SnapshotStatus } from "../data/types/dhammaDashboard";

const STATUS_TONE: Record<SnapshotStatus, string> = {
  ok: "status-tag status-tag--ok",
  partial: "status-tag status-tag--warn",
  empty: "status-tag status-tag--muted",
  stale: "status-tag status-tag--warn",
  error: "status-tag status-tag--bad",
};

interface Group {
  title: string;
  description: string;
  snapshots: SnapshotMeta[];
}

const SNAPSHOT_HUMAN_LABELS: Record<string, string> = {
  "company-master": "Company master",
  "filing-manifest": "Filing manifest",
  "source-health": "Source health",
  "quarterly-financials": "Quarterly P&L",
  "annual-financials": "Annual P&L",
  "segment-revenue": "Segment revenue",
  "balance-sheet": "Balance sheet",
  "cash-flow": "Cash flow",
  "screener-fetch-status": "Screener fetch — per-company status",
  "screener-import-status": "Screener import — per-file status",
  "screener-normalized-financials":
    "Screener financials · Consolidated only (fetch + import)",
  "screener-peer-comparison":
    "Screener raw peer table · not shown · KPI benchmarks use fetched financials instead",
  "guidance-commentary": "Guidance commentary",
  "guidance-actual-comparison": "Guidance — actual vs. prior",
};

function humanLabel(snapshotId: string): string {
  return SNAPSHOT_HUMAN_LABELS[snapshotId] ?? snapshotId;
}

function groupSnapshots(): Group[] {
  const byId = new Map(ALL_SNAPSHOT_METAS.map((m) => [m.snapshotId, m]));
  const pick = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((m): m is SnapshotMeta => Boolean(m));

  return [
    {
      title: "Official filings · Discovery",
      description:
        "NSE / BSE / annual report manifests. Filings are catalogued; " +
        "financial-row extraction is not yet wired, so per-metric snapshots " +
        "in this group are intentionally empty.",
      snapshots: pick([
        "company-master",
        "filing-manifest",
        "source-health",
        "quarterly-financials",
        "annual-financials",
        "segment-revenue",
        "balance-sheet",
        "cash-flow",
      ]),
    },
    {
      title: "Screener",
      description:
        "Cached fetch + manual import. UI never live-fetches. " +
        "Consolidated data only — non-consolidated rows are excluded by policy.",
      snapshots: pick([
        "screener-fetch-status",
        "screener-import-status",
        "screener-normalized-financials",
        "screener-peer-comparison",
      ]),
    },
    {
      title: "Guidance tracker",
      description: "Audit. Requires transcripts / investor presentations.",
      snapshots: pick(["guidance-commentary", "guidance-actual-comparison"]),
    },
  ];
}

interface ProvenanceSummary {
  consolidatedRows: number;
  companiesAttempted: number;
  officialFilingsDiscovered: number;
  lastRefresh: string;
}

function buildSummary(): ProvenanceSummary {
  const consolidatedRows = consolidatedScreenerRowCount(
    screenerNormalizedSnapshot.rows
  );
  const companiesAttempted = screenerFetchStatusSnapshot.rows.length;
  const officialFilingsDiscovered = filingManifestSnapshot.meta.rowCount;
  const lastRefresh = formatGenerationTimestamp(
    latestGeneratedAt(ALL_SNAPSHOT_METAS.map((m) => ({ meta: m })))
  );
  return {
    consolidatedRows,
    companiesAttempted,
    officialFilingsDiscovered,
    lastRefresh,
  };
}

export function DataProvenancePanel() {
  const groups = groupSnapshots();
  const summary = buildSummary();
  return (
    <section className="provenance-section" aria-label="Data provenance">
      <div className="section-head">
        <h2 className="section-title">Data provenance</h2>
        <span className="section-subtitle">
          Cached snapshots only. The UI never live-fetches.
        </span>
      </div>

      <dl className="provenance-summary" aria-label="Data provenance summary">
        <SummaryStat
          label="Consolidated rows"
          value={summary.consolidatedRows.toLocaleString("en-IN")}
          hint="Screener fetch · Consolidated"
        />
        <SummaryStat
          label="Companies attempted"
          value={String(summary.companiesAttempted)}
          hint="Last Screener fetch run"
        />
        <SummaryStat
          label="Official filings discovered"
          value={summary.officialFilingsDiscovered.toLocaleString("en-IN")}
          hint="Discovery only; financial extraction pending"
        />
        <SummaryStat
          label="Last refresh"
          value={summary.lastRefresh}
          hint="Latest snapshot generated-at timestamp"
        />
      </dl>

      <details className="provenance-details">
        <summary className="provenance-details__summary">
          Per-snapshot detail
        </summary>
        <div className="provenance-details__body">
          {groups.map((group) => (
            <div key={group.title} className="provenance-group">
              <div className="provenance-group__head">
                <h3 className="provenance-group__title">{group.title}</h3>
                <span className="provenance-group__desc">
                  {group.description}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data-table data-table--compact">
                  <thead>
                    <tr>
                      <th>Dataset</th>
                      <th>Status</th>
                      <th className="num">Rows</th>
                      <th>Generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.snapshots.map((meta) => (
                      <tr key={meta.snapshotId}>
                        <td>
                          <span className="provenance-name">
                            {humanLabel(meta.snapshotId)}
                          </span>
                          <span className="provenance-id">
                            <code>{meta.snapshotId}</code>
                          </span>
                        </td>
                        <td>
                          <span className={STATUS_TONE[meta.status]}>
                            {meta.status}
                          </span>
                        </td>
                        <td className="num">{meta.rowCount}</td>
                        <td className="muted">
                          {formatGenerationTimestamp(meta.generatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="provenance-summary__stat">
      <dt className="provenance-summary__label">{label}</dt>
      <dd className="provenance-summary__value">{value}</dd>
      <span className="provenance-summary__hint">{hint}</span>
    </div>
  );
}
