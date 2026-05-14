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

1. ✅ **(Step 20)** Workflow's Screener step bumped from
   `--max-documents 10` to `--max-documents 30`. The Concalls and
   Credit-ratings sections on Screener typically appear below the
   Announcements + Annual reports blocks, so the previous cap was
   clipping them out of the manifest.
2. ✅ **(Step 20)** `classifyScreenerLink()` is now category-aware.
   The section `<h3>` drives the type whenever the header is
   unambiguous (`Concalls`, `Annual reports`, `Investor
   Presentations`, `Credit ratings`); only the generic
   `Announcements` bucket falls back to keyword detection on the
   link text. Every row's `notes` field records the classification
   trail: `classified-by=category | link-text | default`,
   alongside the Screener category header and the source URL the
   link came from.
3. Re-run the discovery workflow on `workflow_dispatch`; if a
   `concall_transcript` row lands for TCS or Infosys, switch the
   pilot to that document.
4. Once a pilot document is reachable in production: build a minimal
   PDF text extractor + verbatim-quote spotter behind a new script
   `scripts/ingest/guidance-extract.ts`. Output rows with
   `reviewStatus: "needs_review"`. Wire the analyst review tool last.

### Step 20 note

- **Max document cap**: increased from 10 → 30 in the
  `Discover guidance sources · Screener documents` workflow step.
  Concall and Investor Presentation sections sit below
  Announcements + Annual Reports on Screener's documents block, so
  the previous cap was the structural reason transcripts didn't
  surface.
- **Classifier is category-aware**: a `Concalls` section forces
  `concall_transcript` for every link inside it (including bare
  date-only labels like `Q4FY25` and generic `Download` anchors).
  The same applies to `Annual reports`, `Investor Presentations`,
  and `Credit ratings`. `Announcements` retains keyword-driven
  routing because Screener mixes everything (regulatory filings,
  press releases, occasional transcripts) under that single
  bucket.
- **Concall transcript discovery is priority**. Concalls are
  the highest-signal source of forward guidance — they carry the
  numeric bands the dashboard tracker needs. The cap bump + the
  category-first classifier together should make them visible on
  the next CI run.
- **Annual reports remain fallback only**. The MD&A section in an
  annual report carries directional commentary but rarely
  quarter-by-quarter numeric guidance. If the next CI run still
  yields zero `concall_transcript` rows, we fall through to using
  an annual report as the pilot for the extractor and re-evaluate
  whether Concalls are JS-rendered on Screener (Playwright
  decision).

## Step 21 status

### Expanded manifest (after `94f08f5`)

The cap bump and category-aware classifier from Step 20 produced a much
richer manifest on the next CI run:

| Slice                    | Before Step 20 | After Step 20 |
| ------------------------ | -------------: | ------------: |
| Total rows               |             41 |           121 |
| `concall_transcript`     |              0 |             6 |
| `annual_report`          |              0 |            60 |
| `credit_rating`          |              0 |            24 |
| `press_release`          |              1 |             1 |
| `other`                  |             40 |            30 |
| `investor_presentation`  |              0 |             0 |

Per (company × documentType):

| Company  | annual_report | credit_rating | concall_transcript | press_release | other |
| -------- | ------------: | ------------: | -----------------: | ------------: | ----: |
| TCS      |            15 |             6 |                  1 |             1 |     8 |
| Infosys  |            15 |             6 |                  2 |             0 |     7 |
| HCLTech  |            15 |             6 |                  1 |             0 |     8 |
| Wipro    |            15 |             6 |                  2 |             0 |     7 |

Confidence buckets: `high` 85 · `medium` 6 · `low` 30. All 6 transcripts
are `medium` because their classification came via `link-text` rather
than via a `<h3>Concalls</h3>` category match — Screener appears to
serve transcripts under an unlabelled section header on the current
TCS/INFY/HCLT/WIPRO pages, so the legacy keyword scan (`transcript`)
caught them. Promoting to `high` requires a follow-up tweak to the
category walker (probably looking for `[id*="concall"]` block IDs in
addition to the heading text); tracked separately, doesn't block
parsing.

### Selected first pilot

**TCS · Transcript** (priority 1 per Step 21 spec).

| Field         | Value                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Company       | TCS                                                                                              |
| documentType  | `concall_transcript`                                                                             |
| Title         | `Transcript` (Screener anchor text — period not derivable from the title alone)                  |
| documentUrl   | https://www.bseindia.com/xml-data/corpfiling/AttachHis/07ae2d32-1050-4e80-96ff-eb2d98378d4e.pdf  |
| sourceUrl     | https://www.screener.in/company/TCS/consolidated/                                                |
| sourceProvider| `screener`                                                                                       |
| Confidence    | `medium` (link-text classifier; eligible per the ≥medium threshold)                              |
| Login wall    | None known — BSE serves these PDFs without a session                                             |

