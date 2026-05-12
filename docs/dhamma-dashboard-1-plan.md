# Dhamma Dashboard 1 — Source-First Plan

## Objective

This dashboard helps Dhamma Capital track company earnings, financial quality,
peer positioning, and management guidance accuracy using company filings,
exchange disclosures, and earnings commentary to make quarterly investment
decisions.

## Target User

- Dhamma Capital investment team (PMs and analysts).
- Read-only consumers during pre- and post-earnings windows; the dashboard is
  not a research authoring tool.
- Expected usage: weekly during results season, monthly otherwise.

## Core Entities

- **Company** — A listed Indian company tracked in the portfolio or watchlist.
  Identified by NSE/BSE symbol and a stable internal `companyId`.
- **PeerGroup** — A named, hand-curated set of companies grouped for comparison
  (e.g., "Indian large-cap private banks"). One company can belong to many.
- **FinancialPeriod** — Either a fiscal quarter (`Q1FY26`) or fiscal year
  (`FY25`). Indian fiscal year ends 31 March.
- **Snapshot** — A normalized JSON file representing a point-in-time pull of
  filings, with `meta` describing source and freshness.
- **GuidanceItem** — A discrete management statement extracted from a transcript
  or presentation, tagged with the metric it commits to and the period it
  references.

## Cadence

- **Quarterly results ingest**: triggered after each company files quarterly
  results with NSE/BSE. Manual `workflow_dispatch` while sources stabilize;
  scheduled weekly later.
- **Annual results ingest**: after the Q4 / annual report is published.
- **Guidance ingest**: best-effort, transcript-driven; runs alongside the
  quarterly ingest.
- **Peer comparison refresh**: derived; recomputed any time underlying
  snapshots change. No separate cadence.

## Main Decision

Should Dhamma Capital add, hold, trim, or exit a position based on this
quarter's earnings versus the company's own trend, its peers, and what
management committed to in prior quarters?

The dashboard is decision-support, not a model output. Each surfaced metric
must link to a source so the investment team can verify before acting.

## Sections in Dashboard 1

1. **Last 5 quarters P&L** with revenue mix by segment.
2. **Last 5 quarters Balance Sheet** summary.
3. **Last 5 quarters condensed Cash Flow Statement** — CFO, working capital
   changes, CFI, CFF only.
4. **Toggle**: last 5 quarters ↔ last 5 fiscal years for each of the above.
5. **Overall KPI dashboard** — own historical comparables + peer comparison.
6. **Lie detector / guidance tracker** — present-quarter actuals versus prior
   commentary, classified into Met / Missed / Partial / Unverifiable.

## Build Sequence

1. **Step 1 (this step)** — Define objective, audit metrics, choose sources,
   write types, helper stubs, snapshot scaffolding, ingestion scaffold,
   GitHub Actions stub. No real UI.
2. **Step 2** — Implement deterministic helpers (`growthYoY`, `growthQoQ`,
   `margin`, `revenueMix`, `lastNQuarters`, `lastNYears`). Add unit-level
   sanity checks via simple fixtures.
3. **Step 3** — Wire a real ingestion source for one pilot company end-to-end.
   Confirm we can produce a non-fake snapshot with source URLs.
4. **Step 4** — Build the P&L / Balance Sheet / Cash Flow tables with the
   5-quarter / 5-year toggle, reading from snapshots only.
5. **Step 5** — Add the KPI summary and peer comparison strip.
6. **Step 6** — Build the guidance tracker UI. Keep classification logic in
   helpers; UI only renders status chips and source links.
7. **Step 7** — Promote the ingestion job from `workflow_dispatch` to a
   scheduled run, once a quarter has been successfully ingested manually.

## Design Direction

- Clean, minimalist, institutional, source-backed.
- No clutter, no fake metrics, no decorative complexity.
- Use dashes (`—`) for missing values; never `0` or `N/A` as a substitute.
- Keep formulas in helpers, not inside UI components.
- Add short source labels and methodology notes next to each derived metric.

## Out of Scope for Dashboard 1

- Dashboard 2 and Dashboard 3.
- Paid/licensed data feeds.
- Social media / news sentiment.
- Stock price charting, technicals, or order-book data.
- Forecasting or any model-implied target prices.

## Step 2 — Source discovery and pilot ingestion

### Pilot peer group (testing only — NOT the final Dhamma universe)

| companyId | NSE   | BSE    | Sector |
| --------- | ----- | ------ | ------ |
| `tcs`     | TCS     | 532540 | IT Services |
| `infosys` | INFY    | 500209 | IT Services |
| `hcltech` | HCLTECH | 532281 | IT Services |
| `wipro`   | WIPRO   | 507685 | IT Services |

All four belong to the `indian-it-services-largecap` peer group. BSE/NSE
identifiers are publicly listed but must be reverified against the
exchange directory before production use.

### Sources attempted

| sourceId      | sourceType  | reliability | supports discovery | supports download |
| ------------- | ----------- | ----------- | ------------------ | ----------------- |
| `nse`         | exchange    | primary     | yes                | yes               |
| `bse`         | exchange    | primary     | yes                | yes               |
| `company_ir`  | company_ir  | secondary   | no (manual only)   | yes               |
| `manual`      | manual      | audit       | no                 | no                |

