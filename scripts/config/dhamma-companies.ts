// Hand-curated list of companies and peer groups tracked by Dashboard 1.
// Edit this file to add or remove tickers; the ingestion script reads it.
//
// Step 2 pilot universe: four Indian IT services large-caps. The peer group
// is for pipeline testing only — it is NOT the final Dhamma Capital universe.
//
// BSE codes and NSE symbols below are publicly listed identifiers from the
// exchanges. Reverify against the current exchange directory before any
// production deploy; tickers can change with corporate actions.

import type {
  CompanyMaster,
  PeerGroup,
} from "../../src/data/types/dhammaDashboard";

export const COMPANIES: CompanyMaster[] = [
  {
    companyId: "tcs",
    displayName: "TCS",
    legalName: "Tata Consultancy Services Limited",
    nseSymbol: "TCS",
    bseCode: "532540",
    exchanges: [
      { exchange: "NSE", symbol: "TCS" },
      { exchange: "BSE", symbol: "532540" },
    ],
    country: "IN",
    sector: "Information Technology",
    industry: "IT Services & Consulting",
    peerGroupId: "indian-it-services-largecap",
    fiscalYearEndMonth: 3,
    reportingBasisDefault: "consolidated",
    irPageUrl: "https://www.tcs.com/investor-relations",
    status: "pilot",
    notes:
      "Pilot company for Step 2 source-discovery validation. Reverify BSE code 532540 and NSE symbol TCS before production.",
  },
  {
    companyId: "infosys",
    displayName: "Infosys",
    legalName: "Infosys Limited",
    nseSymbol: "INFY",
    bseCode: "500209",
    exchanges: [
      { exchange: "NSE", symbol: "INFY" },
      { exchange: "BSE", symbol: "500209" },
    ],
    country: "IN",
    sector: "Information Technology",
    industry: "IT Services & Consulting",
    peerGroupId: "indian-it-services-largecap",
    fiscalYearEndMonth: 3,
    reportingBasisDefault: "consolidated",
    irPageUrl: "https://www.infosys.com/investors/",
    status: "pilot",
    notes:
      "Pilot company. Reverify BSE code 500209 and NSE symbol INFY before production.",
  },
  {
    companyId: "hcltech",
    displayName: "HCLTech",
    legalName: "HCL Technologies Limited",
    nseSymbol: "HCLTECH",
    bseCode: "532281",
    exchanges: [
      { exchange: "NSE", symbol: "HCLTECH" },
      { exchange: "BSE", symbol: "532281" },
    ],
    country: "IN",
    sector: "Information Technology",
    industry: "IT Services & Consulting",
    peerGroupId: "indian-it-services-largecap",
    fiscalYearEndMonth: 3,
    reportingBasisDefault: "consolidated",
    irPageUrl: "https://www.hcltech.com/investors",
    status: "pilot",
    notes:
      "Pilot company. Reverify BSE code 532281 and NSE symbol HCLTECH before production.",
  },
  {
    companyId: "wipro",
    displayName: "Wipro",
    legalName: "Wipro Limited",
    nseSymbol: "WIPRO",
    bseCode: "507685",
    exchanges: [
      { exchange: "NSE", symbol: "WIPRO" },
      { exchange: "BSE", symbol: "507685" },
    ],
    country: "IN",
    sector: "Information Technology",
    industry: "IT Services & Consulting",
    peerGroupId: "indian-it-services-largecap",
    fiscalYearEndMonth: 3,
    reportingBasisDefault: "consolidated",
    irPageUrl: "https://www.wipro.com/investors/",
    status: "pilot",
    notes:
      "Pilot company. Reverify BSE code 507685 and NSE symbol WIPRO before production.",
  },
];

export const PEER_GROUPS: PeerGroup[] = [
  {
    peerGroupId: "indian-it-services-largecap",
    label: "Indian IT services — large cap",
    description:
      "Pilot peer set for pipeline testing. Replace with a real Dhamma Capital universe before production.",
    companyIds: ["tcs", "infosys", "hcltech", "wipro"],
    notes: "Pilot only.",
  },
];
