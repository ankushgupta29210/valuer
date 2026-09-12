import { z } from 'zod';
import {
  ACCOUNT_SOURCES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  ACTIVITY_ACTIONS,
  AI_PROVIDERS,
  ASSIGNMENT_STATUSES,
  BILL_CATEGORIES,
  BILL_STATUSES,
  BUREAUS,
  CONTACT_KINDS,
  CONTACT_METHODS,
  DATA_REQUEST_STATUSES,
  DATA_REQUEST_TYPES,
  DELIVERY_METHODS,
  DISPUTE_STATUSES,
  ISSUE_ORIGINS,
  ISSUE_STATUSES,
  LETTER_STATUSES,
  LETTER_TYPES,
  NOTE_VISIBILITIES,
  PLAN_STEP_STATUSES,
  REPORT_STATUSES,
  REQUESTED_ACTIONS,
  REVIEW_STATES,
  ROLES,
  RULE_CODES,
  SETTLEMENT_STATUSES,
  SEVERITIES,
} from './enums.js';

// ---------- primitives ----------

// Money is a non-negative number with at most two decimals.
export const money = z
  .number()
  .finite()
  .nonnegative()
  .refine((n) => Math.round(n * 100) === n * 100, 'Amounts may have at most two decimals');

export const optionalMoney = money.nullable().optional();

// ISO date (YYYY-MM-DD). Dates in this app are calendar dates, not instants.
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const optionalIsoDate = isoDate.nullable().optional();

// Masked account numbers only. Anything that looks like a full card/account
// number is rejected so it can never be persisted.
export const maskedAccountNumber = z
  .string()
  .trim()
  .max(32)
  .refine((v) => !/\d{7,}/.test(v), 'Only masked account numbers are allowed (e.g. ****1234)')
  .nullable()
  .optional();

export const provinceCode = z.enum([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

export const postalCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/, 'Use a Canadian postal code like A1A 1A1');

export const bureau = z.enum(BUREAUS);
export const role = z.enum(ROLES);

// ---------- profiles ----------
export const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().email(),
  phone: z.string().trim().max(30).nullable().optional(),
  dateOfBirth: optionalIsoDate, // stored only if the client chooses to add it
  address: z.string().trim().max(240).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  province: provinceCode.nullable().optional(),
  postalCode: postalCode.nullable().optional(),
  consentAt: z.string().datetime().nullable().optional(),
  aiDataConsent: z.boolean().default(false),
  notificationPrefs: z
    .object({
      email: z.boolean().default(true),
      reportReady: z.boolean().default(true),
      dueDateReminders: z.boolean().default(true),
      disputeUpdates: z.boolean().default(true),
    })
    .default({}),
});
export type ProfileInput = z.input<typeof profileSchema>;
export type Profile = z.output<typeof profileSchema> & { id: string; createdAt?: unknown; updatedAt?: unknown };

export const profileUpdateSchema = profileSchema.omit({ email: true }).partial();

// ---------- staffAssignments ----------
export const staffAssignmentSchema = z.object({
  clientId: z.string().min(1),
  staffUid: z.string().min(1),
  status: z.enum(ASSIGNMENT_STATUSES),
});
export type StaffAssignment = z.output<typeof staffAssignmentSchema> & { id: string };

// ---------- creditReports ----------
export const creditReportSchema = z.object({
  clientId: z.string().min(1),
  bureau,
  fileName: z.string().trim().min(1).max(200),
  storagePath: z.string().min(1),
  fileSize: z.number().int().nonnegative().optional(),
  status: z.enum(REPORT_STATUSES),
  score: z.number().int().min(300).max(900).nullable().optional(),
  scoreSourcePage: z.number().int().positive().nullable().optional(),
  scoreSourceText: z.string().max(500).nullable().optional(),
  reportDate: optionalIsoDate,
  parserConfidence: z.number().min(0).max(1).nullable().optional(),
  pageCount: z.number().int().nonnegative().nullable().optional(),
  accountCount: z.number().int().nonnegative().nullable().optional(),
  issueCount: z.number().int().nonnegative().nullable().optional(),
  errorMessage: z.string().max(2000).nullable().optional(),
  reviewNotes: z.array(z.string()).optional(),
  parsedAt: z.string().datetime().nullable().optional(),
});
export type CreditReport = z.output<typeof creditReportSchema> & { id: string; createdAt?: unknown; updatedAt?: unknown };

