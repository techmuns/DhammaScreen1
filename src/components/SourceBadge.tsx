import {
  provenanceLabel,
  type DataProvenance,
} from "../data/helpers/dhammaFinancials";

interface SourceBadgeProps {
  provenance: DataProvenance;
  label?: string;
}

const PROVENANCE_CLASS: Record<DataProvenance, string> = {
  "official-filing": "source-badge source-badge--official",
  "screener-fetch": "source-badge source-badge--screener-fetch",
  "screener-import": "source-badge source-badge--screener-import",
  audit: "source-badge source-badge--audit",
  pending: "source-badge source-badge--pending",
};

export function SourceBadge({ provenance, label }: SourceBadgeProps) {
  return (
    <span className={PROVENANCE_CLASS[provenance]}>
      {label ?? provenanceLabel(provenance)}
    </span>
  );
}
