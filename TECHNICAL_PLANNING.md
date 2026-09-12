# Valeur Credit — Technical Planning

Companion to `valeur_lovable_backend_spec.docx`. The spec was written for Lovable + Supabase; this document records the confirmed decision to build it on **Firebase** and defines the stack, data model, security model, and build order.

Product boundaries from the spec still apply unchanged: no bank passwords, no money movement, no score promises, no auto-disputing accurate information, client approval required before any letter is READY, AI never makes the final accuracy determination.

---

## 1. Stack

### Frontend (`apps/web`)
| Piece | Choice | Why |
|---|---|---|
| Framework | Vite + React 18 + TypeScript | SPA, fast dev, matches Lovable output style |
| Styling | Tailwind CSS + shadcn/ui | Calm blue professional theme, accessible components, mobile-ready |
| Routing | React Router v6 | Protected routes per role (client / advisor / admin) |
| Server state | TanStack Query + Firestore `onSnapshot` | Loading / error / empty states everywhere; realtime parsing status |
| Forms | React Hook Form + Zod | Same Zod schemas shared with Cloud Functions |
| PDF viewing | pdf.js (react-pdf) | Show source pages next to extracted fields |

### Firebase (replacing Supabase)
| Supabase in spec | Firebase equivalent |
|---|---|
| Auth | Firebase Auth — email/password, password reset, custom claims for `role: client \| advisor \| admin` |
| Postgres tables | Firestore top-level collections keyed by `clientId` |
| Row Level Security | Firestore security rules — owner check on `clientId`, staff check via `staffAssignments`, admin via claim |
| Storage bucket `credit-reports` | Firebase Storage, private path `credit-reports/{clientId}/{reportId}.pdf`, rules enforce owner/staff + PDF MIME + size |
| Edge Functions | Cloud Functions v2 (Node 20, TypeScript) |
| Hosting | Firebase Hosting |
| Local dev | Firebase Emulator Suite (Auth, Firestore, Storage, Functions) |

### Shared (`packages/shared`)
Zod schemas, enums, rule engine, comparison logic, redaction helpers. Imported by both the web app and Functions so the deterministic logic is written once and unit-tested once.

---

## 2. Repo layout

```
valeur/
  apps/web/              Vite React app
  functions/             Cloud Functions (TypeScript)
  packages/shared/       Zod schemas, rule engine, compare logic, enums
  firestore.rules
  storage.rules
  firestore.indexes.json
  firebase.json
  .firebaserc
  .env.example
  TECHNICAL_PLANNING.md
```

npm workspaces at the root.

---

## 3. Firestore data model

All documents carry `id`, `createdAt`, `updatedAt` (server timestamps). Money is stored as numbers in cents-free decimal (JS number, 2dp enforced by Zod). Account numbers are stored **only** masked (`****1234`); the full number is never stored.

| Collection | Doc id | Key fields | Purpose |
|---|---|---|---|
| `profiles` | `uid` | fullName, email, phone, address, province, postalCode, consentAt, notificationPrefs, aiDataConsent | One per authenticated user |
| `staffAssignments` | `{clientId}_{staffUid}` | clientId, staffUid, status | Which staff may access which client |
| `creditReports` | auto | clientId, bureau (EQUIFAX/TRANSUNION), fileName, storagePath, score, status, parserConfidence, pageCount, errorMessage | One per uploaded PDF. `extractedText` lives in subcollection `creditReports/{id}/pages/{n}` so list reads never include raw text |
| `accounts` | auto | clientId, reportId?, creditorName, maskedAccountNumber, accountType, status, balance, pastDue, creditLimit, openedDate, lastReportedDate, bureau, sourcePage, sourceText, reviewState | Normalized tradelines + manual accounts |
| `bills` | auto | clientId, name, category, dueDay, recurringAmount, minimumAmount, autopay, accountId?, status | Bills and obligations |
| `creditIssues` | auto | clientId, reportId?, accountId?, type, ruleCode, severity, status, summary, evidenceNeeded, confirmedAt, confirmedBy | Diagnostic signals |
| `disputes` | auto | clientId, bureau, status, subject, body, clientApprovedAt, approvedBy, sentAt, deliveryMethod, trackingNumber, responseDueAt | One package per bureau |
| `disputeItems` | auto | disputeId, clientId, issueId, requestedAction | Issues in a package |
| `settlements` | auto | clientId, accountId?, creditorName, status, amountOwed, targetAmount, offeredAmount, offerDate, paidDate, writtenConfirmationReceived, notes, contactLog[] | Settlement tracking |
| `letters` | auto | clientId, disputeId?, settlementId?, type, bureau?, recipientName, recipientAddress, recipientUrl, recipientVerifiedAt, subject, body, status, generatedAt, approvedAt, sentAt | Generated drafts |
| `agencyContacts` | auto | kind (BUREAU/CREDITOR), bureau?, name, address, onlineUrl, lastVerifiedAt, active | Recipient directory (admin-managed) |
| `advisorNotes` | auto | clientId, authorId, note, visibility | Case notes |
| `aiMessages` | auto | clientId, userId, role, message, response, provider, model, safetyFlags[] | AI history + audit |
| `activityLogs` | auto | clientId, actorId, action, entityType, entityId, metadata | Immutable audit trail — written by Functions only |
| `settings` | `global` | maxUploadBytes, balanceTolerance, responseDueDays, retentionDays, rateLimits | Admin-configurable rules |
| `dataRequests` | auto | clientId, type (EXPORT/DELETE), status, requestedAt, completedAt | Export / deletion workflow |
| `rateLimits` | `{uid}_{action}` | windowStart, count | Server-side rate limiting |

