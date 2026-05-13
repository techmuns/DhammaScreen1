import {
  guidanceActualSnapshot,
  guidanceCommentarySnapshot,
} from "../data/helpers/snapshotLoader";
import type { CompanyMaster } from "../data/types/dhammaDashboard";
import { SourceBadge } from "./SourceBadge";

interface GuidanceTrackerPanelProps {
  companyId: string | null;
  companies: ReadonlyArray<CompanyMaster>;
}

export function GuidanceTrackerPanel({
  companyId,
  companies,
}: GuidanceTrackerPanelProps) {
  const commentaryRows = guidanceCommentarySnapshot.rows.filter(
    (row) => row.companyId === companyId
  );
  const actualRows = guidanceActualSnapshot.rows.filter(
    (row) => row.companyId === companyId
  );

  const company = companies.find((c) => c.companyId === companyId);

  return (
    <section className="guidance-section" aria-label="Guidance tracker">
      <div className="section-head">
        <h2 className="section-title">Guidance tracker</h2>
        <SourceBadge provenance="audit" />
      </div>
      <div className="guidance-banner">
        <p className="guidance-banner__title">Audit-status feature</p>
        <p className="guidance-banner__body">
          The lie-detector is not live yet. It requires (i) prior-quarter
          management commentary extracted from transcripts or investor
          presentations, (ii) the current quarter's actual financials, and
          (iii) a stable source URL for each commentary item.
        </p>
        <ul className="guidance-banner__needs">
          <li>Prior-quarter management commentary or investor presentation</li>
          <li>Latest reported actual financial performance</li>
          <li>Source transcript or presentation URL</li>
        </ul>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Prior commentary</th>
              <th>Actual result</th>
              <th>Match status</th>
              <th>Source</th>
              <th>Review status</th>
            </tr>
          </thead>
          <tbody>
            {actualRows.length === 0 && commentaryRows.length === 0 ? (
              <tr>
                <td>{company?.displayName ?? "—"}</td>
                <td>—</td>
                <td>—</td>
                <td>pending</td>
                <td>—</td>
                <td>Awaiting transcript ingestion</td>
              </tr>
            ) : (
              actualRows.map((row) => {
                const commentary = commentaryRows.find(
                  (c) => c.commentaryId === row.commentaryId
                );
                return (
                  <tr key={row.commentaryId}>
                    <td>{company?.displayName ?? row.companyId}</td>
                    <td>{commentary?.rawQuote ?? "—"}</td>
                    <td>
                      {row.actualValue === null ? "—" : String(row.actualValue)}
                    </td>
                    <td>{row.status}</td>
                    <td>
                      {commentary?.source.sourceUrl ? (
                        <a
                          href={commentary.source.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          source
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{row.notes ?? "Audit"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
