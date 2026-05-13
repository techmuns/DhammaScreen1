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

Four paths exist for getting numbers into the dashboard. The dashboard
UI itself **never** reaches out to the internet — it always reads
cached snapshots. Every refresh is driven by an ingestion script,
either locally or via GitHub Actions.

### 1. Automated Screener fetch (primary fast path, cached)

- Inputs: Screener public company pages
  (`https://www.screener.in/company/<slug>/`), fetched server-side.
- Fetcher: `scripts/ingest/screener-fetch.ts`
  (`npm run ingest:screener:fetch`).
- Cadence: scheduled refresh via GitHub Actions, or manual trigger.
- Output: same snapshot files as the manual import path
  (`screener-normalized-financials.json`,
  `screener-peer-comparison.json`) but rows are tagged
  `sourceMethod: "fetch"` and `sourceLabel: "Screener fetch · <url>"`.
  Status lives in its own snapshot: `screener-fetch-status.json`.
- Provenance: rows are **fetch-backed**. Treat as a high-volume
  prototyping source — quicker to refresh than manual exports, but
  still secondary to official filings.
- Hard rule: the dashboard UI does **not** call Screener directly on
  company selection. It only reads the cached snapshots. Refreshes
  happen out-of-band.

### 2. Official filing source path (source-of-truth)

- Inputs: NSE corporate filings, BSE corporate filings, company IR pages.
- Discovery: `scripts/config/dhamma-sources.ts` (`nse`, `bse` adapters).
- Manifest: `src/data/snapshots/filing-manifest.json`.
- Status: discovery wired, extraction Audit.
- This remains the only path whose rows are allowed in the official
  financial snapshots (`quarterly-financials.json`,
  `annual-financials.json`, `balance-sheet.json`, `cash-flow.json`,
  `segment-revenue.json`). Used to verify the Screener fetch path,
  and ultimately to replace it for production reporting.

### 3. Screener-compatible manual import path (fallback)

- Inputs: client-provided Screener-style `.xlsx` or `.csv` exports
  dropped into `data/manual/screener/`.
- Parser: `scripts/ingest/screener-export.ts`
  (`npm run ingest:screener`).
- Output: same shared snapshots as the fetch path, but rows are tagged
  `sourceMethod: "import"`. Status lives in
  `screener-import-status.json`.
- Use when: the automated fetcher is blocked, a particular company is
  not in the fetch universe, or an analyst wants to override a fetched
  value with a hand-curated export.
- Co-existence rule: manual-import rows and fetch rows live in the
  same snapshot but never overwrite each other. Each ingestion script
  preserves the other method's rows on write.

### 4. Guidance / commentary tracker

- Stays Audit. Inputs (concall transcripts, investor presentations)
  are also gated on client-provided or hand-curated sources for now.

### UI rule

> The dashboard never fetches Screener (or any source) live. Every
> value rendered comes from a snapshot in `src/data/snapshots/`. Refresh
> is the responsibility of `npm run ingest:*` and the GitHub Actions
> workflow.

### Provenance labels

Every cell on the dashboard inherits one of four provenance labels:

| Label             | Means                                                 |
| ----------------- | ----------------------------------------------------- |
| Official filing   | Came from NSE/BSE/AR extraction (source-of-truth)     |
| Screener fetch    | Came from the automated `npm run ingest:screener:fetch` |
| Screener import   | Came from a manual file in `data/manual/screener/`    |
| Pending           | No data yet from any path                             |
| Audit             | Guidance / commentary only                            |

### Resolution precedence

When more than one source has a value for the same (company, metric,
period), the dashboard picks in this order:

1. Official filing
2. Screener fetch
3. Screener import
4. Pending (renders as `—`)

### Decision rules

- If a metric is in an official snapshot, it is source-backed.
- If a metric is in a `screener-*` snapshot, the row's `sourceMethod`
  field tells the UI whether to badge it as "Screener fetch" or
  "Screener import".
- Missing values stay `null`, render as `—`. Never zero, never fake.

## IT peer universe from Screener PDFs

The peer-benchmark group `it-services-broad` (used by every KPI card on
Dashboard 1) is built from the Screener IT sector listing the client
shared. The universe is split into two tiers that are managed in
`scripts/config/dhamma-companies.ts`:

### Active fetch universe — 20 companies

`COMPANIES[]` contains 20 active rows, all tagged
`peerGroupId: "it-services-broad"` and `fetchEnabled: true`. These are
the names that:

- Appear in `company-master.json` after `npm run ingest:dhamma`.
- Are passed to the Screener fetcher each time the GitHub Action runs.
- Show up in the company selector and in every KPI peer-benchmark card.

