import { isConsolidatedScreenerRow } from "../data/helpers/dhammaFinancials";
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

// Counts rows that the dashboard will actually render: same
// sourceMethod filter as before, but also gated on the Step 12
// consolidated-only policy. The "all rows" count is kept too so the
// panel can flag when non-consolidated rows are present.
interface MethodRowCount {
  consolidatedRows: number;
  allRows: number;
  files: number;
}

function countRowsByMethod(method: "fetch" | "import"): MethodRowCount {
  const files = new Set<string>();
  let consolidatedRows = 0;
  let allRows = 0;
  for (const row of screenerNormalizedSnapshot.rows) {
    if (row.sourceMethod !== method) continue;
    allRows++;
    files.add(row.sourceFile);
    if (isConsolidatedScreenerRow(row)) consolidatedRows++;
  }
  for (const row of screenerPeerSnapshot.rows) {
    if (row.sourceMethod !== method) continue;
    allRows++;
    files.add(row.sourceFile);
    if (isConsolidatedScreenerRow(row)) consolidatedRows++;
  }
  return { consolidatedRows, allRows, files: files.size };
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
  // wins; otherwise tone follows whether everyone was blocked. Additionally,
  // if every fetched row is non-consolidated (Step 12 cutover state), tone
  // drops to "warn" because nothing renders on the dashboard.
  const fetchRows = fetchStatus.rows;
  const anyFetchSucceeded = fetchRows.some(
    (r) => r.status === "ok" || r.status === "partial"
  );
  const allFetchBlocked =
    fetchRows.length > 0 &&
    fetchRows.every((r) => r.status === "blocked" || r.status === "error");
  const hasConsolidatedFetch = fetchCounts.consolidatedRows > 0;
  const hasStaleStandalone =
    fetchCounts.allRows > 0 && fetchCounts.consolidatedRows === 0;
  const fetchTone: Tone = hasConsolidatedFetch
    ? "ok"
    : allFetchBlocked || hasStaleStandalone
      ? "warn"
      : anyFetchSucceeded
        ? "warn"
        : "neutral";
  const fetchLabel = hasConsolidatedFetch
    ? "consolidated"
    : hasStaleStandalone
      ? "non-consolidated"
      : allFetchBlocked
        ? "blocked"
        : anyFetchSucceeded
          ? "partial"
          : fetchStatus.meta.status;

  const importTone: Tone =
    importCounts.consolidatedRows > 0
      ? "ok"
      : importCounts.allRows > 0
        ? "warn"
        : "neutral";
  const importLabel =
    importCounts.consolidatedRows > 0
      ? "ok"
      : importCounts.allRows > 0
        ? "non-consolidated"
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
      label: "Screener fetch · Consolidated",
      status: fetchLabel,
      tone: fetchTone,
      detail: hasConsolidatedFetch
        ? `${fetchCounts.consolidatedRows} consolidated rows · ${fetchRows.length} companies attempted`
        : hasStaleStandalone
          ? `${fetchCounts.allRows} non-consolidated rows excluded — run consolidated fetch`
          : fetchRows.length === 0
            ? "Not run yet"
            : "All companies blocked or empty",
    },
    {
      label: "Screener import",
      status: importLabel,
      tone: importTone,
      detail:
        importCounts.consolidatedRows > 0
          ? `${importCounts.consolidatedRows} consolidated rows · ${importCounts.files} file${importCounts.files === 1 ? "" : "s"}`
          : importCounts.allRows > 0
            ? `${importCounts.allRows} imported rows excluded (basis not labelled consolidated)`
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