// ---------- accounts ----------
export const accountSchema = z.object({
  clientId: z.string().min(1),
  reportId: z.string().nullable().optional(),
  bureau: bureau.nullable().optional(),
  source: z.enum(ACCOUNT_SOURCES),
  creditorName: z.string().trim().min(1).max(120),
  maskedAccountNumber,
  accountType: z.enum(ACCOUNT_TYPES),
  status: z.enum(ACCOUNT_STATUSES),
  balance: optionalMoney,
  pastDue: optionalMoney,
  creditLimit: optionalMoney,
  openedDate: optionalIsoDate,
  lastReportedDate: optionalIsoDate,
  paymentHistoryText: z.string().max(500).nullable().optional(),
  sourcePage: z.number().int().positive().nullable().optional(),
  sourceText: z.string().max(4000).nullable().optional(),
  fieldConfidence: z.record(z.number().min(0).max(1)).optional(),
  reviewState: z.enum(REVIEW_STATES),
  isUnfamiliar: z.boolean().default(false),
  notes: z.string().max(2000).nullable().optional(),
});
export type AccountInput = z.input<typeof accountSchema>;
export type Account = z.output<typeof accountSchema> & { id: string; createdAt?: unknown; updatedAt?: unknown };

export const manualAccountSchema = accountSchema
  .omit({ clientId: true, source: true, reportId: true, sourcePage: true, sourceText: true, fieldConfidence: true, reviewState: true })
  .extend({ bureau: bureau.nullable().optional() });

export const accountCorrectionSchema = accountSchema
  .pick({
    creditorName: true,
    maskedAccountNumber: true,
    accountType: true,
    status: true,
    balance: true,
    pastDue: true,
    creditLimit: true,
    openedDate: true,
    lastReportedDate: true,
    isUnfamiliar: true,
    notes: true,
  })
  .partial();

// ---------- bills ----------
export const billSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  category: z.enum(BILL_CATEGORIES),
  dueDay: z.number().int().min(1).max(31),
  recurringAmount: optionalMoney,
  minimumAmount: optionalMoney,
  currentAmount: optionalMoney,
  autopay: z.boolean().default(false),
  accountId: z.string().nullable().optional(),
  status: z.enum(BILL_STATUSES).default('ACTIVE'),
  notes: z.string().max(1000).nullable().optional(),
});
export type Bill = z.output<typeof billSchema> & { id: string };
export const billInputSchema = billSchema.omit({ clientId: true });

// ---------- creditIssues ----------
export const creditIssueSchema = z.object({
  clientId: z.string().min(1),
  reportId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  bureau: bureau.nullable().optional(),
  origin: z.enum(ISSUE_ORIGINS),
  ruleCode: z.enum(RULE_CODES).nullable().optional(),
  type: z.string().min(1).max(60),
  severity: z.enum(SEVERITIES),
  status: z.enum(ISSUE_STATUSES),
  summary: z.string().min(1).max(1000),
  whyItMatters: z.string().max(1000).nullable().optional(),
  evidenceNeeded: z.string().min(1).max(1000),
  evidenceNotes: z.string().max(4000).nullable().optional(),
  sourcePage: z.number().int().positive().nullable().optional(),
  sourceText: z.string().max(2000).nullable().optional(),
  confirmedAt: z.string().datetime().nullable().optional(),
  confirmedBy: z.string().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  disputeId: z.string().nullable().optional(),
});
export type CreditIssue = z.output<typeof creditIssueSchema> & { id: string; createdAt?: unknown };

