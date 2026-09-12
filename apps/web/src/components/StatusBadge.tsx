import {
  DISPUTE_STATUS_LABEL,
  ISSUE_STATUS_LABEL,
  REPORT_STATUS_LABEL,
  SETTLEMENT_STATUS_LABEL,
  SEVERITY_LABEL,
  ACCOUNT_STATUS_LABEL,
  type DisputeStatus,
  type IssueStatus,
  type ReportStatus,
  type SettlementStatus,
  type Severity,
  type AccountStatus,
  type ReviewState,
  type LetterStatus,
} from '@valeur/shared';
import { Badge } from './ui';

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const tone = { UPLOADED: 'neutral', PARSING: 'blue', PARSED: 'green', REVIEW_REQUIRED: 'amber', OCR_REQUIRED: 'amber', FAILED: 'red' } as const;
  return <Badge tone={tone[status]}>{REPORT_STATUS_LABEL[status]}</Badge>;
}

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const tone = { OPEN: 'amber', CONFIRMED: 'blue', DISPUTED: 'purple', RESOLVED: 'green', NOT_SUPPORTED: 'neutral' } as const;
  return <Badge tone={tone[status]}>{ISSUE_STATUS_LABEL[status]}</Badge>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone = { HIGH: 'red', MEDIUM: 'amber', LOW: 'neutral' } as const;
  return <Badge tone={tone[severity]}>{SEVERITY_LABEL[severity]} priority</Badge>;
}

export function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  const tone = { DRAFT: 'neutral', READY: 'blue', SENT: 'purple', INVESTIGATING: 'purple', RESPONSE_RECEIVED: 'green', ESCALATED: 'amber', CLOSED: 'neutral' } as const;
  return <Badge tone={tone[status]}>{DISPUTE_STATUS_LABEL[status]}</Badge>;
}

export function SettlementStatusBadge({ status }: { status: SettlementStatus }) {
  const tone = { NOT_STARTED: 'neutral', CONTACTED: 'blue', OFFER_RECEIVED: 'amber', ACCEPTED: 'purple', PAID: 'green', DECLINED: 'neutral' } as const;
  return <Badge tone={tone[status]}>{SETTLEMENT_STATUS_LABEL[status]}</Badge>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const tone = { OPEN: 'green', CLOSED: 'neutral', PAID: 'green', LATE: 'amber', PAST_DUE: 'amber', COLLECTION: 'red', CHARGE_OFF: 'red', UNKNOWN: 'neutral' } as const;
  return <Badge tone={tone[status]}>{ACCOUNT_STATUS_LABEL[status]}</Badge>;
}

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  const map = { NEEDS_REVIEW: ['amber', 'Needs review'], REVIEWED: ['green', 'Reviewed'], CORRECTED: ['blue', 'Corrected'] } as const;
  return <Badge tone={map[state][0]}>{map[state][1]}</Badge>;
}

export function LetterStatusBadge({ status }: { status: LetterStatus }) {
  const tone = { DRAFT: 'neutral', READY: 'blue', SENT: 'green', ARCHIVED: 'neutral' } as const;
  return <Badge tone={tone[status]}>{status === 'READY' ? 'Ready to send' : status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export function BureauBadge({ bureau }: { bureau: 'EQUIFAX' | 'TRANSUNION' | null | undefined }) {
  if (!bureau) return <Badge tone="neutral">Manual</Badge>;
  return <Badge tone={bureau === 'EQUIFAX' ? 'red' : 'blue'}>{bureau === 'EQUIFAX' ? 'Equifax' : 'TransUnion'}</Badge>;
}
