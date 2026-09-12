# Valeur Credit

Clearer credit decisions, one manageable step at a time.

A Canada-wide credit decision and debt-management workspace. Clients upload Equifax and TransUnion reports, review what was extracted (with the source page for every value), compare bureaus, see plain-English diagnostic flags, decide what deserves review, build bureau-specific dispute packages they must approve before anything is marked ready, track settlement requests, and keep an audit trail. Advisors can help organize; the client stays in control.

**Product boundaries** (enforced in code, not just copy): no bank passwords, no payments, no promised score changes, no auto-disputing accurate information, no external submission — the client downloads the letter and sends it themselves.

See [TECHNICAL_PLANNING.md](TECHNICAL_PLANNING.md) for the stack, data model, security model, and build order. The original product spec is `valeur_lovable_backend_spec.docx`.

## Stack

- **Web** — Vite + React 18 + TypeScript, Tailwind, React Router (`apps/web`)
- **Backend** — Firebase: Auth (custom-claim roles), Firestore (security rules as RLS), Storage (private buckets), Cloud Functions v2 (`functions`)
- **Shared** — Zod schemas, enums, rule engine, bureau comparison, redaction, letter templates (`packages/shared`), unit-tested with Vitest
- **AI coach** — Gemini (`2.5-pro` → `2.5-flash` → `2.0-flash`) with Anthropic Claude fallback, server-side only

## Local development

Prerequisites: Node 20+, Java 17+ (for the Firestore/Storage emulators), Firebase CLI (`npm i -g firebase-tools`).

```bash
npm install
npm run build -w packages/shared
npm run build -w functions

# Terminal 1 — emulators (Auth, Firestore, Storage, Functions, Hosting)
npm run emulators

# Terminal 2 — seed demo users + sample data, then start the web app
npm run seed
npm run dev          # http://localhost:5173
```

Demo logins (emulator only):

| Role | Email | Password |
|---|---|---|
| Client | client@demo.valeur.local | demo-password-1 |
| Advisor | advisor@demo.valeur.local | demo-password-1 |
| Admin | admin@demo.valeur.local | demo-password-1 |

`apps/web/.env.local` already points at the emulators. AI keys go in `functions/.env` (see `functions/.env.example`); without them the assistant reports itself unavailable but everything else works.

Emulator UI: http://127.0.0.1:4000

## Tests

```bash
npm test                                            # shared package unit tests (rules, compare, redaction, schemas, letters)
node scripts/make-sample-pdf.mjs                    # builds a text-based sample bureau PDF
node scripts/smoke.mjs scripts/fixtures/sample-equifax.pdf   # end-to-end against the emulators (rules, callables, upload → parse)
```

The smoke test signs in as the demo client and exercises Firestore/Storage rules, every callable, the dispute approval gate, settlement validation, letter generation, the PDF parser via the Storage trigger, export, and advisor access boundaries. Reset the emulator between runs:

```bash
curl -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/valeur-credit/databases/(default)/documents"
curl -X DELETE "http://127.0.0.1:9099/emulator/v1/projects/valeur-credit/accounts"
npm run seed
```

## Deploying to a real Firebase project

1. Create a Firebase project and enable **Authentication (Email/Password)**, **Firestore**, **Storage**, and upgrade to the **Blaze** plan (required for Cloud Functions).
2. `firebase use --add` and pick the project; update `.firebaserc` and `apps/web/.env.local` / hosting env with the web app config (`VITE_USE_EMULATORS=false`).
3. Secrets: `firebase functions:secrets:set GEMINI_API_KEY` and `firebase functions:secrets:set ANTHROPIC_API_KEY`.
4. `npm run deploy` (builds shared, functions, web; deploys rules, indexes, functions, hosting).
5. Bootstrap the first admin: set `BOOTSTRAP_TOKEN` on the `bootstrapAdmin` function, sign up, then `curl -H "x-bootstrap-token: …" "https://<region>-<project>.cloudfunctions.net/bootstrapAdmin?uid=<your uid>"`. Remove the token afterwards.
6. In **Administration → Recipient directory**, verify the Equifax and TransUnion dispute channels against the official sites and record the verification date. Letters show "not yet verified" until this is done.

## Repository layout

```
apps/web/            React app (pages, components, Firebase client hooks)
functions/           Cloud Functions (users, reports/parse, accounts, disputes, letters, settlements, files, ai)
packages/shared/     Enums, Zod schemas, rule engine, compare, redaction, letter templates, tests
scripts/             seed.mjs, smoke.mjs, make-sample-pdf.mjs
firestore.rules      Row-level access (owner / assigned staff / admin), server-only collections
storage.rules        Private buckets, PDF-only report uploads
firestore.indexes.json
firebase.json
```

## Status

Built against the spec's 13 acceptance criteria. Deferred to a later phase: OCR for image-only PDFs (they are flagged `OCR_REQUIRED`), malware scanning hook, email notifications (preferences are stored), and real bureau sample tuning of the extractor (it is heuristic and keeps every value traceable to its source page for manual correction).