export const clientIssueInputSchema = z.object({
  accountId: z.string().nullable().optional(),
  summary: z.string().trim().min(5).max(1000),
  evidenceNeeded: z.string().trim().min(1).max(1000).default('Gather statements or correspondence that show what the correct information should be.'),
  severity: z.enum(SEVERITIES).default('MEDIUM'),
});

export const issueStatusUpdateSchema = z.object({
  issueId: z.string().min(1),
  status: z.enum(ISSUE_STATUSES),
  note: z.string().max(2000).optional(),
});

// ---------- disputes ----------
export const disputeSchema = z.object({
  clientId: z.string().min(1),
  bureau,
  status: z.enum(DISPUTE_STATUSES),
  subject: z.string().max(200),
  body: z.string().max(20000).nullable().optional(),
  letterId: z.string().nullable().optional(),
  issueIds: z.array(z.string()).min(1),
  clientApprovedAt: z.string().datetime().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  approvalStatement: z.string().nullable().optional(),
  sentAt: z.string().datetime().nullable().optional(),
  deliveryMethod: z.enum(DELIVERY_METHODS).nullable().optional(),
  trackingNumber: z.string().max(100).nullable().optional(),
  responseDueAt: z.string().datetime().nullable().optional(),
  responseReceivedAt: z.string().datetime().nullable().optional(),
  responseSummary: z.string().max(4000).nullable().optional(),
  responseFilePath: z.string().nullable().optional(),
});
export type Dispute = z.output<typeof disputeSchema> & { id: string; createdAt?: unknown };

export const disputeItemSchema = z.object({
  disputeId: z.string().min(1),
  clientId: z.string().min(1),
  issueId: z.string().min(1),
  accountId: z.string().nullable().optional(),
  requestedAction: z.enum(REQUESTED_ACTIONS),
});
export type DisputeItem = z.output<typeof disputeItemSchema> & { id: string };

export const createDisputeInputSchema = z.object({
  bureau,
  items: z
    .array(z.object({ issueId: z.string().min(1), requestedAction: z.enum(REQUESTED_ACTIONS) }))
    .min(1)
    .max(25),
});

// The exact statement the client must accept. The function compares it
// verbatim so a UI cannot approve with a softer wording.
export const DISPUTE_APPROVAL_STATEMENT =
  'I reviewed the account information, the statements are accurate to the best of my knowledge, and I authorize this letter to be prepared for my submission.';

export const approveDisputeInputSchema = z.object({
  disputeId: z.string().min(1),
  reviewed: z.literal(true),
  statement: z.literal(DISPUTE_APPROVAL_STATEMENT),
});

export const disputeStatusUpdateSchema = z.object({
  disputeId: z.string().min(1),
  status: z.enum(DISPUTE_STATUSES),
  deliveryMethod: z.enum(DELIVERY_METHODS).optional(),
  trackingNumber: z.string().max(100).optional(),
  responseSummary: z.string().max(4000).optional(),
  responseFilePath: z.string().optional(),
  note: z.string().max(2000).optional(),
});

// ---------- settlements ----------
export const settlementContactSchema = z.object({
  date: isoDate,
  method: z.enum(CONTACT_METHODS),
  notes: z.string().max(2000),
});

