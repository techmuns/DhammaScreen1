# Dhamma Dashboard 1 — Metric Audit

Each row classifies a metric as **Build** (must ship in Dashboard 1),
**Audit** (include only if extraction is reliable for the pilot company; defer
otherwise), or **Drop** (out of scope for now).

Source classes referenced:

- **NSE/BSE filing** — XBRL or PDF quarterly financial results submitted to
  the exchanges under Reg 33 of SEBI LODR.
- **Investor presentation** — Quarterly investor PPT/PDF uploaded to the
  exchange or company IR page.
- **Annual report** — Standalone + consolidated financials and notes.
- **Concall transcript** — Earnings call transcript hosted by the company IR
  page or aggregators like research-bytes/BSE upload.

## P&L

| Metric              | Section | Source                                     | Formula / extraction logic                                                         | Cadence    | Entity level | Status | Notes / risk                                                                  |
| ------------------- | ------- | ------------------------------------------ | ---------------------------------------------------------------------------------- | ---------- | ------------ | ------ | ----------------------------------------------------------------------------- |
| Revenue             | P&L     | NSE/BSE quarterly filing                   | Reported "Revenue from operations" line                                            | Quarterly  | Company      | Build  | Consolidated preferred; fall back to standalone with a flag.                  |
| EBITDA              | P&L     | NSE/BSE quarterly filing                   | Operating profit before D&A and other income; recompute from line items if needed  | Quarterly  | Company      | Build  | Indian filings often don't print EBITDA directly — derive and label.          |
| EBITDA margin       | P&L     | Derived                                    | `EBITDA / Revenue`                                                                 | Quarterly  | Company      | Build  | Helper, not UI; render `—` when revenue ≤ 0.                                  |
| PAT                 | P&L     | NSE/BSE quarterly filing                   | "Profit for the period" attributable to owners                                     | Quarterly  | Company      | Build  | Use "attributable to owners" not minority interest.                           |
| PAT margin          | P&L     | Derived                                    | `PAT / Revenue`                                                                    | Quarterly  | Company      | Build  | Helper-only.                                                                  |
| EPS                 | P&L     | NSE/BSE quarterly filing                   | Reported basic EPS for the period                                                  | Quarterly  | Company      | Build  | Use only when printed in the filing. Do not derive across share-count changes. |
| Segment revenue mix | P&L     | NSE/BSE filing segment disclosure          | Per-segment revenue / total segment revenue                                        | Quarterly  | Company      | Build  | Schema present in filings, but segment naming varies — keep a normalize map.  |
| YoY growth          | P&L     | Derived                                    | `(current − prior year same quarter) / abs(prior year same quarter)`              | Quarterly  | Company      | Build  | Helper-only. Render `—` when prior is missing or zero.                        |
| QoQ growth          | P&L     | Derived                                    | `(current − prior quarter) / abs(prior quarter)`                                   | Quarterly  | Company      | Build  | Helper-only.                                                                  |
| 5-quarter trend     | P&L     | Derived                                    | Series of last 5 quarterly observations of a metric                                | Quarterly  | Company      | Build  | Used by sparkline / table; expects chronological order.                       |
| 5-year annual trend | P&L     | Annual report / Q4 filing                  | Series of last 5 fiscal-year observations of a metric                              | Annual     | Company      | Build  | Indian FY ends 31-Mar; annotate clearly.                                      |

## Balance Sheet

| Metric                | Section       | Source                  | Formula / extraction logic                                  | Cadence   | Entity level | Status | Notes / risk                                                              |
| --------------------- | ------------- | ----------------------- | ----------------------------------------------------------- | --------- | ------------ | ------ | ------------------------------------------------------------------------- |
| Total assets          | Balance Sheet | Quarterly filing or AR  | Reported "Total assets" line                                | Quarterly | Company      | Build  | Quarterly BS only present when company opts to disclose; many do.        |
| Total equity          | Balance Sheet | Quarterly filing or AR  | Reported "Total equity attributable to owners"              | Quarterly | Company      | Build  | Exclude minority interest where separately disclosed.                     |
| Borrowings (total)    | Balance Sheet | Quarterly filing or AR  | Long-term + short-term borrowings                           | Quarterly | Company      | Build  | Indian filings sometimes split current/non-current — sum both.            |
| Cash & equivalents    | Balance Sheet | Quarterly filing or AR  | Cash + bank balances + liquid investments where labelled    | Quarterly | Company      | Audit  | Definition varies; only mark Build once normalization rule is fixed.      |
| Net debt              | Balance Sheet | Derived                 | `Borrowings − Cash & equivalents`                            | Quarterly | Company      | Audit  | Depends on `Cash & equivalents` being normalized.                         |
| Working capital       | Balance Sheet | Quarterly filing or AR  | `Current assets − Current liabilities`                       | Quarterly | Company      | Audit  | Some companies don't split current/non-current quarterly.                |

