# RAHAAL AI CONTEXT

Last updated: 2026-09-12

---

## 1. Project Identity

Rahaal is a multi-tenant travel-agency management system.

Main stack:

- Next.js 15
- React 18
- MongoDB
- App Router
- Main UI: `app/page.js`
- Main API router: `app/api/[[...path]]/route.js`

The system supports travel offices / tenants, clients, suppliers, tickets, visas, services, packages, accounting, vouchers, journal entries, boxes and banks, multi-currency, Rahaal platform administration, RBAC, plans and subscriptions, commissions, orders, advertisements, audit and system administration.

---

## 2. AI Working Rule

Any AI model working on Rahaal MUST read this file first.

Do NOT rescan the whole repository unless the current task genuinely requires it.

After reading this file:

1. Identify the task.
2. Read only files directly relevant to the task.
3. Verify important assumptions against the code.
4. If this document conflicts with current code, report the conflict before modifying anything.
5. Update this document after meaningful architectural changes or major QA results.

---

## 3. Current Architecture

`TenantApp` in `app/page.js` is the canonical shared application UI.

It serves:
- Normal travel offices
- Rahaal Company / Platform Super Admin

The intention is to avoid maintaining two parallel dashboards.

---

## 4. AdminApp Status

The old `AdminApp` architecture is being removed.

Current local Git status includes:

```text
D app/admin/shell.js
M app/page.js
```

`app/admin/shell.js` was the old AdminApp shell and has intentionally been removed locally.

Do NOT restore it unless explicitly requested.
Do NOT delete other `app/admin/*` files automatically.
Some are still reused by TenantApp.

---

## 5. Rahaal Company Tenant

A dedicated local tenant exists for Rahaal Company.

```text
name: شركة رحّال
slug: rahaal-hq-154a
id: 83855067-4c5f-4b33-a3fd-9b26ee8aa9f8
status: active
subscription: paid
plan_tier: standard
is_platform_org: true
```

Do NOT replace it with a demo tenant.

---

## 6. Platform Super Admin

```text
email: admin@targetmedia.com
role: super_admin
active: true
tenant_id: 83855067-4c5f-4b33-a3fd-9b26ee8aa9f8
platform_org: true
```

Relevant backend logic:

```js
isMainSA =
  user.role === 'super_admin' &&
  (!user.tenant_id || user.platform_org === true)
```

Do NOT weaken this protection.
Do NOT convert Platform SA to owner.

---

## 7. Travel Modules Hidden from Platform SA

Disabled permissions:

```text
mod_tickets = false
mod_visas = false
mod_visa_monitor = false
mod_services = false
mod_packages = false
mod_meraaj = false
mod_query = false
```

Current office module set:

```js
SA_OFFICE_MODULES = new Set([
  'tickets',
  'visas',
  'services',
  'packages',
  'meraaj',
  'visa-monitor',
  'query',
  'affiliate'
])
```

Normal tenants are NOT affected.

---

## 8. Platform SA Sidebar

Verified visible groups:

```text
لوحة التحكم
إدارة رحّال
المحاسبة والإدارة المالية
التقارير
النظام والإعدادات
دليل الاستخدام
إدارة المنصة
```

Must NOT show:

```text
أقسام المكتب
إعدادات المكتب
التذاكر
التأشيرات
الخدمات
الباكدجات
معراج
مراقبة التأشيرات
الاستعلامات
التسويق بالعمولة
```

---

## 9. إدارة المنصة

The current "إدارة المنصة" action does NOT switch to AdminApp.

It operates inside TenantApp via internal navigation such as:

```text
platform-offices
```

Do NOT reintroduce `platformView` or old AdminApp switching.

---

## 10. Local Database

```text
MongoDB: mongodb://127.0.0.1:27017
DB_NAME: rahaal_opencode_local
tenantCount: 10
```

Composition:
- 9 tenants restored from Test
- 1 Rahaal Company tenant

---

## 11. Local Environment Safety

`.env` must use:

```env
DISABLE_AUTO_SEED=true
```

Never connect local development changes to Live.
Never modify Live DB.
Test and Live are outside allowed scope unless explicitly approved.

---

## 12. Rahaal Company Seeded Data

```text
COA accounts: 28
Boxes: 2
Service types: 4
```

