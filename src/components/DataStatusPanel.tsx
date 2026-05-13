import {
  filingManifestSnapshot,
  guidanceCommentarySnapshot,
  screenerImportStatusSnapshot,
  screenerNormalizedSnapshot,
  screenerPeerSnapshot,
} from "../data/helpers/snapshotLoader";

type Tone = "ok" | "warn" | "neutral";

interface PathStatus {
  label: string;
  status: string;
  tone: Tone;
  detail: string;
}

function distinctSourceFiles(): number {
  const files = new Set<string>();
  for (const row of screenerNormalizedSnapshot.rows) files.add(row.sourceFile);
  for (const row of screenerPeerSnapshot.rows) files.add(row.sourceFile);
  return files.size;
}

function paths(): PathStatus[] {
  const filing = filingManifestSnapshot.meta;
  const screener = screenerImportStatusSnapshot.meta;
  const guidance = guidanceCommentarySnapshot.meta;
  const screenerRowCount =
    screenerNormalizedSnapshot.rows.length + screenerPeerSnapshot.rows.length;
  const fileCount = distinctSourceFiles();

  const filingTone: Tone =
    filing.status === "ok" || filing.status === "partial"
      ? "ok"
      : filing.status === "error"
        ? "warn"
        : "neutral";

  const screenerTone: Tone = screenerRowCount > 0 ? "ok" : "neutral";
  const screenerStatus =
    screenerRowCount > 0
      ? screener.status === "partial"
        ? "partial"
        : "ok"
      : screener.status;

  return [
    {
      label: "Official filings",
      status: filing.status,
      tone: filingTone,
      detail:
        filing.status === "ok"
          ? `${filing.rowCount} filings discovered`
          : filing.status === "partial"
            ? `${filing.rowCount} filings — some sources failed`
            : filing.status === "error"
              ? `Sources blocked (${filing.errors?.length ?? 0} errors)`
              : "No filings discovered yet",
    },
    {
      label: "Screener import",
      status: screenerStatus,
      tone: screenerTone,
      detail:
        screenerRowCount > 0
          ? `${screenerRowCount} rows · ${fileCount} file${fileCount === 1 ? "" : "s"}`
          : "No client exports yet",
    },
    {
      label: "Guidance commentary",
      status: "audit",
      tone: "neutral",
      detail:
        guidance.rowCount > 0
          ? `${guidance.rowCount} commentary rows (Audit)`
          : "Audit — not wired",
    },
  ];
}

export function DataStatusPanel() {
  const items = paths();
  return (
    <div className="data-status-panel" aria-label="Data source status">
      {items.map((item) => (
        <div
          key={item.label}
          className={`data-status-pill data-status-pill--${item.tone}`}
        >
          <span className="data-status-pill__label">{item.label}</span>
          <span className="data-status-pill__status">{item.status}</span>
          <span className="data-status-pill__detail">{item.detail}</span>
        </div>
      ))}
    </div>
  );
}