## Cash Flow (condensed)

| Metric                  | Section   | Source             | Formula / extraction logic                                  | Cadence       | Entity level | Status | Notes / risk                                                          |
| ----------------------- | --------- | ------------------ | ----------------------------------------------------------- | ------------- | ------------ | ------ | --------------------------------------------------------------------- |
| CFO                     | Cash Flow | Annual report / H1 | Reported "Net cash from operating activities"               | Half-yearly+  | Company      | Build  | Quarterly CFS rarely filed in India; expect H1 + FY only.            |
| Working capital changes | Cash Flow | Annual report / H1 | Sum of WC line items in the CFS reconciliation              | Half-yearly+  | Company      | Build  | Line-item naming varies; keep an alias map.                          |
| CFI                     | Cash Flow | Annual report / H1 | Reported "Net cash from investing activities"               | Half-yearly+  | Company      | Build  | Same cadence caveat.                                                  |
| CFF                     | Cash Flow | Annual report / H1 | Reported "Net cash from financing activities"               | Half-yearly+  | Company      | Build  | Same cadence caveat.                                                  |

> Cadence caveat: SEBI LODR does not mandate quarterly cash-flow statements
> for most companies, only half-yearly. Dashboard 1 will show CFO/WC/CFI/CFF
> for the periods companies actually disclose them, and dashes elsewhere.

## Peer Comparison

| Metric                       | Section          | Source                       | Formula / extraction logic                                       | Cadence   | Entity level | Status | Notes / risk                                                       |
| ---------------------------- | ---------------- | ---------------------------- | ---------------------------------------------------------------- | --------- | ------------ | ------ | ------------------------------------------------------------------ |
| Peer comparison — common KPIs| KPI / Peers      | Same source class as company | Reuse Build metrics for peers; rank within `PeerGroup`           | Quarterly | PeerGroup    | Build  | Only use peers where the same source class is available.           |

## Guidance / Lie Detector

| Metric                                | Section       | Source                  | Formula / extraction logic                                                                  | Cadence   | Entity level | Status | Notes / risk                                                                            |
| ------------------------------------- | ------------- | ----------------------- | ------------------------------------------------------------------------------------------- | --------- | ------------ | ------ | --------------------------------------------------------------------------------------- |
| Management commentary extraction      | Lie Detector  | Concall transcript      | Sentence-level extraction tagged to a metric and a target period                            | Quarterly | Company      | Audit  | Transcript availability varies. Extraction is fragile; manual review required initially.|
| Transcript-based guidance promises    | Lie Detector  | Concall transcript      | Subset of commentary that is forward-looking and quantifiable                               | Quarterly | Company      | Audit  | Must be tied to a measurable Build metric to be useful.                                  |
| Actual versus prior commentary class. | Lie Detector  | Derived                 | Compare actual Build-metric value against the prior commentary's target → Met/Missed/Partial/Unverifiable | Quarterly | Company      | Audit  | Define thresholds in `guidanceAccuracyStatus`. Default thresholds: ±5% Met, ±15% Partial.|
| Segment-level metrics (long tail)     | P&L           | Filings + presentations | Per-segment EBITDA, EBIT, capital employed where disclosed                                  | Quarterly | Company      | Audit  | Segment formatting varies too much across companies for v1.                              |
| Any metric needing fragile PDF table  | Various       | PDF tables              | Position-based extraction                                                                   | Varies    | Company      | Audit  | Only promote to Build once a robust extractor exists.                                    |

## Dropped (out of scope for Dashboard 1)

