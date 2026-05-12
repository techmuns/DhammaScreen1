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