NSE and BSE are wired as live discovery adapters using their public
corporate-announcement endpoints. `company_ir` and `manual` are
registered but not auto-discoverable.

### What worked / what didn't (Step 2 run from this development sandbox)

| Source | Companies probed | Status                 |
| ------ | ---------------- | ---------------------- |
| NSE    | 4                | **blocked** (HTTP 403) |
| BSE    | 4                | **blocked** (HTTP 403) |

Sandbox egress traffic is filtered; NSE and BSE return 403 before any
data is returned. This is expected and is recorded honestly:
`filing-manifest.json` has zero rows and `meta.status: "error"`;
`source-health.json` shows 8 `blocked` probes with the verbatim error
message. **No fake data was generated.**

When the same script runs from a GitHub Actions runner (different
egress), BSE typically responds and NSE may still rate-limit. The
pipeline is designed so that whatever the live result is, snapshots
remain valid and explicit about success/failure.

### Financial rows produced

**None.** Step 2 was explicit about not forcing fragile extraction.
Discovery wires up; extraction (PDF / XBRL parsing into
`quarterly-financials.json` rows) stays Audit-status. Existing
financial snapshots remain structurally valid with `status: "empty"`
and notes indicating that filings appear in the manifest but are not
yet parsed.

### Snapshots in play after Step 2

| Snapshot                          | Step 2 row source              | Step 2 status |
| --------------------------------- | ------------------------------ | ------------- |
| `company-master.json`             | 4 pilot companies              | `ok`          |
| `filing-manifest.json`            | NSE + BSE discovery            | depends on egress |
| `source-health.json`              | NSE + BSE probes (× 4 cos)     | `ok` (8 rows) |
| `quarterly-financials.json`       | extraction pending             | `empty`       |
| `annual-financials.json`          | extraction pending             | `empty`       |
| `segment-revenue.json`            | extraction pending             | `empty`       |
| `balance-sheet.json`              | extraction pending             | `empty`       |
| `cash-flow.json`                  | extraction pending             | `empty`       |
| `guidance-commentary.json`        | Audit — not wired              | `empty`       |
| `guidance-actual-comparison.json` | derived — not wired            | `empty`       |

### Step 2 build sequence (delta from Step 1)

1. Add pilot company config (done).
2. Wire NSE + BSE discovery adapters that gracefully record errors (done).
3. Emit `filing-manifest.json` + `source-health.json` (done).
4. Add CLI flags `--company`, `--source`, `--max-filings`, `--discover-only` (done).
5. Add commit-back step to the GitHub Actions workflow (done).
6. **Next (Step 3):** verify the workflow's egress reaches BSE / NSE; if
   yes, capture the first real `filing-manifest` rows. If still
   blocked, decide between (a) a self-hosted runner with a residential
   IP, (b) an analyst-curated manual source list, or (c) a paid feed
   (out of current scope).

## Data-source strategy

Three paths exist for getting numbers into the dashboard. Only the first
is the production "source-of-truth"; the others are clearly labelled as
import-backed or audit-backed so the team always knows what they're
looking at.

### 1. Official filing source path (production, source-backed)

- Inputs: NSE corporate filings, BSE corporate filings, company IR pages.
- Discovery: `scripts/config/dhamma-sources.ts` (`nse`, `bse` adapters).
- Manifest: `src/data/snapshots/filing-manifest.json`.
- Status: discovery wired, extraction Audit.
- This is the only path whose rows are allowed to appear in the
  official financial snapshots (`quarterly-financials.json`,
  `annual-financials.json`, `balance-sheet.json`, `cash-flow.json`,
  `segment-revenue.json`).

### 2. Screener-compatible import path (prototyping, import-backed)

- Inputs: client-provided Screener-style `.xlsx` or `.csv` exports
  dropped into `data/manual/screener/`.
- Parser: `scripts/ingest/screener-export.ts`
  (`npm run ingest:screener`).
- Output: separate snapshot files
  (`screener-normalized-financials.json`,
  `screener-peer-comparison.json`,
  `screener-import-status.json`).
- Status: ready to consume files, but treated as **import-backed**, not
  source-backed. Imported rows are never merged into the official
  snapshots; UI must visually mark them when shown.
- This path lets the team prototype dashboard tables quickly when
  filing extraction is still unreliable, without compromising the
  source-of-truth guarantee.

### 3. Screener page scraping — deferred

- Automatic scraping of `screener.in` web pages is **not** done. It is
  deferred unless the client confirms permission or supplies licensed
  access.
- This is a deliberate restraint: Screener's terms restrict automated
  access, and even if permitted, scraped HTML is brittle relative to
  filed XBRL.

### 4. Guidance / commentary tracker

- Stays Audit. Inputs (concall transcripts, investor presentations)
  are also gated on client-provided or hand-curated sources for now.
- Will reuse the Screener-style "import folder" idea — e.g., a future
  `data/manual/transcripts/` — rather than scraping aggregators.

### Decision rules

- If a metric is in an official snapshot, it came from path 1 and is
  source-backed.
- If a metric is in a `screener-*` snapshot, it came from path 2 and
  is import-backed. UI must reflect this when surfaced.
- Path 3 (page scraping) does not produce snapshots in this codebase.
- Missing values stay `null`, render as `—`. Never zero, never fake.