Boxes:

```text
1101001 — main cash box
1102001 — bank/wallet account
```

---

## 13. Read-Only UI QA

Platform SA UI QA:

```text
16 / 16 sections PASS
```

Confirmed:
- HTTP 200
- Zero unexpected 403
- Zero 404
- Zero 500
- Zero console errors
- Zero failed requests
- No broken navigation
- No functional AdminApp dependency
- Real DB data rendered correctly

---

## 14. Accounting Core QA

Functional write QA:

```text
26 / 26 PASS
```

Tested:
- Customer creation
- Supplier creation
- Account leaf creation
- Receipt voucher
- Payment voucher
- Voucher modification
- Voucher deletion/reversal effect
- Manual journal entry
- Unbalanced journal rejection
- Group-account posting rejection
- Currency exchange
- Box creation
- Final balance invariants

Confirmed:

```text
Stored balances == journal effect == ledger effect
```

No detected:
- Balance mismatch
- Double posting
- Double reversal
- Missing reversal
- Unbalanced stored journal
- Partial financial operation
- Unexpected 4xx/5xx

---

## 15. Rahaal Administration QA

Platform Super Admin administration QA:

```text
12 / 12 PASS
```

Validated:
- Dashboard
- Tenants / Office 360
- Users & Permissions
- Plans & Pricing
- Subscriptions & Installments
- Rahaal Program Sales
- Orders Center
- Commissions Center
- Ads & Offers
- Notifications Center
- System Settings
- Geographic Locations

Environment:
- Local only
- Platform SA: admin@targetmedia.com
- Rahaal Company tenant
- Zero unexpected 4xx/5xx
- Zero console errors
- No functional AdminApp dependency

Known incomplete-by-design items:
1. Commissions financial ledger is intentionally pending explicit approval / new collection.
2. Notification delivery is In-App only; SMS / Push / Email are not implemented.

---

## 16. Security / RBAC / Maker-Checker / Tenant Isolation QA

```text
25 / 25 PASS
```

