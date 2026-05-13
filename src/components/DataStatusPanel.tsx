import {
  filingManifestSnapshot,
  guidanceCommentarySnapshot,
  screenerFetchStatusSnapshot,
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

function countRowsByMethod(method: "fetch" | "import"): { rows: number; files: number } {
  const files = new Set<string>();
  let rows = 0;
  for (const row of screenerNormalizedSnapshot.rows) {
    if (row.sourceMethod === method) {
      rows++;
      files.add(row.sourceFile);
    }
  }
  for (const row of screenerPeerSnapshot.rows) {
    if (row.sourceMethod === method) {
      rows++;
      files.add(row.sourceFile);
    }
  }
  return { rows, files: files.size };
}

function paths(): PathStatus[] {
  const filing = filingManifestSnapshot.meta;
  const fetchStatus = screenerFetchStatusSnapshot;
  const importStatus = screenerImportStatusSnapshot.meta;
  const guidance = guidanceCommentarySnapshot.meta;

  const fetchCounts = countRowsByMethod("fetch");
  const importCounts = countRowsByMethod("import");

  const filingTone: Tone =
    filing.status === "ok" || filing.status === "partial"
      ? "ok"
      : filing.status === "error"
        ? "warn"
        : "neutral";

  // Fetch tone is driven by the per-company status rows; any "ok"/"partial"
  // wins; otherwise tone follows whether everyone was blocked.
  const fetchRows = fetchStatus.rows;
  const fetchOk = fetchRows.some((r) => r.status === "ok" || r.status === "partial");
  const fetchBlocked = fetchRows.length > 0 && fetchRows.every(
    (r) => r.status === "blocked" || r.status === "error"
  );
  const fetchTone: Tone = fetchOk ? "ok" : fetchBlocked ? "warn" : "neutral";
  const fetchLabel = fetchOk
    ? "ok"
    : fetchBlocked
      ? "blocked"
      : fetchStatus.meta.status;

  const importTone: Tone = importCounts.rows > 0 ? "ok" : "neutral";
  const importLabel =
    importCounts.rows > 0
      ? importStatus.status === "partial"
        ? "partial"
        : "ok"
      : importStatus.status;

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
      label: "Screener fetch",
      status: fetchLabel,
      tone: fetchTone,
      detail:
        fetchCounts.rows > 0
          ? `${fetchCounts.rows} rows · ${fetchRows.length} companies attempted`
          : fetchRows.length === 0
            ? "Not run yet"
            : "All companies blocked or empty",
    },
    {
      label: "Screener import",
      status: importLabel,
      tone: importTone,
      detail:
        importCounts.rows > 0
          ? `${importCounts.rows} rows · ${importCounts.files} file${importCounts.files === 1 ? "" : "s"}`
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
