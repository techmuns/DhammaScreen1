import { formatGenerationTimestamp } from "../data/helpers/dhammaFinancials";
import { ALL_SNAPSHOT_METAS } from "../data/helpers/snapshotLoader";
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

export function DataProvenancePanel() {
  const groups = groupSnapshots();
  return (
    <section className="provenance-section" aria-label="Data provenance">
      <div className="section-head">
        <h2 className="section-title">Data provenance</h2>
        <span className="section-subtitle">
          Where every cell on this dashboard came from. Refreshed by the
          ingestion workflow, never by the UI.
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.title} className="provenance-group">
          <div className="provenance-group__head">
            <h3 className="provenance-group__title">{group.title}</h3>
            <span className="provenance-group__desc">{group.description}</span>
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
    </section>
  );
}