| Metric / area                                | Reason for Drop                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Bloomberg / Refinitiv / Capitaline pulls     | Paid/licensed data.                                                            |
| Twitter/X, Reddit, news sentiment            | Not source-backed in the way Dhamma needs.                                     |
| Brokerage estimates / consensus              | Licensed; also outside the "filings + commentary" frame.                       |
| Price/volume technicals                      | Out of scope for Dashboard 1.                                                  |
| DCF / forecasting outputs                    | Not in the brief; risks producing fake-looking metrics.                        |
| Dashboard 2 / Dashboard 3 items              | Explicitly out of scope.                                                       |

## Source Coverage Summary

| Source class            | Coverage today               | Notes                                                                          |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| NSE/BSE quarterly filing | Available for all listed    | Stable structure for P&L; segment block standard but naming inconsistent.      |
| Investor presentation   | Most large-caps              | Useful for segment colour and management-stated growth drivers.                |
| Annual report           | Universal, lagged 2–4 months | Source of truth for full BS + CFS.                                             |
| Concall transcript      | Most large-/mid-caps         | Quality varies; some hosted by company, some by aggregators. Best-effort only. |

## Step 2 — Source discovery, pilot run

### Pilot universe

`tcs`, `infosys`, `hcltech`, `wipro` — peer group
`indian-it-services-largecap`. Pipeline-test universe only.

### Source registry attempted

| sourceId      | supports discovery | reliability |
| ------------- | ------------------ | ----------- |
| `nse`         | yes                | primary     |
| `bse`         | yes                | primary     |
| `company_ir`  | no (manual only)   | secondary   |
| `manual`      | no                 | audit       |

### Last Step 2 run result (this development sandbox)

- 4 companies probed × 2 discovery sources = 8 probes.
- 8/8 `blocked` with HTTP 403 (sandbox egress filter).
- 0 filings discovered, 0 rows produced.
- No fake data, no fake zeroes. Every error is recorded verbatim in
  `filing-manifest.json` `meta.errors` and per-row in
  `source-health.json`.

### What stays Audit

All Audit items from the Step 1 table remain Audit. Specifically:

- Filing → financial row extraction. Discovery is wired; parsing PDF /
  XBRL into `quarterly-financials.json` is not, by design.
- Segment-level metrics (long tail).
- All guidance/transcript items.

### What is now Build (in terms of plumbing, not financial data)

- `filing-manifest.json` (discovery layer).
- `source-health.json` (sourceability monitoring).
- `company-master.json` (4 pilot companies).
- Pipeline-level CLI: `--company`, `--source`, `--max-filings`,
  `--discover-only`.

These are plumbing — they unblock everything downstream, but they do
not by themselves produce any of the user-facing Build metrics in
the tables above. Those still require a working extraction layer.

## Data-source provenance per metric

Every metric in this audit can in principle be sourced two ways:

| Path                | Snapshot family                | Trust level         | Status         |
| ------------------- | ------------------------------ | ------------------- | -------------- |
| Official filings    | `quarterly-financials`, …      | source-backed       | Discovery wired, extraction Audit |
| Screener export     | `screener-normalized-financials`, `screener-peer-comparison` | import-backed | Parser scaffold ready, files not yet provided |
| Screener scraping   | (none)                         | not allowed yet     | Deferred — needs client permission |

**Decision rule:** A metric cell shown on the dashboard must declare
its provenance. Official-path cells inherit the existing Build/Audit
status from the tables above. Screener-import cells get a separate
visual indicator and never overwrite an official cell. Until the
client confirms Screener access or provides exports, the import path
stays cold (empty snapshots, no UI surface).

## Manual import expectations

If the client wants Screener-backed prototyping data, files should be
placed in `data/manual/screener/` with a stable naming convention.
Recommended: `<companyId>.xlsx` (e.g. `tcs.xlsx`, `infosys.xlsx`). The
parser will:

- Detect sheets named `Quarters`, `Profit & Loss`, `Balance Sheet`,
  `Cash Flow`, `Ratios`, `Peer Comparison` (case-insensitive).
- Produce one normalized row per (metric × period) cell.
- Record `sourceFile`, `sourceSheet`, `confidence`, `importedAt` for
  every row.
- Use `null` for any unparseable cell. Never fabricate.

If no files are present, the parser writes empty snapshots with
`status: "empty"` and exits cleanly.
