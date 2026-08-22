# Twin Oaks OS — Build Status & Roadmap

Tracks what has actually shipped against [`SPEC.md`](./SPEC.md).
Statuses: ✅ built · 🟡 partial (details noted) · ⬜ not started.

_Last updated: 2026-08-22 — V3 (livestock) and V4 (manufacturing) built, plus
the remaining V1/V2 gaps. Every version in SPEC §§33–36 now has shipped code._

## V1 — Financial core (SPEC §33)

| Feature | Status | Notes |
|---|---|---|
| Company setup | 🟡 | Single-company app, divisions FARM/TECH/SHARED baked in; no settings screen yet |
| Dashboard | ✅ | Month + YTD revenue/expenses/net, division cards, inbox alert, needs-attention flags, recent activity, tax set-aside planning number |
| Receipt capture | ✅ | Camera capture on iPhone/iPad (`capture="environment"`), photo/PDF upload, attach-later |
| Receipt storage | ✅ | Originals stored under `var/uploads` in dev via `src/lib/storage.ts`; swap to object storage for production (same interface) |
| Receipt Inbox | ✅ | Save instantly → categorize later; Inbox / Needs-review / All tabs |
| Expenses | ✅ | Full SPEC §5 record: dual categories, division, business purpose, asset link, tax year, tax status, capital flag |
| Income | ✅ | SPEC §25 categories, division, source |
| Categories | ✅ | Accounting + management levels (`src/lib/domain.ts` is the source of truth) |
| Equipment/assets | ✅ | SPEC §9 profile fields, ACTIVE/SOLD/RETIRED status |
| Equipment maintenance | ✅ | SPEC §10 history + categories, YTD/lifetime/cost-per-hour rollups, hour-meter sync |
| Search | ✅ | Multi-term AND search across expenses, receipts, income, assets, maintenance |
| Basic tax reports | ✅ | Tax Center: per-year totals, category breakdowns, division split, flagged items, capital list |
| Receipt drill-down | ✅ | Tax Center → expense → original receipt image (SPEC §26 example works end-to-end) |
| Data backup | ✅ | One-tap full JSON export (`/api/export`) covering every table, plus automatic daily backups to Blob (kept 30 days). Adding a model without adding it to `src/lib/backup.ts` is silent data loss — the counts are now derived from the payload so the two cannot drift |

### V1 gaps — all closed as of 2026-08-22

- **OCR auto-read of receipts** (SPEC §3) — ✅ shipped. PDFs with a text layer are read instantly; scans and photos are read **on the device** (bundled Tesseract + pdf.js, no key, no external service), with an optional Anthropic key as an accuracy upgrade. Fills vendor, date, total, sales tax, receipt number, payment method and a description of what was bought.
- **Duplicate-receipt detection** (SPEC §4) — ✅ shipped. Same receipt number, or same vendor + total within a few days, or an identical file, raises a dismissible warning with a one-tap "yes, archive this one". It never blocks a save and never deletes anything.
- **Photos/manuals on equipment profiles** (SPEC §9) — ✅ shipped with generalized document storage (below).
- **Outstanding invoices / upcoming bills on dashboard** (SPEC §2) — ✅ shipped. Outstanding is derived from invoices minus payments (quotes and cancelled excluded, overdue split out); upcoming comes from declared regular bills at `/bills`. A business bill is shown, never auto-posted — money leaving the business stays a deliberate act.

- **Auth / secure login** (SPEC §32) — ✅ owner password gate shipped 2026-08-10 (`APP_PASSWORD` + signed 30-day session cookie, middleware-enforced on every route including the APIs); passkeys/Face ID followed the same day (see Production hardening). **Set `APP_PASSWORD` on every deployment.**

## V2 — Customers, invoicing, mileage, banking (SPEC §34)

_Revenue-loop slice shipped 2026-08-11:_

