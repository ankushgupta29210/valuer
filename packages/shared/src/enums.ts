// Enumerations shared by the web app and Cloud Functions. Values are stored
// verbatim in Firestore, so never rename an existing member without a
// migration.

export const BUREAUS = ['EQUIFAX', 'TRANSUNION'] as const;
export type Bureau = (typeof BUREAUS)[number];

export const ROLES = ['client', 'advisor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const REPORT_STATUSES = [
  'UPLOADED',
  'PARSING',
  'PARSED',
  'REVIEW_REQUIRED',
  'OCR_REQUIRED',
  'FAILED',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const ACCOUNT_TYPES = [
  'CREDIT_CARD',
  'LINE_OF_CREDIT',
  'LOAN',
  'AUTO_LOAN',
  'STUDENT_LOAN',
  'MORTGAGE',
  'COLLECTION',
  'TELECOM',
  'UTILITY',
  'OTHER',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = [
  'OPEN',
  'CLOSED',
  'PAID',
  'LATE',
  'PAST_DUE',
  'COLLECTION',
  'CHARGE_OFF',
  'UNKNOWN',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_SOURCES = ['MANUAL', 'EXTRACTED'] as const;
export type AccountSource = (typeof ACCOUNT_SOURCES)[number];

export const REVIEW_STATES = ['NEEDS_REVIEW', 'REVIEWED', 'CORRECTED'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const BILL_CATEGORIES = [
  'CREDIT_CARD',
  'LOAN',
  'RENT_MORTGAGE',
  'UTILITY',
  'PHONE_INTERNET',
  'INSURANCE',
  'SUBSCRIPTION',
  'OTHER',
] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];

export const BILL_STATUSES = ['ACTIVE', 'PAUSED', 'CLOSED'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const RULE_CODES = [
  'UNKNOWN_ACCOUNT',
  'COLLECTION_STATUS',
  'CHARGEOFF_STATUS',
  'LATE_PAYMENT_INDICATOR',
  'PAST_DUE_EXCEEDS_BALANCE',
  'DUPLICATE_TRADELINE',
  'INCOMPLETE_TRADELINE',
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_STATUSES = [
  'OPEN',
  'CONFIRMED',
  'DISPUTED',
  'RESOLVED',
  'NOT_SUPPORTED',
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_ORIGINS = ['RULE', 'CLIENT', 'STAFF'] as const;
export type IssueOrigin = (typeof ISSUE_ORIGINS)[number];

// Transitions allowed by updateIssueStatus. DISPUTED is set only by
// createDispute/approveDispute, never directly.
export const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  OPEN: ['CONFIRMED', 'NOT_SUPPORTED', 'RESOLVED'],
  CONFIRMED: ['OPEN', 'NOT_SUPPORTED', 'RESOLVED'],
  DISPUTED: ['RESOLVED', 'OPEN'],
  RESOLVED: ['OPEN'],
  NOT_SUPPORTED: ['OPEN'],
};

export const DISPUTE_STATUSES = [
  'DRAFT',
  'READY',
  'SENT',
  'INVESTIGATING',
  'RESPONSE_RECEIVED',
  'ESCALATED',
  'CLOSED',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

// Manual transitions permitted through updateDisputeStatus. DRAFT → READY is
// only reachable via approveDispute.
export const DISPUTE_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  DRAFT: [],
  READY: ['SENT', 'DRAFT'],
  SENT: ['INVESTIGATING', 'RESPONSE_RECEIVED', 'ESCALATED', 'CLOSED'],
  INVESTIGATING: ['RESPONSE_RECEIVED', 'ESCALATED', 'CLOSED'],
  RESPONSE_RECEIVED: ['ESCALATED', 'CLOSED'],
  ESCALATED: ['RESPONSE_RECEIVED', 'CLOSED'],
  CLOSED: [],
};

export const DELIVERY_METHODS = ['ONLINE', 'MAIL', 'FAX', 'OTHER'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const REQUESTED_ACTIONS = ['INVESTIGATE', 'CORRECT', 'UPDATE', 'DELETE_IF_UNVERIFIED'] as const;
export type RequestedAction = (typeof REQUESTED_ACTIONS)[number];

export const SETTLEMENT_STATUSES = [
  'NOT_STARTED',
  'CONTACTED',
  'OFFER_RECEIVED',
  'ACCEPTED',
  'PAID',
  'DECLINED',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  NOT_STARTED: ['CONTACTED', 'DECLINED'],
  CONTACTED: ['OFFER_RECEIVED', 'DECLINED', 'NOT_STARTED'],
  OFFER_RECEIVED: ['ACCEPTED', 'DECLINED', 'CONTACTED'],
  ACCEPTED: ['PAID', 'DECLINED'],
  PAID: [],
  DECLINED: ['NOT_STARTED'],
};

export const CONTACT_METHODS = ['PHONE', 'EMAIL', 'MAIL', 'IN_PERSON', 'OTHER'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const LETTER_TYPES = ['DISPUTE', 'SETTLEMENT_REQUEST'] as const;
export type LetterType = (typeof LETTER_TYPES)[number];

export const LETTER_STATUSES = ['DRAFT', 'READY', 'SENT', 'ARCHIVED'] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const CONTACT_KINDS = ['BUREAU', 'CREDITOR', 'COLLECTION_AGENCY'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const NOTE_VISIBILITIES = ['INTERNAL', 'CLIENT_VISIBLE'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const ASSIGNMENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const DATA_REQUEST_TYPES = ['EXPORT', 'DELETE'] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];
export const DATA_REQUEST_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

export const PLAN_STEP_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'SKIPPED'] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export const COMPARISON_FLAGS = [
  'SAME_CREDITOR',
  'MISSING_TRADELINE',
  'BALANCE_MISMATCH',
  'STATUS_MISMATCH',
  'DUPLICATE',
] as const;
export type ComparisonFlag = (typeof COMPARISON_FLAGS)[number];

export const AI_PROVIDERS = ['gemini', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

// Activity log actions. Keep these stable — they are what auditors grep for.
export const ACTIVITY_ACTIONS = [
  'PROFILE_CREATED',
  'PROFILE_UPDATED',
  'CONSENT_RECORDED',
  'REPORT_UPLOADED',
  'REPORT_PARSING_STARTED',
  'REPORT_PARSED',
  'REPORT_REVIEW_REQUIRED',
  'REPORT_OCR_REQUIRED',
  'REPORT_PARSE_FAILED',
  'REPORT_DELETED',
  'ISSUES_DETECTED',
  'ACCOUNT_CREATED',
  'ACCOUNT_UPDATED',
  'ACCOUNT_DELETED',
  'ISSUE_CREATED',
  'ISSUE_STATUS_CHANGED',
  'DISPUTE_CREATED',
  'DISPUTE_APPROVED',
  'DISPUTE_STATUS_CHANGED',
  'DISPUTE_RESPONSE_UPLOADED',
  'LETTER_GENERATED',
  'LETTER_APPROVED',
  'LETTER_SENT',
  'SETTLEMENT_CREATED',
  'SETTLEMENT_UPDATED',
  'AI_QUERY',
  'AI_QUERY_BLOCKED',
  'EXPORT_REQUESTED',
  'DELETION_REQUESTED',
  'DELETION_COMPLETED',
  'ROLE_CHANGED',
  'STAFF_ASSIGNED',
  'STAFF_UNASSIGNED',
  'FILE_DOWNLOAD_URL_ISSUED',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];