Validated:
- RBAC visibility (view granted → section shows; view removed → section hides)
- Direct API enforcement (GET allowed, POST/PATCH/DELETE denied server-side)
- Overrides (role-allow + override-deny; role-deny + override-allow)
- Maker–Checker (creator cannot approve own financial order; second approver can; repeat approval blocked)
- Tenant isolation (read/modify/delete/voucher/statement cross-tenant all blocked by direct ID)
- Platform SA (admin realm allowed; platform_org does NOT leak other tenants' office data)
- Session / disable (disable terminates sessions; no writes after disable)

No detected:
- RBAC bypass
- API auth bypass
- Cross-tenant leak
- Maker–Checker failure
- Override failure
- Session issue
- UI/backend divergence

Known defect (backend, non-security) — FIXED:
- `POST /admin/orders` used to fail on the second order without `op_id` because the unique `op_id_1` index received explicit `null` values. Fixed by omitting `op_id` when absent (see Latest Changes Log).

---

## 17. Known Design Gaps

### 17.1 Voucher hard delete (accounting)

Voucher deletion currently performs a hard delete.

Financial reversal is correct, but:
- voucher record is removed
- journal record is removed
- no persistent voucher-level audit row preserves the cancelled transaction history

Classification:

```text
KNOWN DESIGN GAP
NOT A CURRENT FINANCIAL DEFECT
```

Do NOT redesign this unless specifically approved.

### 17.2 Commissions financial ledger

The commissions financial ledger (accrual / approval / payment / reversal)
is intentionally pending — it requires a new financial collection and explicit
approval. It is surfaced in the UI as not-yet-active.

### 17.3 Notification channels

Notification delivery is In-App only. SMS / Push / Email channels are not
implemented.

### 17.4 Tenant hard delete (blocked — requires design decision)

The legacy `DELETE /api/admin/tenants/:id` performed a hard cascade delete
(destroying users, accounts, boxes, journals, vouchers, and every related
collection). This is unsafe — it destroys financial history.

Current state (v4.9 CRUD Tenants):
- The hard cascade delete is now BLOCKED server-side (returns 403 with a
  design-decision message). No data is removed.
- The safe "deactivate" path is Suspend (`POST /api/admin/tenants/:id/toggle-status`),
  which only flips `status` and blocks login without deleting anything.
- A safe soft-delete / archive requires an explicit design decision.

Classification:

```text
BLOCKED — REQUIRES DESIGN DECISION
```

Do NOT reintroduce the hard cascade delete unless explicitly approved.

---

## 18. Important Files

```text
app/page.js
app/api/[[...path]]/route.js
lib/coa.js
lib/adminStaff.js
lib/adminOrders.js
```

Other `app/admin/*` files may still be used by TenantApp.
Do NOT delete them merely because `app/admin/shell.js` was removed.

---

## 19. RBAC

Important roles:

```text
super_admin
admin_staff
owner
office staff roles
```

Platform SA has global admin rights under `isMainSA`.

`admin_staff` must receive explicit permissions.

Always validate:
- UI visibility
- direct route access
- API authorization

---

## 20. Tenant Isolation

All operational financial objects must remain tenant-scoped.

Verify tenant scope when modifying:
- clients
- suppliers
- boxes
- journals
- vouchers
- accounts
- packages
- services
- settings
- users

---

## 21. Current QA Test Data

Local-only test data includes:

```text
QA-LOCAL-CUSTOMER
QA-LOCAL-SUPPLIER
QA-LOCAL-BOX
```

Do NOT migrate this data to GitHub, Test, or Live.

---

## 22. Temporary Local Script

```text
scripts/link_rahaal_hq_local.js
```

This helper is local-only.
Do NOT commit it.
Remove it before any production-ready commit unless explicitly needed.

---

## 23. Git Safety Rules

Forbidden unless explicitly approved:

```text
git commit
git push
git merge
git rebase
force push
branch creation for delivery
deployment
```

---

## 24. Project Safety Rules

MUST NOT VIOLATE:

1. Never touch Rahaal Live without explicit approval.
2. Never modify Live database.
3. Never deploy automatically.
4. Never commit or push automatically.
5. Never add migrations or backfills without approval.
6. Never modify balances manually to "fix" a test.
7. Never bypass backend financial guards.
8. Never weaken `isMainSA` or RBAC to make UI work.
9. Never create duplicate accounting engines.
10. Never create a second TenantApp/Admin architecture.
11. Never silently update dependencies.
12. Never store passwords, API keys, secrets, or production credentials in this document.

---

## 25. Current Architecture Decision

Chosen architecture:

```text
ONE TenantApp
```

For both:
- Travel Offices
- Rahaal Company

Visibility depends on:
- role
- tenant/platform flags
- RBAC
- module permissions

---

## 26. Completed Local Changes

```text
Removed old AdminApp shell
Unified Platform SA into TenantApp
Created Rahaal Company local tenant
Linked main super admin to Rahaal Company
Added platform_org semantics
Hidden travel-office modules from Platform SA
Hidden office settings from Platform SA
Validated Platform SA navigation
Validated accounting core
Validated Rahaal Administration (12/12 PASS)
Validated Security/RBAC/Maker-Checker/Tenant Isolation (25/25 PASS)
Fixed platform_orders op_id null collision (omit field when absent)
Added Tenants CRUD actions (View/Edit/Suspend-Activate/Delete-blocked) + fine-grained permission enforcement
```

---

## 27. Current Git Status

Expected local status:

```text
D app/admin/shell.js
M app/page.js
```

Possible untracked helper:

```text
scripts/link_rahaal_hq_local.js
```

Always review:

```bash
git status --short
git diff --stat
git diff
```

before any proposed commit.

---

## 28. Pending Tasks

```text
Rahaal Administration QA: COMPLETE (12/12 PASS)
```

Next phase:

```text
Final validation & release preparation
```

Steps:
1. Review all confirmed defects.
2. Fix only approved confirmed defects.
3. Run regression.
4. Run `yarn build`.
5. Review complete Git diff.
6. Ensure no test scripts or local DB tools are committed.
7. Only then evaluate controlled GitHub transfer.

---

## 29. Upcoming Final Validation

After administration QA:

1. Review all defects.
2. Fix only approved confirmed defects.
3. Run regression.
4. Run `yarn build`.
5. Review complete Git diff.
6. Ensure no test scripts or local DB tools are committed.
7. Only then evaluate controlled GitHub transfer.

---

## 30. AI Handoff Protocol

Any new AI model must:

1. Read this file completely.
2. State briefly:

```text
Context loaded.
Current architecture understood.
Current task identified.
Relevant files to inspect: ...
```

3. Do NOT scan whole repository.
4. If code conflicts with this document, STOP and report:

```text
CONTEXT CONFLICT
Document says:
Code says:
Likely reason:
Recommended action:
```

5. After meaningful work, update:
- Current state
- QA result
- Known issues
- Pending tasks
- Latest changes

6. Never write secrets into this file.

---

## 31. Latest Changes Log

### 2026-09-12

- Restored fresh Rahaal Test database to local MongoDB.
- Confirmed Test originally lacked the v3.98 Rahaal Company tenant.
- Reviewed Git history and found v3.98 architecture.
- Recreated Rahaal Company tenant locally.
- Linked `admin@targetmedia.com` as Platform SA while keeping `super_admin`.
- Set `platform_org=true`.
- Set tenant `is_platform_org=true`.
- Hid travel-office modules from Platform SA.
- Hid office settings from Platform SA.
- Removed dependency on old AdminApp navigation.
- Platform UI QA completed: 16/16 PASS.
- Accounting functional QA completed: 26/26 PASS.
- No financial mismatch detected.
- Voucher hard-delete audit gap documented.
- Rahaal Administration QA completed: 12/12 PASS.
- Two incomplete-by-design items documented (commissions financial ledger, notification channels).
- Security/RBAC/Maker-Checker/Tenant Isolation QA completed: 25/25 PASS.
- No RBAC/API-auth bypass, no cross-tenant leak, no Maker–Checker failure.
- platform_orders `op_id` unique-index defect documented (explicit null collision on 2nd order without op_id).
- Fixed `op_id` defect: omit the field when absent (code-only, no index change, no migration).
- Tenants CRUD QA completed: View/Edit/Suspend/Reactivate PASS; Delete BLOCKED (hard cascade disabled, 403).
- Fine-grained permission enforcement added to tenant PATCH (offices.edit) and toggle-status (offices.manage).
- Next phase: Final validation & release preparation.
- [2026-09-12 20:19] Test and Live Promotion Workflows
- [2026-09-12 20:55] Permanent Update Branches
- [2026-09-12 20:55] Current OpenCode Model

## Safety Rules

### Test and Live Promotion Workflows

The repository contains existing workflow files for Test deployment/promotion and Live deployment/promotion.

Current status:
- These workflow files are intentionally DISABLED / PAUSED.
- Their presence in the repository is EXPECTED.
- They must NOT be classified as temporary, obsolete, test contamination, or unnecessary files.
- Do NOT delete, rename, modify, enable, execute, or trigger them without explicit approval.
- During Local vs GitHub comparison, existing Test/Live promotion workflow files must be preserved.
- Any unexpected modification to these workflow files is HIGH-RISK / NEEDS REVIEW.
- Future re-enablement requires a separate review and explicit approval.

## Git / Branch Policy

### Permanent Update Branches

Permanent development branches:

- rahaal-updates = permanent development branch for original Rahaal
- rahaalcopy-updates = permanent development branch for rahaal-copy
- meraaj-updates = permanent development branch for original Meraaj
- meraajcopy-updates = permanent development branch for meraaj-copy

Rules:
- main is the stable/reference branch.
- The *-updates branches are permanent and MUST NOT be deleted after merge.
- Never push development work directly to main.
- All new development work goes to the corresponding updates branch.
- After merge to main, sync the permanent updates branch with main and continue using it.
- Do not create a new branch for every small update unless explicitly requested.
- Git push should transfer only new commits/differences.
- Existing Test/Live promotion workflows remain disabled and must not be modified or triggered without explicit approval.

Current local Rahaal work targets:
rahaal-copy -> rahaalcopy-updates

## Current State

### Current OpenCode Model

Current coding model in OpenCode: Big Pickle.

DeepSeek V4 Pro was previously used for the major QA, accounting, RBAC, opening balance, op_id fix, and Tenants CRUD work, but its available usage has been exhausted for now.

Big Pickle is now the active model for continuing the Rahaal local work.

Any new model must still read docs/RAHAAL_AI_CONTEXT.md first and continue from the documented current state instead of rescanning the repository.