| Feature | Status | Notes |
|---|---|---|
| Customers | ✅ | Profiles (SPEC §14 contact fields), lifetime revenue + open balance rollups; deletable only when invoice-free |
| Invoices | ✅ | Draft → sent lifecycle, line-item editor, auto numbering (INV-NNN), sales tax, derived paid/partial/overdue status, printable/PDF view; drafts editable, sent invoices immutable |
| Payments | ✅ | Recorded against invoices; **auto-posts a linked Income row** (division-appropriate SPEC §25 category) so the books need no double entry; removing a payment removes its income row |
| Mileage | ✅ | SPEC §19 trips (odometer or direct miles), vehicle link advances Asset.currentMileage, YTD totals, Tax Center line. No auto-deduction math — rate is the accountant's call |
| Quotes | ✅ | `kind=QUOTE` on the Invoice table, `Q-NNN` numbering, no payments, printable "QUOTE" view, one-tap convert → fresh draft invoice (quote stamped ACCEPTED); excluded from every owed-money rollup |
| Accountant export (SPEC §28) | ✅ | Six per-year CSVs from the Tax Center: expenses, income, P&L (per-division + business miles), category totals, mileage, asset register. The full ZIP package with the receipt images shipped 2026-08-22 — see Cross-cutting below |
| **Email-forwarded receipts** (SPEC §37) | ✅ | Forward a receipt to the inbound address → lands in the Receipt Inbox with vendor/total/tax/date/receipt-number auto-read, original email or attachment stored permanently. Provider-agnostic webhook (`/api/inbound/email/<secret>`) handling CloudMailin / Postmark / SendGrid / Mailgun JSON **and** multipart. Setup page at Settings → Email receipts |
| Bank transaction matching | ✅ | `/banking`, shipped 2026-08-22. Format-tolerant CSV import (delimiter sniffing, guessed column mapping the operator confirms, signed-amount **or** debit/credit-pair layouts, several date formats), remembered per bank so the second import asks nothing. Idempotent by content fingerprint — re-uploading an overlapping statement adds nothing. Each unmatched row offers "yes that's it" / "add it as a new expense" / "ignore". The importer never creates or edits a financial record on its own; matching only records the link |

## V3 — Farm / livestock (SPEC §35) — shipped 2026-08-22

| Feature | Status | Notes |
|---|---|---|
| Sheep profiles (SPEC §22) | ✅ | `/livestock`. Ear tag is the identity and is unique per account; name optional. Breed, sex (ewe/ram/wether), birth date, birth type, sire and dam picked from the flock, weight, status, acquisition cost, notes |
| Flock events (SPEC §23) | ✅ | One `AnimalEvent` table covers all 15 event kinds — born, bred, pregnancy check, lambed, weighed, vaccination, medication, dewormed, sheared, hoof trim, injury, vet visit, transferred, died, note. `ANIMAL_EVENT_FIELDS` in `src/lib/domain.ts` decides which optional fields each kind shows, so logging a weight never asks for a dosage |
| Breeding + lambing | ✅ | A breeding event suggests the due date automatically (`GESTATION_DAYS` = 147). Lambing records the lamb count; parentage links lambs to dam and sire, and each animal's page lists its offspring |
| Health records + withdrawal safety | ✅ | Vaccination/medication/deworming events carry the product, dose and **meat withdrawal date**. An animal still inside a withdrawal period shows a loud warning on its page — a legal safeguard, not a nicety |
| Livestock sales (SPEC §24) | ✅ | `/livestock/sales`. Buyer from Customers or free text, weight, price; **auto-posts a linked Income row** (FARM / "Livestock sales") exactly as invoice payments do, and marks the animal SOLD. Deleting the sale reverses both |
| Farm cost analysis | ✅ | Expenses can be attributed to an animal (`Expense.animalId`), which is what makes cost-per-head, cost per lamb, and sale-price-vs-cost computable. Helpers in `src/lib/livestock.ts` |

## V4 — Manufacturing (SPEC §36) — shipped 2026-08-22

