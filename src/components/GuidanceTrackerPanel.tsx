// Guidance tracker — planned module.
//
// Status: Audit. The dashboard intentionally renders NO guidance rows
// yet because the feed (concall transcripts, investor presentations)
// is not wired. Step 15 reframes this from a sparse / broken-looking
// table into an explicit roadmap card so the client demo reads as
// "feature on the way", not "feature failed".

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

// Three sequential pieces a guidance row needs before it can land on
// the dashboard. Tagged "Pending" everywhere — the dashboard never
// fabricates commentary.
const PIPELINE_STEPS: ReadonlyArray<{
  label: string;
  detail: string;
}> = [
  {
    label: "Prior commentary",
    detail:
      "Parse concall transcripts and investor presentations to extract " +
      "what management said about the next quarter / year.",
  },
  {
    label: "Actual result",
    detail:
      "Pair each commentary line with the reported financial number " +
      "for the same metric and period.",
  },
  {
    label: "Verified source URL",
    detail:
      "Keep a stable link to the transcript / presentation so the team " +
      "can re-read the original quote in context.",
  },
];

// What the panel will show once each row is wired. Used to set
// expectations during the client demo without rendering placeholder
// data.
const PLANNED_COLUMNS: ReadonlyArray<string> = [
  "Company",
  "Period commented on",
  "Metric",
  "Management quote",
  "Reported actual",
  "Match status",
  "Source link",
];

export function GuidanceTrackerPanel({
  companyId,
  companies,
}: GuidanceTrackerPanelProps) {
  // We don't render guidance rows yet, but we *do* keep these reads so
  // the panel switches off the placeholder the moment the ingestion
  // pipeline produces real data.
  const commentaryRows = guidanceCommentarySnapshot.rows.filter(
    (row) => row.companyId === companyId
  );
  const actualRows = guidanceActualSnapshot.rows.filter(
    (row) => row.companyId === companyId
  );
  const hasRealData = commentaryRows.length > 0 && actualRows.length > 0;

  const company = companies.find((c) => c.companyId === companyId);
  const companyLabel = company?.displayName ?? "the selected company";

  return (
    <section className="guidance-section" aria-label="Guidance tracker">
      <div className="section-head">
        <h2 className="section-title">Guidance tracker</h2>
        <SourceBadge provenance="audit" />
      </div>

      <div className="guidance-planned" role="group">
        <div className="guidance-planned__intro">
          <p className="guidance-planned__title">
            Planned module · not yet live
          </p>
          <p className="guidance-planned__lede">
            Lines up prior-quarter management commentary for {companyLabel}{" "}
            against the actual financial result, with a verified source
            link. The dashboard renders zero guidance rows today — it never
            invents quotes or match statuses.
          </p>
        </div>

        <div className="guidance-planned__columns">
          <h3 className="guidance-planned__subtitle">
            Pipeline (each row needs all three)
          </h3>
          <ol className="guidance-planned__steps">
            {PIPELINE_STEPS.map((step) => (
              <li key={step.label} className="guidance-planned__step">
                <span className="guidance-planned__step-label">
                  {step.label}
                </span>
                <span className="guidance-planned__step-status">Pending</span>
                <p className="guidance-planned__step-detail">{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="guidance-planned__preview">
          <h3 className="guidance-planned__subtitle">
            What this view will show
          </h3>
          <p className="guidance-planned__columns-list">
            {PLANNED_COLUMNS.join(" · ")}
          </p>
        </div>

        {hasRealData && (
          <div className="guidance-planned__upgrade" role="status">
            Real guidance rows are now available for {companyLabel}. This
            placeholder will be replaced by the live table on the next
            UI build.
          </div>
        )}
      </div>
    </section>
  );
}
