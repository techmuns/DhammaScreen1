import { formatGenerationTimestamp } from "../data/helpers/dhammaFinancials";
import { ALL_SNAPSHOT_METAS } from "../data/helpers/snapshotLoader";
import type { SnapshotStatus } from "../data/types/dhammaDashboard";

const STATUS_TONE: Record<SnapshotStatus, string> = {
  ok: "status-tag status-tag--ok",
  partial: "status-tag status-tag--warn",
  empty: "status-tag status-tag--muted",
  stale: "status-tag status-tag--warn",
  error: "status-tag status-tag--bad",
};

export function DataProvenancePanel() {
  return (
    <section className="provenance-section" aria-label="Data provenance">
      <div className="section-head">
        <h2 className="section-title">Data provenance</h2>
        <span className="section-subtitle">
          Snapshot row counts and freshness. The dashboard is data-driven —
          empty snapshots mean empty UI.
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table data-table--compact">
          <thead>
            <tr>
              <th>Snapshot</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Generated</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {ALL_SNAPSHOT_METAS.map((meta) => (
              <tr key={meta.snapshotId}>
                <td>
                  <code>{meta.snapshotId}</code>
                </td>
                <td>
                  <span className={STATUS_TONE[meta.status]}>{meta.status}</span>
                </td>
                <td className="num">{meta.rowCount}</td>
                <td className="muted">
                  {formatGenerationTimestamp(meta.generatedAt)}
                </td>
                <td className="muted">{meta.source.sourceClass}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