| Feature | Status | Notes |
|---|---|---|
| Print jobs (SPEC §15) | ✅ | `/jobs`. Customer → part → printer → filament → invoice in one record. Auto-numbered `JOB-001` per account |
| Filament inventory (SPEC §13) | ✅ | `/filament`. Spools with manufacturer, material, colour, price, total/remaining/waste grams, price per gram, value on hand, and a "running low" callout. Deleting a spool used by a job is blocked, so cost history is never orphaned |
| Printer tracking (SPEC §12) | ✅ | Printers stay Assets (no duplicate model) — per-printer rollups of jobs, hours, revenue, cost and profit come from the jobs data |
| Job costing + profit per part | ✅ | `src/lib/manufacturing.ts` derives material (grams × price/gram, waste included), machine time, labour, packaging, shipping and other costs → total cost, profit, profit per part, margin. Derived in code, never stored, so it cannot drift from its inputs |
| Production reporting | ✅ | Per-printer rollup plus most/least profitable parts |

## Production hardening — shipped 2026-08-11

| Item | Status | Notes |
|---|---|---|
| Face ID / Touch ID sign-in (SPEC §32) | ✅ | WebAuthn passkeys, **additive** — the owner password always works, so a lost device can't lock the owner out. Enrollment requires an existing session; sign-in verifies a signature over a server-issued challenge (challenge in a 5-min httpOnly cookie, since serverless instances share no memory). Managed at Settings → Face ID sign-in. Verified end-to-end with a virtual authenticator (enroll → sign in → last-used → remove → fallback) |
| Home-screen install (PWA) | ✅ | `manifest.ts` + generated `icon`/`apple-icon` (ImageResponse, no binary assets), standalone display, dismissible install hint on More |
| Private document serving | ✅ | Blob URLs are no longer emitted to the browser; every document streams through `/api/files/remote` behind the login gate, with a host allowlist so the proxy can't be an SSRF relay. All stored files served under CSP `sandbox` + `nosniff` |
| Automatic daily backups (SPEC §32) | ✅ | Vercel cron → `/api/cron/backup` (CRON_SECRET-authenticated) writes a dated JSON of every table to Blob, keeps the newest 30. Browse/download/trigger at Settings → Backups |
| Search by amount + date (SPEC §29) | ✅ | `$87.42` / `87.42` matches money columns, `8/9/2026` / `2026-08-09` matches date columns; a term a model can't satisfy excludes that model rather than being silently dropped |

## Cross-cutting — shipped 2026-08-22

| Item | Status | Notes |
|---|---|---|
| Document storage (SPEC §31) | ✅ | One `Document` model + one reusable card attaches photos, manuals, warranties, paperwork and CAD files to equipment, customers, animals, print jobs, invoices and expenses. Same storage tiering as receipts (Blob → database → disk), same ownership checks. `/documents` lists everything in one place |
| Tax-time document package (SPEC §28) | ✅ | `/api/export/package?year=YYYY` — the six per-year CSVs, every receipt original named so a human can find it, a `receipt-index.csv` mapping expense → file (or "NO RECEIPT ON FILE"), and a plain-English README |
| Receipt line items (FR-006) | ✅ | Itemise a receipt, flag when the lines don't add up to the total, and optionally split one receipt into an expense per category |
| Category suggestion from history (FR-006) | ✅ | Choosing a known vendor pre-selects the category you usually file them under, with a note saying why. Pure SQL over your own history — no AI, no external call |
| Assistant (FR-002) | ✅ | `/assistant` answers plain questions from a compact, pre-aggregated snapshot of **your** numbers. Never sees raw rows, never leaves the account, never gives tax advice, and says so plainly when the key isn't configured |
| Safe testing mode (FR-003) | ✅ | `/settings/testing` adds coherent sample data across every module and removes exactly that data again — real records are structurally untouchable |
| The save rule (UI-002) | ✅ | Every save returns to the list with a green confirmation; every rejected save says why in plain words instead of blanking the form |

## Platform follow-ups (not feature work)

- Auth ✅ password gate + passkeys. Remaining: nothing blocking
- Deploy ✅ live at twin-oaks.vercel.app from `gschiemann/twin-oaks-app`
- Every version in SPEC §§33–36 now has shipped code. What is left is
  SPEC §37 "future features": automatic bank feeds, automatic mileage
  tracking, invoice email delivery, online customer payments, barcode /
  QR / sheep-tag scanning, predictive maintenance, push notifications,
  and an accountant portal
- Upgrade path: Next.js 15 → 16 when the app stabilizes