export const settlementSchema = z
  .object({
    clientId: z.string().min(1),
    accountId: z.string().nullable().optional(),
    creditorName: z.string().trim().min(1).max(120),
    recipientName: z.string().trim().max(120).nullable().optional(),
    recipientAddress: z.string().trim().max(400).nullable().optional(),
    status: z.enum(SETTLEMENT_STATUSES),
    amountOwed: optionalMoney,
    targetAmount: optionalMoney,
    offeredAmount: optionalMoney,
    offerDate: optionalIsoDate,
    offerSource: z.string().max(200).nullable().optional(),
    acceptedTerms: z.string().max(4000).nullable().optional(),
    acceptedDueDate: optionalIsoDate,
    paidDate: optionalIsoDate,
    paymentReference: z.string().max(120).nullable().optional(),
    confirmationFilePath: z.string().nullable().optional(),
    writtenConfirmationReceived: z.boolean().default(false),
    satisfiesInFull: z.boolean().nullable().optional(),
    remainingBalanceWaived: z.boolean().nullable().optional(),
    reportingAfterPayment: z.string().max(500).nullable().optional(),
    declineReason: z.string().max(1000).nullable().optional(),
    contactLog: z.array(settlementContactSchema).default([]),
    notes: z.string().max(4000).nullable().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.amountOwed != null && s.targetAmount != null && s.targetAmount > s.amountOwed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetAmount'],
        message: 'Target amount cannot be greater than the amount owed.',
      });
    }
    const need = (cond: boolean, path: string, message: string) => {
      if (cond) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    switch (s.status) {
      case 'CONTACTED':
        need(s.contactLog.length === 0, 'contactLog', 'Record the contact date, method, and notes.');
        break;
      case 'OFFER_RECEIVED':
        need(s.offeredAmount == null, 'offeredAmount', 'Enter the offered amount.');
        need(!s.offerDate, 'offerDate', 'Enter the offer date.');
        need(!s.offerSource, 'offerSource', 'Record where the offer came from (written or verbal, and from whom).');
        break;
      case 'ACCEPTED':
        need(!s.writtenConfirmationReceived, 'writtenConfirmationReceived', 'Obtain written confirmation before marking accepted.');
        need(!s.acceptedTerms, 'acceptedTerms', 'Record the exact written terms.');
        need(!s.acceptedDueDate, 'acceptedDueDate', 'Enter the payment due date.');
        break;
      case 'PAID':
        need(!s.paidDate, 'paidDate', 'Enter the paid date.');
        need(!s.paymentReference, 'paymentReference', 'Enter the payment reference.');
        break;
      case 'DECLINED':
        need(!s.declineReason, 'declineReason', 'Record the reason or next step.');
        break;
    }
  });
export type Settlement = z.output<typeof settlementSchema> & { id: string; createdAt?: unknown };
export type SettlementInput = z.input<typeof settlementSchema>;

// ---------- letters ----------
export const letterSchema = z.object({
  clientId: z.string().min(1),
  disputeId: z.string().nullable().optional(),
  settlementId: z.string().nullable().optional(),
  type: z.enum(LETTER_TYPES),
  bureau: bureau.nullable().optional(),
  recipientName: z.string().max(200),
  recipientAddress: z.string().max(500).nullable().optional(),
  recipientUrl: z.string().url().nullable().optional(),
  recipientVerifiedAt: z.string().nullable().optional(),
  agencyContactId: z.string().nullable().optional(),
  subject: z.string().max(200),
  body: z.string().max(30000),
  attachmentsChecklist: z.array(z.string()).default([]),
  status: z.enum(LETTER_STATUSES),
  generatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  sentAt: z.string().datetime().nullable().optional(),
  deliveryMethod: z.enum(DELIVERY_METHODS).nullable().optional(),
  trackingNumber: z.string().max(100).nullable().optional(),
});
export type Letter = z.output<typeof letterSchema> & { id: string };

export const generateLetterInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DISPUTE'), disputeId: z.string().min(1) }),
  z.object({
    type: z.literal('SETTLEMENT_REQUEST'),
    settlementId: z.string().min(1),
    recipientName: z.string().trim().min(1).max(200),
    recipientAddress: z.string().trim().min(1).max(500),
  }),
]);

// ---------- agencyContacts ----------
export const agencyContactSchema = z.object({
  kind: z.enum(CONTACT_KINDS),
  bureau: bureau.nullable().optional(),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).nullable().optional(),
  onlineUrl: z.string().url().nullable().optional(),
  onlineInstructions: z.string().max(2000).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  lastVerifiedAt: isoDate.nullable().optional(),
  active: z.boolean().default(true),
});
export type AgencyContact = z.output<typeof agencyContactSchema> & { id: string };