Rationale: TCS is the priority-1 company and is the only one with a
single transcript row, so there's no ambiguity in "the latest". Other
candidates if the pipeline picks a fallback:

- Infosys: 2 transcripts (uuid `2ab7badf` and `b4632b94`)
- HCLTech: 1 transcript (uuid `48f5d6fd`)
- Wipro: 2 transcripts (uuid `78fab9a0` and `a3dbcb44`)

`investor_presentation` rows: 0. Screener's documents block on these
four companies does not currently expose an `Investor Presentations`
section in static HTML; either it's JS-rendered behind a tab or the
companies publish presentations exclusively to their IR pages. Defer
to the next step.

### Accessibility result

All four candidate BSE PDFs returned **HTTP 403** from this sandbox,
content-type `text/plain` / content-length 21 (the same 21-byte block
page we have seen on every prior sandbox probe). The CI runner reached
Screener successfully this run — `94f08f5` is the new data refresh
commit — so the same BSE URLs the runner just *catalogued* should be
reachable from a follow-up CI step that downloads them. We will know
for certain when the extractor step runs in CI.

### No commentary rows created

`guidance-commentary.json` and `guidance-actual-comparison.json` both
remain `rowCount: 0 · status: "empty"`. No quote was extracted; no
guidance row was fabricated. This is the documented "leave empty
until the first exact quote can be extracted" path.

### Next extraction plan

1. **New script `scripts/ingest/guidance-extract.ts`**. Inputs:
   `guidance-source-manifest.json` rows where
   `documentType === "concall_transcript"`,
   `status === "discovered"`,
   `confidence ∈ { "medium", "high" }`,
   `documentUrl !== null`.
   Skips anything already processed (idempotent on the manifest
   `documentUrl`).
