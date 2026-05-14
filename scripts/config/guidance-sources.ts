// Guidance source registry.
//
// Lists the candidate sources we can probe for management commentary
// documents (concall transcripts, investor presentations, earnings
// releases). The discovery script (`scripts/ingest/guidance-sources.ts`)
// reads this registry and tries each enabled source per company.
//
// This file does NOT carry per-company slugs/URLs — those still come
// from `dhamma-companies.ts` plus simple heuristics inside the
// discovery script. The registry only describes the SOURCES and how to
// reach them at a high level.
//
// Hard rules (matches the rest of the project):
//   - No login / credentials / CAPTCHA bypass anywhere downstream.
//   - Discovery only — never fabricate document URLs.
//   - The script must record blocked / not-found / error statuses
//     honestly so we can decide which source is scalable.

export type GuidanceSourceId =
  | "tijori"
  | "screener"
  | "nse"
  | "bse"
  | "company_ir";

export type GuidanceSourceClass =
  | "aggregator" // third-party that already groups documents per company
  | "exchange" // primary regulatory filing portal
  | "company_ir"; // company's own investor relations page

export interface GuidanceSource {
  sourceId: GuidanceSourceId;
  displayName: string;
  sourceClass: GuidanceSourceClass;
  baseUrl: string | null;
  notes: string;
  // Whether the source is enabled by default in a run with no --source
  // filter. We default to a SAFE subset (no Playwright-heavy paths) so a
  // scheduled run never hangs on JS-rendered SPAs without explicit opt-in.
  enabledByDefault: boolean;
  // Whether the source is expected to be reachable via plain HTTP
  // (cheerio-only). If false, the discovery script will record that
  // headless rendering is likely required and not attempt parsing.
  staticHtmlExpected: boolean;
  // Per-source documentation: where to look for transcripts / IR docs.
  // Used in console output and notes; never as runtime configuration.
  documentationUrl: string | null;
}

export const GUIDANCE_SOURCES: ReadonlyArray<GuidanceSource> = [
  {
    sourceId: "tijori",
    displayName: "Tijori Finance",
    sourceClass: "aggregator",
    baseUrl: "https://www.tijorifinance.com/",
    notes:
      "Aggregator that surfaces concall transcripts and investor presentations " +
      "in a per-company tab. Probe a few canonical company-page URL patterns; " +
      "if reachable, look for transcript / presentation anchors. May be " +
      "JS-rendered — record SPA shell detection separately.",
    enabledByDefault: true,
    staticHtmlExpected: false,
    documentationUrl: null,
  },
  {
    sourceId: "screener",
    displayName: "Screener concalls / documents tab",
    sourceClass: "aggregator",
    baseUrl: "https://www.screener.in/",
    notes:
      "The /documents/ tab on a Screener company page lists annual reports, " +
      "concall transcripts and credit-rating PDFs. Static HTML parses cleanly " +
      "with cheerio, so this is the cheapest scalable source to wire next.",
    enabledByDefault: true,
    staticHtmlExpected: true,
    documentationUrl: null,
  },
  {
    sourceId: "nse",
    displayName: "NSE corporate announcements",
    sourceClass: "exchange",
    baseUrl: "https://www.nseindia.com/",
    notes:
      "Primary filings, including earnings releases. NSE blocks naive HTTP " +
      "with a cookie / referrer wall — historically requires either a real " +
      "browser or a known-good session cookie. Mark as discovery-only.",
    enabledByDefault: false,
    staticHtmlExpected: false,
    documentationUrl: null,
  },
  {
    sourceId: "bse",
    displayName: "BSE corporate announcements",
    sourceClass: "exchange",
    baseUrl: "https://www.bseindia.com/",
    notes:
      "Mirrors of NSE filings. Often more forgiving over HTTP than NSE, but " +
      "the filings index is paginated and CSRF-guarded. Discovery-only.",
    enabledByDefault: false,
    staticHtmlExpected: false,
    documentationUrl: null,
  },
  {
    sourceId: "company_ir",
    displayName: "Company IR page (fallback)",
    sourceClass: "company_ir",
    baseUrl: null,
    notes:
      "Per-company URL lives on the company-master row (`irPageUrl`). Layout " +
      "varies wildly between companies, so this source is a discovery-only " +
      "fallback for when no aggregator carries the document we need.",
    enabledByDefault: false,
    staticHtmlExpected: false,
    documentationUrl: null,
  },
];

export function sourceById(
  id: GuidanceSourceId
): GuidanceSource | null {
  return GUIDANCE_SOURCES.find((s) => s.sourceId === id) ?? null;
}
