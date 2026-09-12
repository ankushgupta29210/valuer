// Human-readable labels for enum values, used by the UI and letters.
import type {
  AccountStatus, AccountType, BillCategory, DisputeStatus, IssueStatus,
  ReportStatus, SettlementStatus, Severity,
} from './enums.js';

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  UPLOADED: 'Uploaded',
  PARSING: 'Reading report…',
  PARSED: 'Ready',
  REVIEW_REQUIRED: 'Needs your review',
  OCR_REQUIRED: 'Image-only PDF — text could not be read',
  FAILED: 'Could not process',
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  CREDIT_CARD: 'Credit card',
  LINE_OF_CREDIT: 'Line of credit',
  LOAN: 'Loan',
  AUTO_LOAN: 'Auto loan',
  STUDENT_LOAN: 'Student loan',
  MORTGAGE: 'Mortgage',
  COLLECTION: 'Collection',
  TELECOM: 'Phone / internet',
  UTILITY: 'Utility',
  OTHER: 'Other',
};

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  PAID: 'Paid',
  LATE: 'Late',
  PAST_DUE: 'Past due',
  COLLECTION: 'Collection',
  CHARGE_OFF: 'Charge-off',
  UNKNOWN: 'Unknown',
};

export const BILL_CATEGORY_LABEL: Record<BillCategory, string> = {
  CREDIT_CARD: 'Credit card',
  LOAN: 'Loan',
  RENT_MORTGAGE: 'Rent / mortgage',
  UTILITY: 'Utility',
  PHONE_INTERNET: 'Phone / internet',
  INSURANCE: 'Insurance',
  SUBSCRIPTION: 'Subscription',
  OTHER: 'Other',
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: 'Open',
  CONFIRMED: 'Confirmed',
  DISPUTED: 'In dispute',
  RESOLVED: 'Resolved',
  NOT_SUPPORTED: 'Not supported',
};

export const ISSUE_STATUS_MEANING: Record<IssueStatus, string> = {
  OPEN: 'Valeur detected a pattern or you added a concern.',
  CONFIRMED: 'You or your advisor confirmed that this deserves review.',
  DISPUTED: 'Included in a dispute package you approved.',
  RESOLVED: 'Recorded as corrected or otherwise resolved.',
  NOT_SUPPORTED: 'The available evidence does not support treating this as an error.',
};

export const SEVERITY_LABEL: Record<Severity, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready to send',
  SENT: 'Sent',
  INVESTIGATING: 'Under investigation',
  RESPONSE_RECEIVED: 'Response received',
  ESCALATED: 'Escalated',
  CLOSED: 'Closed',
};

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  NOT_STARTED: 'Not started',
  CONTACTED: 'Contacted',
  OFFER_RECEIVED: 'Offer received',
  ACCEPTED: 'Accepted',
  PAID: 'Paid',
  DECLINED: 'Declined',
};

export const SETTLEMENT_STATUS_MEANING: Record<SettlementStatus, string> = {
  NOT_STARTED: 'A record exists but no contact is recorded yet.',
  CONTACTED: 'You recorded that the creditor or collector was contacted.',
  OFFER_RECEIVED: 'A written or verbal offer was recorded.',
  ACCEPTED: 'You accepted written terms.',
  PAID: 'You recorded that payment was made.',
  DECLINED: 'The offer or plan was declined or not used.',
};
