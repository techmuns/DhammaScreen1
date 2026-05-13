import {
  provenanceLabel,
  type DataProvenance,
} from "../data/helpers/dhammaFinancials";

interface SourceBadgeProps {
  provenance: DataProvenance;
  label?: string;
}

const PROVENANCE_CLASS: Record<DataProvenance, string> = {
  "official-filing": "badge badge--official",
  "screener-import": "badge badge--screener",
  audit: "badge badge--audit",
  pending: "badge badge--pending",
};

export function SourceBadge({ provenance, label }: SourceBadgeProps) {
  return (
    <span className={PROVENANCE_CLASS[provenance]}>
      {label ?? provenanceLabel(provenance)}
    </span>
  );
}