2. **PDF text extraction**: lazy-import a single dependency (e.g.
   `pdf-parse` or `pdfjs-dist`'s text layer) so the cold path stays
   small. Convert pages → plain text → array of `{ pageIndex, text }`.
3. **Verbatim-quote spotter**: scan management answers for
   *numeric forward-looking statements only*. The first cut should
   match patterns like:
   - `(expect|guide|expecting|targeting)…(\\d+[\\-–to]+\\d+%|\\d+%)`
   - `(margin|growth|capex|attrition).{0,40}(\\d+[\\-–to]+\\d+%)`
   The matcher returns the surrounding sentence verbatim plus the
   `(pageIndex, charOffset, length)` triple so each emitted row is
   provably tied back to the source text.
4. **Schema**: `GuidanceCommentaryRow` from the existing
   `dhammaDashboard.ts` types, extended with the new
   `reviewStatus: "needs_review"` field. `commentaryId` follows the
   deterministic `<company>::<doc-slug>::<page>::<seq>` convention.
   No `numericLow/High` is written unless the regex matched a
   numeric band — qualitative quotes get `null` and stay as
   "qualitative" until an analyst sets explicit bounds.
5. **Run order**: extractor runs **after** the data refresh step in
   the workflow but **outside** the financial-dashboard critical
   path (`continue-on-error: true`). The dashboard UI continues to
   show the planned-module card until at least one `approved` row
   exists in `guidance-commentary.json` (already wired in the
   Step 15 GuidanceTrackerPanel).
6. **Manual review tool** (Step 22+): a one-pager that shows
   `needs_review` rows with their verbatim quote, source URL,
   page number and char offset, plus a single approve/reject
   button. Reviews persist to a `guidance-review-log.json` audit
   trail; only the `approved` rows render on the dashboard.

### Open questions for the next step

- **Period extraction from PDF metadata, not title.** The Screener
  anchor text "Transcript" has no period. We will need to read the
  PDF's first page (or its filename heuristic) to recover a period
  like "Q4FY26" before a guidance row can be tied to a
  `targetPeriod`.
- **Category-walker robustness.** All 6 transcripts came in at
  `medium / classified-by=link-text · category=(unknown)`. A small
  patch to look for Screener block IDs (`[id*="concall"]`) in
  addition to `<h3>` headings should lift these to `high /
  classified-by=category` — a clean win for analyst auditability
  but not a blocker for extraction.

## Step 22 status

### Extraction approach

The new script `scripts/ingest/guidance-extract.ts` reads the
guidance-source manifest, filters to **concall_transcript rows with
status=discovered + confidence ∈ {medium, high} + a non-null
documentUrl**, downloads each candidate PDF, extracts text page-by-page
via `pdfjs-dist` (the legacy Node-friendly entry point, lazy-imported),
and runs a narrow regex catalogue against the text. Every match emits a
`GuidanceCommentaryRow` with:

- `rawQuote`: the verbatim sentence the regex landed on, expanded to
  the nearest sentence boundaries (`. ? !`).
- `cleanedQuote`: same sentence with whitespace normalised. No other
  edits.
- `pageIndex` / `charOffset` / `quoteLength`: pdfjs page number plus the
  character offset within that page's joined text. Lets the analyst
  re-find the quote exactly.
- `numericLow` / `numericHigh` / `numericUnit`: filled only when the
  matched sentence actually carried a literal range; null otherwise.
  Qualitative quotes ("high single-digit growth") stay qualitative.
- `commentaryId`:
  `<companyId>::<docHash>::p<pageIndex>::o<charOffset>::<quoteHash>` —
  deterministic across runs, so re-running never duplicates and so
  analyst reviews survive a refetch.
- `reviewStatus`: always `"needs_review"`. The dashboard renders only
  `"approved"` rows; the (still to be built) analyst review tool is
  what flips status.

The script is idempotent: rows previously emitted whose
`reviewStatus` is **not** `"needs_review"` are preserved untouched on
re-run. New rows replace prior `needs_review` rows with the same id.

### Regex scope

Narrow on purpose — we optimise for precision, not recall. Adding a
pattern is cheap; cleaning up a flood of false-positive
`needs_review` rows is not. Current patterns:

| Name                    | Regex                                       | Topic           | Confidence |
| ----------------------- | ------------------------------------------- | --------------- | ---------- |
| `expect-band-percent`   | `(expect/guide/guidance/target/projecting)…\d+(?:[-–to])\d+%` | `other`         | medium     |
| `margin-band-percent`   | `(ebit/operating/net/margin)…\d+(?:[-–to])\d+%`               | `margin`        | medium     |
| `growth-band-percent`   | `(revenue growth/growth)…\d+(?:[-–to])\d+%`                   | `revenue_growth`| medium     |
| `attrition-percent`     | `attrition…\d+(?:[-–to])\d+%`                                  | `attrition`     | medium     |
| `capex-quantum`         | `capex…(₹/$|USD|INR)?\d+ (cr/mn/bn/...)`                        | `capex`         | medium     |
| `tax-rate-percent`      | `(effective tax rate/tax rate)…\d+(?:[-–to])\d+%`             | `tax_rate`      | medium     |
| `margin-bps`            | `(bps/basis points)…(margin/growth/...)`                       | `margin`        | low        |

### Review-status policy (unchanged from Step 19)

Extractor only writes `needs_review`. Analyst tool flips to
`approved` / `rejected`. The Guidance Tracker UI panel keeps showing
the planned-module card until at least one `approved` row exists for
the selected company.

### Selected transcript pilot

The workflow runs the extractor with `--max-documents 2`. Given the
current manifest ordering it will pick:

1. **TCS · Transcript** — `https://www.bseindia.com/xml-data/corpfiling/AttachHis/07ae2d32-1050-4e80-96ff-eb2d98378d4e.pdf`
2. **Infosys · Transcript** — `https://www.bseindia.com/xml-data/corpfiling/AttachHis/2ab7badf-388c-4dab-bfcc-3e128677734c.pdf`

Both are `medium`-confidence rows from Screener's documents tab. If
either PDF fails to download or parse, the run records a row in
`meta.errors[]` and continues with the next.

### Why no actual-vs-guidance comparison yet

`guidance-actual-comparison.json` remains untouched in Step 22. Three
reasons:

1. **Approved corpus first.** A comparison row requires a verified
   guidance band and a confirmed target period. Both come from the
   analyst tool, not the extractor. Building the comparator before
   that pipeline exists would create the very thing this project's
   no-fabrication rules ban — a row whose `expectedLow/High` was
   *inferred* rather than verified.
2. **Period parsing isn't reliable enough yet.** The current
   manifest's transcript rows have `title: "Transcript"` with no
   period token. The extractor leaves `targetPeriod` null until a
   subsequent step recovers it from PDF metadata, filename, or the
   first page's date stamp.
3. **Type stability.** `GuidanceActualComparisonRow` still references
   the structured `FinancialPeriod`. Tying that to whatever
   string-based period we recover from PDFs is its own design
   decision — better made when we have several real examples to
   align against.

### Local test result (Step 22)

`npm run ingest:guidance:extract -- --company tcs --max-documents 1
--timeout-ms 20000` was run from the sandbox. As expected the BSE
PDF returned HTTP 403; the script recorded the failure honestly in
`meta.errors[]`, exited 0, and wrote zero commentary rows. The
committed `guidance-commentary.json` was reset to the empty baseline
before commit so the first real-CI run owns the published rows.