---

## 4. Security model

### Auth roles
Custom claims: `{ role: 'client' | 'advisor' | 'admin' }`. Default `client` set by `onUserCreated`. Admin-only callable `setUserRole` changes it. First admin bootstrapped via `scripts/bootstrap-admin.ts`.

### Firestore rules (RLS equivalent)
```
isOwner(clientId)      = request.auth.uid == clientId
isAssignedStaff(cid)   = role in [advisor, admin] && exists(staffAssignments/{cid}_{uid}) && status == ACTIVE
isAdmin()              = role == admin
```
- Client-owned collections: read/write if `isOwner || isAssignedStaff`; clients cannot change `clientId`.
- `disputes.status` may not be set to READY/SENT by rules — only the `approveDispute` / `updateDisputeStatus` functions (Admin SDK) can.
- `creditIssues.confirmedAt/confirmedBy` set only via client/staff with matching uid.
- `activityLogs`: read `isOwner || isAssignedStaff || isAdmin`; **no client writes**.
- `agencyContacts`, `settings`: read all authenticated; write admin only.
- `aiMessages`: read owner; write Functions only.
- `staffAssignments`: read own (as client or staff); write admin only.

### Storage rules
- `credit-reports/{clientId}/{reportId}.pdf`: write if owner, `contentType == application/pdf`, `size < maxUploadBytes`; read if owner or assigned staff. Never public. Downloads via short-lived signed URLs from a callable.
- `dispute-responses/{clientId}/{disputeId}/…`: same policy.

---

## 5. Cloud Functions

| Function | Trigger | Does |
|---|---|---|
| `onUserCreated` | Auth `user().onCreate` | Creates `profiles/{uid}`, sets `client` claim |
| `parseCreditReport` | Storage `onObjectFinalized` under `credit-reports/` | pdf-parse text + page split → normalize accounts → confidence → run rule engine → create issues. Sets `PARSED` / `REVIEW_REQUIRED` / `OCR_REQUIRED` / `FAILED` |
| `reparseReport` | Callable | Re-runs the parser on demand |
| `updateAccount` | Callable | Corrections with `ACCOUNT_UPDATED` audit |
| `updateIssueStatus` | Callable | Enforces status workflow, audit |
| `createDispute` | Callable | Bureau-specific package from CONFIRMED issues; rejects mixed bureaus |
| `approveDispute` | Callable | Verifies checkbox payload, records `clientApprovedAt` + uid, DRAFT → READY |
| `updateDisputeStatus` | Callable | READY → SENT → RESPONSE_RECEIVED / ESCALATED / CLOSED; sets `responseDueAt` from settings |
| `generateLetter` | Callable | Dispute or settlement-request draft from templates + `agencyContacts` |
| `upsertSettlement` | Callable | Validates `targetAmount <= amountOwed`, status field requirements, audit |
| `aiCoach` | Callable | Redact → rate-limit → provider chain → log |
| `getSignedDownloadUrl` | Callable | Short-lived URL for a report the caller may access |
| `requestDataExport` / `requestAccountDeletion` | Callable | Creates `dataRequests`, audit |
| `setUserRole`, `assignStaff` | Callable (admin) | Role + assignment management |
| `processDeletionRequests` | Scheduled | Deletes files + rows after `retentionDays` |

All callables return `{ data, error, requestId }` and write `activityLogs` for sensitive mutations.

---

## 6. Report extraction pipeline

