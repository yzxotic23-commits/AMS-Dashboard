# AMS Ban Data Collection Mechanism · Requirement Specification (V1)

> Purpose: Submitted to the technical team to modify AMS account-anomaly detection and ban-data collection logic
> Epic: Account Management System (AMS) Build & Rollout (NSE-868)
> Version: V1

---

## 1. Background & Objective

AMS must produce the ban-related data required by the Phase 1 KPIs (ban rate, logout rate, etc.).

**Current problem:** When an account is banned or restricted on the platform, AMS can only observe that "the account went offline." It cannot automatically distinguish whether this is a **permanent ban (Banned)** or a **temporary restriction (Restrict)**, and it cannot accurately record the true time the event occurred.

This revision establishes a **"system detection + human confirmation"** mechanism to ensure ban data is collectable, attributable, and time-accurate.

---

## 2. Core Determination Rules

### 2.1 Detection Signal: Logout of the AMS Keep-Alive Session

Each account maintains a keep-alive Session (a probe) on the AMS side. The purpose of this Session is to detect the account's survival status on the platform — if even a purely idle Session that performs no active operations gets kicked offline by the platform, it indicates the account has encountered an anomaly on the platform side.

- AMS **monitors only its own keep-alive Session**. It does **not** detect the business-side Session (the business Session runs in the business team's environment, and AMS has no stable channel to probe it).
- Once the keep-alive Session logs out, it triggers one "account anomaly event."

### 2.2 Initial Event State: Automatically Set to "Pending Confirmation"

After the keep-alive Session drops, the system does **not** automatically judge whether it is Banned or Restrict. Instead, it automatically sets the account state to **`Pending Confirmation`**. The nature of the event is determined by a human.

### 2.3 Human Confirmation: Resource Team Fills in the Actual Situation

The system prompts the resource team: this account has gone offline and requires checking the true status on the platform using the actual device (phone), then returning to AMS to fill in the confirmed result as one of the following:

- **`Restrict` (temporary restriction)** — recoverable; the account will lift automatically after a period of time
- **`Banned` (permanent ban)** — terminal; the account cannot be recovered

### 2.4 Timestamp Anchoring Rule (Critical)

The **occurrence time** of the event (Restrict / Banned) is **always based on the Logout timestamp of the keep-alive Session**. It does **not** use the operation timestamp of when the resource team fills in the status.

> **Reason:** The resource team may fill in the status with delay; using the fill-in time would distort the data. Anchoring to the Logout timestamp reflects the true moment the event occurred, guaranteeing the time accuracy of the ban data.

### 2.5 State Synchronization to the Business-Side Page

When an account enters the `Pending Confirmation` state, this state must be **synchronized and displayed on the business-side page** (visible when the business team requests accounts or views the account list), so the business team is immediately aware that "this account may already be banned/restricted, and the resource team is verifying it."

---

## 3. Data Record Structure (Account-Level Detail)

For each account anomaly event, record the following fields:

| Field | Description |
|---|---|
| Occurrence Stage | The stage the account was in at Logout: manual nurturing / auto nurturing / in business use |
| Logout Timestamp | System time when the keep-alive Session dropped (used as the basis for event determination and attribution) |
| Disconnect Count | Cumulative number of times this account has dropped offline |
| Confirmation Status | Pending Confirmation / Restrict / Banned (initially Pending Confirmation; nature updated after human fill-in) |

---

## 4. Data Presentation (Two Views)

### 4.1 View One · Account-Level Detail

The structure above — recorded per account, per event — for the resource team's daily operations and verification.

### 4.2 View Two · Aggregate Statistics (Direct KPI Source)

Grouped by "Occurrence Stage," count the number of Banned, Restrict, and Pending Confirmation per stage, and compute the **ban rate by stage** accordingly.

This view directly produces the ban-rate data required by the Phase 1 KPIs and supports attribution by stage (which stage has the most bans).

---

## 5. Definition Boundaries (Preventing Data Pollution)

1. **The ban-rate numerator counts only Banned.** Restrict is a recoverable temporary restriction and is **not** counted in the ban rate; it is tracked separately (observed as a risk-control alert frequency indicator). The two are different in nature and must be separated — otherwise the ban rate will be inflated.

2. **A drop caused by the AMS keep-alive Session's own network / Proxy fluctuation does not equal an account ban.** If such "monitoring interruptions" can be technically identified, they should be classified separately and excluded from ban events. If they cannot be distinguished, they must be excluded during the `Pending Confirmation` human-verification step by the resource team (checking the phone reveals the account is actually fine → mark as false positive, not counted).

3. **A backlog of `Pending Confirmation` is the core risk to data credibility.** The larger the pending-confirmation count, the more incomplete the ban data, directly affecting KPI accuracy. It is recommended to make "pending-confirmation backlog" visibly prominent in the presentation (anomaly-driven), prompting the resource team to handle it promptly.

---

## 6. Event State Flow (Technical Reference)

```
Keep-Alive Session Logout (probe drops offline)
        │
        ▼
 [ Pending Confirmation ]  ◄── synchronized to the business-side page
        │
        │  Resource team verifies actual platform status via phone
        │
        ├────────────────┬────────────────┐
        ▼                ▼                ▼
   [ Restrict ]      [ Banned ]    [ False Positive /
  temp. restriction  permanent ban   Monitoring Interruption ]
  (tracked           (counted in     not counted as ban event
   separately)        ban rate)
        │
   All event occurrence times = Logout timestamp
   (not the resource team's fill-in time)
```
