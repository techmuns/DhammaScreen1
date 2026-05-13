import {
  filingManifestSnapshot,
  guidanceCommentarySnapshot,
  screenerImportStatusSnapshot,
} from "../data/helpers/snapshotLoader";

type Tone = "ok" | "warn" | "neutral";

interface PathStatus {
  label: string;
  status: string;
  tone: Tone;
  detail: string;
}

function paths(): PathStatus[] {
  const filing = filingManifestSnapshot.meta;
  const screener = screenerImportStatusSnapshot.meta;
  const guidance = guidanceCommentarySnapshot.meta;

  const filingTone: Tone =
    filing.status === "ok" || filing.status === "partial"
      ? "ok"
      : filing.status === "error"
        ? "warn"
        : "neutral";

  const screenerTone: Tone =
    screener.status === "ok" || screener.status === "partial"
      ? "ok"
      : "neutral";

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
      status: screener.status,
      tone: screenerTone,
      detail:
        screener.status === "empty"
          ? "No client exports yet"
          : `${screener.rowCount} import sheet rows`,
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
