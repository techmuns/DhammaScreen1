// Hand-curated list of companies and peer groups tracked by Dashboard 1.
// Edit this file to add or remove tickers; the ingestion script reads it.
//
// Keep the list short while the source pipeline is still maturing — every
// entry expands the surface area we have to verify each quarter.

import type {
  CompanyMaster,
  PeerGroup,
} from "../../src/data/types/dhammaDashboard";

export const COMPANIES: CompanyMaster[] = [
  // Example shape, intentionally left commented out so this file ships with
  // zero rows until the source pipeline is wired up:
  //
  // {
  //   companyId: "hdfcbank",
  //   legalName: "HDFC Bank Limited",
  //   shortName: "HDFC Bank",
  //   nseSymbol: "HDFCBANK",
  //   bseCode: "500180",
  //   sector: "Financials",
  //   industry: "Banks",
  //   fiscalYearEndMonth: 3,
  //   reportingBasisDefault: "consolidated",
  //   irPageUrl: "https://www.hdfcbank.com/personal/about-us/investor-relations",
  //   notes: null,
  // },
];

export const PEER_GROUPS: PeerGroup[] = [
  // Example shape, intentionally left commented out:
  //
  // {
  //   peerGroupId: "indian-large-private-banks",
  //   label: "Indian large private banks",
  //   description: "Top private-sector banks by total assets.",
  //   companyIds: ["hdfcbank", "icicibank", "axisbank", "kotakbank"],
  //   notes: null,
  // },
];
