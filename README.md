# Kantillon

A multi-shop cement inventory, sales, and reconciliation system for a business owner running several independent shops.

> **Phase 1 + 2 + 3 + 4 scope.** Phase 1 built the project foundation. Phase 2 added opening-stock initialization, staff-submitted stock receipts, and owner approval/rejection. Phase 3 added the daily end-of-day workflow (sales lines, expected stock, expected revenue, stock/money variance) with an immediate `SALE` ledger transaction. Phase 4 (this phase) adds two deliberately separate concepts: **corrections** (fixing a data-entry mistake in an already-submitted report, via an immutable correction snapshot and reversal/replacement ledger transactions) and **discrepancy resolution** (recording a genuine real-world stock or money discrepancy — damage, shortage, surplus, a cash shortfall — against an *accurate* report, via owner-posted resolution records). Credit sales, customer accounts receivable, expenses, payroll, bank reconciliation, stock transfers, purchase orders, general-ledger accounting, and advanced analytics are **not** implemented yet — they are later phases.

## Project purpose

The business currently sells one product (Lafarge Cement, by the bag) across multiple shops, but the system is designed to support additional products without code changes to core logic. Each shop tracks its own inventory independently. The owner can eventually monitor and control every shop from a mobile-first interface; other staff (admins, managers, salespeople) only see the shops they're assigned to.

## Architecture

**Monorepo layout:**

```
/server   Node.js + Express + MongoDB (Mongoose) API
/client   React + Vite frontend
```

**Backend stack:** Node.js, Express, MongoDB/Mongoose, JWT in httpOnly cookies, bcryptjs, Zod validation, Helmet, CORS, express-rate-limit. Pure ES modules throughout.

**Frontend stack:** React, Vite, Tailwind CSS, React Router, TanStack Query, Axios. Mobile-first layout.

### Key architectural rules (do not violate in later phases)

1. **Inventory is an append-only transaction ledger** (`InventoryTransaction`). Shops and products never carry a mutable "current stock" field, and there is no endpoint that lets a user directly set a stock balance.
2. Only `APPROVED` transactions contribute to the official stock balance (balance = sum of approved IN quantities minus approved OUT quantities, per shop + product).
3. Historical transactions are not edited. Corrections are made with a new `REVERSAL` transaction that references the original — e.g. `SALE -400` mis-entered is corrected with `REVERSAL +400`, then the real `SALE -390` is recorded. Net effect: `-390`.
4. Prices are versioned, not overwritten. `ShopPrice` rows have an `effectiveFrom`/`effectiveTo` range; changing a price closes the current row and inserts a new one, preserving history.
5. `AuditLog` is append-only.
6. The frontend never supplies a `shopId` that the backend trusts blindly — every shop-scoped request is checked against the caller's permitted shops (`OWNER` bypasses this; everyone else is checked against `user.shopIds`).
7. Financial/inventory calculations are (and must remain) revalidated on the backend — the frontend never becomes the source of truth for a number that affects stock or money.

## Phase 2: inventory workflow

### Inventory balance formula

Official stock for a shop/product is always **derived**, never stored:

```
balance = SUM(quantity of APPROVED transactions where direction = IN)
        − SUM(quantity of APPROVED transactions where direction = OUT)
```

`PENDING`, `REJECTED`, and `VOIDED` transactions never contribute. This is computed by `services/inventoryService.js` (`getInventoryBalance`, `getShopInventory`) via a MongoDB aggregation — nothing else in the codebase sums ledger rows directly, and Shop/Product still have no stock field of their own.

### Opening stock

