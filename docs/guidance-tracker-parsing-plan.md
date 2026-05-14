# Guidance Tracker · parsing plan

Status: **planning**. The Guidance Tracker UI panel is a planned module
(`Audit` status) and the snapshots `guidance-commentary.json` and
`guidance-actual-comparison.json` are intentionally empty. This document
captures the source hierarchy, the chosen pilot, the schema we'll fill,
and the rules we will NOT break on the way.

## Source hierarchy

In priority order — primary at the top, fallback at the bottom. The
discovery script (`scripts/ingest/guidance-sources.ts`) writes one row
per `(companyId, sourceProvider)` probe into
`src/data/snapshots/guidance-source-manifest.json`. The tracker will
ingest **only** documents whose manifest row has
`status === "discovered"`, `documentUrl !== null`, and confidence
`"high"` or `"medium"`.

1. **Screener documents tab** — Step 18. Reached and parsed in
   production CI; 40 rows currently in the manifest for 4 companies.
   Static HTML, cheerio-only. Covers `Annual reports`, `Announcements`;
   `Concalls` / `Investor presentations` sections were not reached
   under the current `--max-documents 10` cap. **Action item: raise
   the cap to 30 on the workflow once we're ready to ingest from
   Concalls.**
2. **Tijori Finance** — Step 17. Page reachable from CI but the
   document anchors live behind a JS tab; static HTML alone returns
   none. Status logged honestly as `discovered · low confidence ·
   notes: "no obvious document anchors detected"`. We do NOT launch
   Playwright for Tijori yet; if Screener proves insufficient we
   revisit.
3. **Company IR page fallback** — not yet implemented. Per-company
   `irPageUrl` already lives on `CompanyMaster`. To be added when
   Screener / Tijori don't cover a given filing.
4. **NSE / BSE direct probing** — deferred. Cookie / referrer walls
   require session handling we don't have a story for. The BSE PDF
   URLs we *find* via Screener are still followed for downloads —
   that's allowed because we're requesting a specific, already-
   discovered document URL, not crawling an index.

## Chosen pilot document

The current manifest has **zero concall transcript rows** (the 10-doc
cap clipped the Concalls section if it exists in static HTML, or the
section is rendered only via JS on Screener). Of what IS in the
manifest, the best parseable pilot is:

| Field           | Value                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Company         | TCS                                                                                            |
| Document type   | `annual_report` (currently mis-classified as `other` — classifier upgrade tracked separately)  |
| Title           | Financial Year 2025 (from BSE)                                                                 |
| Source URL      | https://www.screener.in/company/TCS/consolidated/                                              |
| Document URL    | https://www.bseindia.com/xml-data/corpfiling/AttachHis/bb9f9e0a-e4ce-4a4e-997e-0b5de8c2bec0.pdf |
| Confidence      | low (will upgrade to `high` after classifier patches)                                          |
| Accessibility   | **403 from sandbox** (network-blocked); production CI reaches BSE per the Screener evidence    |

**Rationale**: Annual reports contain the MD&A section which carries
forward-looking outlook statements. They are usable as a baseline
guidance source while we figure out concall ingestion. A concall
transcript would be preferred — we'll switch the pilot to one the
moment a `concall_transcript` row lands in the manifest.

## Extraction goals

For each pilot document, the eventual extractor should produce **zero
or more** guidance claim rows, each anchored to a verbatim quote and a
character offset in the original document. Never paraphrase. Never
infer.

A guidance claim is:

- A sentence (or short paragraph) in management's own words that
  states an *expectation about future performance* for a specific
  metric.
- Examples that qualify: "We expect revenue growth of 8–10% in FY26",
  "EBITDA margin guidance band remains 26–28%", "Capex of ~₹3,000 cr
  this year".
- Examples that do NOT qualify: marketing slogans, historical recaps,
  questions from analysts, generic colour without a numeric target.

## Proposed schema

The existing `GuidanceCommentaryRow` type already covers most of what
we need (`src/data/types/dhammaDashboard.ts:213`). The pilot will write
rows in this shape with two operational rules layered on top:

```
{
  companyId: "tcs",
  commentaryId: "tcs::fy25-ar::p042::01",   // <company>::<doc-slug>::<page>::<seq>
  saidInPeriod: { kind: "annual", fiscalYear: 2025, periodEndDate: "2025-03-31" },
  targetPeriod: { kind: "annual", fiscalYear: 2026, periodEndDate: "2026-03-31" },
  metric: "revenue",
  direction: "growth_yoy",
  rawQuote: "...verbatim sentence from the document...",
  numericLow: 8,
  numericHigh: 10,
  numericUnit: "percent",
  speaker: "K Krithivasan, CEO",      // null if anonymous
  source: {
    sourceClass: "annual_report",
    sourceUrl: "https://www.screener.in/company/TCS/consolidated/",
    sourceLabel: "TCS · Annual Report FY2025",
    fetchedAt: "2026-05-14T07:15:39.740Z",
    publishedAt: null,                 // fill if discoverable from doc metadata
    notes: "BSE filing URL: https://www.bseindia.com/xml-data/corpfiling/AttachHis/bb9f9e0a-e4ce-4a4e-997e-0b5de8c2bec0.pdf · page 42",
  }
}
```

Two layered rules:

1. **`reviewStatus: "needs_review"` on every emitted row.** A new field
   added to `GuidanceCommentaryRow` (default `"needs_review"`,
   transitioned to `"approved"` only by an analyst). The dashboard
   renders only `approved` rows; everything else stays invisible.
2. **`commentaryId` is deterministic and stable.** `<companyId>::<doc-
   slug>::<page>::<sequence>` so a re-parse never duplicates a quote
   and an analyst review survives a re-fetch.

## Review-status policy

| Status            | Set by    | Visibility on dashboard | Lifecycle                                  |
| ----------------- | --------- | ----------------------- | ------------------------------------------ |
| `needs_review`    | extractor | hidden                  | newly extracted; awaits analyst sign-off   |
| `approved`        | analyst   | shown                   | quote + metric + period confirmed in doc   |
| `rejected`        | analyst   | hidden                  | quote isn't real guidance / extraction bug |
| `superseded`      | extractor | hidden                  | re-extraction replaced this row            |

Audit trail: review transitions are recorded in a separate
`guidance-review-log.json` snapshot (TBD) so we can reproduce why a
row was approved or rejected.

## No-fabrication policy

Hard rules — no exceptions:

- Never infer a guidance claim from a document title alone.
- Never write a `numericLow`/`numericHigh` that the verbatim quote did
  not state. If the quote says "high single digit growth", emit it
  with the quote intact and `numericLow/High` left null.
- Never derive a guidance row from a press-release headline.
- If the document cannot be downloaded, write nothing — not even a
  placeholder row. The discovery manifest already records the
  document's existence; a placeholder commentary row would mislead.
- If a row is later contradicted by a subsequent press release, the
  rule is to leave the original row in place with `superseded` and add
  the new one, not to silently rewrite history.

## Matching actuals from consolidated Screener rows

When `GuidanceActualComparisonRow` rows are eventually produced:

- The `actualValue` cell pulls from `screener-normalized-financials.json`
  via `latestScreenerValue(rows, companyId, canonical, periodType)` —
  the same helper KPI cards already use. Guarantees the consolidated-
  only filter is applied.
- The `targetPeriod` on the commentary row drives the lookup. If the
  target period is in the future, status starts as `pending` and the
  comparison stays empty until a real consolidated row arrives.
- The status classifier maps: `actual` within `[low, high]` ⇒ `met`;
  outside the band ⇒ `missed`; band absent ⇒ `unverifiable`. We do
  not invent intermediate "partial" buckets without analyst input.

## What we are NOT doing in this step

- No commentary rows are written. Pilot accessibility is unconfirmed
  from this sandbox (BSE returned HTTP 403); the next workflow run on
  CI will tell us if BSE PDFs are reachable there. Until a transcript
  text is in hand, `guidance-commentary.json` stays empty.
- No PDF parser is wired. The extractor (pdf-text + heuristic claim
  spotter) is the next step.
- No changes to `guidance-source-manifest.json` schema — current
  shape already supports every field we need.
- No new dependencies. PDF text extraction will use a single
  well-known library when added; we'll pin it lazily so the
  cold-path bundle stays small.

## Next operational steps

1. Bump the workflow's Screener step to `--max-documents 30` to give
   the parser a shot at the `Concalls` and `Credit ratings` sections
   on Screener (assuming they exist in static HTML for these
   companies).
2. Patch `classifyScreenerLink()` so `"Financial Year 2025 from bse"`
   under category `"Annual reports"` resolves to `annual_report` (the
   current keyword classifier only matches `annual report` exactly).
3. Re-run the discovery workflow; if a `concall_transcript` row lands
   for TCS or Infosys, switch the pilot to that document.
4. Once a pilot document is reachable in production: build a minimal
   PDF text extractor + verbatim-quote spotter behind a new script
   `scripts/ingest/guidance-extract.ts`. Output rows with
   `reviewStatus: "needs_review"`. Wire the analyst review tool last.