// ---------- advisorNotes ----------
export const advisorNoteSchema = z.object({
  clientId: z.string().min(1),
  authorId: z.string().min(1),
  authorName: z.string().max(120).optional(),
  note: z.string().trim().min(1).max(5000),
  visibility: z.enum(NOTE_VISIBILITIES).default('INTERNAL'),
});
export type AdvisorNote = z.output<typeof advisorNoteSchema> & { id: string; createdAt?: unknown };

// ---------- aiMessages ----------
export const aiMessageSchema = z.object({
  clientId: z.string().min(1),
  userId: z.string().min(1),
  role: z.literal('user'),
  message: z.string().max(4000),
  response: z.string().max(20000).nullable(),
  provider: z.enum(AI_PROVIDERS).nullable(),
  model: z.string().nullable(),
  usedClientData: z.boolean(),
  safetyFlags: z.array(z.string()).default([]),
  latencyMs: z.number().int().nonnegative().optional(),
});
export type AiMessage = z.output<typeof aiMessageSchema> & { id: string; createdAt?: unknown };

export const aiCoachInputSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  useMyData: z.boolean().default(false),
});

// ---------- activityLogs ----------
export const activityLogSchema = z.object({
  clientId: z.string().min(1),
  actorId: z.string().min(1),
  actorRole: role,
  action: z.enum(ACTIVITY_ACTIONS),
  entityType: z.string().max(60),
  entityId: z.string().max(200).nullable(),
  metadata: z.record(z.unknown()).default({}),
  requestId: z.string().uuid().optional(),
});
export type ActivityLog = z.output<typeof activityLogSchema> & { id: string; createdAt?: unknown };

// ---------- settings ----------
export const settingsSchema = z.object({
  maxUploadBytes: z.number().int().positive().default(10 * 1024 * 1024),
  balanceTolerance: money.default(25),
  responseDueDays: z.number().int().positive().default(30),
  retentionDays: z.number().int().nonnegative().default(30),
  rateLimits: z
    .object({
      aiPerHour: z.number().int().positive().default(20),
      uploadsPerDay: z.number().int().positive().default(10),
      lettersPerDay: z.number().int().positive().default(20),
    })
    .default({}),
});
export type Settings = z.output<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

// ---------- dataRequests ----------
export const dataRequestSchema = z.object({
  clientId: z.string().min(1),
  type: z.enum(DATA_REQUEST_TYPES),
  status: z.enum(DATA_REQUEST_STATUSES),
  requestedAt: z.string().datetime(),
  scheduledFor: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  exportPath: z.string().nullable().optional(),
  reason: z.string().max(1000).nullable().optional(),
});
export type DataRequest = z.output<typeof dataRequestSchema> & { id: string };

// ---------- actionPlans ----------
export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(2000).nullable().optional(),
  dueDate: optionalIsoDate,
  status: z.enum(PLAN_STEP_STATUSES).default('TODO'),
  linkedType: z.enum(['ISSUE', 'DISPUTE', 'SETTLEMENT', 'BILL', 'ACCOUNT']).nullable().optional(),
  linkedId: z.string().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});
export const actionPlanSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  goal: z.string().max(2000).nullable().optional(),
  steps: z.array(planStepSchema).default([]),
  archived: z.boolean().default(false),
});
export type ActionPlan = z.output<typeof actionPlanSchema> & { id: string; createdAt?: unknown };
export type PlanStep = z.output<typeof planStepSchema>;

// ---------- users directory (admin) ----------
export const userDirectorySchema = z.object({
  email: z.string().email(),
  fullName: z.string().max(120).nullable().optional(),
  role,
  disabled: z.boolean().default(false),
});
export type UserDirectoryEntry = z.output<typeof userDirectorySchema> & { id: string };

// ---------- callable envelope ----------
export type CallableResponse<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  requestId: string;
};