- **OWNER only.** A one-time initialization per shop/product, created directly as `APPROVED` (no one else needs to approve the owner's own initialization).
- Not a correction mechanism — if stock needs fixing later, that's an adjustment/reversal workflow (a later phase), not a second opening-stock call.
- Duplicate prevention is enforced **at the database level**: the `InventoryTransaction` collection has a partial unique index on `{ shopId, productId }`, scoped to documents where `type` is exactly `"OPENING_STOCK"`. This makes a second opening-stock transaction for the same shop/product impossible even under a race — verified with a real concurrent-request test (two simultaneous `POST /api/inventory/opening-stock` calls for the same shop/product: exactly one `201`, one `409`, and the balance reflects the quantity exactly once).
- `POST /api/inventory/opening-stock` → `{ shopId, productId, quantity, notes? }` → `{ transaction, balance }`.

### Stock receipts (staff-reported deliveries)

- A MANAGER or SALESPERSON assigned to a shop (or an OWNER) can report stock received for that shop. Submission always starts `PENDING` and creates a linked `InventoryTransaction` (also `PENDING`) — pending transactions never affect the official balance.
- `POST /api/stock-receipts` → `{ shopId, productId, quantity, deliveryReference?, notes? }` → `{ receipt, transaction }`. The request schema has no `status` field, so a client cannot force `"status": "APPROVED"` at submission — Zod strips anything not in the schema before the controller ever sees it.

### Owner approval / rejection

- **OWNER only.**
- `GET /api/stock-receipts/pending` — every pending receipt, across all shops, populated with shop/product/reporter for the approval UI.
- `POST /api/stock-receipts/:id/approve` → flips the receipt and its linked ledger transaction to `APPROVED`, stamps `approvedBy`/`approvedAt` on both, and returns the resulting balance.
- `POST /api/stock-receipts/:id/reject` → `{ reason }` (required) → flips the receipt to `REJECTED` with `rejectedBy`/`rejectedAt`/`rejectionReason`, and the linked ledger transaction to `REJECTED`. Rejected transactions never affect stock.
- Once resolved (approved or rejected), a receipt cannot be approved or rejected again — every such attempt returns `409 Conflict`.

### Concurrency & consistency strategy

The local MongoDB instance this project runs against is a **standalone server, not a replica set** (confirmed via `rs.status()` → *"not running with --replSet"*), so real multi-document ACID transactions are not available here — and this codebase does not pretend otherwise. There are three distinct multi-document risk points in Phase 2, each handled differently based on what it actually needs:

**1. Double-approval (a race between two concurrent requests).** Approve/reject don't need a transaction to be correct. They use a single-document atomic conditional update — `findOneAndUpdate({ _id, status: 'PENDING' }, { status: 'APPROVED', ... })` — on the `InventoryTransaction` (the actual source of truth) first. MongoDB guarantees exactly one concurrent request can win that update; the loser gets back `null` and the request fails with `409` before touching anything else. Only the winner proceeds to update the `StockReceipt`. This gives the same "exactly one winner, no duplicate stock effect" guarantee a transaction would, without needing a replica set. **Verified directly**: firing two simultaneous approve requests at the same receipt results in exactly one `200` and one `409`, with the balance reflecting the receipt's quantity exactly once. The identical pattern protects opening-stock initialization via the database's own unique index (see below) — two simultaneous `POST /api/inventory/opening-stock` calls for the same shop/product also resolve to exactly one `201` and one `409`. (`tests/stockReceipt.test.js`, `tests/openingStock.test.js`)

**2. Stock receipt submission (a genuine multi-document create, no concurrent contention).** Creating a `StockReceipt` plus its linked `InventoryTransaction` is two documents that must agree with each other, but nothing else is racing to create them. `utils/transactionRunner.js` attempts a real session transaction first and transparently falls back to sequential writes the moment MongoDB reports transactions aren't supported (cached per process, so the failed attempt only happens once — confirmed by the retry invariant: MongoDB rejects an unsupported transaction on its very first command, before anything is persisted, so falling back and re-running from scratch can never double-write). Deployed against a replica set or `mongos`, the exact same code gets real transactional guarantees automatically — no code change required.

   On standalone MongoDB, the residual risk is a crash *between* the two writes (or the follow-up link-save) leaving one half orphaned — e.g. a `StockReceipt` with no linked ledger row. **This is compensated for explicitly**, not left as a silent gap: `stockReceiptService.submitStockReceipt` wraps the sequential writes in a try/catch that deletes whatever partially succeeded (the receipt and/or the transaction) before surfacing the failure as `500`, logged under the tag `[STOCK_RECEIPT_PARTIAL_FAILURE]`. If even that cleanup fails (the true worst case — e.g. the database connection drops mid-request), the failure is still surfaced loudly rather than hidden, tagged for manual review. As defense in depth, `approveStockReceipt`/`rejectStockReceipt` also refuse to act on a receipt with no linked transaction at all (tagged `[STOCK_RECEIPT_ORPHANED]`), so even a pre-existing inconsistent document could never be silently approved. **Tested directly**: two dedicated tests use `vi.spyOn` to force a failure at each of the two write points and assert neither document remains afterward (`tests/stockReceipt.test.js`, describe block "standalone-MongoDB partial-failure compensation on submission").

**3. Approval consistency (ledger update succeeds, receipt update then fails).** After the atomic ledger update above wins, the code updates the matching `StockReceipt`. Because the ledger update already guarantees exactly one winner, no *concurrent* approve/reject call can be racing for that same receipt at that point — so if the receipt update still fails to match, the only realistic cause left is a process crash between the two writes. We do **not** attempt to auto-revert the ledger transaction back to `PENDING` in that case: unlike compensating a fresh insert (safe to just delete), reverting an already-`APPROVED` decision is a real business-state mutation that could itself race with a legitimate concurrent read, and silently "un-approving" something a human believes is resolved is worse than a loudly-surfaced inconsistency. `InventoryTransaction` — the actual source of truth for stock — is already correct at that point regardless; only the receipt's *displayed* status could lag. This is surfaced as `500` and logged under `[STOCK_RECEIPT_STATE_DIVERGED]` for manual review rather than pretending an automatic fix exists.

### Audit logging (activated in Phase 2)

`services/auditService.js` is the only code path that writes to `AuditLog`, and it's append-only — no update/delete route exists for it. It records at least:

- `OPENING_STOCK_CREATED`
- `STOCK_RECEIPT_SUBMITTED`
- `STOCK_RECEIPT_APPROVED`
- `STOCK_RECEIPT_REJECTED`

Each entry carries `userId`, `shopId`, `action`, `entityType`, `entityId`, `previousValue`/`newValue` where meaningful, `reason` where meaningful, `ipAddress`, `userAgent`, and `createdAt`.

**Audit writes are best-effort, and that tradeoff is deliberate, not accidental.** A failed audit insert is caught and logged to the server console under the tag `[AUDIT_WRITE_FAILED]` with full context (action, entity, user, shop, the original error) — it is not silently swallowed, and that tag is meant to be wired to log-based alerting in production. What it does *not* do is roll back or fail the real inventory action the caller is waiting on. That's a considered tradeoff, not an oversight: on a **transaction-capable MongoDB deployment (replica set / mongos)**, the correct production behavior is to write the business mutation and its required audit record atomically in the same session — the same `session.withTransaction()` pattern `utils/transactionRunner.js` already uses. That is intentionally *not* done on this project's standalone MongoDB, because wrapping the mutation itself in a "the audit write must also succeed" transaction would mean a lost audit write silently rolls back the real inventory action too — trading "audit loss is possible" for "an owner's approve/reject can mysteriously fail for reasons that have nothing to do with the receipt itself." Between those two failure modes, silent-audit-loss-but-logged is the safer one for a standalone instance; full atomicity is the right answer once a replica set is available, not before.

### Inventory & stock-receipt API summary

| Endpoint | Access |
| --- | --- |
| `POST /api/inventory/opening-stock` | OWNER only |
| `GET /api/inventory/shop/:shopId` | OWNER (any shop); everyone else, including ADMIN (assigned shops only) |
| `POST /api/stock-receipts` | OWNER, MANAGER, SALESPERSON — only for a shop they can access. **Not ADMIN** (see below) |
| `GET /api/stock-receipts/pending` | OWNER only |
| `GET /api/stock-receipts` (filters: `shopId`, `status`, `productId`) | OWNER (all shops, or filtered); everyone else, including ADMIN (their assigned shops only) |
| `POST /api/stock-receipts/:id/approve` | OWNER only |
| `POST /api/stock-receipts/:id/reject` | OWNER only |

No `DELETE` endpoint exists for `InventoryTransaction`, and none is planned — approved ledger history is never deleted; corrections are a future reversal workflow.

### ADMIN role in Phase 2 (intentional, verified)

The spec named `OWNER`, `MANAGER`, and `SALESPERSON` explicitly for every Phase 2 workflow and never mentioned `ADMIN`. Rather than guess at intended `ADMIN` behavior, it was deliberately left with **exactly the same access a `MANAGER`/`SALESPERSON` gets, minus anything the spec didn't name it for** — i.e. `ADMIN` is treated as an ordinary shop-scoped role for reads (same as Phase 1), and excluded from every Phase 2 write endpoint the spec didn't explicitly grant it. Confirmed by both code inspection and dedicated tests (`tests/openingStock.test.js`, `tests/stockReceipt.test.js`, `tests/inventoryBalance.test.js`):

- **ADMIN cannot**: initialize opening stock (`403`), submit a stock receipt (`403`), view the pending-approvals queue (`403`), approve a receipt (`403`), or reject a receipt (`403`).
- **ADMIN can**: read inventory balances for a shop it's assigned to (`GET /api/inventory/shop/:shopId`), and view stock-receipt history scoped to its assigned shops (`GET /api/stock-receipts`) — the same read access any non-owner role has, unrelated to the approval workflow.

This is a design choice, not an accidental gap — revisit it explicitly if a later phase defines real `ADMIN` responsibilities.

## Phase 3: daily sales & reconciliation

Phase 3 answers one question per shop/product/business-day: **"were the bags and the money reported consistent with what should have been there?"** It never tries to auto-fix the answer if it's "no."

> **A physical stock discrepancy never automatically changes official inventory. A money discrepancy never automatically changes sales quantities or prices.** Both are recorded exactly as calculated, permanently, on the `DailySalesReport` snapshot — correcting them is a future, explicit owner adjustment/reversal workflow, not something this phase does silently.

### Business date (`businessDate`)

`createdAt` is a UTC wall-clock timestamp and is **not** the business date. Every Phase 3 (and now Phase 2) record carries an explicit `businessDate` string in canonical `YYYY-MM-DD` form, computed in the **Africa/Lagos** timezone via `utils/businessDate.js` (`Intl.DateTimeFormat` with an explicit `timeZone: 'Africa/Lagos'` — never the server machine's own timezone). Lagos has no DST, but the code still goes through `Intl` rather than hardcoding a UTC+1 offset, since that's the correct general approach. Future business dates are always rejected.

### Sales lines & multiple prices per day (intentional)

A single business day can have more than one selling price — e.g. a price change mid-afternoon. `DailySalesReport.salesLines` is an array of `{ quantity, unitPriceKobo, lineRevenueKobo }`, 1–20 lines. **Each line's price is stored permanently on the report.** Changing the active `ShopPrice` tomorrow (or five minutes later) never recalculates yesterday's — or even today's already-submitted — report; verified directly (`tests/dailySalesReport.test.js` "Price history independence", and confirmed live by changing a shop's active price after submission and re-reading the report unchanged). The active `ShopPrice` is only ever used as a **UI default** for the first line via `GET /api/shop-prices/shop/:shopId/product/:productId/current` — staff can override it if the actual selling price differed.

### Money: integer kobo only

All money fields (`unitPriceKobo`, `lineRevenueKobo`, `expectedRevenueKobo`, `actualAmountCollectedKobo`, `moneyVarianceKobo`, and `ShopPrice.priceKobo`) are **integer kobo**, never a floating-point Naira number. `utils/money.js` (server) and `utils/money.js` (client) convert Naira input to kobo via **string manipulation**, not `parseFloat(x) * 100` — a naive float multiplication can misround values like ₦12.15 due to binary floating-point representation; string-based parsing avoids that entirely (verified in `tests/money.test.js`, including a large-value test proving no drift). Every money field is validated as a JS safe integer (`Number.isSafeInteger`).

### Formulas

```
availableStockQuantity = openingStockQuantity + approvedStockReceivedQuantity
expectedClosingStockQuantity = availableStockQuantity − totalQuantitySold
stockVarianceQuantity = physicalClosingStockQuantity − expectedClosingStockQuantity
    (negative = SHORTAGE, positive = SURPLUS, zero = BALANCED)

lineRevenueKobo = quantity × unitPriceKobo            (per sales line)
expectedRevenueKobo = SUM(lineRevenueKobo)
moneyVarianceKobo = actualAmountCollectedKobo − expectedRevenueKobo
    (negative = short, positive = excess collected, zero = BALANCED)
```

**Opening stock for a business date** is the approved ledger balance strictly *before* that date, with one deliberate exception: if the shop's `OPENING_STOCK` initialization itself happened *on* that business date, it counts as available for that first day (otherwise a shop initialized and sold to on the same day would incorrectly show zero opening stock). Implemented in `inventoryService.getOpeningStockForBusinessDate` — a reusable service function, not duplicated ledger math in a controller.

**Approved stock received for a business date** counts only `APPROVED` `STOCK_RECEIPT`/`IN` transactions dated exactly that day — `PENDING` and `REJECTED` receipts never count (`inventoryService.getApprovedStockReceivedForBusinessDate`).

**Insufficient stock**: if `totalQuantitySold` would exceed `availableStockQuantity`, submission is rejected with `409` rather than silently producing a negative expected closing stock.

### Physical count vs. official ledger (the critical invariant)

The worked example from the spec, verified live end-to-end against a running server:

```
Opening stock:      1000
Approved receipts:   500
Bags sold:          -400
Expected closing:   1100   ← this is what the ledger balance becomes
Physical closing:   1097
Stock variance:       -3   ← SHORTAGE, recorded on the report only
```

`GET /api/inventory/shop/:shopId` continues to report **1100** after this submission — the physical count of 1097 is stored on the `DailySalesReport` for visibility and never overwrites, adjusts, or otherwise touches the ledger. The only way official stock changes is the `SALE` transaction itself (`-400`, `APPROVED`, immediate — sales don't require owner approval in Phase 3, unlike stock receipts).

### Closed business-date rule

Submitting a `DailySalesReport` for shopId+productId+businessDate **closes** that business day for that shop/product:

- A second report for the same `{shopId, productId, businessDate}` is rejected (`409`) — enforced by a **database-level unique index**, not just an app-level check (verified with a real concurrent-submission test: two simultaneous requests, exactly one `201`, one `409`, exactly one `SALE` effect).
- A report dated earlier than an already-closed later date for the same shop/product is rejected (`409`) — protects chronological ledger integrity.
- A **new stock receipt** dated a day already closed by a report, or backdated before an already-closed later day, is rejected (`409`) — see `stockReceiptService.submitStockReceipt`.
- A report **cannot** be submitted while a stock receipt for that exact shop/product/business-date is still `PENDING` (`409`) — expected closing stock isn't authoritative until that receipt is resolved one way or the other.

### Report immutability

A submitted `DailySalesReport` is permanent in Phase 3 — there is no edit or delete endpoint (`PUT`/`PATCH`/`DELETE` all return `404`, verified by test). A future reversal/correction workflow will handle mistakes without erasing history, the same principle Phase 2 established for stock receipts.

### Concurrency & standalone-MongoDB compensation (reuses the Phase 2 strategy)

Creating a `DailySalesReport` plus its linked `SALE` `InventoryTransaction` is the same shape of multi-document problem Phase 2 solved for stock receipts, and reuses the identical strategy (see "Concurrency & consistency strategy" above): `utils/transactionRunner.js` attempts a real session transaction and falls back to sequential writes with explicit compensating cleanup on this standalone instance. Two dedicated tests force a failure at each write point (`vi.spyOn`) and assert no orphaned `DailySalesReport` or `SALE` transaction remains in either case.

### API endpoints

| Endpoint | Access |
| --- | --- |
| `POST /api/daily-reports` | OWNER, MANAGER, SALESPERSON — only for a shop they can access. **Not ADMIN** |
| `GET /api/daily-reports` (filters: `shopId`, `productId`, `businessDate`) | OWNER (all/filtered); everyone else, including ADMIN (assigned shops only) |
| `GET /api/daily-reports/:id` | Same shop-access rule, checked against the report's own shop |
| `GET /api/daily-reports/summary?businessDate=YYYY-MM-DD` | OWNER only — cross-shop view for one business date |
| `GET /api/shop-prices/shop/:shopId/product/:productId/current` | OWNER (any shop); everyone else (assigned shops only) — read-only UI default |

No edit/delete endpoints exist for `DailySalesReport`, matching the immutability rule above.

### Authorization (ADMIN, again)

Same conservative stance as Phase 2: `ADMIN` gets no new write capability here either. It cannot submit a daily report (`403`, tested) but can read reports for shops it's assigned to, exactly like Phase 2's inventory/receipt reads.

### What Phase 3 still doesn't do

No credit sales, expenses, payroll, stock transfers, advanced reporting, or automatic stock/money adjustment — all explicitly out of scope. No adjustment/reversal workflow yet (a discrepancy is recorded, never auto-corrected); that's an explicit future phase, as the spec requires. **Phase 4 (below) is that adjustment/reversal workflow.**

## Phase 4: corrections & discrepancy resolution

Phase 4 introduces two **deliberately separate** concepts that must never substitute for each other:

- **Correction** — "the salesperson entered the wrong information." A data-entry mistake in an already-submitted report. Fixed by requesting and approving a correction, which produces an immutable new snapshot and, if the sold quantity changed, a reversal + replacement ledger effect. The original report and its original `SALE` transaction are never edited or deleted.
- **Discrepancy resolution** — "the report was accurate, but a real shortage/surplus/damage happened." The report stays exactly as submitted; the owner posts an explicit ledger adjustment (`DAMAGE`/`SHORTAGE`/`SURPLUS`) that brings official stock in line with reality, or a money-variance resolution record (no ledger effect) explaining a cash discrepancy.

**Never use one to hide the other.** A stock adjustment must never be used to paper over an incorrect report, and a report correction must never be used to make a real shortage disappear — which is exactly why Phase 4 blocks a new correction once any active variance resolution exists against the report (see "Correction ↔ resolution blocking" below).

### Immutable report architecture

Nothing about Phase 1–3's immutability guarantees changes: a submitted `DailySalesReport` still has no edit/delete endpoint, and an `APPROVED` `InventoryTransaction` is still never mutated. Phase 4 adds three new collections, all governed by the same rule — **create new immutable records, never rewrite old ones**:

- `DailyReportCorrectionRequest` — a staff-submitted proposal (PENDING/APPROVED/REJECTED). Never edited after creation; approval/rejection are terminal status transitions on this one document, not edits to its proposed content.
- `DailySalesCorrection` — an approved correction **snapshot**, created once and never touched again. A second correction creates a *new* `DailySalesCorrection` (`correctionNumber` 2, 3, ...) rather than editing the first.
- `StockVarianceResolution` / `MoneyVarianceResolution` — owner-posted discrepancy records. Never edited; a mistake is undone via `/reverse`, which marks the record `REVERSED` and (for stock) posts an opposing ledger transaction — the original resolution row still exists, permanently, as part of the history.

### Effective-report concept

"What is the corrected version of this report, right now?" is answered by one reusable service function, `dailyReportCorrectionService.getEffectiveDailyReport(reportId)` (exposed as `GET /api/daily-reports/:id/effective`), never duplicated in a controller:

- **effective** = the latest **approved** `DailySalesCorrection` for the report, or the original report itself if none exists yet.
- A **rejected** correction request never produces a `DailySalesCorrection` at all — so it can never become effective, by construction, not by an extra filter.
- The **original** report is always still separately queryable (`GET /api/daily-reports/:id` — unchanged from Phase 3) and its own stored numbers never change, no matter how many corrections happen later. The owner summary and history list display *original* stored values (Phase 3 behavior, unchanged); the dedicated `/effective` endpoint is what the UI uses whenever it needs the corrected numbers, and the frontend shows a **"Corrected"** badge whenever `isCorrected` is true rather than silently presenting corrected numbers as if nothing happened.

### Correction request workflow

- `POST /api/daily-reports/:id/corrections` — **OWNER, MANAGER, SALESPERSON** (not `ADMIN`) for a shop they can access. The body is the **complete proposed corrected state** (sales lines, physical closing stock, actual amount collected, notes, and a required `reason`) — never a partial patch, so review is unambiguous.
- Only **one PENDING request per report at a time**, enforced by a partial unique index on `{dailySalesReportId}` where `status: "PENDING"` — not just an app-level check.
- Every server-calculated field on `DailySalesReport` (`expectedRevenueKobo`, `stockVarianceQuantity`, `status`, `submittedBy`, ...) has no equivalent field on the request schema at all — sending one does nothing; it's silently stripped by Zod before the controller sees it.
- `GET /api/daily-reports/:id/corrections` — full request history (all statuses) for a report, shop-scoped the same way the report itself is.
- `GET /api/correction-requests/pending` — **OWNER only**, across all shops.

### Correction approval / rejection

- `POST /api/correction-requests/:id/approve` and `.../reject` — **OWNER only**. Rejection requires a `reason`; an already-approved or already-rejected request returns `409` on either action.
- Approval is gated by the same atomic-conditional-update pattern as every other approval in this codebase: `findOneAndUpdate({ _id, status: 'PENDING' }, { status: 'APPROVED', ... })`. Exactly one concurrent approval attempt can win — verified with a real concurrent-request test (two simultaneous approvals, exactly one `200` and one `409`, exactly one `DailySalesCorrection` created).
- **What "approve" actually means the request stays honest about**: the atomic flip happens *first* (that's the concurrency guarantee), and only then does the service compute the corrected snapshot and post any ledger effects. If that second part fails for any reason, the request is reverted back to `PENDING` (not left falsely `APPROVED` with nothing behind it) and the failure is logged loudly — see "Concurrency & compensation" below.
- The historical base for every calculation (`openingStockQuantity`, `approvedStockReceivedQuantity`, `availableStockQuantity`) is always read from the **original** `DailySalesReport`, never recalculated from today's ledger — this is what makes "correction of a correction" (below) still get history right.

### Reversal/replacement ledger behavior

If the corrected total quantity sold **differs** from whatever is currently effective, the old `SALE` is never edited — a `REVERSAL` (opposing direction, opposing the *currently effective* sale) is posted, then a new `SALE` with the corrected quantity:

```
Original:            SALE  OUT 400
Correction to 390:    REVERSAL  IN  400   (opposes the sale it reverses — referenceId points to it)
                       SALE     OUT 390   (referenceId points to the new DailySalesCorrection)
Net ledger effect:  -390
```

Verified live end-to-end and by test: after this, `GET /api/inventory/shop/:shopId` reflects the ledger correctly, the **original** `SALE OUT 400` transaction is still fully queryable and unmodified, and the **original** `DailySalesReport` still reports `totalQuantitySold: 400` (its own immutable field). `DailySalesCorrection.reversalInventoryTransactionId` / `.replacementSaleInventoryTransactionId` record both new transactions; `.effectiveSaleInventoryTransactionId` always points at whichever `SALE` is now the source of truth for this report's inventory effect.

**If the quantity is unchanged** — only price lines, physical count, actual collected, or notes differ — **no reversal/replacement is created**. The existing effective `SALE` transaction remains the inventory effect; only the `DailySalesCorrection` snapshot changes for revenue/reconciliation display. Verified by three separate tests (price-only, physical-only, money-only corrections all produce zero new `InventoryTransaction` documents).

### Correction-of-correction behavior

A later correction always reverses whatever is **currently effective**, not the original, however many corrections deep:

```
Original:      400 sold  (SALE OUT 400)
Correction #1: 390 sold  → REVERSAL IN 400, SALE OUT 390   (effective is now 390)
Correction #2: 395 sold  → REVERSAL IN 390, SALE OUT 395   (reverses #1's effective sale, not the original 400)
Net ledger effect: -395
```

`DailySalesCorrection.supersedesCorrectionId` links each correction to the one before it, so the full chain — original report, `SALE OUT 400`, Correction #1's `REVERSAL`/`SALE`, Correction #2's `REVERSAL`/`SALE` — remains completely visible and queryable, permanently.

### Correction ↔ resolution blocking

Once **any** `ACTIVE` stock or money variance resolution exists against a report, a **new correction request is rejected with `409`** — otherwise a resolution could end up describing numbers a correction just made obsolete. The message explains that the resolution(s) must be reversed first. Symmetrically, this is re-checked again at *approval* time (not just request time), in case a resolution was posted while the request sat pending — if so, the approval itself is refused with `409` rather than silently approving into an inconsistent state.

### Stock variance resolution

`POST /api/daily-reports/:id/stock-variance-resolutions` — **OWNER only**. The resolution type must match the **effective** variance's sign — `DAMAGE`/`SHORTAGE` only against a negative (shortage) variance, `SURPLUS` only against a positive (surplus) one; the wrong combination is rejected with `400`. A zero-variance report has nothing to resolve (`409`).

Each `ACTIVE` resolution immediately posts exactly one `APPROVED` `InventoryTransaction` (`DAMAGE`/`SHORTAGE` → `OUT`, `SURPLUS` → `IN`), so official stock catches up with reality — verified against the spec's worked example end-to-end:

```
Daily report:  expected closing 1100, physical 1097, variance -3
Owner resolves DAMAGE 2   → DAMAGE OUT 2  → official stock 1098, remaining variance -1
Owner resolves SHORTAGE 1 → SHORTAGE OUT 1 → official stock 1097, remaining variance 0
The DailySalesReport itself still shows: expected 1100, physical 1097, variance -3 (unchanged, forever).
```

**Partial resolution** is fully supported — the remaining unresolved magnitude is always server-derived (`ABS(effectiveVariance) − SUM(active resolution quantities)`, sign preserved), never trusted from the frontend.

### Posting business-date rules

A resolution's ledger transaction needs its own `businessDate`, computed by the reusable `dailySalesReportService.resolvePostingBusinessDate()`:

- **No later report exists** for this shop/product after the source report's date → post on the **source business date itself**. This is an explicit, report-tied owner adjustment, not a hidden mutation — nothing later has used that date's totals yet, so there's nothing to silently rewrite.
- **A later report already exists** → posting on the source date would retroactively sit "before" numbers that later report already computed and stored, so instead post on **today's** Africa/Lagos date — but only if today itself isn't already closed by a report for this shop/product (if it is, `409`: "cannot be inserted into an already-closed sequence").

### effectKey idempotency

`InventoryTransaction.effectKey` is a sparse, unique string set only by Phase 4 workflow-driven ledger effects (`daily-correction:<correctionRequestId>:reversal`, `...:replacement-sale`, `stock-resolution:<resolutionId>:adjustment`, `...:reversal`). A duplicate `effectKey` insert fails at the database level (tested directly) — this is a defense-in-depth idempotency backstop for these specific, identifiably-keyed ledger effects, layered on top of (not instead of) the atomic conditional updates that are the actual primary correctness guarantee. Phase 1–3 transactions never set this field and are entirely unaffected (sparse index).

### Inventory type/direction invariants

A document-level validator (`InventoryTransaction.pre('validate')`) now enforces: `OPENING_STOCK`/`STOCK_RECEIPT`/`SURPLUS` must be `IN`; `SALE`/`DAMAGE`/`SHORTAGE` must be `OUT`; `REVERSAL` is exempt (it must be able to oppose either direction). `TRANSFER_IN`/`TRANSFER_OUT`/`ADJUSTMENT` are deliberately left unconstrained — transfers aren't implemented yet and nothing creates an `ADJUSTMENT` row in this codebase. Every legitimate historical combination from Phases 1–3 still validates; every invalid one (`SALE`+`IN`, `STOCK_RECEIPT`+`OUT`, etc.) is now rejected and tested.

### Money variance resolution

`POST /api/daily-reports/:id/money-variance-resolutions` — **OWNER only**. This is an **accountability record, not a cash ledger** — it **never** creates an `InventoryTransaction`. Same partial-resolution and remaining-amount math as stock resolution, in integer kobo throughout (no floating-point):

```
Effective money variance: -₦25,000 (-2,500,000 kobo)
RECOVERED ₦10,000        → remaining -₦15,000
ACCEPTED_SHORTAGE ₦15,000 → remaining ₦0
```

For a positive (excess) variance, `EXCESS_CONFIRMED`/`REFUNDED`/`EXPLAINED` are the available types. A zero-variance report rejects any resolution attempt (`409`); an amount exceeding the remaining unresolved magnitude also rejects (`409`).

### Reversing a resolution

`POST /api/stock-variance-resolutions/:id/reverse` and `POST /api/money-variance-resolutions/:id/reverse` — **OWNER only**, both require a `reason`. Neither deletes nor edits the original resolution — it's marked `REVERSED` (permanently visible in history) and, for a stock resolution, an opposing `REVERSAL` `InventoryTransaction` is posted (a reversed `SHORTAGE OUT 1` becomes `REVERSAL IN 1`; a reversed `SURPLUS IN 2` becomes `REVERSAL OUT 2`). A `REVERSED` resolution no longer counts toward resolved variance, and the same resolution can never be reversed twice (`409`, atomically gated the same way approve/reject is).

### Concurrency & compensation strategy (Phase 4)

Same honesty about standalone MongoDB as every earlier phase — this environment's local MongoDB is confirmed standalone (no replica set), so real multi-document transactions aren't available, and this codebase doesn't pretend otherwise. Three genuinely different concurrency problems, three different (matched-to-the-problem) solutions:

1. **Double-approval / double-reversal** (a request racing another identical request) — the existing atomic conditional-update pattern (`findOneAndUpdate` gated on current status) is sufficient and needs no transaction. Verified with real concurrent-request tests for correction approval and for both resolution-reversal endpoints.
2. **Over-resolution** (two concurrent resolution requests that individually fit but together would exceed the remaining variance) — this is the one genuinely new problem Phase 4 introduces, and it's solved with an **atomic reservation**: `DailySalesReport.resolvedStockVarianceMagnitude` / `.resolvedMoneyVarianceMagnitudeKobo` are incremented via a single `findOneAndUpdate` whose filter includes `$expr: { $lte: [...] }` checking the *post-increment* total against the variance's magnitude — the increment and the bound-check happen in one atomic single-document operation, so the second of two concurrent requests simply fails to match once the first has already raised the counter. No read-then-write race window, no optimistic-retry loop needed, and it never trusts a client-supplied "remaining" number. Verified directly: two concurrent resolution requests that would individually fit but together exceed the variance — exactly one succeeds. This counter deliberately lives on the report itself rather than per-correction, which is safe specifically *because* a correction is blocked while any resolution is active — at most one "resolution period" is ever open per report at a time, regardless of which version is effective.
3. **Correction compensation** (the one genuine multi-document *create*: `DailySalesCorrection` + optional `REVERSAL` + optional replacement `SALE`) — reuses the exact Phase 2/3 `transactionRunner.js` pattern: attempt a real session transaction, fall back to sequential writes with compensating cleanup on this standalone instance. Uniquely for Phase 4, if the ledger-effect creation fails *after* the correction request was already atomically flipped to `APPROVED`, the request is explicitly reverted back to `PENDING` (logged under `[DAILY_CORRECTION_PARTIAL_FAILURE]`) so it never sits permanently `APPROVED` with nothing behind it — verified with a forced-failure test.

Where a resolution's own ledger transaction creation fails after its atomic reservation succeeded, the reservation is explicitly given back (`$inc` the negative amount) before surfacing the error — verified with a forced-failure test for both stock and money resolutions.

## Folder structure

```
server/
  src/
    config/       env loading, MongoDB connection
    controllers/  request handlers (thin — call services)
    middleware/   auth, validation, error handling, rate limiting
    models/       Mongoose schemas (User, Shop, Product, ShopPrice,
                   InventoryTransaction, AuditLog, StockReceipt,
                   DailySalesReport, DailyReportCorrectionRequest,
                   DailySalesCorrection, StockVarianceResolution,
                   MoneyVarianceResolution)
    routes/       Express routers
    services/     business logic (auth, users, shop access, inventory
                   balances, opening stock, stock receipts, daily sales
                   reports, shop prices, audit, report corrections, stock
                   variance resolution, money variance resolution)
    utils/        constants, ApiError, response helpers, JWT/cookie helpers,
                   optional-transaction runner, money (integer kobo),
                   businessDate (Africa/Lagos), variance (remaining-magnitude
                   math)
    validators/   Zod schemas
    seed/         development seed script
    migrations/   idempotent, additive data migrations (see "Tests" below
                   for how they're verified)
  tests/          Vitest + Supertest test suite

client/
  src/
    api/          Axios client + typed request helpers (auth, shops,
                   inventory, stock receipts, daily reports, shop prices,
                   corrections, variance resolutions)
    context/      AuthContext (session state via TanStack Query)
    routes/       ProtectedRoute
    utils/        money (Naira <-> kobo), businessDate (Africa/Lagos)
    pages/        LoginPage, HomePage (role-branches to Owner/Staff home),
                   ShopInventoryPage, PendingApprovalsPage (stock receipts +
                   correction requests), ReceiptHistoryPage,
                   DailyReportFormPage, DailyReportDetailPage (effective
                   values, variance resolution, correction history),
                   CorrectionRequestFormPage, OwnerDailySummaryPage
    components/   AppShell (mobile-first top bar + bottom tab nav)
```

## Prerequisites

- Node.js 18+ (developed against Node 22)
- A running MongoDB instance (local install or Atlas). The developer machine this was built on uses a local MongoDB service on `127.0.0.1:27017`.

## Environment variables

Copy the example files and fill in real values before running anything:

```
server/.env.example  →  server/.env
client/.env.example  →  client/.env
```

**`server/.env`**

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` / `production` / `test` |
| `PORT` | API port (default 5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign auth JWTs — **generate a real random value**, never reuse the example |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `COOKIE_NAME` | Name of the httpOnly auth cookie |
| `CLIENT_ORIGIN` | Frontend origin allowed by CORS |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` | Login rate limiting |

**`client/.env`**

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Base URL of the backend API (e.g. `http://localhost:5000/api`) |

## MongoDB setup

Any of these work:

- Install MongoDB Community Server locally and run it as a service (what this project was developed against), or start it manually: `mongod --dbpath <path>`.
- Use MongoDB Atlas and put the connection string in `MONGO_URI`.

The app will fail fast on startup if `MONGO_URI` is missing or the connection fails.

## Installation

```bash
# from the repo root
cd server && npm install
cd ../client && npm install
```

## Running the app

```bash
# terminal 1
cd server
npm run dev      # nodemon, http://localhost:5000

# terminal 2
cd client
npm run dev      # vite, http://localhost:5173
```

`GET http://localhost:5000/api/health` should report `{"success":true,"data":{"status":"ok", ...}}`.

## Seed data

```bash
cd server
npm run seed
```

This **wipes and re-seeds** `Users`, `Shops`, `Products`, and `ShopPrice` in whatever database `MONGO_URI` points to — only ever run it against a development database. It refuses to run at all if `NODE_ENV=production` (hard exit, not just a comment), so it cannot accidentally wipe and reseed a production database. It does not create any opening stock or stock receipts — every seeded shop starts with zero inventory so the Phase 2/3 workflow can be exercised from a clean slate. `ShopPrice` rows are seeded directly with `priceKobo` (the Phase 3 field).

Seeds:
- 1 product: Lafarge Cement (`LAF-50KG`, unit `bag`)
- 3 shops: Shop A (`SHOP-A`), Shop B (`SHOP-B`), Shop C (`SHOP-C`)
- 1 OWNER, 1 MANAGER (assigned to Shop A), 1 SALESPERSON (assigned to Shop A)
- A current selling price per shop for the seeded product (integer kobo)

### Migrations (Phase 3)

```bash
cd server
npm run migrate
```

Runs two one-time, **additive and idempotent** data migrations against `MONGO_URI` — safe to run against development *or* production, and safe to run more than once (unlike `seed`, these are deliberately **not** guarded against `NODE_ENV=production`, since backfilling a missing field on real data is exactly what a production database needs when a schema evolves):

1. `migrations/2026-09-shopprice-price-to-kobo.js` — backfills legacy `ShopPrice.price` (Naira) into `priceKobo` (integer kobo) via `utils/money.js`'s string-based `nairaToKobo`, then removes the old field.
2. `migrations/2026-09-business-date-backfill.js` — backfills `businessDate` onto pre-Phase-3 `StockReceipt` and `InventoryTransaction` documents, derived from `receivedAt`/`createdAt`/`approvedAt` via `utils/businessDate.js` (Africa/Lagos). `StockReceipt` is migrated first so linked `STOCK_RECEIPT`-type ledger rows can inherit the receipt's `businessDate` for consistency.

Both operate on raw collections (not the Mongoose model) so they can read documents from before the schema required these fields, and both were verified against this project's own `kantillon_dev` database, which had live test data predating Phase 3: 3 `ShopPrice`, 5 `InventoryTransaction`, and 3 `StockReceipt` documents were migrated with **zero data loss** (same document counts before and after), and a second run confirmed idempotency (`0 document(s) migrated`).

### Development credentials

**Do not use these in production.** They exist only for local development against the seed data.

| Role | Email | Password |
| --- | --- | --- |
| OWNER | `owner@kantillon.dev` | `DevPass123!` |
| MANAGER (Shop A) | `manager@kantillon.dev` | `DevPass123!` |
| SALESPERSON (Shop A) | `sales@kantillon.dev` | `DevPass123!` |

## Tests

```bash
cd server
npm test
```

Tests run against a real local MongoDB database (`kantillon_test` by default, override with `MONGO_TEST_URI`) rather than a mock, so a MongoDB instance must be reachable when running them. Test files run sequentially (not in parallel) since they share that one database.

**Test database safety guard.** Every destructive test operation (`deleteMany`, `dropDatabase` in `tests/testDb.js`) is gated by `assertSafeTestDatabase()`, which fails closed: it throws unless `NODE_ENV` is exactly `"test"` **and** the actually-connected database name (checked on the live connection, not the configured URI string) is exactly `kantillon_test`. This is verified by `tests/testDbSafety.test.js` and was manually confirmed to block real attempts to run against `NODE_ENV=development` and against a `MONGO_TEST_URI` pointed at `kantillon_dev` — both refused before touching any data. The auth rate limiter is skipped only under `NODE_ENV=test` (`middleware/rateLimiters.js`), since the suite logs in far more often per minute than any real client (each test needs a fresh user after `clearTestDb`); this never applies outside test.

**212 tests across 15 files**, including (Phase 1, preserved unchanged):
- Login succeeds with valid credentials and sets an httpOnly cookie / fails with invalid credentials / rejects a deactivated user
- Unauthenticated requests are rejected on protected routes
- `passwordHash` is never present in any API response
- OWNER can retrieve all shops; a SALESPERSON only sees shops they're assigned to
- `InventoryTransaction` and `ShopPrice` field-level validation

Phase 2 additions:
- Opening stock: OWNER-only creation, SALESPERSON and ADMIN both rejected (403), quantity ≤ 0 rejected, duplicate initialization rejected (409, both the app-level pre-check and a genuine concurrent-request test proving the DB-level unique index holds), immediately affects the derived balance, nonexistent/inactive shop or product handled, malformed id rejected, audit entry created
- Stock receipts: assigned staff can submit, unauthorized shop rejected (403), ADMIN rejected (403 — not in the allowed role list), starts `PENDING`, a client-supplied `status` is ignored, pending receipts don't affect the balance, audit entry created
- Approval/rejection: OWNER-only (SALESPERSON and ADMIN both rejected with 403, including ADMIN against the pending-queue endpoint), approval affects inventory, rejection requires a reason and never affects inventory, already-approved/already-rejected transitions all return `409`, nonexistent receipt returns `404`, malformed id returns `400`, audit entries created, and a genuine concurrent double-approval test (two simultaneous requests) confirms exactly one wins and stock is applied exactly once
- Standalone-MongoDB partial-failure compensation: two tests use `vi.spyOn` to force a failure at each point in the receipt+ledger creation sequence and assert no orphaned document remains in either case
- Inventory balance: only `APPROVED` counts (`PENDING`/`REJECTED`/`VOIDED` excluded), `IN` increases, `OUT` decreases, unauthorized cross-shop read returns `403`, and an ADMIN assigned to a shop can read its inventory (confirming ADMIN's read access is intact even though its write access is restricted)
- Test database safety guard behavior itself (5 tests)

Phase 3 additions (65 new tests across `dailySalesReport.test.js`, `money.test.js`, `businessDate.test.js`, plus additions to `stockReceipt.test.js`, `openingStock.test.js`, `inventoryBalance.test.js`, `shopPrice.test.js`, `inventoryTransaction.test.js`):
- Money utilities: Naira→kobo/kobo→Naira conversion without float drift, safe-integer validation, a large-value exactness check
- Business-date utility: canonical `YYYY-MM-DD` output, Africa/Lagos-correct rollover at the UTC boundary, format/calendar validation, comparison, future-date detection
- Migration idempotency: `price`→`priceKobo` and `businessDate` backfills, each run twice with the second run asserted as a no-op, using raw-collection fixtures predating the current schema
- Basic access: assigned salesperson/manager can submit, unauthorized shop and ADMIN both rejected (403), future business date and malformed ids rejected (400), inactive shop/product rejected (400)
- Sales calculations: single- and multi-line revenue calculated correctly, `totalQuantitySold`/line revenue always server-computed, a client cannot spoof `expectedRevenueKobo`/`stockVarianceQuantity`/`status`/`submittedBy`/etc. (all silently stripped or overwritten), fractional quantities and unsafe/non-integer money rejected
- Stock reconciliation: the exact worked example from the spec (opening 1000 + received 500 − sold 400 = expected 1100, physical 1097 ⇒ variance −3, expected revenue ₦4,875,000, collected ₦4,850,000 ⇒ money variance −₦25,000) end-to-end; same-day `OPENING_STOCK` counts on the first business day; approved-only same-day receipts count (pending/rejected excluded); a pending same-day receipt blocks submission (409); zero/negative/positive variance all calculated correctly; the ledger balance is proven unchanged by physical count; reported sales exceeding approved available stock rejected (409)
- Money reconciliation: exact/short/excess collection variance, very large integer values calculated without floating-point drift
- Ledger: exactly one `APPROVED SALE OUT` transaction per report, quantity matches `totalQuantitySold`, balance decreases correctly, a duplicate report never creates a second `SALE` effect
- Concurrency: a genuine simultaneous double-submission test — exactly one `201`, one `409`, exactly one report and one `SALE` effect
- Chronological order: an earlier report after a later one is closed is rejected (409); a new/backdated stock receipt on/before an already-closed day is rejected (409)
- Immutability: no `PUT`/`PATCH`/`DELETE` route exists for a report (all `404`)
- Compensation: two forced-failure tests (`vi.spyOn`) proving no orphaned `DailySalesReport` or `SALE` transaction survives either failure point
- Audit: successful submission creates a `DAILY_SALES_REPORT_SUBMITTED` entry
- Read access: OWNER sees all reports, SALESPERSON/ADMIN see only their assigned shop's reports, an unauthorized report id returns 403
- Price-history independence: changing the active `ShopPrice` after submission never alters an already-saved report's line prices or expected revenue
- Opening-stock hardening: initialization is rejected once any other ledger activity already exists for that shop/product

Also verified live against a running server (not just automated tests): the full opening-stock → receipt → approval → daily-report → inventory-check → owner-summary flow reproduces the spec's worked example exactly, and changing a shop's active price after submission leaves the saved report's `unitPriceKobo`/`expectedRevenueKobo` untouched.

Phase 4 additions (82 new tests across `dailyReportCorrection.test.js`, `stockVarianceResolution.test.js`, `moneyVarianceResolution.test.js`, `inventoryTransactionInvariants.test.js`):
- Correction requests: assigned salesperson/manager can request, unauthorized shop and ADMIN both rejected (403), only one pending request at a time (409), reason required, proposed values validated the same way report submission is, calculated fields cannot be spoofed
- Correction approval/rejection: OWNER-only (non-owner 403), rejection requires a reason, already-approved/already-rejected transitions both return 409, a genuine concurrent double-approval test confirms exactly one winner
- Corrected calculations: quantity/price/collection/physical-count changes each recalculate the right derived field, historical opening/received quantities never change, a correction exceeding historical available stock is rejected (409)
- Ledger correction: a quantity change creates a `REVERSAL` opposing the *effective* sale plus a replacement `SALE` with the corrected quantity (both verified end-to-end against the exact spec worked example, including the resulting ledger balance), the original `SALE` and original report remain fully queryable and unchanged, and three separate tests confirm a same-quantity (price-only / physical-only / money-only) correction creates zero new ledger transactions
- Correction of a correction: a second quantity correction reverses the current effective sale (not the original), `supersedesCorrectionId` links the chain, and full correction history remains queryable
- Effective report: no correction ⇒ original is effective; an approved correction ⇒ it becomes effective; a rejected correction never becomes effective; the owner summary still shows original values while `/effective` shows corrected ones
- Correction ↔ resolution blocking: an active stock or money variance resolution blocks a new correction request (409) in both directions
- Correction compensation: a forced replacement-SALE failure leaves no orphaned correction/reversal and reverts the request back to `PENDING` rather than leaving it falsely `APPROVED`
- Correction audit: request/approval/rejection each create their own audit entry
- Correction authorization/history: staff see correction history only for their assigned shop; the effective-report endpoint is shop-scoped
- Stock variance resolution: `DAMAGE`/`SHORTAGE` accepted only against negative variance, `SURPLUS` only against positive (wrong combination rejected 400), zero variance rejects any resolution (409), the exact spec worked example (`DAMAGE 2` then `SHORTAGE 1` fully resolving `-3`) verified end-to-end including official balance at each step and the original report's variance staying unchanged, over-resolution rejected (409), OWNER-only creation, correct transaction type/direction per resolution type, audit entry created, and a genuine concurrent test proving two requests that would individually fit but together exceed the variance cannot both succeed
- Stock resolution reversal: posts an opposing `REVERSAL` transaction and reopens the variance, cannot reverse twice (409), non-owner cannot reverse (403), reversing a nonexistent resolution returns 404, audit entry created, a genuine concurrent double-reversal test confirms exactly one winner
- Stock resolution compensation: a forced ledger-transaction failure leaves no valid-looking resolution and gives back the reservation
- Money variance resolution: partial resolution for both negative and positive variance, zero variance and over-resolution both rejected (409), creates **zero** `InventoryTransaction` documents, safe-integer kobo preserved exactly, OWNER-only, audit entry created, a genuine concurrent over-resolution test
- Money resolution reversal: reopens the remaining amount with no `InventoryTransaction` involved, cannot reverse twice (409), reversing a nonexistent resolution returns 404, audit entry created
- Money resolution compensation: a forced write failure gives back the reservation and leaves no orphaned resolution
- Inventory type/direction invariants: every invalid combination (`SALE`+`IN`, `STOCK_RECEIPT`+`OUT`, `OPENING_STOCK`+`OUT`, `DAMAGE`/`SHORTAGE`+`IN`, `SURPLUS`+`OUT`) rejected; `REVERSAL` allowed in both directions; every legitimate historical combination still validates
- `effectKey` idempotency: a duplicate `effectKey` is rejected at the database level; documents with no `effectKey` (the Phase 1–3 norm) are unaffected by the sparse unique index

## API surface

**Phase 1:**
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/shops` — OWNER sees all shops; everyone else sees only shops in their `shopIds`
- `GET /api/products` — not shop-scoped, visible to any authenticated user

**Phase 2:** see "Inventory & stock-receipt API summary" above for the full list (`/api/inventory/opening-stock`, `/api/inventory/shop/:shopId`, `/api/stock-receipts` and its sub-routes).

**Phase 3:** see "API endpoints" under "Phase 3: daily sales & reconciliation" above (`/api/daily-reports` and its sub-routes, `/api/shop-prices/.../current`).

**Phase 4:**

| Endpoint | Access |
| --- | --- |
| `POST /api/daily-reports/:id/corrections` | OWNER, MANAGER, SALESPERSON (shop-scoped). Not ADMIN |
| `GET /api/daily-reports/:id/corrections` | Shop-scoped (same rule as the report itself) |
| `GET /api/correction-requests/pending` | OWNER only |
| `POST /api/correction-requests/:id/approve` | OWNER only |
| `POST /api/correction-requests/:id/reject` | OWNER only |
| `GET /api/daily-reports/:id/effective` | Shop-scoped |
| `POST /api/daily-reports/:id/stock-variance-resolutions` | OWNER only |
| `GET /api/daily-reports/:id/stock-variance-resolutions` | Shop-scoped |
| `POST /api/stock-variance-resolutions/:id/reverse` | OWNER only |
| `POST /api/daily-reports/:id/money-variance-resolutions` | OWNER only |
| `GET /api/daily-reports/:id/money-variance-resolutions` | Shop-scoped |
| `POST /api/money-variance-resolutions/:id/reverse` | OWNER only |

No edit or delete endpoint exists for any Phase 4 resource — corrections and resolutions are append-only by design (see "Immutable report architecture" above).

## Frontend (mobile-first)

- **OWNER** sees a Home screen listing every shop with its current balance and a pending-approvals count; tapping a shop opens its inventory, where any uninitialized product shows an "Initialize opening stock" form; a bottom-nav "Approvals" tab lists every pending receipt with Approve / Reject (reason required) actions; a "Daily Summary" tab lets the owner pick a business date and see every submitted shop/product report as a card (bags sold, expected/physical closing, stock status, expected/collected revenue, money status — shortage/surplus stated in text, never color alone), tappable through to the full report detail.
- **MANAGER / SALESPERSON** see a Home screen listing only their assigned shop(s); opening a shop shows its inventory (read-only) plus a "Report stock received" form and a "Submit daily report" link; the daily report form defaults the business date to today's Africa/Lagos date and the first sales line's price to the shop's active `ShopPrice`, supports adding/removing up to 20 price lines, shows a clearly-labeled non-authoritative preview (total bags, expected revenue) before submission, and displays the full backend-calculated result (bags sold, expected/physical closing, stock variance, expected revenue, amount collected, money variance) after; a "History" tab shows their shop's stock-receipt history and status.
- All server state is fetched via TanStack Query; every mutation (opening stock, submit/approve/reject, daily report submission) invalidates the relevant `inventory`, `stockReceipts`, and `dailyReports` query keys so balances and lists refetch automatically. Every page has explicit loading, error (including a distinct message for `403`), and success states.
- Money is entered and displayed in Naira but converted to/from integer kobo via `utils/money.js` (string-based, not `parseFloat(x) * 100`) before ever reaching the API.
- Frontend role checks (e.g. hiding the opening-stock form from non-owners, hiding "Daily Summary" from non-owners) are UX only — every rule is re-enforced server-side, and was verified live: a salesperson hitting the owner-only approve endpoint gets `403`, and a salesperson cannot read another shop's inventory by editing the URL.
- **Phase 4:** the Daily Report detail page (`DailyReportDetailPage`) is now the hub for a report — it fetches the **effective** version (via `/effective`, not the raw original) and shows a "Corrected" badge whenever a correction is effective, with a link through to the correction history. It always shows the resolved/remaining stock and money variance, sourced from the server, never computed client-side. **Any authorized user** with no active resolution blocking it sees a "Request Correction" link (`CorrectionRequestFormPage`, prefilled with the current effective values and a Current → Proposed comparison before submit). **OWNER only** sees "Resolve Stock Variance" / "Resolve Money Variance" forms (hidden entirely for non-owners) plus reversal controls on each active resolution row (an inline reason input, not a native browser dialog). Pending correction requests are surfaced on the existing `PendingApprovalsPage` alongside pending stock receipts, with the same Approve/Reject-with-reason pattern.

## Assumptions made in Phase 1

- User creation is not yet exposed as an API route — `services/userService.createUser` exists and is used by the seed script, ready to be wired to an admin-only route in a later phase.
- Shop/Product creation endpoints are intentionally not built yet (Phase 1 only asked for read access); the models and validators are in place to add them later.
- Tests run against a real local MongoDB database rather than an in-memory server — `mongodb-memory-server` attempted to download a MongoDB binary and was unreliable in this environment; a real local instance was already available and is arguably a better fit for ledger/authorization correctness tests anyway.
- Cookie `sameSite` is `lax` with `secure` tied to `NODE_ENV=production`; revisit if the frontend and backend ever end up on different top-level domains (would need `sameSite: 'none'` + `secure: true` + HTTPS everywhere).

## Assumptions made in Phase 2

- Receipt creation is restricted to exactly the roles the spec named — `OWNER`, `MANAGER`, `SALESPERSON` — not `ADMIN`; `ADMIN` was never given special behavior in Phase 1 either, and the spec didn't mention it for any Phase 2 endpoint, so it wasn't added speculatively.
- `GET /api/inventory/shop/:shopId` does not block reads against an inactive shop (only opening-stock/receipt *writes* are blocked for inactive shops/products) — an owner may reasonably want to view a closed shop's historical balance.
- Audit-log writes are best-effort (see "Audit logging" above for the full reasoning and the production recommendation once a replica set is available) — a failed audit write is silent to the API caller, but not to server logs.
- "Balances for all products in a shop" is implemented as *all active `Product` documents*, each annotated with `balance` (0 if untouched) and `initialized` (whether an `OPENING_STOCK` transaction exists) — since `Product` isn't shop-scoped, this is the natural definition of "all products in a shop."
- The Owner Home screen's per-shop balance line shows the shop's first product line (there is currently exactly one product, Lafarge Cement); this isn't hardcoded to a product name, it just doesn't yet render a multi-product summary, which isn't needed at current scale.

## Known Phase 1 gaps (by design — later phases)

- No dashboards, sales workflows, stock reconciliation, approval UI, or reports.
- No routes yet for creating/editing shops, products, prices — only the read-only `GET` endpoints described above (inventory transactions now have the Phase 2 workflow described above; there is still no generic create/edit route for them).
- No refresh-token rotation; a single long-lived JWT cookie is used.

## Known Phase 2 gaps (by design — later phases)

- No daily sales, end-of-day reconciliation, revenue calculations, stock variance, credit sales, expenses, advanced reporting, or stock transfers — all explicitly out of scope for this phase.
- No adjustment/reversal workflow yet — the model supports it (`ADJUSTMENT`, `REVERSAL` transaction types already exist in the enum), but no service/route uses them yet.
- No pagination on `GET /api/stock-receipts` — acceptable at current scale per the spec; would need adding before shop/receipt counts grow large.

## Assumptions made in Phase 3

- Daily report submission is restricted to `OWNER`, `MANAGER`, `SALESPERSON` — not `ADMIN` — for the same reason as Phase 2's stock receipts: the spec named these roles explicitly and never granted `ADMIN` new write capability.
- "Future business date" rejection uses `400` (a validation-shaped rule, syntactically valid input that's rejected on a business rule) rather than `409`; duplicate/closed-day/chronological-order/pending-receipt conflicts all use `409` (an existing-state conflict), matching the status-code guidance the spec gave elsewhere.
- `GET /api/daily-reports` and `/summary` don't block reads against an inactive shop, mirroring the same Phase 2 decision for inventory reads — only report *submission* is blocked for an inactive shop/product.
- The opening-stock hardening rule ("reject if any other ledger activity already exists") is enforced as an app-level pre-check, not a new database-level constraint — the concurrency guarantee the spec actually asks for (no double opening-stock) was already covered by Phase 2's partial unique index, which this rule doesn't weaken or replace.
- `DailySalesReport.status` has a single enum value (`SUBMITTED`) rather than being left as a free string — deliberately narrow now, but present specifically so a future reversal/correction workflow has somewhere to record a different state without a schema migration.
- Migrations live under `server/src/migrations/` as plain idempotent scripts run via `npm run migrate`, rather than a migration-framework dependency — appropriate at this scale (two migrations, both additive) without pulling in a tool this project doesn't otherwise need.

## Known Phase 3 gaps (by design — later phases)

- No credit sales, expenses, payroll, stock transfers, advanced reporting, or dashboards/charts — all explicitly out of scope for this phase.
- No adjustment/reversal workflow yet for a discrepancy once recorded — a `DailySalesReport`'s variance is calculated and stored permanently, but nothing currently lets an owner act on it beyond seeing it (by design, per the spec: "automatic discrepancy correction" is explicitly excluded from this phase).
- No pagination on `GET /api/daily-reports` — acceptable at current scale, same reasoning as Phase 2's stock-receipt history.
- The owner Daily Summary screen shows one business date at a time with no multi-day trend view — intentionally minimal per the spec ("do not build complex charts/analytics yet").

## Assumptions made in Phase 4

- Correction ledger effects (`REVERSAL`/replacement `SALE`) are always dated with the **original report's** `businessDate`, not `resolvePostingBusinessDate()`'s CASE A/B logic — that logic is specific to stock variance resolution (the spec titles it "stock resolution posting date"). This is safe because a report's stored inventory-context fields (`openingStockQuantity`, etc.) are frozen at submission time, never live-recalculated — so a backdated ledger entry can't retroactively corrupt an already-submitted later report; it only (correctly) affects the always-live overall balance and any *future* date-scoped calculation.
- The two resolution "resolved magnitude" counters (`resolvedStockVarianceMagnitude`, `resolvedMoneyVarianceMagnitudeKobo`) live on `DailySalesReport` itself rather than per-`DailySalesCorrection` — safe specifically because a correction is blocked while either counter is non-zero, so at most one "resolution period" is ever open per report regardless of which version is currently effective. This is the one field Phase 4 makes mutable on an otherwise-immutable document; it's updated exclusively via atomic conditional increments from the two resolution services, never through a generic edit endpoint (none exists).
- A correction-approval failure (after the atomic `PENDING`→`APPROVED` flip but before the ledger effects are successfully created) reverts the request back to `PENDING` rather than introducing a new terminal status — the spec's request model only defines `PENDING`/`APPROVED`/`REJECTED`, and "the approval attempt didn't take effect, try again" is the most accurate description of that state.
- `GET .../stock-variance-resolutions` and `GET .../money-variance-resolutions` have no role restriction beyond shop access (any authorized viewer, including staff, can see resolution history) — only *creating* or *reversing* a resolution is OWNER-only. The spec's frontend section shows resolution history on the owner screen but never says staff must be blocked from seeing it, and Phase 2/3 already established "reads are shop-scoped, writes are role-gated" as the default pattern.
- No new data migration was needed for Phase 4's schema additions (`InventoryTransaction.effectKey`, `DailySalesReport`'s two resolution counters) — both are optional/defaulted fields, and Mongoose applies schema defaults at read time even for pre-existing documents that predate the field, so no backfill script was required (unlike Phase 3's `businessDate`/`priceKobo`, which were `required: true`).

## Known Phase 4 gaps (by design — later phases)

- No credit sales, customer accounts receivable, expenses, payroll, bank reconciliation, stock transfers, purchase orders, general-ledger accounting, or advanced analytics — all explicitly out of scope for this phase.
- No UI for browsing all `StockVarianceResolution`/`MoneyVarianceResolution` records across shops (only per-report history) — acceptable at current scale; a cross-shop discrepancy log is a natural later-phase addition.
- No pagination on any Phase 4 list endpoint — same reasoning as Phase 2/3's history endpoints.
- Once a correction is blocked by an active resolution, there's no dedicated endpoint to list *why* beyond the resolution history already visible on the report detail page — acceptable since that history is already the full explanation.