The current active group:

| # | Company | NSE ticker | Notes |
| - | ------- | ---------- | ----- |
| 1 | Tata Consultancy Services | TCS | Verified end-to-end (production data) |
| 2 | Infosys | INFY | Verified end-to-end (production data) |
| 3 | HCL Technologies | HCLTECH | Verified end-to-end (production data) |
| 4 | Wipro | WIPRO | Verified end-to-end (production data) |
| 5 | Tech Mahindra | TECHM | Slug inferred from NSE symbol. Verify after first fetch. |
| 6 | LTIMindtree | LTIM | Slug inferred from NSE symbol. Verify after first fetch. |
| 7 | Oracle Financial Services | OFSS | Slug inferred from NSE symbol. Verify after first fetch. |
| 8 | Persistent Systems | PERSISTENT | Slug inferred from NSE symbol. Verify after first fetch. |
| 9 | Coforge | COFORGE | Slug inferred from NSE symbol. Verify after first fetch. |
| 10 | Mphasis | MPHASIS | Slug inferred from NSE symbol. Verify after first fetch. |
| 11 | L&T Technology Services | LTTS | Slug inferred from NSE symbol. Verify after first fetch. |
| 12 | Hexaware Technologies | HEXT | Slug inferred from NSE symbol. Verify after first fetch. |
| 13 | Tata Technologies | TATATECH | Slug inferred from NSE symbol. Verify after first fetch. |
| 14 | Tata Elxsi | TATAELXSI | Slug inferred from NSE symbol. Verify after first fetch. |
| 15 | KPIT Technologies | KPITTECH | Slug inferred from NSE symbol. Verify after first fetch. |
| 16 | Zensar Technologies | ZENSARTECH | Slug inferred from NSE symbol. Verify after first fetch. |
| 17 | Intellect Design Arena | INTELLECT | Slug inferred from NSE symbol. Verify after first fetch. |
| 18 | Cyient | CYIENT | Slug inferred from NSE symbol. Verify after first fetch. |
| 19 | Birlasoft | BSOFT | Slug inferred from NSE symbol. Verify after first fetch. |
| 20 | Sonata Software | SONATSOFTW | Slug inferred from NSE symbol. Verify after first fetch. |

Rows 1–4 are the original pilot peers and have been verified against
both the NSE/BSE filings and Screener pages. Rows 5–20 have their
Screener slug derived from the NSE symbol (lower-cased), matching the
heuristic the fetcher already uses; the first GitHub Action run after
this commit is expected to confirm every slug or surface a 404, which
will be tracked in `screener-fetch-status.json` and corrected
case-by-case via `sourceUrlOverride` in `dhamma-companies.ts`.

### Inactive future candidates — 15 companies

`INACTIVE_IT_CANDIDATES[]` is a separate metadata-only list. It holds
the smaller and / or less-liquid Indian IT names from the second page
of the Screener IT sector listing. These entries:

- Are **not** members of `COMPANIES[]`.
- Are **not** included in any peer group.
- Are **never** sent to the Screener fetcher.
- Carry no rows in any snapshot.

They exist solely as a typed, source-labelled record of what we are
deliberately leaving outside the active fetch universe today. The
current candidates:

`NPST`, `PROTEAN`, `CEINSYS`, `NUCLEUS`, `SAKSOFT`, `DLINKINDIA`,
`ACCELYA`, `INFOBEAN`, `RAMCOSYS`, `EXPLEOSOL`, `QUICKHEAL`, `NINtec`
(no ticker yet), `KSOLVES`, `SUBEXLTD`, `ONWARDTEC`.

### Why the cap

We intentionally constrain the fetch universe so that:

- Each KPI benchmark card renders a peer strip with ≤20 entries —
  large enough to be statistically meaningful, small enough to scan in
  one glance.
- Snapshot JSON bundled into the SPA stays well under the Cloudflare
  Workers static-asset limit, even when every active company has a
  full quarter + annual history.
- Each scheduled fetch on GitHub Actions finishes in a single run
  without partial-result merging gymnastics.

Promoting a candidate from `INACTIVE_IT_CANDIDATES[]` to `COMPANIES[]`
is a one-line move plus a doc update; demoting back out is symmetric.

### Source labelling

Every row produced by the Screener fetcher — whether for an original
pilot peer or one of the newly added 16 — is written to
`screener-normalized-financials.json` with
`sourceMethod: "fetch"` and renders on the dashboard with the
**Screener fetch** badge. The manual-import path (`sourceMethod:
"import"`) remains available as the analyst fallback for any company
the fetcher cannot reach.