1. Client picks bureau, uploads PDF (client validates type/size; Storage rules enforce again).
2. Client creates `creditReports` doc with `status: UPLOADED` and `storagePath`.
3. `parseCreditReport` fires on finalize, sets `PARSING`.
4. `pdf-parse` extracts text per page. Empty/near-empty text → `OCR_REQUIRED`.
5. Bureau-specific regex extractors pull score + tradeline blocks (creditor, masked number, type, status, balance, past due, limit, opened, last reported).
6. Each field keeps `sourcePage` + `sourceText`. Accounts upserted with `reviewState: NEEDS_REVIEW` if any field confidence is low.
7. `parserConfidence` = weighted average; no score or no accounts → `REVIEW_REQUIRED` with `errorMessage` explaining what to check.
8. Rule engine (shared package) runs over the report's accounts → `creditIssues` (status OPEN, never auto-confirmed).
9. Activity log: `REPORT_UPLOADED`, `REPORT_PARSED`, `ISSUES_DETECTED`.

Rules implemented: `UNKNOWN_ACCOUNT`, `COLLECTION_STATUS`, `CHARGEOFF_STATUS`, `LATE_PAYMENT_INDICATOR`, `PAST_DUE_EXCEEDS_BALANCE`, `DUPLICATE_TRADELINE`, `INCOMPLETE_TRADELINE`.

Comparison (client-side, shared package): `SAME_CREDITOR`, `MISSING_TRADELINE`, `BALANCE_MISMATCH` (tolerance from settings), `STATUS_MISMATCH`, `DUPLICATE`.

---

## 7. AI coach — Gemini first, Anthropic fallback

Provider chain, tried in order until one succeeds:

1. Gemini `gemini-2.5-pro`
2. Gemini `gemini-2.5-flash` (different model, so a single-model outage doesn't take the assistant down)
3. Gemini `gemini-2.0-flash`
4. Anthropic Claude `claude-opus-5` — only if `ANTHROPIC_API_KEY` secret is set

Per call: redact account numbers / tokens / unnecessary PII → per-user rate limit → attach report/account context **only** if `profile.aiDataConsent` is true → system prompt with product boundaries → provider chain → log to `aiMessages` with `provider`, `model`, `safetyFlags`.

Secrets: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` in Firebase Secret Manager. Never in client code.

---

## 8. Build order

1. Scaffold monorepo, shared package, Firebase config, emulators.
2. Auth + profiles + roles + Firestore/Storage rules.
3. Core collections + seed script (clearly labeled demo data).
4. Dashboard, accounts, bills, settings/profile screens.
5. Report upload + parsing status + `parseCreditReport` function.
6. Extraction review + manual correction.
7. Rule engine, issue workflow, Compare screen.
8. Dispute creation, letter generation, approval checkbox, download.
9. Settlements + action plan.
10. Advisor workspace, AI coach, export/deletion workflow.
11. Rules tests, extraction tests, rule-engine tests, mobile QA.

---

## 9. Demo mode (pre-launch preview)

Until the Firebase project exists, a demo build is published to GitHub Pages so the client can click through the product.

- Enabled by `VITE_DEMO_MODE=true` (`apps/web/.env.demo`, `npm run build:demo`).
- `lib/demo/store.ts` — in-memory collections persisted to `localStorage`, same shapes as Firestore; `lib/query.ts` gives pages backend-neutral `where/orderBy/limit`.
- `lib/demo/seed.ts` — sample dataset (mirrors `scripts/seed.mjs`), issues generated by the real rule engine.
- `lib/demo/api.ts` — same validation/transition rules as the Cloud Functions (approval statement, bureau mixing, settlement checks), simulated PDF parse, canned coach answers.
- `lib/demo/` is only reachable when the flag is set; production builds tree-shake it. The only files that branch are `lib/auth.tsx`, `lib/data.ts`, `lib/callables.ts`.
- Deployed by `.github/workflows/demo-pages.yml` to `https://ankushgupta29210.github.io/valuer/`; `dist/404.html` copies `index.html` so deep links work on Pages.

Going live: create the Firebase project, fill `apps/web/.env.local` with `VITE_USE_EMULATORS=false` and no `VITE_DEMO_MODE`, then `npm run deploy`. The Pages workflow can be deleted or kept as a sandbox.

## 10. Deferred / flagged

- **Blaze plan** required to deploy Functions. Everything runs on the emulator until then.
- **OCR** for image-only PDFs: status is set to `OCR_REQUIRED`; actual OCR (Document AI / Tesseract) is phase 2.
- **Malware scanning**: hook point left in `parseCreditReport`; not implemented in MVP.
- **Email notifications**: notification preferences stored; sending is phase 2.
- **Bureau addresses** are seeded as placeholders in `agencyContacts` with `lastVerifiedAt: null` — an admin must verify and update them before launch.
