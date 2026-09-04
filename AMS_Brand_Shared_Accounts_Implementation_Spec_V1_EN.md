# AMS Brand-Shared Accounts · Implementation Spec (V1)

> Purpose: Short build spec after stakeholderalignment (ADS / lead-in shared accounts)
> Epic: Account Management System (AMS) Build & Rollout
> Version: V1
> Status: Scope confirmed — ready to implement

---

## 1. Background & Decision

**Problem:** Lead-in / ADS accounts belong to the **Brand**, not one Sales Member. Current AMS resolves every account as **Brand → Staff (one person)**. Frontline peers under the same Brand cannot request shared accounts without either (a) faking a Staff assignee (locks out others) or (b) leaving Staff empty (account disappears from Standby).

**Decision (confirmed):**
- Do **not** rewrite Personal account logic.
- Add an explicit account type: **Personal** | **Brand-shared**.
- Do **not** ship shared without **append-only usage / request records**.
- Defer full WA login event stream and Governance Sales-Member attribution to Later.

---

## 2. Account Types

| Type | Access | Staff binding | Request path |
|------|--------|---------------|--------------|
| **Personal** (current) | Brand ∩ Staff name match | Required — one Sales Member | Existing Delivery flow |
| **Brand-shared** (new) | Brand only — any business user in that Brand | None — display as Brand-wide / Shared | New Brand-level Standby path |

On create / first business request setup, user **picks the type first**:
- Personal → existing flow (unchanged).
- Shared → Brand path, no individual Staff bind.

Storage (proposal): `_ams_op.account_type: 'personal' | 'brand_shared'` (default `personal` for all existing rows).

---

## 3. Hard Conditions

### 3.1 Traceability — append-only (must)

Lite V1 is enough **only if**:

1. Every shared **request** (and subsequent confirm / release that we record) stores:
   - `account_id`
   - `actor_profile_id` (+ display name snapshot)
   - `action` (e.g. `request`, `confirm`, `disconnect_report`, `return_standby`)
   - **`occurred_at` timestamp** (event time)
2. Records are **cumulative** — **append only, never overwrite**.
3. History is **queryable by account** (list by `account_id` ordered by time).

**Why:** A ban has a timestamp. Matching ban time against the append-only usage log lands on whoever was holding the account then. A single “last requested by” field pins the **wrong** person when use rotates.

Consistent with AMS ledger-only-grows principle.

**UI:** Resource Ledger / account detail shows usage history for shared accounts (not only “current user”). Personal display unchanged.

### 3.2 Session concurrency cap — fixed at 4

WhatsApp allows **at most 4 concurrent sessions** per account. Shared / Main accounts follow this **platform cap = 4**.

- Not a business-configurable AMS setting.
- Soft control in V1: warn / block additional Delivery “go-live / in-use” style handoffs when **4 concurrent active holders** already recorded (definition of “active holder” to be locked in build — default: open Delivery tickets in posted / in-use stages for that account).
- No separate admin parameter.

---

## 4. V1 Scope (build)

### 4.1 ACL
- Centralize in `accountStaff` helpers (API + web).
- `personal` → today’s Staff match.
- `brand_shared` → Brand scope only (skip Staff equality).
- Touch: accounts list/detail, disconnect report, ack notice, tickets list/stats/standby/create/confirm/resubmit.

### 4.2 Resource Ledger (main UI)
- Staff column: **Brand-wide / Shared** for shared type (no single name).
- Staff filter / search: shared rows match Brand / “Shared”, not one person.
- Usage history panel (append-only log).
- Status flow (Standby / In Use / Banned / Restrict / return to Standby): same states; copy and notice fan-out Brand-wide for shared.

### 4.3 Delivery / Standby
- Shared accounts appear in Standby for **all** Brand members.
- Personal: unchanged “assigned to you” filter.
- On request: write append-only usage record with timestamp + actor.

### 4.4 Notices
- Return-to-Standby / business notice: Brand-wide for shared; Personal stays Staff-scoped.

### 4.5 Governance (light)
- Optional V1.1: breakdown or filter **Personal vs Shared** on ban KPIs so pools don’t mix.
- **Not** in V1: attribute ban rate to individual Sales Members via full login stream.

---

## 5. Explicitly out of V1 (Later)

- Full WhatsApp login / session event stream.
- Governance attribution of bans to Sales Member from that stream.
- Multi-staff allowlists / Staff reassignment history for Personal.
- Rewriting Owner / hub KPIs, RM supply `ppl`, FeedFlow, Device/SIM/IP ledgers.

---

## 6. Data sketch (implementation)

**Account meta**
```text
_ams_op.account_type = 'personal' | 'brand_shared'   // default personal
_ams_op.staff        = string | null                 // ignored for ACL when brand_shared
```

**Usage ledger (new table or append-only notes array — prefer table)**
```text
account_usage_events
  id, account_id, actor_id, actor_name,
  action, ticket_id nullable,
  occurred_at, created_at
index (account_id, occurred_at desc)
```

Rules: **INSERT only** — no UPDATE of prior rows for “current holder”.

---

## 7. Acceptance criteria (V1)

1. Existing Personal accounts behave exactly as today (Staff bind + Standby filter).
2. Brand-shared account is requestable by any business user in that Brand.
3. Personal accounts of Peer A are still **not** requestable by Peer B.
4. Each shared request appends a timestamped row; history lists all requests for the account.
5. Overwriting a single “last requester” field is **rejected** in review.
6. Shared concurrency respects **max 4** active holders (platform cap).
7. Ledger shows Brand-wide / Shared + usage history for shared accounts.
8. Return-to-Standby notice reaches Brand peers for shared accounts.

---

## 8. Suggested build order

1. Meta flag + ACL helpers + migration default `personal`
2. Append-only `account_usage_events` + write on ticket request/confirm (+ disconnect if cheap)
3. Delivery Standby / create path for shared
4. Accounts Ledger Staff column + usage history UI
5. Notices Brand fan-out for shared
6. Session cap = 4 guard on shared go-live / concurrent holders
7. Smoke: Personal regression + shared multi-user request + ban-time match against history

---

## 9. Open points to lock during build (not blockers)

- Exact actions that open/close an “active holder” slot toward the 4-cap.
- Whether confirm / logout / return-standby also append usage events (recommend **yes** for request + confirm + disconnect_report at minimum).
- Governance Personal vs Shared split: ship in same PR or immediate follow-up (V1.1).
