import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import sharp from 'sharp'
// v3.88 — COA Migration Framework: single source of truth for the COA template,
// per-tenant versioning, audit/classification and controlled reset/preserve migrations.
import { seedCoaTemplate, applyResetMigration, upsertTenantSettingsDefaults, ensureTenantSettingsUniqueIndex } from '@/lib/coa'
// v3.91 — Phase 2: Office 360° READ-ONLY aggregations (modular — AUDIT-006)
import { getOffice360 } from '@/lib/admin360'
// v3.93 — Batch 1: Sales & Vouchers + Accounting oversight (read-only) + Permissions Center
import { adminCenterHandler } from '@/lib/adminCenter'
import { adminPermsHandler } from '@/lib/adminPerms'
import { adminCommissionsHandler } from '@/lib/adminCommissions' // v3.94 — Batch 2 (READ-ONLY)
import { adminRequestsHandler } from '@/lib/adminRequests' // v3.94 — Batch 2 (READ-ONLY)
import { adminAdsHandler, activeAnnouncementsFor } from '@/lib/adminAds' // v3.94 — Batch 2 (extends announcements)
import { adminSystemHandler } from '@/lib/adminSystem' // v3.95 — Batch 3 (Backup/Restore path/System)
import { adminAuditHandler } from '@/lib/adminAudit' // v3.95 — Batch 3 (Central Audit + Health — READ-ONLY)
import { adminNotifyHandler } from '@/lib/adminNotify' // v3.95 — Batch 3 (In-App Notifications)
import { adminReportsHandler } from '@/lib/adminReports' // v3.96 — Batch 4 (Reports — READ-ONLY)
import { adminDisputesHandler } from '@/lib/adminDisputes' // v3.96 — Batch 4 (Disputes)
import { adminCurrencyHandler } from '@/lib/adminCurrency' // v3.96 — Batch 4 (Currencies & FX)
import { adminGate, adminCan, adminStaffHandler } from '@/lib/adminStaff' // v3.97 — Batch 5 (Admin realm + staff RBAC)
import { adminOrdersHandler, adminCommissionsLedgerHandler } from '@/lib/adminOrders' // v4.3 — unified orders + commissions ledger
import { adminGeoHandler } from '@/lib/adminGeo' // v3.97 — Batch 5 (Geo locations)
import { adminPayFinHandler } from '@/lib/adminPayFin' // v3.97 — Batch 5 (Payment methods & financial entities)
import { adminRefDataHandler } from '@/lib/adminRefData' // v3.97 — Batch 5 (Unified reference data)

// v3.47 — Package image optimization settings (applied ONCE at upload; centralized — adjust here)
const IMG_MAX_DIM = 1200        // longest side in px (aspect ratio preserved, never enlarged)
const IMG_WEBP_QUALITY = 82     // web-optimized quality (80–85 range)

// ---------- MongoDB ----------
let client, db
// v3.45 — Fix latent race: concurrent requests during cold start could see `client` set
// before `db` was ready (500: Cannot read properties of undefined). Cache the connect promise.
let mongoConnectPromise = null
async function connectToMongo() {
  if (db) return db
  if (!mongoConnectPromise) {
    mongoConnectPromise = (async () => {
      // v3.10.1 — Fail-fast with clear error when env vars are missing (prevents obscure "startsWith of undefined" from mongodb driver)
      if (!process.env.MONGO_URL || typeof process.env.MONGO_URL !== 'string') {
        throw new Error('MONGO_URL environment variable is required (missing in this deployment environment)')
      }
      if (!process.env.DB_NAME) throw new Error('DB_NAME environment variable is required')
      client = new MongoClient(process.env.MONGO_URL)
      await client.connect()
      const d = client.db(process.env.DB_NAME)
      await seedInitial(d)
      db = d
      return d
    })().catch((e) => { mongoConnectPromise = null; client = null; throw e })
  }
  return mongoConnectPromise
}

const CURRENCIES = ['USD', 'SAR', 'YER']
// Base currency = YER. Rates represent: 1 unit of currency = X YER
const DEFAULT_RATES = { USD: 1554, SAR: 410, YER: 1 }
const BASE_CURRENCY = 'YER'
// Helper: convert amount to base (YER)
function toBase(amount, currency, rates) {
  const r = rates?.[currency]
  const rate = (r && typeof r === 'object') ? (Number(r.transfer) || 1) : (Number(r) || 1)
  return (Number(amount) || 0) * rate
}
function getTransferRate(rates, cur) {
  const r = rates?.[cur]
  if (r && typeof r === 'object') return Number(r.transfer) || 1
  return Number(r) || 1
}
const emptyBalances = () => ({ USD: 0, SAR: 0, YER: 0 })
const SESSION_DAYS = 14

// ================= v3.87 — CENTRAL SEMANTIC ACCOUNT MAP =================
// Business logic must NEVER hardcode account numbers — it references the MEANING
// (COA.CLIENTS, COA.SUPPLIERS, ...) and the actual code lives HERE, in one place.
// Renumbering the chart later = editing this map only.
// Hierarchy: L1=1 digit, L2=2, L3=4, L4=7 (terminal — journal lines post on L4/leaves).
const COA = {
  ASSETS: '1', CURRENT_ASSETS: '11', FIXED_ASSETS: '12',
  CASHBOXES: '1101', BANKS: '1102', CLIENTS: '1103',
  LIABILITIES: '2', CURRENT_LIABS: '21', LONGTERM_LIABS: '22', SUPPLIERS: '2101',
  EQUITY: '3', EQUITY_GROUP: '31', CAPITAL: '3101', RETAINED_EARNINGS: '3102', OPENING_EQUITY: '3103',
  REVENUES: '4', REV_GROUP: '41',
  REV_TICKETS: '4101', REV_VISAS: '4102', REV_SERVICES: '4103', FX_PNL: '4104', REV_CANCEL_FEES: '4105',
  EXPENSES: '5', OPEX_GROUP: '51', ADMIN_GROUP: '52', COMM_DIFF_GROUP: '53', OPEX: '5101', FX_ADJUST: '5201',
}
const OPENING_EQUITY_NAME = 'تسوية الأرصدة الافتتاحية'
// v3.87 — numeric rounding helper (2 decimals)
const round2n = (n) => Math.round((Number(n) || 0) * 100) / 100
// v3.88.5 — F-007/F-008 STRICT (review round): every posting must reach the FINAL postable
// (leaf) account. NO silent Group fallback: a legacy party that was never linked to a leaf
// account throws a clear, coded error BEFORE any write — a new financial entry can never
// land on a Group account. Remedy for the user: re-link parties to the chart (relinkParties
// runs in seeding and in the COA migration), then retry. Historical entries are untouched.
// (The second argument is intentionally IGNORED — kept only for call-site compatibility.)
const partyLeafCode = (party, _ignoredLegacyFallback) => {
  const c = party && party.account_code ? String(party.account_code) : ''
  if (c.length >= 7) return c
  const e = new Error(`لا يمكن الترحيل: الطرف "${(party && (party.name || party.name_ar)) || 'غير معروف'}" غير مربوط بحساب تفصيلي (Leaf) في دليل الحسابات — أعد ربط الأطراف بالدليل ثم أعد المحاولة. لن يُسجَّل أي قيد جديد على حساب مجموعة`)
  e.code = 'PARTY_NO_LEAF_ACCOUNT'
  throw e
}
// v3.88.4 — F-017/U-014: unified BUSINESS-TIMEZONE (UTC+3) day boundaries for every
// financial-report date filter (from = start of day, to = end of day), plus a date-safe
// $expr builder that tolerates legacy string-typed dates alongside Date-typed ones
// (opening entries stored dates as strings — NO data migration, query handles both).
const bizDayStart = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00.000+03:00`)
const bizDayEnd = (s) => new Date(`${String(s).slice(0, 10)}T23:59:59.999+03:00`)
const bizTodayISO = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)
const dateRangeExpr = (field, fromDate, toDate) => {
  const conds = []
  if (fromDate) conds.push({ $gte: [{ $toDate: `$${field}` }, fromDate] })
  if (toDate) conds.push({ $lte: [{ $toDate: `$${field}` }, toDate] })
  return conds.length ? { $expr: conds.length === 1 ? conds[0] : { $and: conds } } : null
}

// ================= Seeding =================
// v3.87 — the COA tree seeding is a standalone function so the REBUILD endpoint can
// re-create the tree for an EXISTING tenant without duplicating boxes/settings.
async function seedCoaTree(db, t) {
  // v3.88 — delegated to the COA Migration Framework (lib/coa.js) — SINGLE source of
  // truth for the 28-account template. Also stamps tenant_settings.coa_version so every
  // NEW tenant is born already at CURRENT_COA_VERSION. Idempotent (refuses if any
  // accounts already exist for the tenant).
  return seedCoaTemplate(db, t)
}
async function seedTenantDefaults(db, tenantId) {
  const acc = db.collection('accounts')
  const has = await acc.findOne({ tenant_id: tenantId })
  if (has) return
  const t = tenantId
  const now = new Date()
  await seedCoaTree(db, t)
  // v3.0 — Seed default dynamic service catalog for the Services module
  await db.collection('service_types').insertMany([
    { id: uuidv4(), tenant_id: t, name: 'حجز فندق', active: true, created_at: now },
    { id: uuidv4(), tenant_id: t, name: 'تصديق شهادات', active: true, created_at: now },
    { id: uuidv4(), tenant_id: t, name: 'خدمة نقل / ترحيل', active: true, created_at: now },
    { id: uuidv4(), tenant_id: t, name: 'خدمات متنوعة', active: true, created_at: now },
  ])
  await db.collection('boxes').insertMany([
    // v3.87 — boxes are L4 leaf accounts under COA.CASHBOXES/COA.BANKS, and each single box
    // holds MULTI-CURRENCY balances (balances.SAR/USD/YER) — never one box per currency.
    { id: uuidv4(), tenant_id: t, name_ar: 'الصندوق الرئيسي', type: 'cash', parent_code: COA.CASHBOXES, account_code: `${COA.CASHBOXES}001`, account_parent_code: COA.CASHBOXES, account_seq: 1, balances: emptyBalances(), created_at: new Date() },
    { id: uuidv4(), tenant_id: t, name_ar: 'حساب بنكي / محفظة', type: 'bank', parent_code: COA.BANKS, account_code: `${COA.BANKS}001`, account_parent_code: COA.BANKS, account_seq: 1, balances: emptyBalances(), created_at: new Date() },
  ])
  // NOTE: next_child_seq stores the LAST USED sequence (the generator increments first) —
  // seed boxes consumed seq 1 under CASHBOXES/BANKS, so the stored value stays 1.
  // v3.88.1 — BLOCKER-1 fix: seedCoaTree() above already upserted the tenant_settings
  // document (coa_version stamp). The old raw insertOne here created a SECOND document
  // for every new tenant. Delegated to the framework's single-doc upsert — creating a
  // new tenant now results in exactly ONE tenant_settings document.
  await upsertTenantSettingsDefaults(db, t, {
    agency_name: '', logo_base64: '', header: '', footer: '', tax_id: '', commercial_id: '',
    phone: '', address: '', email: '', primary_color: '#1e3a8a',
    base_currency: BASE_CURRENCY,
    rates: {
      USD: { transfer: 1554, buy: 1550, sell: 1560, min: 1530, max: 1580, remarks: '' },
      SAR: { transfer: 410, buy: 408, sell: 412, min: 400, max: 420, remarks: '' },
      YER: { transfer: 1, buy: 1, sell: 1, min: 1, max: 1, remarks: 'العملة الأساسية' },
    },
    // Direct USD/SAR cross-conversion rates (bypass YER for direct exchanges)
    pair_usd_sar: { transfer: 3.75, buy: 3.74, sell: 3.76, remarks: 'سعر التحويل المباشر بين الدولار والريال السعودي' },
    updated_at: new Date(),
  })
}

// v3.4 — Employee permissions defaults (owner has all=true implicitly)
const DEFAULT_STAFF_PERMISSIONS = {
  tickets_view: true, tickets_add: true, tickets_edit: false, tickets_delete: false,
  visas_view: true, visas_add: true, visas_edit: false, visas_delete: false,
  services_view: true, services_add: true, services_edit: false, services_delete: false,
  reports_view: false, show_profit: false,
  vouchers_manage: false, accounts_manage: false,
  edit_price: false, apply_discount: false,
  can_close_periods: false,  // v3.10.6 — permission to lock/unlock financial periods
  can_refund: false,          // v3.10.6 — permission to refund/cancel transactions
  // v3.45 — RBAC Phase 1: module-level access (sidebar sections).
  // Operational modules default ON for staff; financial/sensitive modules default OFF.
  mod_dashboard: true, mod_tickets: true, mod_visas: true, mod_services: true, mod_packages: true,
  mod_meraaj: false, mod_visa_monitor: true, mod_query: false, mod_fx: false,
  mod_receipt: true, mod_payment: false, mod_clients: true, mod_suppliers: false,
  mod_boxes: false, mod_chart: false, mod_journal: false, mod_reports: false,
  mod_affiliate: false, mod_help: true,
  // v3.51 — RBAC Phase 3: fine-grained financial restrictions
  fin_statements: false,       // كشوفات الحساب (عملاء/موردين/تقارير)
  fin_partner_summary: false,  // ملخص/كشوفات الشركاء
}
function ownerPermissions() {
  const p = {}
  for (const k of Object.keys(DEFAULT_STAFF_PERMISSIONS)) p[k] = true
  return p
}
function effectivePermissions(user) {
  if (!user) return DEFAULT_STAFF_PERMISSIONS
  if (user.role === 'owner') return ownerPermissions()
  return { ...DEFAULT_STAFF_PERMISSIONS, ...(user.permissions || {}) }
}
// v3.45 — RBAC role templates: baseline presets applied by the owner, then per-employee
// checkbox edits act as individual overrides (stored on the user document).
function rbacAllPerms(v) { const p = {}; for (const k of Object.keys(DEFAULT_STAFF_PERMISSIONS)) p[k] = v; return p }
function RBAC_ROLE_TEMPLATES() {
  const base = (over) => ({ ...rbacAllPerms(false), mod_dashboard: true, mod_help: true, ...over })
  return [
    { key: 'registrar', label: '🧾 موظف تسجيل', desc: 'تسجيل الزبائن في الباكجات فقط — بدون أي أرقام مالية أو أرباح', perms: base({ mod_packages: true, mod_clients: true }) },
    { key: 'sales', label: '💼 موظف مبيعات', desc: 'بيع التذاكر والتأشيرات والخدمات والباكجات + سند قبض — بدون أرباح أو خصومات', perms: base({ mod_tickets: true, mod_visas: true, mod_services: true, mod_packages: true, mod_clients: true, mod_receipt: true, mod_visa_monitor: true, tickets_view: true, tickets_add: true, visas_view: true, visas_add: true, services_view: true, services_add: true, vouchers_manage: true }) },
    { key: 'sales_manager', label: '📈 مدير مبيعات', desc: 'كل المبيعات + الأرباح والخصومات ومتجر معراج والاستعلامات', perms: base({ mod_tickets: true, mod_visas: true, mod_services: true, mod_packages: true, mod_meraaj: true, mod_clients: true, mod_receipt: true, mod_visa_monitor: true, mod_query: true, mod_reports: true, tickets_view: true, tickets_add: true, tickets_edit: true, tickets_delete: true, visas_view: true, visas_add: true, visas_edit: true, visas_delete: true, services_view: true, services_add: true, services_edit: true, services_delete: true, vouchers_manage: true, reports_view: true, show_profit: true, edit_price: true, apply_discount: true, can_refund: true, fin_partner_summary: true }) },
    { key: 'accountant', label: '🧮 محاسب', desc: 'السندات والقيود والصناديق والدليل والتقارير المالية والصرافة', perms: base({ mod_receipt: true, mod_payment: true, mod_fx: true, mod_clients: true, mod_suppliers: true, mod_boxes: true, mod_chart: true, mod_journal: true, mod_reports: true, mod_query: true, tickets_view: true, visas_view: true, services_view: true, vouchers_manage: true, accounts_manage: true, reports_view: true, show_profit: true, fin_statements: true, fin_partner_summary: true }) },
    { key: 'full_manager', label: '👑 مدير كامل', desc: 'جميع الصلاحيات — مطابق للمالك', perms: rbacAllPerms(true) },
  ]
}

// v3.4 — Affiliate defaults
const AFFILIATE_COMMISSION_RATE = 0.10
const AFFILIATE_MIN_CASHOUT_INDIVIDUAL = 10
const AFFILIATE_MIN_CASHOUT_OFFICE = 50

// v3.87.4 — Shared COA v2 rebuild (used by POST /coa/rebuild AND the one-time TEST
// auto-migration). Wipes the tenant's trial operational/financial data, reseeds the
// hierarchical tree, re-codes boxes/clients/suppliers under the correct parents
// (strict parent-prefix, 7-digit L4) and zeroes balances. Currency is NEVER a COA
// level — one box account per box regardless of SAR/USD/YER.
async function rebuildTenantCoa(db, T, byEmail) {
  // v3.88 — delegated to the COA Migration Framework (lib/coa.js). This is the ONLY
  // destructive path and it is never automatic in production: it is reached solely via
  // the explicit owner-confirmed endpoint (confirm: "REBUILD-COA") or the TEST-env
  // demo bootstrap. allowWipe acknowledges that explicit authorization.
  // v3.88.2 — DEFAULT-DENY: even with allowWipe, lib/coa.js refuses a full reset for a
  // tenant holding financial documents unless the environment is POSITIVELY proven to
  // be a test one (db name ends in _test/_tests AND ALLOW_DESTRUCTIVE_COA_RESET=true).
  // Production protection no longer depends on DISABLE_AUTO_SEED.
  const res = await applyResetMigration(db, T, byEmail, { allowWipe: true })
  return { wiped: res.wiped || {}, recode: res.recode || {}, tree_accounts: res.tree_accounts || 0 }
}

async function seedInitial(db) {
  // Production safety guard (permanent architecture rule):
  // When DISABLE_AUTO_SEED=true is set in the environment, skip ALL seed / insert / delete /
  // index-creation operations below. The application will only READ from the existing
  // production database. Set this to 'true' on the Live Server env file (/etc/rahaal.env).
  if (process.env.DISABLE_AUTO_SEED === 'true') return

  // Purge legacy data lacking tenant_id (from earlier MVP)
  for (const c of ['accounts', 'boxes', 'clients', 'suppliers', 'tickets', 'visas', 'vouchers', 'journal_entries', 'settings']) {
    await db.collection(c).deleteMany({ tenant_id: { $exists: false } }).catch(() => {})
  }

  // v3.10.2 — Enforce unique account code per tenant (chart of accounts + sub-accounts)
  try {
    await db.collection('accounts').createIndex({ tenant_id: 1, code: 1 }, { unique: true, name: 'unique_tenant_account_code' })
    await db.collection('clients').createIndex({ tenant_id: 1, account_code: 1 }, { unique: true, sparse: true, name: 'unique_tenant_client_code' })
    await db.collection('suppliers').createIndex({ tenant_id: 1, account_code: 1 }, { unique: true, sparse: true, name: 'unique_tenant_supplier_code' })
    await db.collection('boxes').createIndex({ tenant_id: 1, account_code: 1 }, { unique: true, sparse: true, name: 'unique_tenant_box_code' })
    // v3.88.2 — BLOCKER-1 hard guard: at most ONE tenant_settings document per tenant.
    // A read-only duplicate audit runs FIRST (lib/coa.js): on duplicates NOTHING is
    // deleted or merged, the index is NOT created, and a loud manual_review warning is
    // logged — the failure is never silently swallowed by this try/catch.
    await ensureTenantSettingsUniqueIndex(db)
  } catch (e) { /* Indexes may already exist */ }

  // Migrate rate schema: flat number → { transfer, buy, sell, min, max, remarks }
  const allSettings = await db.collection('tenant_settings').find({}).toArray()
  for (const s of allSettings) {
    if (!s.rates) continue
    let needUpdate = false
    const newRates = {}
    for (const c of CURRENCIES) {
      const r = s.rates[c]
      if (typeof r === 'number' || !r || !r.transfer) {
        // Convert legacy or seed defaults per currency
        const def = DEFAULT_RATES[c]
        // If legacy value < 1 (old USD-base scheme) → invert or replace with new YER-base defaults
        newRates[c] = { transfer: def, buy: def * 0.997, sell: def * 1.003, min: def * 0.95, max: def * 1.05, remarks: c === 'YER' ? 'العملة الأساسية' : '' }
        needUpdate = true
      } else {
        newRates[c] = r
      }
    }
    if (needUpdate) await db.collection('tenant_settings').updateOne({ id: s.id }, { $set: { rates: newRates, base_currency: BASE_CURRENCY } })
  }

  // v3.88 — REMOVED: the old piecemeal COA backfills (4104/4105 with parent '41') that
  // produced HYBRID v1/v2 trees in production (parent '41' never existed in v1 → orphans).
  // Startup now performs NO structural COA mutation on existing tenants. Old tenants are
  // upgraded exclusively through the controlled, versioned migration:
  //   node scripts/coa-migrate.js --audit | --dry-run | --apply   (see lib/coa.js)
  const allTenants = await db.collection('tenants').find({}).toArray()
  for (const tn of allTenants) {
    if (!tn.journal_quota) {
      const usedCount = await db.collection('journal_entries').countDocuments({ tenant_id: tn.id })
      await db.collection('tenants').updateOne({ id: tn.id }, { $set: { journal_quota: { used: usedCount, limit: 500, top_ups: [] } } })
    }
    // v3.0 — Backfill default service_types for existing tenants
    const stCount = await db.collection('service_types').countDocuments({ tenant_id: tn.id })
    if (stCount === 0) {
      const now = new Date()
      await db.collection('service_types').insertMany([
        { id: uuidv4(), tenant_id: tn.id, name: 'حجز فندق', active: true, created_at: now },
        { id: uuidv4(), tenant_id: tn.id, name: 'تصديق شهادات', active: true, created_at: now },
        { id: uuidv4(), tenant_id: tn.id, name: 'خدمة نقل / ترحيل', active: true, created_at: now },
        { id: uuidv4(), tenant_id: tn.id, name: 'خدمات متنوعة', active: true, created_at: now },
      ])
    }
  }

  // Super Admin bootstrap — password comes ONLY from env (Secrets Policy §24/25).
  // If SEED_SUPER_ADMIN_PASSWORD is not set, the super admin is NOT created.
  const admins = db.collection('users')
  const superAdmin = await admins.findOne({ role: 'super_admin' })
  if (!superAdmin) {
    if (process.env.SEED_SUPER_ADMIN_PASSWORD) {
      await admins.insertOne({
        id: uuidv4(), tenant_id: null, email: process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@targetmedia.com', name: 'Target Media Admin',
        role: 'super_admin', active: true,
        password_hash: bcrypt.hashSync(process.env.SEED_SUPER_ADMIN_PASSWORD, 8),
        created_at: new Date(),
      })
    } else {
      console.warn('[seed] SEED_SUPER_ADMIN_PASSWORD not set — skipping super admin creation')
    }
  }

  // Demo tenant
  const tenants = db.collection('tenants')
  let demo = await tenants.findOne({ slug: 'demo' })
  if (!demo) {
    demo = {
      id: uuidv4(), slug: 'demo', name: 'مكتب الرحّال التجريبي',
      status: 'active', max_users: 5, max_branches: 1,
      subscription: 'trial',
      created_at: new Date(),
    }
    await tenants.insertOne(demo)
  }
  const owner = await admins.findOne({ email: 'owner@demo.com' })
  if (!owner) {
    if (process.env.SEED_DEMO_PASSWORD) {
      await admins.insertOne({
        id: uuidv4(), tenant_id: demo.id, email: 'owner@demo.com', name: 'مالك المكتب التجريبي',
        role: 'owner', active: true,
        password_hash: bcrypt.hashSync(process.env.SEED_DEMO_PASSWORD, 8),
        created_at: new Date(),
      })
    } else {
      console.warn('[seed] SEED_DEMO_PASSWORD not set — skipping demo owner creation')
    }
  }
  await seedTenantDefaults(db, demo.id)

  // v3.87.2 — Fixed TEST-ONLY accounts (owner@gmail.com / taha@gmail.com), both attached
  // to the demo tenant so Owner-vs-User can be compared inside the SAME office.
  // PRIMARY switch (explicit, authoritative): SEED_TEST_ACCOUNTS=true in the Test env file.
  // SECONDARY safety layer only (do NOT rely on it alone): public URL contains 'rahaal-test'.
  // Live is protected twice: no flag + DISABLE_AUTO_SEED=true short-circuits all seeding above.
  const seedTestAccountsFlag = process.env.SEED_TEST_ACCOUNTS === 'true'
  const looksLikeTestHost = (process.env.NEXT_PUBLIC_BASE_URL || '').includes('rahaal-test')
  const isTestEnv = seedTestAccountsFlag || looksLikeTestHost
  if (isTestEnv) {
    const testAccounts = [
      { email: 'owner@gmail.com', name: 'Owner Test Account', role: 'owner' },
      { email: 'taha@gmail.com', name: 'Taha Test User', role: 'staff' }, // normal user — NOT admin/owner
    ]
    for (const acc of testAccounts) {
      const existing = await admins.findOne({ email: acc.email })
      const setDoc = {
        tenant_id: demo.id, name: acc.name, role: acc.role, active: true,
        password_hash: bcrypt.hashSync('123456', 8),
      }
      if (existing) {
        await admins.updateOne({ email: acc.email }, { $set: setDoc }) // no duplicates — role/password refreshed
      } else {
        await admins.insertOne({ id: uuidv4(), email: acc.email, ...setDoc, permissions: {}, created_at: new Date() })
      }
    }
    console.log('[seed] test accounts ensured (owner@gmail.com owner / taha@gmail.com staff) on demo tenant')

    // v3.87.4 — ONE-TIME COA v2 auto-migration for the demo tenant on TEST environments.
    // The deployed Test server has its OWN database where the demo tenant may still
    // carry the pre-v3.87 chart (currency-named cashbox accounts, clients under 1301...).
    // Guarded by tenant_settings.coa_version — runs exactly once per database, TEST only.
    // Live is protected: no SEED_TEST_ACCOUNTS flag + DISABLE_AUTO_SEED=true guard above.
    const demoTs = await db.collection('tenant_settings').findOne({ tenant_id: demo.id })
    if (!demoTs || demoTs.coa_version !== 2) {
      console.log('[seed] TEST env: demo tenant COA is pre-v2 — running one-time rebuild')
      try {
        const mig = await rebuildTenantCoa(db, demo.id, 'coa-v2-auto-migration@test')
        console.log('[seed] COA v2 migration done:', JSON.stringify(mig.recode), 'tree =', mig.tree_accounts)
      } catch (e) {
        // v3.88.2 — default-deny guard may refuse the wipe (env not positively proven as
        // test). Never crash bootstrap: the demo tenant simply stays on its current COA
        // until migrated through the controlled CLI path (scripts/coa-migrate.js).
        console.warn('[seed] COA v2 auto-migration skipped by guard:', e.message)
      }
    }
  }

  // Backfill referral codes for any existing tenants missing one
  const missingRef = await tenants.find({ $or: [{ referral_code: { $exists: false } }, { referral_code: null }] }).toArray()
  for (const t of missingRef) await ensureReferralCode(db, t.id)

  // v2.8 — Seed default subscription plans if none exist
  const plans = db.collection('subscription_plans')
  if (!(await plans.countDocuments())) {
    await plans.insertMany([
      { id: 'voucher_pack_500', name: 'باقة قيود إضافية', description: '500 قيد إضافي — إضافة فورية للحصة الحالية', price_usd: 50, vouchers: 500, kind: 'topup', active: true, updated_at: new Date() },
      { id: 'gold_monthly', name: 'Gold — شهري', description: 'قيود غير محدودة + إنشاء ذاتي لفروع ومستخدمين — شهر واحد', price_usd: 150, vouchers: 100000, plan_tier: 'gold', duration_days: 30, kind: 'subscription', active: true, updated_at: new Date() },
      { id: 'gold_annual', name: 'Gold — سنوي', description: 'قيود غير محدودة + إنشاء ذاتي لفروع ومستخدمين — سنة كاملة (توفير شهرين)', price_usd: 1500, vouchers: 100000, plan_tier: 'gold', duration_days: 365, kind: 'subscription', active: true, updated_at: new Date() },
    ])
  }
}

// ================= CORS =================
function cors(res, extra = {}) {
  res.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  for (const [k, v] of Object.entries(extra)) res.headers.set(k, v)
  return res
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }
const ok = (d, cookie) => cors(NextResponse.json(d), cookie ? { 'Set-Cookie': cookie } : {})
const bad = (m, s = 400) => cors(NextResponse.json({ error: m }, { status: s }))
const clean = (arr) => arr.map(({ _id, ...r }) => r)

// ================= Session =================
async function getSession(request, db) {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/rahaal_session=([^;]+)/)
  if (!m) return null
  const session = await db.collection('sessions').findOne({ id: m[1] })
  if (!session) return null
  if (new Date(session.expires_at) < new Date()) return null
  const user = await db.collection('users').findOne({ id: session.user_id })
  if (!user || !user.active) return null
  let tenant = null
  if (user.tenant_id) tenant = await db.collection('tenants').findOne({ id: user.tenant_id })
  if (tenant && tenant.status !== 'active') return { session, user, tenant, blocked: true }
  return { 
    session, user, tenant, 
    impersonation: !!session.impersonation, 
    impersonated_by_email: session.impersonated_by_email 
  }
}
// v3.8 — PAT (Personal Access Token) helpers for Chrome Extension
function hashPat(token) { return crypto.createHash('sha256').update(token).digest('hex') }
function generatePat() {
  // rhl_pat_<32 hex chars> (128-bit entropy)
  const raw = crypto.randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 32).padEnd(32, 'x')
  return `rhl_pat_${raw}`
}
async function getPatSession(request, db) {
  try {
    if (!request || !request.headers) return null

    // قراءة آمنة للهيدر تمنع حدوث أي خطأ undefined أو استدعاء خاطئ
    const auth = (typeof request.headers.get === 'function'
      ? request.headers.get('authorization')
      : request.headers.authorization) || ''

    if (!auth || typeof auth !== 'string') return null
    const m = auth.match(/^Bearer\s+(rhl_pat_[A-Za-z0-9]+)$/i)
    if (!m) return null
    const token = m[1]
    const hash = hashPat(token)
    const pat = await db.collection('pats').findOne({ token_hash: hash, revoked_at: null })
    if (!pat) return null
    const user = await db.collection('users').findOne({ id: pat.user_id })
    if (!user || !user.active) return null
    let tenant = null
    if (user.tenant_id) tenant = await db.collection('tenants').findOne({ id: user.tenant_id })
    if (tenant && tenant.status !== 'active') return { pat, user, tenant, blocked: true }

    // تحديث وقت آخر استخدام
    db.collection('pats').updateOne({ id: pat.id }, { $set: { last_used_at: new Date() } }).catch(() => {})
    return { pat, user, tenant, isPat: true }
  } catch (err) {
    return null
  }
}
function sanitizeUser(u) { return { id: u.id, email: u.email, name: u.name, role: u.role, role_key: u.role_key || null, tenant_id: u.tenant_id, active: u.active, default_box_id: u.default_box_id || null, lock_box: !!u.lock_box, allowed_box_ids: Array.isArray(u.allowed_box_ids) ? u.allowed_box_ids : [], permissions: u.role === 'owner' ? ownerPermissions() : u.role === 'super_admin' ? { ...ownerPermissions(), ...(u.permissions || {}) } : { ...DEFAULT_STAFF_PERMISSIONS, ...(u.permissions || {}) } } } // v3.98 — platform SA in the company book = owner-equivalent perms, minus his explicit overrides (travel modules hidden)
// v3.97 — Batch 5: MAIN super admin realm check (role string is not enough —
// a tenant user mistakenly holding 'super_admin' must NOT pass admin gates).
// v3.98 — Phase 1 (Rahaal company book): the main SA may now be BOUND to the
// platform-org tenant (شركة رحّال) to use the shared TenantApp for the
// company's own accounting. He stays main SA only via the platform_org flag —
// an office user holding 'super_admin' with a normal tenant is still rejected.
const isMainSA = (u) => !!u && u.role === 'super_admin' && (!u.tenant_id || u.platform_org === true)
function sanitizeTenant(t) { return t ? { id: t.id, name: t.name, slug: t.slug, status: t.status, max_users: t.max_users, max_branches: t.max_branches, referral_code: t.referral_code, referred_by: t.referred_by, plan_tier: t.plan_tier || 'standard', subscription: t.subscription, subscription_expires_at: t.subscription_expires_at, subscription_price: t.subscription_price, billing_mode: t.billing_mode || null, unlimited_journals: !!t.unlimited_journals } : null }

// ============ v3.14 — PRICING & PLANS (Phase 2) ============
// v4.0.1 CLOSURE — OLD condition (v3.14→v4.0): billing_mode === 'annual' opened journals
// IMMEDIATELY on selection, before any payment. REMOVED: benefits now open ONLY after
// «تأكيد الدفع» (confirm-payment → subscription='paid' / activation_confirmed) or an
// explicit manual unlimited_journals override by the Super Admin.
function isUnlimitedTenant(t) {
  return !!t && (t.unlimited_journals === true || t.subscription === 'paid' || !!t.activation_confirmed)
}

const DEFAULT_PRICING_CONFIG = {
  id: 'pricing_config',
  discount_enabled: true,
  discount_percent: 50,
  installments_count: 5,
  plans: [
    {
      key: 'silver', name_ar: 'سيلفر', icon: '🥈', annual_price: 500,
      max_users: 2, max_branches: 1,
      features: ['فرع واحد', 'مستخدمان إجمالاً (المالك + مستخدم إضافي)', 'التذاكر والتأشيرات والخدمات', 'مراقبة التأشيرات — كاملة', 'إدارة البكجات والتسكين — كاملة', 'المحاسبة وسندات القبض والصرف', 'التقارير الأساسية'],
    },
    {
      key: 'gold', name_ar: 'جولد', icon: '🥇', annual_price: 1000,
      max_users: 8, max_branches: 3,
      features: ['حتى 8 مستخدمين', 'إدارة الفروع', 'كل مزايا سيلفر', 'مراقبة التأشيرات — كاملة', 'إدارة البكجات والتسكين — كاملة', 'مصارفة العملات', 'تقارير متقدمة وميزان مراجعة'],
    },
    {
      key: 'enterprise', name_ar: 'إنتربرايز / مؤسسات', icon: '🏢', annual_price: 2000,
      max_users: 0, max_branches: 0, // 0 = unlimited
      features: ['مستخدمون غير محدودين', 'فروع غير محدودة', 'كل مزايا جولد', 'مراقبة التأشيرات — كاملة', 'إدارة البكجات والتسكين — كاملة', 'برنامج العمولات والتسويق', 'دعم فني بأولوية قصوى'],
    },
  ],
}
async function getPricingConfig(db) {
  const cfg = await db.collection('platform_settings').findOne({ id: 'pricing_config' })
  return cfg ? { ...DEFAULT_PRICING_CONFIG, ...cfg } : DEFAULT_PRICING_CONFIG
}

// Referral helpers
function genReferralCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let s = ''; for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
async function ensureReferralCode(db, tenantId) {
  const t = await db.collection('tenants').findOne({ id: tenantId })
  if (!t) return null
  if (t.referral_code) return t.referral_code
  let code
  do { code = genReferralCode() } while (await db.collection('tenants').findOne({ referral_code: code }))
  await db.collection('tenants').updateOne({ id: tenantId }, { $set: { referral_code: code, referral_stats: t.referral_stats || { signups: 0, activations: 0, bonus_earned: 0 } } })
  return code
}

// ================= Helpers =================
// v3.80 — UNIFIED RULE: document/accounting dates can NEVER be in the future.
// Applies to: ticket/visa/service issue date, receipt/payment voucher date, FX date,
// manual journal date, visa-monitor issue date, bulk date edits.
// Travel/service dates (travel_date, entry_date, expected_exit_date, package start/end,
// visa expiry, ...) are intentionally NOT restricted.
// Date-only comparison in business timezone UTC+3 (KSA/Yemen) to avoid midnight edge cases.
const FUTURE_DOC_DATE_MSG = 'لا يمكن أن يكون تاريخ المستند بعد تاريخ اليوم'
function isFutureDocDate(dateVal) {
  if (!dateVal) return false
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return false
  const BIZ_TZ_MS = 3 * 3600 * 1000
  const todayStr = new Date(Date.now() + BIZ_TZ_MS).toISOString().slice(0, 10)
  const dStr = new Date(d.getTime() + BIZ_TZ_MS).toISOString().slice(0, 10)
  return dStr > todayStr
}

async function updateBalance(db, col, filter, currency, delta) {
  // v4.6 — RAH-ACC anti-corruption guard: a NaN/Infinity delta or a missing currency key
  // would permanently corrupt the cached balance bucket ($inc NaN → the whole balance
  // becomes NaN forever / a "balances.undefined" bucket appears). Fail LOUDLY instead —
  // callers' restore paths (F-020) handle the abort; silent corruption never does.
  const d = Number(delta)
  if (!Number.isFinite(d)) throw new Error(`قيمة غير صالحة لتحديث الرصيد (${delta}) — أُوقفت العملية لحماية الأرصدة المخزنة`)
  if (!currency || typeof currency !== 'string') throw new Error('عملة غير محددة لتحديث الرصيد — أُوقفت العملية لحماية الأرصدة المخزنة')
  if (d === 0) return
  await db.collection(col).updateOne(filter, { $inc: { [`balances.${currency}`]: d } })
}

// v3.10.7 — Chart of Accounts tree: atomic sequential code generator
// Hierarchy (strict inheritance):
//   L1 = 1 digit  (e.g. 1 = الأصول, 5 = المصاريف)
//   L2 = 2 digits (e.g. 11 = أصول متداولة, 52 = مصاريف إدارية عمومية)
//   L3 = 4 digits (e.g. 1201 = الصناديق)   -> 2-digit sequence appended to L2
//   L4 = 7 digits (e.g. 1201001 = صندوق سالم) -> 3-digit sequence appended to L3
//   L4 is a TERMINAL node — creating children under an L4 code is FORBIDDEN.
// Returns new account_code in form: <parent_code><padded-sequence>
// v3.87 — an account code must be unique across the COA *and* all party account codes
async function accountCodeExists(db, tenantId, code) {
  const [a, c, s, b] = await Promise.all([
    db.collection('accounts').findOne({ tenant_id: tenantId, code }),
    db.collection('clients').findOne({ tenant_id: tenantId, account_code: code }),
    db.collection('suppliers').findOne({ tenant_id: tenantId, account_code: code }),
    db.collection('boxes').findOne({ tenant_id: tenantId, account_code: code }),
  ])
  return !!(a || c || s || b)
}
async function generateSubAccountCode(db, tenantId, parentCode) {
  const parentStr = String(parentCode)
  // v3.10.7 — Terminal node protection: L4 (7-digit) accounts cannot have children.
  if (parentStr.length >= 7) {
    throw new Error(`الحساب ${parentStr} حساب تحليلي نهائي (Level 4) — لا يمكن إنشاء حسابات فرعية تحته. القيود المحاسبية فقط تتم على هذا المستوى.`)
  }
  // Level scheme: L1=1 → L2=2 → L3=4 → L4=7 digits. Child = parent prefix + padded sequence,
  // so a child ALWAYS starts with its parent's code — by construction.
  const parentLen = parentStr.length
  const seqPad = parentLen === 1 ? 1 : parentLen === 2 ? 2 : 3
  const seqCap = parentLen === 1 ? 9 : parentLen === 2 ? 99 : 999
  const bump = async () => {
    const r = await db.collection('accounts').findOneAndUpdate(
      { tenant_id: tenantId, code: parentStr },
      { $inc: { next_child_seq: 1 }, $set: { is_parent: true } },
      { returnDocument: 'after' }
    )
    const doc = r?.value || r
    if (!doc) throw new Error(`الحساب الأب ${parentStr} غير موجود في الدليل`)
    return doc.next_child_seq || 1
  }
  let seq = await bump()
  let newCode = parentStr + String(seq).padStart(seqPad, '0')
  // v3.87 — collision-skip: legacy/manually-created codes never break the generator
  let guard = 0
  while (await accountCodeExists(db, tenantId, newCode)) {
    if (++guard > 500) throw new Error('تعذر توليد رمز حساب — تواصل مع الدعم')
    seq = await bump()
    if (seq > seqCap) throw new Error(`امتلأ تسلسل الفرع ${parentStr} (الحد ${seqCap} حساباً) — أنشئ مجموعة جديدة`)
    newCode = parentStr + String(seq).padStart(seqPad, '0')
  }
  if (seq > seqCap) throw new Error(`امتلأ تسلسل الفرع ${parentStr} (الحد ${seqCap} حساباً) — أنشئ مجموعة جديدة`)
  return {
    account_code: newCode,
    account_parent_code: parentStr,
    account_seq: seq,
  }
}

// ============================================================================
// v3.92 — COA ↔ OPERATIONAL LINKAGE (boxes / clients / suppliers)
// Identity = account_code (stable, unique per tenant) — NEVER the name.
// A leaf account created from the COA under one of these groups gets a real
// operational record so it appears in the operational screens and vouchers.
// Idempotent: an existing record with the same account_code is reused as-is.
// Name duplicates are REJECTED (no auto-link on ambiguity — stop & report).
// ============================================================================
function opLinkMapFor(parentCode) {
  const p = String(parentCode || '')
  if (p === COA.CASHBOXES) return { coll: 'boxes', kind: 'صندوق', nameField: 'name_ar', screen: 'شاشة الصناديق', boxType: 'cash' }
  if (p === COA.BANKS) return { coll: 'boxes', kind: 'حساب بنكي', nameField: 'name_ar', screen: 'شاشة الصناديق', boxType: 'bank' }
  if (p === COA.CLIENTS) return { coll: 'clients', kind: 'عميل', nameField: 'name', screen: 'شاشة العملاء' }
  if (p === COA.SUPPLIERS) return { coll: 'suppliers', kind: 'مورد', nameField: 'name', screen: 'شاشة الموردين' }
  return null
}
async function ensureOperationalLink(db, T, account) {
  if (account.is_group) return { skipped: 'group' }
  const m = opLinkMapFor(account.parent)
  if (!m) return { skipped: 'not_operational_group' }
  // idempotent by account_code — the stable identity
  const existing = await db.collection(m.coll).findOne({ tenant_id: T, account_code: account.code })
  if (existing) return { linked: true, created: false, coll: m.coll, id: existing.id }
  const name = account.name_ar
  // never create a duplicate operational record for a reused name
  const dupName = await db.collection(m.coll).findOne(
    m.coll === 'boxes'
      ? { tenant_id: T, $or: [{ name_ar: name }, { name: name }] }
      : { tenant_id: T, name }
  )
  if (dupName) return { conflict: `يوجد ${m.kind} آخر بنفس الاسم "${name}" (حساب ${dupName.account_code || '—'}) — عدّل الاسم أو استخدم ${m.screen}` }
  const base = {
    id: uuidv4(), tenant_id: T, parent_code: String(account.parent),
    account_code: account.code, account_parent_code: String(account.parent),
    balances: emptyBalances(), created_at: new Date(), created_from: 'coa',
  }
  let doc
  if (m.coll === 'boxes') doc = { ...base, name_ar: name, type: m.boxType }
  else if (m.coll === 'clients') doc = { ...base, name, phone: '', whatsapp: '', address: '', email: '', notes: 'أُنشئ من الدليل المحاسبي', credit_limit: 0, credit_currency: 'USD', is_frozen: false }
  else doc = { ...base, name, phone: '', whatsapp: '', address: '', email: '', notes: 'أُنشئ من الدليل المحاسبي' }
  await db.collection(m.coll).insertOne(doc)
  return { linked: true, created: true, coll: m.coll, id: doc.id, kind: m.kind }
}
// v3.92.1 — SAFE DELETE usage check: an account is deletable ONLY when it has ZERO history.
// "Balance = 0" is NEVER used as permission — an account may have in/out movements netting
// to zero; deleting it would damage the accounting record. Identity = account_code / record
// id (never the name). READ-ONLY checks — no journal/voucher/transaction is ever touched.
async function accountUsageCheck(db, T, acc) {
  const code = acc.code
  // 1) journal history by the account's own code
  if (await db.collection('journal_entries').findOne({ tenant_id: T, 'lines.account_code': code })) {
    return { used: true, reason: 'قيود يومية' }
  }
  // 2) vouchers posted directly to a COA account (expense/revenue selector)
  if (await db.collection('vouchers').findOne({ tenant_id: T, coa_account_code: code })) {
    return { used: true, reason: 'سندات مرتبطة بالحساب' }
  }
  // 3) linked operational record → deep usage by the RECORD identity (id), not the name
  const m = opLinkMapFor(acc.parent)
  const rec = m ? await db.collection(m.coll).findOne({ tenant_id: T, account_code: code }) : null
  if (rec) {
    const rid = rec.id
    const refChecks = [
      ['journal_entries', { tenant_id: T, 'lines.party_id': rid }, 'قيود يومية'],
      ['vouchers', { tenant_id: T, $or: [{ party_id: rid }, { box_id: rid }] }, 'سندات'],
      ['tickets', { tenant_id: T, $or: [{ client_id: rid }, { supplier_id: rid }, { box_id: rid }] }, 'تذاكر'],
      ['visas', { tenant_id: T, $or: [{ client_id: rid }, { supplier_id: rid }, { box_id: rid }] }, 'تأشيرات'],
      ['services', { tenant_id: T, $or: [{ client_id: rid }, { supplier_id: rid }, { box_id: rid }] }, 'خدمات'],
      ['package_bookings', { tenant_id: T, $or: [{ client_id: rid }, { box_id: rid }] }, 'حجوزات باكجات'],
      ['package_components', { tenant_id: T, supplier_id: rid }, 'مكونات باكجات/برامج'],
      ['currency_exchanges', { tenant_id: T, $or: [{ box_currency_id: rid }, { box_counter_id: rid }] }, 'عمليات مصارفة'],
    ]
    for (const [coll, q, label] of refChecks) {
      const hit = await db.collection(coll).findOne(q).catch(() => null)
      if (hit) return { used: true, reason: `${m.kind} المرتبط مستخدم في ${label}`, rec, m }
    }
    // belt: a non-zero STORED balance blocks deletion even if no history doc was found
    // (the inverse is never assumed: zero balance alone NEVER permits deletion)
    const nonZero = Object.values(rec.balances || {}).some(v => typeof v === 'number' && Math.abs(v) > 0.0001)
    if (nonZero) return { used: true, reason: `${m.kind} المرتبط عليه رصيد قائم`, rec, m }
    return { used: false, rec, m }
  }
  return { used: false, rec: null, m }
}

// v3.10.0 — Validate JE lines: no negatives + account exists
async function validateJournalLines(db, tenantId, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: true }
  // Cache parent + sub-account codes to avoid many queries
  const acctCodes = new Set((await db.collection('accounts').find({ tenant_id: tenantId }).project({ code: 1 }).toArray()).map(a => a.code))
  // v3.88.4 — F-008: group accounts NEVER receive direct postings — leaf accounts only.
  const groupCodes = new Set((await db.collection('accounts').find({ tenant_id: tenantId, is_group: true }).project({ code: 1 }).toArray()).map(a => a.code))
  const clientCodes = new Set((await db.collection('clients').find({ tenant_id: tenantId }).project({ account_code: 1 }).toArray()).map(x => x.account_code).filter(Boolean))
  const supplierCodes = new Set((await db.collection('suppliers').find({ tenant_id: tenantId }).project({ account_code: 1 }).toArray()).map(x => x.account_code).filter(Boolean))
  const boxCodes = new Set((await db.collection('boxes').find({ tenant_id: tenantId }).project({ account_code: 1 }).toArray()).map(x => x.account_code).filter(Boolean))
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const d = Number(l.debit) || 0
    const c = Number(l.credit) || 0
    if (d < 0 || c < 0) return { ok: false, error: `لا يُسمح بقيم سالبة في القيد (المدين=${d}، الدائن=${c}) — السطر ${i + 1}` }
    const hasAmount = d > 0 || c > 0
    const code = l.account_code
    // v3.10.0 strict — any line with amount MUST have a valid registered account_code
    if (hasAmount && (!code || code === 'MANUAL')) {
      return { ok: false, error: `عذراً، يجب اختيار حساب معتمد من دليل الحسابات (السطر ${i + 1})` }
    }
    if (code && code !== 'MANUAL') {
      const exists = acctCodes.has(code) || clientCodes.has(code) || supplierCodes.has(code) || boxCodes.has(code)
      if (!exists) return { ok: false, error: `الحساب "${code}" غير موجود في دليل الحسابات — السطر ${i + 1}` }
      // v3.88.4 — F-008: block direct posting to Group accounts
      if (hasAmount && groupCodes.has(code)) return { ok: false, error: `الحساب "${code}" حساب مجموعة (تصنيف) — الترحيل يكون على الحساب التفصيلي النهائي فقط (السطر ${i + 1})` }
    }
  }
  return { ok: true }
}

// ============ v4.5 — ACCOUNTING CORE HARDENING (central invariants) ============
// Engine/structural accounts the Accounting Engine depends on (Opening, Year Close,
// Retained Earnings, FX, fixed postings). Protected in code regardless of is_system
// flag or journal history — a core account matters even before its first posting.
const ENGINE_ACCOUNT_CODES = new Set(Object.values(COA))

// v4.5 — compatibility view of "inactive" (data uses mixed flags; storage unification
// would need a Data Migration — handled in CODE only, migration logged as future need)
const isInactiveAccount = (a) => !!a && (a.inactive === true || a.is_active === false || a.active === false || a.archived === true)

// v4.5 — CENTRAL closed-period / closed-year guard. Every journal write (manual,
// automatic, opening, transaction-generated) passes through this via the central
// gate — no side path can forget it. Returns an error string or null.
async function assertOpenPeriod(db, T, dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike || Date.now())
  if (isNaN(d.getTime())) return 'تاريخ القيد غير صالح'
  const yr = d.getFullYear()
  const tenant = await db.collection('tenants').findOne({ id: T }, { projection: { closed_years: 1 } })
  if (tenant?.closed_years?.includes(yr)) return `السنة المالية ${yr} مقفلة — لا يمكن إنشاء أو تعديل قيود بتاريخها`
  const settings = await db.collection('tenant_settings').findOne({ tenant_id: T }, { projection: { period_lock: 1 } })
  const closedUntil = settings?.period_lock?.closed_until || null
  if (closedUntil && d.toISOString().slice(0, 10) <= String(closedUntil).slice(0, 10)) {
    return `🔒 الفترة حتى ${closedUntil} مقفلة — استخدم قيد تسوية عكسي بالتاريخ الحالي بدلاً من التعديل الرجعي`
  }
  return null
}

// v4.5 — journal quota preflight (same rule as the central gate) so callers can
// verify BEFORE applying cached-balance side effects (fail-fast, no partial state)
async function assertJournalQuota(db, T) {
  const t = await db.collection('tenants').findOne({ id: T })
  if (!isUnlimitedTenant(t)) {
    const q = t?.journal_quota || { used: 0, limit: 500 }
    if (q.used >= q.limit) {
      const err = new Error(`انتهت حصة قيود اليومية (${q.used}/${q.limit}). يرجى تجديد الاشتراك مع الإدارة العامة.`)
      err.code = 'QUOTA_EXCEEDED'
      throw err
    }
  }
}

// v4.5 — CENTRAL JOURNAL INVARIANTS: journal validity is an invariant of the gate,
// not a courtesy of each business route. Covers: valid lines, non-negative amounts,
// accounts exist + tenant-scoped, no Group posting, no posting to inactive accounts,
// closed period/year guard, and multi-currency-aware balance (BASE-currency check —
// per-currency comparison would falsely reject correct FX / manual_dual entries).
async function enforceJournalInvariants(db, T, je, opts = {}) {
  const lines = je.lines
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('القيد بلا أسطر — مرفوض')
  // 1) line validity + accounts exist (tenant-scoped) + group-account guard + negatives
  const v = await validateJournalLines(db, T, lines)
  if (!v.ok) throw new Error(v.error)
  // 2) inactive accounts never accept NEW postings (history/reports untouched)
  const codes = [...new Set(lines.map(l => l.account_code).filter(c => c && c !== 'MANUAL'))]
  if (codes.length) {
    const inactive = await db.collection('accounts')
      .find({ tenant_id: T, code: { $in: codes } }, { projection: { code: 1, name_ar: 1, inactive: 1, is_active: 1, active: 1, archived: 1 } })
      .toArray()
    const bad0 = inactive.find(isInactiveAccount)
    if (bad0) throw new Error(`الحساب "${bad0.code} — ${bad0.name_ar || ''}" غير نشط — لا يقبل ترحيلاً جديداً (التاريخ محفوظ كما هو)`)
  }
  // 3) closed period / closed year — central, side-path-proof
  if (!opts.bypassPeriodGuard) {
    const perr = await assertOpenPeriod(db, T, je.date)
    if (perr) { const e = new Error(perr); e.code = 'PERIOD_CLOSED'; throw e }
  }
  // 4) currency sanity
  if (!je.currency || typeof je.currency !== 'string') throw new Error('عملة القيد مطلوبة')
  // 5) balance invariant — multi-currency aware: totals are compared in the BASE
  //    currency using tenant rates (FX and manual_dual are balanced in base by
  //    construction; forcing per-currency equality would wrongly reject them).
  //    Tolerance scales with line count to absorb legitimate 2dp per-line rounding.
  const rates = (await db.collection('tenant_settings').findOne({ tenant_id: T }, { projection: { rates: 1 } }))?.rates || DEFAULT_RATES
  let totD = 0, totC = 0
  for (const l of lines) {
    const cur = l.currency || je.currency
    const c2 = (cur && cur !== 'MULTI') ? cur : BASE_CURRENCY
    totD += toBase(Number(l.debit) || 0, c2, rates)
    totC += toBase(Number(l.credit) || 0, c2, rates)
  }
  const tolerance = Math.max(0.05, lines.length * 0.01)
  if (Math.abs(totD - totC) > tolerance) {
    const e = new Error(`القيد غير متوازن (بالعملة الأساس): مدين ${totD.toFixed(2)} ≠ دائن ${totC.toFixed(2)} — الفرق ${(totD - totC).toFixed(2)}`)
    e.code = 'UNBALANCED_JOURNAL'
    throw e
  }
}

// v4.5 — inverse of reverseManualJournalEffects: RE-APPLIES the original cached-balance
// effects of a manual/manual_dual JE. Used to RESTORE state when a posted-journal edit
// fails midway (no partial state, no silent history loss).
async function applyManualJournalEffects(db, T, je) {
  const isMulti = je.currency === 'MULTI' || je.ref_type === 'manual_dual'
  if (isMulti) {
    for (const l of (je.lines || []).slice(0, 2)) {
      const cur = l.currency
      const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0
      const amt = debit > 0 ? debit : credit
      const side = debit > 0 ? 'debit' : 'credit'
      if (!cur || !l.party_id) continue
      if (l.party_type === 'client') await updateBalance(db, 'clients', { id: l.party_id, tenant_id: T }, cur, side === 'debit' ? +amt : -amt)
      if (l.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: l.party_id, tenant_id: T }, cur, side === 'debit' ? -amt : +amt)
      if (l.party_type === 'box') await updateBalance(db, 'boxes', { id: l.party_id, tenant_id: T }, cur, side === 'debit' ? +amt : -amt)
    }
  } else {
    for (const l of je.lines || []) {
      const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0
      const delta = debit - credit
      const cur = l.currency || je.currency
      if (!l.party_id) continue
      if (l.party_type === 'client') await updateBalance(db, 'clients', { id: l.party_id, tenant_id: T }, cur, +delta)
      if (l.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: l.party_id, tenant_id: T }, cur, -delta)
      if (l.party_type === 'box') await updateBalance(db, 'boxes', { id: l.party_id, tenant_id: T }, cur, +delta)
    }
  }
}

// v3.10.6 — Credit Limit + Freeze enforcement for credit sales
async function checkClientCredit(db, tenantId, clientId, saleAmount, currency, settings) {
  if (!clientId) return { ok: true }
  const cli = await db.collection('clients').findOne({ id: clientId, tenant_id: tenantId })
  if (!cli) return { ok: false, error: 'العميل غير موجود' }
  if (cli.is_frozen) return { ok: false, error: `❄️ الحساب مجمّد — لا يمكن إصدار حركات آجلة للعميل "${cli.name}". يرجى مراجعة المالك.` }
  const limit = Number(cli.credit_limit) || 0
  if (limit <= 0) return { ok: true } // No limit set
  // Convert existing balance + new sale to credit_currency for check
  const limitCcy = cli.credit_currency || 'USD'
  const balances = cli.balances || {}
  const rates = (settings && settings.rates) || {}
  const baseCcy = (settings && settings.base_currency) || 'USD'
  const toBase = (amt, cur) => {
    const r = (rates[cur] && rates[cur].to_base) ? Number(rates[cur].to_base) : 1
    return Number(amt || 0) * r
  }
  const fromBase = (baseAmt, cur) => {
    const r = (rates[cur] && rates[cur].to_base) ? Number(rates[cur].to_base) : 1
    return baseAmt / r
  }
  // Total current debt in base then convert to limit_currency
  let currentDebtBase = 0
  Object.entries(balances).forEach(([cur, val]) => { currentDebtBase += toBase(Math.max(0, Number(val || 0)), cur) })
  const newSaleBase = toBase(Number(saleAmount || 0), currency)
  const totalAfterBase = currentDebtBase + newSaleBase
  const totalAfterLimitCcy = fromBase(totalAfterBase, limitCcy)
  if (totalAfterLimitCcy > limit) {
    return { ok: false, error: `⛔ العميل "${cli.name}" تجاوز سقف الائتمان المسموح به (${limit.toLocaleString()} ${limitCcy}). الرصيد الحالي مع الحركة الجديدة سيصبح ${totalAfterLimitCcy.toFixed(2)} ${limitCcy}. يمكن للمالك رفع السقف من بطاقة العميل.` }
  }
  return { ok: true }
}

async function createJournalEntry(db, tenantId, { date, description, ref_type, ref_id, currency, lines }, opts = {}) {
  // v4.5 — generic idempotency (code-level): a caller may pass opts.idempotencyKey;
  // the same financial operation never produces two journals on retry/concurrent calls.
  // (DB-level unique index is intentionally NOT created now — would require checking
  // existing production data first. Logged as deferred DB hardening.)
  if (opts.idempotencyKey) {
    const existing = await db.collection('journal_entries').findOne({ tenant_id: tenantId, idempotency_key: opts.idempotencyKey })
    if (existing) return existing
  }
  // Enforce quota (skipped in edit mode, and bypassed entirely for unlimited tenants)
  if (!opts.skipQuota) await assertJournalQuota(db, tenantId)
  // v3.89 — opts.extra: optional passthrough marker fields (e.g. meraaj_booking_ref for
  // idempotent Meraaj postings). Spread FIRST so extras can NEVER override core JE fields.
  const je = { ...(opts.extra || {}), id: opts.existingJeId || uuidv4(), tenant_id: tenantId, date: new Date(date || Date.now()), description, ref_type, ref_id, currency, lines, created_at: opts.createdAt || new Date() }
  // v4.5 — actor/source traceability for NEW journals (historical journals untouched):
  // created_by falls back to any value already provided via opts.extra.
  if (opts.actor && !je.created_by) je.created_by = opts.actor
  if (opts.source && !je.source) je.source = opts.source
  if (opts.idempotencyKey) je.idempotency_key = opts.idempotencyKey
  // v4.5 — CENTRAL INVARIANTS (Priority 1+2+5): no automatic or manual journal can
  // skip validation — lines/accounts/tenant/group/inactive/period/base-balance.
  await enforceJournalInvariants(db, tenantId, je, opts)
  // v4.8.1 — PR#18-1: EXPLICIT WRITE PHASES.
  // Phase A — journal COMMIT. An insert error is verified against the collection:
  //   provably NOT saved  → e.jePhase='pre_commit'      (caller may compensate safely)
  //   verification failed → e.jePhase='commit_uncertain' (caller must NOT compensate —
  //   reversing balances for a journal that may be saved corrupts the books)
  //   saved despite the driver error → treated as committed (fall through to Phase B).
  try {
    await db.collection('journal_entries').insertOne(je)
  } catch (insErr) {
    let committed = false, verified = false
    try {
      committed = !!(await db.collection('journal_entries').findOne({ id: je.id, tenant_id: tenantId }, { projection: { id: 1 } }))
      verified = true
    } catch { /* verification unavailable → state unknown */ }
    if (!verified) { insErr.jePhase = 'commit_uncertain'; throw insErr }
    if (!committed) { insErr.jePhase = 'pre_commit'; throw insErr }
    // committed=true: the journal IS saved — do not re-throw an "insert failure"
  }
  // Phase B — quota COUNTER. The journal is committed: a counter failure is NEVER
  // treated as an insert failure (no caller may reverse balances for a saved journal)
  // and is NEVER hidden — loud log + persisted audit record + flag on the returned doc.
  if (!opts.skipQuota) {
    try {
      await db.collection('tenants').updateOne({ id: tenantId }, { $inc: { 'journal_quota.used': 1 } })
    } catch (qErr) {
      console.error('[JE] CRITICAL: quota counter update FAILED after journal commit', je.id, qErr)
      try {
        await db.collection('je_audit').insertOne({ id: uuidv4(), tenant_id: tenantId, action: 'quota_increment_failed', je_id: je.id, ref_type: je.ref_type, error: String(qErr?.message || qErr).slice(0, 300), at: new Date() })
      } catch { }
      je.quota_counter_failed = true // surfaced, not hidden — journal itself is committed
    }
  }
  return je
}

// ============ EDIT/REVERSAL ENGINE ============
// Reverses balance updates for a transactional record. Used before re-applying edited values or deleting.
async function reverseTransactionEffects(db, T, kind, doc) {
  if (kind === 'tickets' || kind === 'visas' || kind === 'services') {
    if (doc.payment_method === 'cash' && doc.box_id) {
      await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, -doc.sale_price)
    } else {
      await updateBalance(db, 'clients', { id: doc.client_id, tenant_id: T }, doc.currency, -doc.sale_price)
    }
    await updateBalance(db, 'suppliers', { id: doc.supplier_id, tenant_id: T }, doc.currency, -doc.cost)
    // v3.88.4 — F-020: the partner commission-share was NEVER reversed — every edit of a
    // partner-share document drifted the partner's balance by -share. Reverse it too.
    if ((Number(doc.commission_share_amount) || 0) > 0 && doc.commission_partner_id) {
      const pcol = doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
      await updateBalance(db, pcol, { id: doc.commission_partner_id, tenant_id: T }, doc.currency, +Number(doc.commission_share_amount))
    }
  } else if (kind === 'vouchers') {
    if (doc.type === 'receipt') {
      await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, -doc.amount)
      if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
      if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
    } else {
      await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, +doc.amount)
      if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
      if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
    }
  } else if (kind === 'fx') {
    // Use stored refs (falls back to box_currency_id for pre-v2.6 records)
    const refCur = doc.currency_ref || { kind: 'box', id: doc.box_currency_id }
    const refCounter = doc.counter_ref || { kind: 'box', id: doc.box_counter_id }
    const accCur = await resolveAccountRef(db, T, refCur)
    const accCounter = await resolveAccountRef(db, T, refCounter)
    const debitAmtCur = doc.type === 'buy' ? doc.amount : -doc.amount
    const debitAmtCounter = doc.type === 'buy' ? -doc.counter_amount : doc.counter_amount
    if (accCur && accCur.updateBalance) {
      await updateBalance(db, accCur.collection, { id: accCur.id, tenant_id: T }, doc.currency, -debitAmtCur * accCur.debitSign)
    }
    if (accCounter && accCounter.updateBalance) {
      await updateBalance(db, accCounter.collection, { id: accCounter.id, tenant_id: T }, doc.counter_currency, -debitAmtCounter * accCounter.debitSign)
    }
  }
}

// v3.88.4 — F-020: exact inverse of reverseTransactionEffects — used ONLY to restore the
// original effects when an edit fails AFTER the reversal step. Guarantees the invariant:
// old effect reversed exactly once, then either the new effect applied once (success) or
// the old effect restored once (failure) — never a double reversal, never data loss.
async function restoreTransactionEffects(db, T, kind, doc) {
  if (kind === 'tickets' || kind === 'visas' || kind === 'services') {
    if (doc.payment_method === 'cash' && doc.box_id) {
      await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, +doc.sale_price)
    } else {
      await updateBalance(db, 'clients', { id: doc.client_id, tenant_id: T }, doc.currency, +doc.sale_price)
    }
    await updateBalance(db, 'suppliers', { id: doc.supplier_id, tenant_id: T }, doc.currency, +doc.cost)
    if ((Number(doc.commission_share_amount) || 0) > 0 && doc.commission_partner_id) {
      const pcol = doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
      await updateBalance(db, pcol, { id: doc.commission_partner_id, tenant_id: T }, doc.currency, -Number(doc.commission_share_amount))
    }
  } else if (kind === 'vouchers') {
    if (doc.type === 'receipt') {
      await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, +doc.amount)
      if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
      if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
    } else {
      await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, -doc.amount)
      if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
      if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
    }
  } else if (kind === 'fx') {
    const refCur = doc.currency_ref || { kind: 'box', id: doc.box_currency_id }
    const refCounter = doc.counter_ref || { kind: 'box', id: doc.box_counter_id }
    const accCur = await resolveAccountRef(db, T, refCur)
    const accCounter = await resolveAccountRef(db, T, refCounter)
    const debitAmtCur = doc.type === 'buy' ? doc.amount : -doc.amount
    const debitAmtCounter = doc.type === 'buy' ? -doc.counter_amount : doc.counter_amount
    if (accCur && accCur.updateBalance) await updateBalance(db, accCur.collection, { id: accCur.id, tenant_id: T }, doc.currency, +debitAmtCur * accCur.debitSign)
    if (accCounter && accCounter.updateBalance) await updateBalance(db, accCounter.collection, { id: accCounter.id, tenant_id: T }, doc.counter_currency, +debitAmtCounter * accCounter.debitSign)
  }
}

// Reverses party balance updates that were applied at the moment a manual JE was inserted.
async function reverseManualJournalEffects(db, T, je) {
  const isMulti = je.currency === 'MULTI' || je.ref_type === 'manual_dual'
  if (isMulti) {
    // For dual journal: original updates only applied to the two sides (first two lines) via party_type
    for (const l of (je.lines || []).slice(0, 2)) {
      const cur = l.currency
      const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0
      const amt = debit > 0 ? debit : credit
      const side = debit > 0 ? 'debit' : 'credit'
      if (!cur || !l.party_id) continue
      if (l.party_type === 'client') await updateBalance(db, 'clients', { id: l.party_id, tenant_id: T }, cur, side === 'debit' ? -amt : +amt)
      if (l.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: l.party_id, tenant_id: T }, cur, side === 'debit' ? +amt : -amt)
      if (l.party_type === 'box') await updateBalance(db, 'boxes', { id: l.party_id, tenant_id: T }, cur, side === 'debit' ? -amt : +amt)
    }
  } else {
    for (const l of je.lines || []) {
      const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0
      const delta = debit - credit
      const cur = l.currency || je.currency
      if (!l.party_id) continue
      if (l.party_type === 'client') await updateBalance(db, 'clients', { id: l.party_id, tenant_id: T }, cur, -delta)
      if (l.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: l.party_id, tenant_id: T }, cur, +delta)
      if (l.party_type === 'box') await updateBalance(db, 'boxes', { id: l.party_id, tenant_id: T }, cur, -delta)
    }
  }
}
async function ensurePartyByName(db, tenantId, coll, name) {
  if (!name) return null
  const trimmed = String(name).trim()
  if (!trimmed) return null
  let doc = await db.collection(coll).findOne({ tenant_id: tenantId, name: trimmed })
  if (!doc) {
    doc = { id: uuidv4(), tenant_id: tenantId, name: trimmed, phone: '', notes: 'أنشئ تلقائياً', balances: emptyBalances(), created_at: new Date() }
    await db.collection(coll).insertOne(doc)
  }
  return doc
}

// ================= Router =================
async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method
  const url = new URL(request.url)
  const q = Object.fromEntries(url.searchParams.entries())
  // v3.42 — Cache the real public origin from live request headers (used as a last-resort base for
  // package image URLs in Meraaj payloads when RAHAAL_PUBLIC_BASE_URL / NEXT_PUBLIC_BASE_URL are empty).
  try {
    const xfHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
    if (xfHost && !/^(localhost|127\.|0\.0\.0\.0)/.test(xfHost)) {
      const xfProto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim()
      globalThis.__rahaalPublicOrigin = `${xfProto}://${xfHost.split(',')[0].trim()}`
    }
  } catch {}

  try {
    const db = await connectToMongo()

    // Health
    if (route === '/' || route === '/root') return ok({ ok: true, app: 'Rahaal ERP', version: '3.88.4' }) // v3.88.4 — U-007: version unified with release line

    // ============ HEALTH CHECK (public, no auth — for uptime monitors) ============
    if (route === '/health' && method === 'GET') {
      try {
        // Confirm DB is reachable
        await db.command({ ping: 1 })
        return ok({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime_sec: Math.floor(process.uptime()),
          service: 'rahaal-erp',
          version: '3.9.28',
          db: 'connected',
        })
      } catch (e) {
        return NextResponse.json({ status: 'degraded', error: e.message, timestamp: new Date().toISOString() }, { status: 503 })
      }
    }

    // ============ v3.24 — MERAAJ NETWORK: server-to-server endpoints (HMAC-secured, no session) ============
    // Office profile — called by Meraaj server: headers x-meraaj-timestamp + x-meraaj-signature = HMAC(`${ts}.${route}`)
    const meraajOfficeMatch = route.match(/^\/meraaj\/office\/([^/]+)$/)
    if (meraajOfficeMatch && method === 'GET') {
      if (!meraajVerifyRequest(request, route)) return bad('توقيع غير صالح — Invalid HMAC signature', 401)
      const t = await db.collection('tenants').findOne({ id: meraajOfficeMatch[1] })
      if (!t) return bad('المكتب غير موجود', 404)
      const settings = await db.collection('tenant_settings').findOne({ tenant_id: t.id })
      return ok({
        tenant_id: t.id,
        office_name: settings?.agency_name || t.name || '',
        phone: settings?.phone || t.phone || '',
        address: settings?.address || '',
        email: settings?.email || t.owner_email || '',
        status: t.status || 'active',
      })
    }
    // Package data — pulled by Meraaj when the office presses "Share"
    const meraajPkgMatch = route.match(/^\/meraaj\/packages\/([^/]+)$/)
    if (meraajPkgMatch && method === 'GET') {
      if (!meraajVerifyRequest(request, route)) return bad('توقيع غير صالح — Invalid HMAC signature', 401)
      const pkg = await db.collection('packages').findOne({ id: meraajPkgMatch[1] })
      if (!pkg) return bad('الباكج غير موجود', 404)
      if (pkg.archived) return bad('هذا الباكج مؤرشف وغير متاح', 403)
      if (!pkg.meraaj?.shared) return bad('هذا الباكج غير مُشارَك في معراج نتورك', 403)
      const comps = await db.collection('package_components').find({ package_id: pkg.id, tenant_id: pkg.tenant_id }).toArray()
      return ok(meraajPackagePayload(pkg, comps))
    }
    // Package image (binary) for the marketplace
    // v3.33 — PUBLIC endpoint (no HMAC): marketplace <img> tags and Meraaj users' browsers cannot sign
    // requests, so requiring a signature made images never display. Safe: serves ONLY images of packages
    // currently shared to the marketplace (public info by definition) — nothing else is exposed.
    const meraajPkgImgMatch = route.match(/^\/meraaj\/packages\/([^/]+)\/image$/)
    if (meraajPkgImgMatch && method === 'GET') {
      const pkg = await db.collection('packages').findOne({ id: meraajPkgImgMatch[1] })
      if (!pkg || !pkg.meraaj?.shared || pkg.archived) return bad('غير متاح', 404)
      const img = await db.collection('package_images').findOne({ package_id: pkg.id })
      if (!img) return bad('لا توجد صورة', 404)
      return new Response(Buffer.from(img.data, 'base64'), { status: 200, headers: { 'Content-Type': img.content_type || 'image/jpeg', 'Cache-Control': 'public, max-age=300' } })
    }
    // v3.76 — SSO VERIFY (server-to-server, Meraaj -> Rahaal): "Login with Rahaal" support.
    // Meraaj POSTs { token } — request body HMAC-signed like webhooks (x-meraaj-signature over raw body).
    // Rahaal re-verifies the token signature + expiry and returns FRESH office identity + permissions
    // scoped to the office only (never cross-tenant data).
    if (route === '/meraaj/sso/verify' && method === 'POST') {
      const rawBodySso = await request.text()
      const sigSso = request.headers.get('x-meraaj-signature')
      if (!meraajVerify(rawBodySso, sigSso)) return bad('توقيع غير صالح — Invalid HMAC signature', 401)
      let bodySso
      try { bodySso = JSON.parse(rawBodySso) } catch { return bad('JSON غير صالح') }
      const tokenSso = String(bodySso.token || '')
      const [b64Sso, tsigSso] = tokenSso.split('.')
      if (!b64Sso || !tsigSso || meraajSign(b64Sso) !== tsigSso) {
        return cors(NextResponse.json({ valid: false, error: 'invalid_token_signature' }, { status: 401 }))
      }
      let claims
      try { claims = JSON.parse(Buffer.from(b64Sso, 'base64url').toString()) } catch {
        return cors(NextResponse.json({ valid: false, error: 'malformed_token' }, { status: 400 }))
      }
      if (claims.iss !== 'rahaal-erp' || claims.aud !== 'meraaj-network') {
        return cors(NextResponse.json({ valid: false, error: 'invalid_token_claims' }, { status: 401 }))
      }
      if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) {
        return cors(NextResponse.json({ valid: false, error: 'token_expired' }, { status: 401 }))
      }
      const ssoUser = await db.collection('users').findOne({ tenant_id: claims.tenant_id, email: claims.email })
      if (!ssoUser || ssoUser.active === false) {
        return cors(NextResponse.json({ valid: false, error: 'user_not_found_or_inactive' }, { status: 404 }))
      }
      const ssoSettings = await db.collection('tenant_settings').findOne({ tenant_id: claims.tenant_id })
      const P = ssoUser.role === 'owner' ? null : effectivePermissions(ssoUser)
      // Meraaj-scoped permission surface ONLY (no internal ERP permissions leak)
      const scope = ssoUser.role === 'owner'
        ? { manage_packages: true, manage_bookings: true, approve_reject: true, can_refund: true, manage_settings: true }
        : { manage_packages: !!P.mod_meraaj, manage_bookings: !!P.mod_meraaj, approve_reject: !!P.mod_meraaj, can_refund: !!P.can_refund, manage_settings: false }
      return ok({
        valid: true,
        office: {
          office_ref: claims.tenant_id,
          office_name: ssoSettings?.agency_name || claims.office_name || '',
          meraaj_office_id: ssoSettings?.meraaj_office_id || null,
          store_active: !!ssoSettings?.meraaj_store?.active,
          escrow_mode: !!ssoSettings?.meraaj_escrow_mode,
        },
        user: { email: ssoUser.email, name: ssoUser.name || '', role: ssoUser.role, permissions: scope },
      })
    }
    // v3.77 — SIGNED DOCUMENT DOWNLOAD (public, HMAC-expiring link): lets authorized external
    // parties (Meraaj Super Admin reviewing cancellation evidence / office verification) fetch a
    // document WITHOUT Rahaal credentials. Link = HMAC(doc:{id}:{exp}) — single doc, time-boxed.
    const signedDocMatch = route.match(/^\/meraaj\/documents\/signed\/([^/]+)$/)
    if (signedDocMatch && method === 'GET') {
      const docIdS = signedDocMatch[1]
      const url = new URL(request.url)
      const expS = Number(url.searchParams.get('exp') || 0)
      const sigS = String(url.searchParams.get('sig') || '')
      if (!expS || expS < Math.floor(Date.now() / 1000)) return bad('انتهت صلاحية رابط التنزيل', 410)
      if (!sigS || meraajSign(`doc:${docIdS}:${expS}`) !== sigS) return bad('توقيع رابط غير صالح', 401)
      const docS = await db.collection('booking_documents').findOne({ id: docIdS })
        || await db.collection('office_documents').findOne({ id: docIdS })
      if (!docS) return bad('المستند غير موجود', 404)
      if (docS.storage?.driver === 'external_url') {
        await docAuditLog(db, docS.tenant_id, 'viewed', docS.id, 'signed_link', { via: 'redirect_external' })
        return NextResponse.redirect(docS.storage.url, 302)
      }
      const blobS = await docStorageGet(db, docS.storage?.object_key)
      if (!blobS) return bad('ملف المستند غير متاح في التخزين', 404)
      await docAuditLog(db, docS.tenant_id, 'viewed', docS.id, 'signed_link', {})
      return new Response(blobS.buffer, { status: 200, headers: { 'Content-Type': blobS.content_type, 'Content-Disposition': `inline; filename="${encodeURIComponent(docS.filename || 'document')}"`, 'Cache-Control': 'private, no-store' } })
    }
    // Reverse webhooks from Meraaj → Rahaal: signature over the RAW body (x-meraaj-signature)
    if (route === '/meraaj/webhooks' && method === 'POST') {
      const rawBody = await request.text()
      const sig = request.headers.get('x-meraaj-signature')
      if (!meraajVerify(rawBody, sig)) {
        // v3.52 — diagnostic trail: secret mismatches on LIVE were silent; now every rejected
        // webhook is logged so the office/Meraaj team can detect delivery failures instantly.
        try { await db.collection('meraaj_webhook_log').insertOne({ id: uuidv4(), ok: false, reason: 'invalid_signature', has_signature: !!sig, body_head: String(rawBody || '').slice(0, 400), at: new Date() }) } catch {}
        return bad('توقيع غير صالح — Invalid HMAC signature', 401)
      }
      let evt
      try { evt = JSON.parse(rawBody) } catch { return bad('JSON غير صالح') }
      const type = evt.type
      const data = evt.data || {}
      // Idempotency: skip if this external event id was already processed
      if (evt.id) {
        const seen = await db.collection('meraaj_inbound_events').findOne({ external_id: evt.id })
        if (seen) return ok({ received: true, duplicate: true })
        await db.collection('meraaj_inbound_events').insertOne({ id: uuidv4(), external_id: evt.id, type, received_at: new Date() })
      }
      if (type === 'meraaj.booking.created') {
        // v3.76 — CONTRACT LOCK: package_ref MUST equal rahal_ref (= packages.id in Rahaal, sent at share).
        // Resilient resolution (same contract, no redesign): the Meraaj-side package id (meraaj.remote_id)
        // and an explicit data.rahal_ref are accepted as aliases of the SAME package.
        const pkgRefRaw = String(data.package_ref || '').trim().slice(0, 80)
        const rahalRefRaw = String(data.rahal_ref || '').trim().slice(0, 80)
        const pkgOr = []
        if (pkgRefRaw) pkgOr.push({ id: pkgRefRaw }, { 'meraaj.remote_id': pkgRefRaw })
        if (rahalRefRaw && rahalRefRaw !== pkgRefRaw) pkgOr.push({ id: rahalRefRaw }, { 'meraaj.remote_id': rahalRefRaw })
        const pkg = pkgOr.length ? await db.collection('packages').findOne({ $or: pkgOr }) : null
        if (!pkg) {
          try { await db.collection('meraaj_webhook_log').insertOne({ id: uuidv4(), ok: false, reason: 'unknown_package_ref', package_ref: pkgRefRaw.slice(0, 60), booking_ref: String(data.booking_ref || '').slice(0, 60), at: new Date() }) } catch {}
          return cors(NextResponse.json({
            error: 'unknown_package_ref',
            message: 'الباكج غير موجود — package_ref يجب أن يساوي rahal_ref (packages.id في رحّال) المستلم عند التسجيل، أو meraaj_package_id المعاد من رحّال',
            received_package_ref: pkgRefRaw || null,
            received_rahal_ref: rahalRefRaw || null,
          }, { status: 404 }))
        }
        if (!pkg.meraaj?.shared) return bad('الباكج غير مُشارَك', 403)
        // v3.73 — ENTERPRISE VALIDATION: bookings are only accepted for live, listed packages
        if (pkg.status !== 'open' || pkg.archived || pkg.meraaj.dispatched) {
          try { await db.collection('meraaj_webhook_log').insertOne({ id: uuidv4(), ok: false, reason: 'package_not_available', booking_ref: String(data.booking_ref || '').slice(0, 60), package_ref: pkg.id, at: new Date() }) } catch {}
          return cors(NextResponse.json({ error: 'package_not_available', message: 'الباكج غير متاح للحجز (مغلق أو مؤرشف أو مُفوَّج)', package_ref: pkg.id }, { status: 409 }))
        }
        // v3.73 — duplicate booking_ref belt (idempotency beyond event id): same active ref → ack, no double-create
        const dupRef = String(data.booking_ref || '').slice(0, 60)
        if (dupRef) {
          const dupExisting = await db.collection('meraaj_inbound_bookings').findOne({ meraaj_booking_ref: dupRef, tenant_id: pkg.tenant_id, status: { $in: ['new', 'approved'] } })
          if (dupExisting) return ok({ received: true, duplicate_booking_ref: true, inbound_id: dupExisting.id, status: dupExisting.status })
        }
        const registrants = (Array.isArray(data.registrants) ? data.registrants : []).slice(0, 200).map(r => ({
          name: String(r.name || '').trim().slice(0, 80),
          passport_no: String(r.passport_no || '').trim().toUpperCase().slice(0, 30),
          age: r.age === '' || r.age === null || r.age === undefined ? null : Math.max(0, Math.min(120, Number(r.age) || 0)),
          room_type: String(r.room_type || '').trim().slice(0, 40),
        })).filter(r => r.name)
        if (registrants.length === 0) return bad('قائمة المسافرين (registrants) مطلوبة مع العمر ونوع الغرفة')
        // v3.25 — AGE-AWARE PRICING: compute each traveller's price from the marketplace table (room + age)
        const marketMap = {}
        for (const row of (pkg.meraaj.market_pricing || [])) marketMap[row.room_type] = row
        let adults = 0, children = 0, infants = 0
        let computedTotal = 0, commissionTotal = 0, netTotal = 0
        const priced = []
        for (const r of registrants) {
          const cat = ageCategoryOf(r.age)
          if (cat === 'adult') adults++; else if (cat === 'child') children++; else infants++
          const row = marketMap[r.room_type]
          if (!row) return bad(`نوع الغرفة "${r.room_type || 'غير محدد'}" غير متاح في تسعير هذا الباكج — الأنواع المتاحة: ${Object.keys(marketMap).join('، ') || 'لا يوجد'}`)
          const price = Number(row.customer[cat]) || 0
          computedTotal += price
          commissionTotal += Number(row.commission[cat]) || 0
          netTotal += Number(row.net[cat]) || 0
          priced.push({ ...r, age_category: cat, price })
        }
        computedTotal = +computedTotal.toFixed(2)
        commissionTotal = +commissionTotal.toFixed(2)
        netTotal = +netTotal.toFixed(2)
        // Seats consume billed persons only (infants do not occupy seats)
        const seats = adults + children
        if (seats === 0) return bad('يجب وجود بالغ أو طفل واحد على الأقل')
        const available = meraajAvailability(pkg)
        if (seats > available) return bad(`المقاعد المتاحة غير كافية (متاح: ${available}، مطلوب: ${seats})`, 409)
        const sentTotal = data.total_price !== undefined ? +(Number(data.total_price) || 0).toFixed(2) : null
        // v3.73 — PRICE MISMATCH = HARD REJECT (409), never a warning. Tolerance: 0.01.
        // No inbound doc, no seat hold, no approval, no booking.approved — attempt is audit-logged.
        if (sentTotal !== null && Math.abs(sentTotal - computedTotal) > 0.01) {
          try {
            await db.collection('meraaj_webhook_log').insertOne({
              id: uuidv4(), ok: false, reason: 'price_mismatch',
              booking_ref: dupRef, package_ref: pkg.id, tenant_id: pkg.tenant_id,
              sent_total: sentTotal, current_total: computedTotal, currency: pkg.currency,
              buyer_office_name: String(data.buyer_office_name || '').slice(0, 120), at: new Date(),
            })
          } catch {}
          return cors(NextResponse.json({
            error: 'price_mismatch',
            message: 'السعر المرسل لا يطابق السعر الحالي',
            sent_total: sentTotal,
            current_total: computedTotal,
            currency: pkg.currency,
          }, { status: 409 }))
        }
        const nowRcv = new Date()
        const inbound = {
          id: uuidv4(), tenant_id: pkg.tenant_id, package_id: pkg.id, package_name: pkg.name,
          meraaj_booking_ref: String(data.booking_ref || '').slice(0, 60),
          buyer_office_name: String(data.buyer_office_name || 'مكتب عبر معراج').slice(0, 120),
          registrants: priced, seats,
          pax_adults: adults, pax_children: children, pax_infants: infants,
          total_price: computedTotal,           // authoritative: computed from room+age matrix
          sent_total: sentTotal,                 // what Meraaj sent (for reconciliation)
          price_check: sentTotal === null ? 'not_sent' : (Math.abs(sentTotal - computedTotal) <= 0.01 ? 'match' : 'mismatch'),
          agent_commission_total: commissionTotal,
          net_to_seller_total: netTotal,
          currency: CURRENCIES.includes(data.currency) ? data.currency : pkg.currency,
          route: String(data.route || '').trim().slice(0, 200) || null, // v3.72 — trip route from Meraaj
          status: 'new', // new | cancelled | approved (approval into accounting is a manual office step)
          cancellation_status: null, // v3.73 — null | requested | approved | rejected
          history: [ // v3.73 — enterprise audit trail: every lifecycle step with timestamp + actor
            { at: nowRcv, action: 'received', actor: 'meraaj', note: `booking_ref: ${dupRef || '—'}` },
            { at: nowRcv, action: 'price_validated', actor: 'system', note: sentTotal === null ? 'not_sent' : 'match' },
          ],
          created_at: nowRcv,
        }
        await db.collection('meraaj_inbound_bookings').insertOne(inbound)
        // v3.77 — TRAVELER DOCUMENTS ingestion (documented contract extension, fully optional):
        // data.registrants[i].documents = [{ type: 'passport'|'visa'|'other', url, label }] (max 10/registrant).
        // Stored as metadata refs (external_url driver) so the authorized seller office can view them
        // on the PENDING booking. No file bytes are copied — Meraaj stays the host of buyer uploads.
        try {
          const trvDocs = []
          const rawRegs = Array.isArray(data.registrants) ? data.registrants : []
          registrants.forEach((rg, idx) => {
            const docsIn = Array.isArray(rawRegs[idx]?.documents) ? rawRegs[idx].documents.slice(0, 10) : []
            for (const d of docsIn) {
              // v3.85 — 2048 (was 600): Meraaj signed URLs carry long signatures/tokens — a 600-char
              // cut silently corrupted the link and the document was lost for the seller office.
              const u = String(d?.url || '').trim().slice(0, 2048)
              if (!/^https?:\/\//i.test(u)) continue
              trvDocs.push({
                id: uuidv4(), tenant_id: pkg.tenant_id, inbound_id: inbound.id,
                booking_ref: inbound.meraaj_booking_ref, context: 'traveler', source: 'meraaj',
                registrant_index: idx, registrant_name: rg.name, passport_no: rg.passport_no || null,
                doc_type: ['passport', 'visa', 'ticket', 'photo', 'other'].includes(d?.type) ? d.type : 'other', // v3.85 — + ticket/photo
                label: String(d?.label || '').slice(0, 120), filename: null, content_type: null, size: null,
                storage: { driver: 'external_url', url: u },
                uploaded_by: 'meraaj', uploaded_at: nowRcv,
              })
            }
          })
          if (trvDocs.length > 0) {
            await db.collection('booking_documents').insertMany(trvDocs)
            for (const d of trvDocs) await docAuditLog(db, pkg.tenant_id, 'uploaded', d.id, 'meraaj', { context: 'traveler', via: 'booking.created' })
          }
        } catch { /* ingestion must never reject the booking webhook */ }
        await db.collection('packages').updateOne({ id: pkg.id }, { $inc: { 'meraaj.seats_sold': seats } })
        // v3.53 — Optional AUTO-APPROVE (per-office setting): converts the booking instantly.
        // Failure NEVER rejects the webhook — the booking simply stays pending for manual approval.
        let autoApproved = false
        try {
          const tsAuto = await db.collection('tenant_settings').findOne({ tenant_id: pkg.tenant_id })
          if (tsAuto?.meraaj_auto_approve) {
            await approveMeraajInboundBooking(db, pkg.tenant_id, inbound)
            autoApproved = true
          }
        } catch (autoErr) { console.error('[MERAAJ] auto-approve failed (booking stays pending):', autoErr?.message) }
        await maybeEmitMeraajInventory(db, pkg.tenant_id, pkg.id)
        await meraajAutoListing(db, pkg.tenant_id, pkg.id) // v3.72 — hide from market if now full
        const { _id, ...rest } = inbound
        return ok({ received: true, inbound_booking: rest, auto_approved: autoApproved, seats_remaining: meraajAvailability({ ...pkg, meraaj: { ...pkg.meraaj, seats_sold: (Number(pkg.meraaj.seats_sold) || 0) + seats } }) })
      }
      // v3.77.1 — DOCUMENTS UPDATED after booking creation (metadata only — ZERO financial
      // effect, ZERO status change): buyer uploads more traveler documents in Meraaj and they
      // attach to the SAME booking_ref + the correct registrant. Accepted shapes (both):
      //   data.documents   = [{ registrant_index, type, url, label }]
      //   data.registrants = [{ documents: [{ type, url, label }] }]  (aligned by index)
      if (type === 'meraaj.booking.documents_updated') {
        const inboundDU = await db.collection('meraaj_inbound_bookings').findOne({ meraaj_booking_ref: String(data.booking_ref || '') })
        if (!inboundDU) return cors(NextResponse.json({ error: 'unknown_booking_ref', message: 'الحجز غير موجود — booking_ref يجب أن يطابق data.booking_ref لحدث booking.created الذي قبِله رحّال (HTTP 200)', received_booking_ref: String(data.booking_ref || '').slice(0, 60) || null }, { status: 404 }))
        const regsDU = Array.isArray(inboundDU.registrants) ? inboundDU.registrants : []
        // normalize both accepted shapes into one flat list
        const flat = []
        for (const d of (Array.isArray(data.documents) ? data.documents.slice(0, 100) : [])) {
          flat.push({ idx: Number(d?.registrant_index), type: d?.type, url: d?.url, label: d?.label })
        }
        const shapeRegs = Array.isArray(data.registrants) ? data.registrants.slice(0, regsDU.length) : []
        shapeRegs.forEach((r, idx) => {
          for (const d of (Array.isArray(r?.documents) ? r.documents.slice(0, 10) : [])) flat.push({ idx, type: d?.type, url: d?.url, label: d?.label })
        })
        let added = 0, skipped = 0
        for (const d of flat) {
          const u = String(d.url || '').trim().slice(0, 2048) // v3.85 — long signed URLs must not be cut
          if (!/^https?:\/\//i.test(u)) { skipped++; continue }
          if (!Number.isInteger(d.idx) || d.idx < 0 || d.idx >= regsDU.length) { skipped++; continue }
          // idempotent: same registrant + same URL never duplicated (safe replays)
          const dupDU = await db.collection('booking_documents').findOne({ inbound_id: inboundDU.id, registrant_index: d.idx, 'storage.url': u })
          if (dupDU) { skipped++; continue }
          const perRegCount = await db.collection('booking_documents').countDocuments({ inbound_id: inboundDU.id, registrant_index: d.idx, source: 'meraaj' })
          if (perRegCount >= 10) { skipped++; continue }
          const docDU = {
            id: uuidv4(), tenant_id: inboundDU.tenant_id, inbound_id: inboundDU.id,
            booking_ref: inboundDU.meraaj_booking_ref, context: 'traveler', source: 'meraaj',
            registrant_index: d.idx, registrant_name: regsDU[d.idx]?.name || null, passport_no: regsDU[d.idx]?.passport_no || null,
            doc_type: ['passport', 'visa', 'ticket', 'photo', 'other'].includes(d.type) ? d.type : 'other', // v3.85 — + ticket/photo
            label: String(d.label || '').slice(0, 120), filename: null, content_type: null, size: null,
            storage: { driver: 'external_url', url: u },
            uploaded_by: 'meraaj', uploaded_at: new Date(),
          }
          await db.collection('booking_documents').insertOne(docDU)
          await docAuditLog(db, inboundDU.tenant_id, 'uploaded', docDU.id, 'meraaj', { context: 'traveler', via: 'booking.documents_updated', registrant_index: d.idx })
          added++
        }
        if (added > 0) {
          await db.collection('meraaj_inbound_bookings').updateOne({ id: inboundDU.id }, {
            $push: { history: { at: new Date(), action: 'documents_updated', actor: 'meraaj', note: `${added} مستند مسافر جديد من معراج` } },
          })
        }
        return ok({ received: true, documents_added: added, documents_skipped: skipped })
      }
      if (type === 'meraaj.booking.cancelled') {
        const inbound = await db.collection('meraaj_inbound_bookings').findOne({ meraaj_booking_ref: String(data.booking_ref || ''), status: { $ne: 'cancelled' } })
        if (!inbound) return cors(NextResponse.json({ error: 'unknown_booking_ref', message: 'الحجز غير موجود أو مُلغى مسبقاً — booking_ref يجب أن يطابق data.booking_ref لحدث booking.created الذي قبِله رحّال (HTTP 200)', received_booking_ref: String(data.booking_ref || '').slice(0, 60) || null }, { status: 404 }))
        // v3.73 — ENTERPRISE SPLIT: an APPROVED booking is NEVER cancelled directly by the buyer.
        // It becomes a cancellation REQUEST that the package owner must approve/reject.
        if (inbound.status === 'approved') {
          if (inbound.cancellation_status === 'requested') return ok({ received: true, duplicate: true, cancellation_status: 'requested' })
          await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id }, {
            $set: { cancellation_status: 'requested', cancellation_requested_at: new Date(), cancellation_reason: String(data.reason || '').slice(0, 300) },
            $push: { history: { at: new Date(), action: 'cancellation_requested', actor: 'meraaj', note: String(data.reason || '').slice(0, 300) } },
          })
          return ok({ received: true, converted_to: 'cancellation_request', note: 'الحجز معتمد — سُجل كطلب إلغاء يحتاج قرار صاحب الباكيج' })
        }
        if (inbound.status === 'rejected') return ok({ received: true, note: 'الحجز مرفوض مسبقاً — لا إجراء' })
        // status === 'new' → direct cancel before approval (release the held seats once)
        const claimC = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
          { id: inbound.id, status: 'new' },
          { $set: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: String(data.reason || '').slice(0, 200) }, $push: { history: { at: new Date(), action: 'cancelled', actor: 'meraaj', note: 'إلغاء قبل الاعتماد' } } },
        )
        if (!claimC) return ok({ received: true, duplicate: true })
        await db.collection('packages').updateOne({ id: inbound.package_id }, { $inc: { 'meraaj.seats_sold': -inbound.seats } })
        await maybeEmitMeraajInventory(db, inbound.tenant_id, inbound.package_id)
        await meraajAutoListing(db, inbound.tenant_id, inbound.package_id) // v3.72 — relist if seats freed
        return ok({ received: true, released_seats: inbound.seats })
      }
      // v3.73 — explicit cancellation REQUEST for an approved booking (enterprise flow):
      // recorded only — the booking stays approved until the package owner decides.
      if (type === 'meraaj.booking.cancellation_requested') {
        const inbound = await db.collection('meraaj_inbound_bookings').findOne({ meraaj_booking_ref: String(data.booking_ref || '') })
        if (!inbound) return cors(NextResponse.json({ error: 'unknown_booking_ref', message: 'الحجز غير موجود — booking_ref يجب أن يطابق data.booking_ref لحدث booking.created الذي قبِله رحّال (HTTP 200)', received_booking_ref: String(data.booking_ref || '').slice(0, 60) || null }, { status: 404 }))
        if (inbound.status === 'cancelled') return ok({ received: true, note: 'الحجز ملغى مسبقاً' })
        if (inbound.status === 'rejected') return ok({ received: true, note: 'الحجز مرفوض مسبقاً — لا إجراء' })
        if (inbound.status === 'new') {
          // graceful: a pending request is simply closed (same as booking.cancelled before approval)
          const claimN = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
            { id: inbound.id, status: 'new' },
            { $set: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: String(data.reason || '').slice(0, 200) }, $push: { history: { at: new Date(), action: 'cancelled', actor: 'meraaj', note: 'طلب إلغاء وصل قبل الاعتماد — أُغلق مباشرة' } } },
          )
          if (claimN) {
            await db.collection('packages').updateOne({ id: inbound.package_id }, { $inc: { 'meraaj.seats_sold': -inbound.seats } })
            await maybeEmitMeraajInventory(db, inbound.tenant_id, inbound.package_id)
            await meraajAutoListing(db, inbound.tenant_id, inbound.package_id)
          }
          return ok({ received: true, closed_pending: true })
        }
        if (inbound.cancellation_status === 'requested') return ok({ received: true, duplicate: true, cancellation_status: 'requested' })
        await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id }, {
          $set: { cancellation_status: 'requested', cancellation_requested_at: new Date(), cancellation_reason: String(data.reason || '').slice(0, 300) },
          $push: { history: { at: new Date(), action: 'cancellation_requested', actor: 'meraaj', note: String(data.reason || '').slice(0, 300) } },
        })
        return ok({ received: true, cancellation_status: 'requested' })
      }
      // v3.74 — ESCROW FINAL DECISION (Meraaj Super Admin) — THE ONLY event that moves seats
      // and money after approval. Contract-frozen: meraaj.booking.cancellation_finalized.
      // Settlement equation enforced: refund + seller_compensation + platform_adjustment = original.
      // Accounting: settlement entries (skipQuota — platform-mandated, signed, idempotent),
      // dated TODAY (current open period), ref to the original JE. NO blind full mirror:
      // executed supplier costs already recorded in the ORIGINAL JE are PRESERVED (not reversed,
      // never re-created) up to min(position costs, recorded costs) — zero double-posting.
      if (type === 'meraaj.booking.cancellation_finalized') {
        const inbound = await db.collection('meraaj_inbound_bookings').findOne({ meraaj_booking_ref: String(data.booking_ref || '') })
        if (!inbound) return cors(NextResponse.json({ error: 'unknown_booking_ref', message: 'الحجز غير موجود — booking_ref يجب أن يطابق data.booking_ref لحدث booking.created الذي قبِله رحّال (HTTP 200)', received_booking_ref: String(data.booking_ref || '').slice(0, 60) || null }, { status: 404 }))
        const decision = String(data.decision || '')
        if (!['cancelled', 'kept'].includes(decision)) return bad('قرار غير معروف — cancelled أو kept فقط')
        const decidedBy = String(data.decided_by || 'super_admin').slice(0, 120)
        const platReason = String(data.reason || '').slice(0, 400)
        if (decision === 'kept') {
          if (inbound.status !== 'approved') return ok({ received: true, note: `الحجز بحالة ${inbound.status} — قرار الإبقاء لا يغير شيئاً` })
          await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id }, {
            $set: { cancellation_status: 'rejected_by_platform', platform_decision: { decision, reason: platReason, decided_by: decidedBy, decided_at: data.decided_at || new Date() } },
            $push: { history: { at: new Date(), action: 'cancellation_rejected_by_platform', actor: decidedBy, note: platReason } },
          })
          return ok({ received: true, decision: 'kept', booking_status: 'approved' })
        }
        // decision === 'cancelled' — FINANCIAL VALIDATION FIRST (any mismatch → 409, ZERO effects)
        if (inbound.status === 'cancelled') return ok({ received: true, note: 'الحجز ملغى مسبقاً — لا تنفيذ مزدوج' })
        if (inbound.status !== 'approved') return bad(`الحجز بحالة ${inbound.status} — التنفيذ النهائي يخص الحجوزات المعتمدة فقط`, 409)
        const r2 = (v) => +(Number(v) || 0).toFixed(2)
        const O74 = r2(data.original_amount), R74 = r2(data.refund_amount), S74 = r2(data.seller_compensation), P74 = r2(data.platform_adjustment)
        const mismatch = (detail, extra) => cors(NextResponse.json({ error: 'settlement_mismatch', detail, ...extra }, { status: 409 }))
        if (String(data.currency || '') !== String(inbound.currency || '')) return mismatch('currency', { expected_currency: inbound.currency, received_currency: data.currency || null })
        if (Math.abs(O74 - r2(inbound.total_price)) > 0.01) return mismatch('original_amount', { expected_original: r2(inbound.total_price), received_original: O74 })
        if (Math.abs((R74 + S74 + P74) - O74) > 0.01) return mismatch('equation', { expected_total: O74, received_sum: r2(R74 + S74 + P74), refund_amount: R74, seller_compensation: S74, platform_adjustment: P74 })
        // ATOMIC claim — seats/accounting execute EXACTLY once
        const nowF = new Date()
        const settlement = { decision, original_amount: O74, refund_amount: R74, seller_compensation: S74, platform_adjustment: P74, currency: inbound.currency, reason: platReason, decided_by: decidedBy, decided_at: data.decided_at || nowF }
        const claimF = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
          { id: inbound.id, status: 'approved' },
          {
            $set: { status: 'cancelled', cancellation_status: 'finalized_cancelled', cancelled_at: nowF, cancelled_by: decidedBy, platform_decision: settlement },
            $push: { history: { at: nowF, action: 'cancellation_finalized', actor: decidedBy, note: `refund ${R74} + تعويض ${S74} + منصة ${P74} = ${O74} ${inbound.currency}` } },
          },
        )
        if (!claimF) return ok({ received: true, note: 'تم التنفيذ مسبقاً — لا أثر مزدوج' })
        // 1) seats released exactly once + relist logic
        await db.collection('packages').updateOne({ id: inbound.package_id, tenant_id: inbound.tenant_id }, { $inc: { 'meraaj.seats_sold': -inbound.seats } })
        await meraajAutoListing(db, inbound.tenant_id, inbound.package_id)
        await maybeEmitMeraajInventory(db, inbound.tenant_id, inbound.package_id)
        // 2) package_booking soft-cancel (audit retained)
        let accountingApplied = false, accountingNote = null, cKept = 0
        if (inbound.booking_id) {
          await db.collection('package_bookings').updateOne({ id: inbound.booking_id, tenant_id: inbound.tenant_id }, { $set: { status: 'cancelled', cancelled_at: nowF, cancel_source: 'meraaj_escrow_finalized' } })
          // 3) SETTLEMENT ACCOUNTING — idempotency belt: one settlement per booking, ever
          try {
            const T74 = inbound.tenant_id
            const priorSet = await db.collection('journal_entries').findOne({ tenant_id: T74, ref_type: 'meraaj_escrow_settlement', ref_id: inbound.booking_id })
            const priorRev = await db.collection('journal_entries').findOne({ tenant_id: T74, ref_type: 'package_booking_cancellation', ref_id: inbound.booking_id })
            if (priorSet || priorRev) {
              accountingNote = 'قيد تسوية/عكس سابق موجود لهذا الحجز — لم يُنشأ قيد مزدوج'
            } else {
              const origJe = await db.collection('journal_entries').findOne({ tenant_id: T74, ref_type: 'package_booking', ref_id: inbound.booking_id })
              if (origJe && Array.isArray(origJe.lines)) {
                // recorded supplier obligations (from the ORIGINAL entry — the only allowed source)
                const supLines = origJe.lines.filter(l => l.party_type === 'supplier')
                const supRecorded = +supLines.reduce((s, l) => s + ((Number(l.credit) || 0) - (Number(l.debit) || 0)), 0).toFixed(2)
                const posCosts = r2(inbound.meraaj_cancellation_position?.actual_costs_total)
                // RULE (approved): C_keep = min(position costs, recorded supplier obligations).
                // Costs claimed but NOT recorded in the original JE are NEVER auto-posted —
                // they are flagged for manual accounting review instead.
                cKept = Math.min(posCosts, supRecorded)
                const settleLines = []
                let keepRemaining = cKept
                for (const l of origJe.lines) {
                  const amtD = Number(l.debit) || 0, amtC = Number(l.credit) || 0
                  if (l.party_type === 'supplier') {
                    const obligation = +(amtC - amtD).toFixed(2)
                    const keepHere = Math.min(keepRemaining, Math.max(0, obligation))
                    keepRemaining = +(keepRemaining - keepHere).toFixed(2)
                    const reverseAmt = +(obligation - keepHere).toFixed(2)
                    if (reverseAmt > 0) settleLines.push({ ...l, debit: reverseAmt, credit: 0 })
                  } else {
                    settleLines.push({ ...l, debit: amtC, credit: amtD }) // client + revenue: full mirror
                  }
                }
                if (cKept > 0) settleLines.push({ account_code: COA.OPEX, account_name: 'مصاريف تشغيلية', party_type: 'expense', party_id: null, party_name: `خدمات منفذة لحجز معراج ملغى ${inbound.meraaj_booking_ref || ''}`, debit: cKept, credit: 0 })
                if (S74 > 0) {
                  const cliLine = origJe.lines.find(l => l.party_type === 'client')
                  settleLines.push({ account_code: COA.CLIENTS, account_name: 'العملاء', party_type: 'client', party_id: cliLine?.party_id || inbound.client_id, party_name: cliLine?.party_name || inbound.client_name, debit: S74, credit: 0 })
                  settleLines.push({ account_code: COA.REV_CANCEL_FEES, account_name: 'رسوم إلغاء واسترداد', party_type: 'revenue', party_id: null, party_name: `تعويض إلغاء معراج ${inbound.meraaj_booking_ref || ''} — قرار ${decidedBy}`, debit: 0, credit: S74 })
                }
                await createJournalEntry(db, T74, {
                  date: nowF, // current OPEN period — locked periods are never touched (closed_until is always past-dated)
                  description: `تسوية إلغاء Escrow معراج ${inbound.meraaj_booking_ref || ''} — قرار ${decidedBy}: استرداد ${R74} + تعويض ${S74} + منصة ${P74} = ${O74} ${inbound.currency}`,
                  ref_type: 'meraaj_escrow_settlement', ref_id: inbound.booking_id, currency: origJe.currency, lines: settleLines,
                }, { skipQuota: true }) // approved: platform-mandated signed system entry only
                // balances: client net = -O + S ; suppliers reversed only for the NON-kept portion
                const cliLine2 = origJe.lines.find(l => l.party_type === 'client')
                if (cliLine2?.party_id) {
                  const cliNet74 = +(((Number(cliLine2.debit) || 0) - (Number(cliLine2.credit) || 0))).toFixed(2)
                  await updateBalance(db, 'clients', { id: cliLine2.party_id, tenant_id: T74 }, origJe.currency, +(S74 - cliNet74).toFixed(2))
                }
                let keepRem2 = cKept
                for (const l of supLines) {
                  const obligation = +((Number(l.credit) || 0) - (Number(l.debit) || 0)).toFixed(2)
                  const keepHere = Math.min(keepRem2, Math.max(0, obligation))
                  keepRem2 = +(keepRem2 - keepHere).toFixed(2)
                  const reverseAmt = +(obligation - keepHere).toFixed(2)
                  if (reverseAmt > 0 && l.party_id) await updateBalance(db, 'suppliers', { id: l.party_id, tenant_id: T74 }, origJe.currency, -reverseAmt)
                }
                accountingApplied = true
                if (posCosts > supRecorded + 0.01) {
                  await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id }, { $push: { history: { at: new Date(), action: 'unrecorded_costs_reported', actor: 'system', note: `المكتب صرّح بتكاليف ${posCosts} والمسجل أصلاً ${supRecorded} — الفارق يحتاج قيداً يدوياً من المحاسب` } } })
                }
              } else {
                accountingNote = 'لا يوجد قيد أصلي مرتبط — لا أثر محاسبي (حجز بلا قيد)'
              }
            }
          } catch (setErr) {
            accountingNote = setErr.message || 'فشل قيد التسوية — يحتاج معالجة يدوية'
            await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id }, { $push: { history: { at: new Date(), action: 'settlement_accounting_failed', actor: 'system', note: accountingNote } } })
          }
        } else {
          accountingNote = 'لا يوجد حجز محاسبي مرتبط (booking_id فارغ)'
        }
        if (accountingApplied) {
          await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id }, { $push: { history: { at: new Date(), action: 'settlement_accounting_posted', actor: 'system', note: `عكس مع الإبقاء على تكاليف منفذة ${cKept} + تعويض ${S74}` } } })
        }
        return ok({ received: true, decision: 'cancelled', released_seats: inbound.seats, accounting_applied: accountingApplied, kept_executed_costs: cKept, accounting_note: accountingNote })
      }
      // v3.72 — trip route pushed from the Meraaj dashboard → stored on the package and
      // displayed in Rahaal screens (data: { package_ref, route }). Idempotent by event id.
      if (type === 'meraaj.package.route_updated') {
        const pkgR = await db.collection('packages').findOne({ id: data.package_ref })
        if (!pkgR) return bad('الباكج غير موجود', 404)
        const routeStr = String(data.route || '').trim().slice(0, 200)
        await db.collection('packages').updateOne({ id: pkgR.id }, { $set: { 'meraaj.route': routeStr, 'meraaj.route_updated_at': new Date() } })
        return ok({ received: true, package_ref: pkgR.id, route: routeStr })
      }
      // v3.38 — REFLECTION: a package created/published/updated on MERAAJ by an office that also exists in Rahaal
      // must be stored in Rahaal and linked to the CORRECT office. Matching is STRICTLY by ids
      // (rahal_ref, meraaj_package_id, office_ref = Rahaal tenant id) — NEVER by office/package names.
      if (type === 'meraaj.package.published' || type === 'meraaj.package.created' || type === 'meraaj.package.updated') {
        const meraajId = String(data.meraaj_package_id || data.package_id || '').trim()
        const officeRef = String(data.office_ref || data.rahal_office_ref || '').trim()
        if (!meraajId) return bad('meraaj_package_id مطلوب لأحداث انعكاس الباقات', 422)
        const tenant = officeRef ? await db.collection('tenants').findOne({ id: officeRef }) : null
        // Locate existing package: 1) by rahal_ref  2) by stored meraaj.remote_id
        let existing = null
        if (data.rahal_ref) existing = await db.collection('packages').findOne({ id: String(data.rahal_ref) })
        if (!existing) existing = await db.collection('packages').findOne({ 'meraaj.remote_id': meraajId })
        if (existing && officeRef && existing.tenant_id !== officeRef) return bad('عدم تطابق المكتب — الباقة مرتبطة بمكتب آخر', 403)
        if (!existing && !tenant) return bad('office_ref غير معروف في رحّال — لا يمكن ربط الباقة بمكتب', 422)
        // Tolerant room pricing mapping (accepts Contract-v2 matrix rows or simple rows)
        const mapRooms = (rows) => (Array.isArray(rows) ? rows : []).map(r => ({
          type: String(r.room_type || r.type || '').trim(),
          sale_per_pax: Number(r.sale_per_pax ?? r.base?.adult ?? r.customer?.adult ?? r.net?.adult) || 0,
          sale_child: (r.sale_child ?? r.base?.child ?? r.customer?.child ?? r.net?.child ?? null),
          sale_infant: Number(r.sale_infant ?? r.base?.infant ?? r.customer?.infant ?? r.net?.infant) || 0,
        })).filter(r => r.type)
        // PARTIAL semantics: only fields present in the event are applied — absent fields are NEVER wiped
        const upd = { updated_at: new Date() }
        if (data.title !== undefined) upd.name = String(data.title).slice(0, 200)
        if (data.description !== undefined) upd.notes = String(data.description).slice(0, 2000)
        if (data.package_type) upd.package_type = String(data.package_type).slice(0, 40)
        if (data.departure_date) upd.start_date = new Date(data.departure_date)
        if (data.return_date) upd.end_date = new Date(data.return_date)
        if (data.currency && CURRENCIES.includes(data.currency)) upd.currency = data.currency
        if (Array.isArray(data.features)) upd.features = data.features.map(f => String(f).slice(0, 120)).slice(0, 40)
        if (Array.isArray(data.room_pricing) && data.room_pricing.length) upd.room_pricing = mapRooms(data.room_pricing)
        const reflectionSnap = {
          hotels: Array.isArray(data.hotels) ? data.hotels.slice(0, 40) : undefined,
          components: Array.isArray(data.components) ? data.components.slice(0, 60) : undefined,
          package_transports: Array.isArray(data.package_transports) ? data.package_transports.slice(0, 40) : undefined,
          images: Array.isArray(data.images) ? data.images.slice(0, 10) : undefined,
          available_seats: data.available_seats !== undefined ? (Number(data.available_seats) || 0) : undefined,
          last_event_type: type, last_event_at: new Date(),
        }
        Object.keys(reflectionSnap).forEach(k => reflectionSnap[k] === undefined && delete reflectionSnap[k])
        if (existing) {
          const setDoc = { ...upd, 'meraaj.remote_id': meraajId }
          for (const [k, v] of Object.entries(reflectionSnap)) setDoc[`meraaj.reflection.${k}`] = v
          if (!existing.meraaj?.registered_at) setDoc['meraaj.registered_at'] = new Date()
          if (data.available_seats !== undefined) setDoc['meraaj.seats_allocated'] = Number(data.available_seats) || 0
          await db.collection('packages').updateOne({ id: existing.id }, { $set: setDoc })
          return ok({ received: true, reflected: 'updated', rahal_ref: existing.id, tenant_id: existing.tenant_id, meraaj_package_id: meraajId })
        }
        const newPkg = {
          id: uuidv4(), tenant_id: tenant.id,
          name: upd.name || 'باقة من معراج', package_type: upd.package_type || 'umrah',
          currency: upd.currency || 'SAR',
          start_date: upd.start_date || null, end_date: upd.end_date || null,
          room_pricing: upd.room_pricing || [], pricing_mode: 'direct',
          features: upd.features || [], has_image: false,
          notes: upd.notes || '', status: 'open',
          source: 'meraaj_reflection',
          meraaj: {
            shared: true, registered_at: new Date(), remote_id: meraajId,
            seats_allocated: Number(data.available_seats) || 0, seats_sold: 0,
            buyer_commission_mode: 'amount', buyer_commission_value: 0, commission_direction: 'added',
            market_pricing: computeMeraajMarketPricing(upd.room_pricing || [], 'amount', 0, 'added'),
            reflection: reflectionSnap,
          },
          created_at: new Date(),
        }
        await db.collection('packages').insertOne(newPkg)
        return ok({ received: true, reflected: 'created', rahal_ref: newPkg.id, tenant_id: tenant.id, meraaj_package_id: meraajId })
      }
      if (type === 'meraaj.package.deactivated') {
        const meraajId = String(data.meraaj_package_id || data.package_id || '').trim()
        const existing = data.rahal_ref
          ? await db.collection('packages').findOne({ id: String(data.rahal_ref) })
          : await db.collection('packages').findOne({ 'meraaj.remote_id': meraajId })
        if (!existing) return bad('الباقة غير موجودة', 404)
        await db.collection('packages').updateOne({ id: existing.id }, { $set: { 'meraaj.shared': false, 'meraaj.unshared_at': new Date() } })
        return ok({ received: true, reflected: 'deactivated', rahal_ref: existing.id })
      }
      return ok({ received: true, ignored: true, note: `نوع حدث غير معروف: ${type}` })
    }

    // ============ PUBLIC SIGNUP (no auth) ============
    if (route === '/public/signup' && method === 'POST') {
      const b = await request.json()
      if (!b.name || !b.owner_email || !b.owner_password || !b.owner_name) return bad('الاسم الكامل، اسم المكتب، البريد وكلمة المرور مطلوبة')
      // v3.9.18 — Mandatory phone/WhatsApp (with country code)
      const phone = String(b.owner_phone || '').trim()
      if (!phone) return bad('رقم الهاتف / الواتساب مطلوب')
      // Accept international format with optional leading '+' and 7-15 digits
      if (!/^\+?[0-9]{7,15}$/.test(phone.replace(/[\s-]/g, ''))) return bad('رقم الهاتف غير صالح — أدخل رمز الدولة والرقم (مثال: +967771234567)')
      const email = String(b.owner_email).toLowerCase().trim()
      // Accept valid email addresses from any provider.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return bad('البريد الإلكتروني غير صالح')
      }
      if (await db.collection('users').findOne({ email })) return bad('البريد الإلكتروني مستخدم بالفعل')
      const slug = (b.slug || b.name).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40) + '-' + uuidv4().slice(0, 4)
      let referredBy = null
      if (b.referral_code) {
        const ref = await db.collection('tenants').findOne({ referral_code: String(b.referral_code).toUpperCase().trim() })
        if (ref) referredBy = ref.id
      }
      const myCode = genReferralCode()
      // v4.0 — default trial plan: if the Super Admin picked one in pricing settings,
      // its limits drive NEW signups; otherwise the legacy defaults (2 users / 1 branch / 30 entries).
      let trialLimits = { max_users: 2, max_branches: 1, quota: 30, plan_tier: 'standard' }
      try {
        const cfgT = await getPricingConfig(db)
        const dp = cfgT.default_trial_plan_key ? (cfgT.plans || []).find(p => p.key === cfgT.default_trial_plan_key && p.active !== false) : null
        if (dp) trialLimits = {
          max_users: Number(dp.max_users) === 0 ? 9999 : (Number(dp.max_users) || 2),
          max_branches: Number(dp.max_branches) === 0 ? 9999 : (Number(dp.max_branches) || 1),
          quota: Number(dp.quota_limit) > 0 ? Number(dp.quota_limit) : 30,
          plan_tier: dp.key,
        }
      } catch { }
      const tenant = {
        id: uuidv4(), slug, name: b.name, status: 'active',
        max_users: trialLimits.max_users, max_branches: trialLimits.max_branches, subscription: 'trial',
        plan_tier: trialLimits.plan_tier, // v2.8 default tier | v4.0 default trial plan key when configured
        journal_quota: { used: 0, limit: trialLimits.quota, top_ups: [] }, // v2.8 — 30 free entries on signup (was 500)
        referral_code: myCode, referred_by: referredBy,
        referral_stats: { signups: 0, activations: 0, bonus_earned: 0 },
        activation_confirmed: false,
        created_at: new Date(),
      }
      await db.collection('tenants').insertOne(tenant)
      if (referredBy) {
        // v3.9 — Only TRACK the signup; the +50 quota bonus is granted later when
        // super admin activates the paid subscription (see /subscriptions PATCH → paid state).
        await db.collection('tenants').updateOne(
          { id: referredBy },
          {
            $inc: { 'referral_stats.signups': 1 },
            $push: { 'referral_stats.pending_referrals': { referred_tenant: tenant.id, referred_at: new Date(), bonus_amount: 50, paid: false } }
          }
        )
      }
      const userId = uuidv4()
      await db.collection('users').insertOne({
        id: userId, tenant_id: tenant.id, email, name: b.owner_name,
        role: 'owner', active: true,
        phone: phone.replace(/[\s-]/g, ''), // v3.9.18 — Store normalized phone
        password_hash: bcrypt.hashSync(b.owner_password, 8),
        created_at: new Date(),
      })
      // v3.9.18 — Also store owner phone in tenant profile for admin visibility
      await db.collection('tenants').updateOne({ id: tenant.id }, { $set: { owner_phone: phone.replace(/[\s-]/g, '') } })
      await seedTenantDefaults(db, tenant.id)
      // Auto-login
      const sid = uuidv4()
      const expires = new Date(Date.now() + SESSION_DAYS * 86400000)
      await db.collection('sessions').insertOne({ id: sid, user_id: userId, expires_at: expires, created_at: new Date() })
      const cookie = `rahaal_session=${sid}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`
      return ok({ tenant: { ...sanitizeTenant(tenant), journal_quota: tenant.journal_quota }, referral_applied: !!referredBy }, cookie)
    }

    // ============ AUTH ============
    if (route === '/auth/login' && method === 'POST') {
      const b = await request.json()
      if (!b.email || !b.password) return bad('البريد وكلمة المرور مطلوبان')
      const user = await db.collection('users').findOne({ email: String(b.email).toLowerCase().trim() })
      if (!user || !user.active) return bad('بيانات الدخول غير صحيحة', 401)
      const okpw = bcrypt.compareSync(b.password, user.password_hash)
      if (!okpw) return bad('بيانات الدخول غير صحيحة', 401)
      if (user.tenant_id) {
        const t = await db.collection('tenants').findOne({ id: user.tenant_id })
        if (!t || t.status !== 'active') return bad('تم إيقاف المكتب — تواصل مع الإدارة', 403)
      }
      const sid = uuidv4()
      const expires = new Date(Date.now() + SESSION_DAYS * 86400000)
      await db.collection('sessions').insertOne({ id: sid, user_id: user.id, expires_at: expires, created_at: new Date() })
      const cookie = `rahaal_session=${sid}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`
      return ok({ user: sanitizeUser(user), tenant: user.tenant_id ? sanitizeTenant(await db.collection('tenants').findOne({ id: user.tenant_id })) : null }, cookie)
    }

    if (route === '/auth/logout' && method === 'POST') {
      const c = request.headers.get('cookie') || ''
      const m = c.match(/rahaal_session=([^;]+)/)
      if (m) await db.collection('sessions').deleteOne({ id: m[1] })
      const cookie = `rahaal_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
      return ok({ ok: true }, cookie)
    }

    // v3.12 — Forgot Password (admin-mediated: request goes to Super Admin inbox)
    // PUBLIC endpoint. Unified response always (no email enumeration).
    if (route === '/auth/forgot-password' && method === 'POST') {
      const b = await request.json()
      const email = String(b.email || '').toLowerCase().trim()
      if (!email || !email.includes('@')) return bad('البريد الإلكتروني مطلوب')
      const user = await db.collection('users').findOne({ email })
      if (user && user.active) {
        // Avoid duplicate pending requests for the same user
        const existing = await db.collection('password_reset_requests').findOne({ user_id: user.id, status: 'pending' })
        if (!existing) {
          let tenantName = null
          if (user.tenant_id) {
            const t = await db.collection('tenants').findOne({ id: user.tenant_id })
            tenantName = t?.name || null
          }
          await db.collection('password_reset_requests').insertOne({
            id: uuidv4(),
            user_id: user.id,
            email,
            user_name: user.name || '',
            role: user.role,
            tenant_id: user.tenant_id || null,
            tenant_name: tenantName,
            note: String(b.note || '').slice(0, 300),
            status: 'pending',
            created_at: new Date(),
            resolved_at: null,
            resolved_by: null,
          })
        }
      }
      return ok({ message: 'تم استلام طلبك — ستقوم الإدارة بمعالجته والتواصل معك قريباً' })
    }

    // Everything below requires session (except /auth/me which returns null gracefully)
    // v3.8 — Support Bearer PAT auth in addition to cookie session (for Chrome Extension / API clients)
    let sess = await getSession(request, db)
    if (!sess) {
      const patSess = await getPatSession(request, db)
      if (patSess) sess = patSess
    }

    if (route === '/auth/me' && method === 'GET') {
      if (!sess) return ok({ user: null, tenant: null })
      if (sess.blocked) return ok({ user: null, tenant: null, error: 'suspended' })
      let tenantSettings = null
      if (sess.tenant) tenantSettings = await db.collection('tenant_settings').findOne({ tenant_id: sess.tenant.id })
      const quota = sess.tenant?.journal_quota || null
      return ok({
        user: sanitizeUser(sess.user),
        tenant: sess.tenant ? { ...sanitizeTenant(sess.tenant), journal_quota: quota } : null,
        settings: tenantSettings ? { ...tenantSettings, _id: undefined } : null,
        impersonation: !!sess.impersonation,
        impersonated_by: sess.impersonation ? sess.impersonated_by_email : null,
      })
    }

    if (!sess || sess.blocked) return bad('يجب تسجيل الدخول', 401)

    // ============ v3.45 — RBAC PHASE 1: module-level access enforcement (staff only) ============
    // Server-side guard (not just UI hiding). Owner/super_admin bypass. Shared lookup endpoints
    // (/clients, /suppliers, /boxes, /accounts) stay open as they feed dropdowns across screens.
    if (sess.user.role !== 'owner' && !isMainSA(sess.user)) {
      const P = effectivePermissions(sess.user)
      const deny = (label) => bad(`🚫 غير مصرح — ليس لديك صلاحية الوصول إلى قسم ${label}`, 403)
      if (/^\/tickets/.test(route) && !P.mod_tickets) return deny('حجز التذاكر')
      if (/^\/visas/.test(route) && !P.mod_visas) return deny('التأشيرات')
      if ((/^\/services/.test(route) || /^\/service-types/.test(route)) && !P.mod_services) return deny('الخدمات')
      if (/^\/packages/.test(route) && !P.mod_packages && !P.mod_meraaj) return deny('الباكجات والبرامج')
      if (/^\/meraaj\//.test(route) && !P.mod_meraaj) return deny('متجر معراج')
      if (/^\/fx/.test(route) && !P.mod_fx) return deny('صرافة العملات')
      if (/^\/journal-entries/.test(route) && !P.mod_journal) return deny('قيود اليومية')
      if (route === '/reports/query' && !P.mod_query && !P.mod_reports) return deny('مركز الاستعلامات')
      if (/^\/reports\//.test(route) && route !== '/reports/query' && !P.mod_reports) return deny('التقارير المالية')
      if (/^\/vouchers/.test(route) && !P.mod_receipt && !P.mod_payment) return deny('السندات')
      if (/^\/affiliate/.test(route) && !P.mod_affiliate) return deny('التسويق بالعمولة')
      // v3.51 — RBAC Phase 3: fine-grained financial guards (staff only)
      if ((route === '/reports/statement' || route === '/bulk-statement/generate') && !P.fin_statements) return deny('كشوفات الحساب')
      if (/^\/partners\/statements/.test(route) && !P.fin_partner_summary) return deny('ملخص الشركاء')
    }
    // v3.45 — Role templates catalog for the permissions manager (owner only)
    if (route === '/rbac/templates' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      // v3.93 — merge ACTIVE custom templates created in the Super Admin Permissions Center
      // (single RBAC engine — customs are just extra templates offices can assign)
      const customTpls = await db.collection('admin_role_templates').find({ active: true }, { projection: { _id: 0, key: 1, label: 1, desc: 1, perms: 1 } }).toArray().catch(() => [])
      return ok({ templates: [...RBAC_ROLE_TEMPLATES(), ...customTpls], defaults: DEFAULT_STAFF_PERMISSIONS })
    }

    // ============ SUPER ADMIN ============
    if (route.startsWith('/admin/')) {
      // v3.97 — Batch 5: ADMIN REALM GATE (server-side, not UI hiding).
      // Replaces the plain role string check: main super_admin must be
      // tenant-less (a tenant user holding 'super_admin' by mistake is
      // rejected), and rahaal admin staff pass per-section/per-action RBAC.
      const gateErr = await adminGate(db, sess, route, method)
      if (gateErr) return bad(gateErr.error, gateErr.status)

      // v3.97 — Batch 5 delegations: staff RBAC, geo, payments/entities, refdata.
      if (route.startsWith('/admin/staff/') || route.startsWith('/admin/geo/') || route.startsWith('/admin/payfin/') || route.startsWith('/admin/refdata/')) {
        let bodyB5 = null
        if (method !== 'GET') { try { bodyB5 = await request.json() } catch { bodyB5 = {} } }
        const spB5 = new URL(request.url).searchParams
        const canB5 = await adminCan(db, sess)
        const ctxB5 = { currencies: CURRENCIES, baseCurrency: BASE_CURRENCY }
        let rB5
        if (route.startsWith('/admin/staff/')) rB5 = await adminStaffHandler(db, route.slice('/admin/staff'.length), method, spB5, bodyB5, sess)
        else if (route.startsWith('/admin/geo/')) rB5 = await adminGeoHandler(db, route.slice('/admin/geo'.length), method, spB5, bodyB5, sess, canB5)
        else if (route.startsWith('/admin/payfin/')) rB5 = await adminPayFinHandler(db, route.slice('/admin/payfin'.length), method, spB5, bodyB5, sess, canB5, ctxB5)
        else rB5 = await adminRefDataHandler(db, route.slice('/admin/refdata'.length), method, spB5, bodyB5, sess, canB5)
        return rB5?.error ? bad(rB5.error, rB5.status || 400) : ok(rB5)
      }

      // v3.93 — Batch 1 delegations (modular — AUDIT-006). Center = READ-ONLY (GET only).
      if (route.startsWith('/admin/center/') && method === 'GET') {
        const rC = await adminCenterHandler(db, route.slice('/admin/center'.length), new URL(request.url).searchParams)
        return rC?.error ? bad(rC.error, rC.status || 400) : ok(rC)
      }
      if (route.startsWith('/admin/perms/')) {
        let bodyP = null
        if (method !== 'GET') { try { bodyP = await request.json() } catch { bodyP = {} } }
        const rbac = { defaults: DEFAULT_STAFF_PERMISSIONS, templates: RBAC_ROLE_TEMPLATES, ownerAll: () => rbacAllPerms(true) }
        const rP = await adminPermsHandler(db, route.slice('/admin/perms'.length), method, new URL(request.url).searchParams, bodyP, sess, rbac)
        return rP?.error ? bad(rP.error, rP.status || 400) : ok(rP)
      }

      // v4.3 — UNIFIED ORDERS + PROGRAM COMMISSIONS LEDGER (platform_orders /
      // platform_commissions). Sales are order TYPES here — no platform_sales.
      if (route === '/admin/orders' || route.startsWith('/admin/orders/')) {
        let bodyO = null
        if (method !== 'GET') { try { bodyO = await request.json() } catch { bodyO = {} } }
        const rO = await adminOrdersHandler(db, route.slice('/admin/orders'.length), method, new URL(request.url).searchParams, bodyO, sess)
        return rO?.error ? bad(rO.error, rO.status || 400) : ok(rO)
      }
      if (route === '/admin/commissions-ledger' || route.startsWith('/admin/commissions-ledger/')) {
        let bodyL = null
        if (method !== 'GET') { try { bodyL = await request.json() } catch { bodyL = {} } }
        const rL = await adminCommissionsLedgerHandler(db, route.slice('/admin/commissions-ledger'.length), method, new URL(request.url).searchParams, bodyL, sess)
        return rL?.error ? bad(rL.error, rL.status || 400) : ok(rL)
      }

      // v3.94 — Batch 2 delegations (modular). Commissions & Requests = READ-ONLY (GET only).
      if (route.startsWith('/admin/commissions/') && method === 'GET') {
        const rCm = await adminCommissionsHandler(db, route.slice('/admin/commissions'.length), new URL(request.url).searchParams,
          { affiliateRate: AFFILIATE_COMMISSION_RATE, minCashoutIndividual: AFFILIATE_MIN_CASHOUT_INDIVIDUAL, minCashoutOffice: AFFILIATE_MIN_CASHOUT_OFFICE })
        return rCm?.error ? bad(rCm.error, rCm.status || 400) : ok(rCm)
      }
      if (route.startsWith('/admin/requests/') && method === 'GET') {
        const rRq = await adminRequestsHandler(db, route.slice('/admin/requests'.length), new URL(request.url).searchParams)
        return rRq?.error ? bad(rRq.error, rRq.status || 400) : ok(rRq)
      }

      // v3.95 — Batch 3 delegations (modular): System (backup/restore path/status/
      // env/integrations/maintenance config), Central Audit (READ-ONLY, GET only),
      // In-App Notifications. Environment/versions ctx built from REAL constants.
      if (route.startsWith('/admin/system/') || route.startsWith('/admin/audit/') || route.startsWith('/admin/notify/')) {
        let bodyS = null
        if (method !== 'GET') { try { bodyS = await request.json() } catch { bodyS = {} } }
        const baseS = process.env.NEXT_PUBLIC_BASE_URL || ''
        const ctxS = {
          envName: baseS.includes('rahaal-test') ? 'Test' : /emergent|preview/i.test(baseS) ? 'Preview' : 'Live',
          baseHost: baseS.replace(/^https?:\/\//, '').split('/')[0] || null,
          versions: { root: '3.88.4', health: '3.9.28', backup_export: '3.9.20' }, // as hardcoded in this file — shown as-is
          dbNameSafe: process.env.DB_NAME || '(الافتراضي من الاتصال)',
          keys: {
            MERAAJ_SHARED_SECRET: !!process.env.MERAAJ_SHARED_SECRET,
            MERAAJ_API_BASE_URL: !!process.env.MERAAJ_API_BASE_URL,
            MERAAJ_WEBHOOK_URL: !!process.env.MERAAJ_WEBHOOK_URL,
            MERAAJ_STORE_URL: !!process.env.MERAAJ_STORE_URL,
          },
          meraajHostSafe: (() => { try { return new URL(process.env.MERAAJ_API_BASE_URL || '').host || null } catch { return null } })(),
        }
        const spS = new URL(request.url).searchParams
        let rS
        if (route.startsWith('/admin/system/')) rS = await adminSystemHandler(db, route.slice('/admin/system'.length), method, spS, bodyS, sess, ctxS)
        else if (route.startsWith('/admin/audit/')) {
          if (method !== 'GET') return bad('سجل التدقيق قراءة فقط — لا تعديل ولا حذف', 405)
          rS = await adminAuditHandler(db, route.slice('/admin/audit'.length), spS, ctxS)
        } else rS = await adminNotifyHandler(db, route.slice('/admin/notify'.length), method, spS, bodyS, sess)
        return rS?.error ? bad(rS.error, rS.status || 400) : ok(rS)
      }

      // v3.96 — Batch 4 delegations (modular): Reports (READ-ONLY, GET only),
      // Disputes, Currencies & FX. ctx built from the REAL code constants.
      if (route.startsWith('/admin/reports/') || route.startsWith('/admin/disputes') || route.startsWith('/admin/currency/')) {
        let bodyB4 = null
        if (method !== 'GET') { try { bodyB4 = await request.json() } catch { bodyB4 = {} } }
        const baseB4 = process.env.NEXT_PUBLIC_BASE_URL || ''
        const ctxB4 = {
          currencies: CURRENCIES, baseCurrency: BASE_CURRENCY, defaultRates: DEFAULT_RATES,
          envName: baseB4.includes('rahaal-test') ? 'Test' : /emergent|preview/i.test(baseB4) ? 'Preview' : 'Live',
          versions: { root: '3.88.4', health: '3.9.28', backup_export: '3.9.20' },
          keys: { MERAAJ_SHARED_SECRET: !!process.env.MERAAJ_SHARED_SECRET, MERAAJ_API_BASE_URL: !!process.env.MERAAJ_API_BASE_URL, MERAAJ_WEBHOOK_URL: !!process.env.MERAAJ_WEBHOOK_URL, MERAAJ_STORE_URL: !!process.env.MERAAJ_STORE_URL },
          commConsts: { affiliateRate: AFFILIATE_COMMISSION_RATE, minCashoutIndividual: AFFILIATE_MIN_CASHOUT_INDIVIDUAL, minCashoutOffice: AFFILIATE_MIN_CASHOUT_OFFICE },
        }
        const spB4 = new URL(request.url).searchParams
        let rB4
        if (route.startsWith('/admin/reports/')) {
          if (method !== 'GET') return bad('التقارير قراءة فقط', 405)
          rB4 = await adminReportsHandler(db, route.slice('/admin/reports'.length), spB4, ctxB4)
        } else if (route.startsWith('/admin/disputes')) {
          rB4 = await adminDisputesHandler(db, route.slice('/admin/disputes'.length), method, spB4, bodyB4, sess)
        } else {
          rB4 = await adminCurrencyHandler(db, route.slice('/admin/currency'.length), method, spB4, bodyB4, sess, ctxB4)
        }
        return rB4?.error ? bad(rB4.error, rB4.status || 400) : ok(rB4)
      }

      // v3.91 — Phase 2: Office 360° (READ-ONLY — no writes, no balance recomputation).
      // Logic lives in lib/admin360.js; this is a single delegation line (AUDIT-006).
      const office360Match = route.match(/^\/admin\/tenants\/([^/]+)\/office360$/)
      if (office360Match && method === 'GET') {
        const url360 = new URL(request.url)
        const r360 = await getOffice360(db, office360Match[1], url360.searchParams.get('tab') || 'overview')
        if (r360?.error) return bad(r360.error, 404)
        return ok(r360)
      }

      // v3.16 — Installments tracker (SaaS billing follow-up)
      if (route === '/admin/installments-overview' && method === 'GET') {
        const tenants = await db.collection('tenants').find({ billing_mode: 'installments' }).toArray()
        const today = new Date().toISOString().slice(0, 10)
        const rows = tenants.map(t => {
          const list = Array.isArray(t.installments) ? t.installments : []
          const paid = list.filter(i => i.paid).length
          const next = list.find(i => !i.paid) || null
          const overdue = !!(next && next.due_date && String(next.due_date).slice(0, 10) < today)
          return {
            id: t.id, name: t.name, slug: t.slug, plan_tier: t.plan_tier || null,
            unlimited_journals: !!t.unlimited_journals,
            installments: list, paid_count: paid, total_count: list.length,
            next_due: next?.due_date || null, next_amount: next?.amount || null,
            overdue, all_paid: list.length > 0 && paid === list.length,
          }
        })
        rows.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0))
        return ok(rows)
      }
      {
        const mIns = route.match(/^\/admin\/tenants\/([^/]+)\/installments$/)
        // PUT — create/replace the schedule (total, count, start_date → monthly due dates)
        if (mIns && method === 'PUT') {
          const b = await request.json()
          const total = Math.max(0, Number(b.total) || 0)
          const count = Math.min(24, Math.max(1, Number(b.count) || 5))
          if (!total) return bad('المبلغ الإجمالي مطلوب')
          const start = b.start_date ? new Date(b.start_date) : new Date()
          const per = Math.round((total / count) * 100) / 100
          const list = Array.from({ length: count }, (_, i) => {
            const d = new Date(start); d.setMonth(d.getMonth() + i)
            return { no: i + 1, amount: per, due_date: d.toISOString().slice(0, 10), paid: false, paid_at: null }
          })
          await db.collection('tenants').updateOne({ id: mIns[1] }, { $set: { installments: list, billing_mode: 'installments', updated_at: new Date() } })
          return ok({ success: true, installments: list })
        }
        // PATCH — mark a single installment paid/unpaid
        if (mIns && method === 'PATCH') {
          const b = await request.json()
          const t = await db.collection('tenants').findOne({ id: mIns[1] })
          if (!t) return bad('المكتب غير موجود', 404)
          const list = Array.isArray(t.installments) ? t.installments : []
          const idx = list.findIndex(i => i.no === Number(b.no))
          if (idx === -1) return bad('القسط غير موجود')
          list[idx] = { ...list[idx], paid: !!b.paid, paid_at: b.paid ? new Date() : null }
          await db.collection('tenants').updateOne({ id: mIns[1] }, { $set: { installments: list, updated_at: new Date() } })
          const allPaid = list.length > 0 && list.every(i => i.paid)
          return ok({ success: true, all_paid: allPaid, paid_count: list.filter(i => i.paid).length })
        }
      }

      // v3.14 → v4.0 — Pricing config management (flexible discount + dynamic features
      // + per-plan description/currency/duration/quota/active/order + offer window +
      // default trial plan). Every save is audited into the 'pricing_config_history'
      // doc INSIDE the same platform_settings collection — no new collections.
      if (route === '/admin/pricing-config' && method === 'GET') {
        const cfg = await getPricingConfig(db)
        return ok({ ...cfg, _id: undefined })
      }
      if (route === '/admin/pricing-config/history' && method === 'GET') {
        const h = await db.collection('platform_settings').findOne({ id: 'pricing_config_history' })
        return ok({ entries: (h?.entries || []).slice().reverse() })
      }
      if (route === '/admin/pricing-config' && method === 'PUT') {
        const b = await request.json()
        const upd = { id: 'pricing_config', updated_at: new Date(), updated_by: sess.user.email }
        if (b.discount_enabled !== undefined) upd.discount_enabled = !!b.discount_enabled
        if (b.discount_percent !== undefined) upd.discount_percent = Math.min(95, Math.max(0, Number(b.discount_percent) || 0))
        if (b.installments_count !== undefined) upd.installments_count = Math.max(1, Number(b.installments_count) || 5)
        // v4.0 — offer window: when set, the discount applies ONLY inside the window
        if (b.offer_start_at !== undefined) upd.offer_start_at = b.offer_start_at ? new Date(b.offer_start_at) : null
        if (b.offer_end_at !== undefined) upd.offer_end_at = b.offer_end_at ? new Date(b.offer_end_at) : null
        // v4.0 — default trial plan: drives limits for NEW public signups (never retroactive)
        if (b.default_trial_plan_key !== undefined) upd.default_trial_plan_key = ['silver', 'gold', 'enterprise'].includes(b.default_trial_plan_key) ? b.default_trial_plan_key : null
        if (Array.isArray(b.plans)) {
          upd.plans = b.plans
            .filter(p => p && ['silver', 'gold', 'enterprise'].includes(p.key))
            .map((p, i) => ({
              key: p.key,
              name_ar: String(p.name_ar || '').slice(0, 60),
              icon: String(p.icon || '').slice(0, 8),
              description: String(p.description || '').slice(0, 300), // v4.0
              currency: String(p.currency || 'USD').toUpperCase().slice(0, 8), // v4.0
              duration_days: Math.max(1, Number(p.duration_days) || 365), // v4.0
              annual_price: Math.max(0, Number(p.annual_price) || 0),
              max_users: Math.max(0, Number(p.max_users) || 0),
              max_branches: Math.max(0, Number(p.max_branches) || 0),
              quota_limit: Math.max(0, Number(p.quota_limit) || 0), // v4.0 — 0 = لا تُطبَّق حصة من الباقة
              unlimited_journals: !!p.unlimited_journals, // v4.0 — الباقة تمنح قيوداً مفتوحة عند الإسناد
              active: p.active !== false, // v4.0 — تفعيل/تعطيل ظهور الباقة للمشتركين
              sort_order: Number.isFinite(Number(p.sort_order)) ? Number(p.sort_order) : i, // v4.0 — ترتيب الظهور
              features: (Array.isArray(p.features) ? p.features : []).map(f => String(f).slice(0, 120)).filter(Boolean).slice(0, 25),
            }))
        }
        const existing = await db.collection('platform_settings').findOne({ id: 'pricing_config' })
        const prevCfg = existing ? { ...DEFAULT_PRICING_CONFIG, ...existing } : DEFAULT_PRICING_CONFIG
        const merged = { ...prevCfg, ...upd }
        delete merged._id // MongoDB immutable field must never be in $set
        await db.collection('platform_settings').updateOne({ id: 'pricing_config' }, { $set: merged }, { upsert: true })
        // v4.0 — audit trail (المنفذ، التاريخ، القيمة السابقة → الجديدة) field-by-field.
        // NOTE: price/discount changes are NEVER retroactive — existing tenants keep
        // their stored limits/prices until the admin explicitly re-assigns a plan.
        const changes = []
        for (const k of ['discount_enabled', 'discount_percent', 'installments_count', 'default_trial_plan_key', 'offer_start_at', 'offer_end_at']) {
          if (upd[k] !== undefined && JSON.stringify(prevCfg[k] ?? null) !== JSON.stringify(merged[k] ?? null)) changes.push({ field: k, from: prevCfg[k] ?? null, to: merged[k] ?? null })
        }
        if (upd.plans) {
          for (const np of upd.plans) {
            const op = (prevCfg.plans || []).find(x => x.key === np.key) || {}
            for (const f of ['name_ar', 'description', 'currency', 'duration_days', 'annual_price', 'max_users', 'max_branches', 'quota_limit', 'unlimited_journals', 'active', 'sort_order']) {
              if (JSON.stringify(op[f] ?? null) !== JSON.stringify(np[f] ?? null)) changes.push({ field: `${np.key}.${f}`, from: op[f] ?? null, to: np[f] ?? null })
            }
            if (JSON.stringify(op.features || []) !== JSON.stringify(np.features || [])) changes.push({ field: `${np.key}.features`, from: `${(op.features || []).length} ميزة`, to: `${(np.features || []).length} ميزة` })
          }
        }
        if (changes.length) {
          await db.collection('platform_settings').updateOne(
            { id: 'pricing_config_history' },
            { $push: { entries: { $each: [{ at: new Date(), by: sess.user.email, changes }], $slice: -100 } } },
            { upsert: true }
          )
        }
        return ok({ success: true, config: merged, changes_logged: changes.length })
      }

      // v4.2 — COMMISSION RULES became OPERATIONAL: stored in the EXISTING
      // platform_settings collection (doc id 'commission_rules') — configuration,
      // NOT financial records. The financial commissions LEDGER (accruals/payments)
      // requires a NEW collection → pending explicit user approval (documented).
      if (route === '/admin/commission-rules' && method === 'GET') {
        const doc = await db.collection('platform_settings').findOne({ id: 'commission_rules' })
        return ok({ rules: doc?.rules || [], updated_at: doc?.updated_at || null, updated_by: doc?.updated_by || null })
      }
      if (route === '/admin/commission-rules' && method === 'PUT') {
        const b = await request.json()
        if (!b.reason || !String(b.reason).trim()) return bad('السبب إلزامي لأي تغيير في قواعد العمولات')
        const prevDoc = await db.collection('platform_settings').findOne({ id: 'commission_rules' })
        const prevRules = prevDoc?.rules || []
        const rules = (Array.isArray(b.rules) ? b.rules : []).slice(0, 50).map(r => ({
          id: r.id || uuidv4(),
          name: String(r.name || '').slice(0, 120),
          type: r.type === 'fixed' ? 'fixed' : 'percent',
          value: Math.max(0, Number(r.value) || 0),
          applies_to: ['silver', 'gold', 'enterprise', 'all'].includes(r.applies_to) ? r.applies_to : 'all',
          beneficiary_type: ['marketer', 'referrer_office', 'employee'].includes(r.beneficiary_type) ? r.beneficiary_type : 'marketer',
          beneficiary_name: String(r.beneficiary_name || '').slice(0, 120),
          start_at: r.start_at ? new Date(r.start_at) : null,
          end_at: r.end_at ? new Date(r.end_at) : null,
          priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0,
          active: r.active !== false,
          created_at: r.created_at ? new Date(r.created_at) : new Date(),
        }))
        for (const r of rules) {
          if (!r.name.trim()) return bad('اسم القاعدة إلزامي')
          if (r.type === 'percent' && r.value > 100) return bad(`نسبة العمولة في «${r.name}» لا تتجاوز 100%`)
        }
        // منع تداخل قاعدتين نشطتين على الباقة/المستفيد نفسه ضمن نافذة زمنية متقاطعة
        const overlaps = (a, c) => {
          const aS = a.start_at ? a.start_at.getTime() : -Infinity, aE = a.end_at ? a.end_at.getTime() : Infinity
          const cS = c.start_at ? c.start_at.getTime() : -Infinity, cE = c.end_at ? c.end_at.getTime() : Infinity
          return aS <= cE && cS <= aE
        }
        const act = rules.filter(r => r.active)
        for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
          const a = act[i], c = act[j]
          const samePlan = a.applies_to === c.applies_to || a.applies_to === 'all' || c.applies_to === 'all'
          const sameBenef = a.beneficiary_type === c.beneficiary_type && (a.beneficiary_name || '') === (c.beneficiary_name || '')
          if (samePlan && sameBenef && overlaps(a, c)) return bad(`⚠️ تعارض قواعد: «${a.name}» و«${c.name}» نشطتان على النطاق نفسه والمستفيد نفسه في فترة متقاطعة — عطّل إحداهما أو عدّل التواريخ`, 409)
        }
        await db.collection('platform_settings').updateOne({ id: 'commission_rules' }, { $set: { id: 'commission_rules', rules, updated_at: new Date(), updated_by: sess.user.email } }, { upsert: true })
        try {
          await db.collection('audit_logs').insertOne({
            id: uuidv4(), category: 'commissions', at: new Date(), actor_id: sess.user.id, actor_email: sess.user.email,
            action: 'commission_rules_update', target: { doc: 'commission_rules' },
            before: { count: prevRules.length, rules: prevRules.map(r => ({ id: r.id, name: r.name, type: r.type, value: r.value, active: r.active })) },
            after: { count: rules.length, rules: rules.map(r => ({ id: r.id, name: r.name, type: r.type, value: r.value, active: r.active })) },
            reason: String(b.reason).slice(0, 300),
          })
        } catch { }
        return ok({ success: true, rules })
      }

      // v3.12 — Password reset requests inbox (admin-mediated forgot password)
      if (route === '/admin/password-reset-requests' && method === 'GET') {
        const reqs = await db.collection('password_reset_requests').find({}).sort({ created_at: -1 }).limit(200).toArray()
        return ok(clean(reqs))
      }
      {
        const m = route.match(/^\/admin\/password-reset-requests\/([^/]+)$/)
        if (m && method === 'PATCH') {
          const b = await request.json()
          const reqDoc = await db.collection('password_reset_requests').findOne({ id: m[1] })
          if (!reqDoc) return bad('الطلب غير موجود', 404)
          if (reqDoc.status !== 'pending') return bad('هذا الطلب تمت معالجته مسبقاً')
          if (b.action === 'reset') {
            if (!b.new_password || String(b.new_password).length < 6) return bad('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف')
            await db.collection('users').updateOne(
              { id: reqDoc.user_id },
              { $set: { password_hash: bcrypt.hashSync(String(b.new_password), 8), updated_at: new Date() } }
            )
            // Security: invalidate that user's active sessions so only the new password works
            await db.collection('sessions').deleteMany({ user_id: reqDoc.user_id })
            await db.collection('password_reset_requests').updateOne(
              { id: m[1] },
              { $set: { status: 'done', resolved_at: new Date(), resolved_by: sess.user.email } }
            )
            return ok({ success: true, message: 'تم تعيين كلمة المرور الجديدة — بلّغ المستخدم بها' })
          }
          if (b.action === 'reject') {
            await db.collection('password_reset_requests').updateOne(
              { id: m[1] },
              { $set: { status: 'rejected', resolved_at: new Date(), resolved_by: sess.user.email } }
            )
            return ok({ success: true })
          }
          return bad('إجراء غير معروف')
        }
      }

      if (route === '/admin/tenants' && method === 'GET') {
        const tenants = await db.collection('tenants').find({}).sort({ created_at: -1 }).toArray()
        // Include user counts
        const users = await db.collection('users').find({ role: { $ne: 'super_admin' } }).toArray()
        const usersByTenant = {}
        for (const u of users) usersByTenant[u.tenant_id] = (usersByTenant[u.tenant_id] || 0) + 1
        // v3.91 — Phase 2: attach owner info from the SAME users query (zero extra queries)
        const ownersByTenant = {}
        for (const u of users) if (u.role === 'owner' && u.tenant_id && !ownersByTenant[u.tenant_id]) ownersByTenant[u.tenant_id] = { name: u.name || null, email: u.email || null, phone: u.phone || u.whatsapp || null }
        const [tCount, vCount] = await Promise.all([
          db.collection('tickets').countDocuments(),
          db.collection('visas').countDocuments(),
        ])
        return ok({
          tenants: tenants.map(t => ({ ...t, _id: undefined, users_count: usersByTenant[t.id] || 0, owner: ownersByTenant[t.id] || null })),
          global_stats: { tenants: tenants.length, tickets: tCount, visas: vCount },
        })
      }

      if (route === '/admin/tenants' && method === 'POST') {
        const b = await request.json()
        // v3.98 — Phase 1 (minimal change requested by management): optional LINK
        // mode — instead of forcing a NEW owner user, an existing MAIN super_admin
        // account can be bound to the newly created tenant (the Rahaal company
        // book). No duplicate owner is created; the account keeps role=super_admin.
        const linkMode = !!b.link_owner_user_id
        if (!b.name || (!linkMode && (!b.owner_email || !b.owner_password))) return bad('الاسم وبيانات المالك مطلوبة')
        let linkUser = null
        if (linkMode) {
          linkUser = await db.collection('users').findOne({ id: b.link_owner_user_id })
          if (!linkUser) return bad('المستخدم المطلوب ربطه غير موجود', 404)
          if (linkUser.role !== 'super_admin') return bad('الربط متاح لحساب المشرف العام الرئيسي فقط')
          if (linkUser.tenant_id) return bad('حساب المشرف مرتبط بمكتب مسبقاً')
        }
        const slug = (b.slug || b.name).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40) + '-' + uuidv4().slice(0, 4)
        const existingUser = linkMode ? null : await db.collection('users').findOne({ email: String(b.owner_email).toLowerCase().trim() })
        if (existingUser) return bad('البريد الإلكتروني مستخدم بالفعل')
        // Resolve referrer if code provided
        let referredBy = null
        if (b.referral_code) {
          const ref = await db.collection('tenants').findOne({ referral_code: String(b.referral_code).toUpperCase().trim() })
          if (!ref) return bad('رمز الإحالة غير صحيح')
          referredBy = ref.id
        }
        const myCode = genReferralCode()
        const tenant = {
          id: uuidv4(), slug, name: b.name, status: 'active',
          max_users: Number(b.max_users) || 2, max_branches: Number(b.max_branches) || 1,
          subscription: b.subscription || 'trial',
          plan_tier: b.plan_tier || 'standard',
          journal_quota: { used: 0, limit: Number(b.quota_limit) || 30, top_ups: [] },
          referral_code: myCode,
          referred_by: referredBy,
          referral_stats: { signups: 0, activations: 0, bonus_earned: 0 },
          activation_confirmed: false,
          subscription_expires_at: b.subscription_expires_at ? new Date(b.subscription_expires_at) : null,
          subscription_price: Number(b.subscription_price) || 0,
          created_at: new Date(),
        }
        await db.collection('tenants').insertOne(tenant)
        // Reward referrer with +50 free entries on signup (v2.8 simplified)
        if (referredBy) {
          await db.collection('tenants').updateOne(
            { id: referredBy },
            {
              $inc: { 'journal_quota.limit': 50, 'referral_stats.signups': 1, 'referral_stats.bonus_earned': 50 },
              $push: { 'journal_quota.top_ups': { amount: 50, date: new Date(), by: 'referral_signup', referred_tenant: tenant.id } }
            }
          )
        }
        if (linkMode) {
          // Bind the existing main SA account to the company book: same account,
          // same role (super_admin), tenant scope = the platform org. Travel-only
          // modules are hidden via the EXISTING permission flags machinery
          // (canModule reads permissions.mod_* !== false). Financial modules stay.
          await db.collection('tenants').updateOne({ id: tenant.id }, { $set: { is_platform_org: true } })
          await db.collection('users').updateOne({ id: linkUser.id }, {
            $set: {
              tenant_id: tenant.id, platform_org: true,
              permissions: {
                ...(linkUser.permissions || {}),
                mod_tickets: false, mod_visas: false, mod_visa_monitor: false,
                mod_services: false, mod_packages: false, mod_meraaj: false, mod_query: false,
              },
              updated_at: new Date(),
            },
          })
        } else {
          await db.collection('users').insertOne({
            id: uuidv4(), tenant_id: tenant.id, email: String(b.owner_email).toLowerCase().trim(),
            name: b.owner_name || 'مالك المكتب', role: 'owner', active: true,
            password_hash: bcrypt.hashSync(b.owner_password, 8),
            created_at: new Date(),
          })
        }
        await seedTenantDefaults(db, tenant.id)
        return ok({ ...tenant, _id: undefined, linked_user: linkMode ? linkUser.email : null })
      }

      // Confirm payment activation (grants +50 to referrer)
      const confirmMatch = route.match(/^\/admin\/tenants\/([^/]+)\/confirm-payment$/)
      if (confirmMatch && method === 'POST') {
        const tid = confirmMatch[1]
        const t = await db.collection('tenants').findOne({ id: tid })
        if (!t) return bad('المكتب غير موجود', 404)
        // v4.0.1 — idempotent: confirm-payment can never run twice for the same office/subscription
        if (t.activation_confirmed) return bad('تم تأكيد الدفع لهذا المكتب من قبل — لا يمكن تنفيذ العملية مرتين', 409)
        const confirmSet = { activation_confirmed: true, activation_confirmed_at: new Date(), subscription: 'paid' }
        // v4.0.1 — the plan's unlimited-journals privilege is granted HERE (post-payment), never before
        try {
          const cfgCP = await getPricingConfig(db)
          const planCP = (cfgCP.plans || []).find(x => x.key === t.plan_tier)
          if (planCP?.unlimited_journals === true) confirmSet.unlimited_journals = true
        } catch { }
        await db.collection('tenants').updateOne({ id: tid }, { $set: confirmSet })
        let referrerBonus = null
        if (t.referred_by) {
          // v3.9 — grant referrer +50 quota ONLY when the referred tenant confirms actual payment
          await db.collection('tenants').updateOne(
            { id: t.referred_by },
            {
              $inc: { 'journal_quota.limit': 50, 'referral_stats.activations': 1, 'referral_stats.bonus_earned': 50 },
              $push: { 'journal_quota.top_ups': { amount: 50, date: new Date(), by: 'referral_activation', referred_tenant: tid } }
            }
          )
          // Also mark the pending_referrals entry as paid
          await db.collection('tenants').updateOne(
            { id: t.referred_by, 'referral_stats.pending_referrals.referred_tenant': tid },
            { $set: { 'referral_stats.pending_referrals.$.paid': true, 'referral_stats.pending_referrals.$.paid_at': new Date() } }
          )
          const ref = await db.collection('tenants').findOne({ id: t.referred_by })
          referrerBonus = { referrer_id: ref.id, referrer_name: ref.name, bonus_added: 50 }
        }
        return ok({ success: true, referrer_bonus: referrerBonus })
      }

      const tenantIdMatch = route.match(/^\/admin\/tenants\/([^/]+)$/)
      if (tenantIdMatch) {
        const tid = tenantIdMatch[1]
        if (method === 'PATCH') {
          const b = await request.json()
          // v4.9 — CRUD Tenants: fine-grained enforcement (admin_staff needs offices.edit)
          const canT = await adminCan(db, sess)
          if (!canT.has('offices', 'edit')) return bad('غير مصرح — تعديل المكاتب يتطلب صلاحية Edit', 403)
          // v4.0 — «زيادة حصة القيود» has exactly ONE path: POST /admin/tenants/:id/topup.
          // The old dual PATCH top_up_amount path is retired to prevent double-logging.
          if (b.top_up_amount !== undefined) return bad('زيادة حصة القيود لها مسار مخصص واحد — استخدم زر «زيادة حصة القيود»')
          const tCur = await db.collection('tenants').findOne({ id: tid })
          if (!tCur) return bad('المكتب غير موجود', 404)
          const upd = {}
          if (b.status) upd.status = b.status
          if (b.name) upd.name = b.name
          if (b.max_users !== undefined) upd.max_users = b.max_users === null ? null : Number(b.max_users)
          if (b.max_branches !== undefined) upd.max_branches = b.max_branches === null ? null : Number(b.max_branches)
          if (b.quota_limit !== undefined) upd['journal_quota.limit'] = Number(b.quota_limit)
          if (b.plan_tier !== undefined) upd.plan_tier = b.plan_tier
          // v3.14 → v4.0.1 — Assign plan: auto-apply user/branch limits + plan quota.
          // Plan assignment NEVER converts to Paid and NEVER opens journals by itself:
          // the plan's unlimited_journals privilege is granted only at confirm-payment.
          if (b.plan_key !== undefined && ['silver', 'gold', 'enterprise'].includes(b.plan_key)) {
            upd.plan_tier = b.plan_key
            const cfg = await getPricingConfig(db)
            const p = (cfg.plans || []).find(x => x.key === b.plan_key)
            if (p) {
              upd.max_users = Number(p.max_users) === 0 ? 9999 : Number(p.max_users)
              upd.max_branches = Number(p.max_branches) === 0 ? 9999 : Number(p.max_branches)
              if (Number(p.quota_limit) > 0) upd['journal_quota.limit'] = Number(p.quota_limit) // v4.0
            }
          }
          // v4.0 — LOWERING GUARD (server-enforced): never silently drop below the office's
          // CURRENT user count. Nothing is auto-deleted — the admin must resolve the excess
          // first (deactivate/delete users) and then retry the reduction.
          if (upd.max_users !== undefined && upd.max_users !== null && Number(upd.max_users) > 0) {
            const usersCount = await db.collection('users').countDocuments({ tenant_id: tid })
            if (Number(upd.max_users) < usersCount) {
              return bad(`⚠️ لا يمكن خفض حد المستخدمين إلى ${upd.max_users} — المكتب لديه ${usersCount} مستخدماً حالياً. عالج التجاوز أولاً (عطّل أو احذف مستخدمين) ثم أعد المحاولة`, 409)
            }
          }
          // v4.0 — quota lowering guard: block reducing the journal quota below what is already used
          if (upd['journal_quota.limit'] !== undefined) {
            const usedNowQ = tCur.journal_quota?.used || 0
            if (Number(upd['journal_quota.limit']) < usedNowQ) {
              return bad(`⚠️ لا يمكن خفض حصة القيود إلى ${upd['journal_quota.limit']} — المكتب استخدم ${usedNowQ} قيداً بالفعل`, 409)
            }
          }
          // NOTE: max_branches is stored/applied but has no operational entity to count yet
          // (no branches collection exists) — documented gap, enforcement activates with the entity.
          // v4.0.1 CLOSURE — billing_mode is a PAYMENT-METHOD choice ONLY.
          // OLD (v3.14): choosing 'annual' set unlimited_journals=true immediately (pre-payment!).
          // NEW: no auto-open — journals open exclusively via confirm-payment or manual toggle.
          if (b.billing_mode !== undefined && ['annual', 'installments', null].includes(b.billing_mode)) {
            upd.billing_mode = b.billing_mode
          }
          // v3.14 — Manual unlimited-journals toggle (e.g. after final installment is paid)
          if (b.unlimited_journals !== undefined) upd.unlimited_journals = !!b.unlimited_journals
          if (b.subscription !== undefined) upd.subscription = b.subscription
          if (b.subscription_price !== undefined) upd.subscription_price = Number(b.subscription_price) || 0
          if (b.subscription_expires_at !== undefined) upd.subscription_expires_at = b.subscription_expires_at ? new Date(b.subscription_expires_at) : null
          await db.collection('tenants').updateOne({ id: tid }, { $set: upd })
          return ok({ success: true })
        }
        if (method === 'DELETE') {
          // v4.9 — CRUD Tenants: the legacy hard cascade delete is BLOCKED. A safe delete
          // (soft-delete/archive) requires an explicit design decision. No data is removed.
          return bad('⛔ الحذف الصلب للمكتب غير متاح — يتطلب قرار تصميم (حذف ناعم / أرشيف). استخدم التعليق (Suspend) بدلاً منه. لم تُحذف أي بيانات.', 403)
        }
      }

      // v2.8 — Suspend / Activate tenant
      const toggleMatch = route.match(/^\/admin\/tenants\/([^/]+)\/toggle-status$/)
      if (toggleMatch && method === 'POST') {
        const tid = toggleMatch[1]
        // v4.9 — CRUD Tenants: fine-grained enforcement (admin_staff needs offices.manage)
        const canTg = await adminCan(db, sess)
        if (!canTg.has('offices', 'manage')) return bad('غير مصرح — تعليق/تفعيل المكتب يتطلب صلاحية Manage', 403)
        const t = await db.collection('tenants').findOne({ id: tid })
        if (!t) return bad('المكتب غير موجود', 404)
        const newStatus = t.status === 'suspended' ? 'active' : 'suspended'
        await db.collection('tenants').updateOne({ id: tid }, { $set: { status: newStatus, status_changed_at: new Date() } })
        return ok({ success: true, status: newStatus })
      }

      // v3.9.17 → v4.0 — «زيادة حصة القيود» (THE single approved path — the old
      // PATCH top_up_amount dual path is retired). Unified logging into
      // journal_quota.top_ups (the original ledger): amount + reason + actor + date.
      // wallet.topups dual-write removed. It adds JOURNAL QUOTA — not money.
      const topupMatch = route.match(/^\/admin\/tenants\/([^/]+)\/topup$/)
      if (topupMatch && method === 'POST') {
        const tid = topupMatch[1]
        const t = await db.collection('tenants').findOne({ id: tid })
        if (!t) return bad('المكتب غير موجود', 404)
        const b = await request.json()
        const amount = parseInt(b.amount)
        if (!amount || amount <= 0 || amount > 1000000) return bad('المقدار يجب أن يكون بين 1 و 1,000,000 قيد')
        const note = String(b.note || '').slice(0, 200)
        if (!note.trim()) return bad('سبب الزيادة مطلوب')
        // v4.0.1 — idempotency: the UI sends a unique op_id per dialog session; resending
        // the same request never creates a second increase.
        const opId = String(b.op_id || '').slice(0, 64)
        const q = t.journal_quota || { used: 0, limit: 500, top_ups: [] }
        if (opId) {
          const dup = (q.top_ups || []).find(x => x.op_id === opId)
          if (dup) return ok({ success: true, duplicate: true, tenant_id: tid, added: dup.amount, note: dup.note, by: dup.by, at: dup.date, quota: { prev_limit: dup.prev_limit, new_limit: dup.new_limit, used: Number(q.used) || 0, remaining: Math.max(0, (dup.new_limit || 0) - (Number(q.used) || 0)) } })
        }
        const prevLimit = Number(q.limit) || 0
        const newLimit = prevLimit + amount
        // v4.0.1 — the ledger entry records: old limit, new limit, amount, actor, reason, date
        const entry = { op_id: opId || null, amount, note, prev_limit: prevLimit, new_limit: newLimit, date: new Date(), by: sess.user.email }
        await db.collection('tenants').updateOne({ id: tid }, {
          $set: { 'journal_quota.limit': newLimit, 'journal_quota.last_topup_at': entry.date },
          $push: { 'journal_quota.top_ups': entry },
        })
        return ok({
          success: true, tenant_id: tid,
          added: amount, note, by: sess.user.email, at: entry.date,
          quota: { prev_limit: prevLimit, new_limit: newLimit, used: Number(q.used) || 0, remaining: Math.max(0, newLimit - (Number(q.used) || 0)) },
        })
      }

      // v3.9.17 — Reset password for the tenant's owner (Admin/Super Admin only)
      const resetPwdMatch = route.match(/^\/admin\/tenants\/([^/]+)\/reset-password$/)
      if (resetPwdMatch && method === 'POST') {
        const tid = resetPwdMatch[1]
        const t = await db.collection('tenants').findOne({ id: tid })
        if (!t) return bad('المكتب غير موجود', 404)
        const owner = await db.collection('users').findOne({ tenant_id: tid, role: 'owner' })
        if (!owner) return bad('لا يوجد مالك لهذا المكتب', 404)
        const b = await request.json().catch(() => ({}))
        // Accept a provided password OR auto-generate a strong 10-char password
        let newPassword = String(b.new_password || '').trim()
        if (!newPassword) {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
          newPassword = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
        }
        if (newPassword.length < 6) return bad('كلمة السر يجب أن تكون 6 أحرف على الأقل')
        await db.collection('users').updateOne({ id: owner.id }, {
          $set: { password_hash: bcrypt.hashSync(newPassword, 8), password_reset_at: new Date(), password_reset_by: sess.user.email },
        })
        // Invalidate all existing sessions for this owner (force re-login)
        await db.collection('sessions').deleteMany({ user_id: owner.id })
        return ok({ success: true, tenant_id: tid, owner_email: owner.email, new_password: newPassword, note: 'تم إبطال جميع الجلسات السابقة — على المالك تسجيل الدخول مجدداً' })
      }

      // v2.8 — Impersonate: super admin logs in as tenant (30-min session)
      const imperMatch = route.match(/^\/admin\/tenants\/([^/]+)\/impersonate$/)
      if (imperMatch && method === 'POST') {
        const tid = imperMatch[1]
        const t = await db.collection('tenants').findOne({ id: tid })
        if (!t) return bad('المكتب غير موجود', 404)
        // Find the tenant's owner
        const owner = await db.collection('users').findOne({ tenant_id: tid, role: 'owner', active: true })
        if (!owner) return bad('لا يوجد مالك نشط لهذا المكتب', 404)
        // Create a short-lived impersonation session
        const sid = uuidv4()
        const expires = new Date(Date.now() + 30 * 60000) // 30 minutes
        await db.collection('sessions').insertOne({
          id: sid, user_id: owner.id,
          impersonation: true,
          impersonated_by_id: sess.user.id,
          impersonated_by_email: sess.user.email,
          expires_at: expires, created_at: new Date(),
        })
        return ok({ session_id: sid, expires_at: expires, tenant: sanitizeTenant(t), user: sanitizeUser(owner) })
      }

      // v2.8 — Subscription plan config (voucher pack + gold monthly + gold annual)
      if (route === '/admin/plans' && method === 'GET') {
        const plans = await db.collection('subscription_plans').find({}).toArray()
        return ok(plans.map(p => ({ ...p, _id: undefined })))
      }
      if (route === '/admin/plans' && method === 'PUT') {
        const b = await request.json()
        if (!b.id) return bad('id مطلوب')
        await db.collection('subscription_plans').updateOne({ id: b.id }, { $set: { ...b, updated_at: new Date() } }, { upsert: true })
        return ok({ success: true })
      }

      // v2.8 → v3.94 — Announcements: extended (types/targeting/schedule/status/audit)
      // in lib/adminAds.js — SAME collection & API paths, backward compatible with the
      // legacy AnnouncementsManager (its {active} toggles map to active/paused).
      if (route === '/admin/announcements' || route.startsWith('/admin/announcements/')) {
        let bodyA = null
        if (method !== 'GET') { try { bodyA = await request.json() } catch { bodyA = {} } }
        const rA = await adminAdsHandler(db, route.slice('/admin/announcements'.length), method, new URL(request.url).searchParams, bodyA, sess)
        if (rA?.error) return bad(rA.error, rA.status || 400)
        return ok(Array.isArray(rA?.rows) && method === 'GET' && route === '/admin/announcements' && !new URL(request.url).searchParams.get('extended') ? rA.rows : rA) // legacy manager expects a plain array
      }

      // v4.4 — office-verifications review handlers live later in the file (legacy
      // placement, dead since the v3.97 realm block 404'd first). Let them fall through.
      if (!route.startsWith('/admin/office-verifications')) return bad(`Admin route ${route} not found`, 404)
    }

    // ============ TENANT-SCOPED ============
    if (!sess.tenant) return bad('لا يوجد مكتب مرتبط بحسابك', 403)
    const T = sess.tenant.id
    const tf = { tenant_id: T }

    // Tenant Settings
    if (route === '/tenant/settings' && method === 'GET') {
      const s = await db.collection('tenant_settings').findOne(tf)
      return ok(s ? { ...s, _id: undefined } : {})
    }
    if (route === '/tenant/settings' && method === 'PUT') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح', 403)
      const b = await request.json()
      const allowed = ['agency_name', 'logo_base64', 'header', 'footer', 'tax_id', 'commercial_id', 'phone', 'address', 'email', 'primary_color', 'rates', 'pair_usd_sar']
      const upd = { updated_at: new Date() }
      for (const k of allowed) if (b[k] !== undefined) upd[k] = b[k]
      await db.collection('tenant_settings').updateOne(tf, { $set: upd }, { upsert: true })
      return ok({ success: true })
    }


    // v3.50 — BATCH RE-SYNC: recompute market pricing fresh from current room_pricing and
    // re-emit package.updated for ALL shared packages (owner only). Fixes stale/zero prices at once.
    if (route === '/meraaj/resync-all' && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const sharedPkgs = await db.collection('packages').find({ tenant_id: T, 'meraaj.shared': true, archived: { $ne: true } }).toArray()
      let synced = 0, failed = 0
      for (const pkg of sharedPkgs) {
        try {
          const m = pkg.meraaj || {}
          const fresh = computeMeraajMarketPricing(pkg.room_pricing || [], m.buyer_commission_mode || 'amount', Number(m.buyer_commission_value) || 0, m.commission_direction || 'deducted', m.buyer_commission_child_value ?? null, m.buyer_commission_infant_value ?? null)
          if (fresh.length > 0) {
            await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { 'meraaj.market_pricing': fresh, 'meraaj.market_pricing_updated_at': new Date() } })
          }
          await maybeEmitMeraajPackageUpdate(db, T, pkg.id)
          synced++
        } catch { failed++ }
      }
      return ok({ total: sharedPkgs.length, synced, failed })
    }

    // ============ v3.24 — MERAAJ NETWORK: tenant-authenticated endpoints ============
    // SSO token: signed payload the Meraaj store verifies with the shared secret (5-minute expiry)
    if (route === '/meraaj/sso-token' && method === 'POST') {
      if (!meraajSecret()) return bad('التكامل مع معراج غير مُهيأ (MERAAJ_SHARED_SECRET مفقود)', 503)
      const now = Math.floor(Date.now() / 1000)
      const settings = await db.collection('tenant_settings').findOne(tf)
      // v3.76 — enriched identity: linked Meraaj office id + Meraaj-scoped permissions (office scope only)
      const Ptok = sess.user.role === 'owner' ? null : effectivePermissions(sess.user)
      const tokenScope = sess.user.role === 'owner'
        ? { manage_packages: true, manage_bookings: true, approve_reject: true, can_refund: true, manage_settings: true }
        : { manage_packages: !!Ptok.mod_meraaj, manage_bookings: !!Ptok.mod_meraaj, approve_reject: !!Ptok.mod_meraaj, can_refund: !!Ptok.can_refund, manage_settings: false }
      const payload = {
        iss: 'rahaal-erp', aud: 'meraaj-network',
        tenant_id: T,
        office_name: settings?.agency_name || sess.tenant.name || '',
        meraaj_office_id: settings?.meraaj_office_id || null, // v3.76 — account linking
        email: sess.user.email, role: sess.user.role,
        permissions: tokenScope, // v3.76 — office-scoped Meraaj permissions
        iat: now, exp: now + 300,
      }
      const body64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const token = `${body64}.${meraajSign(body64)}`
      return ok({ token, expires_in: 300 })
    }
    // v3.76 — ACCOUNT LINKING: create/link this office's Meraaj account (owner or mod_meraaj staff).
    // Calls Meraaj REST {base}/api/integrations/rahal/offices/link (HMAC-signed) and stores meraaj_office_id.
    if (route === '/meraaj/account-link' && method === 'POST') {
      const stLink = await db.collection('tenant_settings').findOne(tf)
      if (stLink?.meraaj_office_id) {
        return ok({ linked: true, already: true, meraaj_office_id: stLink.meraaj_office_id, linked_at: stLink.meraaj_linked_at || null })
      }
      const link = await meraajLinkOfficeAPI(db, T, {
        office_ref: T,
        office_name: stLink?.agency_name || sess.tenant.name || '',
        owner_email: sess.user.email,
        store_active: !!stLink?.meraaj_store?.active,
        escrow_mode: !!stLink?.meraaj_escrow_mode,
        requested_by: sess.user.email,
        requested_at: new Date().toISOString(),
      })
      if (!link.ok) {
        await db.collection('tenant_settings').updateOne(tf, { $set: { meraaj_link_status: 'failed', meraaj_link_error: link.error, meraaj_link_attempted_at: new Date() } }, { upsert: true })
        return bad(`فشل ربط الحساب — لم يقبل معراج الطلب: ${link.error}`, 502)
      }
      await db.collection('tenant_settings').updateOne(tf, {
        $set: { meraaj_office_id: link.office_id, meraaj_link_status: 'linked', meraaj_linked_at: new Date(), meraaj_link_error: null },
      }, { upsert: true })
      return ok({ linked: true, meraaj_office_id: link.office_id })
    }
    // ============ v3.77 — OFFICE VERIFICATION (توثيق المكتب) ============
    // Verification happens AFTER account creation (signup stays simple). States:
    // unverified → pending_review (auto on first upload) → verified | rejected (reason + re-upload allowed).
    if (route === '/office/verification' && method === 'GET') {
      const stV = await db.collection('tenant_settings').findOne(tf)
      const ver = stV?.office_verification || { status: 'unverified' }
      const docsV = await db.collection('office_documents').find({ tenant_id: T }).sort({ uploaded_at: -1 }).toArray()
      return ok({
        status: ver.status || 'unverified',
        submitted_at: ver.submitted_at || null, reviewed_at: ver.reviewed_at || null,
        reject_reason: ver.reject_reason || null,
        documents: docsV.map(d => ({ id: d.id, doc_type: d.doc_type, label: d.label, filename: d.filename, content_type: d.content_type, size: d.size, uploaded_at: d.uploaded_at, uploaded_by: d.uploaded_by })),
        storage_driver: docStorageDriver(),
      })
    }
    if (route === '/office/verification/documents' && method === 'POST') {
      if (sess.user.role !== 'owner') return bad('غير مصرح — رفع مستندات التوثيق للمالك فقط', 403)
      const bOD = await request.json()
      const docTypeOD = ['license', 'owner_id', 'other'].includes(bOD.doc_type) ? bOD.doc_type : 'other'
      const up = parseDocUpload(bOD, T, 'office-docs')
      if (up.error) return bad(up.error)
      const countOD = await db.collection('office_documents').countDocuments({ tenant_id: T })
      if (countOD >= 20) return bad('الحد الأقصى 20 مستند توثيق للمكتب')
      await docStoragePut(db, T, up.objectKey, up.base64, up.contentType, up.size)
      const docOD = {
        id: uuidv4(), tenant_id: T, doc_type: docTypeOD,
        label: String(bOD.label || '').slice(0, 120), filename: up.filename,
        content_type: up.contentType, size: up.size,
        storage: { driver: docStorageDriver() === 's3' ? 's3' : 'db', object_key: up.objectKey },
        uploaded_by: sess.user.email, uploaded_at: new Date(),
      }
      await db.collection('office_documents').insertOne(docOD)
      await docAuditLog(db, T, 'uploaded', docOD.id, sess.user.email, { context: 'office_verification', doc_type: docTypeOD, size: up.size })
      // Any upload while unverified/rejected (re-)submits for review — never blocks account usage
      const stOD = await db.collection('tenant_settings').findOne(tf)
      const curStatus = stOD?.office_verification?.status || 'unverified'
      let newStatus = curStatus
      if (curStatus === 'unverified' || curStatus === 'rejected') {
        newStatus = 'pending_review'
        await db.collection('tenant_settings').updateOne(tf, { $set: { 'office_verification.status': 'pending_review', 'office_verification.submitted_at': new Date(), 'office_verification.reject_reason': null } }, { upsert: true })
        await docAuditLog(db, T, 'status_changed', null, sess.user.email, { from: curStatus, to: 'pending_review' })
        // Rahaal is the identity source — Meraaj receives the status + reference (never the raw file duplicated)
        // v3.77.1 — canonical contract fields + legacy aliases kept for backward compatibility
        emitMeraajEvent(db, T, 'office.verification_updated', {
          verification_status: 'pending_review', verification_reason: null,
          rahal_office_ref: T, verified_at: null, updated_at: new Date().toISOString(),
          office_ref: T, status: 'pending_review', // legacy aliases
          office_name: stOD?.agency_name || sess.tenant?.name || '',
          documents_count: countOD + 1, submitted_at: new Date().toISOString(),
        }).catch(() => {})
      }
      return ok({ uploaded: true, document: { id: docOD.id, doc_type: docOD.doc_type, filename: docOD.filename, size: docOD.size }, verification_status: newStatus })
    }
    const officeDocDlMatch = route.match(/^\/office\/verification\/documents\/([^/]+)\/download$/)
    if (officeDocDlMatch && method === 'GET') {
      const docDL = await db.collection('office_documents').findOne(isMainSA(sess.user) ? { id: officeDocDlMatch[1] } : { id: officeDocDlMatch[1], tenant_id: T })
      if (!docDL) return bad('المستند غير موجود', 404)
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح', 403)
      const blobDL = await docStorageGet(db, docDL.storage?.object_key)
      if (!blobDL) return bad('ملف المستند غير متاح في التخزين', 404)
      await docAuditLog(db, docDL.tenant_id, 'viewed', docDL.id, sess.user.email, { context: 'office_verification' })
      return new Response(blobDL.buffer, { status: 200, headers: { 'Content-Type': blobDL.content_type, 'Content-Disposition': `inline; filename="${encodeURIComponent(docDL.filename || 'document')}"`, 'Cache-Control': 'private, no-store' } })
    }
    const officeDocDelMatch = route.match(/^\/office\/verification\/documents\/([^/]+)$/)
    if (officeDocDelMatch && method === 'DELETE') {
      if (sess.user.role !== 'owner') return bad('غير مصرح — حذف مستندات التوثيق للمالك فقط', 403)
      const stDel = await db.collection('tenant_settings').findOne(tf)
      if ((stDel?.office_verification?.status || 'unverified') === 'verified') return bad('المكتب موثق — لا يمكن حذف مستندات التوثيق المعتمدة', 409)
      const docDel = await db.collection('office_documents').findOne({ id: officeDocDelMatch[1], tenant_id: T })
      if (!docDel) return bad('المستند غير موجود', 404)
      if (docDel.storage?.object_key) await docStorageDelete(db, docDel.storage.object_key)
      await db.collection('office_documents').deleteOne({ id: docDel.id, tenant_id: T })
      await docAuditLog(db, T, 'deleted', docDel.id, sess.user.email, { context: 'office_verification', filename: docDel.filename })
      return ok({ deleted: true })
    }
    // ---- Admin review (super_admin only — API-first: served to the external holding dashboard) ----
    if (route === '/admin/office-verifications' && method === 'GET') {
      // v3.97 — realm-hardened: main SA or rahaal admin staff (offices perm already gated)
      if (!isMainSA(sess.user) && sess.user.role !== 'admin_staff') return bad('غير مصرح', 403)
      const url = new URL(request.url)
      const stFilter = url.searchParams.get('status') || null
      const allSettings = await db.collection('tenant_settings').find({ office_verification: { $exists: true } }).toArray()
      const rows = []
      for (const s of allSettings) {
        const v = s.office_verification || {}
        if (stFilter && v.status !== stFilter) continue
        const docsA = await db.collection('office_documents').find({ tenant_id: s.tenant_id }).toArray()
        rows.push({
          tenant_id: s.tenant_id, office_name: s.agency_name || '', status: v.status || 'unverified',
          submitted_at: v.submitted_at || null, reviewed_at: v.reviewed_at || null, reject_reason: v.reject_reason || null,
          documents: docsA.map(d => ({ id: d.id, doc_type: d.doc_type, label: d.label, filename: d.filename, size: d.size, uploaded_at: d.uploaded_at, download_url: docSignedUrl(d.id, 3600) })),
        })
      }
      return ok({ verifications: rows })
    }
    const adminVerDecideMatch = route.match(/^\/admin\/office-verifications\/([^/]+)\/decision$/)
    if (adminVerDecideMatch && method === 'POST') {
      // v3.97 — realm-hardened: main SA or rahaal admin staff (offices write already gated)
      if (!isMainSA(sess.user) && sess.user.role !== 'admin_staff') return bad('غير مصرح', 403)
      const bAD = await request.json()
      const decisionAD = String(bAD.decision || '')
      if (!['verified', 'rejected'].includes(decisionAD)) return bad('القرار: verified أو rejected فقط')
      const reasonAD = String(bAD.reason || '').slice(0, 400)
      if (decisionAD === 'rejected' && !reasonAD.trim()) return bad('سبب الرفض إلزامي — ليتمكن المكتب من تصحيح مستنداته وإعادة الرفع')
      const tenantIdAD = adminVerDecideMatch[1]
      const stAD = await db.collection('tenant_settings').findOne({ tenant_id: tenantIdAD })
      if (!stAD?.office_verification) return bad('لا يوجد طلب توثيق لهذا المكتب', 404)
      await db.collection('tenant_settings').updateOne({ tenant_id: tenantIdAD }, {
        $set: {
          'office_verification.status': decisionAD,
          'office_verification.reviewed_at': new Date(),
          'office_verification.reviewed_by': sess.user.email,
          'office_verification.reject_reason': decisionAD === 'rejected' ? reasonAD : null,
        },
      })
      await docAuditLog(db, tenantIdAD, 'status_changed', null, sess.user.email, { to: decisionAD, reason: reasonAD || null })
      // Meraaj receives the verification outcome + stable reference (Rahaal = identity source)
      // v3.77.1 — canonical contract fields + legacy aliases kept for backward compatibility
      emitMeraajEvent(db, tenantIdAD, 'office.verification_updated', {
        verification_status: decisionAD,
        verification_reason: decisionAD === 'rejected' ? reasonAD : null,
        rahal_office_ref: tenantIdAD,
        verified_at: decisionAD === 'verified' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
        office_ref: tenantIdAD, status: decisionAD, // legacy aliases
        office_name: stAD?.agency_name || '',
        ...(decisionAD === 'rejected' ? { reject_reason: reasonAD } : {}),
      }).catch(() => {})
      return ok({ decided: true, status: decisionAD })
    }
    // ============ v3.77 — BOOKING DOCUMENTS (مستندات المسافرين + أدلة الإلغاء) ============
    // Tenant-isolated. Staff needs mod_meraaj (module guard). Linked to booking_ref + registrant.
    const bkDocsMatch = route.match(/^\/meraaj\/inbound-bookings\/([^/]+)\/documents$/)
    if (bkDocsMatch && method === 'GET') {
      const inbBD = await db.collection('meraaj_inbound_bookings').findOne({ id: bkDocsMatch[1], tenant_id: T })
      if (!inbBD) return bad('الحجز الوارد غير موجود', 404)
      const docsBD = await db.collection('booking_documents').find({ inbound_id: inbBD.id, tenant_id: T }).sort({ uploaded_at: -1 }).toArray()
      return ok({
        booking_ref: inbBD.meraaj_booking_ref,
        documents: docsBD.map(d => ({
          id: d.id, context: d.context, source: d.source || 'office',
          registrant_index: d.registrant_index ?? null, registrant_name: d.registrant_name || null,
          passport_no: d.passport_no || null,
          doc_type: d.doc_type, evidence_type: d.evidence_type || null, label: d.label,
          filename: d.filename, content_type: d.content_type, size: d.size,
          external_url: d.storage?.driver === 'external_url' ? d.storage.url : null,
          uploaded_by: d.uploaded_by, uploaded_at: d.uploaded_at,
        })),
      })
    }
    if (bkDocsMatch && method === 'POST') {
      const inbBU = await db.collection('meraaj_inbound_bookings').findOne({ id: bkDocsMatch[1], tenant_id: T })
      if (!inbBU) return bad('الحجز الوارد غير موجود', 404)
      const bBU = await request.json()
      const contextBU = bBU.context === 'cancellation_evidence' ? 'cancellation_evidence' : 'traveler'
      let regIdx = null, regName = null, regPass = null
      if (contextBU === 'traveler') {
        regIdx = Number(bBU.registrant_index)
        const regs = Array.isArray(inbBU.registrants) ? inbBU.registrants : []
        if (!Number.isInteger(regIdx) || regIdx < 0 || regIdx >= regs.length) return bad('registrant_index غير صالح — يجب أن يشير لمسافر ضمن هذا الحجز')
        regName = regs[regIdx].name; regPass = regs[regIdx].passport_no || null
      }
      const docTypeBU = contextBU === 'traveler'
        ? (['passport', 'visa', 'ticket', 'photo', 'other'].includes(bBU.doc_type) ? bBU.doc_type : 'other') // v3.85 — + ticket/photo
        : 'other'
      const evidenceTypeBU = contextBU === 'cancellation_evidence'
        ? (['visa', 'ticket', 'hotel', 'receipt', 'other'].includes(bBU.evidence_type) ? bBU.evidence_type : 'other')
        : null
      const countBU = await db.collection('booking_documents').countDocuments({ inbound_id: inbBU.id, tenant_id: T })
      if (countBU >= 60) return bad('الحد الأقصى 60 مستند لكل حجز')
      // v3.85 — booking (integration) documents accept up to 10MB per file: aligns backend with
      // the existing 10MB frontend rule (was 4MB → any 5-10MB passport scan failed server-side).
      // NOTE: 20MB per file on THIS office-upload path needs chunked blob storage (base64 of 20MB
      // exceeds MongoDB's 16MB BSON cap) — Meraaj-hosted 20MB docs are unaffected (external_url).
      const upBU = parseDocUpload(bBU, T, 'booking-docs', 10 * 1024 * 1024)
      if (upBU.error) return bad(upBU.error)
      await docStoragePut(db, T, upBU.objectKey, upBU.base64, upBU.contentType, upBU.size)
      const docBU = {
        id: uuidv4(), tenant_id: T, inbound_id: inbBU.id, booking_ref: inbBU.meraaj_booking_ref,
        context: contextBU, source: 'office',
        registrant_index: regIdx, registrant_name: regName, passport_no: regPass,
        doc_type: docTypeBU, evidence_type: evidenceTypeBU,
        label: String(bBU.label || '').slice(0, 120), filename: upBU.filename,
        content_type: upBU.contentType, size: upBU.size,
        storage: { driver: docStorageDriver() === 's3' ? 's3' : 'db', object_key: upBU.objectKey },
        uploaded_by: sess.user.email, uploaded_at: new Date(),
      }
      await db.collection('booking_documents').insertOne(docBU)
      await docAuditLog(db, T, 'uploaded', docBU.id, sess.user.email, { context: contextBU, booking_ref: inbBU.meraaj_booking_ref, registrant_index: regIdx, size: upBU.size })
      return ok({ uploaded: true, document: { id: docBU.id, context: docBU.context, doc_type: docBU.doc_type, evidence_type: docBU.evidence_type, registrant_index: regIdx, filename: docBU.filename, size: docBU.size } })
    }

    // v3.77 — Same-origin proxy for Meraaj signed traveler documents.
    // Prevents browser CORS failures in preview / print / download.
    // Security: the client-supplied host is NEVER fetched. Only an approved
    // signed Meraaj document pathname/query is forwarded to MERAAJ_API_BASE_URL.
    if (route === '/meraaj/document-proxy' && method === 'GET') {
      try {
        const reqUrl = new URL(request.url)
        const rawUrl = String(reqUrl.searchParams.get('url') || '').trim()
        const requestedName = String(reqUrl.searchParams.get('name') || 'document')
          .replace(/[\r\n"]/g, '')
          .slice(0, 180)
        const forceDownload = reqUrl.searchParams.get('download') === '1'

        if (!rawUrl) return bad('رابط المستند مطلوب', 400)

        let signed
        try {
          signed = new URL(rawUrl)
        } catch {
          return bad('رابط المستند غير صالح', 400)
        }

        // Accept ONLY Meraaj signed document endpoints.
        if (!/^\/api\/documents\/[^/]+\/signed$/.test(signed.pathname)) {
          return bad('مسار المستند غير مسموح', 403)
        }

        if (!signed.searchParams.get('exp') || !signed.searchParams.get('sig')) {
          return bad('توقيع المستند مفقود', 403)
        }

        const meraajBase = String(process.env.MERAAJ_API_BASE_URL || '')
          .trim()
          .replace(/\/+$/, '')

        if (!meraajBase) {
          console.error('[MERAAJ DOC PROXY] MERAAJ_API_BASE_URL missing')
          return bad('خدمة مستندات معراج غير مهيأة', 503)
        }

        const upstreamUrl = `${meraajBase}${signed.pathname}${signed.search}`

        const upstream = await fetch(upstreamUrl, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
        })

        if (!upstream.ok) {
          console.error('[MERAAJ DOC PROXY] upstream failed', upstream.status)
          return bad(`تعذر جلب المستند من معراج (${upstream.status})`, 502)
        }

        const headers = new Headers()
        headers.set(
          'Content-Type',
          upstream.headers.get('content-type') || 'application/octet-stream'
        )
        headers.set('Cache-Control', 'private, no-store, max-age=0')
        headers.set('X-Content-Type-Options', 'nosniff')

        const disposition = forceDownload ? 'attachment' : 'inline'
        headers.set(
          'Content-Disposition',
          `${disposition}; filename*=UTF-8''${encodeURIComponent(requestedName || 'document')}`
        )

        return new NextResponse(upstream.body, {
          status: 200,
          headers,
        })
      } catch (e) {
        console.error('[MERAAJ DOC PROXY]', e)
        return bad('تعذر معالجة المستند', 500)
      }
    }

    const bkDocDlMatch = route.match(/^\/meraaj\/booking-documents\/([^/]+)\/download$/)
    if (bkDocDlMatch && method === 'GET') {
      const docBDL = await db.collection('booking_documents').findOne({ id: bkDocDlMatch[1], tenant_id: T })
      if (!docBDL) return bad('المستند غير موجود', 404)
      if (docBDL.storage?.driver === 'external_url') {
        await docAuditLog(db, T, 'viewed', docBDL.id, sess.user.email, { via: 'redirect_external' })
        return NextResponse.redirect(docBDL.storage.url, 302)
      }
      const blobBDL = await docStorageGet(db, docBDL.storage?.object_key)
      if (!blobBDL) return bad('ملف المستند غير متاح في التخزين', 404)
      await docAuditLog(db, T, 'viewed', docBDL.id, sess.user.email, {})
      return new Response(blobBDL.buffer, { status: 200, headers: { 'Content-Type': blobBDL.content_type, 'Content-Disposition': `inline; filename="${encodeURIComponent(docBDL.filename || 'document')}"`, 'Cache-Control': 'private, no-store' } })
    }
    // v3.81 — DOCUMENT PROXY: same-origin streaming for the professional document viewer.
    // Serves BOTH locally-stored and external (Meraaj signed URL) booking documents through one
    // authenticated tenant-scoped URL, so inline preview + print always work (no cross-origin redirects).
    const docProxyMatch = route.match(/^\/document-proxy\/([^/]+)$/)
    if (docProxyMatch && method === 'GET') {
      const dpDoc = await db.collection('booking_documents').findOne({ id: docProxyMatch[1], tenant_id: T })
      if (!dpDoc) return bad('المستند غير موجود', 404)
      if (dpDoc.storage?.driver === 'external_url') {
        try {
          const dpCtrl = new AbortController()
          const dpTimer = setTimeout(() => dpCtrl.abort(), 15000)
          const dpResp = await fetch(dpDoc.storage.url, { signal: dpCtrl.signal })
          clearTimeout(dpTimer)
          if (!dpResp.ok) return bad(`تعذر جلب المستند من المصدر (${dpResp.status})`, 502)
          const dpBuf = Buffer.from(await dpResp.arrayBuffer())
          if (dpBuf.length > 20 * 1024 * 1024) return bad('حجم المستند يتجاوز الحد المسموح للمعاينة', 413)
          await docAuditLog(db, T, 'viewed', dpDoc.id, sess.user.email, { via: 'proxy_external' })
          return new Response(dpBuf, { status: 200, headers: { 'Content-Type': dpResp.headers.get('content-type') || dpDoc.content_type || 'application/octet-stream', 'Content-Disposition': `inline; filename="${encodeURIComponent(dpDoc.filename || 'document')}"`, 'Cache-Control': 'private, no-store' } })
        } catch {
          return bad('تعذر الوصول لمصدر المستند الخارجي', 502)
        }
      }
      const dpBlob = await docStorageGet(db, dpDoc.storage?.object_key)
      if (!dpBlob) return bad('ملف المستند غير متاح في التخزين', 404)
      await docAuditLog(db, T, 'viewed', dpDoc.id, sess.user.email, { via: 'proxy' })
      return new Response(dpBlob.buffer, { status: 200, headers: { 'Content-Type': dpBlob.content_type, 'Content-Disposition': `inline; filename="${encodeURIComponent(dpDoc.filename || 'document')}"`, 'Cache-Control': 'private, no-store' } })
    }
    const bkDocDelMatch = route.match(/^\/meraaj\/booking-documents\/([^/]+)$/)
    if (bkDocDelMatch && method === 'DELETE') {
      const docBDel = await db.collection('booking_documents').findOne({ id: bkDocDelMatch[1], tenant_id: T })
      if (!docBDel) return bad('المستند غير موجود', 404)
      if (docBDel.source === 'meraaj') return bad('مستند وارد من معراج — لا يُحذف من جهة رحّال', 403)
      if (sess.user.role !== 'owner' && docBDel.uploaded_by !== sess.user.email) return bad('غير مصرح — الحذف للمالك أو لمن رفع المستند', 403)
      if (docBDel.context === 'cancellation_evidence') {
        const inbDel = await db.collection('meraaj_inbound_bookings').findOne({ id: docBDel.inbound_id, tenant_id: T }, { projection: { cancellation_status: 1 } })
        if (inbDel && ['position_submitted', 'finalized_cancelled'].includes(inbDel.cancellation_status)) {
          return bad('الموقف مُقدَّم لمعراج — أدلة الإلغاء المرتبطة به لا تُحذف (سلامة الأدلة)', 409)
        }
      }
      if (docBDel.storage?.object_key) await docStorageDelete(db, docBDel.storage.object_key)
      await db.collection('booking_documents').deleteOne({ id: docBDel.id, tenant_id: T })
      await docAuditLog(db, T, 'deleted', docBDel.id, sess.user.email, { context: docBDel.context, filename: docBDel.filename })
      return ok({ deleted: true })
    }
    // Integration status for the frontend tab
    if (route === '/meraaj/config' && method === 'GET') {
      const settingsCfg = await db.collection('tenant_settings').findOne(tf)
      return ok({
        configured: !!meraajSecret(),
        store_url: process.env.MERAAJ_STORE_URL || null,
        outbound_webhook_set: !!process.env.MERAAJ_WEBHOOK_URL,
        // v3.43 — per-office self-service store subscription state
        store_active: !!settingsCfg?.meraaj_store?.active,
        store_activated_at: settingsCfg?.meraaj_store?.activated_at || null,
        // v3.53 — optional auto-approval of inbound marketplace bookings
        auto_approve: !!settingsCfg?.meraaj_auto_approve,
        // v3.61 — daily rejected-webhooks alert threshold (0 = disabled, default 5)
        reject_alert_threshold: Number.isFinite(settingsCfg?.meraaj_reject_alert_threshold) ? settingsCfg.meraaj_reject_alert_threshold : 5,
        // v3.67 — opportunistic auto-retry of failed outbound events (OFF by default)
        auto_retry: !!settingsCfg?.meraaj_auto_retry,
        auto_retry_last: settingsCfg?.meraaj_auto_retry_last || null,
        // v3.71 — daily WhatsApp digest reminder time ('HH:MM' or '' = disabled)
        digest_reminder_time: settingsCfg?.meraaj_digest_reminder_time || '',
        // v3.76 — Account linking state (office identity at Meraaj)
        office_linked: !!settingsCfg?.meraaj_office_id,
        meraaj_office_id: settingsCfg?.meraaj_office_id || null,
        link_status: settingsCfg?.meraaj_link_status || (settingsCfg?.meraaj_office_id ? 'linked' : 'not_linked'),
        link_error: settingsCfg?.meraaj_link_error || null,
        // v3.74 — P2P/Escrow mode: cancellation authority moves to Meraaj Super Admin
        escrow_mode: !!settingsCfg?.meraaj_escrow_mode,
      })
    }
    // v3.53 — Meraaj behavior settings (owner only): auto-approve toggle
    // v3.61 — also accepts reject_alert_threshold (int 0..1000, 0 = alert disabled)
    // v3.71 — also accepts digest_reminder_time ('HH:MM' 24h format, '' = disabled)
    if (route === '/meraaj/settings' && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const b = await request.json()
      const set = {}
      if ('auto_approve' in b) set.meraaj_auto_approve = !!b.auto_approve
      if ('reject_alert_threshold' in b) set.meraaj_reject_alert_threshold = Math.max(0, Math.min(1000, parseInt(b.reject_alert_threshold, 10) || 0))
      if ('auto_retry' in b) set.meraaj_auto_retry = !!b.auto_retry // v3.67
      if ('escrow_mode' in b) set.meraaj_escrow_mode = !!b.escrow_mode // v3.74 — owner-controlled rollout
      if ('digest_reminder_time' in b) { // v3.71
        const t71 = String(b.digest_reminder_time || '').trim()
        if (t71 !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t71)) return bad('صيغة الوقت غير صحيحة — استخدم HH:MM (24 ساعة)')
        set.meraaj_digest_reminder_time = t71
      }
      if (Object.keys(set).length === 0) return bad('لا توجد إعدادات لتحديثها')
      await db.collection('tenant_settings').updateOne(tf, { $set: set }, { upsert: true })
      const cfgDoc = await db.collection('tenant_settings').findOne(tf)
      return ok({
        auto_approve: !!cfgDoc?.meraaj_auto_approve,
        reject_alert_threshold: Number.isFinite(cfgDoc?.meraaj_reject_alert_threshold) ? cfgDoc.meraaj_reject_alert_threshold : 5,
        auto_retry: !!cfgDoc?.meraaj_auto_retry, // v3.67
        digest_reminder_time: cfgDoc?.meraaj_digest_reminder_time || '', // v3.71
        escrow_mode: !!cfgDoc?.meraaj_escrow_mode, // v3.74
      })
    }
    // v3.53 — Lightweight pending-bookings counter (for the header notification bell)
    if (route === '/meraaj/inbound-count' && method === 'GET') {
      // v3.67 — opportunistic AUTO-RETRY hook: fire-and-forget (never blocks/affects this response).
      // Internally guarded by an atomic 10-min interval claim + attempts backoff — see helper.
      maybeAutoRetryMeraajEvents(db, T).catch(() => {})
      // v3.68 — expose the last SUCCESSFUL auto-retry summary so the UI can toast about it
      // (only when the feature is enabled and the last run actually sent something).
      const arS = await db.collection('tenant_settings').findOne(tf, { projection: { meraaj_auto_retry: 1, meraaj_auto_retry_last: 1 } })
      const autoRetryLast = (arS?.meraaj_auto_retry && (arS?.meraaj_auto_retry_last?.succeeded || 0) > 0) ? arS.meraaj_auto_retry_last : null
      return ok({
        pending: await db.collection('meraaj_inbound_bookings').countDocuments({ tenant_id: T, status: 'new' }),
        cancellation_requests: await db.collection('meraaj_inbound_bookings').countDocuments({ tenant_id: T, status: 'approved', cancellation_status: 'requested' }), // v3.73
        auto_retry_last: autoRetryLast, // v3.68 — additive, backward-compatible
      })
    }
    // v3.61 — OWNER DAILY DIGEST: yesterday/today Meraaj bookings + revenue + pending approvals
    // + rejected-webhooks alert (UTC day boundaries, consistent with the health trend chart).
    // Rejected/cancelled bookings are excluded from seats/revenue/net sums (counted in bookings).
    if (route === '/meraaj/daily-digest' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const startToday = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')
      const startYesterday = new Date(startToday.getTime() - 24 * 3600 * 1000)
      const endToday = new Date(startToday.getTime() + 24 * 3600 * 1000)
      const sumRange = async (from, to) => {
        const docs = await db.collection('meraaj_inbound_bookings').find({ ...tf, created_at: { $gte: from, $lt: to } }).project({ seats: 1, total_price: 1, net_to_seller_total: 1, status: 1 }).toArray()
        const s = { bookings: docs.length, seats: 0, revenue: 0, net_to_seller: 0 }
        for (const d of docs) {
          if (d.status === 'rejected' || d.status === 'cancelled') continue
          s.seats += Number(d.seats) || 0
          s.revenue += Number(d.total_price) || 0
          s.net_to_seller += Number(d.net_to_seller_total) || 0
        }
        s.revenue = +s.revenue.toFixed(2)
        s.net_to_seller = +s.net_to_seller.toFixed(2)
        return s
      }
      const yesterday = await sumRange(startYesterday, startToday)
      const today = await sumRange(startToday, endToday)
      // v3.65 — week-over-week comparison from the SAME accounting source (net_to_seller_total):
      // this week = last 7 days including today; previous week = the 7 days before that.
      const weekStart = new Date(endToday.getTime() - 7 * 24 * 3600 * 1000)
      const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 3600 * 1000)
      const thisWeek = await sumRange(weekStart, endToday)
      const prevWeek = await sumRange(prevWeekStart, weekStart)
      const growthPct = prevWeek.net_to_seller > 0
        ? +(((thisWeek.net_to_seller - prevWeek.net_to_seller) / prevWeek.net_to_seller) * 100).toFixed(1)
        : (thisWeek.net_to_seller > 0 ? null : 0) // null = new activity with no baseline
      // v3.66 — 4-week sparkline data (oldest→newest), same net_to_seller source
      const weeks = []
      for (let i = 3; i >= 0; i--) {
        const wEnd = new Date(endToday.getTime() - i * 7 * 24 * 3600 * 1000)
        const wStart = new Date(wEnd.getTime() - 7 * 24 * 3600 * 1000)
        const s = await sumRange(wStart, wEnd)
        weeks.push({ start: wStart.toISOString().slice(0, 10), bookings: s.bookings, net_to_seller: s.net_to_seller })
      }
      const pending = await db.collection('meraaj_inbound_bookings').countDocuments({ ...tf, status: 'new' })
      const rejectedToday = await db.collection('meraaj_webhook_log').countDocuments({ ok: false, at: { $gte: startToday } })
      const cfgDoc = await db.collection('tenant_settings').findOne(tf)
      const threshold = Number.isFinite(cfgDoc?.meraaj_reject_alert_threshold) ? cfgDoc.meraaj_reject_alert_threshold : 5
      // v3.62 — seat capacity warnings: shared open packages at >=80% of allocated seats (or <=1 left)
      const sharedOpen = await db.collection('packages').find({ ...tf, 'meraaj.shared': true, status: 'open' }).project({ id: 1, name: 1, meraaj: 1 }).toArray()
      const capacity_warnings = sharedOpen.map(p => {
        const alloc = Number(p.meraaj?.seats_allocated) || 0
        const sold = Number(p.meraaj?.seats_sold) || 0
        if (alloc <= 0) return null
        const remaining = Math.max(0, alloc - sold)
        const pct = Math.round((sold / alloc) * 100)
        return (pct >= 80 || remaining <= 1) ? { id: p.id, name: p.name, seats_allocated: alloc, seats_sold: sold, remaining, pct } : null
      }).filter(Boolean).sort((a, b) => b.pct - a.pct)
      return ok({
        yesterday, today, pending,
        rejected_today: rejectedToday,
        reject_alert_threshold: threshold,
        alert: threshold > 0 && rejectedToday >= threshold,
        capacity_warnings, // v3.62
        week: { this_week: thisWeek, prev_week: prevWeek, growth_pct: growthPct, weeks }, // v3.65 + v3.66 sparkline
      })
    }
    // v3.62 — MONTHLY MERAAJ REPORT (owner-only): per-package + per-buyer-office activity for a month.
    // Same exclusion semantics as digest: rejected/cancelled counted in bookings, excluded from sums.
    if (route === '/meraaj/monthly-report' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7)
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return bad('صيغة الشهر غير صحيحة — استخدم YYYY-MM')
      const start = new Date(month + '-01T00:00:00.000Z')
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
      const docs = await db.collection('meraaj_inbound_bookings').find({ ...tf, created_at: { $gte: start, $lt: end } }).project({ package_id: 1, package_name: 1, buyer_office_name: 1, seats: 1, total_price: 1, net_to_seller_total: 1, status: 1, currency: 1 }).toArray()
      const mkAgg = () => ({ bookings: 0, approved: 0, rejected: 0, seats: 0, revenue: 0, net_to_seller: 0, currency: '' })
      const addTo = (agg, d) => {
        agg.bookings++
        if (d.status === 'approved') agg.approved++
        if (d.status === 'rejected' || d.status === 'cancelled') { agg.rejected++; return }
        agg.seats += Number(d.seats) || 0
        agg.revenue += Number(d.total_price) || 0
        agg.net_to_seller += Number(d.net_to_seller_total) || 0
        if (!agg.currency && d.currency) agg.currency = d.currency
      }
      const byPkg = {}, byOffice = {}, totals = mkAgg()
      for (const d of docs) {
        const pk = d.package_name || d.package_id || 'غير معروف'
        const of = (d.buyer_office_name || 'غير معروف').trim() || 'غير معروف'
        byPkg[pk] = byPkg[pk] || mkAgg(); addTo(byPkg[pk], d)
        byOffice[of] = byOffice[of] || mkAgg(); addTo(byOffice[of], d)
        addTo(totals, d)
      }
      const round2 = (a) => ({ ...a, revenue: +a.revenue.toFixed(2), net_to_seller: +a.net_to_seller.toFixed(2) })
      const rejectedWebhooks = await db.collection('meraaj_webhook_log').countDocuments({ ok: false, at: { $gte: start, $lt: end } })
      const outboundEvents = await db.collection('meraaj_events').countDocuments({ ...tf, created_at: { $gte: start, $lt: end } })
      return ok({
        month,
        packages: Object.entries(byPkg).map(([name, a]) => ({ name, ...round2(a) })).sort((a, b) => b.revenue - a.revenue),
        offices: Object.entries(byOffice).map(([office, a]) => ({ office, ...round2(a) })).sort((a, b) => b.revenue - a.revenue),
        totals: round2(totals),
        rejected_webhooks: rejectedWebhooks,
        outbound_events: outboundEvents,
      })
    }
    // v3.69 — UNIFIED ALERTS CENTER (owner-only): one endpoint aggregating every operational
    // warning — failed outbound events, pending inbound bookings, seat capacity warnings,
    // missing passports (approved bookings) and today's rejected webhooks vs threshold.
    // READ-ONLY: never modifies any document.
    if (route === '/meraaj/alerts-center' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      // 1) failed outbound events (total + latest 5)
      const failedTotal = await db.collection('meraaj_events').countDocuments({ ...tf, status: 'failed' })
      const failedLatest = await db.collection('meraaj_events').find({ ...tf, status: 'failed' }).sort({ created_at: -1 }).limit(5).project({ _id: 0, id: 1, type: 1, attempts: 1, last_error: 1, created_at: 1 }).toArray()
      // 2) pending inbound bookings (total + latest 5)
      const pendingTotal = await db.collection('meraaj_inbound_bookings').countDocuments({ ...tf, status: 'new' })
      const pendingLatest = await db.collection('meraaj_inbound_bookings').find({ ...tf, status: 'new' }).sort({ created_at: -1 }).limit(5).project({ _id: 0, id: 1, package_name: 1, buyer_office_name: 1, seats: 1, total_price: 1, currency: 1, created_at: 1 }).toArray()
      // v3.73 — 2b) cancellation requests awaiting the owner's decision (approved bookings)
      const cancReqTotal = await db.collection('meraaj_inbound_bookings').countDocuments({ ...tf, status: 'approved', cancellation_status: 'requested' })
      const cancReqLatest = await db.collection('meraaj_inbound_bookings').find({ ...tf, status: 'approved', cancellation_status: 'requested' }).sort({ cancellation_requested_at: -1 }).limit(5).project({ _id: 0, id: 1, package_name: 1, buyer_office_name: 1, seats: 1, total_price: 1, currency: 1, cancellation_reason: 1, cancellation_requested_at: 1 }).toArray()
      // v3.73 — 2c) stale pending: new requests older than 24h (need urgent decision)
      const staleCutoff = new Date(Date.now() - 24 * 3600 * 1000)
      const stalePendingTotal = await db.collection('meraaj_inbound_bookings').countDocuments({ ...tf, status: 'new', created_at: { $lt: staleCutoff } })
      // v3.73 — 2d) price-mismatch rejections logged today (diagnostics)
      const startToday73 = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')
      const priceMismatchToday = await db.collection('meraaj_webhook_log').countDocuments({ reason: 'price_mismatch', at: { $gte: startToday73 } })
      // 3) seat capacity warnings — SAME rule as daily-digest (pct>=80 OR remaining<=1)
      const sharedOpenA = await db.collection('packages').find({ ...tf, 'meraaj.shared': true, status: 'open' }).project({ id: 1, name: 1, meraaj: 1 }).toArray()
      const capacityWarningsA = sharedOpenA.map(p => {
        const alloc = Number(p.meraaj?.seats_allocated) || 0
        const sold = Number(p.meraaj?.seats_sold) || 0
        if (alloc <= 0) return null
        const remaining = Math.max(0, alloc - sold)
        const pct = Math.round((sold / alloc) * 100)
        return (pct >= 80 || remaining <= 1) ? { id: p.id, name: p.name, seats_allocated: alloc, seats_sold: sold, remaining, pct } : null
      }).filter(Boolean).sort((a, b) => b.pct - a.pct)
      // 4) missing passports on APPROVED inbound bookings (authoritative = linked booking registrants)
      const apprInb = await db.collection('meraaj_inbound_bookings').find({ ...tf, status: 'approved' }).sort({ created_at: -1 }).limit(300).project({ _id: 0, id: 1, booking_id: 1, package_name: 1, buyer_office_name: 1, registrants: 1 }).toArray()
      const apprBids = apprInb.map(i => i.booking_id).filter(Boolean)
      const apprBk = apprBids.length ? await db.collection('package_bookings').find({ id: { $in: apprBids }, tenant_id: T }).project({ _id: 0, id: 1, registrants: 1 }).toArray() : []
      const apprBMap = {}
      for (const bk of apprBk) apprBMap[bk.id] = bk
      let missingTotal = 0
      const missingSample = []
      for (const inb of apprInb) {
        const regs = (inb.booking_id && apprBMap[inb.booking_id]?.registrants) ? apprBMap[inb.booking_id].registrants : (inb.registrants || [])
        for (const r of regs) {
          if (!String(r?.passport_no || '').trim()) {
            missingTotal++
            if (missingSample.length < 5) missingSample.push({ name: r?.name || 'مسافر', package_name: inb.package_name, office: inb.buyer_office_name || 'غير معروف' })
          }
        }
      }
      // 5) today's rejected webhooks vs configured threshold
      const startTodayA = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')
      const rejectedTodayA = await db.collection('meraaj_webhook_log').countDocuments({ ok: false, at: { $gte: startTodayA } })
      const cfgA = await db.collection('tenant_settings').findOne(tf)
      const thresholdA = Number.isFinite(cfgA?.meraaj_reject_alert_threshold) ? cfgA.meraaj_reject_alert_threshold : 5
      const rejectAlertA = thresholdA > 0 && rejectedTodayA >= thresholdA
      const countsA = {
        failed_events: failedTotal,
        pending_bookings: pendingTotal,
        cancellation_requests: cancReqTotal, // v3.73
        stale_pending: stalePendingTotal, // v3.73
        price_mismatch_today: priceMismatchToday, // v3.73
        capacity_warnings: capacityWarningsA.length,
        missing_passports: missingTotal,
        rejected_today: rejectedTodayA,
        total: failedTotal + pendingTotal + cancReqTotal + capacityWarningsA.length + missingTotal + (rejectAlertA ? 1 : 0),
      }
      // v3.71 — DAILY SNAPSHOT (fire-and-forget, never blocks the response): one doc per
      // tenant per UTC day in meraaj_alerts_history; upsert = last read of the day wins.
      const todayKey71 = new Date().toISOString().slice(0, 10)
      db.collection('meraaj_alerts_history').updateOne(
        { tenant_id: T, date: todayKey71 },
        { $set: { counts: countsA, updated_at: new Date() }, $setOnInsert: { id: uuidv4(), tenant_id: T, date: todayKey71, created_at: new Date() } },
        { upsert: true }
      ).catch(() => {})
      return ok({
        generated_at: new Date().toISOString(),
        counts: countsA,
        failed_events: failedLatest,
        pending_bookings: pendingLatest,
        cancellation_requests: cancReqLatest, // v3.73
        capacity_warnings: capacityWarningsA,
        missing_passports: { total: missingTotal, sample: missingSample },
        rejected_today: rejectedTodayA,
        reject_alert_threshold: thresholdA,
        reject_alert: rejectAlertA,
      })
    }
    // v3.71 — ALERTS HISTORY (owner-only, READ-ONLY): daily snapshots of alerts-center counts
    // (written opportunistically by GET /meraaj/alerts-center). ?days=N (default 14, clamp 7..60).
    // Returns rows oldest→newest, one per day that has a snapshot.
    if (route === '/meraaj/alerts-history' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const days71 = Math.max(7, Math.min(60, parseInt(url.searchParams.get('days'), 10) || 14))
      const fromKey71 = new Date(Date.now() - (days71 - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const rows71 = await db.collection('meraaj_alerts_history').find({ tenant_id: T, date: { $gte: fromKey71 } }).sort({ date: 1 }).project({ _id: 0, date: 1, counts: 1, updated_at: 1 }).toArray()
      return ok({ days: days71, rows: rows71 })
    }
    // v3.71 — COMPARISON TREND (owner-only, READ-ONLY): net_to_seller per month for the last
    // N months (default 6, clamp 3..12) ending at ?month=YYYY-MM (default current). Series
    // returned for the OVERALL total plus the top 6 offices and top 6 packages by window net.
    // SAME sum semantics: rejected/cancelled excluded from net, counted in bookings.
    if (route === '/meraaj/comparison-trend' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const endMonth71 = url.searchParams.get('month') || new Date().toISOString().slice(0, 7)
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth71)) return bad('صيغة الشهر غير صحيحة — استخدم YYYY-MM')
      const nMonths71 = Math.max(3, Math.min(12, parseInt(url.searchParams.get('months'), 10) || 6))
      const endMStart = new Date(endMonth71 + '-01T00:00:00.000Z')
      const months71 = []
      for (let i = nMonths71 - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(endMStart.getUTCFullYear(), endMStart.getUTCMonth() - i, 1))
        months71.push(d.toISOString().slice(0, 7))
      }
      const winStart = new Date(months71[0] + '-01T00:00:00.000Z')
      const winEnd = new Date(Date.UTC(endMStart.getUTCFullYear(), endMStart.getUTCMonth() + 1, 1))
      const docs71 = await db.collection('meraaj_inbound_bookings').find({ ...tf, created_at: { $gte: winStart, $lt: winEnd } }).project({ buyer_office_name: 1, package_id: 1, package_name: 1, net_to_seller_total: 1, status: 1, created_at: 1, currency: 1 }).toArray()
      const mIdx = {}
      months71.forEach((m, i) => { mIdx[m] = i })
      const zeros = () => months71.map(() => 0)
      const totalsNet = zeros(), totalsBookings = zeros()
      const offSeries = {}, pkgSeries = {}
      let currency71 = ''
      for (const d of docs71) {
        const mk = new Date(d.created_at).toISOString().slice(0, 7)
        const i = mIdx[mk]
        if (i === undefined) continue
        totalsBookings[i]++
        if (d.status === 'rejected' || d.status === 'cancelled') continue
        const net = Number(d.net_to_seller_total) || 0
        totalsNet[i] += net
        if (!currency71 && d.currency) currency71 = d.currency
        const of = (d.buyer_office_name || 'غير معروف').trim() || 'غير معروف'
        const pk = d.package_name || d.package_id || 'غير معروف'
        offSeries[of] = offSeries[of] || zeros(); offSeries[of][i] += net
        pkgSeries[pk] = pkgSeries[pk] || zeros(); pkgSeries[pk][i] += net
      }
      const topSeries = (map) => Object.entries(map)
        .map(([name, values]) => ({ name, values: values.map(v => +v.toFixed(2)), total: +values.reduce((s, v) => s + v, 0).toFixed(2) }))
        .sort((a, b) => b.total - a.total).slice(0, 6)
      return ok({
        months: months71,
        currency: currency71,
        totals: { net: totalsNet.map(v => +v.toFixed(2)), bookings: totalsBookings },
        offices: topSeries(offSeries),
        packages: topSeries(pkgSeries),
      })
    }
    // v3.69 — OFFICE PERFORMANCE COMPARISON (owner-only): month-over-month buyer-office
    // aggregates. SAME exclusion semantics as monthly-report (rejected/cancelled counted in
    // bookings + rejected but EXCLUDED from seats/revenue/net sums). UTC month boundaries.
    // growth_pct is computed on net_to_seller: prev>0 → pct; prev=0 & cur>0 → null (new); else 0.
    if (route === '/meraaj/office-comparison' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const monthC = url.searchParams.get('month') || new Date().toISOString().slice(0, 7)
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthC)) return bad('صيغة الشهر غير صحيحة — استخدم YYYY-MM')
      const curStart = new Date(monthC + '-01T00:00:00.000Z')
      const curEnd = new Date(Date.UTC(curStart.getUTCFullYear(), curStart.getUTCMonth() + 1, 1))
      const prevStart = new Date(Date.UTC(curStart.getUTCFullYear(), curStart.getUTCMonth() - 1, 1))
      const prevMonthC = prevStart.toISOString().slice(0, 7)
      const mkAggC = () => ({ bookings: 0, approved: 0, rejected: 0, seats: 0, revenue: 0, net_to_seller: 0, currency: '' })
      const addToC = (agg, d) => {
        agg.bookings++
        if (d.status === 'approved') agg.approved++
        if (d.status === 'rejected' || d.status === 'cancelled') { agg.rejected++; return }
        agg.seats += Number(d.seats) || 0
        agg.revenue += Number(d.total_price) || 0
        agg.net_to_seller += Number(d.net_to_seller_total) || 0
        if (!agg.currency && d.currency) agg.currency = d.currency
      }
      // v3.70 — aggregate by buyer office AND by package in one pass (packages[] is additive)
      const aggRangeC = async (from, to) => {
        const docs = await db.collection('meraaj_inbound_bookings').find({ ...tf, created_at: { $gte: from, $lt: to } }).project({ buyer_office_name: 1, package_id: 1, package_name: 1, seats: 1, total_price: 1, net_to_seller_total: 1, status: 1, currency: 1 }).toArray()
        const by = {}, byPkg = {}, tot = mkAggC()
        for (const d of docs) {
          const of = (d.buyer_office_name || 'غير معروف').trim() || 'غير معروف'
          const pk = d.package_name || d.package_id || 'غير معروف'
          by[of] = by[of] || mkAggC(); addToC(by[of], d)
          byPkg[pk] = byPkg[pk] || mkAggC(); addToC(byPkg[pk], d)
          addToC(tot, d)
        }
        return { by, byPkg, tot }
      }
      const curC = await aggRangeC(curStart, curEnd)
      const prevC = await aggRangeC(prevStart, curStart)
      const round2C = (a) => ({ ...a, revenue: +a.revenue.toFixed(2), net_to_seller: +a.net_to_seller.toFixed(2) })
      const growthC = (c, p) => p > 0 ? +(((c - p) / p) * 100).toFixed(1) : (c > 0 ? null : 0)
      const officeNames = [...new Set([...Object.keys(curC.by), ...Object.keys(prevC.by)])]
      const officesC = officeNames.map(office => {
        const c = round2C(curC.by[office] || mkAggC())
        const p = round2C(prevC.by[office] || mkAggC())
        return { office, current: c, previous: p, growth_pct: growthC(c.net_to_seller, p.net_to_seller) }
      }).sort((a, b) => b.current.revenue - a.current.revenue || b.previous.revenue - a.previous.revenue)
      // v3.70 — month-over-month per-package comparison (union of both months, same growth semantics)
      const pkgNamesC = [...new Set([...Object.keys(curC.byPkg), ...Object.keys(prevC.byPkg)])]
      const packagesC = pkgNamesC.map(name => {
        const c = round2C(curC.byPkg[name] || mkAggC())
        const p = round2C(prevC.byPkg[name] || mkAggC())
        return { name, current: c, previous: p, growth_pct: growthC(c.net_to_seller, p.net_to_seller) }
      }).sort((a, b) => b.current.revenue - a.current.revenue || b.previous.revenue - a.previous.revenue)
      const totCur = round2C(curC.tot), totPrev = round2C(prevC.tot)
      return ok({
        month: monthC,
        prev_month: prevMonthC,
        offices: officesC,
        packages: packagesC, // v3.70
        totals: { current: totCur, previous: totPrev, growth_pct: growthC(totCur.net_to_seller, totPrev.net_to_seller) },
      })
    }
    // v3.43 — SELF-SERVICE STORE ACTIVATION (Subscribe / Activate) — instant, no manual steps.
    // Stores the subscription flag per office; best-effort notifies Meraaj via the outbox
    // (additive event — delivery failure NEVER blocks activation; contract payloads untouched).
    if (route === '/meraaj/activate' && method === 'POST') {
      const settingsAct = await db.collection('tenant_settings').findOne(tf)
      if (settingsAct?.meraaj_store?.active) {
        return ok({ active: true, activated_at: settingsAct.meraaj_store.activated_at, already: true })
      }
      const activatedAt = new Date()
      await db.collection('tenant_settings').updateOne(tf, {
        $set: { meraaj_store: { active: true, activated_at: activatedAt, activated_by: sess.user.email } },
      }, { upsert: true })
      try {
        await emitMeraajEvent(db, T, 'office.store_activated', {
          office_ref: T,
          office_name: settingsAct?.agency_name || sess.tenant.name || '',
          activated_at: activatedAt.toISOString(),
        })
      } catch { /* non-blocking */ }
      // v3.76 — AUTO ACCOUNT LINKING on opt-in (fire-and-forget: activation never blocks on it)
      if (!settingsAct?.meraaj_office_id) {
        meraajLinkOfficeAPI(db, T, {
          office_ref: T,
          office_name: settingsAct?.agency_name || sess.tenant.name || '',
          owner_email: sess.user.email,
          store_active: true,
          escrow_mode: !!settingsAct?.meraaj_escrow_mode,
          requested_by: sess.user.email,
          requested_at: activatedAt.toISOString(),
        }).then(link => {
          if (link.ok) return db.collection('tenant_settings').updateOne(tf, { $set: { meraaj_office_id: link.office_id, meraaj_link_status: 'linked', meraaj_linked_at: new Date(), meraaj_link_error: null } }, { upsert: true })
          return db.collection('tenant_settings').updateOne(tf, { $set: { meraaj_link_status: 'failed', meraaj_link_error: link.error, meraaj_link_attempted_at: new Date() } }, { upsert: true })
        }).catch(() => {})
      }
      return ok({ active: true, activated_at: activatedAt })
    }
    // Share / update / unshare a package to Meraaj marketplace
    const meraajShareMatch = route.match(/^\/packages\/([^/]+)\/meraaj-share$/)
    if (meraajShareMatch && method === 'POST') {
      const b = await request.json()
      const pkg = await db.collection('packages').findOne({ id: meraajShareMatch[1], tenant_id: T })
      if (!pkg) return bad('الباكج غير موجود', 404)
      if (b.enabled === false) {
        // v3.34 — deliver deactivation FIRST; if Meraaj can't be reached, keep state consistent (block unshare)
        if (pkg.meraaj?.shared) {
          const dlv = await emitMeraajEvent(db, T, 'package.deactivated', { package_ref: pkg.id, reason: 'unshared_by_office' })
          if (dlv === 'failed') return bad('تعذر إبلاغ سوق معراج بإيقاف المشاركة — لم يتم الإلغاء. حاول لاحقاً', 502)
        }
        await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { 'meraaj.shared': false, 'meraaj.unshared_at': new Date() } })
        return ok({ shared: false })
      }
      // v3.25 — SMART SHARE: prices are pulled AUTOMATICALLY from the package room pricing.
      // The only manual inputs: buyer (agent) commission + direction + seats.
      const roomPricing = Array.isArray(pkg.room_pricing) ? pkg.room_pricing.filter(r => (Number(r.sale_per_pax) || 0) > 0) : []
      if (roomPricing.length === 0) return bad('لا توجد أسعار غرف معرّفة في الباكج — حدّد التسعير المباشر (غرفة + عمر) في إعدادات الباكج أولاً')
      const commissionMode = b.buyer_commission_mode === 'percent' ? 'percent' : 'amount'
      const commissionValue = Math.max(0, Number(b.buyer_commission_value) || 0)
      if (commissionMode === 'percent' && commissionValue > 90) return bad('نسبة العمولة غير منطقية (>90%)')
      // 'added'  → الوكيل يضيف عمولته فوق سعرنا (نقبض سعرنا كاملاً)
      // 'deducted' → سعر السوق ثابت وتُقتطع العمولة من هامشنا
      const commissionDirection = b.commission_direction === 'added' ? 'added' : 'deducted'
      // v3.53 — optional per-age commission overrides (فارغ = نفس عمولة البالغ)
      const commissionChild = (b.buyer_commission_child_value === undefined || b.buyer_commission_child_value === null || b.buyer_commission_child_value === '') ? null : Math.max(0, Number(b.buyer_commission_child_value) || 0)
      const commissionInfant = (b.buyer_commission_infant_value === undefined || b.buyer_commission_infant_value === null || b.buyer_commission_infant_value === '') ? null : Math.max(0, Number(b.buyer_commission_infant_value) || 0)
      const marketPricing = computeMeraajMarketPricing(roomPricing, commissionMode, commissionValue, commissionDirection, commissionChild, commissionInfant)
      // Sanity: in 'deducted' mode the commission must not consume the full price
      if (commissionDirection === 'deducted') {
        const badRow = marketPricing.find(r => r.base.adult > 0 && r.net.adult <= 0)
        if (badRow) return bad(`العمولة تلتهم كامل سعر غرفة (${badRow.room_type}) — خفّض العمولة أو غيّر الاتجاه إلى "تُضاف فوق السعر"`)
      }
      const seatsAllocatedRaw = Number(b.seats_allocated)
      if (!(seatsAllocatedRaw > 0)) return bad('حدد عدد المقاعد المتاحة للسوق (1 على الأقل)')
      const seatsAllocated = Math.min(10000, Math.floor(seatsAllocatedRaw))
      const prevSold = Number(pkg.meraaj?.seats_sold) || 0
      if (seatsAllocated < prevSold) return bad(`لا يمكن تخصيص أقل من المقاعد المباعة مسبقاً (${prevSold})`)
      const meraajSet = {
        shared: true,
        pricing_source: 'auto_room_pricing', // v3.25 — prices always mirror the package itself
        buyer_commission_mode: commissionMode,
        buyer_commission_value: commissionValue,
        buyer_commission_child_value: commissionChild,   // v3.53
        buyer_commission_infant_value: commissionInfant, // v3.53
        commission_direction: commissionDirection,
        market_pricing: marketPricing,
        seats_allocated: seatsAllocated,
        seats_sold: prevSold,
        shared_at: pkg.meraaj?.shared_at || new Date(),
        updated_at: new Date(),
      }
      await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { meraaj: meraajSet } })
      const updated = await db.collection('packages').findOne({ id: pkg.id, tenant_id: T })
      const comps = await db.collection('package_components').find({ package_id: pkg.id, tenant_id: T }).toArray()
      // v3.29 — FIRST share = direct REST registration at Meraaj (NO 'package.shared' webhook — removed permanently).
      // Subsequent shares/updates keep using the 'package.updated' webhook.
      const firstShare = !pkg.meraaj?.registered_at
      if (firstShare) {
        const reg = await meraajRegisterPackageAPI(db, T, updated, comps, meraajSet)
        if (!reg.ok) {
          // Share is successful ONLY on 2xx from Meraaj — roll back the local share flag entirely
          await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { meraaj: { ...(pkg.meraaj || {}), shared: false } } })
          return bad(`فشلت المشاركة — لم يقبل سوق معراج تسجيل الباكج: ${reg.error}`, 502)
        }
        const regSet = { 'meraaj.registered_at': new Date() }
        if (reg.remote_id) regSet['meraaj.remote_id'] = reg.remote_id
        await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: regSet })
        return ok({ shared: true, meraaj: { ...meraajSet, registered_at: regSet['meraaj.registered_at'], remote_id: reg.remote_id || null }, registered_via: 'rest_api' })
      }
      // Already registered at Meraaj before → keep registration reference + notify via webhook (contract payload)
      await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { 'meraaj.registered_at': pkg.meraaj.registered_at, ...(pkg.meraaj.remote_id ? { 'meraaj.remote_id': pkg.meraaj.remote_id } : {}) } })
      await emitMeraajEvent(db, T, 'package.updated', await meraajContractPayload(db, T, updated, comps, meraajSet))
      return ok({ shared: true, meraaj: meraajSet })
    }
    // Marketplace bookings received from Meraaj (inbound)
    if (route === '/meraaj/inbound-bookings' && method === 'GET') {
      return ok(clean(await db.collection('meraaj_inbound_bookings').find(tf).sort({ created_at: -1 }).limit(200).toArray()))
    }
    // v3.67 — REGISTRANT PASSPORT REPORT (owner-only, READ-ONLY): approved Meraaj registrants
    // still missing a passport, from the AUTHORITATIVE linked package_bookings registrants
    // (falls back to the inbound copy only if the link is missing). Filters: package_id, office.
    if (route === '/meraaj/passport-report' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const fPkg = url.searchParams.get('package_id') || ''
      const fOffice = url.searchParams.get('office') || ''
      const q = { ...tf, status: 'approved' }
      if (fPkg) q.package_id = fPkg
      if (fOffice) q.buyer_office_name = fOffice
      const inbounds = await db.collection('meraaj_inbound_bookings').find(q).sort({ created_at: -1 }).limit(500).toArray()
      // authoritative registrants from linked bookings (batch fetch)
      const bIds = inbounds.map(i => i.booking_id).filter(Boolean)
      const bookings = bIds.length ? await db.collection('package_bookings').find({ id: { $in: bIds }, tenant_id: T }).project({ id: 1, registrants: 1 }).toArray() : []
      const bMap = {}
      for (const bk of bookings) bMap[bk.id] = bk
      const rows = []
      const pkgSet = new Map(), officeSet = new Set()
      for (const inb of inbounds) {
        pkgSet.set(inb.package_id, inb.package_name)
        officeSet.add(inb.buyer_office_name || 'غير معروف')
        const regs = (inb.booking_id && bMap[inb.booking_id]?.registrants) ? bMap[inb.booking_id].registrants : (inb.registrants || [])
        regs.forEach((r, idx) => {
          if (!String(r?.passport_no || '').trim()) {
            rows.push({
              inbound_id: inb.id, booking_id: inb.booking_id || null,
              package_id: inb.package_id, package_name: inb.package_name,
              office: inb.buyer_office_name || 'غير معروف',
              booking_ref: inb.meraaj_booking_ref || null,
              registrant_index: idx, name: r?.name || `مسافر ${idx + 1}`, age: r?.age ?? null,
              approved_at: inb.approved_at || inb.created_at,
            })
          }
        })
      }
      return ok({
        total_missing: rows.length,
        scanned_bookings: inbounds.length,
        rows,
        packages: [...pkgSet.entries()].map(([id, name]) => ({ id, name })),
        offices: [...officeSet],
      })
    }
    // v3.66 — PASSPORT COMPLETION (fill-only): sets ONLY currently-EMPTY passport_no fields on
    // inbound registrants, and mirrors them into the linked real booking (same index order) when
    // approved. Never overwrites an existing passport, never touches any other field or the
    // approval state. Same screen access as inbound bookings (staff with Meraaj module can fill).
    const passCompleteMatch = route.match(/^\/meraaj\/inbound-bookings\/([^/]+)\/passports$/)
    if (passCompleteMatch && method === 'POST') {
      const inb = await db.collection('meraaj_inbound_bookings').findOne({ id: passCompleteMatch[1], tenant_id: T })
      if (!inb) return bad('الحجز الوارد غير موجود', 404)
      const b = await request.json().catch(() => ({}))
      const items = Array.isArray(b.passports) ? b.passports : []
      if (items.length === 0) return bad('لا توجد جوازات للحفظ')
      const regs = Array.isArray(inb.registrants) ? [...inb.registrants] : []
      const updated = []
      for (const it of items) {
        const idx = Number(it.index)
        if (!Number.isInteger(idx) || idx < 0 || idx >= regs.length) return bad(`فهرس مسجّل غير صالح`)
        if (String(regs[idx]?.passport_no || '').trim()) return bad(`المسجّل «${regs[idx].name}» لديه جواز مسجّل مسبقاً — لا يمكن استبداله من هنا`)
        const pass = String(it.passport_no || '').trim().toUpperCase()
        if (!/^[A-Z0-9]{5,15}$/.test(pass)) return bad(`رقم جواز غير صالح للمسجّل «${regs[idx]?.name || idx + 1}» — أحرف إنجليزية وأرقام فقط (5-15 خانة)`)
        regs[idx] = { ...regs[idx], passport_no: pass }
        updated.push({ index: idx, passport_no: pass })
      }
      await db.collection('meraaj_inbound_bookings').updateOne({ id: inb.id, tenant_id: T }, { $set: { registrants: regs, passports_completed_at: new Date(), passports_completed_by: sess.user.id } })
      // Mirror into the linked approved booking (fill-only there too)
      let bookingSynced = false
      if (inb.booking_id) {
        const bk = await db.collection('package_bookings').findOne({ id: inb.booking_id, tenant_id: T })
        if (bk && Array.isArray(bk.registrants) && bk.registrants.length === regs.length) {
          const bregs = [...bk.registrants]
          for (const u of updated) if (!String(bregs[u.index]?.passport_no || '').trim()) bregs[u.index] = { ...bregs[u.index], passport_no: u.passport_no }
          await db.collection('package_bookings').updateOne({ id: bk.id, tenant_id: T }, { $set: { registrants: bregs } })
          bookingSynced = true
        }
      }
      return ok({ updated: updated.length, booking_synced: bookingSynced, registrants: regs })
    }
    // v3.63 — ONE-TAP SEAT REFILL (owner): raise a shared package's allocated Meraaj seats
    // directly from the dashboard capacity warning. Emits the standard package.updated event
    // (untouched meraajContractPayload) so the marketplace availability updates immediately.
    const seatRefillMatch = route.match(/^\/meraaj\/packages\/([^/]+)\/add-seats$/)
    if (seatRefillMatch && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const pkg = await db.collection('packages').findOne({ id: seatRefillMatch[1], tenant_id: T })
      if (!pkg) return bad('الباكج غير موجود', 404)
      if (!pkg.meraaj?.shared) return bad('الباكج غير مشارك في سوق معراج')
      const b = await request.json().catch(() => ({}))
      if (!(Number(b.add) > 0)) return bad('حدد عدد المقاعد المضافة (1 على الأقل)')
      const add = Math.min(1000, Math.max(1, Math.floor(Number(b.add))))
      const newAlloc = Math.min(10000, (Number(pkg.meraaj.seats_allocated) || 0) + add)
      await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { 'meraaj.seats_allocated': newAlloc, 'meraaj.updated_at': new Date() } })
      // v3.72 — seats freed: clear the sold-out hide flag so the update below relists the package
      if (pkg.meraaj.hidden_full && newAlloc - (Number(pkg.meraaj.seats_sold) || 0) > 0) {
        await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { 'meraaj.hidden_full': false } })
      }
      const updated = await db.collection('packages').findOne({ id: pkg.id, tenant_id: T })
      const comps = await db.collection('package_components').find({ package_id: pkg.id, tenant_id: T }).toArray()
      await emitMeraajEvent(db, T, 'package.updated', await meraajContractPayload(db, T, updated, comps, updated.meraaj))
      const sold = Number(updated.meraaj?.seats_sold) || 0
      return ok({ seats_allocated: newAlloc, seats_sold: sold, remaining: Math.max(0, newAlloc - sold), added: add })
    }
    // v3.72 — تفويج (DISPATCH): manual one-tap hide of a departed package from the Meraaj market.
    // POST /meraaj/packages/:id/dispatch {dispatched: true|false} (owner only).
    // dispatched=true → package.deactivated (vanishes from the market until undone).
    // dispatched=false → relists automatically IF open + not archived + seats available.
    const dispatchMatch = route.match(/^\/meraaj\/packages\/([^/]+)\/dispatch$/)
    if (dispatchMatch && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const pkgD = await db.collection('packages').findOne({ id: dispatchMatch[1], tenant_id: T })
      if (!pkgD) return bad('الباكج غير موجود', 404)
      if (!pkgD.meraaj?.shared) return bad('الباكج غير مُشارَك في سوق معراج')
      const bD = await request.json().catch(() => ({}))
      const wantDispatch = bD.dispatched !== false
      if (wantDispatch) {
        if (pkgD.meraaj.dispatched) return bad('الباقة مُفوَّجة مسبقاً')
        await db.collection('packages').updateOne({ id: pkgD.id, tenant_id: T }, { $set: { 'meraaj.dispatched': true, 'meraaj.dispatched_at': new Date(), 'meraaj.dispatched_by': sess.user.id } })
        await emitMeraajEvent(db, T, 'package.deactivated', { package_ref: pkgD.id, reason: 'dispatched', availability: 'غير متاح' })
        return ok({ dispatched: true })
      }
      if (!pkgD.meraaj.dispatched) return bad('الباقة غير مُفوَّجة')
      await db.collection('packages').updateOne({ id: pkgD.id, tenant_id: T }, { $set: { 'meraaj.dispatched': false, 'meraaj.hidden_full': false }, $unset: { 'meraaj.dispatched_at': '', 'meraaj.dispatched_by': '' } })
      const freshD = await db.collection('packages').findOne({ id: pkgD.id, tenant_id: T })
      const remainingD = meraajAvailability(freshD)
      if (freshD.status === 'open' && !freshD.archived && remainingD > 0) {
        const compsD = await db.collection('package_components').find({ package_id: pkgD.id, tenant_id: T }).toArray()
        await emitMeraajEvent(db, T, 'package.updated', await meraajContractPayload(db, T, freshD, compsD, freshD.meraaj))
        return ok({ dispatched: false, relisted: true, remaining: remainingD })
      }
      return ok({ dispatched: false, relisted: false, remaining: remainingD })
    }
    // v3.63 — BUYER OFFICE RATING TAGS (owner): excellent | good | late_payment | '' (remove)
    if (route === '/meraaj/office-tag' && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const b = await request.json().catch(() => ({}))
      const office = String(b.office || '').trim().slice(0, 120)
      if (!office) return bad('اسم المكتب مطلوب')
      const allowed = ['excellent', 'good', 'late_payment', '']
      if (!allowed.includes(b.tag)) return bad('تقييم غير صالح')
      if (b.tag === '') {
        await db.collection('meraaj_office_tags').deleteOne({ tenant_id: T, office })
      } else {
        await db.collection('meraaj_office_tags').updateOne(
          { tenant_id: T, office },
          { $set: { tag: b.tag, updated_at: new Date(), updated_by: sess.user.id }, $setOnInsert: { id: uuidv4(), tenant_id: T, office } },
          { upsert: true }
        )
      }
      return ok({ office, tag: b.tag })
    }
    // v3.64 — list buyer-office rating tags (read-only; same screen access as inbound bookings,
    // so the rating is visible while approving incoming bookings)
    if (route === '/meraaj/office-tags' && method === 'GET') {
      return ok(await db.collection('meraaj_office_tags').find(tf).project({ _id: 0, office: 1, tag: 1 }).toArray())
    }
    // v3.26 — APPROVE inbound Meraaj booking → real package_booking + balanced Journal Entry
    // v3.53 — logic extracted to approveMeraajInboundBooking() (shared with the optional auto-approve setting)
    const meraajApproveMatch = route.match(/^\/meraaj\/inbound-bookings\/([^/]+)\/approve$/)
    if (meraajApproveMatch && method === 'POST') {
      // v3.74 — SERVER-SIDE RBAC (Enterprise): owner OR staff explicitly granted mod_meraaj
      if (sess.user.role !== 'owner' && !effectivePermissions(sess.user).mod_meraaj) return bad('غير مصرح — يتطلب صلاحية متجر معراج', 403)
      // v3.73 — ATOMIC claim (status new → approving): double-click / concurrent approve safe.
      const claimA = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
        { id: meraajApproveMatch[1], tenant_id: T, status: 'new' },
        { $set: { status: 'approving' } },
      )
      if (!claimA) {
        const cur = await db.collection('meraaj_inbound_bookings').findOne({ id: meraajApproveMatch[1], tenant_id: T })
        if (!cur) return bad('الحجز الوارد غير موجود', 404)
        return bad(cur.status === 'approved' ? 'هذا الحجز معتمد مسبقاً' : cur.status === 'cancelled' ? 'لا يمكن اعتماد حجز ملغى' : cur.status === 'rejected' ? 'الحجز مرفوض مسبقاً' : 'الحجز قيد المعالجة حالياً', 409)
      }
      // belt: never create a second package_booking for the same inbound
      if (claimA.booking_id) {
        await db.collection('meraaj_inbound_bookings').updateOne({ id: claimA.id, tenant_id: T }, { $set: { status: 'approved' } })
        return bad('هذا الحجز معتمد مسبقاً (حجز محاسبي موجود)', 409)
      }
      try {
        const res = await approveMeraajInboundBooking(db, T, claimA, sess.user)
        return ok({ approved: true, ...res, journal_balanced: true })
      } catch (e) {
        // revert the claim so the request can be retried
        await db.collection('meraaj_inbound_bookings').updateOne({ id: claimA.id, tenant_id: T, status: 'approving' }, { $set: { status: 'new' } })
        return bad(e.message || 'تعذر اعتماد الحجز')
      }
    }
    // v3.27 — REJECT inbound Meraaj booking: releases seats + notifies Meraaj with the reason
    const meraajRejectMatch = route.match(/^\/meraaj\/inbound-bookings\/([^/]+)\/reject$/)
    if (meraajRejectMatch && method === 'POST') {
      // v3.74 — SERVER-SIDE RBAC (Enterprise): owner OR staff explicitly granted mod_meraaj
      if (sess.user.role !== 'owner' && !effectivePermissions(sess.user).mod_meraaj) return bad('غير مصرح — يتطلب صلاحية متجر معراج', 403)
      const b = await request.json()
      const reason = String(b.reason || '').trim().slice(0, 300)
      if (!reason) return bad('سبب الرفض إلزامي — سيظهر للمكتب المشتري في معراج')
      // v3.73 — ATOMIC claim (status new → rejected): seats are released EXACTLY once
      const inbound = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
        { id: meraajRejectMatch[1], tenant_id: T, status: 'new' },
        { $set: { status: 'rejected', rejected_at: new Date(), reject_reason: reason, rejected_by: sess.user.id }, $push: { history: { at: new Date(), action: 'rejected', actor: sess.user.name || sess.user.email, note: reason } } },
      )
      if (!inbound) {
        const cur = await db.collection('meraaj_inbound_bookings').findOne({ id: meraajRejectMatch[1], tenant_id: T })
        if (!cur) return bad('الحجز الوارد غير موجود', 404)
        return bad(cur.status === 'approved' ? 'لا يمكن رفض حجز معتمد — استخدم مسار طلب الإلغاء' : cur.status === 'cancelled' ? 'الحجز ملغى مسبقاً من المشتري' : 'الحجز مرفوض مسبقاً', 409)
      }
      // Release the marketplace seats
      await db.collection('packages').updateOne({ id: inbound.package_id, tenant_id: T }, { $inc: { 'meraaj.seats_sold': -inbound.seats } })
      await meraajAutoListing(db, T, inbound.package_id) // v3.72 — relist if seats freed
      // Notify Meraaj (closes the loop — the buyer sees the rejection + reason)
      await emitMeraajEvent(db, T, 'booking.rejected', {
        booking_ref: inbound.meraaj_booking_ref,
        package_ref: inbound.package_id,
        ...(await meraajPkgIdentityFields(db, inbound.package_id)), // v3.76
        inbound_id: inbound.id,
        buyer_office_name: inbound.buyer_office_name,
        reason,
        released_seats: inbound.seats,
        rejected_at: new Date(),
      })
      await maybeEmitMeraajInventory(db, T, inbound.package_id)
      return ok({ rejected: true, released_seats: inbound.seats, reason })
    }
    // v3.73 — APPROVE a buyer CANCELLATION REQUEST on an approved booking (owner action):
    // status → cancelled, seats released ONCE, linked package_booking cancelled, accounting
    // reversed via a mirrored Journal Entry, then booking.cancellation.approved → Meraaj.
    const cancApproveMatch = route.match(/^\/meraaj\/inbound-bookings\/([^/]+)\/cancellation\/approve$/)
    if (cancApproveMatch && method === 'POST') {
      return cors(NextResponse.json({ error: 'final_cancellation_authority_moved', message: 'القرار النهائي لإلغاء حجوزات معراج متاح حصراً للسوبر أدمن في معراج. مكتب رحّال يقدّم موقفه والأدلة فقط.' }, { status: 403 }))
      // v3.74 — SERVER-SIDE RBAC: financial decision → owner OR (mod_meraaj + can_refund)
      const permsCA = effectivePermissions(sess.user)
      if (sess.user.role !== 'owner' && !(permsCA.mod_meraaj && permsCA.can_refund)) return bad('غير مصرح — يتطلب صلاحية متجر معراج + صلاحية الاسترداد', 403)
      // v3.74 — ESCROW MODE: the office no longer issues the FINAL cancellation decision.
      const esCfgA = await db.collection('tenant_settings').findOne({ tenant_id: T }, { projection: { meraaj_escrow_mode: 1 } })
      if (esCfgA?.meraaj_escrow_mode) return cors(NextResponse.json({ error: 'escrow_mode_active', message: 'وضع Escrow مفعل — قدّم موقف المكتب عبر مسار cancellation/position والقرار النهائي لدى إدارة معراج' }, { status: 409 }))
      const bCA = await request.json().catch(() => ({}))
      const noteCA = String(bCA.note || '').trim().slice(0, 300)
      const inbound = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
        { id: cancApproveMatch[1], tenant_id: T, status: 'approved', cancellation_status: 'requested' },
        { $set: { cancellation_status: 'approved', status: 'cancelled', cancelled_at: new Date(), cancelled_by: sess.user.id }, $push: { history: { at: new Date(), action: 'cancellation_approved', actor: sess.user.name || sess.user.email, note: noteCA } } },
      )
      if (!inbound) {
        const cur = await db.collection('meraaj_inbound_bookings').findOne({ id: cancApproveMatch[1], tenant_id: T })
        if (!cur) return bad('الحجز الوارد غير موجود', 404)
        return bad(cur.cancellation_status !== 'requested' ? 'لا يوجد طلب إلغاء معلق على هذا الحجز' : 'الحجز ليس بحالة معتمد', 409)
      }
      // seats released exactly once (the atomic claim above guarantees single execution)
      await db.collection('packages').updateOne({ id: inbound.package_id, tenant_id: T }, { $inc: { 'meraaj.seats_sold': -inbound.seats } })
      // reverse the accounting: mirror the ORIGINAL approval Journal Entry (debit↔credit) + balances
      let accountingReversed = false, accountingNote = null
      try {
        if (inbound.booking_id) {
          const origJe = await db.collection('journal_entries').findOne({ tenant_id: T, ref_type: 'package_booking', ref_id: inbound.booking_id })
          if (origJe && Array.isArray(origJe.lines)) {
            const revLines = origJe.lines.map(l => ({ ...l, debit: Number(l.credit) || 0, credit: Number(l.debit) || 0 }))
            await createJournalEntry(db, T, {
              date: new Date(),
              description: `عكس اعتماد حجز معراج ${inbound.meraaj_booking_ref || ''} — إلغاء معتمد من صاحب الباكيج${noteCA ? ` (${noteCA})` : ''}`,
              ref_type: 'package_booking_cancellation', ref_id: inbound.booking_id, currency: origJe.currency, lines: revLines,
            })
            for (const l of origJe.lines) {
              const netl = (Number(l.debit) || 0) - (Number(l.credit) || 0)
              if (l.party_type === 'client' && l.party_id) await updateBalance(db, 'clients', { id: l.party_id, tenant_id: T }, origJe.currency, -netl)
              if (l.party_type === 'supplier' && l.party_id) await updateBalance(db, 'suppliers', { id: l.party_id, tenant_id: T }, origJe.currency, ((Number(l.credit) || 0) - (Number(l.debit) || 0)) * -1)
            }
            accountingReversed = true
          }
          await db.collection('package_bookings').updateOne({ id: inbound.booking_id, tenant_id: T }, { $set: { status: 'cancelled', cancelled_at: new Date(), cancel_source: 'meraaj_cancellation_approved' } })
        }
      } catch (revErr) {
        accountingNote = revErr.message || 'فشل عكس القيد المحاسبي — راجعه يدوياً'
        await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id, tenant_id: T }, { $push: { history: { at: new Date(), action: 'accounting_reversal_failed', actor: 'system', note: accountingNote } } })
      }
      await meraajAutoListing(db, T, inbound.package_id)
      await maybeEmitMeraajInventory(db, T, inbound.package_id)
      await emitMeraajEvent(db, T, 'booking.cancellation.approved', {
        booking_ref: inbound.meraaj_booking_ref,
        package_ref: inbound.package_id,
        ...(await meraajPkgIdentityFields(db, inbound.package_id)), // v3.76
        inbound_id: inbound.id,
        buyer_office_name: inbound.buyer_office_name,
        released_seats: inbound.seats,
        refund_note: noteCA || null,
        cancelled_at: new Date(),
      })
      return ok({ cancellation_approved: true, released_seats: inbound.seats, accounting_reversed: accountingReversed, accounting_note: accountingNote })
    }
    // v3.73 — REJECT a buyer CANCELLATION REQUEST: booking stays approved, request archived,
    // booking.cancellation.rejected → Meraaj with the reason.
    const cancRejectMatch = route.match(/^\/meraaj\/inbound-bookings\/([^/]+)\/cancellation\/reject$/)
    if (cancRejectMatch && method === 'POST') {
      return cors(NextResponse.json({ error: 'final_cancellation_authority_moved', message: 'القرار النهائي برفض/قبول إلغاء حجوزات معراج متاح حصراً للسوبر أدمن في معراج. مكتب رحّال يقدّم موقفه والأدلة فقط.' }, { status: 403 }))
      // v3.74 — SERVER-SIDE RBAC + escrow gate (same authority rules as cancellation/approve)
      const permsCR = effectivePermissions(sess.user)
      if (sess.user.role !== 'owner' && !(permsCR.mod_meraaj && permsCR.can_refund)) return bad('غير مصرح — يتطلب صلاحية متجر معراج + صلاحية الاسترداد', 403)
      const esCfgR = await db.collection('tenant_settings').findOne({ tenant_id: T }, { projection: { meraaj_escrow_mode: 1 } })
      if (esCfgR?.meraaj_escrow_mode) return cors(NextResponse.json({ error: 'escrow_mode_active', message: 'وضع Escrow مفعل — قدّم موقف المكتب عبر مسار cancellation/position والقرار النهائي لدى إدارة معراج' }, { status: 409 }))
      const bCR = await request.json()
      const reasonCR = String(bCR.reason || '').trim().slice(0, 300)
      if (!reasonCR) return bad('سبب رفض طلب الإلغاء إلزامي — سيظهر للمكتب المشتري')
      const inbound = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
        { id: cancRejectMatch[1], tenant_id: T, status: 'approved', cancellation_status: 'requested' },
        { $set: { cancellation_status: 'rejected', cancellation_rejected_at: new Date(), cancellation_rejected_by: sess.user.id, cancellation_reject_reason: reasonCR }, $push: { history: { at: new Date(), action: 'cancellation_rejected', actor: sess.user.name || sess.user.email, note: reasonCR } } },
      )
      if (!inbound) {
        const cur = await db.collection('meraaj_inbound_bookings').findOne({ id: cancRejectMatch[1], tenant_id: T })
        if (!cur) return bad('الحجز الوارد غير موجود', 404)
        return bad('لا يوجد طلب إلغاء معلق على هذا الحجز', 409)
      }
      await emitMeraajEvent(db, T, 'booking.cancellation.rejected', {
        booking_ref: inbound.meraaj_booking_ref,
        package_ref: inbound.package_id,
        ...(await meraajPkgIdentityFields(db, inbound.package_id)), // v3.76
        inbound_id: inbound.id,
        buyer_office_name: inbound.buyer_office_name,
        reason: reasonCR,
        rejected_at: new Date(),
      })
      return ok({ cancellation_rejected: true, reason: reasonCR, booking_status: 'approved' })
    }
    // v3.74 — ESCROW P2P: the office submits its POSITION + EVIDENCE on a buyer cancellation
    // request. NO financial/operational effect locally — the FINAL decision authority is the
    // Meraaj Super Admin (via meraaj.booking.cancellation_finalized). Contract-frozen event:
    // booking.cancellation.position. Available ONLY when meraaj_escrow_mode is ON.
    const cancPositionMatch = route.match(/^\/meraaj\/inbound-bookings\/([^/]+)\/cancellation\/position$/)
    if (cancPositionMatch && method === 'POST') {
      const permsCP = effectivePermissions(sess.user)
      if (sess.user.role !== 'owner' && !(permsCP.mod_meraaj && permsCP.can_refund)) return bad('غير مصرح — يتطلب صلاحية متجر معراج + صلاحية الاسترداد', 403)
      // Final cancellation authority is permanently centralized in Meraaj Super Admin.
      // Rahal offices may submit a position/evidence regardless of the legacy escrow toggle.
      const bCP = await request.json()
      const positionVal = String(bCP.position || '').trim()
      if (!['no_objection', 'objection'].includes(positionVal)) return bad('الموقف إلزامي: no_objection أو objection')
      // sanitize executed services + evidence references (documents for the Super Admin decision)
      const svcTypes = ['visa', 'ticket', 'hotel', 'transport', 'other']
      const svcStatuses = ['issued', 'used', 'partially_used', 'refundable', 'non_refundable']
      const services = (Array.isArray(bCP.executed_services) ? bCP.executed_services : []).slice(0, 30).map(s => ({
        type: svcTypes.includes(s?.type) ? s.type : 'other',
        status: svcStatuses.includes(s?.status) ? s.status : 'issued',
        ref: String(s?.ref || '').slice(0, 120),
        cost: Math.max(0, +(Number(s?.cost) || 0).toFixed(2)),
        currency: String(s?.currency || '').slice(0, 8) || null,
        note: String(s?.note || '').slice(0, 300),
        evidence: (Array.isArray(s?.evidence) ? s.evidence : []).slice(0, 10).map(ev73 => ({
          kind: ev73?.kind === 'file_ref' ? 'file_ref' : 'url',
          value: String(ev73?.value || '').slice(0, 500),
          label: String(ev73?.label || '').slice(0, 120),
        })).filter(ev73 => ev73.value),
      }))
      const costsTotal = +services.reduce((s, x) => s + x.cost, 0).toFixed(2) // authoritative server-side sum
      // v3.77 — evidence file_ref values MUST be real booking_documents of THIS tenant + THIS booking
      // (context cancellation_evidence or traveler). Invalid refs = hard 400 (evidence integrity).
      const fileRefIds = services.flatMap(s => s.evidence.filter(ev => ev.kind === 'file_ref').map(ev => ev.value))
      let fileRefDocs = []
      if (fileRefIds.length > 0) {
        fileRefDocs = await db.collection('booking_documents').find({ id: { $in: fileRefIds }, tenant_id: T, inbound_id: cancPositionMatch[1] }).toArray()
        const foundIds = new Set(fileRefDocs.map(d => d.id))
        const missing = fileRefIds.filter(idf => !foundIds.has(idf))
        if (missing.length > 0) return bad(`مرجع ملف دليل غير صالح أو لا يخص هذا الحجز: ${missing[0]}`, 400)
      }
      const notesCP = String(bCP.notes || '').slice(0, 1000)
      const actorNameCP = sess.user.name || sess.user.email
      const nowCP = new Date()
      // ATOMIC single-position claim: requested → position_submitted
      const inbound = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
        { id: cancPositionMatch[1], tenant_id: T, status: 'approved', cancellation_status: 'requested' },
        {
          $set: {
            cancellation_status: 'position_submitted',
            meraaj_cancellation_position: { position: positionVal, executed_services: services, actual_costs_total: costsTotal, notes: notesCP, submitted_by: actorNameCP, submitted_role: sess.user.role, submitted_at: nowCP },
          },
          $push: { history: { at: nowCP, action: 'position_submitted', actor: actorNameCP, note: `${positionVal === 'objection' ? 'اعتراض' : 'لا اعتراض'} — تكاليف منفذة ${costsTotal}` } },
        },
      )
      if (!inbound) {
        const cur = await db.collection('meraaj_inbound_bookings').findOne({ id: cancPositionMatch[1], tenant_id: T })
        if (!cur) return bad('الحجز الوارد غير موجود', 404)
        return bad(cur.cancellation_status === 'position_submitted' ? 'الموقف مُقدَّم مسبقاً — بانتظار قرار إدارة معراج' : 'لا يوجد طلب إلغاء معلق على هذا الحجز', 409)
      }
      await emitMeraajEvent(db, T, 'booking.cancellation.position', {
        booking_ref: inbound.meraaj_booking_ref,
        package_ref: inbound.package_id,
        ...(await meraajPkgIdentityFields(db, inbound.package_id)), // v3.76
        inbound_id: inbound.id,
        position: positionVal,
        // v3.77 — outbound evidence enrichment: file_ref entries carry a signed, expiring
        // download_url (72h) so the Meraaj Super Admin can open the actual file securely.
        executed_services: services.map(s => ({
          ...s,
          evidence: s.evidence.map(ev => {
            if (ev.kind !== 'file_ref') return ev
            const d = fileRefDocs.find(x => x.id === ev.value)
            // v3.77.1 — per-file evidence type (visa/ticket/hotel/receipt/other) per contract
            return { ...ev, type: d?.evidence_type || 'other', download_url: docSignedUrl(ev.value), filename: d?.filename || null, content_type: d?.content_type || null }
          }),
        })),
        actual_costs_total: costsTotal,
        costs_currency: inbound.currency,
        notes: notesCP,
        submitted_by: actorNameCP,
        submitted_role: sess.user.role,
        submitted_at: nowCP,
      })
      return ok({ position_submitted: true, position: positionVal, actual_costs_total: costsTotal, awaiting: 'meraaj_super_admin_decision' })
    }
    // v3.27 — WhatsApp sales log (Mini CRM): record every marketing message sent
    if (route === '/whatsapp-logs' && method === 'POST') {
      const b = await request.json()
      const doc = {
        id: uuidv4(), tenant_id: T,
        package_id: b.package_id || null,
        package_name: String(b.package_name || '').slice(0, 120),
        phone: String(b.phone || '').replace(/[^0-9+]/g, '').slice(0, 20),
        customer_name: String(b.customer_name || '').trim().slice(0, 80),
        message_preview: String(b.message || '').slice(0, 500),
        sent_by: sess.user.name || sess.user.email || '',
        status: 'sent', // sent | interested | booked | no_answer
        notes: '',
        created_at: new Date(),
      }
      await db.collection('whatsapp_logs').insertOne(doc)
      const { _id, ...rest } = doc
      return ok(rest)
    }
    if (route === '/whatsapp-logs' && method === 'GET') {
      const url = new URL(request.url)
      const q = { ...tf }
      const pid = url.searchParams.get('package_id')
      if (pid) q.package_id = pid
      return ok(clean(await db.collection('whatsapp_logs').find(q).sort({ created_at: -1 }).limit(300).toArray()))
    }
    // v3.28 — Sales performance per employee (conversion rates)
    if (route === '/whatsapp-logs/performance' && method === 'GET') {
      const url = new URL(request.url)
      const month = url.searchParams.get('month') // YYYY-MM (optional; default = current month)
      let start, end
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split('-').map(Number)
        start = new Date(y, m - 1, 1); end = new Date(y, m, 1)
      } else {
        const now = new Date()
        start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      }
      const logs = await db.collection('whatsapp_logs').find({ tenant_id: T, created_at: { $gte: start, $lt: end } }).toArray()
      const byEmp = {}
      for (const l of logs) {
        const emp = l.sent_by || 'غير معروف'
        byEmp[emp] = byEmp[emp] || { employee: emp, sent_total: 0, interested: 0, booked: 0, no_answer: 0, pending: 0 }
        byEmp[emp].sent_total++
        if (l.status === 'interested') byEmp[emp].interested++
        else if (l.status === 'booked') byEmp[emp].booked++
        else if (l.status === 'no_answer') byEmp[emp].no_answer++
        else byEmp[emp].pending++
      }
      const rows = Object.values(byEmp).map(r => ({ ...r, conversion_rate: r.sent_total > 0 ? +((r.booked / r.sent_total) * 100).toFixed(1) : 0 }))
        .sort((a, b) => b.booked - a.booked || b.sent_total - a.sent_total)
      const totals = rows.reduce((s, r) => ({ sent_total: s.sent_total + r.sent_total, booked: s.booked + r.booked, interested: s.interested + r.interested, no_answer: s.no_answer + r.no_answer }), { sent_total: 0, booked: 0, interested: 0, no_answer: 0 })
      totals.conversion_rate = totals.sent_total > 0 ? +((totals.booked / totals.sent_total) * 100).toFixed(1) : 0
      return ok({ month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, rows, totals })
    }
    // v3.28 — Follow-up reminders: 'interested' leads untouched for 2+ days
    if (route === '/whatsapp-logs/reminders' && method === 'GET') {
      const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      const logs = await db.collection('whatsapp_logs').find({ tenant_id: T, status: 'interested' }).sort({ created_at: 1 }).limit(100).toArray()
      const due = logs.filter(l => new Date(l.updated_at || l.created_at) <= cutoff)
      return ok({
        count: due.length,
        logs: clean(due).map(l => ({ id: l.id, customer_name: l.customer_name, phone: l.phone, package_name: l.package_name, sent_by: l.sent_by, last_touch: l.updated_at || l.created_at })),
      })
    }
    const waLogMatch = route.match(/^\/whatsapp-logs\/([^/]+)$/)
    if (waLogMatch && method === 'PATCH') {
      const b = await request.json()
      const upd = {}
      if (b.status !== undefined && ['sent', 'interested', 'booked', 'no_answer'].includes(b.status)) upd.status = b.status
      if (b.notes !== undefined) upd.notes = String(b.notes || '').slice(0, 300)
      if (b.customer_name !== undefined) upd.customer_name = String(b.customer_name || '').trim().slice(0, 80)
      if (Object.keys(upd).length === 0) return bad('لا توجد تعديلات')
      upd.updated_at = new Date()
      const r = await db.collection('whatsapp_logs').updateOne({ id: waLogMatch[1], tenant_id: T }, { $set: upd })
      if (!r.matchedCount) return bad('السجل غير موجود', 404)
      return ok({ success: true })
    }
    if (waLogMatch && method === 'DELETE') {
      await db.collection('whatsapp_logs').deleteOne({ id: waLogMatch[1], tenant_id: T })
      return ok({ deleted: true })
    }
    // v3.26 — Partners monthly summary: earned vs settled vs outstanding per partner per currency
    if (route === '/partners/summary' && method === 'GET') {
      const q = { tenant_id: T, commission_share_amount: { $gt: 0 }, commission_partner_id: { $ne: null } }
      const [tickets, visas, services, bookings] = await Promise.all([
        db.collection('tickets').find(q).toArray(),
        db.collection('visas').find(q).toArray(),
        db.collection('services').find(q).toArray(),
        db.collection('package_bookings').find(q).toArray(),
      ])
      const partners = {}
      for (const d of [...tickets, ...visas, ...services, ...bookings]) {
        const pid = d.commission_partner_id
        const cur = d.currency || 'USD'
        partners[pid] = partners[pid] || { partner_id: pid, partner_name: d.commission_partner_name || '', partner_type: d.commission_partner_type || 'client', currencies: {}, ops_count: 0 }
        partners[pid].currencies[cur] = partners[pid].currencies[cur] || { earned: 0, settled: 0, outstanding: 0 }
        partners[pid].currencies[cur].earned += Number(d.commission_share_amount) || 0
        partners[pid].ops_count++
        if (!partners[pid].partner_name && d.commission_partner_name) partners[pid].partner_name = d.commission_partner_name
      }
      const settledStmts = await db.collection('partner_statements').find({ tenant_id: T, settlement_voucher_id: { $ne: null } }).toArray()
      for (const s of settledStmts) {
        if (!partners[s.partner_id]) continue
        const cur = s.settled_currency
        if (!cur) continue
        partners[s.partner_id].currencies[cur] = partners[s.partner_id].currencies[cur] || { earned: 0, settled: 0, outstanding: 0 }
        partners[s.partner_id].currencies[cur].settled += Number(s.settled_amount) || 0
      }
      const out = Object.values(partners).map(p => {
        for (const cur of Object.keys(p.currencies)) {
          const c = p.currencies[cur]
          c.earned = +c.earned.toFixed(2)
          c.settled = +c.settled.toFixed(2)
          c.outstanding = +(c.earned - c.settled).toFixed(2)
        }
        p.has_outstanding = Object.values(p.currencies).some(c => c.outstanding > 0.009)
        return p
      }).sort((a, b) => (b.has_outstanding ? 1 : 0) - (a.has_outstanding ? 1 : 0))
      return ok({ partners: out, count: out.length })
    }
    // Outbox / sync log
    if (route === '/meraaj/events' && method === 'GET') {
      return ok(clean(await db.collection('meraaj_events').find(tf).sort({ created_at: -1 }).limit(100).toArray()))
    }
    // v3.66 — RETRY ALL FAILED (owner): processes failed outbound events in controlled order
    // (oldest first) in small batches; the frontend loops until remaining=0 showing live progress.
    // Same idempotency as single retry: SAME event id re-sent, SAME doc updated, no new docs.
    // A failure in one event never stops the rest (per-event try/catch).
    if (route === '/meraaj/events/retry-all-failed' && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const retryUrl = process.env.MERAAJ_WEBHOOK_URL || (meraajApiBase() ? `${meraajApiBase()}/api/integrations/rahal/webhooks` : '')
      if (!retryUrl || !meraajSecret()) return bad('رابط معراج غير مُهيأ — أضف MERAAJ_API_BASE_URL ثم أعد المحاولة')
      const b = await request.json().catch(() => ({}))
      const limit = Math.min(20, Math.max(1, parseInt(b.limit, 10) || 5))
      // v3.66b — progress cursor: guarantees each failed event is attempted EXACTLY ONCE per run
      // (in order), even when deliveries keep failing — batches never re-fetch already-tried docs.
      const after = b.after ? new Date(b.after) : null
      const failedQ = { ...tf, status: 'failed' }
      if (after && !isNaN(after.getTime())) failedQ.created_at = { $gt: after }
      const totalFailed = await db.collection('meraaj_events').countDocuments({ ...tf, status: 'failed' })
      const batch = await db.collection('meraaj_events').find(failedQ).sort({ created_at: 1 }).limit(limit).toArray()
      const results = []
      let succeeded = 0, failed = 0
      for (const ev of batch) {
        const attempts = (Number(ev.attempts) || 0) + 1
        try {
          const body = JSON.stringify({ id: ev.id, type: ev.type, timestamp: Math.floor(Date.now() / 1000), data: ev.payload })
          const res = await fetch(retryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Rahal-Signature': meraajSign(body) },
            body,
            signal: AbortSignal.timeout(6000),
          })
          if (res.ok) {
            await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { status: 'sent', sent_at: new Date(), attempts, last_error: null } })
            succeeded++
            results.push({ id: ev.id, type: ev.type, status: 'sent', attempts })
          } else {
            await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { attempts, last_error: `HTTP ${res.status}` } })
            failed++
            results.push({ id: ev.id, type: ev.type, status: 'failed', attempts, last_error: `HTTP ${res.status}` })
          }
        } catch (e) {
          const le = String(e.message || e).slice(0, 200)
          await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { attempts, last_error: le } })
          failed++
          results.push({ id: ev.id, type: ev.type, status: 'failed', attempts, last_error: le })
        }
      }
      const remaining = await db.collection('meraaj_events').countDocuments({ ...tf, status: 'failed' })
      const cursor = batch.length > 0 ? new Date(batch[batch.length - 1].created_at).toISOString() : null // v3.66b
      return ok({ total: totalFailed, processed: batch.length, succeeded, failed, remaining, cursor, results })
    }
    // v3.65 — ONE-TAP RETRY of a failed/pending outbound event (owner only). IDEMPOTENT BY DESIGN:
    // re-sends the SAME event id in the body (Meraaj dedups inbound by event id) and NEVER creates
    // a new event document — only status/attempts/last_error are updated on the existing doc.
    // emitMeraajEvent and webhook processing logic are untouched.
    const evtRetryMatch = route.match(/^\/meraaj\/events\/([^/]+)\/retry$/)
    if (evtRetryMatch && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const ev = await db.collection('meraaj_events').findOne({ id: evtRetryMatch[1], tenant_id: T })
      if (!ev) return bad('الحدث غير موجود', 404)
      if (ev.status === 'sent') return bad('الحدث مُرسل مسبقاً — لا حاجة لإعادة المحاولة')
      const retryUrl = process.env.MERAAJ_WEBHOOK_URL || (meraajApiBase() ? `${meraajApiBase()}/api/integrations/rahal/webhooks` : '')
      if (!retryUrl || !meraajSecret()) return bad('رابط معراج غير مُهيأ — أضف MERAAJ_API_BASE_URL ثم أعد المحاولة')
      const attempts = (Number(ev.attempts) || 0) + 1
      try {
        const ts = Math.floor(Date.now() / 1000)
        const body = JSON.stringify({ id: ev.id, type: ev.type, timestamp: ts, data: ev.payload })
        const res = await fetch(retryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Rahal-Signature': meraajSign(body) },
          body,
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { status: 'sent', sent_at: new Date(), attempts, last_error: null } })
          return ok({ status: 'sent', attempts })
        }
        await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { status: 'failed', attempts, last_error: `HTTP ${res.status}` } })
        return ok({ status: 'failed', attempts, last_error: `HTTP ${res.status}` })
      } catch (e) {
        const le = String(e.message || e).slice(0, 200)
        await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { status: 'failed', attempts, last_error: le } })
        return ok({ status: 'failed', attempts, last_error: le })
      }
    }
    // v3.57 — WEBHOOK HEALTH DASHBOARD (owner only): latest accepted/rejected inbound webhooks
    // + outbound sync events so the office spots Meraaj sync problems instantly.
    // READ-ONLY: does not touch webhook processing logic. Rejected log entries are global
    // (tenant can't be resolved on a bad signature) — payloads parseable to ANOTHER tenant's
    // package are excluded, and raw body content is never returned (only parsed type/refs).
    if (route === '/meraaj/webhook-health' && method === 'GET') {
      if (sess.user.role !== 'owner') return bad('غير مصرح — لوحة صحة المزامنة للمالك فقط', 403)
      const nowMs = Date.now()
      const h24 = new Date(nowMs - 24 * 3600 * 1000)
      const d7 = new Date(nowMs - 7 * 24 * 3600 * 1000)
      // Accepted incoming = this tenant's inbound bookings (each = an accepted booking webhook)
      const incoming = await db.collection('meraaj_inbound_bookings').find(tf).sort({ created_at: -1 }).limit(15).toArray()
      const accepted24 = await db.collection('meraaj_inbound_bookings').countDocuments({ ...tf, created_at: { $gte: h24 } })
      const accepted7d = await db.collection('meraaj_inbound_bookings').countDocuments({ ...tf, created_at: { $gte: d7 } })
      // Rejected webhooks (diagnostic log written on invalid HMAC)
      const rawRejected = await db.collection('meraaj_webhook_log').find({ ok: false }).sort({ at: -1 }).limit(60).toArray()
      const refs = []
      const parsedRej = rawRejected.map(w => {
        let p = null
        try { p = JSON.parse(w.body_head) } catch {}
        const ref = p?.data?.package_ref ? String(p.data.package_ref) : null
        if (ref) refs.push(ref)
        return { w, type: p?.type || null, booking_ref: p?.data?.booking_ref ? String(p.data.booking_ref).slice(0, 60) : null, package_ref: ref }
      })
      const refPkgs = refs.length ? await db.collection('packages').find({ id: { $in: refs } }).project({ id: 1, tenant_id: 1, name: 1 }).toArray() : []
      const refMap = {}
      for (const rp of refPkgs) refMap[rp.id] = rp
      const rejected = parsedRej
        .filter(x => !x.package_ref || !refMap[x.package_ref] || refMap[x.package_ref].tenant_id === T)
        .slice(0, 15)
        .map(x => ({ id: x.w.id, at: x.w.at, reason: x.w.reason || 'unknown', has_signature: !!x.w.has_signature, event_type: x.type, booking_ref: x.booking_ref, package_name: (x.package_ref && refMap[x.package_ref]) ? refMap[x.package_ref].name : null }))
      const rejected24 = await db.collection('meraaj_webhook_log').countDocuments({ ok: false, at: { $gte: h24 } })
      const rejected7d = await db.collection('meraaj_webhook_log').countDocuments({ ok: false, at: { $gte: d7 } })
      // Outbound sync events (outbox)
      const outboundDocs = await db.collection('meraaj_events').find(tf).sort({ created_at: -1 }).limit(15).toArray()
      const outboundFailed24 = await db.collection('meraaj_events').countDocuments({ ...tf, status: 'failed', created_at: { $gte: h24 } })
      const outboundFailedTotal = await db.collection('meraaj_events').countDocuments({ ...tf, status: 'failed' }) // v3.65
      // v3.60 — 7-day accepted vs rejected trend (per calendar day, oldest→newest)
      const dayKey = (d) => new Date(d).toISOString().slice(0, 10)
      const trendMap = {}
      for (let i = 6; i >= 0; i--) {
        const d = new Date(nowMs - i * 24 * 3600 * 1000)
        trendMap[dayKey(d)] = { date: dayKey(d), accepted: 0, rejected: 0 }
      }
      const acc7 = await db.collection('meraaj_inbound_bookings').find({ ...tf, created_at: { $gte: d7 } }).project({ created_at: 1 }).toArray()
      for (const a of acc7) { const k = dayKey(a.created_at); if (trendMap[k]) trendMap[k].accepted++ }
      const rej7docs = await db.collection('meraaj_webhook_log').find({ ok: false, at: { $gte: d7 } }).project({ at: 1 }).toArray()
      for (const rj of rej7docs) { const k = dayKey(rj.at); if (trendMap[k]) trendMap[k].rejected++ }
      const trend = Object.values(trendMap)
      // v3.60 — Buyer office insights: which Meraaj offices book the most (all-time, top 10 by revenue)
      const allInbound = await db.collection('meraaj_inbound_bookings').find(tf).project({ buyer_office_name: 1, seats: 1, total_price: 1, net_to_seller_total: 1, status: 1, currency: 1, created_at: 1 }).toArray()
      const buyerMap = {}
      for (const b of allInbound) {
        const key = (b.buyer_office_name || 'غير معروف').trim() || 'غير معروف'
        buyerMap[key] = buyerMap[key] || { office: key, bookings: 0, approved: 0, seats: 0, revenue: 0, net_to_seller: 0, currency: b.currency || '', last_at: null }
        const bm = buyerMap[key]
        bm.bookings++
        if (b.status === 'approved') bm.approved++
        if (b.status !== 'rejected' && b.status !== 'cancelled') {
          bm.seats += Number(b.seats) || 0
          bm.revenue += Number(b.total_price) || 0
          bm.net_to_seller += Number(b.net_to_seller_total) || 0
        }
        if (!bm.last_at || new Date(b.created_at) > new Date(bm.last_at)) bm.last_at = b.created_at
      }
      const buyers = Object.values(buyerMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
        .map(b => ({ ...b, revenue: +b.revenue.toFixed(2), net_to_seller: +b.net_to_seller.toFixed(2) }))
      // v3.63 — attach owner rating tags to buyer offices
      const tagDocs = await db.collection('meraaj_office_tags').find(tf).toArray()
      const tagMap = {}
      for (const t of tagDocs) tagMap[t.office] = t.tag
      for (const b of buyers) b.tag = tagMap[b.office] || ''
      return ok({
        stats: {
          accepted_24h: accepted24, accepted_7d: accepted7d,
          rejected_24h: rejected24, rejected_7d: rejected7d,
          outbound_failed_24h: outboundFailed24,
          outbound_failed_total: outboundFailedTotal, // v3.65
          last_accepted_at: incoming[0]?.created_at || null,
          last_rejected_at: rawRejected[0]?.at || null,
        },
        incoming: incoming.map(b => ({ id: b.id, at: b.created_at, package_name: b.package_name, buyer_office_name: b.buyer_office_name, seats: b.seats, total_price: b.total_price, currency: b.currency, status: b.status, price_check: b.price_check || 'not_sent', booking_ref: b.meraaj_booking_ref || null })),
        rejected,
        outbound: outboundDocs.map(ev => ({ id: ev.id, at: ev.created_at, type: ev.type, status: ev.status, attempts: ev.attempts ?? null, last_error: ev.last_error ? String(ev.last_error).slice(0, 140) : null })),
        trend, // v3.60 — [{date, accepted, rejected}] × 7 days
        buyers, // v3.60 — top buyer offices by revenue
      })
    }

    // Tenant Users
    if (route === '/tenant/users' && method === 'GET') {
      if (sess.user.role !== 'owner') return bad('غير مصرح', 403)
      const users = await db.collection('users').find(tf).sort({ created_at: 1 }).toArray()
      return ok(users.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, role_key: u.role_key || null, active: u.active, created_at: u.created_at, default_box_id: u.default_box_id || null, lock_box: !!u.lock_box, allowed_box_ids: Array.isArray(u.allowed_box_ids) ? u.allowed_box_ids : [], permissions: u.role === 'owner' ? ownerPermissions() : { ...DEFAULT_STAFF_PERMISSIONS, ...(u.permissions || {}) } })))
    }
    if (route === '/tenant/users' && method === 'POST') {
      if (sess.user.role !== 'owner') return bad('غير مصرح', 403)
      const b = await request.json()
      if (!b.name || !String(b.name).trim()) return bad('اسم الموظف مطلوب') // v3.88.4 — S-002: field-specific validation
      if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) return bad('البريد الإلكتروني غير صالح — مثال: name@example.com')
      if (!b.password || String(b.password).length < 6) return bad('كلمة المرور يجب ألا تقل عن 6 أحرف')
      // v2.8 gold-only gate → v4.0.1 REMOVED: self-creating users is now allowed for ALL
      // tiers (silver/gold/enterprise/trial). The ONLY server gate is max_users — the value
      // the Super Admin set (plan default or per-office override). Owner counts within it.
      const count = await db.collection('users').countDocuments(tf)
      const maxUsers = sess.tenant.max_users
      if (maxUsers !== null && maxUsers !== undefined && count >= maxUsers) return bad(`تم الوصول إلى الحد الأقصى للمستخدمين (${maxUsers}). تواصل مع الإدارة لرفع الحد.`)
      if (await db.collection('users').findOne({ email: String(b.email).toLowerCase().trim() })) return bad('البريد مستخدم بالفعل')
      const doc = {
        id: uuidv4(), tenant_id: T, email: String(b.email).toLowerCase().trim(), name: b.name,
        role: b.role || 'staff', active: true, password_hash: bcrypt.hashSync(b.password, 8),
        // v3.4 — Default limited permissions on new employees
        permissions: b.permissions ? { ...DEFAULT_STAFF_PERMISSIONS, ...b.permissions } : { ...DEFAULT_STAFF_PERMISSIONS },
        // v3.9.9 — Optional default cash box + lock flag for the employee/cashier
        default_box_id: b.default_box_id || null,
        lock_box: !!b.lock_box,
        created_at: new Date(),
      }
      await db.collection('users').insertOne(doc)
      return ok({ id: doc.id, email: doc.email, name: doc.name, role: doc.role, active: doc.active, permissions: doc.permissions, default_box_id: doc.default_box_id, lock_box: doc.lock_box })
    }
    const userIdMatch = route.match(/^\/tenant\/users\/([^/]+)$/)
    if (userIdMatch && method === 'PATCH') {
      if (sess.user.role !== 'owner') return bad('غير مصرح', 403)
      const b = await request.json()
      const upd = {}
      if (b.active !== undefined) upd.active = !!b.active
      if (b.role) upd.role = b.role
      if (b.name) upd.name = b.name
      if (b.password) upd.password_hash = bcrypt.hashSync(b.password, 8)
      // v3.4 — Permission update
      if (b.permissions && typeof b.permissions === 'object') {
        const sanitized = {}
        for (const k of Object.keys(DEFAULT_STAFF_PERMISSIONS)) sanitized[k] = !!b.permissions[k]
        upd.permissions = sanitized
      }
      // v3.45 — RBAC role template key (display/reference; actual access = permissions object)
      if (b.role_key !== undefined) upd.role_key = String(b.role_key || '')
      // v3.51 — RBAC Phase 3: allowed boxes restriction (empty array = all boxes allowed)
      if (b.allowed_box_ids !== undefined) {
        upd.allowed_box_ids = (Array.isArray(b.allowed_box_ids) ? b.allowed_box_ids : []).map(x => String(x)).slice(0, 50)
      }
      // v3.9.9 — Update default box + lock flag
      if (b.default_box_id !== undefined) upd.default_box_id = b.default_box_id || null
      if (b.lock_box !== undefined) upd.lock_box = !!b.lock_box
      await db.collection('users').updateOne({ id: userIdMatch[1], tenant_id: T }, { $set: upd })
      return ok({ success: true })
    }
    if (userIdMatch && method === 'DELETE') {
      if (sess.user.role !== 'owner') return bad('غير مصرح', 403)
      const target = await db.collection('users').findOne({ id: userIdMatch[1], tenant_id: T })
      if (!target) return bad('المستخدم غير موجود', 404)
      if (target.role === 'owner') return bad('لا يمكن حذف حساب المالك')
      await db.collection('users').deleteOne({ id: userIdMatch[1], tenant_id: T })
      return ok({ success: true })
    }

    // v2.8 — Public plans list for the "Out of Quota" top-up modal
    if (route === '/plans' && method === 'GET') {
      const list = await db.collection('subscription_plans').find({ active: { $ne: false } }).toArray()
      return ok(list.map(p => ({ ...p, _id: undefined })))
    }

    // v3.14 — Pricing config (6-tier: silver/gold/enterprise × installments/annual)
    // Returns config with server-computed final prices based on the flexible discount.
    if (route === '/pricing' && method === 'GET') {
      const cfg = await getPricingConfig(db)
      // v4.0 — offer window: when start/end dates are set, the discount only applies inside them
      const nowP = new Date()
      const inWindow = (!cfg.offer_start_at || new Date(cfg.offer_start_at) <= nowP) && (!cfg.offer_end_at || nowP <= new Date(cfg.offer_end_at))
      const disc = (cfg.discount_enabled && inWindow) ? Math.min(95, Math.max(0, Number(cfg.discount_percent) || 0)) : 0
      const n = Number(cfg.installments_count) || 5
      const plans = (cfg.plans || [])
        .filter(p => p.active !== false) // v4.0 — الباقات المعطلة لا تظهر للمشتركين
        .slice().sort((a, b2) => (Number(a.sort_order) || 0) - (Number(b2.sort_order) || 0)) // v4.0 — ترتيب الظهور
        .map(p => {
          const annualOriginal = Number(p.annual_price) || 0
          const annualFinal = Math.round(annualOriginal * (100 - disc)) / 100
          const instOriginal = Math.round((annualOriginal / n) * 100) / 100
          const instFinal = Math.round((annualFinal / n) * 100) / 100
          return {
            ...p,
            pricing: {
              currency: p.currency || 'USD', // v4.0
              annual: { original: annualOriginal, final: annualFinal, discount_value: Math.round((annualOriginal - annualFinal) * 100) / 100 }, // v4.0 — قيمة الخصم
              installment: { count: n, original_per: instOriginal, final_per: instFinal, total_final: annualFinal },
            },
          }
        })
      return ok({ discount_enabled: !!(cfg.discount_enabled && inWindow), discount_percent: disc, installments_count: n, offer_start_at: cfg.offer_start_at || null, offer_end_at: cfg.offer_end_at || null, plans, current: { plan_tier: sess.tenant?.plan_tier || null, billing_mode: sess.tenant?.billing_mode || null, unlimited: isUnlimitedTenant(sess.tenant) } })
    }

    // v2.8 → v3.94 — Active announcements for tenant popup + banner
    // Targeting is now enforced in the BACKEND (audience: all/tenants/plan/sub_status)
    // via lib/adminAds.js — legacy docs without audience keep showing to everyone.
    if (route === '/announcements/active' && method === 'GET') {
      return ok(await activeAnnouncementsFor(db, sess.tenant))
    }

    // Rates (per-tenant)
    if (route === '/rates' && method === 'GET') {
      const s = await db.collection('tenant_settings').findOne(tf)
      return ok({ rates: s?.rates || DEFAULT_RATES, updated_at: s?.updated_at })
    }

    // ============ REFERRALS ============
    if (route === '/referrals' && method === 'GET') {
      const code = await ensureReferralCode(db, T)
      const t = await db.collection('tenants').findOne({ id: T })
      const invitees = await db.collection('tenants').find({ referred_by: T }).sort({ created_at: -1 }).toArray()
      return ok({
        code, link_hint: `/signup?ref=${code}`,
        stats: t.referral_stats || { signups: 0, activations: 0, bonus_earned: 0 },
        invitees: invitees.map(x => ({
          id: x.id, name: x.name, slug: x.slug, created_at: x.created_at,
          subscription: x.subscription || 'trial',
          activation_confirmed: !!x.activation_confirmed,
          bonus_status: x.activation_confirmed ? 'activated_+50' : 'signup_+15',
        })),
      })
    }

    // ============ v3.4 — AFFILIATE MODULE (Marketing + Cash Balance) ============
    if (route === '/affiliate' && method === 'GET') {
      const code = await ensureReferralCode(db, T)
      const t = await db.collection('tenants').findOne({ id: T })
      const affiliate = t.affiliate || { balance_usd: 0, total_earned_usd: 0, total_withdrawn_usd: 0, commission_rate: AFFILIATE_COMMISSION_RATE, is_individual: false }
      // v3.9.18 — Always use official domain for affiliate links (never expose Emergent preview URLs)
      // v3.88.4 — DEP-002: environment-aware referral origin — the Test server must never
      // emit links pointing at Live. Derived from the request host; Live/preview keep the
      // official domain (preview links are ephemeral, official is the safe default there).
      const _refHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
      const _refProto = request.headers.get('x-forwarded-proto') || 'https'
      const _refOrigin = /rahaal-test/.test(_refHost) ? `${_refProto}://${_refHost}` : 'https://rahaal.targetmediagrp.com'
      const link = `${_refOrigin}/signup?ref=${code}`
      const invitees = await db.collection('tenants').find({ referred_by: T }).sort({ created_at: -1 }).toArray()
      const activated = invitees.filter(x => x.activation_confirmed).length
      const withdrawals = await db.collection('cashout_requests').find({ tenant_id: T }).sort({ created_at: -1 }).limit(20).toArray()
      const payoutMethods = await db.collection('payout_methods').find({ tenant_id: T }).sort({ created_at: -1 }).toArray()
      const minCashout = affiliate.is_individual ? AFFILIATE_MIN_CASHOUT_INDIVIDUAL : AFFILIATE_MIN_CASHOUT_OFFICE
      // Marketing banners/texts (bundled here for simplicity)
      const banners = [
        {
          id: 'b1', title: 'برنامج رحّال للمحاسبة السحابية',
          headline: '🚀 أدر مكتب سفرك من مكان واحد — بدون أوراق!',
          body: 'نظام رحّال يحوّل مكتب سفرك إلى مكتب رقمي: تذاكر، تأشيرات، حسابات، كشوف عملاء، وطباعة قسائم — كل ذلك بلمسة زر. جرّبه مجاناً!',
          cta: 'ابدأ تجربتك المجانية الآن',
        },
        {
          id: 'b2', title: 'العرض التسويقي — للتواصل السريع',
          headline: '📊 كل ما يحتاجه مكتب السفريات في نظام واحد',
          body: 'رحّال ERP: حجز التذاكر (جوي/بري) + التأشيرات + الخدمات + محاسبة متعددة العملات (YER/SAR/USD) + قوالب واتساب ذكية + كشوف حسابات احترافية.',
          cta: 'اطلب عرضك الآن',
        },
      ]
      return ok({
        code, link,
        balance_usd: affiliate.balance_usd || 0,
        total_earned_usd: affiliate.total_earned_usd || 0,
        total_withdrawn_usd: affiliate.total_withdrawn_usd || 0,
        commission_rate: affiliate.commission_rate || AFFILIATE_COMMISSION_RATE,
        min_cashout_usd: minCashout,
        is_individual: !!affiliate.is_individual,
        referred_offices: invitees.length,
        activated_offices: activated,
        pending_offices: invitees.length - activated,
        withdrawals: withdrawals.map(w => ({ ...w, _id: undefined })),
        payout_methods: payoutMethods.map(m => ({ ...m, _id: undefined })),
        banners,
      })
    }

    if (route === '/affiliate/payout-methods' && method === 'GET') {
      const list = await db.collection('payout_methods').find({ tenant_id: T }).sort({ created_at: -1 }).toArray()
      return ok(list.map(m => ({ ...m, _id: undefined })))
    }
    if (route === '/affiliate/payout-methods' && method === 'POST') {
      const b = await request.json()
      if (!b.method_type || !b.account_name) return bad('نوع طريقة السحب واسم صاحب الحساب مطلوبان')
      const allowed = ['bank', 'wallet', 'local_remittance']
      if (!allowed.includes(b.method_type)) return bad('نوع طريقة السحب غير صالح')
      const doc = {
        id: uuidv4(), tenant_id: T,
        method_type: b.method_type,             // 'bank' | 'wallet' | 'local_remittance'
        provider: b.provider || '',              // Bank name / Wallet name (Creami/Jawali/...) / Remittance (Al-Najm/Al-Ehtiyaz/...)
        account_name: String(b.account_name).trim(),
        account_number: b.account_number || '',  // IBAN or phone or ref
        phone: b.phone || '',
        city: b.city || '',
        is_default: !!b.is_default,
        notes: b.notes || '',
        created_at: new Date(),
      }
      if (doc.is_default) {
        await db.collection('payout_methods').updateMany({ tenant_id: T }, { $set: { is_default: false } })
      }
      await db.collection('payout_methods').insertOne(doc)
      const { _id, ...rest } = doc; return ok(rest)
    }
    const pmMatch = route.match(/^\/affiliate\/payout-methods\/([^/]+)$/)
    if (pmMatch && method === 'PUT') {
      const b = await request.json()
      const upd = {}
      for (const k of ['provider', 'account_name', 'account_number', 'phone', 'city', 'notes']) if (b[k] !== undefined) upd[k] = b[k]
      if (b.is_default !== undefined) {
        upd.is_default = !!b.is_default
        if (upd.is_default) {
          await db.collection('payout_methods').updateMany({ tenant_id: T }, { $set: { is_default: false } })
        }
      }
      await db.collection('payout_methods').updateOne({ id: pmMatch[1], tenant_id: T }, { $set: upd })
      return ok({ success: true })
    }
    if (pmMatch && method === 'DELETE') {
      await db.collection('payout_methods').deleteOne({ id: pmMatch[1], tenant_id: T })
      return ok({ success: true })
    }

    if (route === '/affiliate/cashout' && method === 'POST') {
      const b = await request.json()
      const t = await db.collection('tenants').findOne({ id: T })
      const affiliate = t.affiliate || { balance_usd: 0, is_individual: false }
      const minCashout = affiliate.is_individual ? AFFILIATE_MIN_CASHOUT_INDIVIDUAL : AFFILIATE_MIN_CASHOUT_OFFICE
      const amount = Number(b.amount_usd) || 0
      if (amount < minCashout) return bad(`الحد الأدنى للسحب هو ${minCashout} USD`)
      if (amount > (affiliate.balance_usd || 0)) return bad('الرصيد غير كافٍ')
      if (!b.payout_method_id) return bad('اختر طريقة السحب')
      const pm = await db.collection('payout_methods').findOne({ id: b.payout_method_id, tenant_id: T })
      if (!pm) return bad('طريقة السحب غير موجودة')
      const doc = {
        id: uuidv4(), tenant_id: T,
        amount_usd: amount,
        payout_method_id: pm.id,
        payout_method_snapshot: { method_type: pm.method_type, provider: pm.provider, account_name: pm.account_name, account_number: pm.account_number, phone: pm.phone },
        status: 'pending',            // pending → processing → paid | rejected
        notes: b.notes || '',
        requested_by: sess.user.email,
        created_at: new Date(),
      }
      await db.collection('cashout_requests').insertOne(doc)
      // Reserve funds
      await db.collection('tenants').updateOne({ id: T }, { $inc: { 'affiliate.balance_usd': -amount, 'affiliate.reserved_usd': amount } })
      const { _id, ...rest } = doc; return ok(rest)
    }

    if (route === '/affiliate/apply-to-subscription' && method === 'POST') {
      const b = await request.json()
      const amount = Number(b.amount_usd) || 0
      const t = await db.collection('tenants').findOne({ id: T })
      const affiliate = t.affiliate || { balance_usd: 0 }
      if (amount <= 0) return bad('أدخل مبلغاً صالحاً')
      if (amount > (affiliate.balance_usd || 0)) return bad('الرصيد غير كافٍ')
      // Deduct from affiliate, credit subscription
      await db.collection('tenants').updateOne({ id: T }, {
        $inc: { 'affiliate.balance_usd': -amount, 'affiliate.total_applied_to_subscription_usd': amount, subscription_credit_usd: amount },
      })
      // Log as a "virtual cashout" for history
      await db.collection('cashout_requests').insertOne({
        id: uuidv4(), tenant_id: T, amount_usd: amount, status: 'applied_to_subscription',
        notes: 'تم تحويل الرصيد لتغطية الاشتراك',
        payout_method_snapshot: { method_type: 'subscription', provider: 'Internal Credit' },
        requested_by: sess.user.email, created_at: new Date(),
      })
      return ok({ success: true, applied_usd: amount })
    }

    // v3.4 — TEST-ONLY endpoint (dev/testing convenience): seed affiliate balance
    // Guarded to the current tenant only. NOT exposed in production UI.
    if (route === '/affiliate/dev-seed-balance' && method === 'POST') {
      const b = await request.json()
      const amount = Number(b.amount_usd) || 100
      const isIndividual = !!b.is_individual
      await db.collection('tenants').updateOne({ id: T }, {
        $set: { 'affiliate.commission_rate': AFFILIATE_COMMISSION_RATE, 'affiliate.is_individual': isIndividual },
        $inc: { 'affiliate.balance_usd': amount, 'affiliate.total_earned_usd': amount },
      })
      return ok({ success: true, credited_usd: amount, is_individual: isIndividual })
    }

    // ============ v3.5 — REFUNDS / CANCELLATIONS ============
    // Reverses original transaction, then applies:
    //  - Supplier keeps supplier_penalty (retained from cost)
    //  - Office keeps office_fee (recorded as revenue 4104)
    //  - Client receives sale_price - supplier_penalty - office_fee
    if (route === '/refunds' && method === 'GET') {
      const list = await db.collection('refunds').find(tf).sort({ created_at: -1 }).limit(200).toArray()
      return ok(list.map(r => ({ ...r, _id: undefined })))
    }
    if (route === '/refunds' && method === 'POST') {
      const b = await request.json()
      const refType = b.ref_type
      if (!['ticket', 'visa', 'service'].includes(refType)) return bad('نوع السجل غير صالح')
      const coll = refType === 'ticket' ? 'tickets' : refType === 'visa' ? 'visas' : 'services'
      const orig = await db.collection(coll).findOne({ id: b.ref_id, tenant_id: T })
      if (!orig) return bad('السجل الأصلي غير موجود', 404)
      if (orig.is_refunded) return bad('هذا السجل تم استرداده مسبقاً')

      // v3.88.4 — F-010 ROOT-CAUSE REWRITE:
      //  • The ORIGINAL journal entry is KEPT (audit trail) — a real linked REVERSAL JE is created.
      //  • Zero-value refund journals are rejected — "Success" can never hide a no-op reversal.
      //  • Cash refunds no longer double-hit the box (old flow reversed the FULL sale from the
      //    box via reverseTransactionEffects and then deducted refund_to_client AGAIN).
      //  • Cached balances are updated by the exact NET deltas of the reversal JE (once).
      const supplierPenalty = Number(b.supplier_penalty) || 0
      const officeFee = Number(b.office_fee) || 0
      if (Number(b.supplier_penalty) < 0 || Number(b.office_fee) < 0) return bad('لا تُقبل قيم سالبة في غرامة المورد أو رسوم المكتب')
      const cur = orig.currency
      const cost = Number(orig.cost) || 0
      const sale = Number(orig.sale_price) || 0
      if (supplierPenalty > cost) return bad(`غرامة المورد (${supplierPenalty}) أكبر من تكلفة الحجز الأصلية (${cost})`)
      const commission = +(sale - cost).toFixed(2)
      const refundToClient = +(sale - supplierPenalty - officeFee).toFixed(2)
      if (refundToClient < 0) return bad('مجموع الغرامة ورسوم المكتب أكبر من قيمة البيع')

      const partnerShare = Number(orig.commission_share_amount) || 0
      const officeCommission = +(commission - partnerShare).toFixed(2)
      const supplierReturned = +(cost - supplierPenalty).toFixed(2)
      const wasCash = orig.payment_method === 'cash'
      const box = wasCash && orig.box_id ? await db.collection('boxes').findOne({ id: orig.box_id, tenant_id: T }) : null
      if (wasCash && !box) return bad('صندوق العملية الأصلية غير موجود — لا يمكن تنفيذ الاسترداد النقدي')

      // ---- Build the REVERSAL JE (posts to LEAF accounts — F-007) ----
      const refundJeLines = []
      if (refundToClient > 0) {
        if (wasCash) {
          refundJeLines.push({ account_code: partyLeafCode(box, box.type === 'cash' ? COA.CASHBOXES : COA.BANKS), account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: 0, credit: refundToClient })
        } else {
          const cliDoc = orig.client_id ? await db.collection('clients').findOne({ id: orig.client_id, tenant_id: T }) : null
          refundJeLines.push({ account_code: partyLeafCode(cliDoc, COA.CLIENTS), account_name: 'العملاء', party_type: 'client', party_id: orig.client_id, party_name: orig.client_name, debit: 0, credit: refundToClient })
        }
      }
      if (supplierReturned > 0) {
        const supDoc = await db.collection('suppliers').findOne({ id: orig.supplier_id, tenant_id: T })
        refundJeLines.push({ account_code: partyLeafCode(supDoc, COA.SUPPLIERS), account_name: 'الموردون', party_type: 'supplier', party_id: orig.supplier_id, party_name: orig.supplier_name, debit: supplierReturned, credit: 0 })
      }
      const revAccount = refType === 'ticket' ? COA.REV_TICKETS : refType === 'visa' ? COA.REV_VISAS : COA.REV_SERVICES
      if (officeCommission > 0) refundJeLines.push({ account_code: revAccount, account_name: 'عكس إيراد الحجز', party_type: 'revenue', party_id: null, party_name: 'عكس إيراد الحجز', debit: officeCommission, credit: 0 })
      else if (officeCommission < 0) refundJeLines.push({ account_code: revAccount, account_name: 'عكس إيراد الحجز', party_type: 'revenue', party_id: null, party_name: 'عكس إيراد الحجز', debit: 0, credit: Math.abs(officeCommission) })
      if (partnerShare > 0 && orig.commission_partner_id) {
        const pCol = orig.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
        const pDoc = await db.collection(pCol).findOne({ id: orig.commission_partner_id, tenant_id: T })
        refundJeLines.push({ account_code: partyLeafCode(pDoc, orig.commission_partner_type === 'supplier' ? COA.SUPPLIERS : COA.CLIENTS), account_name: 'شريك عمولة (عكس)', party_type: orig.commission_partner_type, party_id: orig.commission_partner_id, party_name: orig.commission_partner_name || 'شريك عمولة', debit: partnerShare, credit: 0 })
      }
      if (officeFee > 0) refundJeLines.push({ account_code: COA.REV_CANCEL_FEES, account_name: 'رسوم إلغاء واسترداد', party_type: 'revenue', party_id: null, party_name: 'رسوم استرداد', debit: 0, credit: officeFee })

      // Zero-value / unbalanced reversal guards
      const rDebit = +refundJeLines.reduce((s, l) => s + (l.debit || 0), 0).toFixed(2)
      const rCredit = +refundJeLines.reduce((s, l) => s + (l.credit || 0), 0).toFixed(2)
      if (refundJeLines.length === 0 || (rDebit === 0 && rCredit === 0)) return bad('لا يوجد أثر مالي للاسترداد — قيد استرداد بقيمة صفر مرفوض')
      if (Math.abs(rDebit - rCredit) > 0.01) return bad(`قيد الاسترداد غير متوازن (مدين ${rDebit} ≠ دائن ${rCredit}) — راجع بيانات الحجز الأصلي`)

      // ---- Cached balances: apply the exact same NET deltas — exactly ONCE ----
      if (wasCash) {
        if (refundToClient > 0) await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, cur, -refundToClient)
      } else if (orig.client_id && refundToClient > 0) {
        await updateBalance(db, 'clients', { id: orig.client_id, tenant_id: T }, cur, -refundToClient)
      }
      if (supplierReturned > 0) await updateBalance(db, 'suppliers', { id: orig.supplier_id, tenant_id: T }, cur, -supplierReturned)
      if (partnerShare > 0 && orig.commission_partner_id) {
        const pCol2 = orig.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
        await updateBalance(db, pCol2, { id: orig.commission_partner_id, tenant_id: T }, cur, +partnerShare)
      }

      const refundJe = await createJournalEntry(db, T, {
        date: new Date(b.date || Date.now()),
        description: `استرداد ${refType === 'ticket' ? 'تذكرة' : refType === 'visa' ? 'تأشيرة' : 'خدمة'} — ${orig.passenger_name || orig.beneficiary_name || orig.client_name}${b.reason ? ` (${b.reason})` : ''} — عكس مرتبط بالحركة الأصلية`,
        ref_type: 'refund', ref_id: orig.id, currency: cur, lines: refundJeLines,
      }, { skipQuota: true })

      // Mark original as refunded (soft) — original doc & JE stay for the audit trail
      await db.collection(coll).updateOne({ id: orig.id, tenant_id: T }, { $set: {
        is_refunded: true, status: 'refunded', refunded_at: new Date(), refunded_by: sess.user.email,
        refund_supplier_penalty: supplierPenalty, refund_office_fee: officeFee, refund_to_client: refundToClient,
        refund_reason: b.reason || '', refund_je_id: refundJe.id,
      } })

      // Store refund record
      const refundDoc = {
        id: uuidv4(), tenant_id: T, ref_type: refType, ref_id: orig.id,
        currency: cur, original_sale: sale, original_cost: cost,
        supplier_penalty: supplierPenalty, office_fee: officeFee, refund_to_client: refundToClient,
        client_id: orig.client_id, client_name: orig.client_name,
        supplier_id: orig.supplier_id, supplier_name: orig.supplier_name,
        passenger_name: orig.passenger_name || orig.beneficiary_name || '',
        reason: b.reason || '', notes: b.notes || '',
        payment_method: orig.payment_method, was_cash: wasCash,
        refund_je_id: refundJe.id, // v3.88.4 — F-010: audit link to the reversal JE
        date: new Date(b.date || Date.now()),
        created_by: sess.user.email, created_at: new Date(),
      }
      await db.collection('refunds').insertOne(refundDoc)
      const { _id, ...rest } = refundDoc
      return ok(rest)
    }

    // ============ v3.8 — PATs (Personal Access Tokens for Chrome Extension) ============
    if (route === '/pats' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const list = await db.collection('pats').find({ tenant_id: T }).sort({ created_at: -1 }).toArray()
      return ok(list.map(p => ({
        id: p.id, name: p.name, prefix: p.prefix,
        created_at: p.created_at, last_used_at: p.last_used_at || null,
        revoked_at: p.revoked_at || null,
      })))
    }
    if (route === '/pats' && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      if (sess.isPat) return bad('لا يمكن إنشاء PAT جديد باستخدام PAT — سجّل دخولاً من الواجهة', 403)
      const b = await request.json().catch(() => ({}))
      const name = String(b.name || '').trim() || 'إضافة المتصفح'
      const activeCount = await db.collection('pats').countDocuments({ tenant_id: T, revoked_at: null })
      if (activeCount >= 5) return bad('الحد الأقصى 5 رموز نشطة — احذف رمزاً قديماً أولاً')
      const token = generatePat()
      const doc = {
        id: uuidv4(), tenant_id: T, user_id: sess.user.id,
        name, token_hash: hashPat(token), prefix: token.slice(0, 16),
        created_at: new Date(), last_used_at: null, revoked_at: null,
      }
      await db.collection('pats').insertOne(doc)
      // Return the full token ONCE — client must copy immediately
      return ok({
        id: doc.id, name: doc.name, token, prefix: doc.prefix,
        created_at: doc.created_at,
        warning: 'انسخ الرمز الآن — لن يظهر مرة أخرى بعد إغلاق هذه النافذة',
      })
    }
    const patDelMatch = route.match(/^\/pats\/([^/]+)$/)
    if (patDelMatch && method === 'DELETE') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      await db.collection('pats').updateOne(
        { id: patDelMatch[1], tenant_id: T },
        { $set: { revoked_at: new Date() } }
      )
      return ok({ success: true })
    }

    // ============ v3.8 — SCRAPER INGEST (Chrome Extension endpoint) ============
    // Verifies PAT works, then routes to createTicket / createVisa based on doc_type.
    if (route === '/scraper/ping' && method === 'GET') {
      // v3.9.7 — Return usage/limit info for trial gating in the extension popup
      const isPaid = isUnlimitedTenant(sess.tenant)
      const used = sess.tenant?.scraper_usage?.count || 0
      const limit = 30
      return ok({
        ok: true, tenant: { id: T, name: sess.tenant?.name || null, plan: isPaid ? 'paid' : 'trial' },
        user: { id: sess.user.id, email: sess.user.email, role: sess.user.role },
        version: '3.9.28',
        extension_min_version: '1.4.0',
        usage: { plan: isPaid ? 'paid' : 'trial', used, limit: isPaid ? -1 : limit, remaining: isPaid ? -1 : Math.max(0, limit - used), unlimited: isPaid },
      })
    }
    if (route === '/scraper/ingest' && method === 'POST') {
      // v3.9.7 — enforce trial cap (30) for non-paid tenants
      const isPaidT = isUnlimitedTenant(sess.tenant)
      if (!isPaidT) {
        const usedT = sess.tenant?.scraper_usage?.count || 0
        if (usedT >= 30) return cors(NextResponse.json({
          error: 'انتهت قراءاتك المجانية (30/30). يرجى ترقية الباقة من نظام رحّال للاستخدام غير المحدود.',
          quota_exceeded: true,
          usage: { plan: 'trial', unlimited: false, used: usedT, limit: 30, remaining: 0 },
        }, { status: 402 }))
      }
      const b = await request.json()
      const traveler = b.traveler || {}
      const booking = b.booking || {}
      const dates = b.dates || {}
      const financial = b.financial || {}
      const docType = String(booking.doc_type || '').toLowerCase()
      if (!docType) return bad('doc_type مطلوب')
      if (!b.supplier_id) return bad('المورد مطلوب (supplier_id)')
      const currency = CURRENCIES.includes(financial.currency) ? financial.currency : 'USD'
      const amount = Number(financial.amount) || 0
      const paymentMethod = b.payment_method === 'cash' ? 'cash' : 'credit'
      // v3.9.22 — Unified payment: credit needs client_id, cash needs box_id
      if (paymentMethod === 'credit' && !b.client_id) return bad('العميل مطلوب للحجز الآجل')
      if (paymentMethod === 'cash' && !b.box_id) return bad('اختر الصندوق / البنك للنقد')
      const passengerName = traveler.name_ar || traveler.name_en || ''
      // Route to ticket or visa creator
      if (docType === 'flight' || docType === 'bus') {
        const payload = {
          client_id: b.client_id, supplier_id: b.supplier_id,
          currency, cost: Number(b.cost) || 0, sale_price: amount || Number(b.sale_price) || 0,
          payment_method: paymentMethod, box_id: b.box_id || null,
          date: dates.issued_at || new Date().toISOString(),
          pnr: booking.pnr || booking.ticket_no || '', ticket_number: booking.ticket_no || '',
          flight_number: booking.flight_no || '',
          route: [booking.route_from, booking.route_to].filter(Boolean).join(' → '),
          carrier_name: booking.carrier || '',
          passenger_name: passengerName, passport_no: traveler.passport_no || '',
          passenger_phone: traveler.phone || '', passenger_whatsapp: traveler.whatsapp || traveler.phone || '',
          travel_date: dates.trip_date || null,
          departure_time: dates.depart_time || '',
          arrival_time: dates.arrive_time || '',
          travel_mode: docType === 'bus' ? 'land' : 'air',
          exchange_rate: Number(b.exchange_rate) || 1,
        }
        const r = await createTicket(db, T, payload)
        if (r.error) return bad(r.error)
        let usageOut = { plan: 'paid', unlimited: true, used: 0, limit: -1, remaining: -1 }
        if (!isPaidT) {
          await db.collection('tenants').updateOne({ id: T }, { $inc: { 'scraper_usage.count': 1 }, $set: { 'scraper_usage.last_at': new Date() } })
          const usedNow = (sess.tenant?.scraper_usage?.count || 0) + 1
          usageOut = { plan: 'trial', unlimited: false, used: usedNow, limit: 30, remaining: Math.max(0, 30 - usedNow) }
        }
        return ok({ ok: true, record_type: 'ticket', record_id: r.doc.id, doc: r.doc, source: b.source_url || null, usage: usageOut })
      }
      if (docType === 'umrah_visa' || docType === 'visit_visa' || docType === 'work_visa' || docType === 'security_approval') {
        const svcMap = {
          umrah_visa: 'تأشيرة عمرة',
          visit_visa: 'تأشيرة زيارة',
          work_visa: 'تأشيرة عمل',
          security_approval: 'موافقة أمنية',
        }
        const payload = {
          client_id: b.client_id, supplier_id: b.supplier_id,
          currency, cost: Number(b.cost) || 0, sale_price: amount || Number(b.sale_price) || 0,
          payment_method: paymentMethod, box_id: b.box_id || null,
          date: dates.issued_at || new Date().toISOString(),
          service_type: svcMap[docType],
          passenger_name: passengerName, passport_no: traveler.passport_no || '',
          nationality: traveler.nationality || '',
          passenger_phone: traveler.phone || '', passenger_whatsapp: traveler.whatsapp || traveler.phone || '',
          entry_date: dates.valid_from || null,
          expected_exit_date: dates.valid_until || null,
          exchange_rate: Number(b.exchange_rate) || 1,
          // Preserve source metadata as attachment_url hint
          attachment_url: b.source_url || '',
        }
        const r = await createVisa(db, T, payload)
        if (r.error) return bad(r.error)
        let usageOut = { plan: 'paid', unlimited: true, used: 0, limit: -1, remaining: -1 }
        if (!isPaidT) {
          await db.collection('tenants').updateOne({ id: T }, { $inc: { 'scraper_usage.count': 1 }, $set: { 'scraper_usage.last_at': new Date() } })
          const usedNow = (sess.tenant?.scraper_usage?.count || 0) + 1
          usageOut = { plan: 'trial', unlimited: false, used: usedNow, limit: 30, remaining: Math.max(0, 30 - usedNow) }
        }
        return ok({ ok: true, record_type: 'visa', record_id: r.doc.id, doc: r.doc, source: b.source_url || null, usage: usageOut })
      }
      return bad(`نوع المستند "${docType}" غير مدعوم بعد`)
    }

    // ============ v3.6 — PACKAGES & TOURS (MVP) ============
    if (route === '/packages' && method === 'GET') {
      // v3.28 — Soft archive: archived packages are hidden by default; ?archived=1 lists ONLY archived
      const wantArchived = q.archived === '1' || q.archived === 'true'
      const pkgFilter = { ...tf, ...(wantArchived ? { archived: true } : { archived: { $ne: true } }) }
      const list = await db.collection('packages').find(pkgFilter).sort({ created_at: -1 }).toArray()
      // v3.52 — pending Meraaj bookings must be VISIBLE immediately (not hidden until approval)
      const pendingAgg = await db.collection('meraaj_inbound_bookings').aggregate([
        { $match: { tenant_id: T, status: 'new' } },
        { $group: { _id: '$package_id', seats: { $sum: '$seats' }, count: { $sum: 1 } } },
      ]).toArray()
      const pendingMap = {}
      for (const x of pendingAgg) pendingMap[x._id] = x
      // Enrich each with counts
      const enriched = await Promise.all(list.map(async p => {
        const [comps, books] = await Promise.all([
          db.collection('package_components').countDocuments({ tenant_id: T, package_id: p.id }),
          db.collection('package_bookings').countDocuments({ tenant_id: T, package_id: p.id, status: { $ne: 'cancelled' } }), // v3.74 — cancelled = audit-only
        ])
        return { ...p, _id: undefined, components_count: comps, bookings_count: books, meraaj_pending_seats: pendingMap[p.id]?.seats || 0, meraaj_pending_count: pendingMap[p.id]?.count || 0 }
      }))
      return ok(enriched)
    }
    // v3.52 — Package-scoped inbound Meraaj bookings (visible from the registrants tab without mod_meraaj)
    const pkgInboundMatch = route.match(/^\/packages\/([^/]+)\/inbound-bookings$/)
    if (pkgInboundMatch && method === 'GET') {
      return ok(clean(await db.collection('meraaj_inbound_bookings').find({ tenant_id: T, package_id: pkgInboundMatch[1] }).sort({ created_at: -1 }).limit(100).toArray()))
    }
    // v3.7 — Packages profitability comparison (leaderboard) with optional period filter
    if (route === '/packages/comparison' && method === 'GET') {
      const period = (q.period || 'all').toLowerCase() // 'all' | 'month' | 'year'
      const now = new Date()
      let startFilter = null
      if (period === 'month') { startFilter = new Date(now.getFullYear(), now.getMonth(), 1) }
      else if (period === 'year') { startFilter = new Date(now.getFullYear(), 0, 1) }
      const pkgs = await db.collection('packages').find(tf).toArray()
      const bookingsQ = { tenant_id: T, status: { $ne: 'cancelled' } } // v3.74 — soft-cancelled bookings are audit-only, never revenue
      if (startFilter) bookingsQ.created_at = { $gte: startFilter }
      const allBookings = await db.collection('package_bookings').find(bookingsQ).toArray()
      // v3.57 — per-age tier profit: room+age lookup maps (direct pricing packages only)
      const pkgById = {}
      for (const p of pkgs) pkgById[p.id] = p
      const byPkg = {}
      for (const b of allBookings) {
        byPkg[b.package_id] = byPkg[b.package_id] || { revenue: 0, cost: 0, profit: 0, pax: 0, bookings: 0, tiers: { counts: { adult: 0, child: 0, infant: 0 }, profit: { adult: 0, child: 0, infant: 0 }, priced: 0 } }
        const agg = byPkg[b.package_id]
        agg.revenue += b.total_sale || 0
        agg.cost += b.total_cost || 0
        agg.profit += b.commission || 0
        agg.pax += b.pax_count || 0
        agg.bookings += 1
        // v3.57 — per-age tier realized profit from registrants (sale-cost per room+age),
        // mirrors editor semantics: empty child sale = adult, empty infant sale = 0, empty costs = 0.
        const pkgDoc = pkgById[b.package_id]
        const isDirect = pkgDoc ? ((pkgDoc.pricing_mode || ((pkgDoc.room_pricing || []).length > 0 ? 'direct' : 'components')) === 'direct') : false
        const roomMap = {}
        if (isDirect) for (const rp of (pkgDoc.room_pricing || [])) roomMap[rp.type] = rp
        const regs = Array.isArray(b.registrants) ? b.registrants : []
        if (regs.length > 0) {
          for (const r of regs) {
            const cat = ageCategoryOf(r.age)
            agg.tiers.counts[cat]++
            const rp = roomMap[r.room_type]
            if (isDirect && rp) {
              const sale = cat === 'adult' ? (Number(rp.sale_per_pax) || 0)
                : cat === 'child' ? ((rp.sale_child === null || rp.sale_child === undefined) ? (Number(rp.sale_per_pax) || 0) : (Number(rp.sale_child) || 0))
                : (Number(rp.sale_infant) || 0)
              const cost = Number(rp[`cost_${cat}`]) || 0
              agg.tiers.profit[cat] += (sale - cost)
              agg.tiers.priced++
            }
          }
        } else {
          agg.tiers.counts.adult += Number(b.pax_adults) || 0
          agg.tiers.counts.child += Number(b.pax_children) || 0
          agg.tiers.counts.infant += Number(b.pax_infants) || 0
        }
      }
      const rows = pkgs.map(p => {
        const s = byPkg[p.id] || { revenue: 0, cost: 0, profit: 0, pax: 0, bookings: 0, tiers: { counts: { adult: 0, child: 0, infant: 0 }, profit: { adult: 0, child: 0, infant: 0 }, priced: 0 } }
        const margin_pct = s.revenue > 0 ? +((s.profit / s.revenue) * 100).toFixed(2) : 0
        return {
          package_id: p.id,
          name: p.name,
          package_type: p.package_type,
          currency: p.currency,
          status: p.status,
          start_date: p.start_date,
          end_date: p.end_date,
          revenue: +s.revenue.toFixed(2),
          cost: +s.cost.toFixed(2),
          profit: +s.profit.toFixed(2),
          margin_pct,
          pax: s.pax,
          bookings: s.bookings,
          // v3.57 — per-age tier breakdown (computable only for direct pricing with matched rooms)
          tiers: {
            counts: s.tiers.counts,
            profit: { adult: +s.tiers.profit.adult.toFixed(2), child: +s.tiers.profit.child.toFixed(2), infant: +s.tiers.profit.infant.toFixed(2) },
            computable: s.tiers.priced > 0,
          },
        }
      }).sort((a, b) => b.profit - a.profit)
      const top = rows.find(r => r.bookings > 0) || null
      const totals = rows.reduce((acc, r) => ({
        revenue: acc.revenue + r.revenue,
        cost: acc.cost + r.cost,
        profit: acc.profit + r.profit,
        bookings: acc.bookings + r.bookings,
        pax: acc.pax + r.pax,
      }), { revenue: 0, cost: 0, profit: 0, bookings: 0, pax: 0 })
      totals.margin_pct = totals.revenue > 0 ? +((totals.profit / totals.revenue) * 100).toFixed(2) : 0
      return ok({ period, top, rows, totals })
    }
    if (route === '/packages' && method === 'POST') {
      const b = await request.json()
      if (!b.name || !b.package_type) return bad('الاسم والنوع مطلوبان')
      // v3.88.4 — D-001: the package end date can never precede its start date
      if (b.start_date && b.end_date && new Date(b.end_date) < new Date(b.start_date)) return bad('تاريخ نهاية الباكج لا يمكن أن يسبق تاريخ البداية')
      // v3.15 — Room-type pricing / v3.20 — extended with age tiers (sale_child, sale_infant)
      const roomPricing = sanitizeRoomPricing(b.room_pricing)
      // v3.89 — Task 3: cost must not exceed sale price
      const rpErr = roomPricingCostError(roomPricing)
      if (rpErr) return bad(`🚫 ${rpErr} — لا يمكن أن تتجاوز التكلفة سعر البيع`)
      // v3.20 — Dual pricing mode: 'direct' (room+age matrix, B2B) | 'components' (assembled from components)
      const pricingMode = ['direct', 'components'].includes(b.pricing_mode) ? b.pricing_mode : (roomPricing.length > 0 ? 'direct' : 'components')
      const doc = {
        id: uuidv4(), tenant_id: T, name: String(b.name), package_type: b.package_type,
        currency: CURRENCIES.includes(b.currency) ? b.currency : 'SAR',
        start_date: b.start_date ? new Date(b.start_date) : null,
        end_date: b.end_date ? new Date(b.end_date) : null,
        room_pricing: roomPricing,
        pricing_mode: pricingMode,
        hotels: sanitizeHotels(b.hotels), // v3.49
        supplier_id: b.supplier_id ? String(b.supplier_id) : null, // v3.51 — main supplier saved with the package
        features: sanitizeFeatures(b.features),
        has_image: false,
        notes: b.notes || '', status: 'open',
        created_at: new Date(),
      }
      await db.collection('packages').insertOne(doc)
      const { _id, ...rest } = doc; return ok(rest)
    }
    const pkgIdMatch = route.match(/^\/packages\/([^/]+)$/)
    if (pkgIdMatch && method === 'PATCH') {
      const b = await request.json()
      const upd = {}
      // v3.88.4 — D-001: validate MERGED dates (end ≥ start) before saving partial updates
      if (b.start_date !== undefined || b.end_date !== undefined) {
        const curP = await db.collection('packages').findOne({ id: pkgIdMatch[1], tenant_id: T }, { projection: { start_date: 1, end_date: 1 } })
        const effStart = b.start_date !== undefined ? (b.start_date ? new Date(b.start_date) : null) : (curP?.start_date || null)
        const effEnd = b.end_date !== undefined ? (b.end_date ? new Date(b.end_date) : null) : (curP?.end_date || null)
        if (effStart && effEnd && effEnd < effStart) return bad('تاريخ نهاية الباكج لا يمكن أن يسبق تاريخ البداية')
      }
      // v3.31 — start_date now editable too (needed for full editing after duplication)
      for (const k of ['name', 'package_type', 'notes', 'start_date', 'end_date', 'status']) if (b[k] !== undefined) upd[k] = (k === 'end_date' || k === 'start_date') && b[k] ? new Date(b[k]) : b[k]
      // v3.31 — currency editable ONLY while the package has no bookings (accounting safety)
      if (b.currency !== undefined) {
        const curPkg = await db.collection('packages').findOne({ id: pkgIdMatch[1], tenant_id: T }, { projection: { currency: 1 } })
        if (curPkg && String(b.currency) !== String(curPkg.currency)) {
          const bkCount = await db.collection('package_bookings').countDocuments({ tenant_id: T, package_id: pkgIdMatch[1] })
          if (bkCount > 0) return bad('لا يمكن تغيير عملة باكج به حجوزات — العملة مرتبطة بالقيود المحاسبية')
          upd.currency = String(b.currency).slice(0, 8)
        }
      }
      // v3.15 — Room-type pricing update / v3.20 — age tiers
      if (b.room_pricing !== undefined) {
        upd.room_pricing = sanitizeRoomPricing(b.room_pricing)
        // v3.89 — Task 3: cost must not exceed sale price (edit flow too)
        const rpErrU = roomPricingCostError(upd.room_pricing)
        if (rpErrU) return bad(`🚫 ${rpErrU} — لا يمكن أن تتجاوز التكلفة سعر البيع`)
      }
      // v3.20 — Dual pricing mode update
      if (b.pricing_mode !== undefined && ['direct', 'components'].includes(b.pricing_mode)) {
        upd.pricing_mode = b.pricing_mode
      }
      // v3.23 — Features/amenities update (Miraj Network readiness)
      if (b.features !== undefined) {
        upd.features = sanitizeFeatures(b.features)
      }
      // v3.49 — Hotels quick-details (name + city + nights) for program display
      if (b.hotels !== undefined) {
        upd.hotels = sanitizeHotels(b.hotels)
      }
      // v3.51 — Main package supplier (internal field — NOT part of the Meraaj contract payload)
      if (b.supplier_id !== undefined) {
        upd.supplier_id = b.supplier_id ? String(b.supplier_id) : null
      }
      await db.collection('packages').updateOne({ id: pkgIdMatch[1], tenant_id: T }, { $set: upd })
      // v3.24/v3.25 — Meraaj sync: shared packages emit updates; closing emits deactivation
      try {
        const pkgAfter = await db.collection('packages').findOne({ id: pkgIdMatch[1], tenant_id: T })
        if (pkgAfter?.meraaj?.shared) {
          if (upd.status === 'closed') await emitMeraajEvent(db, T, 'package.deactivated', { package_ref: pkgAfter.id, reason: 'closed_by_office' })
          else {
            // v3.25 — room prices changed → auto-recompute marketplace pricing (always mirrors Rahaal)
            if (upd.room_pricing !== undefined) {
              const m = pkgAfter.meraaj
              const newMarket = computeMeraajMarketPricing(pkgAfter.room_pricing, m.buyer_commission_mode || 'amount', Number(m.buyer_commission_value) || 0, m.commission_direction || 'deducted', m.buyer_commission_child_value ?? null, m.buyer_commission_infant_value ?? null)
              await db.collection('packages').updateOne({ id: pkgAfter.id, tenant_id: T }, { $set: { 'meraaj.market_pricing': newMarket, 'meraaj.updated_at': new Date() } })
              pkgAfter.meraaj.market_pricing = newMarket
            }
            const compsM = await db.collection('package_components').find({ package_id: pkgAfter.id, tenant_id: T }).toArray()
            // v3.30 — package.updated must carry the Meraaj CONTRACT payload (title/description/departure_date/return_date)
            await emitMeraajEvent(db, T, 'package.updated', await meraajContractPayload(db, T, pkgAfter, compsM))
          }
        }
      } catch { }
      return ok({ success: true })
    }
    if (pkgIdMatch && method === 'DELETE') {
      // Only allow delete if no bookings
      const bk = await db.collection('package_bookings').countDocuments({ tenant_id: T, package_id: pkgIdMatch[1] })
      if (bk > 0) return bad('لا يمكن حذف باكج به تسجيلات — أغلقه بدلاً من الحذف')
      // v3.30/v3.32 — If the package is listed/registered on Meraaj: FIRST deliver package.deactivated.
      // v3.32 STRICT GUARD: if delivery to Meraaj FAILS, the package is NOT deleted locally
      // (a Meraaj copy must never remain listed while the Rahaal original is gone).
      const pkgDel = await db.collection('packages').findOne({ id: pkgIdMatch[1], tenant_id: T })
      if (pkgDel && (pkgDel.meraaj?.shared || pkgDel.meraaj?.registered_at)) {
        const dlv = await emitMeraajEvent(db, T, 'package.deactivated', { package_ref: pkgDel.id, reason: 'deleted_by_office' })
        if (dlv === 'failed') return bad('لم يتم الحذف — تعذر إبلاغ سوق معراج بإيقاف الباكج. حاول لاحقاً أو أوقف المشاركة أولاً', 502)
      }
      await db.collection('package_components').deleteMany({ tenant_id: T, package_id: pkgIdMatch[1] })
      await db.collection('packages').deleteOne({ id: pkgIdMatch[1], tenant_id: T })
      return ok({ success: true })
    }

    // Package components
    const pkgCompMatch = route.match(/^\/packages\/([^/]+)\/components$/)
    if (pkgCompMatch && method === 'GET') {
      const list = await db.collection('package_components').find({ tenant_id: T, package_id: pkgCompMatch[1] }).sort({ created_at: 1 }).toArray()
      return ok(list.map(c => ({ ...c, _id: undefined })))
    }
    if (pkgCompMatch && method === 'POST') {
      const b = await request.json()
      if (!b.name || !b.supplier_id) return bad('اسم المكوّن والمورد مطلوبان')
      const sup = await db.collection('suppliers').findOne({ id: b.supplier_id, tenant_id: T })
      if (!sup) return bad('المورد غير موجود')
      // v3.20 — Dual pricing types: 'flat' (visa: fixed regardless of age), 'per_age' (transport), 'room_age' (hotel)
      const pricingType = ['flat', 'per_age', 'room_age'].includes(b.pricing_type) ? b.pricing_type : 'flat'
      // v3.89 — Task 3: component cost must not exceed its sale price (any tier with sale > 0).
      // Tiers with sale = 0 are skipped (direct-mode packages: the sale lives in the room matrix).
      const compTierErr = (() => {
        const tiers = [['cost_adult', 'sale_adult', 'بالغ'], ['cost_child', 'sale_child', 'طفل'], ['cost_infant', 'sale_infant', 'رضيع']]
        if (pricingType === 'flat') {
          const s = Number(b.sale_per_pax) || 0
          if (s > 0 && (Number(b.cost_per_pax) || 0) > s) return `التكلفة (${Number(b.cost_per_pax) || 0}) أعلى من سعر البيع (${s})`
        } else if (pricingType === 'per_age') {
          for (const [ck, sk, lbl] of tiers) {
            const s = Number(b[sk]) || 0
            if (s > 0 && (Number(b[ck]) || 0) > s) return `فئة ${lbl}: التكلفة (${Number(b[ck]) || 0}) أعلى من سعر البيع (${s})`
          }
        } else if (pricingType === 'room_age') {
          for (const rr of sanitizeRoomRates(b.room_rates)) {
            for (const [ck, sk, lbl] of tiers) {
              const s = Number(rr[sk]) || 0
              if (s > 0 && (Number(rr[ck]) || 0) > s) return `غرفة «${rr.room_type}» — فئة ${lbl}: التكلفة (${Number(rr[ck]) || 0}) أعلى من سعر البيع (${s})`
            }
          }
        }
        return null
      })()
      if (compTierErr) return bad(`🚫 بند «${b.name}»: ${compTierErr} — لا يمكن أن تتجاوز التكلفة سعر البيع في الباقات/البرامج`)
      const doc = {
        id: uuidv4(), tenant_id: T, package_id: pkgCompMatch[1],
        name: b.name, component_type: b.component_type || 'other',  // visa/ticket/hotel/transport/other
        supplier_id: sup.id, supplier_name: sup.name,
        cost_per_pax: Number(b.cost_per_pax) || 0,
        sale_per_pax: Number(b.sale_per_pax) || 0,
        pricing_type: pricingType,
        include_infants: !!b.include_infants,
        // v3.40 — Hotel nights management: nights per hotel + city (e.g. 3 nights Makkah, 4 nights Madinah)
        nights: Math.max(0, Number(b.nights) || 0),
        city: String(b.city || '').slice(0, 60),
        notes: b.notes || '', created_at: new Date(),
      }
      if (pricingType === 'per_age') {
        for (const f of ['cost_adult', 'cost_child', 'cost_infant', 'sale_adult', 'sale_child', 'sale_infant']) doc[f] = Math.max(0, Number(b[f]) || 0)
        // keep legacy display fields aligned with adult tier
        doc.cost_per_pax = doc.cost_adult
        doc.sale_per_pax = doc.sale_adult
      }
      if (pricingType === 'room_age') {
        doc.room_rates = sanitizeRoomRates(b.room_rates)
        if (doc.room_rates.length === 0) return bad('أضف سعر غرفة واحدة على الأقل لمكوّن الفندق (غرفة + عمر)')
        doc.cost_per_pax = doc.room_rates[0]?.cost_adult || 0
        doc.sale_per_pax = doc.room_rates[0]?.sale_adult || 0
      }
      await db.collection('package_components').insertOne(doc)
      await maybeEmitMeraajPackageUpdate(db, T, pkgCompMatch[1]) // v3.32 — sync marketplace (hotels/transport list)
      const { _id, ...rest } = doc; return ok(rest)
    }
    const pkgCompDelMatch = route.match(/^\/packages\/([^/]+)\/components\/([^/]+)$/)
    if (pkgCompDelMatch && method === 'DELETE') {
      await db.collection('package_components').deleteOne({ id: pkgCompDelMatch[2], tenant_id: T, package_id: pkgCompDelMatch[1] })
      await maybeEmitMeraajPackageUpdate(db, T, pkgCompDelMatch[1]) // v3.32 — sync marketplace
      return ok({ success: true })
    }

    // v3.9.26 — Package Transports (buses/flights) with capacity tracking
    const pkgTransMatch = route.match(/^\/packages\/([^/]+)\/transports$/)
    if (pkgTransMatch && method === 'GET') {
      const list = await db.collection('package_transports').find({ tenant_id: T, package_id: pkgTransMatch[1] }).sort({ created_at: 1 }).toArray()
      return ok(list.map(t => ({ ...t, _id: undefined })))
    }
    if (pkgTransMatch && method === 'POST') {
      const b = await request.json()
      const pkgId = pkgTransMatch[1]
      const pkg = await db.collection('packages').findOne({ id: pkgId, tenant_id: T })
      if (!pkg) return bad('الباكج غير موجود', 404)
      if (!b.name || !String(b.name).trim()) return bad('اسم وسيلة النقل مطلوب')
      const capacity = Math.max(1, Number(b.capacity) || 44)
      const type = ['bus', 'flight', 'train', 'car'].includes(b.type) ? b.type : 'bus'
      const doc = {
        id: uuidv4(), tenant_id: T, package_id: pkgId,
        name: String(b.name).trim(),
        type, capacity, seats_booked: 0,
        driver_name: b.driver_name || '',
        driver_phone: b.driver_phone || '',
        vehicle_plate: b.vehicle_plate || '',
        flight_no: b.flight_no || '',
        notes: b.notes || '',
        status: 'open',
        created_at: new Date(), created_by: sess.user.email,
      }
      await db.collection('package_transports').insertOne(doc)
      await maybeEmitMeraajPackageUpdate(db, T, pkgId) // v3.32 — sync marketplace (transport)
      const { _id, ...rest } = doc; return ok(rest)
    }
    const pkgTransItemMatch = route.match(/^\/packages\/([^/]+)\/transports\/([^/]+)$/)
    if (pkgTransItemMatch && method === 'PATCH') {
      const [, pkgIdT, tid] = pkgTransItemMatch
      const b = await request.json()
      const existing = await db.collection('package_transports').findOne({ id: tid, tenant_id: T, package_id: pkgIdT })
      if (!existing) return bad('وسيلة النقل غير موجودة', 404)
      const updates = {}
      if (b.name !== undefined) updates.name = String(b.name).trim() || existing.name
      if (b.type !== undefined && ['bus', 'flight', 'train', 'car'].includes(b.type)) updates.type = b.type
      if (b.capacity !== undefined) {
        const cap = Math.max(1, Number(b.capacity) || existing.capacity)
        if (cap < existing.seats_booked) return bad(`السعة الجديدة (${cap}) أقل من المقاعد المحجوزة (${existing.seats_booked})`)
        updates.capacity = cap
      }
      if (b.driver_name !== undefined) updates.driver_name = String(b.driver_name || '')
      if (b.driver_phone !== undefined) updates.driver_phone = String(b.driver_phone || '')
      if (b.vehicle_plate !== undefined) updates.vehicle_plate = String(b.vehicle_plate || '')
      if (b.flight_no !== undefined) updates.flight_no = String(b.flight_no || '')
      if (b.notes !== undefined) updates.notes = String(b.notes || '')
      if (b.status !== undefined && ['open', 'closed'].includes(b.status)) updates.status = b.status
      updates.updated_at = new Date()
      await db.collection('package_transports').updateOne({ id: tid, tenant_id: T }, { $set: updates })
      const updated = await db.collection('package_transports').findOne({ id: tid, tenant_id: T })
      await maybeEmitMeraajPackageUpdate(db, T, updated.package_id) // v3.34 — sync marketplace (transport)
      const { _id, ...rest } = updated; return ok(rest)
    }
    if (pkgTransItemMatch && method === 'DELETE') {
      const [, pkgIdT2, tid] = pkgTransItemMatch
      const existing = await db.collection('package_transports').findOne({ id: tid, tenant_id: T, package_id: pkgIdT2 })
      if (!existing) return bad('وسيلة النقل غير موجودة', 404)
      const usedCount = await db.collection('package_bookings').countDocuments({ tenant_id: T, package_id: pkgIdT2, transport_id: tid })
      if (usedCount > 0) return bad(`لا يمكن الحذف — يوجد ${usedCount} مسافر مسجّل على هذه الوسيلة. انقلهم إلى وسيلة أخرى أولاً.`)
      await db.collection('package_transports').deleteOne({ id: tid, tenant_id: T })
      await maybeEmitMeraajPackageUpdate(db, T, pkgIdT2) // v3.34 — sync marketplace (transport)
      return ok({ success: true, transport_id: tid })
    }


    // v3.28 — SOFT ARCHIVE (NO hard delete — accounting entries stay 100% intact)
    const pkgArchiveMatch = route.match(/^\/packages\/([^/]+)\/archive$/)
    if (pkgArchiveMatch && method === 'POST') {
      const b = await request.json()
      const pkg = await db.collection('packages').findOne({ id: pkgArchiveMatch[1], tenant_id: T })
      if (!pkg) return bad('الباكج غير موجود', 404)
      const toArchive = b.archived !== false
      if (toArchive) {
        const upd = { archived: true, archived_at: new Date() }
        // Archiving also removes it from Meraaj marketplace (soft — data preserved)
        // v3.34 — deliver deactivation FIRST; if Meraaj unreachable, block the archive (no dangling listing)
        if (pkg.meraaj?.shared) {
          const dlv = await emitMeraajEvent(db, T, 'package.deactivated', { package_ref: pkg.id, reason: 'archived_by_office' })
          if (dlv === 'failed') return bad('تعذر إبلاغ سوق معراج بإيقاف الباكج — لم تتم الأرشفة. حاول لاحقاً أو أوقف المشاركة أولاً', 502)
          upd['meraaj.shared'] = false
          upd['meraaj.unshared_at'] = new Date()
        }
        await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: upd })
        return ok({ archived: true, was_shared: !!pkg.meraaj?.shared })
      } else {
        await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { archived: false, restored_at: new Date() } })
        return ok({ archived: false })
      }
    }
    // v3.23 — Package image (upload / view / delete) — stored in separate collection to keep package docs light
    const pkgImgMatch = route.match(/^\/packages\/([^/]+)\/image$/)
    if (pkgImgMatch && method === 'POST') {
      const b = await request.json()
      const pkg = await db.collection('packages').findOne({ id: pkgImgMatch[1], tenant_id: T })
      if (!pkg) return bad('الباكج غير موجود', 404)
      const raw = String(b.data || '')
      const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
      if (!m) return bad('صيغة الصورة غير صالحة — يُقبل JPG / PNG / WebP فقط')
      if (m[2].length > 4_000_000) return bad('حجم الصورة كبير جداً (الحد الأقصى ~3MB)')
      // v3.47 — Automatic optimization ONCE at upload: resize to max 1200px (aspect preserved,
      // never enlarged), auto-rotate per EXIF, convert to WebP q82. Keeps MongoDB payloads small.
      // Serving endpoints & Meraaj integration unchanged (content_type is read from the doc).
      let outBuf, outMeta
      try {
        const srcBuf = Buffer.from(m[2], 'base64')
        const pipeline = sharp(srcBuf, { failOn: 'none' }).rotate()
          .resize({ width: IMG_MAX_DIM, height: IMG_MAX_DIM, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: IMG_WEBP_QUALITY })
        outBuf = await pipeline.toBuffer()
        outMeta = await sharp(outBuf).metadata()
      } catch {
        return bad('تعذر معالجة الصورة — تأكد أنها صورة صالحة (JPG / PNG / WebP)')
      }
      await db.collection('package_images').updateOne(
        { package_id: pkg.id, tenant_id: T },
        { $set: { package_id: pkg.id, tenant_id: T, content_type: 'image/webp', data: outBuf.toString('base64'), width: outMeta.width || null, height: outMeta.height || null, original_bytes: Math.round(m[2].length * 0.75), optimized_bytes: outBuf.length, updated_at: new Date() }, $setOnInsert: { id: uuidv4(), created_at: new Date() } },
        { upsert: true }
      )
      await db.collection('packages').updateOne({ id: pkg.id, tenant_id: T }, { $set: { has_image: true } })
      await maybeEmitMeraajPackageUpdate(db, T, pkg.id) // v3.32 — sync marketplace images
      return ok({ saved: true, optimized: { width: outMeta.width, height: outMeta.height, bytes: outBuf.length, format: 'webp' } })
    }
    if (pkgImgMatch && method === 'GET') {
      const img = await db.collection('package_images').findOne({ package_id: pkgImgMatch[1], tenant_id: T })
      if (!img) return bad('لا توجد صورة', 404)
      const buf = Buffer.from(img.data, 'base64')
      return new Response(buf, { status: 200, headers: { 'Content-Type': img.content_type || 'image/jpeg', 'Cache-Control': 'private, max-age=120' } })
    }
    if (pkgImgMatch && method === 'DELETE') {
      await db.collection('package_images').deleteOne({ package_id: pkgImgMatch[1], tenant_id: T })
      await db.collection('packages').updateOne({ id: pkgImgMatch[1], tenant_id: T }, { $set: { has_image: false } })
      await maybeEmitMeraajPackageUpdate(db, T, pkgImgMatch[1]) // v3.32 — sync marketplace images
      return ok({ deleted: true })
    }

    // v3.21 — Duplicate package (structure + components + transports; NO bookings/JEs)
    const pkgDupMatch = route.match(/^\/packages\/([^/]+)\/duplicate$/)
    if (pkgDupMatch && method === 'POST') {
      const srcId = pkgDupMatch[1]
      const src = await db.collection('packages').findOne({ id: srcId, tenant_id: T })
      if (!src) return bad('الباكج غير موجود', 404)
      let bodyDup = {}
      try { bodyDup = await request.json() } catch { bodyDup = {} }
      const newId = uuidv4()
      const baseName = String(bodyDup.name || '').trim().slice(0, 120) || `${src.name} — نسخة`
      const { _id, ...srcRest } = src
      const newPkg = {
        ...srcRest,
        id: newId,
        name: baseName,
        status: 'open',
        start_date: bodyDup.start_date ? new Date(bodyDup.start_date) : (src.start_date || null),
        end_date: bodyDup.end_date ? new Date(bodyDup.end_date) : (src.end_date || null),
        duplicated_from: src.id,
        created_at: new Date(),
      }
      delete newPkg.updated_at
      // v3.31 — The duplicate is a fully INDEPENDENT package:
      // NEVER inherit Meraaj marketplace identity/state (shared, registered_at, remote_id, seats_sold,
      // market_pricing...) nor archive flags from the source. First share of the copy will register it
      // as a brand-new package at Meraaj via POST /api/integrations/rahal/packages/share (package_ref = new id).
      delete newPkg.meraaj
      delete newPkg.archived
      delete newPkg.archived_at
      delete newPkg.archived_by
      delete newPkg.restored_at
      await db.collection('packages').insertOne(newPkg)
      // Clone components (all pricing types + rates preserved)
      const srcComps = await db.collection('package_components').find({ package_id: srcId, tenant_id: T }).toArray()
      let compCount = 0
      for (const c of srcComps) {
        const { _id: cid, ...cRest } = c
        await db.collection('package_components').insertOne({ ...cRest, id: uuidv4(), package_id: newId, created_at: new Date() })
        compCount++
      }
      // Clone transports (structure only — no passengers)
      const srcTrans = await db.collection('package_transports').find({ package_id: srcId, tenant_id: T }).toArray()
      let transCount = 0
      for (const t of srcTrans) {
        const { _id: tid2, ...tRest } = t
        await db.collection('package_transports').insertOne({ ...tRest, id: uuidv4(), package_id: newId, status: 'open', created_at: new Date() })
        transCount++
      }
      // v3.23 — Clone package image too
      const srcImg = await db.collection('package_images').findOne({ package_id: srcId, tenant_id: T })
      if (srcImg) {
        const { _id: iid, ...imgRest } = srcImg
        await db.collection('package_images').insertOne({ ...imgRest, id: uuidv4(), package_id: newId, created_at: new Date() })
      }
      const { _id: nid, ...pkgOut } = newPkg
      return ok({ ...pkgOut, components_copied: compCount, transports_copied: transCount })
    }

    // Package bookings — register a client with auto-JE
    const pkgBookMatch = route.match(/^\/packages\/([^/]+)\/bookings$/)
    if (pkgBookMatch && method === 'GET') {
      const list = await db.collection('package_bookings').find({ tenant_id: T, package_id: pkgBookMatch[1] }).sort({ created_at: -1 }).toArray()
      return ok(list.map(b => ({ ...b, _id: undefined })))
    }

    // v3.9.20 — Delete a specific package booking (reverses balances + JE)
    const pkgBookDelMatch = route.match(/^\/packages\/([^/]+)\/bookings\/([^/]+)$/)
    if (pkgBookDelMatch && method === 'DELETE') {
      const [_, pkgId, bookingId] = pkgBookDelMatch
      const booking = await db.collection('package_bookings').findOne({ id: bookingId, tenant_id: T, package_id: pkgId })
      if (!booking) return bad('التسجيل غير موجود', 404)
      // v4.6 — RAH-ACC: deleting a booking whose journal lives inside a closed year/period
      // silently rewrites closed books — centrally blocked BEFORE any reversal (same rule
      // as manual journal deletion).
      const jeGuardPB = await db.collection('journal_entries').findOne({ ref_type: 'package_booking', ref_id: bookingId, tenant_id: T })
      const perrPBD = await assertOpenPeriod(db, T, jeGuardPB?.date || booking.date || booking.created_at)
      if (perrPBD) return bad(`الحجز داخل فترة/سنة مقفلة ولا يُحذف — ${perrPBD}`)
      // Reverse balances
      const cur = booking.currency || 'USD'
      const payMethod = booking.payment_method || 'credit'
      if (payMethod === 'cash' && booking.box_id) {
        await updateBalance(db, 'boxes', { id: booking.box_id, tenant_id: T }, cur, -(booking.total_sale || 0))
      } else if (booking.client_id) {
        await updateBalance(db, 'clients', { id: booking.client_id, tenant_id: T }, cur, -(booking.total_sale || 0))
      }
      // Reverse supplier balances from component snapshots
      if (booking.component_snapshots && Array.isArray(booking.component_snapshots)) {
        for (const comp of booking.component_snapshots) {
          if (comp.supplier_id && comp.cost_total) {
            await updateBalance(db, 'suppliers', { id: comp.supplier_id, tenant_id: T }, cur, -(comp.cost_total || 0))
          }
        }
      }
      // Delete associated JE
      const je = await db.collection('journal_entries').findOne({ ref_type: 'package_booking', ref_id: bookingId, tenant_id: T })
      if (je) {
        await db.collection('journal_entries').deleteOne({ id: je.id, tenant_id: T }) // v4.6 — tenant-scoped
        await db.collection('tenants').updateOne({ id: T, 'journal_quota.used': { $gt: 0 } }, { $inc: { 'journal_quota.used': -1 } }) // v4.6 — never below 0
      }
      // Decrement package bookings count
      await db.collection('packages').updateOne({ id: pkgId, tenant_id: T }, { $inc: { bookings_count: -1 } })
      // v3.9.26 — Free up transport seats
      if (booking.transport_id) {
        const t = await db.collection('package_transports').findOne({ id: booking.transport_id, tenant_id: T })
        if (t) {
          const newBooked = Math.max(0, (t.seats_booked || 0) - (booking.pax_count || 1))
          const newStatus = t.status === 'full' && newBooked < t.capacity ? 'open' : t.status
          await db.collection('package_transports').updateOne({ id: t.id, tenant_id: T }, { $set: { seats_booked: newBooked, status: newStatus } })
        }
      }
      await db.collection('package_bookings').deleteOne({ id: bookingId, tenant_id: T })
      await maybeEmitMeraajInventory(db, T, pkgBookDelMatch[1])
      return ok({ success: true, booking_id: bookingId })
    }

    // v3.9.21 — PATCH a package booking (edit passenger data, recomputes balances + JE)
    if (pkgBookDelMatch && method === 'PATCH') {
      const [, pkgId2, bookingId2] = pkgBookDelMatch
      const body = await request.json()
      const oldBooking = await db.collection('package_bookings').findOne({ id: bookingId2, tenant_id: T, package_id: pkgId2 })
      if (!oldBooking) return bad('التسجيل غير موجود', 404)
      const pkgDoc = await db.collection('packages').findOne({ id: pkgId2, tenant_id: T })
      if (!pkgDoc) return bad('الباكج غير موجود', 404)
      if (pkgDoc.status === 'closed') return bad('الباكج مغلق — لا يمكن تعديل التسجيلات')
      const cur = oldBooking.currency || pkgDoc.currency || 'USD'
      const lightOnly = (
        (body.pax_count === undefined || Number(body.pax_count) === Number(oldBooking.pax_count)) &&
        (body.client_id === undefined || body.client_id === oldBooking.client_id) &&
        (body.payment_method === undefined || body.payment_method === oldBooking.payment_method) &&
        (body.box_id === undefined || body.box_id === (oldBooking.box_id || '')) &&
        body.total_cost === undefined && body.total_sale === undefined &&
        // v3.17 — a discount amount change affects money => full recalc required
        (body.discount === undefined || Number(body.discount) === Number(oldBooking.discount || 0)) &&
        // v3.19 — smart-discount flag or partner-commission changes => full recalc required
        (body.discount_apply_cost === undefined || !!body.discount_apply_cost === !!oldBooking.discount_apply_cost) &&
        (body.commission_partner_id === undefined || (body.commission_partner_id || null) === (oldBooking.commission_partner_id || null)) &&
        (body.commission_share_mode === undefined || body.commission_share_mode === (oldBooking.commission_share_mode || 'amount')) &&
        (body.commission_share_value === undefined || Number(body.commission_share_value) === Number(oldBooking.commission_share_value || 0)) &&
        (body.registrants === undefined)
      )
      if (lightOnly) {
        const updates = {}
        if (body.pilgrim_name !== undefined) updates.pilgrim_name = String(body.pilgrim_name || '').trim() || oldBooking.pilgrim_name
        if (body.passport_no !== undefined) updates.passport_no = String(body.passport_no || '').trim()
        if (body.notes !== undefined) updates.notes = String(body.notes || '').trim()
        if (body.discount_reason !== undefined) updates.discount_reason = String(body.discount_reason || '').trim().slice(0, 120)
        if (Object.keys(updates).length > 0) {
          await db.collection('package_bookings').updateOne({ id: bookingId2, tenant_id: T }, { $set: { ...updates, updated_at: new Date(), updated_by: sess.user.email } })
          const newName = updates.pilgrim_name || oldBooking.pilgrim_name
          await db.collection('journal_entries').updateOne(
            { ref_type: 'package_booking', ref_id: bookingId2, tenant_id: T },
            { $set: { description: `تسجيل ${newName} في ${pkgDoc.name} — ${oldBooking.pax_count} فرد (تعديل)` } }
          )
        }
        const updatedLight = await db.collection('package_bookings').findOne({ id: bookingId2, tenant_id: T })
        const { _id: _idL, ...restL } = updatedLight
        return ok({ ...restL, _light_update: true })
      }
      // FULL RECALC — v4.6 RAH-ACC FIX: previously the old balances were reversed and the
      // old JE deleted BEFORE the validations below (transport/client/box/leaf-accounts) —
      // any early return or thrown error left a PERMANENT partial state (balances reversed,
      // journal gone, booking unchanged). Now ALL validations + a JE dry-run happen FIRST;
      // destructive steps are grouped at the end.
      const oldJe = await db.collection('journal_entries').findOne({ ref_type: 'package_booking', ref_id: bookingId2, tenant_id: T })
      const existingJeId = oldJe?.id || undefined
      // v4.6 — closed year/period guard on the ORIGINAL journal date BEFORE any destructive step
      const perrPBE = await assertOpenPeriod(db, T, oldJe?.date || oldBooking.date || oldBooking.created_at)
      if (perrPBE) return bad(`الحجز الأصلي داخل فترة/سنة مقفلة — لا يمكن تعديله: ${perrPBE}`)
      const newPax = Math.max(1, Number(body.pax_count ?? oldBooking.pax_count) || 1)
      const newPay = body.payment_method === 'cash' ? 'cash' : (body.payment_method === 'credit' ? 'credit' : (oldBooking.payment_method || 'credit'))
      // v3.9.22 — Unified payment: credit needs client_id, cash needs box_id
      const newClientId = body.client_id !== undefined ? body.client_id : oldBooking.client_id
      let cli = null
      if (newClientId) {
        cli = await db.collection('clients').findOne({ id: newClientId, tenant_id: T })
        if (!cli && newPay === 'credit') return bad('العميل غير موجود')
      }
      if (newPay === 'credit' && !cli) return bad('اختر حساب القبض / العميل (للحجز الآجل)')
      let box = null
      if (newPay === 'cash') {
        const newBoxId = body.box_id || oldBooking.box_id
        if (!newBoxId) return bad('اختر الصندوق / البنك (للنقد)')
        box = await db.collection('boxes').findOne({ id: newBoxId, tenant_id: T })
        if (!box) return bad('الصندوق غير موجود')
      }
      // v3.9.26 — Transport switch validation
      let newTransport = null
      let oldTransport = null
      const newTransportId = body.transport_id !== undefined ? body.transport_id : oldBooking.transport_id
      if (newTransportId) {
        newTransport = await db.collection('package_transports').findOne({ id: newTransportId, tenant_id: T, package_id: pkgId2 })
        if (!newTransport) return bad('وسيلة النقل غير موجودة')
        // If switching transport OR changing pax_count, check new transport capacity
        if (newTransportId !== oldBooking.transport_id || newPax !== oldBooking.pax_count) {
          const currentUse = newTransportId === oldBooking.transport_id ? newTransport.seats_booked - oldBooking.pax_count : newTransport.seats_booked
          if ((currentUse + newPax) > newTransport.capacity) {
            return bad(`السعة غير كافية على "${newTransport.name}" (${currentUse}/${newTransport.capacity} — تحتاج ${newPax} مقعداً).`)
          }
        }
      }
      if (oldBooking.transport_id) {
        oldTransport = await db.collection('package_transports').findOne({ id: oldBooking.transport_id, tenant_id: T })
      }
      // v3.15/v3.20 — Registrants list update (edit mode) — computed BEFORE snapshots so dual pricing applies
      let newRegistrants = oldBooking.registrants || []
      let newRoomsSummary = oldBooking.rooms_summary || null
      if (body.registrants !== undefined) {
        newRegistrants = (Array.isArray(body.registrants) ? body.registrants : [])
          .filter(r => r && String(r.name || '').trim())
          .slice(0, 200)
          .map(r => ({
            name: String(r.name).trim().slice(0, 80),
            passport_no: String(r.passport_no || '').trim().toUpperCase().slice(0, 30),
            age: r.age === '' || r.age === null || r.age === undefined ? null : Math.max(0, Math.min(120, Number(r.age) || 0)),
            visa_no: String(r.visa_no || '').trim().slice(0, 40),
            room_type: String(r.room_type || '').trim().slice(0, 40),
          }))
        newRoomsSummary = {}
        for (const r of newRegistrants) if (r.room_type) newRoomsSummary[r.room_type] = (newRoomsSummary[r.room_type] || 0) + 1
        if (Object.keys(newRoomsSummary).length === 0) newRoomsSummary = null
      }
      // v3.20 — Derive pax categories for dual pricing (registrants override; fallback = legacy pax count)
      let npAdults = newPax, npChildren = 0, npInfants = 0
      if (newRegistrants.length > 0) {
        npAdults = newRegistrants.filter(r => ageCategoryOf(r.age) === 'adult').length
        npChildren = newRegistrants.filter(r => ageCategoryOf(r.age) === 'child').length
        npInfants = newRegistrants.filter(r => ageCategoryOf(r.age) === 'infant').length
      }
      const npBilled = newRegistrants.length > 0 ? (npAdults + npChildren) : newPax
      const npTotal = newRegistrants.length > 0 ? newRegistrants.length : newPax
      // v3.20 — Recompute component totals honoring frozen pricing_type in snapshots (flat / per_age / room_age)
      const newSnapshots = (oldBooking.component_snapshots || []).map(c => {
        const t = computeComponentTotals(c, newRegistrants, npBilled, npTotal)
        return { ...c, cost_total: t.cost_total, sale_total: t.sale_total }
      })
      let total_cost = +newSnapshots.reduce((s, c) => s + (c.cost_total || 0), 0).toFixed(2)
      let total_sale = +newSnapshots.reduce((s, c) => s + (c.sale_total || 0), 0).toFixed(2)
      // v3.17b/v3.20 — Direct room+age sale on full recalc (mirrors POST logic)
      const effModeP = pkgDoc.pricing_mode || ((Array.isArray(pkgDoc.room_pricing) && pkgDoc.room_pricing.length > 0) ? 'direct' : 'components')
      if (effModeP === 'direct' && newRegistrants.length > 0 && Array.isArray(pkgDoc.room_pricing) && pkgDoc.room_pricing.length > 0) {
        const roomSale = computeDirectRoomSale(pkgDoc.room_pricing, newRegistrants)
        if (roomSale > 0) total_sale = roomSale
      }
      // v3.17 — Manual discount on edit: explicit total_sale override wins; otherwise apply discount on computed sale
      const newDiscount = body.discount !== undefined ? Math.max(0, Number(body.discount) || 0) : (Number(oldBooking.discount) || 0)
      const newDiscountReason = body.discount_reason !== undefined ? String(body.discount_reason || '').trim().slice(0, 120) : (oldBooking.discount_reason || '')
      // v3.19 — Smart discount: flag to also reduce COST (mirrors POST logic)
      const newDiscountApplyCost = body.discount_apply_cost !== undefined ? !!body.discount_apply_cost : !!oldBooking.discount_apply_cost
      if (body.total_cost !== undefined && Number(body.total_cost) >= 0) total_cost = +Number(body.total_cost).toFixed(2)
      const baseCostBeforeDiscount = total_cost
      if (body.total_sale !== undefined && Number(body.total_sale) >= 0) total_sale = +Number(body.total_sale).toFixed(2)
      else if (newDiscount > 0) total_sale = +Math.max(0, total_sale - newDiscount).toFixed(2)
      if (newDiscount > 0 && newDiscountApplyCost) total_cost = +Math.max(0, total_cost - newDiscount).toFixed(2)
      // Distribute any cost-discount proportionally over supplier snapshots (keeps supplier balances + JE consistent)
      const costFactor = baseCostBeforeDiscount > 0 ? total_cost / baseCostBeforeDiscount : 1
      if (costFactor !== 1) {
        for (const c of newSnapshots) c.cost_total = +((c.cost_total || 0) * costFactor).toFixed(2)
      }
      const commission = +(total_sale - total_cost).toFixed(2)
      // v3.19 — Partner-commission share on edit: use new values if provided, otherwise keep old ones
      const pcType = body.commission_partner_type !== undefined ? (body.commission_partner_type || null) : (oldBooking.commission_partner_type || null)
      const pcId = body.commission_partner_id !== undefined ? (body.commission_partner_id || null) : (oldBooking.commission_partner_id || null)
      const pcName = body.commission_partner_name !== undefined ? String(body.commission_partner_name || '').trim().slice(0, 80) : (oldBooking.commission_partner_name || '')
      const pcMode = body.commission_share_mode !== undefined ? (body.commission_share_mode === 'percent' ? 'percent' : 'amount') : (oldBooking.commission_share_mode || 'amount')
      const pcValue = body.commission_share_value !== undefined ? Math.max(0, Number(body.commission_share_value) || 0) : (Number(oldBooking.commission_share_value) || 0)
      let newPartnerShare = 0
      if (pcId && pcValue > 0 && commission > 0) {
        newPartnerShare = pcMode === 'percent' ? +(commission * (pcValue / 100)).toFixed(2) : +pcValue.toFixed(2)
        newPartnerShare = Math.min(newPartnerShare, commission)
      }
      // v3.88.5 — F-007 STRICT: resolve LEAF accounts BEFORE any balance write (fails loudly
      // with zero side-effects for legacy parties — never a silent Group fallback)
      const payLeafA = newPay === 'cash' ? partyLeafCode(box) : partyLeafCode(cli)
      const supIdsA = [...new Set(newSnapshots.filter(c => c.supplier_id && c.cost_total).map(c => c.supplier_id))]
      const supDocsJE = Object.fromEntries((await db.collection('suppliers').find({ tenant_id: T, id: { $in: supIdsA } }).toArray()).map(s => [s.id, s]))
      for (const sid of supIdsA) partyLeafCode(supDocsJE[sid])
      const pcDocA = (newPartnerShare > 0 && pcId) ? await db.collection(pcType === 'supplier' ? 'suppliers' : 'clients').findOne({ id: pcId, tenant_id: T }) : null
      const pcLeafA = pcDocA ? partyLeafCode(pcDocA) : null
      // v4.6 — RAH-ACC: build + DRY-RUN validate the NEW journal BEFORE any destructive step
      // (accounts exist / no group / no inactive / balanced in base / open period —
      // a rejection here has ZERO side effects, nothing was reversed or deleted yet)
      const jeDatePB = oldJe?.date || oldBooking.created_at || new Date()
      const lines = []
      if (newPay === 'cash') lines.push({ account_code: payLeafA, account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: total_sale, credit: 0 })
      else lines.push({ account_code: payLeafA, account_name: 'حساب القبض', party_type: 'client', party_id: cli.id, party_name: cli.name, debit: total_sale, credit: 0 })
      const supGrouped = {}
      for (const c of newSnapshots) {
        if (!c.supplier_id || !c.cost_total) continue
        supGrouped[c.supplier_id] = supGrouped[c.supplier_id] || { name: c.supplier_name, amount: 0 }
        supGrouped[c.supplier_id].amount += c.cost_total
      }
      for (const [sid, x] of Object.entries(supGrouped)) lines.push({ account_code: partyLeafCode(supDocsJE[sid]), account_name: 'الموردون', party_type: 'supplier', party_id: sid, party_name: x.name, debit: 0, credit: +x.amount.toFixed(2) })
      // v3.19 — Balanced JE: revenue = sale - Σ(supplier credits) - partnerShare (mirrors POST logic)
      const supSumJE = +Object.values(supGrouped).reduce((s, x) => s + +x.amount.toFixed(2), 0).toFixed(2)
      const commissionJE = +(total_sale - supSumJE).toFixed(2)
      const revenueNet = +(commissionJE - newPartnerShare).toFixed(2)
      if (revenueNet !== 0) lines.push({ account_code: COA.REV_SERVICES, account_name: 'إيرادات خدمات إضافية', party_type: 'revenue', party_id: null, party_name: `إيراد باكج ${pkgDoc.name}`, debit: 0, credit: revenueNet })
      if (newPartnerShare > 0) lines.push({ account_code: pcLeafA, account_name: pcType === 'supplier' ? 'الموردون' : 'العملاء', party_type: pcType, party_id: pcId, party_name: pcName || 'شريك عمولة', debit: 0, credit: newPartnerShare }) // v3.88.5 — pre-resolved leaf
      try {
        await enforceJournalInvariants(db, T, { date: jeDatePB, currency: cur, lines })
      } catch (invErr) {
        return bad(`تعذر التعديل — القيد الجديد مرفوض قبل تنفيذ أي أثر مالي: ${invErr.message}`)
      }
      // ===== v4.6 — destructive steps start ONLY here (every validation above passed) =====
      const oldPay = oldBooking.payment_method || 'credit'
      if (oldPay === 'cash' && oldBooking.box_id) {
        await updateBalance(db, 'boxes', { id: oldBooking.box_id, tenant_id: T }, cur, -(oldBooking.total_sale || 0))
      } else if (oldBooking.client_id) {
        await updateBalance(db, 'clients', { id: oldBooking.client_id, tenant_id: T }, cur, -(oldBooking.total_sale || 0))
      }
      if (Array.isArray(oldBooking.component_snapshots)) {
        for (const comp of oldBooking.component_snapshots) {
          if (comp.supplier_id && comp.cost_total) {
            await updateBalance(db, 'suppliers', { id: comp.supplier_id, tenant_id: T }, cur, -(comp.cost_total || 0))
          }
        }
      }
      // v3.19 — Reverse old partner-commission share balance (it was applied as a negative on create)
      if ((Number(oldBooking.commission_share_amount) || 0) > 0 && oldBooking.commission_partner_id) {
        const oldPcCol = oldBooking.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
        await updateBalance(db, oldPcCol, { id: oldBooking.commission_partner_id, tenant_id: T }, cur, +(Number(oldBooking.commission_share_amount) || 0))
      }
      if (oldJe) await db.collection('journal_entries').deleteOne({ id: oldJe.id, tenant_id: T }) // v4.6 — tenant-scoped
      if (newPay === 'cash') {
        await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, cur, total_sale)
      } else {
        await updateBalance(db, 'clients', { id: cli.id, tenant_id: T }, cur, total_sale)
      }
      for (const c of newSnapshots) {
        if (c.supplier_id && c.cost_total) {
          await updateBalance(db, 'suppliers', { id: c.supplier_id, tenant_id: T }, cur, c.cost_total)
        }
      }
      // v3.19 — Apply new partner-commission share balance (negative = we owe the partner)
      if (newPartnerShare > 0 && pcId) {
        const pcCol = pcType === 'supplier' ? 'suppliers' : 'clients'
        await updateBalance(db, pcCol, { id: pcId, tenant_id: T }, cur, -newPartnerShare)
      }
      const updatedBooking = {
        ...oldBooking,
        client_id: cli?.id || null,
        client_name: cli?.name || (newPay === 'cash' ? (oldBooking.client_name || 'عميل نقدي') : ''),
        pilgrim_name: (body.pilgrim_name !== undefined ? String(body.pilgrim_name || '').trim() : oldBooking.pilgrim_name) || cli?.name || oldBooking.pilgrim_name || 'مسافر نقدي',
        passport_no: body.passport_no !== undefined ? String(body.passport_no || '').trim() : (oldBooking.passport_no || ''),
        registrants: newRegistrants,
        rooms_summary: newRoomsSummary,
        pax_count: newPax, currency: cur,
        // v3.20 — keep age-category breakdown in sync on edit
        pax_adults: npAdults, pax_children: npChildren, pax_infants: npInfants,
        pax_billed: npBilled, pax_seats: npBilled,
        total_cost, total_sale, commission,
        discount: newDiscount, discount_reason: newDiscountReason, discount_apply_cost: newDiscountApplyCost,
        commission_partner_type: pcType,
        commission_partner_id: pcId,
        commission_partner_name: pcName,
        commission_share_mode: pcMode,
        commission_share_value: pcValue,
        commission_share_amount: newPartnerShare,
        payment_method: newPay,
        box_id: box?.id || null, box_name: box?.name_ar || null,
        transport_id: newTransport?.id || null,
        transport_name: newTransport?.name || null,
        transport_type: newTransport?.type || null,
        component_snapshots: newSnapshots,
        notes: body.notes !== undefined ? String(body.notes || '').trim() : (oldBooking.notes || ''),
        updated_at: new Date(), updated_by: sess.user.email,
      }
      delete updatedBooking._id
      await db.collection('package_bookings').replaceOne({ id: bookingId2, tenant_id: T }, updatedBooking)
      // v3.9.26 — Adjust transport seat counts
      if (oldTransport && (!newTransport || oldTransport.id !== newTransport.id)) {
        // Old transport loses old pax
        const oldNewBooked = Math.max(0, oldTransport.seats_booked - oldBooking.pax_count)
        const oldNewStatus = oldTransport.status === 'full' && oldNewBooked < oldTransport.capacity ? 'open' : oldTransport.status
        await db.collection('package_transports').updateOne({ id: oldTransport.id, tenant_id: T }, { $set: { seats_booked: oldNewBooked, status: oldNewStatus } })
      }
      if (newTransport) {
        const delta = newTransport.id === oldBooking.transport_id ? (newPax - oldBooking.pax_count) : newPax
        const target = await db.collection('package_transports').findOne({ id: newTransport.id, tenant_id: T })
        const newBooked = Math.max(0, (target.seats_booked || 0) + delta)
        const newStatus = newBooked >= target.capacity ? 'full' : (target.status === 'full' && newBooked < target.capacity ? 'open' : target.status)
        await db.collection('package_transports').updateOne({ id: newTransport.id, tenant_id: T }, { $set: { seats_booked: newBooked, status: newStatus } })
      }
      await createJournalEntry(db, T, {
        date: jeDatePB,
        description: `تسجيل ${updatedBooking.pilgrim_name} في ${pkgDoc.name} — ${newPax} فرد (تعديل)${newPartnerShare > 0 ? ` — عمولة مشتركة ${newPartnerShare} مع ${pcName || 'شريك'}` : ''}`,
        ref_type: 'package_booking', ref_id: bookingId2, currency: cur, lines,
      }, { skipQuota: true, existingJeId, createdAt: oldJe?.created_at || new Date() })
      await maybeEmitMeraajInventory(db, T, pkgId2)
      return ok({ ...updatedBooking, _id: undefined, _full_recalc: true })
    }


    // v3.9.20 — Data Backup: Export full tenant snapshot as JSON (Owner only)
    if (route === '/backup/export' && method === 'GET') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — نسخ احتياطي متاح للمالك فقط', 403)
      const collections = ['tickets', 'visas', 'services', 'clients', 'suppliers', 'boxes', 'journal_entries', 'packages', 'package_bookings', 'currency_exchanges', 'vouchers', 'accounts', 'service_types']
      const backup = { tenant_id: T, tenant_name: sess.tenant?.name, exported_at: new Date().toISOString(), exported_by: sess.user.email, version: '3.9.20', data: {} }
      for (const coll of collections) {
        try {
          const docs = await db.collection(coll).find({ tenant_id: T }).toArray()
          backup.data[coll] = docs.map(d => { const { _id, ...rest } = d; return rest })
        } catch (e) { backup.data[coll] = { error: e.message } }
      }
      // Return as JSON download
      const filename = `rahaal-backup-${sess.tenant?.slug || T}-${new Date().toISOString().slice(0,10)}.json`
      return new NextResponse(JSON.stringify(backup, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }
    if (pkgBookMatch && method === 'POST') {
      const b = await request.json()
      const pkgId = pkgBookMatch[1]
      const pkg = await db.collection('packages').findOne({ id: pkgId, tenant_id: T })
      if (!pkg) return bad('الباكج غير موجود', 404)
      if (pkg.status === 'closed') return bad('الباكج مغلق — لا يمكن إضافة تسجيلات جديدة')
      const payMethod = b.payment_method === 'cash' ? 'cash' : 'credit'
      // v3.9.22 — Unified payment: credit needs client_id, cash needs box_id
      if (payMethod === 'credit' && !b.client_id) return bad('اختر حساب القبض / العميل (للحجز الآجل)')
      if (payMethod === 'cash' && !b.box_id) return bad('اختر الصندوق / البنك (للنقد)')
      // v3.51 — RBAC Phase 3: smart discount restricted to owner / apply_discount holders (server-enforced)
      if ((Number(b.discount) || 0) > 0 && sess.user.role !== 'owner' && !effectivePermissions(sess.user).apply_discount) {
        return bad('🚫 غير مصرح — الخصم الذكي حصري لمدير المبيعات والمالك', 403)
      }
      // v3.51 — RBAC Phase 3: cash bookings must use an allowed box
      {
        const abIds = Array.isArray(sess.user.allowed_box_ids) ? sess.user.allowed_box_ids : []
        if (payMethod === 'cash' && sess.user.role !== 'owner' && abIds.length > 0 && !abIds.includes(String(b.box_id))) {
          return bad('🚫 غير مصرح — هذا الصندوق خارج الصناديق المسموحة لك', 403)
        }
      }
      // v3.15 — Registrants dynamic list: [{name, passport_no, age, visa_no, room_type}]
      const registrants = (Array.isArray(b.registrants) ? b.registrants : [])
        .filter(r => r && String(r.name || '').trim())
        .slice(0, 200)
        .map(r => ({
          name: String(r.name).trim().slice(0, 80),
          passport_no: String(r.passport_no || '').trim().toUpperCase().slice(0, 30),
          age: r.age === '' || r.age === null || r.age === undefined ? null : Math.max(0, Math.min(120, Number(r.age) || 0)),
          visa_no: String(r.visa_no || '').trim().slice(0, 40),
          room_type: String(r.room_type || '').trim().slice(0, 40),
        }))
      // v3.9.26 — Transport capacity check (uses pax_seats: adults + children, excludes infants)
      // v3.9.28 — Age category breakdown (adults, children, infants)
      let paxAdults = Math.max(0, Number(b.pax_adults) || 0)
      let paxChildren = Math.max(0, Number(b.pax_children) || 0)
      let paxInfants = Math.max(0, Number(b.pax_infants) || 0)
      // v3.15 — When a registrants list is provided, derive categories from ages automatically
      if (registrants.length > 0) {
        paxAdults = registrants.filter(r => r.age === null || r.age >= 12).length
        paxChildren = registrants.filter(r => r.age !== null && r.age >= 2 && r.age < 12).length
        paxInfants = registrants.filter(r => r.age !== null && r.age < 2).length
      }
      // Backward compat: if none provided, treat pax_count as all adults
      const legacyPax = Math.max(1, Number(b.pax_count) || 1)
      const totalPax = paxAdults + paxChildren + paxInfants > 0 ? (paxAdults + paxChildren + paxInfants) : legacyPax
      const paxBilled = paxAdults + paxChildren + paxInfants > 0 ? (paxAdults + paxChildren) : legacyPax
      const paxSeats = paxAdults + paxChildren + paxInfants > 0 ? (paxAdults + paxChildren) : legacyPax
      let transport = null
      if (b.transport_id) {
        transport = await db.collection('package_transports').findOne({ id: b.transport_id, tenant_id: T, package_id: pkgId })
        if (!transport) return bad('وسيلة النقل غير موجودة')
        if (transport.status === 'closed') return bad(`وسيلة النقل "${transport.name}" مغلقة — اختر وسيلة أخرى`)
        if ((transport.seats_booked + paxSeats) > transport.capacity) {
          return bad(`السعة مكتملة على "${transport.name}" (${transport.seats_booked}/${transport.capacity}). أضف وسيلة نقل جديدة أو اختر أخرى تحتوي على مقاعد متاحة.`)
        }
      }
      const cli = b.client_id ? await db.collection('clients').findOne({ id: b.client_id, tenant_id: T }) : null
      if (payMethod === 'credit' && !cli) return bad('العميل غير موجود')
      const comps = await db.collection('package_components').find({ tenant_id: T, package_id: pkgId }).toArray()
      // v3.39 — UNIFIED PRICING: in direct mode with a room price table, components are optional details
      // (sale comes from room_pricing; component costs are optional supplier accounting)
      const hasDirectRooms = (pkg.pricing_mode || ((pkg.room_pricing || []).length > 0 ? 'direct' : 'components')) === 'direct' && (pkg.room_pricing || []).length > 0
      if (comps.length === 0 && !hasDirectRooms) return bad('لا توجد مكونات في الباكج — أضف المكونات قبل التسجيل')
      const pax = totalPax
      const cur = pkg.currency
      // v3.20 — DUAL PRICING: per-component totals honoring pricing_type (flat / per_age / room_age)
      const compTotals = comps.map(c => computeComponentTotals(c, registrants, paxBilled, totalPax))
      let total_cost = +compTotals.reduce((s, t) => s + t.cost_total, 0).toFixed(2)
      let total_sale = +compTotals.reduce((s, t) => s + t.sale_total, 0).toFixed(2)
      // Rooms breakdown summary (always derived from registrants)
      let rooms_summary = null
      if (registrants.length > 0) {
        rooms_summary = {}
        for (const r of registrants) if (r.room_type) rooms_summary[r.room_type] = (rooms_summary[r.room_type] || 0) + 1
        if (Object.keys(rooms_summary).length === 0) rooms_summary = null
      }
      // v3.20 — Effective pricing mode: explicit pkg.pricing_mode wins; legacy fallback = 'direct' when room prices exist
      const effMode = pkg.pricing_mode || ((Array.isArray(pkg.room_pricing) && pkg.room_pricing.length > 0) ? 'direct' : 'components')
      if (effMode === 'direct' && registrants.length > 0 && Array.isArray(pkg.room_pricing) && pkg.room_pricing.length > 0) {
        // Direct B2B pricing: sale from room+age matrix (adult=sale_per_pax, child falls back to adult, infant defaults 0)
        const roomSale = computeDirectRoomSale(pkg.room_pricing, registrants)
        if (roomSale > 0) total_sale = roomSale
      }
      // v3.17 — Manual booking discount (B2B flexibility: child no-bed, infant, partner-office courtesy...)
      // v3.19 — Smart discount: optional checkbox also reduces COST (keeps margin when a service like a bed is excluded)
      const discount = Math.max(0, Number(b.discount) || 0)
      const discountReason = String(b.discount_reason || '').trim().slice(0, 120)
      const discountApplyCost = !!b.discount_apply_cost
      const baseCostBeforeDiscount = total_cost
      if (discount > 0) {
        total_sale = +Math.max(0, total_sale - discount).toFixed(2)
        if (discountApplyCost) total_cost = +Math.max(0, total_cost - discount).toFixed(2)
      }
      const costFactor = baseCostBeforeDiscount > 0 ? total_cost / baseCostBeforeDiscount : 1
      const commission = +(total_sale - total_cost).toFixed(2)
      let box = null
      if (payMethod === 'cash') {
        box = await db.collection('boxes').findOne({ id: b.box_id, tenant_id: T })
        if (!box) return bad('الصندوق غير موجود')
      }
      const bookingDoc = {
        id: uuidv4(), tenant_id: T, package_id: pkgId,
        client_id: cli?.id || null,
        client_name: cli?.name || (payMethod === 'cash' ? (b.client_name || 'عميل نقدي') : ''),
        pilgrim_name: b.pilgrim_name || registrants[0]?.name || cli?.name || 'مسافر نقدي',
        passport_no: b.passport_no || registrants[0]?.passport_no || '',
        // v3.15 — Registrants list + rooms breakdown
        registrants,
        rooms_summary,
        pax_count: pax, currency: cur,
        // v3.9.28 — Age category breakdown
        pax_adults: paxAdults || (paxAdults + paxChildren + paxInfants === 0 ? legacyPax : 0),
        pax_children: paxChildren,
        pax_infants: paxInfants,
        pax_billed: paxBilled,
        pax_seats: paxSeats,
        birth_date: b.birth_date || null,
        age_category: b.age_category || null,
        total_cost, total_sale, commission,
        discount, discount_reason: discountReason, discount_apply_cost: discountApplyCost,
        payment_method: payMethod, box_id: box?.id || null, box_name: box?.name_ar || null,
        transport_id: transport?.id || null,
        transport_name: transport?.name || null,
        transport_type: transport?.type || null,
        component_snapshots: comps.map((c, i) => ({
          id: c.id, name: c.name, supplier_id: c.supplier_id, supplier_name: c.supplier_name,
          cost_per_pax: c.cost_per_pax, sale_per_pax: c.sale_per_pax,
          // v3.20 — freeze dual-pricing details so edits recompute correctly
          pricing_type: c.pricing_type || 'flat', include_infants: !!c.include_infants,
          ...(c.pricing_type === 'per_age' ? { cost_adult: c.cost_adult, cost_child: c.cost_child, cost_infant: c.cost_infant, sale_adult: c.sale_adult, sale_child: c.sale_child, sale_infant: c.sale_infant } : {}),
          ...(c.pricing_type === 'room_age' ? { room_rates: c.room_rates || [] } : {}),
          cost_total: +(compTotals[i].cost_total * costFactor).toFixed(2),
          sale_total: compTotals[i].sale_total,
        })),
        notes: b.notes || '', created_at: new Date(), created_by: sess.user.email,
      }
      await db.collection('package_bookings').insertOne(bookingDoc)
      // v3.9.26 — Increment transport seats_booked and auto-close on full
      // v3.9.28 — Only adults + children take seats (infants free)
      if (transport) {
        const newBooked = transport.seats_booked + paxSeats
        const newStatus = newBooked >= transport.capacity ? 'full' : transport.status
        await db.collection('package_transports').updateOne({ id: transport.id, tenant_id: T }, { $set: { seats_booked: newBooked, status: newStatus } })
      }
      // v3.19 — Partner commission share (generalized from tickets)
      bookingDoc.commission_partner_type = b.commission_partner_type || null
      bookingDoc.commission_partner_id = b.commission_partner_id || null
      bookingDoc.commission_partner_name = b.commission_partner_name || ''
      bookingDoc.commission_share_mode = b.commission_share_mode === 'percent' ? 'percent' : 'amount'
      bookingDoc.commission_share_value = Number(b.commission_share_value) || 0
      let partnerShare = 0
      if (bookingDoc.commission_partner_id && bookingDoc.commission_share_value > 0 && commission > 0) {
        if (bookingDoc.commission_share_mode === 'percent') partnerShare = +(commission * (bookingDoc.commission_share_value / 100)).toFixed(2)
        else partnerShare = +Number(bookingDoc.commission_share_value).toFixed(2)
        partnerShare = Math.min(partnerShare, commission)
      }
      bookingDoc.commission_share_amount = partnerShare
      const officeNetCommission = +(commission - partnerShare).toFixed(2)
      // Persist partner-share fields (booking was already inserted above)
      if (bookingDoc.commission_partner_id || partnerShare > 0) {
        await db.collection('package_bookings').updateOne({ id: bookingDoc.id, tenant_id: T }, {
          $set: {
            commission_partner_type: bookingDoc.commission_partner_type,
            commission_partner_id: bookingDoc.commission_partner_id,
            commission_partner_name: bookingDoc.commission_partner_name,
            commission_share_mode: bookingDoc.commission_share_mode,
            commission_share_value: bookingDoc.commission_share_value,
            commission_share_amount: partnerShare,
          }
        })
      }
      // v3.88.5 — F-007 STRICT: resolve LEAF accounts BEFORE any balance write (fails loudly
      // with zero side-effects for legacy parties — never a silent Group fallback)
      const payLeafPB = payMethod === 'cash' ? partyLeafCode(box) : partyLeafCode(cli)
      const supIdsPB = [...new Set(comps.map(c => c.supplier_id))]
      const supDocsPB = Object.fromEntries((await db.collection('suppliers').find({ tenant_id: T, id: { $in: supIdsPB } }).toArray()).map(s => [s.id, s]))
      for (const sid of supIdsPB) partyLeafCode(supDocsPB[sid])
      const pbPartnerDocPre = (partnerShare > 0 && bookingDoc.commission_partner_id) ? await db.collection(bookingDoc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients').findOne({ id: bookingDoc.commission_partner_id, tenant_id: T }) : null
      const partnerLeafPB = pbPartnerDocPre ? partyLeafCode(pbPartnerDocPre) : null
      // Balances (v3.19: costFactor distributes any cost-discount proportionally over suppliers)
      if (payMethod === 'cash') await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, cur, total_sale)
      else await updateBalance(db, 'clients', { id: cli.id, tenant_id: T }, cur, total_sale)
      for (let i = 0; i < comps.length; i++) await updateBalance(db, 'suppliers', { id: comps[i].supplier_id, tenant_id: T }, cur, +(compTotals[i].cost_total * costFactor).toFixed(2))
      if (partnerShare > 0 && bookingDoc.commission_partner_id) {
        const col = bookingDoc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
        await updateBalance(db, col, { id: bookingDoc.commission_partner_id, tenant_id: T }, cur, -partnerShare)
      }
      // Single combined JE — mathematically balanced: revenue = sale - Σ(supplier credits) - partnerShare
      const lines = []
      if (payMethod === 'cash') lines.push({ account_code: payLeafPB, account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: total_sale, credit: 0 })
      else lines.push({ account_code: payLeafPB, account_name: 'حساب القبض', party_type: 'client', party_id: cli.id, party_name: cli.name, debit: total_sale, credit: 0 })
      const supGrouped = {}
      for (let i = 0; i < comps.length; i++) { const c = comps[i]; supGrouped[c.supplier_id] = (supGrouped[c.supplier_id] || { name: c.supplier_name, amount: 0 }); supGrouped[c.supplier_id].amount += compTotals[i].cost_total * costFactor }
      let supSum = 0
      for (const [sid, x] of Object.entries(supGrouped)) { const amt = +x.amount.toFixed(2); supSum += amt; lines.push({ account_code: partyLeafCode(supDocsPB[sid]), account_name: 'الموردون', party_type: 'supplier', party_id: sid, party_name: x.name, debit: 0, credit: amt }) }
      const commissionJE = +(total_sale - supSum).toFixed(2)
      const revenueNet = +(commissionJE - partnerShare).toFixed(2)
      if (revenueNet !== 0) lines.push({ account_code: COA.REV_SERVICES, account_name: 'إيرادات خدمات إضافية', party_type: 'revenue', party_id: null, party_name: `إيراد باكج ${pkg.name}`, debit: 0, credit: revenueNet })
      if (partnerShare > 0) lines.push({ account_code: partnerLeafPB, account_name: bookingDoc.commission_partner_type === 'supplier' ? 'الموردون' : 'العملاء', party_type: bookingDoc.commission_partner_type, party_id: bookingDoc.commission_partner_id, party_name: bookingDoc.commission_partner_name || 'شريك عمولة', debit: 0, credit: partnerShare }) // v3.88.5 — pre-resolved leaf
      await createJournalEntry(db, T, {
        date: new Date(), description: `تسجيل ${bookingDoc.pilgrim_name} في ${pkg.name} — ${pax} فرد${partnerShare > 0 ? ` — عمولة مشتركة ${partnerShare} مع ${bookingDoc.commission_partner_name}` : ''}`,
        ref_type: 'package_booking', ref_id: bookingDoc.id, currency: cur, lines,
      })
      const { _id, ...rest } = bookingDoc
      await maybeEmitMeraajInventory(db, T, pkgBookMatch[1])
      return ok(rest)
    }

    // Package closing report
    const pkgReportMatch = route.match(/^\/packages\/([^/]+)\/report$/)
    if (pkgReportMatch && method === 'GET') {
      const pkgId = pkgReportMatch[1]
      const pkg = await db.collection('packages').findOne({ id: pkgId, tenant_id: T })
      if (!pkg) return bad('الباكج غير موجود', 404)
      const bookings = await db.collection('package_bookings').find({ tenant_id: T, package_id: pkgId }).sort({ created_at: 1 }).toArray()
      const totals = { bookings: bookings.length, pax: 0, revenue: 0, cost: 0, profit: 0 }
      for (const b of bookings) { totals.pax += b.pax_count; totals.revenue += b.total_sale; totals.cost += b.total_cost; totals.profit += b.commission }
      const supplierBreakdown = {}
      for (const b of bookings) {
        for (const s of b.component_snapshots || []) {
          const key = s.supplier_id
          supplierBreakdown[key] = supplierBreakdown[key] || { name: s.supplier_name, cost: 0 }
          supplierBreakdown[key].cost += s.cost_total
        }
      }
      return ok({
        package: { ...pkg, _id: undefined },
        totals,
        margin_pct: totals.revenue > 0 ? +((totals.profit / totals.revenue) * 100).toFixed(2) : 0,
        bookings: bookings.map(b => ({ ...b, _id: undefined })),
        supplier_breakdown: Object.values(supplierBreakdown).map(s => ({ ...s, cost: +s.cost.toFixed(2) })).sort((a,b) => b.cost - a.cost),
      })
    }

    // ============ v3.5 — BULK STATEMENT SEND ============
    if (route === '/bulk-statement/generate' && method === 'POST') {
      const b = await request.json()
      const kind = b.kind || 'clients'   // 'clients' | 'suppliers'
      const period = b.period || 'month' // 'month' | 'all'
      const officeName = sess.tenant?.name || 'مكتب رحّال'
      const parties = await db.collection(kind).find({ tenant_id: T }).sort({ name: 1 }).toArray()
      const now = new Date()
      const results = []
      for (const p of parties) {
        if (!p.phone && !p.whatsapp) continue
        // Skip if all balances are zero
        const bals = p.balances || {}
        const hasBalance = ['USD', 'SAR', 'YER'].some(c => Math.abs(bals[c] || 0) > 0.01)
        if (!hasBalance) continue
        // Get last 5 transactions from journal entries
        const recentLines = await db.collection('journal_entries').aggregate([
          { $match: { tenant_id: T, [kind === 'clients' ? 'lines.party_type' : 'lines.party_type']: kind === 'clients' ? 'client' : 'supplier' } },
          { $sort: { date: -1 } }, { $limit: 100 },
          { $unwind: '$lines' },
          { $match: { 'lines.party_id': p.id } },
          { $limit: 5 },
        ]).toArray()
        const balanceLines = ['USD', 'SAR', 'YER']
          .map(c => { const bal = bals[c] || 0; return bal !== 0 ? `• ${c}: ${bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${bal >= 0 ? '(لكم)' : '(علينا)'}` : null })
          .filter(Boolean).join('\n') || '• لا توجد أرصدة'
        const recentText = recentLines.length > 0
          ? '\n\n📋 آخر ' + recentLines.length + ' حركات:\n' + recentLines.map(je => {
              const l = je.lines
              const amt = (l.debit || 0) - (l.credit || 0)
              const dc = amt > 0 ? `مدين ${Math.abs(amt).toFixed(2)}` : `دائن ${Math.abs(amt).toFixed(2)}`
              return `• ${new Date(je.date).toISOString().slice(0,10)} — ${(je.description || '').slice(0,40)} (${dc})`
            }).join('\n') : ''
        const msg = `عزيزنا ${kind === 'clients' ? 'العميل' : 'المورد'} ${p.name}،\n\n📊 هذا ملخص كشف حسابكم لدى ${officeName}\n📅 حتى: ${now.toISOString().slice(0,10)}\n\n💰 الأرصدة الحالية:\n${balanceLines}${recentText}\n\n📞 للاستفسار عن أي حركة تواصل معنا مباشرة.\nشكراً لثقتكم بنا 🌹`
        const phone = p.whatsapp || p.phone
        // Basic normalization matching frontend logic
        let d = String(phone).replace(/[^\d]/g, '')
        if (d.startsWith('00')) d = d.slice(2)
        if (d.startsWith('0')) d = '967' + d.slice(1)
        if (d.length === 9 && d.startsWith('7')) d = '967' + d
        if (d.length === 9 && d.startsWith('5')) d = '966' + d
        results.push({
          id: p.id, name: p.name, phone: p.phone, whatsapp: p.whatsapp || p.phone,
          balances: bals, message: msg,
          wa_link: `https://wa.me/${d}?text=${encodeURIComponent(msg)}`,
        })
      }
      return ok({ count: results.length, items: results })
    }


    // ============ UNIFIED CHART OF ACCOUNTS (for FX 'account' mode + Statement) ============
    if (route === '/accounts/all' && method === 'GET') {
      const [clients, suppliers, boxes, coa] = await Promise.all([
        db.collection('clients').find(tf).sort({ name: 1 }).toArray(),
        db.collection('suppliers').find(tf).sort({ name: 1 }).toArray(),
        db.collection('boxes').find(tf).sort({ name_ar: 1 }).toArray(),
        db.collection('accounts').find(tf).sort({ code: 1 }).toArray(),
      ])
      const list = [
        ...clients.map(c => ({ kind: 'client', id: c.id, code: COA.CLIENTS, name: c.name, group: 'العملاء', balances: c.balances })),
        ...suppliers.map(s => ({ kind: 'supplier', id: s.id, code: COA.SUPPLIERS, name: s.name, group: 'الموردون', balances: s.balances })),
        ...boxes.map(b => ({ kind: 'box', id: b.id, code: b.type === 'cash' ? COA.CASHBOXES : COA.BANKS, name: b.name_ar, group: b.type === 'cash' ? 'الصناديق' : 'البنوك', balances: b.balances })),
        ...coa.map(a => ({ kind: 'account', id: a.id, code: a.code, name: a.name_ar || a.name, group: a.type || 'دليل الحسابات' })),
      ]
      return ok(list)
    }

    // ============ TOMORROW TRAVELERS ============
    if (route === '/dashboard/tomorrow-travelers' && method === 'GET') {
      const now = new Date()
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
      const dayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, 0)
      const tickets = await db.collection('tickets').find({ tenant_id: T, travel_date: { $gte: tomorrow, $lt: dayAfter } }).sort({ travel_date: 1 }).toArray()
      // Enrich with client phone
      const cliMap = {}
      const cliIds = [...new Set(tickets.map(t => t.client_id).filter(Boolean))]
      if (cliIds.length) {
        const cs = await db.collection('clients').find({ tenant_id: T, id: { $in: cliIds } }).toArray()
        for (const c of cs) cliMap[c.id] = c
      }
      const rows = tickets.map(t => {
        const c = cliMap[t.client_id] || {}
        return {
          id: t.id, pnr: t.pnr, route: t.route,
          passenger_name: t.passenger_name || c.name || '',
          passport_no: t.passport_no,
          travel_date: t.travel_date,
          // v3.2 — Include travel_mode, departure_time, phone/whatsapp for smart WhatsApp templates
          travel_mode: t.travel_mode || 'air',
          departure_time: t.departure_time || '',
          passenger_phone: t.passenger_phone || c.phone || '',
          passenger_whatsapp: t.passenger_whatsapp || c.whatsapp || c.phone || '',
          client_name: t.client_name,
          client_phone: c.phone || '',
          client_whatsapp: c.whatsapp || c.phone || '',
          currency: t.currency, sale_price: t.sale_price,
        }
      })
      return ok(rows)
    }
    if (route === '/rates' && method === 'POST') {
      const body = await request.json()
      // v3.88.4 — F-003: coherent bounds per currency — min ≤ buy ≤ transfer ≤ sell ≤ max.
      // Inverted bounds are rejected instead of silently stored.
      for (const [ccy, r] of Object.entries(body.rates || {})) {
        if (!r || typeof r !== 'object') continue
        const named = [['الحد الأدنى', Number(r.min)], ['الشراء', Number(r.buy)], ['التحويل', Number(r.transfer)], ['البيع', Number(r.sell)], ['الحد الأعلى', Number(r.max)]]
        if (named.some(([, v]) => Number.isFinite(v) && v < 0)) return bad(`أسعار ${ccy}: لا تُقبل قيم سالبة`)
        const seq = named.filter(([, v]) => Number.isFinite(v) && v > 0)
        for (let i = 1; i < seq.length; i++) {
          if (seq[i][1] < seq[i - 1][1]) return bad(`أسعار ${ccy} غير متسقة: ${seq[i - 1][0]} (${seq[i - 1][1]}) أكبر من ${seq[i][0]} (${seq[i][1]}) — الترتيب الصحيح: أدنى ≤ شراء ≤ تحويل ≤ بيع ≤ أعلى`)
        }
      }
      await db.collection('tenant_settings').updateOne(tf, { $set: { rates: body.rates, updated_at: new Date() } }, { upsert: true })
      return ok({ success: true })
    }

    // Clients
    if (route === '/clients' && method === 'GET') return ok(clean(await db.collection('clients').find(tf).sort({ created_at: -1 }).toArray()))
    if (route === '/clients' && method === 'POST') {
      const b = await request.json()
      if (!b.name) return bad('اسم العميل مطلوب')
      if (b.credit_limit !== undefined && Number(b.credit_limit) < 0) return bad('سقف الائتمان لا يقبل قيمة سالبة') // v3.88.4 — F-005
      const parent_code = String(b.parent_code || COA.CLIENTS) // v3.9.3 — default to العملاء (مدينون)
      let accountInfo = {}
      try { accountInfo = await generateSubAccountCode(db, T, parent_code) } catch (e) { return bad(e.message) }
      const doc = {
        id: uuidv4(), tenant_id: T, name: b.name, phone: b.phone || '', whatsapp: b.whatsapp || b.phone || '',
        address: b.address || '', email: b.email || '', notes: b.notes || '', parent_code, ...accountInfo,
        credit_limit: Number(b.credit_limit) || 0,  // v3.10.6 — 0 = no limit
        credit_currency: b.credit_currency || 'USD',
        is_frozen: !!b.is_frozen,
        balances: emptyBalances(), created_at: new Date()
      }
      await db.collection('clients').insertOne(doc)
      const { _id, ...rest } = doc; return ok(rest)
    }
    // v3.2 — Update client contact info
    const clientIdMatch = route.match(/^\/clients\/([^/]+)$/)
    if (clientIdMatch && method === 'PUT') {
      const b = await request.json()
      if (b.credit_limit !== undefined && Number(b.credit_limit) < 0) return bad('سقف الائتمان لا يقبل قيمة سالبة') // v3.88.4 — F-005
      const upd = {}
      for (const k of ['name', 'phone', 'whatsapp', 'address', 'email', 'notes', 'parent_code', 'credit_limit', 'credit_currency', 'is_frozen']) if (b[k] !== undefined) upd[k] = k === 'credit_limit' ? (Number(b[k]) || 0) : k === 'is_frozen' ? !!b[k] : b[k]
      await db.collection('clients').updateOne({ id: clientIdMatch[1], tenant_id: T }, { $set: upd })
      // v3.92 — keep the linked COA account (if one exists for this code) in sync by IDENTITY
      if (upd.name !== undefined) {
        const c0 = await db.collection('clients').findOne({ id: clientIdMatch[1], tenant_id: T }, { projection: { account_code: 1 } })
        if (c0?.account_code) await db.collection('accounts').updateOne({ tenant_id: T, code: c0.account_code }, { $set: { name_ar: upd.name } })
      }
      return ok({ success: true })
    }
    if (clientIdMatch && method === 'DELETE') {
      // Only delete if no transactions
      const cid = clientIdMatch[1]
      const hasTx = await db.collection('tickets').findOne({ tenant_id: T, client_id: cid })
        || await db.collection('visas').findOne({ tenant_id: T, client_id: cid })
        || await db.collection('services').findOne({ tenant_id: T, client_id: cid })
      if (hasTx) return bad('لا يمكن حذف عميل له حركات — احذف الحركات أولاً')
      await db.collection('clients').deleteOne({ id: cid, tenant_id: T })
      return ok({ success: true })
    }

    // Suppliers
    if (route === '/suppliers' && method === 'GET') return ok(clean(await db.collection('suppliers').find(tf).sort({ created_at: -1 }).toArray()))
    if (route === '/suppliers' && method === 'POST') {
      const b = await request.json()
      if (!b.name) return bad('اسم المورد مطلوب')
      const parent_code = String(b.parent_code || COA.SUPPLIERS) // v3.9.3 — default to الموردون والوكلاء (دائنون)
      let accountInfo = {}
      try { accountInfo = await generateSubAccountCode(db, T, parent_code) } catch (e) { return bad(e.message) }
      const doc = { id: uuidv4(), tenant_id: T, name: b.name, phone: b.phone || '', whatsapp: b.whatsapp || b.phone || '', address: b.address || '', email: b.email || '', notes: b.notes || '', parent_code, ...accountInfo, balances: emptyBalances(), created_at: new Date() }
      await db.collection('suppliers').insertOne(doc)
      const { _id, ...rest } = doc; return ok(rest)
    }
    // v3.2 — Update supplier contact info
    const supIdMatch = route.match(/^\/suppliers\/([^/]+)$/)
    if (supIdMatch && method === 'PUT') {
      const b = await request.json()
      const upd = {}
      for (const k of ['name', 'phone', 'whatsapp', 'address', 'email', 'notes', 'parent_code']) if (b[k] !== undefined) upd[k] = b[k]
      await db.collection('suppliers').updateOne({ id: supIdMatch[1], tenant_id: T }, { $set: upd })
      // v3.92 — keep the linked COA account (if one exists for this code) in sync by IDENTITY
      if (upd.name !== undefined) {
        const s0 = await db.collection('suppliers').findOne({ id: supIdMatch[1], tenant_id: T }, { projection: { account_code: 1 } })
        if (s0?.account_code) await db.collection('accounts').updateOne({ tenant_id: T, code: s0.account_code }, { $set: { name_ar: upd.name } })
      }
      return ok({ success: true })
    }
    if (supIdMatch && method === 'DELETE') {
      const sid = supIdMatch[1]
      const hasTx = await db.collection('tickets').findOne({ tenant_id: T, supplier_id: sid })
        || await db.collection('visas').findOne({ tenant_id: T, supplier_id: sid })
        || await db.collection('services').findOne({ tenant_id: T, supplier_id: sid })
      if (hasTx) return bad('لا يمكن حذف مورد له حركات — احذف الحركات أولاً')
      await db.collection('suppliers').deleteOne({ id: sid, tenant_id: T })
      return ok({ success: true })
    }

    // Boxes
    // v3.51 — RBAC Phase 3: staff restricted to specific boxes see ONLY those boxes (names & balances)
    if (route === '/boxes' && method === 'GET') {
      const allBoxes = clean(await db.collection('boxes').find(tf).sort({ created_at: 1 }).toArray())
      const abIds = Array.isArray(sess.user.allowed_box_ids) ? sess.user.allowed_box_ids : []
      if (sess.user.role !== 'owner' && abIds.length > 0) return ok(allBoxes.filter(x => abIds.includes(x.id)))
      return ok(allBoxes)
    }
    if (route === '/boxes' && method === 'POST') {
      const b = await request.json()
      if (!b.name_ar) return bad('اسم الصندوق مطلوب')
      const type = b.type || 'cash'
      const defaultParent = type === 'cash' ? COA.CASHBOXES : COA.BANKS // 1101=صندوق, 1201=حسابات بنكية
      const parent_code = String(b.parent_code || defaultParent)
      let accountInfo = {}
      try { accountInfo = await generateSubAccountCode(db, T, parent_code) } catch (e) { return bad(e.message) }
      const doc = { id: uuidv4(), tenant_id: T, name_ar: b.name_ar, type, parent_code, ...accountInfo, balances: emptyBalances(), created_at: new Date() }
      await db.collection('boxes').insertOne(doc)
      const { _id, ...rest } = doc; return ok(rest)
    }

    // Accounts (Chart of Accounts)
    if (route === '/accounts' && method === 'GET') return ok(clean(await db.collection('accounts').find(tf).sort({ code: 1 }).toArray()))

    // ================================================================
    // v3.10.5 — VISA MONITORING CENTER — Countries + Rules + Records
    // ================================================================

    // GET /countries — list all countries (seeded on first call)
    if (route === '/countries' && method === 'GET') {
      let list = await db.collection('countries').find({ $or: [{ tenant_id: T }, { tenant_id: null }] }).sort({ code: 1 }).toArray()
      if (list.length === 0) {
        // Seed defaults (global — tenant_id null so all tenants share, but editable overrides go per-tenant)
        const defaults = [
          { code: 'SA', name_ar: 'السعودية', flag: '🇸🇦', fines_config: { 'تأشيرة عمرة': { has_fines: true }, 'تأشيرة حج': { has_fines: true }, 'تأشيرة زيارة': { has_fines: false }, 'فيزا عمل': { has_fines: false } } },
          { code: 'AE', name_ar: 'الإمارات', flag: '🇦🇪', fines_config: { 'default': { has_fines: true } } },
          { code: 'OM', name_ar: 'عمان', flag: '🇴🇲', fines_config: { 'تأشيرة عبور': { has_fines: true }, 'ترانزيت': { has_fines: true }, 'فيزا سياحية': { has_fines: true }, 'default': { has_fines: false } } },
          { code: 'EG', name_ar: 'مصر', flag: '🇪🇬', fines_config: { 'default': { has_fines: false } } },
          { code: 'TR', name_ar: 'تركيا', flag: '🇹🇷', fines_config: { 'default': { has_fines: false } } },
          { code: 'MY', name_ar: 'ماليزيا', flag: '🇲🇾', fines_config: { 'default': { has_fines: false } } },
        ]
        for (const d of defaults) {
          await db.collection('countries').insertOne({ id: uuidv4(), tenant_id: T, ...d, created_at: new Date() })
        }
        list = await db.collection('countries').find({ tenant_id: T }).sort({ code: 1 }).toArray()
      }
      return ok(clean(list))
    }
    // ================================================================
    // v3.10.6 — PERIOD LOCK (Financial Period Closing)
    // ================================================================
    // GET /period-lock — current lock status
    if (route === '/period-lock' && method === 'GET') {
      const s = await db.collection('tenant_settings').findOne({ tenant_id: T }) || {}
      const lock = s.period_lock || { closed_until: null, locked_by: null, locked_at: null, reason: '' }
      return ok(lock)
    }
    // POST /period-lock — set/update lock (owner or can_close_periods)
    if (route === '/period-lock' && method === 'POST') {
      const perms = effectivePermissions(sess.user)
      if (sess.user.role !== 'owner' && !perms.can_close_periods) return bad('لا تملك صلاحية إقفال الفترات', 403)
      const b = await request.json()
      if (!b.closed_until) return bad('التاريخ مطلوب')
      // Validate: closed_until must be past date
      if (new Date(b.closed_until) >= new Date()) return bad('تاريخ الإقفال يجب أن يكون قبل اليوم')
      const lock = {
        closed_until: b.closed_until,
        locked_by: sess.user.id,
        locked_by_email: sess.user.email,
        locked_at: new Date().toISOString(),
        reason: b.reason || ''
      }
      await db.collection('tenant_settings').updateOne({ tenant_id: T }, { $set: { period_lock: lock } }, { upsert: true })
      return ok(lock)
    }
    // DELETE /period-lock — unlock (owner only)
    if (route === '/period-lock' && method === 'DELETE') {
      if (sess.user.role !== 'owner') return bad('فقط المالك يمكنه إلغاء إقفال الفترة', 403)
      await db.collection('tenant_settings').updateOne({ tenant_id: T }, { $unset: { period_lock: '' } })
      return ok({ success: true })
    }


    if (route === '/countries' && method === 'POST') {
      const b = await request.json()
      if (!b.code || !b.name_ar) return bad('كود واسم الدولة مطلوبان')
      const exists = await db.collection('countries').findOne({ tenant_id: T, code: String(b.code).toUpperCase() })
      if (exists) return bad('كود الدولة موجود بالفعل')
      const doc = { id: uuidv4(), tenant_id: T, code: String(b.code).toUpperCase(), name_ar: b.name_ar, flag: b.flag || '🏳️', fines_config: b.fines_config || { default: { has_fines: false } }, created_at: new Date() }
      await db.collection('countries').insertOne(doc); const { _id, ...r } = doc; return ok(r)
    }
    // PATCH /countries/:id
    {
      const m = route.match(/^\/countries\/([^/]+)$/)
      if (m && method === 'PATCH') {
        const b = await request.json()
        const upd = {}
        if (b.name_ar !== undefined) upd.name_ar = b.name_ar
        if (b.flag !== undefined) upd.flag = b.flag
        if (b.fines_config !== undefined) upd.fines_config = b.fines_config
        upd.updated_at = new Date()
        await db.collection('countries').updateOne({ id: m[1], tenant_id: T }, { $set: upd })
        return ok({ success: true })
      }
      if (m && method === 'DELETE') {
        await db.collection('countries').deleteOne({ id: m[1], tenant_id: T })
        return ok({ success: true })
      }
    }

    // Helper: determine has_fines for a country + visa_type combo
    const resolveHasFines = async (countryCode, visaType) => {
      if (!countryCode) return false
      const country = await db.collection('countries').findOne({ tenant_id: T, code: countryCode })
      if (!country) return false
      const cfg = country.fines_config || {}
      if (visaType && cfg[visaType] && cfg[visaType].has_fines !== undefined) return !!cfg[visaType].has_fines
      if (cfg.default && cfg.default.has_fines !== undefined) return !!cfg.default.has_fines
      return false
    }

    // ===== v3.11 — Visa Monitoring Grid (B2B) =====
    // Track-status algorithm: green >30d | yellow ≤30d | red ≤15d | overstay <0d | departed (actual exit)
    const monCompute = (r) => {
      const todayDt = new Date(new Date().toISOString().slice(0, 10))
      const allowed = Number(r.allowed_days || 0) || null
      let expected = r.expected_exit_date || r.max_exit_date || null
      if (!expected && r.entry_date && allowed) {
        const d = new Date(r.entry_date); d.setDate(d.getDate() + allowed)
        expected = d.toISOString().slice(0, 10)
      }
      const departed = !!r.actual_exit_date || r.status === 'exited'
      const remaining = expected ? Math.floor((new Date(expected) - todayDt) / 86400000) : null
      let track = 'green'
      if (departed) track = 'departed'
      else if (remaining === null) track = 'green'
      else if (remaining < 0) track = 'overstay'
      else if (remaining <= 15) track = 'red'
      else if (remaining <= 30) track = 'yellow'
      return { expected_exit_date: expected, remaining_days: remaining, track_status: track }
    }
    const monExpected = (entryDate, allowedDays) => {
      if (!entryDate || !allowedDays) return null
      const d = new Date(entryDate); d.setDate(d.getDate() + Number(allowedDays))
      return d.toISOString().slice(0, 10)
    }

    // GET /visa-monitor — list with filters
    // Query: ?track=all|inside|green|yellow|red|overstay|departed|alerts&agent=text&search=text
    if (route === '/visa-monitor' && method === 'GET') {
      const track = String(q.track || 'inside').toLowerCase()
      const agentText = (q.agent || '').toString().trim().toLowerCase()
      const searchText = (q.search || '').toString().trim().toLowerCase()
      const rows = await db.collection('visa_monitoring').find({ tenant_id: T }).toArray()
      let enriched = rows.map(r => ({ ...r, ...monCompute(r) }))
      // Track filter
      if (track === 'inside') enriched = enriched.filter(x => x.track_status !== 'departed')
      else if (track === 'alerts') enriched = enriched.filter(x => ['yellow', 'red', 'overstay'].includes(x.track_status))
      else if (track !== 'all') enriched = enriched.filter(x => x.track_status === track)
      // Agent filter (free-text contains)
      if (agentText) enriched = enriched.filter(x => String(x.agent_name || '').toLowerCase().includes(agentText))
      // Search by name / passport / visa_no
      if (searchText) enriched = enriched.filter(x =>
        String(x.traveler_name || '').toLowerCase().includes(searchText) ||
        String(x.passport_no || '').toLowerCase().includes(searchText) ||
        String(x.visa_no || '').toLowerCase().includes(searchText)
      )
      // Sort: overstay first (most negative), then ascending remaining; departed last
      enriched.sort((a, b) => {
        const da = a.track_status === 'departed' ? 1 : 0, db2 = b.track_status === 'departed' ? 1 : 0
        if (da !== db2) return da - db2
        const ra = a.remaining_days === null ? 99999 : a.remaining_days
        const rb = b.remaining_days === null ? 99999 : b.remaining_days
        return ra - rb
      })
      return ok(clean(enriched))
    }

    // POST /visa-monitor — add manual record (B2B mandatory fields)
    if (route === '/visa-monitor' && method === 'POST') {
      const b = await request.json()
      if (!b.traveler_name || !String(b.traveler_name).trim()) return bad('اسم المعتمر مطلوب')
      if (!b.passport_no || !String(b.passport_no).trim()) return bad('رقم الجواز مطلوب')
      if (!b.agent_name || !String(b.agent_name).trim()) return bad('اسم الوكيل مطلوب')
      if (!b.agent_phone || !String(b.agent_phone).trim()) return bad('رقم جوال الوكيل (واتساب) مطلوب')
      if (!b.visa_no || !String(b.visa_no).trim()) return bad('رقم التأشيرة مطلوب')
      if (!b.visa_issue_date) return bad('تاريخ إصدار التأشيرة مطلوب')
      if (isFutureDocDate(b.visa_issue_date)) return bad(`${FUTURE_DOC_DATE_MSG} (تاريخ إصدار التأشيرة)`) // v3.80
      if (!b.entry_date) return bad('تاريخ الدخول مطلوب')
      const allowedDays = Number(b.allowed_days) > 0 ? Number(b.allowed_days) : 85
      const doc = {
        id: uuidv4(), tenant_id: T,
        traveler_name: String(b.traveler_name).trim(),
        passport_no: String(b.passport_no).trim().toUpperCase(),
        nationality: b.nationality || '',
        agent_name: String(b.agent_name).trim(),
        agent_phone: String(b.agent_phone).trim(),
        phone: b.phone || '',
        visa_no: String(b.visa_no).trim(),
        visa_issue_date: b.visa_issue_date,
        host_name: b.host_name || '',
        entry_date: b.entry_date,
        entry_port: b.entry_port || '',
        allowed_days: allowedDays,
        expected_exit_date: monExpected(b.entry_date, allowedDays),
        actual_exit_date: b.actual_exit_date || null,
        exit_port: b.exit_port || '',
        destination_country: b.destination_country || 'SA',
        visa_type: b.visa_type || 'تأشيرة عمرة',
        status: b.actual_exit_date ? 'exited' : 'active',
        linked_visa_id: b.linked_visa_id || null,
        source: b.source || 'manual',
        notes: b.notes || '',
        created_at: new Date(), updated_at: new Date()
      }
      await db.collection('visa_monitoring').insertOne(doc)
      const { _id, ...r } = doc; return ok({ ...r, ...monCompute(r) })
    }

    // PATCH /visa-monitor/:id — action buttons (exited / reactivate / update)
    {
      const m = route.match(/^\/visa-monitor\/([^/]+)$/)
      if (m && method === 'PATCH') {
        const b = await request.json()
        const upd = { updated_at: new Date() }
        if (b.action === 'exited') {
          upd.status = 'exited'
          upd.actual_exit_date = b.actual_exit_date || new Date().toISOString().slice(0, 10)
          if (b.exit_port !== undefined) upd.exit_port = b.exit_port
        }
        else if (b.action === 'acknowledge') upd.status = 'acknowledged'
        else if (b.action === 'reactivate') { upd.status = 'active'; upd.actual_exit_date = null }
        else {
          if (b.visa_issue_date !== undefined && isFutureDocDate(b.visa_issue_date)) return bad(`${FUTURE_DOC_DATE_MSG} (تاريخ إصدار التأشيرة)`) // v3.80
          ['traveler_name', 'phone', 'passport_no', 'nationality', 'agent_name', 'agent_phone', 'visa_no', 'visa_issue_date', 'host_name', 'entry_date', 'entry_port', 'allowed_days', 'actual_exit_date', 'exit_port', 'destination_country', 'visa_type', 'max_exit_date', 'notes'].forEach(f => { if (b[f] !== undefined) upd[f] = b[f] })
          if (upd.allowed_days !== undefined) upd.allowed_days = Number(upd.allowed_days) > 0 ? Number(upd.allowed_days) : 85
          // Recompute expected exit if entry/allowed changed
          if (upd.entry_date !== undefined || upd.allowed_days !== undefined) {
            const existing = await db.collection('visa_monitoring').findOne({ id: m[1], tenant_id: T })
            if (existing) {
              const entry = upd.entry_date !== undefined ? upd.entry_date : existing.entry_date
              const allowed = upd.allowed_days !== undefined ? upd.allowed_days : (existing.allowed_days || 85)
              upd.expected_exit_date = monExpected(entry, allowed)
            }
          }
          // Departure logic: setting actual_exit_date marks departed, clearing it reactivates
          if (upd.actual_exit_date !== undefined) upd.status = upd.actual_exit_date ? 'exited' : 'active'
        }
        await db.collection('visa_monitoring').updateOne({ id: m[1], tenant_id: T }, { $set: upd })
        return ok({ success: true })
      }
      if (m && method === 'DELETE') {
        await db.collection('visa_monitoring').deleteOne({ id: m[1], tenant_id: T })
        return ok({ success: true })
      }
    }

    // POST /visa-monitor/import — bulk upsert by passport_no (new B2B columns)
    if (route === '/visa-monitor/import' && method === 'POST') {
      const b = await request.json()
      const rows = Array.isArray(b.rows) ? b.rows : []
      let inserted = 0, updated = 0, skipped = 0
      const skipReasons = []
      for (const r of rows) {
        if (!r.passport_no) { skipped++; skipReasons.push('صف بدون رقم جواز'); continue }
        const passport = String(r.passport_no).trim().toUpperCase()
        const existing = await db.collection('visa_monitoring').findOne({ tenant_id: T, passport_no: passport })
        if (existing) {
          const upd = { updated_at: new Date() }
          ;['traveler_name', 'nationality', 'agent_name', 'agent_phone', 'phone', 'visa_no', 'visa_issue_date', 'host_name', 'entry_date', 'entry_port', 'exit_port', 'notes'].forEach(f => { if (r[f]) upd[f] = r[f] })
          if (Number(r.allowed_days) > 0) upd.allowed_days = Number(r.allowed_days)
          const entry = upd.entry_date || existing.entry_date
          const allowed = upd.allowed_days || existing.allowed_days || 85
          upd.expected_exit_date = monExpected(entry, allowed)
          if (r.actual_exit_date) { upd.actual_exit_date = r.actual_exit_date; upd.status = 'exited' }
          await db.collection('visa_monitoring').updateOne({ id: existing.id }, { $set: upd })
          updated++
        } else {
          // Mandatory for new rows: name, agent, agent_phone, visa_no, issue date, entry date
          const missing = []
          if (!r.traveler_name) missing.push('الاسم')
          if (!r.agent_name) missing.push('الوكيل')
          if (!r.agent_phone) missing.push('جوال الوكيل')
          if (!r.visa_no) missing.push('رقم التأشيرة')
          if (!r.visa_issue_date) missing.push('تاريخ الإصدار')
          else if (isFutureDocDate(r.visa_issue_date)) missing.push('تاريخ الإصدار مستقبلي (غير مسموح)') // v3.80
          if (!r.entry_date) missing.push('تاريخ الدخول')
          if (missing.length) { skipped++; skipReasons.push(`${passport}: ينقصه ${missing.join('، ')}`); continue }
          const allowedDays = Number(r.allowed_days) > 0 ? Number(r.allowed_days) : 85
          await db.collection('visa_monitoring').insertOne({
            id: uuidv4(), tenant_id: T,
            traveler_name: r.traveler_name, passport_no: passport,
            nationality: r.nationality || '',
            agent_name: r.agent_name, agent_phone: r.agent_phone,
            phone: r.phone || '',
            visa_no: r.visa_no, visa_issue_date: r.visa_issue_date,
            host_name: r.host_name || '',
            entry_date: r.entry_date, entry_port: r.entry_port || '',
            allowed_days: allowedDays,
            expected_exit_date: monExpected(r.entry_date, allowedDays),
            actual_exit_date: r.actual_exit_date || null,
            exit_port: r.exit_port || '',
            destination_country: r.destination_country || 'SA',
            visa_type: r.visa_type || 'تأشيرة عمرة',
            status: r.actual_exit_date ? 'exited' : 'active',
            source: 'excel_import', notes: r.notes || '',
            created_at: new Date(), updated_at: new Date()
          })
          inserted++
        }
      }
      return ok({ inserted, updated, skipped, skip_reasons: skipReasons.slice(0, 20), total: rows.length })
    }

    // GET /visa-monitor/stats — counters per track status
    if (route === '/visa-monitor/stats' && method === 'GET') {
      const rows = await db.collection('visa_monitoring').find({ tenant_id: T }).toArray()
      const counts = { green: 0, yellow: 0, red: 0, overstay: 0, departed: 0, total: rows.length }
      for (const r of rows) {
        const { track_status } = monCompute(r)
        counts[track_status] = (counts[track_status] || 0) + 1
      }
      return ok({ ...counts, inside: counts.green + counts.yellow + counts.red + counts.overstay, alerts: counts.yellow + counts.red + counts.overstay })
    }

    // GET /visa-monitor/alerts — dashboard widget (yellow + red + overstay only)
    if (route === '/visa-monitor/alerts' && method === 'GET') {
      const rows = await db.collection('visa_monitoring').find({ tenant_id: T }).toArray()
      const alerts = rows.map(r => ({ ...r, ...monCompute(r) }))
        .filter(x => ['yellow', 'red', 'overstay'].includes(x.track_status))
        .sort((a, b) => (a.remaining_days ?? 99999) - (b.remaining_days ?? 99999))
      const counts = { yellow: 0, red: 0, overstay: 0 }
      alerts.forEach(a => { counts[a.track_status]++ })
      return ok({ counts, rows: clean(alerts.slice(0, 25)), total: alerts.length })
    }


    // v3.10.0 — GET /accounts/search — smart autocomplete across sub-accounts + parent accounts
    // Query: ?q=<text>&type=client|supplier|box|account|all&limit=20&include_inactive=0
    if (route === '/accounts/search' && method === 'GET') {
      const qText = String(q.q || '').trim().toLowerCase()
      const wantType = String(q.type || 'all').toLowerCase()
      const includeInactive = String(q.include_inactive || '0') === '1'
      const lim = Math.min(Number(q.limit) || 30, 100)
      const filterInactive = includeInactive ? {} : { $or: [{ inactive: { $exists: false } }, { inactive: { $ne: true } }] }
      const baseQ = { tenant_id: T, ...filterInactive }
      const results = []
      const wantAll = wantType === 'all'
      const wantParty = wantType === 'party' // v3.79 — clients + suppliers combined (partner pickers)
      const acctTypeF = String(q.acct_type || '').toLowerCase() // v3.79 — filter COA accounts by type (expense/revenue/...)
      if (wantAll || wantParty || wantType === 'client') {
        const rows = await db.collection('clients').find(baseQ).toArray()
        rows.forEach(r => {
          const label = (r.name || '').toLowerCase()
          const code = (r.account_code || '').toLowerCase()
          if (!qText || label.includes(qText) || code.includes(qText)) {
            results.push({ id: r.id, name: r.name, type: 'client', account_code: r.account_code, parent_code: r.account_parent_code || r.parent_code, balances: r.balances || {}, phone: r.phone || '' })
          }
        })
      }
      if (wantAll || wantParty || wantType === 'supplier') {
        const rows = await db.collection('suppliers').find(baseQ).toArray()
        rows.forEach(r => {
          const label = (r.name || '').toLowerCase()
          const code = (r.account_code || '').toLowerCase()
          if (!qText || label.includes(qText) || code.includes(qText)) {
            results.push({ id: r.id, name: r.name, type: 'supplier', account_code: r.account_code, parent_code: r.account_parent_code || r.parent_code, balances: r.balances || {}, phone: r.phone || '' })
          }
        })
      }
      if (wantAll || wantType === 'box') {
        const rows = await db.collection('boxes').find(baseQ).toArray()
        rows.forEach(r => {
          const label = (r.name_ar || '').toLowerCase()
          const code = (r.account_code || '').toLowerCase()
          if (!qText || label.includes(qText) || code.includes(qText)) {
            results.push({ id: r.id, name: r.name_ar, type: 'box', box_type: r.type, account_code: r.account_code, parent_code: r.account_parent_code || r.parent_code, balances: r.balances || {} })
          }
        })
      }
      // v3.10.0 — include parent/chart accounts (revenue/expense/generic) when type='account' or 'all'
      if (wantAll || wantType === 'account') {
        const accs = await db.collection('accounts').find({ tenant_id: T }).toArray()
        accs.forEach(a => {
          // Skip group-parents already served via sub-entities (client/supplier/box parents)
          if ([COA.CASHBOXES, COA.BANKS, COA.CLIENTS, COA.SUPPLIERS].includes(a.code)) return
          if (acctTypeF && a.type !== acctTypeF) return // v3.79 — expense/revenue scoped selectors
          const label = (a.name_ar || '').toLowerCase()
          const code = (a.code || '').toLowerCase()
          if (!qText || label.includes(qText) || code.includes(qText)) {
            results.push({ id: a.id, name: a.name_ar, type: 'account', account_code: a.code, parent_code: a.parent || null, acct_type: a.type, is_group: !!a.is_group })
          }
        })
      }
      // Sort: by account_code ascending (natural tree order)
      results.sort((a, b) => (a.account_code || '').localeCompare(b.account_code || ''))
      return ok(results.slice(0, lim))
    }

    // v3.10.0 — GET /accounts/tree — hierarchical accounts + sub-accounts for tree view
    if (route === '/accounts/tree' && method === 'GET') {
      const includeInactive = String(q.include_inactive || '0') === '1'
      const filterInactive = includeInactive ? {} : { $or: [{ inactive: { $exists: false } }, { inactive: { $ne: true } }] }
      const [accs, clients, suppliers, boxes] = await Promise.all([
        db.collection('accounts').find({ tenant_id: T }).sort({ code: 1 }).toArray(),
        db.collection('clients').find({ tenant_id: T, ...filterInactive }).toArray(),
        db.collection('suppliers').find({ tenant_id: T, ...filterInactive }).toArray(),
        db.collection('boxes').find({ tenant_id: T, ...filterInactive }).toArray(),
      ])
      // Build accounts tree by parent
      const byCode = new Map()
      accs.forEach(a => byCode.set(a.code, {
        id: a.id, code: a.code, name: a.name_ar, type: a.type, parent: a.parent,
        is_group: !!a.is_group, is_parent: !!a.is_parent, next_child_seq: a.next_child_seq || 0,
        children: [], sub_entities: [],
      }))
      const roots = []
      accs.forEach(a => {
        const node = byCode.get(a.code)
        if (a.parent && byCode.has(a.parent)) byCode.get(a.parent).children.push(node)
        else roots.push(node)
      })
      // Attach sub-entities under their parent codes
      const attach = (entity, type) => {
        const ecode = entity.account_code
        // v3.92 — a COA-linked entity whose code exists as an accounts doc must not render
        // twice: decorate the existing tree node with the operational identity instead
        if (ecode && byCode.has(ecode)) {
          const n = byCode.get(ecode)
          n.linked_entity = { type, id: entity.id, balances: entity.balances || {}, box_type: entity.type || null }
          return
        }
        const pcode = entity.account_parent_code || entity.parent_code
        if (pcode && byCode.has(pcode)) {
          byCode.get(pcode).sub_entities.push({
            id: entity.id,
            code: entity.account_code || pcode,
            name: entity.name || entity.name_ar,
            type,
            box_type: entity.type,
            balances: entity.balances || {},
            inactive: !!entity.inactive,
          })
        }
      }
      clients.forEach(c => attach(c, 'client'))
      suppliers.forEach(s => attach(s, 'supplier'))
      boxes.forEach(b => attach(b, 'box'))
      // Sort sub-entities by code
      byCode.forEach(n => n.sub_entities.sort((a, b) => (a.code || '').localeCompare(b.code || '')))
      return ok(roots)
    }

    // v3.89 — Task 1: READ-ONLY next-code preview for the Add Account form.
    // Does NOT increment next_child_seq — the atomic generation still happens ONLY at POST
    // /accounts (generateSubAccountCode), so previews can never cause collisions or renumbering.
    if (route === '/accounts/next-code' && method === 'GET') {
      const urlNC = new URL(request.url)
      const parentNC = String(urlNC.searchParams.get('parent') || '').trim()
      if (!parentNC) return bad('parent مطلوب')
      const pAccNC = await db.collection('accounts').findOne({ tenant_id: T, code: parentNC })
      if (!pAccNC) return bad('الحساب الأب غير موجود')
      if (parentNC.length >= 7) return bad(`الحساب ${parentNC} حساب تحليلي نهائي (L4) — لا يمكن إنشاء حسابات تحته`)
      // v3.89.1 — BLOCKER 2 FIX: mirror the POST guard — previews only under Group accounts
      if (!pAccNC.is_group) return bad(`الحساب الأب ${parentNC} ليس حساب مجموعة (Group) — لا يمكن إنشاء حسابات فرعية إلا تحت حسابات المجموعات`)
      const seqPadNC = parentNC.length === 1 ? 1 : parentNC.length === 2 ? 2 : 3
      const seqCapNC = parentNC.length === 1 ? 9 : parentNC.length === 2 ? 99 : 999
      let seqNC = (Number(pAccNC.next_child_seq) || 0) + 1
      let codeNC = parentNC + String(seqNC).padStart(seqPadNC, '0')
      let guardNC = 0
      while (await accountCodeExists(db, T, codeNC)) {
        if (++guardNC > 500) return bad('تعذر توليد رمز حساب — تواصل مع الدعم')
        seqNC++
        if (seqNC > seqCapNC) return bad(`امتلأ تسلسل الفرع ${parentNC} (الحد ${seqCapNC} حساباً) — أنشئ مجموعة جديدة`)
        codeNC = parentNC + String(seqNC).padStart(seqPadNC, '0')
      }
      if (seqNC > seqCapNC) return bad(`امتلأ تسلسل الفرع ${parentNC} (الحد ${seqCapNC} حساباً) — أنشئ مجموعة جديدة`)
      return ok({ next_code: codeNC, parent: parentNC, preview: true })
    }
    // v3.92 — LINK AUDIT (read-only): leaf accounts under 1101/1102/1103/2101 and their
    // operational linkage status. Nothing is modified here.
    if (route === '/accounts/link-audit' && method === 'GET') {
      const groups = [COA.CASHBOXES, COA.BANKS, COA.CLIENTS, COA.SUPPLIERS]
      const accs = await db.collection('accounts').find({ tenant_id: T, parent: { $in: groups }, $or: [{ is_group: { $exists: false } }, { is_group: false }] }).sort({ code: 1 }).toArray()
      const items = []
      for (const a of accs) {
        const m = opLinkMapFor(a.parent)
        const linkedRec = await db.collection(m.coll).findOne({ tenant_id: T, account_code: a.code })
        if (linkedRec) { items.push({ code: a.code, name: a.name_ar, kind: m.kind, status: 'linked' }); continue }
        const dupName = await db.collection(m.coll).findOne(
          m.coll === 'boxes' ? { tenant_id: T, $or: [{ name_ar: a.name_ar }, { name: a.name_ar }] } : { tenant_id: T, name: a.name_ar }
        )
        items.push(dupName
          ? { code: a.code, name: a.name_ar, kind: m.kind, status: 'name_conflict', conflict_with: dupName.account_code || null }
          : { code: a.code, name: a.name_ar, kind: m.kind, status: 'orphan' })
      }
      return ok({
        total: items.length,
        linked: items.filter(i => i.status === 'linked').length,
        orphans: items.filter(i => i.status === 'orphan'),
        conflicts: items.filter(i => i.status === 'name_conflict'),
      })
    }
    // v3.92 — LINK REPAIR (owner-triggered, IDEMPOTENT): creates the missing operational
    // record for each orphan (identity = account_code — no renumbering, no duplicates).
    // Uncertain cases (name conflicts) are SKIPPED and reported — never auto-linked.
    if (route === '/accounts/link-repair' && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — للمالك فقط', 403)
      const groups = [COA.CASHBOXES, COA.BANKS, COA.CLIENTS, COA.SUPPLIERS]
      const accs = await db.collection('accounts').find({ tenant_id: T, parent: { $in: groups }, $or: [{ is_group: { $exists: false } }, { is_group: false }] }).sort({ code: 1 }).toArray()
      const repaired = [], skippedConflicts = [], alreadyLinked = []
      for (const a of accs) {
        const r = await ensureOperationalLink(db, T, a)
        if (r?.conflict) skippedConflicts.push({ code: a.code, name: a.name_ar, reason: r.conflict })
        else if (r?.created) repaired.push({ code: a.code, name: a.name_ar, kind: r.kind })
        else if (r?.linked) alreadyLinked.push(a.code)
      }
      return ok({ repaired, repaired_count: repaired.length, already_linked: alreadyLinked.length, skipped_conflicts: skippedConflicts })
    }
    if (route === '/accounts' && method === 'POST') {
      const b = await request.json()
      if (!b.name_ar || !b.type) return bad('الاسم والنوع مطلوبان')
      // v3.88.3 — type whitelist: the five COA v2 types only (equity now first-class).
      if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(b.type)) {
        return bad('نوع الحساب غير صالح — الأنواع المسموحة: أصول، خصوم، حقوق ملكية، إيرادات، مصروفات')
      }
      // v3.87 — HIERARCHICAL CODING (hard rule): a child's code ALWAYS starts with its
      // parent's prefix. Auto-generation delegates to generateSubAccountCode (atomic,
      // collision-safe, level-aware). Manual codes are validated against the same rules.
      let code = b.code ? String(b.code).trim() : ''
      const parentStr = b.parent ? String(b.parent) : null
      if (parentStr) {
        const pAcc = await db.collection('accounts').findOne({ tenant_id: T, code: parentStr })
        if (!pAcc) return bad('الحساب الأب غير موجود')
        if (parentStr.length >= 7) return bad(`الحساب ${parentStr} حساب تحليلي نهائي (L4) — لا يمكن إنشاء حسابات تحته`)
        // v3.89.1 — BLOCKER 2 FIX (backend guard, not UI-only): children are allowed ONLY under
        // Group accounts — posting-level (leaf) accounts can never become parents.
        if (!pAcc.is_group) return bad(`الحساب الأب ${parentStr} ليس حساب مجموعة (Group) — لا يمكن إنشاء حسابات فرعية إلا تحت حسابات المجموعات`)
        if (b.type && pAcc.type && b.type !== pAcc.type) return bad(`نوع الحساب يجب أن يطابق نوع الأب (${pAcc.type})`)
      }
      if (!code) {
        if (!parentStr) return bad('الرمز مطلوب — أو حدد الحساب الأب ليُولَّد الرمز تلقائياً')
        try {
          const gen = await generateSubAccountCode(db, T, parentStr)
          code = gen.account_code
        } catch (e) { return bad(e.message) }
      } else {
        if (!/^\d+$/.test(code)) return bad('رمز الحساب يجب أن يكون أرقاماً فقط')
        if (parentStr && !code.startsWith(parentStr)) return bad(`رمز الحساب يجب أن يبدأ ببادئة الأب (${parentStr}...) — لا يجوز إنشاء ${code} تحت ${parentStr}`)
        if (parentStr) {
          const validLen = { 1: 2, 2: 4, 4: 7 }[parentStr.length]
          if (code.length !== validLen) return bad(`طول الرمز تحت الأب ${parentStr} يجب أن يكون ${validLen} خانات (مثال: ${parentStr}${'0'.repeat(validLen - parentStr.length - 1)}1)`)
        }
        if (!parentStr && code.length !== 1) return bad('الحسابات الجذرية (بدون أب) رمزها خانة واحدة فقط (1-9)')
        if (await accountCodeExists(db, T, code)) return bad(`رمز الحساب "${code}" مستخدم بالفعل (دليل/عميل/مورد/صندوق)`)
      }
      const doc = {
        id: uuidv4(), tenant_id: T, code, name_ar: String(b.name_ar),
        type: b.type, parent: parentStr,
        is_group: !!b.is_group, notes: b.notes || '',
        created_at: new Date(),
      }
      // v3.92 — COA→operational pre-check: never create an account that would collide with an
      // existing box/client/supplier NAME (prevents duplicate operational records up-front)
      const opMapC = !doc.is_group ? opLinkMapFor(parentStr) : null
      if (opMapC) {
        const dupOp = await db.collection(opMapC.coll).findOne(
          opMapC.coll === 'boxes'
            ? { tenant_id: T, $or: [{ name_ar: doc.name_ar }, { name: doc.name_ar }] }
            : { tenant_id: T, name: doc.name_ar }
        )
        if (dupOp) return bad(`يوجد ${opMapC.kind} بنفس الاسم "${doc.name_ar}" (حساب ${dupOp.account_code || '—'}) — لمنع التكرار عدّل الاسم أو استخدم ${opMapC.screen}`)
      }
      await db.collection('accounts').insertOne(doc)
      // v3.92 — auto-link: an account under 1101/1102/1103/2101 gets its operational record
      // (identity = account_code) so it appears in the operational screens and vouchers.
      let opLink = null
      if (opMapC) {
        opLink = await ensureOperationalLink(db, T, doc)
        if (opLink?.conflict) {
          // clean abort — never leave an orphan account behind
          await db.collection('accounts').deleteOne({ id: doc.id, tenant_id: T })
          return bad(opLink.conflict)
        }
      }
      const { _id, ...rest } = doc; return ok({ ...rest, operational_link: opLink })
    }
    const acctIdMatch = route.match(/^\/accounts\/([^/]+)$/)
    if (acctIdMatch && method === 'PUT') {
      const b = await request.json()
      const acc = await db.collection('accounts').findOne({ id: acctIdMatch[1], tenant_id: T })
      if (!acc) return bad('الحساب غير موجود', 404)
      const upd = {}
      for (const k of ['name_ar', 'type', 'parent', 'is_group', 'notes']) if (b[k] !== undefined) upd[k] = b[k]
      // v3.87 — SYSTEM ACCOUNTS (e.g. 3103) are structurally immutable: code is never
      // editable via PUT, and type/parent/is_group are locked for system accounts.
      // v4.5 — the protection also covers ENGINE accounts (COA template codes that the
      // accounting engine posts to: Opening / Year Closing / Retained Earnings / FX /
      // fixed postings) even when is_system flag is absent and even BEFORE first use.
      const structuralChange = upd.type !== undefined && upd.type !== acc.type
        || upd.parent !== undefined && upd.parent !== acc.parent
        || upd.is_group !== undefined && !!upd.is_group !== !!acc.is_group
      if ((acc.is_system || ENGINE_ACCOUNT_CODES.has(acc.code)) && structuralChange) {
        return bad(`الحساب ${acc.code} حساب نظامي/محركي — لا يمكن تغيير نوعه أو موقعه في الشجرة`)
      }
      if (b.code !== undefined && String(b.code) !== acc.code) {
        return bad((acc.is_system || ENGINE_ACCOUNT_CODES.has(acc.code)) ? `الحساب ${acc.code} حساب نظامي — لا يمكن تغيير رقمه` : 'تغيير رمز الحساب غير مدعوم — احذف الحساب وأنشئه من جديد بالرمز الصحيح')
      }
      // v4.5 — HISTORY PROTECTION (Priority 3): an account already used in journal_entries
      // must not be structurally reinterpreted (type/parent/group↔leaf). Safe descriptive
      // edits (name/notes) remain allowed.
      if (structuralChange) {
        const usedCount = await db.collection('journal_entries').countDocuments({ tenant_id: T, 'lines.account_code': acc.code })
        if (usedCount > 0) {
          return bad(`الحساب ${acc.code} مستخدم في ${usedCount} قيداً — تغيير النوع/الأب/التجميع يعيد تفسير التاريخ المحاسبي وهو ممنوع. عدّل الاسم أو الملاحظات فقط، أو أنشئ حساباً جديداً`)
        }
        // group→leaf never allowed while children exist; leaf→group blocked above when used
        if (upd.is_group !== undefined && !upd.is_group && acc.is_group) {
          const kidsU = await db.collection('accounts').countDocuments({ tenant_id: T, parent: acc.code })
          if (kidsU > 0) return bad(`لا يمكن تحويل المجموعة ${acc.code} إلى حساب تفصيلي — لديها ${kidsU} حساباً فرعياً`)
        }
        // v4.5 — parent must exist, be a GROUP, in the same tenant, and not the account itself
        if (upd.parent !== undefined && upd.parent !== null && upd.parent !== '') {
          if (String(upd.parent) === acc.code) return bad('لا يمكن جعل الحساب أباً لنفسه')
          const newParent = await db.collection('accounts').findOne({ tenant_id: T, code: String(upd.parent) })
          if (!newParent) return bad(`الحساب الأب "${upd.parent}" غير موجود في دليل هذا المكتب`)
          if (!newParent.is_group) return bad(`الحساب الأب "${upd.parent}" ليس حساب مجموعة`)
        }
        // v4.5 — type must be a valid accounting type
        if (upd.type !== undefined && !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(upd.type)) {
          return bad('نوع الحساب غير صالح (asset / liability / equity / revenue / expense)')
        }
      }
      // v3.92 — rename keeps the SAME identity (account + operational record). The linked
      // record is found by account_code (never by name) and gets the new name — no new
      // account, no new record. Duplicate names are rejected before touching anything.
      const opMapU = opLinkMapFor(acc.parent)
      if (opMapU && upd.name_ar !== undefined && String(upd.name_ar) !== acc.name_ar) {
        const dupOpU = await db.collection(opMapU.coll).findOne(
          opMapU.coll === 'boxes'
            ? { tenant_id: T, account_code: { $ne: acc.code }, $or: [{ name_ar: upd.name_ar }, { name: upd.name_ar }] }
            : { tenant_id: T, account_code: { $ne: acc.code }, name: upd.name_ar }
        )
        if (dupOpU) return bad(`يوجد ${opMapU.kind} آخر بنفس الاسم "${upd.name_ar}" — اختر اسماً مختلفاً لمنع التكرار`)
      }
      await db.collection('accounts').updateOne({ id: acctIdMatch[1], tenant_id: T }, { $set: upd })
      if (opMapU && upd.name_ar !== undefined) {
        await db.collection(opMapU.coll).updateOne({ tenant_id: T, account_code: acc.code }, { $set: { [opMapU.nameField]: upd.name_ar } })
      }
      return ok({ success: true })
    }
    if (acctIdMatch && method === 'DELETE') {
      const acc = await db.collection('accounts').findOne({ id: acctIdMatch[1], tenant_id: T })
      if (!acc) return bad('الحساب غير موجود', 404)
      if (acc.is_system) return bad(`الحساب ${acc.code} — ${acc.name_ar} حساب نظامي ولا يمكن حذفه`)
      // v4.5 — ENGINE accounts (COA template codes the engine posts to) are protected
      // even without is_system flag and even before their first posting.
      if (ENGINE_ACCOUNT_CODES.has(acc.code)) return bad(`الحساب ${acc.code} — ${acc.name_ar} حساب محركي أساسي (افتتاح/إقفال/أرباح مبقاة/فروقات صرف) ولا يمكن حذفه — يمكن تعطيله فقط`)
      // v3.92.1 — group protection: children accounts OR attached operational records block deletion
      const childCount = await db.collection('accounts').countDocuments({ tenant_id: T, parent: acc.code })
      if (childCount > 0) return bad(`لا يمكن حذف الحساب — مجموعة تحتوي على ${childCount} حساب فرعي. عالج الحسابات التابعة أولاً`)
      const [childCli, childSup, childBox] = await Promise.all([
        db.collection('clients').countDocuments({ tenant_id: T, $or: [{ account_parent_code: acc.code }, { parent_code: acc.code }] }),
        db.collection('suppliers').countDocuments({ tenant_id: T, $or: [{ account_parent_code: acc.code }, { parent_code: acc.code }] }),
        db.collection('boxes').countDocuments({ tenant_id: T, $or: [{ account_parent_code: acc.code }, { parent_code: acc.code }] }),
      ])
      if (childCli + childSup + childBox > 0) return bad(`لا يمكن حذف الحساب — تتبعه سجلات تشغيلية (${childCli} عميل، ${childSup} مورد، ${childBox} صندوق/بنك). عالجها أولاً`)
      // v3.92.1 — SAFE DELETE: deletable ONLY with ZERO history (never "balance = 0").
      // Checks journals by account_code, vouchers by coa_account_code, and — for linked
      // box/client/supplier — every operational reference by the record id.
      const usage = await accountUsageCheck(db, T, acc)
      if (usage.used) {
        return bad(`لا يمكن حذف الحساب لأنه مرتبط بعمليات أو قيود مالية (${usage.reason}). يمكنك إيقاف استخدامه أو تغيير اسمه بدلاً من حذفه.`)
      }
      // truly unused: cascade-delete the linked operational record + the account in ONE operation.
      // No renumbering: next_child_seq is untouched — other account codes are unaffected.
      if (usage.rec) await db.collection(usage.m.coll).deleteOne({ id: usage.rec.id, tenant_id: T })
      await db.collection('accounts').deleteOne({ id: acctIdMatch[1], tenant_id: T })
      return ok({ success: true, cascade_deleted: usage.rec ? `${usage.m.kind} "${usage.rec[usage.m.nameField] || usage.rec.name || ''}"` : null })
    }

    // Tickets
    // v3.21 — Installment alert for the logged-in tenant (proactive cash-flow reminder)
    if (route === '/my/installment-alert' && method === 'GET') {
      const t = await db.collection('tenants').findOne({ id: T })
      if (!t || t.billing_mode !== 'installments') return ok({ alert: null })
      const list = Array.isArray(t.installments) ? t.installments : []
      const next = list.find(i => !i.paid) || null
      if (!next || !next.due_date) return ok({ alert: null })
      const today = new Date(new Date().toISOString().slice(0, 10))
      const due = new Date(String(next.due_date).slice(0, 10))
      const daysLeft = Math.round((due - today) / 86400000)
      // Alert window: overdue OR due within 10 days
      if (daysLeft > 10) return ok({ alert: null })
      return ok({
        alert: {
          no: next.no, amount: next.amount, due_date: next.due_date,
          days_left: daysLeft, overdue: daysLeft < 0,
          paid_count: list.filter(i => i.paid).length, total_count: list.length,
        },
      })
    }

    // v3.21 — Partner Commission Statement (كشف حساب الشريك B2B)
    // Aggregates commission_share_amount across tickets, visas, services and package bookings
    if (route === '/partners/commissions' && method === 'GET') {
      const url = new URL(request.url)
      const partnerId = url.searchParams.get('partner_id')
      if (!partnerId) return bad('partner_id مطلوب')
      const result = await computePartnerStatement(db, T, partnerId, url.searchParams.get('from'), url.searchParams.get('to'))
      return ok(result)
    }

    // v3.22 — Statement Archive (Audit Trail): save an immutable snapshot recomputed server-side
    if (route === '/partners/statements' && method === 'POST') {
      const b = await request.json()
      if (!b.partner_id || !['client', 'supplier'].includes(b.partner_type)) return bad('بيانات الشريك مطلوبة')
      const pcol = b.partner_type === 'supplier' ? 'suppliers' : 'clients'
      const partner = await db.collection(pcol).findOne({ id: b.partner_id, tenant_id: T })
      if (!partner) return bad('الشريك غير موجود')
      const snap = await computePartnerStatement(db, T, b.partner_id, b.from || null, b.to || null)
      if ((snap.rows || []).length === 0) return bad('لا توجد عمولات في الفترة المحددة — لا يمكن أرشفة كشف فارغ')
      const doc = {
        id: uuidv4(), tenant_id: T,
        partner_type: b.partner_type, partner_id: b.partner_id, partner_name: partner.name,
        from: b.from || null, to: b.to || null,
        rows: snap.rows, totals: snap.totals, count: snap.count,
        settlement_voucher_id: null, settled_at: null, settled_amount: null, settled_currency: null,
        created_at: new Date(),
      }
      await db.collection('partner_statements').insertOne(doc)
      const { _id, ...rest } = doc
      return ok(rest)
    }
    if (route === '/partners/statements' && method === 'GET') {
      const url = new URL(request.url)
      const q = { tenant_id: T }
      const pid = url.searchParams.get('partner_id')
      if (pid) q.partner_id = pid
      return ok(clean(await db.collection('partner_statements').find(q).sort({ created_at: -1 }).limit(100).toArray()))
    }
    // v3.22 — Settle a statement: creates a payment voucher (balanced JE) reducing the partner's due balance
    const stmtSettleMatch = route.match(/^\/partners\/statements\/([^/]+)\/settle$/)
    if (stmtSettleMatch && method === 'POST') {
      const b = await request.json()
      const stmt = await db.collection('partner_statements').findOne({ id: stmtSettleMatch[1], tenant_id: T })
      if (!stmt) return bad('الكشف غير موجود', 404)
      if (stmt.settlement_voucher_id) return bad('هذا الكشف مُسوّى مسبقاً — أنشئ كشفاً جديداً لأي مستحقات لاحقة')
      const currency = b.currency
      if (!CURRENCIES.includes(currency)) return bad('عملة غير صالحة')
      const dueForCur = Number(stmt.totals?.[currency]?.partner_share) || 0
      if (dueForCur <= 0) return bad(`لا توجد مستحقات بعملة ${currency} في هذا الكشف`)
      const amount = b.amount !== undefined ? Number(b.amount) : dueForCur
      if (!(amount > 0)) return bad('المبلغ يجب أن يكون أكبر من صفر')
      if (amount > dueForCur + 0.01) return bad(`المبلغ يتجاوز مستحقات الكشف (${dueForCur} ${currency})`)
      const result = await createVoucher(db, T, {
        type: 'payment',
        party_type: stmt.partner_type, party_id: stmt.partner_id,
        box_id: b.box_id, currency, amount,
        date: b.date || undefined,
        description: `تسوية عمولات شريك — ${stmt.partner_name} (كشف ${stmt.from ? new Date(stmt.from).toLocaleDateString('en-GB') : 'البداية'} ← ${stmt.to ? new Date(stmt.to).toLocaleDateString('en-GB') : 'اليوم'})${b.notes ? ` — ${String(b.notes).slice(0, 120)}` : ''}`,
      })
      if (result.error) return bad(result.error)
      await db.collection('partner_statements').updateOne(
        { id: stmt.id, tenant_id: T },
        { $set: { settlement_voucher_id: result.doc.id, settled_at: new Date(), settled_amount: amount, settled_currency: currency } }
      )
      return ok({ voucher: result.doc, statement_id: stmt.id, settled_amount: amount, settled_currency: currency })
    }

    if (route === '/tickets' && method === 'GET') return ok(clean(await db.collection('tickets').find(tf).sort({ date: -1, created_at: -1 }).limit(500).toArray()))
    if (route === '/tickets' && method === 'POST') {
      const b = await request.json()
      const result = await createTicket(db, T, b)
      if (result.error) return bad(result.error)
      return ok(result.doc)
    }

    // Visas
    if (route === '/visas' && method === 'GET') return ok(clean(await db.collection('visas').find(tf).sort({ date: -1, created_at: -1 }).limit(500).toArray()))
    if (route === '/visas' && method === 'POST') {
      const b = await request.json()
      const result = await createVisa(db, T, b)
      if (result.error) return bad(result.error)
      return ok(result.doc)
    }

    // v3.0 — Mark visa as exited (removes alert, no accounting effect)
    const markExitedMatch = route.match(/^\/visas\/([^/]+)\/mark-exited$/)
    if (markExitedMatch && method === 'POST') {
      const visaId = markExitedMatch[1]
      const v = await db.collection('visas').findOne({ id: visaId, tenant_id: T })
      if (!v) return bad('التأشيرة غير موجودة', 404)
      await db.collection('visas').updateOne(
        { id: visaId, tenant_id: T },
        { $set: { is_exited: true, exited_at: new Date(), exited_by: sess.user.email } }
      )
      return ok({ success: true, id: visaId, is_exited: true })
    }

    // v3.0 — Unmark visa (in case of error)
    const unmarkExitedMatch = route.match(/^\/visas\/([^/]+)\/unmark-exited$/)
    if (unmarkExitedMatch && method === 'POST') {
      const visaId = unmarkExitedMatch[1]
      await db.collection('visas').updateOne(
        { id: visaId, tenant_id: T },
        { $set: { is_exited: false }, $unset: { exited_at: '', exited_by: '' } }
      )
      return ok({ success: true, id: visaId, is_exited: false })
    }

    // ============ SERVICES (v3.0 — dedicated dynamic-catalog services module) ============
    if (route === '/service-types' && method === 'GET') {
      const list = await db.collection('service_types').find(tf).sort({ created_at: 1 }).toArray()
      return ok(list.map(x => ({ ...x, _id: undefined })))
    }
    if (route === '/service-types' && method === 'POST') {
      const b = await request.json()
      const name = String(b.name || '').trim()
      if (!name) return bad('اسم نوع الخدمة مطلوب')
      const exists = await db.collection('service_types').findOne({ tenant_id: T, name })
      if (exists) return bad('نوع الخدمة موجود بالفعل')
      const doc = { id: uuidv4(), tenant_id: T, name, active: true, created_at: new Date() }
      await db.collection('service_types').insertOne(doc)
      const { _id, ...rest } = doc; return ok(rest)
    }
    const stIdMatch = route.match(/^\/service-types\/([^/]+)$/)
    if (stIdMatch && method === 'DELETE') {
      await db.collection('service_types').deleteOne({ id: stIdMatch[1], tenant_id: T })
      return ok({ success: true })
    }
    if (stIdMatch && method === 'PATCH') {
      const b = await request.json()
      const upd = {}
      if (b.name) upd.name = String(b.name).trim()
      if (b.active !== undefined) upd.active = !!b.active
      await db.collection('service_types').updateOne({ id: stIdMatch[1], tenant_id: T }, { $set: upd })
      return ok({ success: true })
    }

    if (route === '/services' && method === 'GET') return ok(clean(await db.collection('services').find(tf).sort({ date: -1, created_at: -1 }).limit(500).toArray()))
    if (route === '/services' && method === 'POST') {
      const b = await request.json()
      const result = await createService(db, T, b)
      if (result.error) return bad(result.error)
      return ok(result.doc)
    }

    // ============ BULK IMPORT ============
    if (route === '/import/tickets/preview' && method === 'POST') {
      const b = await request.json()  // { rows: [normalized rows], skip_duplicates:true }
      const rows = Array.isArray(b.rows) ? b.rows : []
      // v3.13 — Duplicate rule: (PNR + date) — a different travel date is NOT a duplicate
      const pnrs = rows.map(r => r.pnr).filter(Boolean)
      // v3.18 — Existing keys use TRAVEL DATE only; records without travel date are never dedup-blockers
      const existingSet = new Set()
      if (pnrs.length) {
        const existing = await db.collection('tickets').find({ tenant_id: T, pnr: { $in: pnrs } }).project({ pnr: 1, travel_date: 1 }).toArray()
        for (const t of existing) {
          const d = t.travel_date ? new Date(t.travel_date).toISOString().slice(0, 10) : ''
          if (d) existingSet.add(`${t.pnr}|${d}`)
        }
      }
      // v3.9.9 — Name+Date dedup (main key for offices without PNR)
      const nameDateKeys = rows.map(r => `${String(r.passenger_name || '').trim().toLowerCase()}|${String(r.travel_date || r.date || '').slice(0, 10)}`).filter(k => !k.startsWith('|'))
      const existingByNameDate = new Set()
      if (nameDateKeys.length) {
        const existingTix = await db.collection('tickets').find({ tenant_id: T, passenger_name: { $in: rows.map(r => String(r.passenger_name || '').trim()).filter(Boolean) } }).project({ passenger_name: 1, travel_date: 1 }).toArray()
        for (const t of existingTix) {
          const d = t.travel_date ? new Date(t.travel_date).toISOString().slice(0, 10) : ''
          if (d) existingByNameDate.add(`${String(t.passenger_name || '').trim().toLowerCase()}|${d}`)
        }
      }
      // v3.9.8 — Flexible receipt account: allow clients OR boxes/banks (cash)
      const allClients = await db.collection('clients').find({ tenant_id: T }).project({ name: 1 }).toArray()
      const allSuppliers = await db.collection('suppliers').find({ tenant_id: T }).project({ name: 1 }).toArray()
      const allBoxes = await db.collection('boxes').find({ tenant_id: T }).project({ id: 1, name: 1, name_ar: 1, type: 1 }).toArray()
      const clientSet = new Set(allClients.map(x => String(x.name).trim().toLowerCase()))
      const supplierSet = new Set(allSuppliers.map(x => String(x.name).trim().toLowerCase()))
      const boxSet = new Set(allBoxes.flatMap(x => [String(x.name_ar || '').trim().toLowerCase(), String(x.name || '').trim().toLowerCase()].filter(Boolean)))
      // v3.92 — duplicate operational names make name-matching AMBIGUOUS → hard, clear error
      const dupOf = (names) => { const cnt = {}; for (const k of names) if (k) cnt[k] = (cnt[k] || 0) + 1; return new Set(Object.keys(cnt).filter(k => cnt[k] > 1)) }
      const clientDups = dupOf(allClients.map(x => String(x.name).trim().toLowerCase()))
      const supplierDups = dupOf(allSuppliers.map(x => String(x.name).trim().toLowerCase()))
      const boxDups = dupOf(allBoxes.flatMap(x => [String(x.name_ar || '').trim().toLowerCase(), String(x.name || '').trim().toLowerCase()].filter(Boolean)))
      const seenInBatch = new Set()
      const seenNameDateInBatch = new Set()
      const validated = rows.map((r, i) => {
        const errors = []
        if (!r.currency || !CURRENCIES.includes(r.currency)) errors.push('العملة غير صالحة')
        if (r.cost === undefined || r.cost === '' || isNaN(Number(r.cost))) errors.push('التكلفة مطلوبة')
        if (r.sale_price === undefined || r.sale_price === '' || isNaN(Number(r.sale_price))) errors.push('سعر البيع مطلوب')
        let receiptKind = null
        if (!r.client_name) errors.push('حساب القبض مطلوب (عميل أو صندوق/بنك)')
        else {
          const key = String(r.client_name).trim().toLowerCase()
          if (clientSet.has(key)) {
            if (clientDups.has(key)) errors.push(`خطأ استيراد: اسم حساب القبض "${r.client_name}" مكرر بين أكثر من عميل — وحّد الأسماء أو صحّح السجلات أولاً`)
            receiptKind = 'client'
          } else if (boxSet.has(key)) {
            if (boxDups.has(key)) errors.push(`خطأ استيراد: اسم الصندوق/البنك "${r.client_name}" مكرر بين أكثر من صندوق — وحّد الأسماء أولاً`)
            receiptKind = 'box'
          }
          else errors.push(`خطأ استيراد: حساب القبض "${r.client_name}" غير موجود (لا عميل ولا صندوق/بنك) — أضِفه يدوياً أولاً`)
        }
        if (!r.supplier_name) errors.push('اسم المورد مطلوب')
        else {
          const supKey = String(r.supplier_name).trim().toLowerCase()
          if (!supplierSet.has(supKey)) errors.push(`خطأ استيراد: المورد "${r.supplier_name}" غير موجود في دليل الحسابات — أضِفه يدوياً أولاً`)
          else if (supplierDups.has(supKey)) errors.push(`خطأ استيراد: اسم المورد "${r.supplier_name}" مكرر بين أكثر من مورد — وحّد الأسماء أولاً`)
        }
        let dup = false
        // v3.18 — Duplicate rule uses TRAVEL DATE ONLY (never the transaction date fallback).
        // No travel date => no name/PNR dedup (accept the row). Different travel date => accepted.
        const rowDate = String(r.travel_date || '').slice(0, 10)
        if (r.pnr && rowDate && existingSet.has(`${r.pnr}|${rowDate}`)) dup = 'موجود مسبقاً (PNR + نفس تاريخ السفر)'
        if (r.pnr && rowDate && seenInBatch.has(`${r.pnr}|${rowDate}`)) dup = 'مكرر داخل نفس الملف (PNR + نفس تاريخ السفر)'
        if (r.pnr && rowDate) seenInBatch.add(`${r.pnr}|${rowDate}`)
        // 2) Name+TravelDate dedup (main check for offices without PNR)
        if (!dup && r.passenger_name && rowDate) {
          const nd = `${String(r.passenger_name).trim().toLowerCase()}|${rowDate}`
          if (existingByNameDate.has(nd)) dup = 'موجود مسبقاً (اسم المسافر + نفس تاريخ السفر)'
          else if (seenNameDateInBatch.has(nd)) dup = 'مكرر داخل نفس الملف (اسم + نفس تاريخ السفر)'
          else seenNameDateInBatch.add(nd)
        }
        return { ...r, __row: i + 1, __errors: errors, __dup: dup, __receipt_kind: receiptKind, __commission: (Number(r.sale_price) || 0) - (Number(r.cost) || 0) }
      })
      const totals = validated.reduce((acc, r) => {
        const c = r.currency || 'USD'
        if (!acc[c]) acc[c] = { count: 0, cost: 0, sale: 0, profit: 0 }
        acc[c].count++; acc[c].cost += Number(r.cost) || 0; acc[c].sale += Number(r.sale_price) || 0; acc[c].profit += r.__commission
        return acc
      }, {})
      return ok({ rows: validated, totals, valid_count: validated.filter(v => v.__errors.length === 0 && !v.__dup).length })
    }
    if (route === '/import/tickets' && method === 'POST') {
      const b = await request.json()
      const rows = Array.isArray(b.rows) ? b.rows : []
      const skip = b.skip_duplicates !== false
      let created = 0, skipped = 0, failed = 0
      const errors = []
      for (const r of rows) {
        if (skip && r.__dup) { skipped++; continue }
        if (r.__errors && r.__errors.length) { failed++; errors.push({ row: r.__row, errors: r.__errors }); continue }
        // v3.9.8 — Receipt account may be a client (credit) OR a box/bank (cash)
        // v3.92 — STRICT resolution: the row must resolve to EXACTLY ONE linked record.
        // Ambiguity (duplicate names) fails with a clear message — nothing is auto-created.
        const findStrict = async (coll, filter) => { const l = await db.collection(coll).find(filter).limit(2).toArray(); return { doc: l[0] || null, dup: l.length > 1 } }
        const nameTrim = r.client_name ? String(r.client_name).trim() : ''
        const cliR = nameTrim ? await findStrict('clients', { tenant_id: T, name: nameTrim }) : { doc: null, dup: false }
        if (cliR.dup) { failed++; errors.push({ row: r.__row, errors: [`اسم حساب القبض "${nameTrim}" مكرر بين أكثر من عميل — وحّد الأسماء أولاً`] }); continue }
        const cli = cliR.doc
        let box = null
        if (!cli && nameTrim) {
          const boxR = await findStrict('boxes', { tenant_id: T, $or: [{ name_ar: nameTrim }, { name: nameTrim }] })
          if (boxR.dup) { failed++; errors.push({ row: r.__row, errors: [`اسم الصندوق/البنك "${nameTrim}" مكرر بين أكثر من صندوق — وحّد الأسماء أولاً`] }); continue }
          box = boxR.doc
        }
        const supR = r.supplier_name ? await findStrict('suppliers', { tenant_id: T, name: String(r.supplier_name).trim() }) : { doc: null, dup: false }
        if (supR.dup) { failed++; errors.push({ row: r.__row, errors: [`اسم المورد "${r.supplier_name}" مكرر بين أكثر من مورد — وحّد الأسماء أولاً`] }); continue }
        const sup = supR.doc
        if (!cli && !box) { failed++; errors.push({ row: r.__row, errors: [`حساب القبض "${r.client_name}" غير موجود (لا عميل ولا صندوق/بنك)`] }); continue }
        if (!sup) { failed++; errors.push({ row: r.__row, errors: [`المورد "${r.supplier_name}" غير موجود في دليل الحسابات`] }); continue }
        const payload = box
          ? { ...r, client_id: null, client_name: nameTrim, supplier_id: sup.id, payment_method: 'cash', box_id: box.id }
          : { ...r, client_id: cli.id, supplier_id: sup.id, payment_method: r.payment_method === 'cash' ? 'cash' : 'credit' }
        const result = await createTicket(db, T, payload)
        if (result.error) { failed++; errors.push({ row: r.__row, errors: [result.error] }) } else created++
      }
      return ok({ created, skipped, failed, errors })
    }
    if (route === '/import/visas/preview' && method === 'POST') {
      const b = await request.json()
      const rows = Array.isArray(b.rows) ? b.rows : []
      // v3.13 — Duplicate rule: (passport + date) — a different entry date is NOT a duplicate
      const passports = rows.map(r => r.passport_no).filter(Boolean)
      const existingSet = new Set()
      if (passports.length) {
        const existing = await db.collection('visas').find({ tenant_id: T, passport_no: { $in: passports } }).project({ passport_no: 1, entry_date: 1 }).toArray()
        for (const v of existing) {
          const d = v.entry_date ? new Date(v.entry_date).toISOString().slice(0, 10) : ''
          if (d) existingSet.add(`${v.passport_no}|${d}`)
        }
      }
      // v3.9.9 — Name+Date dedup (main key)
      const existingByNameDate = new Set()
      const names = rows.map(r => String(r.passenger_name || '').trim()).filter(Boolean)
      if (names.length) {
        const existingVisas = await db.collection('visas').find({ tenant_id: T, passenger_name: { $in: names } }).project({ passenger_name: 1, entry_date: 1 }).toArray()
        for (const v of existingVisas) {
          const d = v.entry_date ? new Date(v.entry_date).toISOString().slice(0, 10) : ''
          if (d) existingByNameDate.add(`${String(v.passenger_name || '').trim().toLowerCase()}|${d}`)
        }
      }
      // v3.9.8 — Flexible receipt account
      const allClients = await db.collection('clients').find({ tenant_id: T }).project({ name: 1 }).toArray()
      const allSuppliers = await db.collection('suppliers').find({ tenant_id: T }).project({ name: 1 }).toArray()
      const allBoxes = await db.collection('boxes').find({ tenant_id: T }).project({ id: 1, name: 1, name_ar: 1, type: 1 }).toArray()
      const clientSet = new Set(allClients.map(x => String(x.name).trim().toLowerCase()))
      const supplierSet = new Set(allSuppliers.map(x => String(x.name).trim().toLowerCase()))
      const boxSet = new Set(allBoxes.flatMap(x => [String(x.name_ar || '').trim().toLowerCase(), String(x.name || '').trim().toLowerCase()].filter(Boolean)))
      // v3.92 — duplicate operational names make name-matching AMBIGUOUS → hard, clear error
      const dupOf = (names) => { const cnt = {}; for (const k of names) if (k) cnt[k] = (cnt[k] || 0) + 1; return new Set(Object.keys(cnt).filter(k => cnt[k] > 1)) }
      const clientDups = dupOf(allClients.map(x => String(x.name).trim().toLowerCase()))
      const supplierDups = dupOf(allSuppliers.map(x => String(x.name).trim().toLowerCase()))
      const boxDups = dupOf(allBoxes.flatMap(x => [String(x.name_ar || '').trim().toLowerCase(), String(x.name || '').trim().toLowerCase()].filter(Boolean)))
      const seenInBatch = new Set()
      const seenNameDateInBatch = new Set()
      const validated = rows.map((r, i) => {
        const errors = []
        if (!r.currency || !CURRENCIES.includes(r.currency)) errors.push('العملة غير صالحة')
        if (r.cost === undefined || r.cost === '' || isNaN(Number(r.cost))) errors.push('التكلفة مطلوبة')
        if (r.sale_price === undefined || r.sale_price === '' || isNaN(Number(r.sale_price))) errors.push('سعر البيع مطلوب')
        let receiptKind = null
        if (!r.client_name) errors.push('حساب القبض مطلوب (عميل أو صندوق/بنك)')
        else {
          const key = String(r.client_name).trim().toLowerCase()
          if (clientSet.has(key)) {
            if (clientDups.has(key)) errors.push(`خطأ استيراد: اسم حساب القبض "${r.client_name}" مكرر بين أكثر من عميل — وحّد الأسماء أو صحّح السجلات أولاً`)
            receiptKind = 'client'
          } else if (boxSet.has(key)) {
            if (boxDups.has(key)) errors.push(`خطأ استيراد: اسم الصندوق/البنك "${r.client_name}" مكرر بين أكثر من صندوق — وحّد الأسماء أولاً`)
            receiptKind = 'box'
          }
          else errors.push(`خطأ استيراد: حساب القبض "${r.client_name}" غير موجود (لا عميل ولا صندوق/بنك) — أضِفه يدوياً أولاً`)
        }
        if (!r.supplier_name) errors.push('اسم المورد مطلوب')
        else {
          const supKey = String(r.supplier_name).trim().toLowerCase()
          if (!supplierSet.has(supKey)) errors.push(`خطأ استيراد: المورد "${r.supplier_name}" غير موجود في دليل الحسابات — أضِفه يدوياً أولاً`)
          else if (supplierDups.has(supKey)) errors.push(`خطأ استيراد: اسم المورد "${r.supplier_name}" مكرر بين أكثر من مورد — وحّد الأسماء أولاً`)
        }
        let dup = false
        // v3.18 — Duplicate rule uses ENTRY DATE only (never the transaction date fallback).
        // No entry date => no dedup (accept). Different entry date => accepted as a new operation.
        const rowDate = String(r.entry_date || '').slice(0, 10)
        if (r.passport_no && rowDate && existingSet.has(`${r.passport_no}|${rowDate}`)) dup = 'موجود مسبقاً (جواز + نفس تاريخ الدخول)'
        if (r.passport_no && rowDate && seenInBatch.has(`${r.passport_no}|${rowDate}`)) dup = 'مكرر داخل الملف (جواز + نفس تاريخ الدخول)'
        if (r.passport_no && rowDate) seenInBatch.add(`${r.passport_no}|${rowDate}`)
        // Name+EntryDate dedup
        if (!dup && r.passenger_name && rowDate) {
          const nd = `${String(r.passenger_name).trim().toLowerCase()}|${rowDate}`
          if (existingByNameDate.has(nd)) dup = 'موجود مسبقاً (اسم المعتمر + نفس تاريخ الدخول)'
          else if (seenNameDateInBatch.has(nd)) dup = 'مكرر داخل نفس الملف (اسم + نفس تاريخ الدخول)'
          else seenNameDateInBatch.add(nd)
        }
        return { ...r, __row: i + 1, __errors: errors, __dup: dup, __receipt_kind: receiptKind, __commission: (Number(r.sale_price) || 0) - (Number(r.cost) || 0) }
      })
      const totals = validated.reduce((acc, r) => {
        const c = r.currency || 'USD'
        if (!acc[c]) acc[c] = { count: 0, cost: 0, sale: 0, profit: 0 }
        acc[c].count++; acc[c].cost += Number(r.cost) || 0; acc[c].sale += Number(r.sale_price) || 0; acc[c].profit += r.__commission
        return acc
      }, {})
      return ok({ rows: validated, totals, valid_count: validated.filter(v => v.__errors.length === 0 && !v.__dup).length })
    }
    if (route === '/import/visas' && method === 'POST') {
      const b = await request.json()
      const rows = Array.isArray(b.rows) ? b.rows : []
      const skip = b.skip_duplicates !== false
      let created = 0, skipped = 0, failed = 0
      const errors = []
      for (const r of rows) {
        if (skip && r.__dup) { skipped++; continue }
        if (r.__errors && r.__errors.length) { failed++; errors.push({ row: r.__row, errors: r.__errors }); continue }
        // v3.9.8 — Receipt account may be a client (credit) OR a box/bank (cash)
        // v3.92 — STRICT resolution: the row must resolve to EXACTLY ONE linked record.
        // Ambiguity (duplicate names) fails with a clear message — nothing is auto-created.
        const findStrict = async (coll, filter) => { const l = await db.collection(coll).find(filter).limit(2).toArray(); return { doc: l[0] || null, dup: l.length > 1 } }
        const nameTrim = r.client_name ? String(r.client_name).trim() : ''
        const cliR = nameTrim ? await findStrict('clients', { tenant_id: T, name: nameTrim }) : { doc: null, dup: false }
        if (cliR.dup) { failed++; errors.push({ row: r.__row, errors: [`اسم حساب القبض "${nameTrim}" مكرر بين أكثر من عميل — وحّد الأسماء أولاً`] }); continue }
        const cli = cliR.doc
        let box = null
        if (!cli && nameTrim) {
          const boxR = await findStrict('boxes', { tenant_id: T, $or: [{ name_ar: nameTrim }, { name: nameTrim }] })
          if (boxR.dup) { failed++; errors.push({ row: r.__row, errors: [`اسم الصندوق/البنك "${nameTrim}" مكرر بين أكثر من صندوق — وحّد الأسماء أولاً`] }); continue }
          box = boxR.doc
        }
        const supR = r.supplier_name ? await findStrict('suppliers', { tenant_id: T, name: String(r.supplier_name).trim() }) : { doc: null, dup: false }
        if (supR.dup) { failed++; errors.push({ row: r.__row, errors: [`اسم المورد "${r.supplier_name}" مكرر بين أكثر من مورد — وحّد الأسماء أولاً`] }); continue }
        const sup = supR.doc
        if (!cli && !box) { failed++; errors.push({ row: r.__row, errors: [`حساب القبض "${r.client_name}" غير موجود (لا عميل ولا صندوق/بنك)`] }); continue }
        if (!sup) { failed++; errors.push({ row: r.__row, errors: [`المورد "${r.supplier_name}" غير موجود في دليل الحسابات`] }); continue }
        const payload = box
          ? { ...r, client_id: null, client_name: nameTrim, supplier_id: sup.id, payment_method: 'cash', box_id: box.id }
          : { ...r, client_id: cli.id, supplier_id: sup.id, payment_method: r.payment_method === 'cash' ? 'cash' : 'credit' }
        const result = await createVisa(db, T, payload)
        if (result.error) { failed++; errors.push({ row: r.__row, errors: [result.error] }) } else created++
      }
      return ok({ created, skipped, failed, errors })
    }

    // Vouchers
    if (route === '/vouchers' && method === 'GET') {
      const filter = { ...tf }; if (q.type) filter.type = q.type
      return ok(clean(await db.collection('vouchers').find(filter).sort({ date: -1, created_at: -1 }).limit(500).toArray()))
    }
    if (route === '/vouchers' && method === 'POST') {
      const b = await request.json()
      // v3.51 — RBAC Phase 3: staff restricted to specific boxes cannot use other boxes
      {
        const abIds = Array.isArray(sess.user.allowed_box_ids) ? sess.user.allowed_box_ids : []
        if (sess.user.role !== 'owner' && abIds.length > 0 && b.box_id && !abIds.includes(String(b.box_id))) {
          return bad('🚫 غير مصرح — هذا الصندوق خارج الصناديق المسموحة لك', 403)
        }
      }
      const result = await createVoucher(db, T, b)
      if (result.error) return bad(result.error)
      return ok(result.doc)
    }

    // Journal entries
    if (route === '/journal-entries' && method === 'GET') return ok(clean(await db.collection('journal_entries').find(tf).sort({ date: -1, created_at: -1 }).limit(500).toArray()))

    // v3.9.11 — Packages bulk operations
    if (route === '/packages/bulk-delete' && method === 'POST') {
      const body = await request.json()
      const ids = Array.isArray(body.ids) ? body.ids : []
      if (ids.length === 0) return bad('لم يتم اختيار أي باكج')
      let deleted = 0, failed = 0
      const errors = []
      for (const id of ids) {
        try {
          const pkg = await db.collection('packages').findOne({ id, tenant_id: T })
          if (!pkg) { failed++; errors.push({ id, error: 'غير موجود' }); continue }
          // Prevent delete if bookings exist
          const bookingsCount = await db.collection('package_bookings').countDocuments({ package_id: id, tenant_id: T, status: { $ne: 'cancelled' } }) // v3.74
          if (bookingsCount > 0) { failed++; errors.push({ id, error: `يوجد ${bookingsCount} حجز مرتبط — أزلها أولاً` }); continue }
          // v3.30/v3.32 — Meraaj-listed packages: deliver package.deactivated FIRST; if delivery FAILS, skip local delete
          if (pkg.meraaj?.shared || pkg.meraaj?.registered_at) {
            const dlv = await emitMeraajEvent(db, T, 'package.deactivated', { package_ref: pkg.id, reason: 'deleted_by_office' })
            if (dlv === 'failed') { failed++; errors.push({ id, error: 'تعذر إبلاغ معراج بإيقاف الباكج — لم يُحذف' }); continue }
          }
          await db.collection('packages').deleteOne({ id, tenant_id: T })
          deleted++
        } catch (e) { failed++; errors.push({ id, error: e.message }) }
      }
      return ok({ ok: true, deleted, failed, errors })
    }
    if (route === '/packages/bulk-close' && method === 'POST') {
      const body = await request.json()
      const ids = Array.isArray(body.ids) ? body.ids : []
      if (ids.length === 0) return bad('لم يتم اختيار أي باكج')
      const status = body.status === 'open' ? 'open' : 'closed'
      // v3.30 — capture Meraaj-shared packages BEFORE the bulk status change for marketplace sync
      const affectedShared = await db.collection('packages').find({ id: { $in: ids }, tenant_id: T, 'meraaj.shared': true }).toArray()
      const r = await db.collection('packages').updateMany({ id: { $in: ids }, tenant_id: T }, { $set: { status, updated_at: new Date() } })
      try {
        for (const p of affectedShared) {
          if (status === 'closed') {
            await emitMeraajEvent(db, T, 'package.deactivated', { package_ref: p.id, reason: 'closed_by_office' })
          } else {
            const fresh = await db.collection('packages').findOne({ id: p.id, tenant_id: T })
            const compsB = await db.collection('package_components').find({ package_id: p.id, tenant_id: T }).toArray()
            await emitMeraajEvent(db, T, 'package.updated', await meraajContractPayload(db, T, fresh, compsB))
          }
        }
      } catch { /* marketplace sync must never break bulk ops */ }
      return ok({ ok: true, updated: r.modifiedCount, status })
    }

    // v3.9.9 — Bulk delete for tickets/visas/services/vouchers/fx (reverses balances + JEs per row)
    const bulkDelMatch = route.match(/^\/(tickets|visas|services|vouchers|fx)\/bulk-delete$/)
    if (bulkDelMatch && method === 'POST') {
      const [_, kind] = bulkDelMatch
      const coll = kind === 'fx' ? 'currency_exchanges' : kind
      const body = await request.json()
      const ids = Array.isArray(body.ids) ? body.ids : []
      if (ids.length === 0) return bad('لم يتم اختيار أي سجل')
      if (ids.length > 500) return bad('الحد الأقصى للحذف الجماعي 500 سجل في المرة')
      let deleted = 0, failed = 0
      const errors = []
      for (const docId of ids) {
        try {
          const doc = await db.collection(coll).findOne({ id: docId, tenant_id: T })
          if (!doc) { failed++; errors.push({ id: docId, error: 'غير موجود' }); continue }
          const je = await db.collection('journal_entries').findOne({ ref_id: docId, tenant_id: T })
          // v4.6 — RAH-ACC: per-row closed year/period guard (bulk delete must not rewrite closed books)
          const perrBD = await assertOpenPeriod(db, T, je?.date || doc.date)
          if (perrBD) { failed++; errors.push({ id: docId, error: `داخل فترة/سنة مقفلة — ${perrBD}` }); continue }
          if (kind === 'tickets' || kind === 'visas' || kind === 'services') {
            if (doc.payment_method === 'cash' && doc.box_id) {
              await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, -doc.sale_price)
            } else if (doc.client_id) {
              await updateBalance(db, 'clients', { id: doc.client_id, tenant_id: T }, doc.currency, -doc.sale_price)
            }
            if (doc.supplier_id) await updateBalance(db, 'suppliers', { id: doc.supplier_id, tenant_id: T }, doc.currency, -doc.cost)
          } else if (kind === 'vouchers') {
            if (doc.type === 'receipt') {
              await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, -doc.amount)
              if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
              if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
            } else {
              await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, +doc.amount)
              if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
              if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
            }
          } else if (kind === 'fx') {
            if (doc.type === 'buy') {
              await updateBalance(db, 'boxes', { id: doc.box_currency_id, tenant_id: T }, doc.currency, -doc.amount)
              await updateBalance(db, 'boxes', { id: doc.box_counter_id, tenant_id: T }, doc.counter_currency, +doc.counter_amount)
            } else {
              await updateBalance(db, 'boxes', { id: doc.box_currency_id, tenant_id: T }, doc.currency, +doc.amount)
              await updateBalance(db, 'boxes', { id: doc.box_counter_id, tenant_id: T }, doc.counter_currency, -doc.counter_amount)
            }
          }
          if (je) {
            await db.collection('journal_entries').deleteOne({ id: je.id, tenant_id: T }) // v4.6 — tenant-scoped
            await db.collection('tenants').updateOne({ id: T, 'journal_quota.used': { $gt: 0 } }, { $inc: { 'journal_quota.used': -1 } }) // v4.6 — never below 0
          }
          await db.collection(coll).deleteOne({ id: docId, tenant_id: T })
          deleted++
        } catch (e) {
          failed++
          errors.push({ id: docId, error: e.message })
        }
      }
      return ok({ success: true, deleted, failed, errors, kind })
    }

    // v3.9.10 — Bulk edit for tickets/visas (partial updates on supplier, date, payment_method, box_id)
    const bulkEditMatch = route.match(/^\/(tickets|visas|services)\/bulk-edit$/)
    if (bulkEditMatch && method === 'POST') {
      const [_, kind] = bulkEditMatch
      const coll = kind
      const body = await request.json()
      const ids = Array.isArray(body.ids) ? body.ids : []
      const changes = body.changes || {}
      if (ids.length === 0) return bad('لم يتم اختيار أي سجل')
      if (ids.length > 300) return bad('الحد الأقصى للتعديل الجماعي 300 سجل في المرة')
      const allowed = ['supplier_id', 'date', 'payment_method', 'box_id', 'currency', 'exchange_rate']
      const changeKeys = Object.keys(changes).filter(k => allowed.includes(k) && changes[k] !== undefined && changes[k] !== null && changes[k] !== '')
      if (changeKeys.length === 0) return bad('لم يتم تحديد أي تغيير')
      // v3.80 — reject future doc date EARLY (before the destructive reverse+delete+recreate loop)
      if (changes.date && isFutureDocDate(changes.date)) return bad(`${FUTURE_DOC_DATE_MSG} (تاريخ المستند)`)
      let updated = 0, failed = 0
      const errors = []
      for (const docId of ids) {
        try {
          const oldDoc = await db.collection(coll).findOne({ id: docId, tenant_id: T })
          if (!oldDoc) { failed++; errors.push({ id: docId, error: 'غير موجود' }); continue }
          const oldJe = await db.collection('journal_entries').findOne({ ref_id: docId, tenant_id: T })
          // v4.6 — RAH-ACC: per-row closed year/period guard on the ORIGINAL side (bulk edit
          // reverses + deletes + recreates — closed books must never be rewritten)
          const perrBE = await assertOpenPeriod(db, T, oldJe?.date || oldDoc.date)
          if (perrBE) { failed++; errors.push({ id: docId, error: `داخل فترة/سنة مقفلة — ${perrBE}` }); continue }
          // Build new body from oldDoc + partial changes
          const newBody = {
            date: oldDoc.date, currency: oldDoc.currency, exchange_rate: oldDoc.exchange_rate,
            client_id: oldDoc.client_id, supplier_id: oldDoc.supplier_id,
            cost: oldDoc.cost, sale_price: oldDoc.sale_price, payment_method: oldDoc.payment_method,
            box_id: oldDoc.box_id, client_name: oldDoc.client_name,
            // preserve type-specific fields
            pnr: oldDoc.pnr, route: oldDoc.route, ticket_number: oldDoc.ticket_number, passenger_name: oldDoc.passenger_name,
            carrier: oldDoc.carrier, class: oldDoc.class,
            // v3.80b — FIX: these required fields were dropped during bulk-edit reconstruction,
            // making every tickets bulk-edit fail with «رقم الجوال مطلوب» and visas with «اسم صاحب التأشيرة مطلوب»
            passenger_phone: oldDoc.passenger_phone, passenger_whatsapp: oldDoc.passenger_whatsapp, phone: oldDoc.phone,
            // visas VALIDATE beneficiary_* but STORE passenger_* — fall back so re-validation passes with identical data
            beneficiary_name: oldDoc.beneficiary_name || oldDoc.passenger_name, beneficiary_phone: oldDoc.beneficiary_phone || oldDoc.passenger_phone, beneficiary_whatsapp: oldDoc.beneficiary_whatsapp || oldDoc.passenger_whatsapp,
            passport_no: oldDoc.passport_no, nationality: oldDoc.nationality, service_type: oldDoc.service_type,
            visa_type: oldDoc.visa_type, entry_date: oldDoc.entry_date, exit_date: oldDoc.exit_date,
            travel_date: oldDoc.travel_date, notes: oldDoc.notes, description: oldDoc.description,
          }
          for (const k of changeKeys) newBody[k] = changes[k]
          // If payment_method switching from credit->cash, require box_id
          if (newBody.payment_method === 'cash' && !newBody.box_id) { failed++; errors.push({ id: docId, error: 'الدفع نقد يتطلب اختيار صندوق' }); continue }
          if (newBody.payment_method === 'credit') newBody.box_id = null
          // Reverse old effects
          await reverseTransactionEffects(db, T, kind, oldDoc)
          if (oldJe) await db.collection('journal_entries').deleteOne({ id: oldJe.id, tenant_id: T }) // v4.6 — tenant-scoped
          await db.collection(coll).deleteOne({ id: docId, tenant_id: T })
          const opts = { existingId: docId, skipQuota: true, createdAt: oldDoc.created_at }
          let result
          try {
            if (kind === 'tickets') result = await createTicket(db, T, newBody, opts)
            else if (kind === 'visas') result = await createVisa(db, T, newBody, opts)
            else if (kind === 'services') result = await createService(db, T, newBody, opts)
          } catch (createErr) { result = { error: createErr.message } } // v3.88.5 — F-020: same restore path
          if (result.error) {
            failed++; errors.push({ id: docId, error: result.error })
            // v3.88.5 — F-020 ATOMIC RESTORE: never swallowed — a restore failure ABORTS the batch
            try {
              await db.collection(coll).replaceOne({ id: docId, tenant_id: T }, oldDoc, { upsert: true })
              if (oldJe) await db.collection('journal_entries').replaceOne({ id: oldJe.id, tenant_id: T }, oldJe, { upsert: true })
              await restoreTransactionEffects(db, T, kind, oldDoc)
            } catch (restoreErr) {
              console.error(`[F-020] CRITICAL: bulk restore failed for ${kind}/${docId}:`, restoreErr)
              return bad(`توقفت المعالجة: فشلت الاستعادة التلقائية للسجل ${docId} (${restoreErr.message}) — يلزم فحص يدوي فوري. تم تحديث ${updated} وفشل ${failed} قبل التوقف`, 500)
            }
          } else updated++
        } catch (e) {
          failed++
          errors.push({ id: docId, error: e.message })
        }
      }
      return ok({ success: true, updated, failed, errors, kind })
    }

    // Universal DELETE for transactional records (reverses JE + balances + decrements quota)
    const delMatch = route.match(/^\/(tickets|visas|services|vouchers|fx)\/([^/]+)$/)
    if (delMatch && method === 'DELETE') {
      const [_, kind, docId] = delMatch
      const coll = kind === 'fx' ? 'currency_exchanges' : kind
      const doc = await db.collection(coll).findOne({ id: docId, tenant_id: T })
      if (!doc) return bad('العنصر غير موجود', 404)
      // Reverse balance updates & delete linked journal entry
      const je = await db.collection('journal_entries').findOne({ ref_id: docId, tenant_id: T })
      // v4.6 — RAH-ACC: a document whose journal lives inside a closed year/period must not
      // be deleted — that silently rewrites closed books (same central rule as manual JEs).
      const perrUD = await assertOpenPeriod(db, T, je?.date || doc.date)
      if (perrUD) return bad(`السجل داخل فترة/سنة مقفلة ولا يُحذف — ${perrUD}`)
      if (kind === 'tickets' || kind === 'visas' || kind === 'services') {
        if (doc.payment_method === 'cash' && doc.box_id) {
          await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, -doc.sale_price)
        } else {
          await updateBalance(db, 'clients', { id: doc.client_id, tenant_id: T }, doc.currency, -doc.sale_price)
        }
        await updateBalance(db, 'suppliers', { id: doc.supplier_id, tenant_id: T }, doc.currency, -doc.cost)
      } else if (kind === 'vouchers') {
        if (doc.type === 'receipt') {
          await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, -doc.amount)
          if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
          if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
        } else {
          await updateBalance(db, 'boxes', { id: doc.box_id, tenant_id: T }, doc.currency, +doc.amount)
          if (doc.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: doc.party_id, tenant_id: T }, doc.currency, +doc.amount)
          if (doc.party_type === 'client') await updateBalance(db, 'clients', { id: doc.party_id, tenant_id: T }, doc.currency, -doc.amount)
        }
      } else if (kind === 'fx') {
        if (doc.type === 'buy') {
          await updateBalance(db, 'boxes', { id: doc.box_currency_id, tenant_id: T }, doc.currency, -doc.amount)
          await updateBalance(db, 'boxes', { id: doc.box_counter_id, tenant_id: T }, doc.counter_currency, +doc.counter_amount)
        } else {
          await updateBalance(db, 'boxes', { id: doc.box_currency_id, tenant_id: T }, doc.currency, +doc.amount)
          await updateBalance(db, 'boxes', { id: doc.box_counter_id, tenant_id: T }, doc.counter_currency, -doc.counter_amount)
        }
      }
      if (je) {
        await db.collection('journal_entries').deleteOne({ id: je.id, tenant_id: T }) // v4.6 — tenant-scoped
        await db.collection('tenants').updateOne({ id: T, 'journal_quota.used': { $gt: 0 } }, { $inc: { 'journal_quota.used': -1 } }) // v4.6 — never below 0
      }
      await db.collection(coll).deleteOne({ id: docId, tenant_id: T })
      return ok({ success: true, deleted: kind, id: docId })
    }

    // ============ PUT /:kind/:id — EDIT MODE (reverse old JE, keep quota, re-post new) ============
    const putMatch = route.match(/^\/(tickets|visas|services|vouchers|fx)\/([^/]+)$/)
    if (putMatch && method === 'PUT') {
      const [_, kind, docId] = putMatch
      const coll = kind === 'fx' ? 'currency_exchanges' : kind
      const b = await request.json()
      const oldDoc = await db.collection(coll).findOne({ id: docId, tenant_id: T })
      if (!oldDoc) return bad('السجل غير موجود', 404)
      const oldJe = await db.collection('journal_entries').findOne({ ref_id: docId, tenant_id: T })
      // v4.6 — RAH-ACC: closed year/period guard on the ORIGINAL side BEFORE any destructive
      // step (same "both sides" rule as manual-journal edits in v4.5) — editing a document
      // whose journal is inside a closed period silently rewrites closed books.
      const perrUP = await assertOpenPeriod(db, T, oldJe?.date || oldDoc.date)
      if (perrUP) return bad(`السجل الأصلي داخل فترة/سنة مقفلة — لا يمكن تعديله: ${perrUP}`)
      // Step 1: Reverse balance effects of the old record
      await reverseTransactionEffects(db, T, kind, oldDoc)
      // Step 2: Delete old JE (without decrementing quota, since we'll re-post)
      if (oldJe) await db.collection('journal_entries').deleteOne({ id: oldJe.id, tenant_id: T }) // v4.6 — tenant-scoped
      // Step 3: Delete the old record so we can re-insert with same id
      await db.collection(coll).deleteOne({ id: docId, tenant_id: T })
      // Step 4: Re-create with same id + skip quota (edit doesn't count against limit)
      let result
      const opts = { existingId: docId, skipQuota: true, createdAt: oldDoc.created_at }
      try {
        if (kind === 'tickets') result = await createTicket(db, T, b, opts)
        else if (kind === 'visas') result = await createVisa(db, T, b, opts)
        else if (kind === 'services') result = await createService(db, T, b, opts)
        else if (kind === 'vouchers') result = await createVoucher(db, T, { ...b, type: b.type || oldDoc.type }, opts)
        else if (kind === 'fx') result = await createFx(db, T, { ...b, type: b.type || oldDoc.type }, opts)
      } catch (createErr) {
        // v3.88.5 — F-020: thrown errors (e.g. PARTY_NO_LEAF_ACCOUNT) take the SAME restore path
        result = { error: createErr.message }
      }
      if (result.error) {
        // v3.88.5 — F-020 ATOMIC RESTORE (review round): restore failures are NEVER swallowed.
        // replaceOne+upsert is idempotent (safe even if the failed create partially inserted a
        // doc with the same id); order is doc → JE → balances, and ANY restore failure aborts
        // with a loud 500 — balances can never be restored while the doc/JE restore failed.
        try {
          await db.collection(coll).replaceOne({ id: docId, tenant_id: T }, oldDoc, { upsert: true })
          if (oldJe) await db.collection('journal_entries').replaceOne({ id: oldJe.id, tenant_id: T }, oldJe, { upsert: true })
          await restoreTransactionEffects(db, T, kind, oldDoc)
        } catch (restoreErr) {
          console.error(`[F-020] CRITICAL: restore failed for ${kind}/${docId}:`, restoreErr)
          return bad(`فشل التعديل (${result.error}) ثم فشلت الاستعادة التلقائية (${restoreErr.message}) — لا تُعد المحاولة؛ يلزم فحص يدوي فوري للسجل ${docId} وقيده وأرصدته`, 500)
        }
        return bad(`${result.error} — لم يُطبق أي تغيير: تمت استعادة السجل والقيد والأرصدة الأصلية كما كانت`)
      }
      return ok(result.doc)
    }

    // Manual Journal Voucher (single-currency or dual)
    if (route === '/journal-entries' && method === 'POST') {
      const b = await request.json()
      const result = await createManualJournal(db, T, b)
      if (result.error) {
        // v4.8.2 — PR#18 (final point): the explicit unsafe state from createManualJournal
        // is no longer dropped by bad() — HTTP 500 + unsafe_state + no_retry in the JSON
        // body + je_audit (tenant/actor/state/error). Normal pre-write rejections
        // (validation / dry-run / period / quota) keep their current bad(400) logic.
        if (result.unsafe_state) {
          console.error('[JE-CREATE] CRITICAL unsafe state', result.unsafe_state, result.error)
          try {
            await db.collection('je_audit').insertOne({ id: uuidv4(), tenant_id: T, action: 'create_failed_unsafe_state', ref_type: b?.dual ? 'manual_dual' : 'manual', unsafe_state: result.unsafe_state, balances_need_manual_review: true, error: String(result.error).slice(0, 300), by: sess.user.email, at: new Date() })
          } catch { }
          return cors(NextResponse.json({
            error: `⛔ ${result.error} — لا تُعد المحاولة؛ يلزم فحص يدوي فوري للقيد والأرصدة`,
            unsafe_state: result.unsafe_state,
            no_retry: true,
          }, { status: 500 }))
        }
        return bad(result.error)
      }
      return ok(result.doc)
    }

    // PUT /journal-entries/:id — edit manual JE (only manual + manual_dual are editable)
    const jeIdMatch = route.match(/^\/journal-entries\/([^/]+)$/)
    if (jeIdMatch && method === 'PUT') {
      const jeId = jeIdMatch[1]
      const b = await request.json()
      const oldJe = await db.collection('journal_entries').findOne({ id: jeId, tenant_id: T })
      if (!oldJe) return bad('القيد غير موجود', 404)
      if (!['manual', 'manual_dual'].includes(oldJe.ref_type)) return bad('لا يمكن تعديل قيود المعاملات مباشرةً — عدّل السجل المرتبط', 400)
      // v3.80 — reject future doc date EARLY (this handler deletes the old JE before re-creating,
      // with no restore-on-error mechanism — validating here prevents data loss)
      if (isFutureDocDate(b.date)) return bad(`${FUTURE_DOC_DATE_MSG} (تاريخ القيد)`)
      // v4.5 — closed period/year guard on BOTH sides BEFORE any destructive step:
      // the ORIGINAL date (a journal inside a closed period must not be silently rewritten)
      // and the NEW date (validated again centrally, but checked here pre-destruction).
      const perrOld = await assertOpenPeriod(db, T, oldJe.date)
      if (perrOld) return bad(`القيد الأصلي داخل فترة/سنة مقفلة — ${perrOld}`)
      const perrNew = await assertOpenPeriod(db, T, b.date)
      if (perrNew) return bad(perrNew)
      // Reverse old effects
      await reverseManualJournalEffects(db, T, oldJe)
      await db.collection('journal_entries').deleteOne({ id: jeId, tenant_id: T }) // v4.5 — tenant-scoped delete
      // Re-create with same id + skip quota
      let result
      try {
        result = await createManualJournal(db, T, b, { existingId: jeId, skipQuota: true, createdAt: oldJe.created_at, actor: sess.user.email })
      } catch (e) {
        result = { error: e?.message || 'فشل غير متوقع أثناء إعادة إنشاء القيد' }
      }
      if (result.error) {
        // v4.8.1 — PR#18-2: UNSAFE STATES are handled explicitly and are NEVER recorded
        // as a full restore (edit_failed_restored) nor announced as a successful recovery.
        if (result.unsafe_state) {
          console.error('[JE-EDIT] CRITICAL unsafe state for', jeId, result.unsafe_state, result.error)
          let oldDocRestored = false
          if (result.unsafe_state === 'partial') {
            // journal NOT saved (id is free) → re-insert the ORIGINAL document only, to
            // preserve ledger history. Balance re-apply is deliberately SKIPPED: residual
            // partial effects of the new attempt are unknown — re-applying old effects
            // on top could double-count. Balances require manual reconciliation.
            try {
              const { _id: _omitU, ...restoreDocU } = oldJe
              await db.collection('journal_entries').insertOne({ ...restoreDocU })
              oldDocRestored = true
            } catch (rdErr) { console.error('[JE-EDIT] old-doc reinsert failed for', jeId, rdErr) }
          } // 'uncertain': the NEW journal may already exist with the SAME id — reinserting would duplicate it
          try {
            await db.collection('je_audit').insertOne({ id: uuidv4(), tenant_id: T, action: 'edit_failed_unsafe_state', je_id: jeId, ref_type: oldJe.ref_type, unsafe_state: result.unsafe_state, old_doc_restored: oldDocRestored, balances_need_manual_review: true, error: String(result.error).slice(0, 300), by: sess.user.email, at: new Date() })
          } catch { }
          return bad(`⛔ فشل التعديل بحالة غير آمنة (${result.unsafe_state === 'uncertain' ? 'حفظ القيد الجديد غير مؤكد' : 'أثر جزئي متبقٍ من المحاولة الجديدة'}) — لا تُعد المحاولة إطلاقاً؛ يلزم فحص يدوي فوري للقيد ${jeId} وأرصدة أطرافه قبل أي إجراء${oldDocRestored ? ' (أُعيد مستند القيد الأصلي للسجل دون إعادة تطبيق أرصدته)' : ''}. التفاصيل: ${result.error}`, 500)
        }
        // v4.5/v4.8 — NO PARTIAL STATE, NO SILENT HISTORY LOSS: createManualJournal now
        // guarantees ZERO residual new-attempt effects (dry-run + tracked compensation),
        // so restoring the ORIGINAL journal + its effects fully returns the books to the
        // pre-edit state. A restore failure is NEVER reported as a successful restore.
        try {
          const { _id: _omit, ...restoreDoc } = oldJe
          await db.collection('journal_entries').insertOne({ ...restoreDoc })
          await applyManualJournalEffects(db, T, oldJe)
        } catch (restoreErr) {
          console.error('[JE-EDIT] CRITICAL: restore failed for', jeId, restoreErr)
          try {
            await db.collection('je_audit').insertOne({ id: uuidv4(), tenant_id: T, action: 'edit_failed_restore_failed', je_id: jeId, ref_type: oldJe.ref_type, error: `${String(result.error).slice(0, 200)} || restore: ${String(restoreErr?.message || restoreErr).slice(0, 200)}`, by: sess.user.email, at: new Date() })
          } catch { }
          return bad(`فشل التعديل (${result.error}) ثم فشلت الاستعادة التلقائية (${restoreErr?.message || restoreErr}) — لا تُعد المحاولة؛ يلزم فحص يدوي فوري للقيد ${jeId} وأرصدته`, 500)
        }
        try {
          await db.collection('je_audit').insertOne({ id: uuidv4(), tenant_id: T, action: 'edit_failed_restored', je_id: jeId, ref_type: oldJe.ref_type, error: String(result.error).slice(0, 300), by: sess.user.email, at: new Date() })
        } catch { }
        return bad(`فشل التعديل — استُرجع القيد الأصلي وأرصدته كما كانت. السبب: ${result.error}`)
      }
      // v4.5 — audit the successful modification of a POSTED journal (before-image kept)
      try {
        await db.collection('je_audit').insertOne({ id: uuidv4(), tenant_id: T, action: 'edit', je_id: jeId, ref_type: oldJe.ref_type, before: { date: oldJe.date, description: oldJe.description, currency: oldJe.currency, lines: oldJe.lines }, by: sess.user.email, at: new Date() })
      } catch { }
      return ok(result.doc)
    }

    // ============ Currency Exchange (Buy/Sell) ============
    if (route === '/fx' && method === 'GET') {
      return ok(clean(await db.collection('currency_exchanges').find(tf).sort({ date: -1, created_at: -1 }).limit(500).toArray()))
    }
    if (route === '/fx' && method === 'POST') {
      const b = await request.json()
      const result = await createFx(db, T, b)
      if (result.error) return bad(result.error)
      return ok(result.doc)
    }

    // ================= v3.87 — OPENING BALANCE ENTRIES =================
    // Single-sided input: user picks account/box/client/supplier + currency + amount + side.
    // The system auto-balances against COA.OPENING_EQUITY (3103) — double-entry preserved.
    if (route === '/journal-entries/opening' && method === 'POST') {
      const b = await request.json()
      const amount = Number(b.amount)
      const side = b.side === 'credit' ? 'credit' : 'debit'
      const currency = ['SAR', 'USD', 'YER'].includes(b.currency) ? b.currency : null
      const date = String(b.date || '').slice(0, 10)
      if (!amount || amount <= 0) return bad('المبلغ مطلوب ويجب أن يكون أكبر من صفر')
      if (!currency) return bad('العملة مطلوبة (SAR / USD / YER)')
      if (!date) return bad('تاريخ الافتتاح مطلوب')
      if (isFutureDocDate(date)) return bad(`${FUTURE_DOC_DATE_MSG} (تاريخ القيد الافتتاحي)`)
      // v4.5 — CENTRAL guard (closed YEAR + period lock together): this route writes the
      // journal directly (bypassing the central gate) and previously missed closed_years.
      const perrOp = await assertOpenPeriod(db, T, date)
      if (perrOp) return bad(perrOp)
      // Resolve the target: party (box/client/supplier) or a direct COA leaf account
      let accountCode = null, accountName = null, partyType = null, partyId = null
      const kind = String(b.party_type || 'account')
      if (kind === 'box' || kind === 'client' || kind === 'supplier') {
        const col = kind === 'box' ? 'boxes' : kind === 'client' ? 'clients' : 'suppliers'
        const party = await db.collection(col).findOne({ id: String(b.party_id || ''), tenant_id: T })
        if (!party) return bad(kind === 'box' ? 'الصندوق غير موجود' : kind === 'client' ? 'العميل غير موجود' : 'المورد غير موجود')
        accountCode = party.account_code || null
        accountName = party.name_ar || party.name || ''
        partyType = kind; partyId = party.id
        if (!accountCode) return bad('هذا الطرف بلا رمز حساب في الدليل — أعد بناء الدليل أولاً')
      } else {
        const acct = await db.collection('accounts').findOne({ tenant_id: T, code: String(b.account_code || '') })
        if (!acct) return bad('الحساب غير موجود في الدليل')
        if (acct.is_group) return bad('اختر حساباً تفصيلياً (وليس مجموعة)')
        // v4.6 — RAH-ACC: an inactive account must not receive a NEW opening balance
        // (same central rule the journal gate applies — history untouched)
        if (isInactiveAccount(acct)) return bad(`الحساب "${acct.code} — ${acct.name_ar || ''}" غير نشط — لا يقبل رصيداً افتتاحياً جديداً`)
        if (!['asset', 'liability', 'equity'].includes(acct.type)) {
          return bad('الأرصدة الافتتاحية للأصول والخصوم وحقوق الملكية فقط — نتيجة الإيرادات والمصروفات للسنة السابقة تُقفل ضمن الأرباح المبقاة (3102)')
        }
        if (acct.code === COA.OPENING_EQUITY) return bad('لا يمكن إدخال رصيد افتتاحي مباشرةً على حساب التسوية 3103')
        accountCode = acct.code; accountName = acct.name_ar
      }
      const targetLine = { account_code: accountCode, account_name: accountName, party_type: partyType, party_id: partyId, party_name: accountName, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0 }
      const equityLine = { account_code: COA.OPENING_EQUITY, account_name: OPENING_EQUITY_NAME, debit: side === 'credit' ? amount : 0, credit: side === 'debit' ? amount : 0 }
      const je = {
        id: uuidv4(), tenant_id: T, date: bizDayStart(date), currency, ref_type: 'opening', ref_id: null, // v3.88.4 — F-017: Date-typed (was string)
        description: `قيد افتتاحي — ${accountName}${b.note ? ' — ' + String(b.note).slice(0, 300) : ''}`,
        lines: [targetLine, equityLine], created_by: sess.user.email, created_at: new Date(),
      }
      await db.collection('journal_entries').insertOne(je)
      // Party running balances (per-currency dimension inside the SAME box/party — no per-currency accounts)
      if (partyType === 'box') await updateBalance(db, 'boxes', { id: partyId, tenant_id: T }, currency, side === 'debit' ? amount : -amount)
      if (partyType === 'client') await updateBalance(db, 'clients', { id: partyId, tenant_id: T }, currency, side === 'debit' ? amount : -amount)
      if (partyType === 'supplier') await updateBalance(db, 'suppliers', { id: partyId, tenant_id: T }, currency, side === 'credit' ? amount : -amount)
      const { _id, ...jeOut } = je
      return ok({ entry: jeOut })
    }
    // 3103 status per currency (MUST be reviewed before closing)
    if (route === '/journal-entries/opening-equity-status' && method === 'GET') {
      const rows = await db.collection('journal_entries').aggregate([
        { $match: { tenant_id: T } }, { $unwind: '$lines' },
        { $match: { 'lines.account_code': COA.OPENING_EQUITY } },
        { $group: { _id: '$currency', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' }, count: { $sum: 1 } } },
      ]).toArray()
      const perCurrency = rows.map(r => ({ currency: r._id, debit: round2n(r.debit), credit: round2n(r.credit), net_credit: round2n(r.credit - r.debit), count: r.count }))
      const openingCount = await db.collection('journal_entries').countDocuments({ tenant_id: T, ref_type: 'opening' })
      return ok({ account_code: COA.OPENING_EQUITY, account_name: OPENING_EQUITY_NAME, per_currency: perCurrency, opening_entries: openingCount })
    }
    // Close 3103 into Capital (3101) or Retained Earnings (3102) — one JE per non-zero currency
    if (route === '/journal-entries/opening-equity-close' && method === 'POST') {
      const b = await request.json()
      const target = b.target === COA.CAPITAL ? COA.CAPITAL : b.target === COA.RETAINED_EARNINGS ? COA.RETAINED_EARNINGS : null
      if (!target) return bad(`وجهة الإقفال يجب أن تكون رأس المال (${COA.CAPITAL}) أو الأرباح المبقاة (${COA.RETAINED_EARNINGS})`)
      const date = String(b.date || '').slice(0, 10)
      if (!date) return bad('تاريخ الإقفال مطلوب')
      if (isFutureDocDate(date)) return bad(`${FUTURE_DOC_DATE_MSG} (تاريخ الإقفال)`)
      // v4.5 — central closed year/period guard (this route writes journals directly)
      const perrOc = await assertOpenPeriod(db, T, date)
      if (perrOc) return bad(perrOc)
      // v3.87 — optional per-currency close: pass currency: 'SAR' to close ONLY that
      // currency independently; omit (or 'ALL') to close every non-zero currency.
      const onlyCcy = ['SAR', 'USD', 'YER'].includes(b.currency) ? b.currency : null
      const targetAcct = await db.collection('accounts').findOne({ tenant_id: T, code: target })
      if (!targetAcct) return bad('حساب الوجهة غير موجود في الدليل')
      const rows = await db.collection('journal_entries').aggregate([
        { $match: { tenant_id: T } }, { $unwind: '$lines' },
        { $match: { 'lines.account_code': COA.OPENING_EQUITY } },
        { $group: { _id: '$currency', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
      ]).toArray()
      const closed = []
      for (const r of rows) {
        if (onlyCcy && r._id !== onlyCcy) continue
        const net = round2n(r.credit - r.debit) // credit balance = positive net
        if (Math.abs(net) < 0.01) continue
        const amt = Math.abs(net)
        const je = {
          id: uuidv4(), tenant_id: T, date: bizDayStart(date), currency: r._id, ref_type: 'opening_close', ref_id: null, // v3.88.4 — F-017: Date-typed (was string)
          description: `إقفال الأرصدة الافتتاحية (${r._id}) إلى ${targetAcct.name_ar}`,
          lines: net > 0
            ? [{ account_code: COA.OPENING_EQUITY, account_name: OPENING_EQUITY_NAME, debit: amt, credit: 0 }, { account_code: target, account_name: targetAcct.name_ar, debit: 0, credit: amt }]
            : [{ account_code: target, account_name: targetAcct.name_ar, debit: amt, credit: 0 }, { account_code: COA.OPENING_EQUITY, account_name: OPENING_EQUITY_NAME, debit: 0, credit: amt }],
          created_by: sess.user.email, created_at: new Date(),
        }
        await db.collection('journal_entries').insertOne(je)
        closed.push({ currency: r._id, amount: amt, direction: net > 0 ? 'إلى دائن الوجهة' : 'إلى مدين الوجهة' })
      }
      if (closed.length === 0) return bad(onlyCcy ? `رصيد حساب التسوية ${COA.OPENING_EQUITY} بعملة ${onlyCcy} صفر — لا يوجد ما يُقفل` : 'رصيد حساب التسوية 3103 صفر في جميع العملات — لا يوجد ما يُقفل')
      return ok({ closed, target: { code: target, name: targetAcct.name_ar } })
    }
    // v3.87 — DELETE a manual/opening journal entry (reverses party balance effects, audited)
    const jeDelMatch = route.match(/^\/journal-entries\/([^/]+)$/)
    if (jeDelMatch && method === 'DELETE') {
      const je = await db.collection('journal_entries').findOne({ id: jeDelMatch[1], tenant_id: T })
      if (!je) return bad('القيد غير موجود', 404)
      if (!['manual', 'manual_dual', 'opening', 'opening_close'].includes(je.ref_type)) {
        return bad('لا يمكن حذف قيود المعاملات مباشرةً — احذف السجل المرتبط (تذكرة/سند/مصارفة)', 400)
      }
      // v4.5 — deleting a journal dated inside a closed year/period silently rewrites
      // closed books — centrally blocked (same rule as creation/edit).
      const perrDel = await assertOpenPeriod(db, T, je.date)
      if (perrDel) return bad(`القيد داخل فترة/سنة مقفلة ولا يُحذف — ${perrDel}`)
      for (const ln of je.lines || []) {
        if (!ln.party_type || !ln.party_id) continue
        const delta = round2n((ln.debit || 0) - (ln.credit || 0))
        // v4.5 — FIX: reversal must hit the LINE currency. For manual_dual the JE
        // currency is 'MULTI' — using it here corrupted balances into a 'MULTI' bucket
        // while the original effect lived under the real per-line currency.
        const lnCur = ln.currency || je.currency
        if (ln.party_type === 'box') await updateBalance(db, 'boxes', { id: ln.party_id, tenant_id: T }, lnCur, -delta)
        if (ln.party_type === 'client') await updateBalance(db, 'clients', { id: ln.party_id, tenant_id: T }, lnCur, -delta)
        if (ln.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: ln.party_id, tenant_id: T }, lnCur, delta)
      }
      await db.collection('journal_entries').deleteOne({ id: je.id, tenant_id: T })
      await db.collection('je_audit').insertOne({ id: uuidv4(), tenant_id: T, action: 'delete', je_id: je.id, ref_type: je.ref_type, description: je.description, currency: je.currency, lines: je.lines, by: sess.user.email, at: new Date() })
      // v3.87 — deleting an opening entry AFTER 3103 was already closed leaves the
      // settlement account unbalanced — warn loudly so the user re-settles.
      let warning = null
      if (je.ref_type === 'opening' || je.ref_type === 'opening_close') {
        const closesExist = await db.collection('journal_entries').countDocuments({ tenant_id: T, ref_type: 'opening_close' })
        if (closesExist > 0 || je.ref_type === 'opening_close') {
          const agg = await db.collection('journal_entries').aggregate([
            { $match: { tenant_id: T, currency: je.currency } }, { $unwind: '$lines' },
            { $match: { 'lines.account_code': COA.OPENING_EQUITY } },
            { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
          ]).toArray()
          const net = round2n((agg[0]?.credit || 0) - (agg[0]?.debit || 0))
          if (Math.abs(net) >= 0.01) {
            warning = `⚠️ تنبيه: بعد هذا الحذف أصبح حساب التسوية ${COA.OPENING_EQUITY} غير متوازن بعملة ${je.currency} (الصافي ${Math.abs(net).toLocaleString()} ${net > 0 ? 'دائن' : 'مدين'}) — يلزم إعادة التسوية/الإقفال من شاشة إقفال الأرصدة الافتتاحية`
          }
        }
      }
      return ok({ deleted: true, warning })
    }
    // ================= v3.87 — COA REBUILD (test data reset, owner only) =================
    // NOTE: intentionally NOT under /admin/* (that prefix is super_admin-gated) — this is
    // a per-tenant owner action.
    if (route === '/coa/rebuild' && method === 'POST') {
      if (sess.user.role !== 'owner') return bad('إعادة بناء الدليل متاحة لمالك المكتب فقط', 403)
      const b = await request.json()
      if (b.confirm !== 'REBUILD-COA') return bad('أرسل confirm: "REBUILD-COA" للتأكيد — هذه العملية تحذف كل البيانات المحاسبية التجريبية')
      // v3.88.2 — DEFAULT-DENY: the framework refuses a full wipe for any tenant that
      // has financial documents in EVERY environment that is not positively proven to
      // be a test one. Surface that refusal as a clear 403 instead of a generic 500.
      try {
        const result = await rebuildTenantCoa(db, T, sess.user.email)
        return ok({ rebuilt: true, ...result, coa_version: 2 })
      } catch (e) {
        if (/RESET (blocked|refused)/.test(String(e?.message))) {
          return bad('إعادة البناء الكاملة مرفوضة: هذا المكتب لديه حركات مالية فعلية — الحذف الشامل ممنوع افتراضياً في جميع البيئات. استخدم مسار الترقية بدون حذف (PRESERVE).', 403)
        }
        throw e
      }
    }

    // Dashboard
    if (route === '/dashboard' && method === 'GET') {
      return ok(await computeDashboard(db, T))
    }

    // Reports
    if (route === '/reports/profits' && method === 'GET') return ok(await reportProfits(db, T, q))
    if (route === '/reports/statement' && method === 'GET') return ok(await reportStatement(db, T, q))
    if (route === '/reports/trial-balance' && method === 'GET') return ok(await reportTrialBalance(db, T))
    if (route === '/reports/income-statement' && method === 'GET') return ok(await reportIncome(db, T, q))
    // v3.10.4 — Unified Query & Filters for Visas + Tickets
    if (route === '/reports/query' && method === 'GET') {
      const from = q.from || null
      const to = q.to || null
      const kind = String(q.kind || 'all').toLowerCase() // 'all' | 'visa' | 'ticket'
      const serviceType = q.service_type || null       // e.g. 'تأشيرة عمرة'
      const ticketType = q.ticket_type || null         // e.g. 'ذهاب فقط'
      const clientId = q.client_id || null
      const supplierId = q.supplier_id || null
      const paymentMethod = q.payment_method || null   // 'cash' | 'credit'
      const minQty = Number(q.min_qty) || 0            // count filter
      const searchText = (q.search || '').toString().trim().toLowerCase()
      const baseFilter = { tenant_id: T }
      if (from) baseFilter.date = { ...(baseFilter.date || {}), $gte: from }
      if (to) baseFilter.date = { ...(baseFilter.date || {}), $lte: to }
      if (clientId) baseFilter.client_id = clientId
      if (supplierId) baseFilter.supplier_id = supplierId
      if (paymentMethod) baseFilter.payment_method = paymentMethod
      let visas = [], tickets = []
      if (kind === 'all' || kind === 'visa') {
        const vf = { ...baseFilter }
        if (serviceType) vf.service_type = serviceType
        visas = await db.collection('visas').find(vf).sort({ date: -1 }).toArray()
        if (searchText) visas = visas.filter(v =>
          String(v.beneficiary_name || v.passenger_name || '').toLowerCase().includes(searchText) ||
          String(v.passport_no || '').toLowerCase().includes(searchText) ||
          String(v.phone || '').includes(searchText) ||
          String(v.client_name || '').toLowerCase().includes(searchText) ||
          String(v.supplier_name || '').toLowerCase().includes(searchText)
        )
      }
      if (kind === 'all' || kind === 'ticket') {
        const tf = { ...baseFilter }
        if (ticketType) tf.ticket_type = ticketType
        tickets = await db.collection('tickets').find(tf).sort({ date: -1 }).toArray()
        if (searchText) tickets = tickets.filter(t =>
          String(t.passenger_name || '').toLowerCase().includes(searchText) ||
          String(t.pnr || '').toLowerCase().includes(searchText) ||
          String(t.phone || '').includes(searchText) ||
          String(t.client_name || '').toLowerCase().includes(searchText) ||
          String(t.supplier_name || '').toLowerCase().includes(searchText)
        )
      }
      // Aggregate stats (in base currency of tenant if rates given, else keep per-currency)
      const settings = await db.collection('tenant_settings').findOne({ tenant_id: T }) || {}
      const baseCcy = settings.base_currency || 'USD'
      const rates = settings.rates || {}
      const toBaseAmt = (amt, cur) => {
        const r = (rates[cur] && rates[cur].to_base) ? Number(rates[cur].to_base) : 1
        return Number(amt || 0) * r
      }
      let totalSales = 0, totalCommission = 0
      visas.forEach(v => { totalSales += toBaseAmt(v.sale_price, v.currency || baseCcy); totalCommission += toBaseAmt(v.commission, v.currency || baseCcy) })
      tickets.forEach(t => { totalSales += toBaseAmt(t.sale_price, t.currency || baseCcy); totalCommission += toBaseAmt(t.commission, t.currency || baseCcy) })
      const stats = {
        visas_count: visas.length,
        tickets_count: tickets.length,
        total_sales: +totalSales.toFixed(2),
        total_commission: +totalCommission.toFixed(2),
        base_currency: baseCcy,
      }
      // minQty filter — return only if aggregates satisfy
      if (minQty > 0) {
        if (visas.length < minQty) visas = []
        if (tickets.length < minQty) tickets = []
      }
      return ok({ stats, visas: clean(visas), tickets: clean(tickets), filters_applied: { from, to, kind, service_type: serviceType, ticket_type: ticketType, client_id: clientId, supplier_id: supplierId, payment_method: paymentMethod, min_qty: minQty, search: searchText } })
    }

    // v3.9.14 — Year-End Financial Closing Engine
    if (route === '/accounting/closable-years' && method === 'GET') {
      // Aggregate journal_entries to find distinct years and check status
      const years = await db.collection('journal_entries').aggregate([
        { $match: { tenant_id: T } },
        { $group: { _id: { $year: '$date' }, count: { $sum: 1 }, min_date: { $min: '$date' }, max_date: { $max: '$date' } } },
        { $sort: { _id: -1 } },
      ]).toArray()
      const closedYears = sess.tenant?.closed_years || []
      return ok(years.map(y => ({ year: y._id, entries: y.count, min_date: y.min_date, max_date: y.max_date, is_closed: closedYears.includes(y._id) })))
    }

    if (route === '/accounting/close-year' && method === 'POST') {
      if (sess.user.role !== 'owner' && !isMainSA(sess.user)) return bad('غير مصرح — يجب أن تكون مالكاً', 403)
      const b = await request.json()
      const year = parseInt(b.year)
      if (!year || year < 2000 || year > 2100) return bad('السنة المالية غير صالحة')
      const closedYears = sess.tenant?.closed_years || []
      if (closedYears.includes(year)) return bad(`السنة ${year} مقفلة بالفعل`)
      // v3.88.4 — F-018 PREFLIGHT (no auto-creation of accounts):
      //  1) Retained Earnings must EXIST in the chart — COA v2 = 3102. The old code posted
      //     to a hardcoded '3900' that does not exist in the tree.
      //  2) It must be a postable LEAF equity account (not a group, active).
      //  3) The year must actually contain journal activity.
      //  4) Unposted-entries queue & Maker/Checker: N/A — the system posts entries
      //     immediately and has no approval workflow (documented, not skipped silently).
      const reAcct = await db.collection('accounts').findOne({ tenant_id: T, code: COA.RETAINED_EARNINGS })
      if (!reAcct) return bad(`Preflight: حساب الأرباح المبقاة (${COA.RETAINED_EARNINGS}) غير موجود في شجرة الحسابات — رحّل الدليل إلى COA v2 أولاً (لن يُنشأ الحساب تلقائياً)`)
      if (reAcct.is_group) return bad(`Preflight: حساب الأرباح المبقاة (${COA.RETAINED_EARNINGS}) حساب مجموعة — يجب أن يكون حساباً تفصيلياً قابلاً للقيد`)
      if (reAcct.type !== 'equity') return bad(`Preflight: الحساب (${COA.RETAINED_EARNINGS}) ليس ضمن حقوق الملكية`)
      if (isInactiveAccount(reAcct)) return bad(`Preflight: حساب الأرباح المبقاة (${COA.RETAINED_EARNINGS}) غير نشط`) // v4.6 — unified inactive view
      // v3.88.4 — aggregate revenues/expenses PER CURRENCY (the old code mixed all
      // currencies into one USD-labelled JE) — string/Date-safe business-TZ filter.
      const yStart = bizDayStart(`${year}-01-01`), yEnd = bizDayEnd(`${year}-12-31`)
      const jes = await db.collection('journal_entries').find({ tenant_id: T, ref_type: { $ne: 'year_close' }, ...dateRangeExpr('date', yStart, yEnd) }).toArray()
      if (jes.length === 0) return bad(`Preflight: لا توجد قيود في السنة ${year}`)
      const perCcy = {} // ccy → { code → { name, debit, credit } }
      for (const je of jes) {
        for (const ln of (je.lines || [])) {
          const code = ln.account_code || ''
          if (!code.startsWith('4') && !code.startsWith('5')) continue
          const ccy = ln.currency || je.currency || BASE_CURRENCY
          if (!perCcy[ccy]) perCcy[ccy] = {}
          if (!perCcy[ccy][code]) perCcy[ccy][code] = { name: ln.account_name, debit: 0, credit: 0 }
          perCcy[ccy][code].debit += Number(ln.debit || 0)
          perCcy[ccy][code].credit += Number(ln.credit || 0)
        }
      }
      const results = []
      for (const [ccy, accountTotals] of Object.entries(perCcy)) {
        const closingLines = []
        let net = 0
        for (const [code, t] of Object.entries(accountTotals)) {
          if (code.startsWith('4')) {
            const bal = +(t.credit - t.debit).toFixed(2)
            if (bal === 0) continue
            closingLines.push(bal > 0 ? { account_code: code, account_name: t.name, debit: bal, credit: 0 } : { account_code: code, account_name: t.name, debit: 0, credit: Math.abs(bal) })
            net += bal
          } else {
            const ebal = +(t.debit - t.credit).toFixed(2)
            if (ebal === 0) continue
            closingLines.push(ebal > 0 ? { account_code: code, account_name: t.name, debit: 0, credit: ebal } : { account_code: code, account_name: t.name, debit: Math.abs(ebal), credit: 0 })
            net -= ebal
          }
        }
        net = +net.toFixed(2)
        if (closingLines.length === 0) continue
        if (net > 0) closingLines.push({ account_code: COA.RETAINED_EARNINGS, account_name: reAcct.name_ar, debit: 0, credit: net })
        else if (net < 0) closingLines.push({ account_code: COA.RETAINED_EARNINGS, account_name: reAcct.name_ar, debit: Math.abs(net), credit: 0 })
        const closingJe = await createJournalEntry(db, T, {
          date: new Date(`${year}-12-31T23:59:59+03:00`),
          description: `🔒 قيد إقفال السنة المالية ${year} (${ccy}) — تصفير الإيرادات والمصروفات وترحيل الصافي إلى الأرباح المبقاة (${COA.RETAINED_EARNINGS})`,
          ref_type: 'year_close', ref_id: `close-${year}`, currency: ccy,
          lines: closingLines.map(l => ({ ...l, currency: ccy, party_type: null, party_id: null, party_name: l.account_name })),
          // v4.6 — RAH-ACC: idempotency per year+currency — a partial multi-currency failure
          // followed by a retry can no longer DUPLICATE closing journals (double transfer to
          // retained earnings). Reopen-year deletes these JEs, so a re-close starts fresh.
        }, { skipQuota: true, idempotencyKey: `year_close:${year}:${ccy}` })
        results.push({ currency: ccy, net_profit: net, closing_je_id: closingJe.id, lines_count: closingLines.length })
      }
      if (results.length === 0) return bad(`لا توجد قيود إيرادات أو مصروفات في السنة ${year}`)
      // Mark tenant year as closed
      await db.collection('tenants').updateOne({ id: T }, {
        $addToSet: { closed_years: year },
        $set: { [`year_closes.${year}`]: { closed_at: new Date(), closed_by: sess.user.id, per_currency: results } },
      })
      const netTotal = +results.reduce((s, r) => s + r.net_profit, 0).toFixed(2)
      return ok({ ok: true, year, per_currency: results, net_profit: netTotal, retained_earnings_account: COA.RETAINED_EARNINGS, closing_je_id: results[0].closing_je_id, lines_count: results.reduce((s, r) => s + r.lines_count, 0) })
    }

    if (route === '/accounting/reopen-year' && method === 'POST') {
      if (!isMainSA(sess.user) && sess.user.role !== 'owner') return bad('غير مصرح', 403)
      const b = await request.json()
      const year = parseInt(b.year)
      if (!year) return bad('السنة مطلوبة')
      // Only super_admin can reopen; owners can only close (safety)
      if (!isMainSA(sess.user)) return bad('فتح السنة المقفلة يتطلب صلاحية السوبر أدمن', 403)
      // Delete closing JE
      await db.collection('journal_entries').deleteMany({ tenant_id: T, ref_type: 'year_close', ref_id: `close-${year}` })
      await db.collection('tenants').updateOne({ id: T }, { $pull: { closed_years: year }, $unset: { [`year_closes.${year}`]: '' } })
      return ok({ ok: true, year, reopened: true })
    }

    if (route === '/accounting/closed-years' && method === 'GET') {
      const closedYears = sess.tenant?.closed_years || []
      const details = sess.tenant?.year_closes || {}
      return ok({ closed_years: closedYears, details })
    }

    return bad(`Route ${route} not found`, 404)
  } catch (e) {
    if (e.code === 'QUOTA_EXCEEDED') {
      return NextResponse.json({ error: e.message, quota_exceeded: true, code: 'QUOTA_EXCEEDED' }, { status: 402, headers: { 'Access-Control-Allow-Origin': process.env.CORS_ORIGINS || '*' } })
    }
    console.error('API Error:', e)
    return bad('Internal server error: ' + e.message, 500)
  }
}

// ============ v3.20 — DUAL PRICING (Phase B) ============
// Age category from a registrant's age: infant <2, child 2-11, adult 12+ (null age = adult)
function ageCategoryOf(age) {
  if (age === null || age === undefined || age === '') return 'adult'
  const a = Number(age)
  if (a < 2) return 'infant'
  if (a < 12) return 'child'
  return 'adult'
}
// v3.23 — Package features/amenities list (Miraj Network readiness)
function sanitizeFeatures(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(x => String(x || '').trim().slice(0, 60))
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, 30)
}
// v3.89 — Task 3: cost must NEVER exceed the sale price in packages/programs.
// Rule (uniform): every tier that has a sale price > 0 must satisfy cost <= sale.
// Tiers with sale = 0 are skipped (free-infant policies / direct-mode components where the
// sale comes from the room matrix) — this blocks the reported bug without breaking those flows.
function roomPricingCostError(roomPricing) {
  for (const r of (Array.isArray(roomPricing) ? roomPricing : [])) {
    const saleA = Number(r.sale_per_pax) || 0
    const saleC = (r.sale_child === null || r.sale_child === undefined) ? saleA : (Number(r.sale_child) || 0)
    const saleI = Number(r.sale_infant) || 0
    if (saleA > 0 && (Number(r.cost_adult) || 0) > saleA) return `غرفة «${r.type}»: تكلفة البالغ (${r.cost_adult}) أعلى من سعر البيع (${saleA})`
    if (saleC > 0 && (Number(r.cost_child) || 0) > saleC) return `غرفة «${r.type}»: تكلفة الطفل (${r.cost_child}) أعلى من سعر البيع (${saleC})`
    if (saleI > 0 && (Number(r.cost_infant) || 0) > saleI) return `غرفة «${r.type}»: تكلفة الرضيع (${r.cost_infant}) أعلى من سعر البيع (${saleI})`
  }
  return null
}
// Sanitize room_pricing array: [{type, sale_per_pax(adult), sale_child|null, sale_infant|null}]
function sanitizeRoomPricing(arr) {  return (Array.isArray(arr) ? arr : [])
    .filter(r => r && String(r.type || '').trim())
    .slice(0, 12)
    .map(r => ({
      type: String(r.type).trim().slice(0, 40),
      sale_per_pax: Math.max(0, Number(r.sale_per_pax) || 0),
      sale_child: (r.sale_child === undefined || r.sale_child === null || r.sale_child === '') ? null : Math.max(0, Number(r.sale_child) || 0),
      sale_infant: (r.sale_infant === undefined || r.sale_infant === null || r.sale_infant === '') ? null : Math.max(0, Number(r.sale_infant) || 0),
      // v3.53 — per-age COST fields (فارغ = 0) for accurate per-category profit
      cost_adult: (r.cost_adult === undefined || r.cost_adult === null || r.cost_adult === '') ? null : Math.max(0, Number(r.cost_adult) || 0),
      cost_child: (r.cost_child === undefined || r.cost_child === null || r.cost_child === '') ? null : Math.max(0, Number(r.cost_child) || 0),
      cost_infant: (r.cost_infant === undefined || r.cost_infant === null || r.cost_infant === '') ? null : Math.max(0, Number(r.cost_infant) || 0),
    }))
}
// v3.49 — Hotels quick-details on the package itself (name + city + nights) for program display
function sanitizeHotels(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(h => h && String(h.name || '').trim())
    .slice(0, 10)
    .map(h => ({
      name: String(h.name).trim().slice(0, 80),
      city: String(h.city || '').trim().slice(0, 40),
      nights: Math.max(0, Math.min(60, Math.round(Number(h.nights) || 0))),
    }))
}
// Sanitize per-room-type rates for 'room_age' components
function sanitizeRoomRates(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(r => r && String(r.room_type || '').trim())
    .slice(0, 12)
    .map(r => ({
      room_type: String(r.room_type).trim().slice(0, 40),
      cost_adult: Math.max(0, Number(r.cost_adult) || 0),
      cost_child: Math.max(0, Number(r.cost_child) || 0),
      cost_infant: Math.max(0, Number(r.cost_infant) || 0),
      sale_adult: Math.max(0, Number(r.sale_adult) || 0),
      sale_child: Math.max(0, Number(r.sale_child) || 0),
      sale_infant: Math.max(0, Number(r.sale_infant) || 0),
    }))
}
// Compute one component's cost/sale totals for a booking.
// pricing_type: 'flat' (visa: same price per person) | 'per_age' (transport) | 'room_age' (hotel)
// Legacy components (no pricing_type) behave exactly as before: flat × billed pax (infants excluded).
function computeComponentTotals(comp, registrants, paxBilled, totalPax) {
  const pt = comp.pricing_type || 'flat'
  const regs = Array.isArray(registrants) ? registrants : []
  if (regs.length > 0 && pt === 'per_age') {
    let cost = 0, sale = 0
    for (const r of regs) {
      const cat = ageCategoryOf(r.age)
      cost += Number(comp[`cost_${cat}`]) || 0
      sale += Number(comp[`sale_${cat}`]) || 0
    }
    return { cost_total: +cost.toFixed(2), sale_total: +sale.toFixed(2) }
  }
  if (regs.length > 0 && pt === 'room_age') {
    const map = {}
    for (const rr of (comp.room_rates || [])) map[rr.room_type] = rr
    let cost = 0, sale = 0
    for (const r of regs) {
      const rr = map[r.room_type]
      if (!rr) continue
      const cat = ageCategoryOf(r.age)
      cost += Number(rr[`cost_${cat}`]) || 0
      sale += Number(rr[`sale_${cat}`]) || 0
    }
    return { cost_total: +cost.toFixed(2), sale_total: +sale.toFixed(2) }
  }
  // flat: visa-style — same price per person; include_infants charges infants too
  const n = (regs.length > 0 && comp.include_infants) ? totalPax : paxBilled
  return {
    cost_total: +((Number(comp.cost_per_pax) || 0) * n).toFixed(2),
    sale_total: +((Number(comp.sale_per_pax) || 0) * n).toFixed(2),
  }
}
// Direct room+age sale (B2B ready-made): adult price = sale_per_pax, child falls back to adult, infant defaults 0
function computeDirectRoomSale(roomPricing, registrants) {
  const map = {}
  for (const rp of (roomPricing || [])) map[rp.type] = rp
  let sale = 0
  for (const r of (registrants || [])) {
    const rp = map[r.room_type]
    if (!rp) continue
    const cat = ageCategoryOf(r.age)
    if (cat === 'infant') sale += Number(rp.sale_infant) || 0
    else if (cat === 'child') sale += (rp.sale_child === null || rp.sale_child === undefined) ? (Number(rp.sale_per_pax) || 0) : (Number(rp.sale_child) || 0)
    else sale += Number(rp.sale_per_pax) || 0
  }
  return +sale.toFixed(2)
}

// v3.21/v3.22 — Shared partner-commission statement computation (used by live view + archive snapshot)
async function computePartnerStatement(db, T, partnerId, from, to) {
  const dateFilter = {}
  if (from) dateFilter.$gte = new Date(from)
  if (to) dateFilter.$lte = new Date(to + 'T23:59:59')
  const hasDate = Object.keys(dateFilter).length > 0
  const baseQ = { tenant_id: T, commission_partner_id: partnerId, commission_share_amount: { $gt: 0 } }
  const tq = hasDate ? { ...baseQ, date: dateFilter } : baseQ
  const bq = hasDate ? { ...baseQ, created_at: dateFilter } : baseQ
  const [tickets, visas, services, bookings] = await Promise.all([
    db.collection('tickets').find(tq).toArray(),
    db.collection('visas').find(tq).toArray(),
    db.collection('services').find(tq).toArray(),
    db.collection('package_bookings').find(bq).toArray(),
  ])
  const pkgIds = [...new Set(bookings.map(x => x.package_id).filter(Boolean))]
  const pkgs = pkgIds.length ? await db.collection('packages').find({ tenant_id: T, id: { $in: pkgIds } }).toArray() : []
  const pkgMap = {}
  for (const p of pkgs) pkgMap[p.id] = p.name
  const rows = []
  const push = (list, module, moduleLabel, descFn, dateFn) => {
    for (const d of list) rows.push({
      id: d.id, module, module_label: moduleLabel,
      date: dateFn(d) || d.created_at || null,
      description: descFn(d),
      currency: d.currency || 'USD',
      total_commission: +(Number(d.commission) || 0).toFixed(2),
      partner_share: +(Number(d.commission_share_amount) || 0).toFixed(2),
      share_mode: d.commission_share_mode || 'amount',
      share_value: Number(d.commission_share_value) || 0,
    })
  }
  push(tickets, 'ticket', '✈️ تذكرة', d => `${d.passenger_name || d.client_name || ''}${d.trip_route ? ` — ${d.trip_route}` : ''}`.trim() || 'تذكرة طيران', d => d.date)
  push(visas, 'visa', '🛂 تأشيرة', d => `${d.service_type || 'تأشيرة'} — ${d.passenger_name || ''}`.trim(), d => d.date)
  push(services, 'service', '🧾 خدمة', d => `${d.service_type || 'خدمة'} — ${d.beneficiary_name || ''}`.trim(), d => d.date)
  push(bookings, 'package', '📦 باكج', d => `${pkgMap[d.package_id] || 'باكج'} — ${d.pilgrim_name || ''} (${d.pax_count || 1} فرد)`.trim(), d => d.created_at)
  rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  const totals = {}
  for (const r of rows) {
    totals[r.currency] = totals[r.currency] || { partner_share: 0, total_commission: 0, count: 0 }
    totals[r.currency].partner_share += r.partner_share
    totals[r.currency].total_commission += r.total_commission
    totals[r.currency].count++
  }
  for (const c of Object.keys(totals)) {
    totals[c].partner_share = +totals[c].partner_share.toFixed(2)
    totals[c].total_commission = +totals[c].total_commission.toFixed(2)
    totals[c].office_share = +(totals[c].total_commission - totals[c].partner_share).toFixed(2)
  }
  return { rows, totals, count: rows.length }
}

// ============ v3.24 — MERAAJ NETWORK INTEGRATION (معراج نتورك) ============
function meraajSecret() { return process.env.MERAAJ_SHARED_SECRET || '' }
function meraajSign(payload) { return crypto.createHmac('sha256', meraajSecret()).update(payload).digest('hex') }
// Verify an HMAC signature in constant time
function meraajVerify(payload, signature) {
  if (!meraajSecret() || !signature) return false
  try {
    const expected = meraajSign(payload)
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))
  } catch { return false }
}
// Verify a timestamped server-to-server GET request: sig = HMAC(`${ts}.${path}`), |now-ts| <= 300s
function meraajVerifyRequest(request, route) {
  const ts = request.headers.get('x-meraaj-timestamp')
  const sig = request.headers.get('x-meraaj-signature')
  if (!ts || !sig) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(ts)) > 300) return false
  return meraajVerify(`${ts}.${route}`, sig)
}
// v3.25 — Compute marketplace pricing table from package room pricing + agent commission config
function computeMeraajMarketPricing(roomPricingArr, mode, value, direction, childValue = null, infantValue = null) {
  const rows = (Array.isArray(roomPricingArr) ? roomPricingArr : []).filter(r => (Number(r.sale_per_pax) || 0) > 0)
  // v3.53 — per-age commission: child/infant can have their own commission value (فارغ = نفس عمولة البالغ)
  const valFor = (cat) => {
    if (cat === 'child' && childValue !== null && childValue !== undefined && childValue !== '') return Number(childValue) || 0
    if (cat === 'infant' && infantValue !== null && infantValue !== undefined && infantValue !== '') return Number(infantValue) || 0
    return Number(value) || 0
  }
  const commFor = (base, cat) => {
    if (!(base > 0)) return 0
    const v = valFor(cat)
    return mode === 'percent' ? +(base * v / 100).toFixed(2) : +(+v).toFixed(2)
  }
  return rows.map(rp => {
    const baseAdult = +(Number(rp.sale_per_pax) || 0).toFixed(2)
    const baseChild = (rp.sale_child === null || rp.sale_child === undefined) ? baseAdult : +(Number(rp.sale_child) || 0).toFixed(2)
    const baseInfant = +(Number(rp.sale_infant) || 0).toFixed(2)
    const row = { room_type: rp.type, base: { adult: baseAdult, child: baseChild, infant: baseInfant }, commission: {}, customer: {}, net: {} }
    for (const cat of ['adult', 'child', 'infant']) {
      const base = row.base[cat]
      const comm = commFor(base, cat)
      row.commission[cat] = comm
      if (direction === 'added') { row.customer[cat] = +(base + comm).toFixed(2); row.net[cat] = base }
      else { row.customer[cat] = base; row.net[cat] = +(base - comm).toFixed(2) }
    }
    return row
  })
}

// v3.53 — Shared Meraaj booking approval engine: converts an inbound marketplace booking into a
// real package booking + balanced journal entry. Used by BOTH the manual approve endpoint and
// the optional per-office AUTO-APPROVE setting (tenant_settings.meraaj_auto_approve).
// v3.89.2 — minimal cross-process mutex backed by MongoDB's BUILT-IN _id uniqueness guarantee
// (no new index, no migration). insertOne on a taken _id throws E11000 → lock is held elsewhere.
// Stale locks (crashed holder) self-heal after staleMs.
// v3.89.3 — OWNER TOKEN: acquire returns a unique token (not a boolean); release deletes ONLY
// {_id + owner_token}. A slow process that lost its lock to stale-cleanup can NEVER delete the
// newer lock acquired by another process. Stale cleanup likewise deletes ONLY the exact doc it
// read (owner_token + created_at) — never a fresher lock that replaced it in between.
async function acquireOpLock(db, lockId, staleMs = 120000) {
  const ownerToken = uuidv4()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.collection('op_locks').insertOne({ _id: lockId, owner_token: ownerToken, created_at: new Date() })
      return ownerToken // lock handle — required for release
    } catch (e) {
      if (e?.code !== 11000) throw e
      const existing = await db.collection('op_locks').findOne({ _id: lockId })
      if (existing && (Date.now() - new Date(existing.created_at).getTime()) > staleMs) {
        // delete ONLY the exact stale version we read — a newer lock (different token) survives
        const staleFilter = { _id: lockId, created_at: existing.created_at }
        if (existing.owner_token) staleFilter.owner_token = existing.owner_token
        try { await db.collection('op_locks').deleteOne(staleFilter) } catch { }
        continue // retry the insert once after clearing the stale lock
      }
      return null
    }
  }
  return null
}
async function releaseOpLock(db, lockId, ownerToken) {
  if (!ownerToken) return // never blind-delete by _id alone
  try { await db.collection('op_locks').deleteOne({ _id: lockId, owner_token: ownerToken }) } catch { }
}

async function approveMeraajInboundBooking(db, T, inbound, actor = null) {
  const actorName = actor === null ? 'auto_approve' : (actor.name || actor.email || actor.id || 'owner') // v3.73 — audit
  const pkg = await db.collection('packages').findOne({ id: inbound.package_id, tenant_id: T })
  if (!pkg) throw new Error('الباكج غير موجود')
  // v3.89 — Task 6: UNIFIED "Meraaj Network" receivable — ALL inbound Meraaj postings hit ONE
  // tenant-scoped, postable (leaf) account under Accounts Receivable (COA.CLIENTS group).
  // Lazy creation (no migration): the account is created on FIRST approval for the tenant.
  // Legacy per-office clients created before v3.89 are untouched (no historical data changes).
  const clientName = `معراج — ${inbound.buyer_office_name}`.slice(0, 120) // kept for display/audit only
  const MERAAJ_NET_NAME = 'شبكة معراج'
  // v3.89.2 — deterministic canonical read (oldest-first): every caller converges on ONE account
  // even if a historical duplicate ever existed (no data is touched — read-side convergence only).
  const findMeraajNetCli = () => db.collection('clients').find({ tenant_id: T, is_meraaj_network: true }).sort({ created_at: 1 }).limit(1).next()
  let cli = await findMeraajNetCli()
  if (!cli) {
    // Name fallback (in case the office created it manually) — tag it so future lookups are stable
    cli = await db.collection('clients').findOne({ tenant_id: T, name: MERAAJ_NET_NAME })
    if (cli) await db.collection('clients').updateOne({ id: cli.id, tenant_id: T }, { $set: { is_meraaj_network: true } })
  }
  if (!cli) {
    // v3.89.2 — one-account-per-tenant under concurrency WITHOUT a new unique index:
    // creation is serialized via an _id-mutex (built-in uniqueness); losers wait briefly
    // and re-read. DB-level guarantee (partial unique index) proposed in the report — deferred.
    const cliLockId = `meraaj_net_client:${T}`
    const cliLockToken = await acquireOpLock(db, cliLockId, 60000) // v3.89.3 — owner-token handle
    if (cliLockToken) {
      try {
        cli = await findMeraajNetCli() // double-check under the lock
        if (!cli) {
          let accountInfo = {}
          try { accountInfo = await generateSubAccountCode(db, T, COA.CLIENTS) } catch (e) { throw new Error(e.message) }
          const newCli = {
            id: uuidv4(), tenant_id: T, name: MERAAJ_NET_NAME, phone: '', whatsapp: '',
            address: '', email: '', notes: 'حساب موحد — كل مبيعات معراج نتورك الواردة تُرحَّل على هذا الحساب (ذمم مدينة)',
            parent_code: COA.CLIENTS, ...accountInfo, is_meraaj_network: true,
            credit_limit: 0, credit_currency: inbound.currency, is_frozen: false,
            balances: emptyBalances(), created_at: new Date(),
          }
          await db.collection('clients').insertOne(newCli)
          cli = newCli
        }
      } finally { await releaseOpLock(db, cliLockId, cliLockToken) }
    } else {
      // another approval is creating the account right now — bounded wait, then re-read
      for (let w = 0; w < 10 && !cli; w++) {
        await new Promise(r => setTimeout(r, 300))
        cli = await findMeraajNetCli()
      }
      if (!cli) throw new Error('حساب "شبكة معراج" قيد الإنشاء من عملية متزامنة — أعد المحاولة خلال لحظات')
    }
  }
  const cur = inbound.currency
  const registrants = inbound.registrants || []
  const adults = Number(inbound.pax_adults) || 0
  const children = Number(inbound.pax_children) || 0
  const infants = Number(inbound.pax_infants) || 0
  const paxBilled = adults + children
  const totalPax = registrants.length || (paxBilled + infants)
  // 2) Cost side from package components (dual pricing engine — same as internal bookings)
  const comps = await db.collection('package_components').find({ package_id: pkg.id, tenant_id: T }).toArray()
  const compTotals = comps.map(c => computeComponentTotals(c, registrants, paxBilled, totalPax))
  const total_cost = +compTotals.reduce((s, t) => s + t.cost_total, 0).toFixed(2)
  // 3) Sale side = what the buyer office owes us (net of the agent commission — valid for both directions)
  const total_sale = +(Number(inbound.net_to_seller_total) || 0).toFixed(2)
  const commission = +(total_sale - total_cost).toFixed(2)
  let rooms_summary = null
  if (registrants.length > 0) {
    rooms_summary = {}
    for (const r of registrants) if (r.room_type) rooms_summary[r.room_type] = (rooms_summary[r.room_type] || 0) + 1
    if (Object.keys(rooms_summary).length === 0) rooms_summary = null
  }
  const bookingDoc = {
    id: uuidv4(), tenant_id: T, package_id: pkg.id,
    client_id: cli.id, pilgrim_name: clientName,
    pax_count: totalPax, pax_adults: adults, pax_children: children, pax_infants: infants,
    pax_billed: paxBilled, pax_seats: paxBilled,
    registrants, rooms_summary,
    currency: cur, total_cost, total_sale, commission,
    discount: 0, discount_reason: '', discount_apply_cost: false,
    commission_partner_type: null, commission_partner_id: null, commission_partner_name: '',
    commission_share_mode: 'amount', commission_share_value: 0, commission_share_amount: 0,
    payment_method: 'credit', box_id: null,
    source: 'meraaj', meraaj_inbound_id: inbound.id, meraaj_booking_ref: inbound.meraaj_booking_ref,
    meraaj_customer_total: Number(inbound.total_price) || 0,
    meraaj_agent_commission: Number(inbound.agent_commission_total) || 0,
    component_snapshots: comps.map((c, i) => ({
      id: c.id, name: c.name, supplier_id: c.supplier_id, supplier_name: c.supplier_name,
      cost_per_pax: c.cost_per_pax, sale_per_pax: c.sale_per_pax,
      pricing_type: c.pricing_type || 'flat', include_infants: !!c.include_infants,
      ...(c.pricing_type === 'per_age' ? { cost_adult: c.cost_adult, cost_child: c.cost_child, cost_infant: c.cost_infant, sale_adult: c.sale_adult, sale_child: c.sale_child, sale_infant: c.sale_infant } : {}),
      ...(c.pricing_type === 'room_age' ? { room_rates: c.room_rates || [] } : {}),
      cost_total: compTotals[i].cost_total,
      sale_total: compTotals[i].sale_total,
    })),
    meraaj_booking_ref: inbound.meraaj_booking_ref || null, // v3.73 — uniqueness guard vs double-approve
    meraaj_inbound_id: inbound.id, // v3.73
    created_at: new Date(),
  }
  // v3.89.2 — duplicate belts MOVED inside the order-identity mutex below (race-free check-then-act)
  // 4) v3.89.1 — BLOCKER 1 FIX: journal lines must reference REAL leaf (postable) accounts.
  // COA.CLIENTS (1103) / COA.SUPPLIERS (2101) are GROUP accounts — F-008 rejects direct postings.
  // Resolve every leaf account_code BEFORE any financial write (clean abort on failure).
  if (!cli.account_code) throw new Error('حساب "شبكة معراج" بلا كود حساب تحليلي نهائي — تعذر الترحيل')
  const lines = [{ account_code: cli.account_code, account_name: cli.name, party_type: 'client', party_id: cli.id, party_name: cli.name, debit: total_sale, credit: 0 }]
  const supGrouped = {}
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i]
    if (!compTotals[i].cost_total) continue
    supGrouped[c.supplier_id] = supGrouped[c.supplier_id] || { name: c.supplier_name, amount: 0 }
    supGrouped[c.supplier_id].amount += compTotals[i].cost_total
  }
  const supIds = Object.keys(supGrouped)
  const supDocs = supIds.length ? await db.collection('suppliers').find({ tenant_id: T, id: { $in: supIds } }, { projection: { id: 1, account_code: 1, name: 1 } }).toArray() : []
  const supLeafById = Object.fromEntries(supDocs.map(s => [s.id, s.account_code]))
  let supSum = 0
  for (const [sid, x] of Object.entries(supGrouped)) {
    const leaf = supLeafById[sid]
    if (!leaf) throw new Error(`المورد «${x.name}» بلا كود حساب تحليلي نهائي — تعذر الترحيل`)
    const amt = +x.amount.toFixed(2); supSum += amt
    lines.push({ account_code: leaf, account_name: x.name, party_type: 'supplier', party_id: sid, party_name: x.name, debit: 0, credit: amt })
  }
  const revenueNet = +(total_sale - supSum).toFixed(2)
  if (revenueNet !== 0) lines.push({ account_code: COA.REV_SERVICES, account_name: 'إيرادات خدمات إضافية', party_type: 'revenue', party_id: null, party_name: `إيراد باكج ${pkg.name} — معراج`, debit: 0, credit: revenueNet })
  // 5) v3.89.2 — BLOCKER 3 FIX (hardened): concurrency-safe idempotency on the ORDER IDENTITY
  // (meraaj_booking_ref) — not just this inbound doc. The mutex is backed by MongoDB's built-in
  // _id uniqueness (no new index/migration) and serializes concurrent approvals even when TWO
  // different inbound docs exist for the same Meraaj order. NOT check-then-insert: the duplicate
  // checks run INSIDE the mutex, so check-then-act is race-free.
  const postLockId = `meraaj_post:${T}:${inbound.meraaj_booking_ref || `inbound_${inbound.id}`}`
  const postLockToken = await acquireOpLock(db, postLockId, 120000) // v3.89.3 — owner-token handle
  if (!postLockToken) {
    throw new Error('اعتماد متزامن لنفس طلب معراج قيد التنفيذ الآن — مُنع الترحيل المكرر (idempotent)')
  }
  // v3.89.2 — granular compensation ledger: EVERY successful balance write is tracked
  // individually and reversed EXACTLY as applied (no single all-or-nothing boolean).
  const appliedBalances = []
  let je = null, quotaBumped = false, inboundClaimed = false
  try {
    // Duplicate belts — race-free under the order mutex
    if (inbound.meraaj_booking_ref) {
      const dupBk = await db.collection('package_bookings').findOne({ tenant_id: T, meraaj_booking_ref: inbound.meraaj_booking_ref, status: { $ne: 'cancelled' } })
      if (dupBk) throw new Error('يوجد حجز محاسبي مسبق لنفس مرجع معراج — لن يُنشأ حجز مكرر')
      const dupJe = await db.collection('journal_entries').findOne({ tenant_id: T, meraaj_booking_ref: inbound.meraaj_booking_ref })
      if (dupJe) throw new Error('يوجد قيد مالي مسبق لنفس مرجع معراج — مُنع الترحيل المكرر (idempotent)')
    }
    // Per-inbound-doc atomic claim (state marker + extra belt for ref-less orders)
    const claim = await db.collection('meraaj_inbound_bookings').findOneAndUpdate(
      { id: inbound.id, tenant_id: T, financial_posted: { $ne: true } },
      { $set: { financial_posted: true, financial_posted_at: new Date() } },
      { returnDocument: 'before' }
    )
    const claimedDoc = claim && (claim.value !== undefined ? claim.value : claim)
    if (!claimedDoc) throw new Error('الأثر المالي لهذا الطلب منفذ مسبقاً — مُنع الترحيل المكرر (idempotent)')
    inboundClaimed = true
    // Balance writes — each one is recorded in the ledger the moment it succeeds
    await updateBalance(db, 'clients', { id: cli.id, tenant_id: T }, cur, total_sale)
    appliedBalances.push({ coll: 'clients', id: cli.id, amount: total_sale })
    for (let i = 0; i < comps.length; i++) {
      if (compTotals[i].cost_total > 0) {
        await updateBalance(db, 'suppliers', { id: comps[i].supplier_id, tenant_id: T }, cur, compTotals[i].cost_total)
        appliedBalances.push({ coll: 'suppliers', id: comps[i].supplier_id, amount: compTotals[i].cost_total })
      }
    }
    je = await createJournalEntry(db, T, {
      date: new Date(),
      description: `اعتماد حجز معراج ${inbound.meraaj_booking_ref || ''} — ${inbound.buyer_office_name} في ${pkg.name} (${totalPax} فرد، صافي ${total_sale} ${cur})`,
      ref_type: 'package_booking', ref_id: bookingDoc.id, currency: cur, lines,
    }, { extra: { meraaj_booking_ref: inbound.meraaj_booking_ref || null } }) // v3.89 — idempotency marker
    quotaBumped = true // createJournalEntry increments journal_quota.used on success
    await db.collection('package_bookings').insertOne(bookingDoc)
  } catch (opErr) {
    // v3.89.2 — UNIFIED best-effort rollback in REVERSE order (journal+quota → balances → claim):
    // 1) Journal: delete by ref_id (bookingDoc.id is unique per attempt) — also covers the edge
    //    where the JE doc was inserted but createJournalEntry threw before returning.
    try { await db.collection('journal_entries').deleteMany({ tenant_id: T, ref_type: 'package_booking', ref_id: bookingDoc.id }) } catch { }
    // 2) Quota: compensate createJournalEntry's $inc journal_quota.used (guarded, never below 0).
    if (quotaBumped) { try { await db.collection('tenants').updateOne({ id: T, 'journal_quota.used': { $gt: 0 } }, { $inc: { 'journal_quota.used': -1 } }) } catch { } }
    // 3) Balances: reverse EXACTLY the writes that succeeded — newest first.
    for (const ab of [...appliedBalances].reverse()) {
      try { await updateBalance(db, ab.coll, { id: ab.id, tenant_id: T }, cur, -ab.amount) } catch { }
    }
    // 4) Claim: release only if WE claimed it in this run.
    if (inboundClaimed) { try { await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id, tenant_id: T }, { $set: { financial_posted: false }, $unset: { financial_posted_at: '' } }) } catch { } }
    await releaseOpLock(db, postLockId, postLockToken)
    throw new Error(opErr.message || 'تعذر تنفيذ الأثر المالي لاعتماد حجز معراج')
  }
  // success — release the in-flight mutex. Permanent idempotency = financial_posted flag +
  // booking/journal records (checked above). A crash before this line self-heals via the 120s stale TTL.
  await releaseOpLock(db, postLockId, postLockToken)
  await db.collection('meraaj_inbound_bookings').updateOne({ id: inbound.id, tenant_id: T }, {
    $set: { status: 'approved', approved_at: new Date(), approved_by: actor?.id || 'auto', booking_id: bookingDoc.id, client_id: cli.id, client_name: cli.name },
    $push: { history: { $each: [ // v3.73 — audit trail
      { at: new Date(), action: 'approved', actor: actorName, note: `صافي ${total_sale} ${cur}` },
      { at: new Date(), action: 'package_booking_created', actor: 'system', note: bookingDoc.id },
    ] } },
  })
  // v3.27 — Notify Meraaj: booking accepted (closes the communication loop with the buyer office)
  await emitMeraajEvent(db, T, 'booking.approved', {
    booking_ref: inbound.meraaj_booking_ref,
    package_ref: pkg.id,
    rahal_ref: pkg.id, // v3.76 — contract lock identity trio
    meraaj_package_id: pkg.meraaj?.remote_id || null, // v3.76
    inbound_id: inbound.id,
    buyer_office_name: inbound.buyer_office_name,
    seats: inbound.seats,
    pax: { adults: adults, children, infants },
    total_price: inbound.total_price, // v3.73 — contract completeness
    net_to_seller_total: total_sale,
    currency: cur,
    approved_at: new Date(),
    approved_by: actorName, // v3.73
  })
  await maybeEmitMeraajInventory(db, T, pkg.id)
  const { _id, ...rest } = bookingDoc
  return { booking: rest, client: { id: cli.id, name: cli.name } }
}

// Availability of a shared package in the marketplace (allocated - sold)
function meraajAvailability(pkg) {
  const m = pkg?.meraaj || {}
  const allocated = Number(m.seats_allocated) || 0
  const sold = Number(m.seats_sold) || 0
  return Math.max(0, allocated - sold)
}

// v3.76 — CONTRACT LOCK: unified package identity trio (package_ref = rahal_ref = packages.id,
// meraaj_package_id = Meraaj-side id returned at registration) attached to EVERY outbound booking event.
async function meraajPkgIdentityFields(db, packageId) {
  try {
    const p = await db.collection('packages').findOne({ id: packageId }, { projection: { 'meraaj.remote_id': 1 } })
    return { rahal_ref: packageId, meraaj_package_id: p?.meraaj?.remote_id || null }
  } catch { return { rahal_ref: packageId, meraaj_package_id: null } }
}
// Outbox pattern: persist the event, then best-effort deliver (signed) if Meraaj endpoint is configured.
// v3.32 — returns delivery status: 'sent' | 'failed' | 'pending' (pending = no endpoint configured yet)
// v3.67 — AUTO RETRY SCHEDULE (opportunistic, no cron/infra): called fire-and-forget from the
// 60s bell poll. Safety design:
//  • OFF by default (tenant_settings.meraaj_auto_retry must be true)
//  • Atomic interval claim via findOneAndUpdate — one run per tenant per 10 minutes, no overlap
//  • Small batch (3) + short timeout (4s) + per-event backoff: events with attempts >= 8 are skipped
//  • Same idempotency as manual retry: SAME event id re-sent, SAME doc updated, no new docs
//  • Run summary stored in tenant_settings.meraaj_auto_retry_last for owner visibility
async function maybeAutoRetryMeraajEvents(db, T) {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 10 * 60 * 1000)
  const claim = await db.collection('tenant_settings').findOneAndUpdate(
    {
      tenant_id: T,
      meraaj_auto_retry: true,
      $or: [{ meraaj_auto_retry_last_run: { $lt: cutoff } }, { meraaj_auto_retry_last_run: { $exists: false } }, { meraaj_auto_retry_last_run: null }],
    },
    { $set: { meraaj_auto_retry_last_run: now } },
  )
  if (!claim) return
  const retryUrl = process.env.MERAAJ_WEBHOOK_URL || (meraajApiBase() ? `${meraajApiBase()}/api/integrations/rahal/webhooks` : '')
  if (!retryUrl || !meraajSecret()) return
  const batch = await db.collection('meraaj_events')
    .find({ tenant_id: T, status: 'failed', $or: [{ attempts: { $lt: 8 } }, { attempts: { $exists: false } }, { attempts: null }] })
    .sort({ created_at: 1 }).limit(3).toArray()
  let succeeded = 0, failed = 0
  for (const ev of batch) {
    const attempts = (Number(ev.attempts) || 0) + 1
    try {
      const body = JSON.stringify({ id: ev.id, type: ev.type, timestamp: Math.floor(Date.now() / 1000), data: ev.payload })
      const res = await fetch(retryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Rahal-Signature': meraajSign(body) },
        body,
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { status: 'sent', sent_at: new Date(), attempts, last_error: null, auto_retried_at: now } })
        succeeded++
      } else {
        await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { attempts, last_error: `HTTP ${res.status}`, auto_retried_at: now } })
        failed++
      }
    } catch (e) {
      await db.collection('meraaj_events').updateOne({ id: ev.id }, { $set: { attempts, last_error: String(e.message || e).slice(0, 200), auto_retried_at: now } })
      failed++
    }
  }
  await db.collection('tenant_settings').updateOne(
    { tenant_id: T },
    { $set: { meraaj_auto_retry_last: { at: now, processed: batch.length, succeeded, failed } } },
  )
}

async function emitMeraajEvent(db, tenantId, type, payload) {
  // v3.72 — a package hidden from the market (sold out or dispatched/مفوَّجة) must NOT be
  // relisted by ordinary edits: suppress package.updated while hidden. Relist paths clear
  // the flags BEFORE emitting, so they pass. deactivated/inventory events still flow.
  if (type === 'package.updated' && payload?.package_ref) {
    try {
      const gp = await db.collection('packages').findOne({ id: payload.package_ref, tenant_id: tenantId }, { projection: { 'meraaj.dispatched': 1, 'meraaj.hidden_full': 1 } })
      if (gp?.meraaj?.dispatched || gp?.meraaj?.hidden_full) return 'skipped'
    } catch { /* fall through — never block on guard errors */ }
  }
  // v3.34 — CRITICAL: enrich every package event with the FULL identity so Meraaj can
  // match its own record regardless of which key its handler uses:
  //   rahal_ref (Meraaj's stored link field) + meraaj_package_id (the id Meraaj itself
  //   returned at first-share registration) + package_ref (legacy, kept).
  // Without this, Meraaj acked webhooks with 200 but could not locate the package to apply changes.
  if (payload && payload.package_ref) {
    if (!payload.rahal_ref) payload.rahal_ref = payload.package_ref
    if (payload.meraaj_package_id === undefined) {
      try {
        const p = await db.collection('packages').findOne({ id: payload.package_ref, tenant_id: tenantId }, { projection: { 'meraaj.remote_id': 1 } })
        payload.meraaj_package_id = p?.meraaj?.remote_id || null
      } catch { payload.meraaj_package_id = null }
    }
  }
  const doc = {
    id: uuidv4(), tenant_id: tenantId, type, payload,
    status: 'pending', attempts: 0, last_error: null,
    created_at: new Date(), sent_at: null,
  }
  await db.collection('meraaj_events').insertOne(doc)
  // v3.30 — Webhook destination per Meraaj contract: {MERAAJ_API_BASE_URL}/api/integrations/rahal/webhooks
  // (MERAAJ_WEBHOOK_URL can still override explicitly)
  const url = process.env.MERAAJ_WEBHOOK_URL || (meraajApiBase() ? `${meraajApiBase()}/api/integrations/rahal/webhooks` : '')
  if (!url || !meraajSecret()) return 'pending' // stays pending in outbox until Meraaj endpoint is configured
  try {
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: doc.id, type, timestamp: ts, data: payload })
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // v3.30 — Meraaj contract auth: X-Rahal-Signature = HMAC-SHA256(exact raw JSON body).
        // The old x-rahaal-timestamp / x-rahaal-signature headers are NOT part of the contract — removed.
        'X-Rahal-Signature': meraajSign(body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) { await db.collection('meraaj_events').updateOne({ id: doc.id }, { $set: { status: 'sent', sent_at: new Date(), attempts: 1 } }); return 'sent' }
    await db.collection('meraaj_events').updateOne({ id: doc.id }, { $set: { status: 'failed', attempts: 1, last_error: `HTTP ${res.status}` } })
    return 'failed'
  } catch (e) {
    await db.collection('meraaj_events').updateOne({ id: doc.id }, { $set: { status: 'failed', attempts: 1, last_error: String(e.message || e).slice(0, 200) } })
    return 'failed'
  }
}
// v3.32 — Any edit to marketplace-visible data (components/hotels/transport/images) on a LISTED package
// must sync Meraaj via the existing package.updated webhook (contract payload) — never throws
async function maybeEmitMeraajPackageUpdate(db, tenantId, packageId) {
  try {
    const pkg = await db.collection('packages').findOne({ id: packageId, tenant_id: tenantId })
    if (!pkg || !pkg.meraaj?.shared) return
    const comps = await db.collection('package_components').find({ package_id: packageId, tenant_id: tenantId }).toArray()
    await emitMeraajEvent(db, tenantId, 'package.updated', await meraajContractPayload(db, tenantId, pkg, comps))
  } catch { /* marketplace sync must never break core operations */ }
}
// Emit inventory.updated for a shared package (called after any booking/seat change) — never throws
async function maybeEmitMeraajInventory(db, tenantId, packageId) {  try {
    const pkg = await db.collection('packages').findOne({ id: packageId, tenant_id: tenantId })
    if (!pkg || !pkg.meraaj?.shared) return
    const bookingsCount = await db.collection('package_bookings').countDocuments({ tenant_id: tenantId, package_id: packageId })
    await emitMeraajEvent(db, tenantId, 'inventory.updated', {
      package_ref: pkg.id,
      status: pkg.status,
      seats_allocated: Number(pkg.meraaj.seats_allocated) || 0,
      seats_sold: Number(pkg.meraaj.seats_sold) || 0,
      seats_available: meraajAvailability(pkg),
      availability: (pkg.meraaj.dispatched || pkg.status !== 'open' || meraajAvailability(pkg) <= 0) ? 'غير متاح' : 'متاح', // v3.72
      internal_bookings: bookingsCount,
      final_price: pkg.meraaj.final_price,
      currency: pkg.currency,
    })
  } catch { /* outbox failure must never break core ops */ }
}
// v3.72 — AUTO MARKET LISTING: when a shared package fills up (remaining = 0) it is hidden from
// the marketplace instantly (package.deactivated, reason: sold_out). When seats free up again
// (buyer cancellation / office rejection / add-seats) it relists automatically — UNLESS the
// office manually dispatched it (تفويج), which keeps it hidden until undone. Never throws.
async function meraajAutoListing(db, tenantId, packageId) {
  try {
    const pkg = await db.collection('packages').findOne({ id: packageId, tenant_id: tenantId })
    if (!pkg?.meraaj?.shared || pkg.meraaj.dispatched) return
    const remaining = meraajAvailability(pkg)
    if (remaining <= 0 && !pkg.meraaj.hidden_full) {
      await db.collection('packages').updateOne({ id: pkg.id, tenant_id: tenantId }, { $set: { 'meraaj.hidden_full': true } })
      await emitMeraajEvent(db, tenantId, 'package.deactivated', { package_ref: pkg.id, reason: 'sold_out', availability: 'غير متاح' })
    } else if (remaining > 0 && pkg.meraaj.hidden_full && pkg.status === 'open' && !pkg.archived) {
      await db.collection('packages').updateOne({ id: pkg.id, tenant_id: tenantId }, { $set: { 'meraaj.hidden_full': false } })
      const comps = await db.collection('package_components').find({ package_id: pkg.id, tenant_id: tenantId }).toArray()
      const fresh = { ...pkg, meraaj: { ...pkg.meraaj, hidden_full: false } }
      await emitMeraajEvent(db, tenantId, 'package.updated', await meraajContractPayload(db, tenantId, fresh, comps))
    }
  } catch { /* market listing sync must never break core ops */ }
}
// Public payload of a package for the marketplace
function meraajPackagePayload(pkg, comps = []) {
  return {
    package_ref: pkg.id,
    tenant_id: pkg.tenant_id,
    name: pkg.name,
    package_type: pkg.package_type,
    currency: pkg.currency,
    start_date: pkg.start_date, end_date: pkg.end_date,
    notes: pkg.notes || '',
    features: pkg.features || [],
    has_image: !!pkg.has_image,
    route: pkg.meraaj?.route || null, // v3.72
    availability: (pkg.meraaj?.dispatched || pkg.status !== 'open' || meraajAvailability(pkg) <= 0) ? 'غير متاح' : 'متاح', // v3.72
    image_url: pkg.has_image ? `/api/meraaj/packages/${pkg.id}/image` : null,
    pricing_mode: pkg.pricing_mode || 'direct',
    // v3.49 — NaN fix: resolve age-tier fallbacks before sending (empty child = adult price, empty infant = 0)
    // Same keys/structure as Contract v2 — values only, so Meraaj never receives null.
    room_pricing: (pkg.room_pricing || []).map(r => {
      const adult = Number(r.sale_per_pax) || 0
      return {
        ...r,
        sale_per_pax: adult,
        sale_child: (r.sale_child === null || r.sale_child === undefined || r.sale_child === '') ? adult : (Number(r.sale_child) || 0),
        sale_infant: (r.sale_infant === null || r.sale_infant === undefined || r.sale_infant === '') ? 0 : (Number(r.sale_infant) || 0),
      }
    }),
    status: pkg.status,
    meraaj: {
      shared: !!pkg.meraaj?.shared,
      pricing_source: 'auto_room_pricing',
      buyer_commission_mode: pkg.meraaj?.buyer_commission_mode || 'amount',
      buyer_commission_value: pkg.meraaj?.buyer_commission_value ?? 0,
      commission_direction: pkg.meraaj?.commission_direction || 'deducted',
      // v3.25 — full per-room per-age marketplace price table (customer price + agent commission + seller net)
      market_pricing: pkg.meraaj?.market_pricing || [],
      seats_allocated: Number(pkg.meraaj?.seats_allocated) || 0,
      seats_sold: Number(pkg.meraaj?.seats_sold) || 0,
      seats_available: meraajAvailability(pkg),
      shared_at: pkg.meraaj?.shared_at || null,
    },
    components: comps.map(c => ({ name: c.name, component_type: c.component_type, pricing_type: c.pricing_type || 'flat' })),
  }
}

// v3.29 — FIRST SHARE: direct REST registration at Meraaj (NOT a webhook event).
// POST {MERAAJ_API_BASE_URL}/api/integrations/rahal/packages/share with X-Rahal-Api-Key.
// Share succeeds ONLY on a 2xx response from Meraaj — any failure blocks the share.
function meraajApiBase() { return (process.env.MERAAJ_API_BASE_URL || '').trim().replace(/\/+$/, '') }
// v3.42 — Resilient public base URL for Rahaal-hosted assets (package image URLs sent to Meraaj).
// Root cause fix: on LIVE, an empty NEXT_PUBLIC_BASE_URL silently produced images: [] even when has_image=true.
// Priority: RAHAAL_PUBLIC_BASE_URL (explicit server-side override) → NEXT_PUBLIC_BASE_URL → live request origin (cached per request in the router).
function rahaalPublicBase() {
  const explicit = (process.env.RAHAAL_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  const pub = (process.env.NEXT_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  if (pub) return pub
  return String(globalThis.__rahaalPublicOrigin || '').replace(/\/+$/, '')
}
// v3.30 — UNIFIED Meraaj CONTRACT payload — single source of truth for field names:
// Rahaal name → Meraaj title | notes → description | start_date → departure_date | end_date → return_date
// Used by BOTH the first-share REST call AND the package.updated webhook (never send non-contract shapes).
async function meraajContractPayload(db, T, pkg, comps, meraajOverride = null) {
  const m = meraajOverride || pkg.meraaj || {}
  const tenant = await db.collection('tenants').findOne({ id: T }, { projection: { name: 1 } })
  const owner = await db.collection('users').findOne({ tenant_id: T, role: 'owner' }, { projection: { name: 1 } })
  // v3.49 — ZERO/NaN GUARD: if market_pricing is empty/stale while the package has room prices,
  // recompute it live from room_pricing + stored commission settings (values only — same structure).
  const marketRows = (Array.isArray(m.market_pricing) && m.market_pricing.length > 0)
    ? m.market_pricing
    : computeMeraajMarketPricing(pkg.room_pricing || [], m.buyer_commission_mode || 'amount', Number(m.buyer_commission_value) || 0, m.commission_direction || 'deducted', m.buyer_commission_child_value ?? null, m.buyer_commission_infant_value ?? null)
  // Representative per-seat pricing = cheapest adult row of the market pricing table
  const rows = marketRows.filter(r => (Number(r.customer?.adult) || 0) > 0)
  const cheapest = rows.slice().sort((a, b) => a.customer.adult - b.customer.adult)[0] || null
  // v3.49 — hotels: merge component-based hotels with the package's quick hotel details (names only — same string[] structure)
  const hotels = [...new Set([
    ...(comps || []).filter(c => c.component_type === 'hotel').map(c => String(c.name || '').trim()),
    ...((Array.isArray(pkg.hotels) ? pkg.hotels : []).map(h => String(h.name || '').trim())),
  ].filter(Boolean))]
  const appBase = rahaalPublicBase()
  // v3.42 — never fail silently: has_image=true must always yield a real image URL (root cause of LIVE images:[] bug)
  if (pkg.has_image && !appBase) console.error(`[MERAAJ] WARNING: package ${pkg.id} has_image=true but no public base URL could be resolved (set RAHAAL_PUBLIC_BASE_URL or NEXT_PUBLIC_BASE_URL) — images[] will be sent empty`)
  // v3.37 — EXTENDED CONTRACT (backward-compatible: all previous fields kept unchanged)
  const transports = await db.collection('package_transports').find({ package_id: pkg.id, tenant_id: T }).toArray()
  return {
    package_ref: pkg.id,
    // v3.36 — Meraaj v1.1 contract: unique-linkage identity fields in EVERY payload (share + webhooks)
    rahal_ref: pkg.id,
    meraaj_package_id: (meraajOverride?.remote_id ?? pkg.meraaj?.remote_id) || null,
    title: pkg.name,
    // v3.37 — extended fields
    package_type: pkg.package_type || null,
    // Full marketplace room pricing matrix (per room type × adult/child/infant):
    // net = what the buyer office pays the seller, customer = suggested final sale price,
    // commission = buyer office margin. (Seller's internal costs are NEVER exposed.)
    room_pricing: marketRows,
    // Full transport/bus fleet of the package (internal booking counts are not exposed)
    package_transports: transports.map(t => ({ name: t.name || '', type: t.type || 'bus', capacity: Number(t.capacity) || 0 })),
    // Full package components (names + types; internal cost/sale breakdown is not exposed)
    // v3.40 — additive optional fields: nights + city per hotel component
    components: (comps || []).map(c => ({ name: c.name || '', component_type: c.component_type || 'other', ...(Number(c.nights) > 0 ? { nights: Number(c.nights) } : {}), ...(c.city ? { city: c.city } : {}) })),
    description: pkg.notes || '',
    departure_date: pkg.start_date || null,
    return_date: pkg.end_date || null,
    departure_city: pkg.departure_city || null,
    transport: pkg.transport || null,
    hotels,
    images: pkg.has_image && appBase ? [`${appBase}/api/meraaj/packages/${pkg.id}/image`] : [],
    // v3.33 — package features must reach the marketplace (share + updates)
    features: Array.isArray(pkg.features) ? pkg.features : [],
    available_seats: Math.max(0, (Number(m.seats_allocated) || 0) - (Number(m.seats_sold) || 0)),
    // v3.72 — Meraaj UI shows the word only (green "متاح"), no seat numbers in the market
    availability: (m.dispatched || pkg.status !== 'open' || Math.max(0, (Number(m.seats_allocated) || 0) - (Number(m.seats_sold) || 0)) <= 0) ? 'غير متاح' : 'متاح',
    route: m.route || null, // v3.72 — trip route (e.g. الشحر - الريان - المكلا - جدة), set from the Meraaj dashboard
    office_ref: T,
    office_name: tenant?.name || '',
    owner_name: owner?.name || '',
    pricing: {
      net_cost_per_seat: cheapest ? cheapest.net.adult : 0,
      final_sale_price: cheapest ? cheapest.customer.adult : 0,
      buyer_office_commission: cheapest ? cheapest.commission.adult : 0,
      currency: pkg.currency,
    },
  }
}
async function meraajRegisterPackageAPI(db, T, pkg, comps, meraajSet) {
  const base = meraajApiBase()
  if (!base) return { ok: false, error: 'MERAAJ_API_BASE_URL غير مُهيأ في إعدادات الخادم' }
  if (!meraajSecret()) return { ok: false, error: 'MERAAJ_SHARED_SECRET غير مُهيأ' }
  const payload = await meraajContractPayload(db, T, pkg, comps, meraajSet)
  const endpoint = `${base}/api/integrations/rahal/packages/share`
  const logDoc = {
    id: uuidv4(), tenant_id: T, type: 'package.share_api', channel: 'rest_api',
    payload: { package_ref: pkg.id, endpoint },
    status: 'pending', attempts: 1, last_error: null, created_at: new Date(), sent_at: null,
  }
  try {
    // v3.36 — Meraaj v1.1: EVERY request is HMAC-SHA256 signed over the exact raw body.
    // Share request carries BOTH: X-Rahal-Api-Key (existing contract) + X-Rahal-Signature.
    const rawBody = JSON.stringify(payload)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Rahal-Api-Key': meraajSecret(), 'X-Rahal-Signature': meraajSign(rawBody) },
      body: rawBody,
      signal: AbortSignal.timeout(15000),
    })
    let json = null
    try { json = await res.json() } catch { /* non-JSON body is fine */ }
    if (res.ok) {
      logDoc.status = 'sent'; logDoc.sent_at = new Date()
      await db.collection('meraaj_events').insertOne(logDoc)
      const remoteId = json?.meraaj_package_id || json?.package_id || json?.id || json?.data?.id || null
      return { ok: true, remote_id: remoteId }
    }
    const errMsg = (json?.message || json?.error || `HTTP ${res.status}`).toString().slice(0, 200)
    logDoc.status = 'failed'; logDoc.last_error = errMsg
    await db.collection('meraaj_events').insertOne(logDoc)
    return { ok: false, error: errMsg }
  } catch (e) {
    const errMsg = String(e.message || e).slice(0, 200)
    logDoc.status = 'failed'; logDoc.last_error = errMsg
    try { await db.collection('meraaj_events').insertOne(logDoc) } catch {}
    return { ok: false, error: errMsg.includes('abort') || errMsg.includes('timeout') ? 'انتهت مهلة الاتصال بمعراج' : errMsg }
  }
}

// ================= v3.77 — DOCUMENTS & VERIFICATION LAYER =================
// Storage abstraction — target driver: S3-compatible PRIVATE object storage.
// Driver selection via ENV ONLY (credentials NEVER in code):
//   S3_ENDPOINT + S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY (+ S3_REGION)
// Until real S3 credentials are provided, the 'db' fallback stores blobs in MongoDB
// (collection document_blobs) — NOT container-local disk, survives restarts, and is
// migration-ready (same object_key namespace: a one-shot script can move blobs to S3).
const DOC_ALLOWED_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const DOC_MAX_BYTES = 4 * 1024 * 1024 // 4MB per document (safe for base64 transport behind ingress)
function docStorageDriver() {
  return (process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) ? 's3' : 'db'
}
async function docStoragePut(db, T, objectKey, base64Data, contentType, size) {
  if (docStorageDriver() === 's3') {
    // Intentionally NOT wired yet — awaiting S3 provider credentials (blocker documented).
    throw new Error('S3 driver detected but not wired — قدّم بيانات مزود S3 لإكمال الربط عبر playbook التكامل')
  }
  await db.collection('document_blobs').updateOne(
    { object_key: objectKey },
    { $set: { object_key: objectKey, tenant_id: T, data: base64Data, content_type: contentType, size, created_at: new Date() } },
    { upsert: true },
  )
  return { driver: 'db' }
}
async function docStorageGet(db, objectKey) {
  if (docStorageDriver() === 's3') throw new Error('S3 driver not wired yet')
  const blob = await db.collection('document_blobs').findOne({ object_key: objectKey })
  if (!blob) return null
  return { buffer: Buffer.from(blob.data, 'base64'), content_type: blob.content_type || 'application/octet-stream', size: blob.size || 0 }
}
async function docStorageDelete(db, objectKey) {
  if (docStorageDriver() === 's3') throw new Error('S3 driver not wired yet')
  await db.collection('document_blobs').deleteOne({ object_key: objectKey })
}
// Audit trail for EVERY document action (upload/view/delete/status change)
async function docAuditLog(db, T, action, docId, actor, meta = {}) {
  try { await db.collection('document_audit').insertOne({ id: uuidv4(), tenant_id: T, doc_id: docId, action, actor: String(actor || '').slice(0, 160), meta, at: new Date() }) } catch { /* audit must never break the request */ }
}
// Upload payload validation: MIME whitelist + size cap + random object key
// v3.85 — maxBytes is overridable per path (booking/integration docs allow more than the default)
function parseDocUpload(b, T, prefix, maxBytes = DOC_MAX_BYTES) {
  const contentType = String(b.content_type || '').toLowerCase().trim()
  const ext = DOC_ALLOWED_MIME[contentType]
  if (!ext) return { error: `نوع الملف غير مسموح — المسموح: PDF / JPG / PNG / WEBP (المستلم: ${contentType || 'غير محدد'})` }
  const raw = String(b.file_base64 || '').replace(/^data:[^;]+;base64,/, '')
  // v3.85 — validate base64 in 1MB slices: RegExp.test on one very large string can overflow
  // V8's call stack (RangeError) — sliced checks behave identically and are safe at any size.
  let rawValid = raw.length > 0
  for (let vi = 0; vi < raw.length && rawValid; vi += 1024 * 1024) {
    if (!/^[A-Za-z0-9+/=]+$/.test(raw.slice(vi, vi + 1024 * 1024))) rawValid = false
  }
  if (!rawValid) return { error: 'محتوى الملف (file_base64) مفقود أو غير صالح' }
  const size = Math.floor(raw.length * 0.75)
  if (size > maxBytes) return { error: `حجم الملف يتجاوز الحد (${(maxBytes / 1024 / 1024).toFixed(0)}MB)` }
  if (size < 100) return { error: 'الملف فارغ أو تالف' }
  const filename = String(b.filename || `document.${ext}`).replace(/[^\w\u0600-\u06FF .()\-]/g, '').slice(0, 120) || `document.${ext}`
  const objectKey = `${prefix}/${T}/${uuidv4()}.${ext}` // random object key — never user-controlled
  return { contentType, ext, base64: raw, size, filename, objectKey }
}
// Short-lived signed download URL (HMAC over doc id + expiry) — for authorized cross-system sharing
function docSignedUrl(docId, expiresInSec = 72 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec
  const sig = meraajSign(`doc:${docId}:${exp}`)
  return `${rahaalPublicBase()}/api/meraaj/documents/signed/${docId}?exp=${exp}&sig=${sig}`
}

// v3.76 — ACCOUNT LINKING: register/link the office at Meraaj via REST (same signing contract as package share).
// POST {MERAAJ_API_BASE_URL}/api/integrations/rahal/offices/link with X-Rahal-Api-Key + X-Rahal-Signature.
// Success ONLY on 2xx; the returned office id is stored as tenant_settings.meraaj_office_id.
async function meraajLinkOfficeAPI(db, T, payload) {
  const base = meraajApiBase()
  if (!base) return { ok: false, error: 'MERAAJ_API_BASE_URL غير مُهيأ في إعدادات الخادم' }
  if (!meraajSecret()) return { ok: false, error: 'MERAAJ_SHARED_SECRET غير مُهيأ' }
  const endpoint = `${base}/api/integrations/rahal/offices/link`
  const logDoc = {
    id: uuidv4(), tenant_id: T, type: 'office.link_api', channel: 'rest_api',
    payload: { office_ref: T, endpoint },
    status: 'pending', attempts: 1, last_error: null, created_at: new Date(), sent_at: null,
  }
  try {
    const rawBody = JSON.stringify(payload)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Rahal-Api-Key': meraajSecret(), 'X-Rahal-Signature': meraajSign(rawBody) },
      body: rawBody,
      signal: AbortSignal.timeout(15000),
    })
    let json = null
    try { json = await res.json() } catch { /* non-JSON body is fine */ }
    if (res.ok) {
      logDoc.status = 'sent'; logDoc.sent_at = new Date()
      await db.collection('meraaj_events').insertOne(logDoc)
      const officeId = json?.meraaj_office_id || json?.office_id || json?.id || json?.data?.id || null
      return { ok: true, office_id: officeId }
    }
    const errMsg = (json?.message || json?.error || `HTTP ${res.status}`).toString().slice(0, 200)
    logDoc.status = 'failed'; logDoc.last_error = errMsg
    await db.collection('meraaj_events').insertOne(logDoc)
    return { ok: false, error: errMsg }
  } catch (e) {
    const errMsg = String(e.message || e).slice(0, 200)
    logDoc.status = 'failed'; logDoc.last_error = errMsg
    try { await db.collection('meraaj_events').insertOne(logDoc) } catch {}
    return { ok: false, error: errMsg.includes('abort') || errMsg.includes('timeout') ? 'انتهت مهلة الاتصال بمعراج' : errMsg }
  }
}

// ================= Business logic =================
async function createTicket(db, T, b, opts = {}) {
  if (isFutureDocDate(b.date)) return { error: `${FUTURE_DOC_DATE_MSG} (تاريخ إصدار التذكرة)` } // v3.80
  if (!b.supplier_id) return { error: 'المورد مطلوب' }
  if (!CURRENCIES.includes(b.currency)) return { error: 'عملة غير صالحة' }
  // v3.10.2 — Strict validation for mandatory ticket fields
  if (!b.passenger_name || !String(b.passenger_name).trim()) return { error: 'اسم المسافر مطلوب' }
  if (!b.travel_date) return { error: 'تاريخ السفر مطلوب' }
  // v3.10.7 — Accept the real ticket phone fields (passenger_phone / passenger_whatsapp).
  // Legacy 'phone' key is still accepted for backward compatibility.
  const _ticketPhone = (b.passenger_phone || b.passenger_whatsapp || b.phone || '').toString().trim()
  if (!_ticketPhone) return { error: 'رقم الجوال مطلوب' }
  // v3.10.2 — Reject negative amounts across all numeric fields
  const numFields = ['cost', 'sale_price', 'discount', 'commission', 'partner_commission_share', 'partner_commission', 'commission_office_share']
  for (const f of numFields) if (b[f] !== undefined && Number(b[f]) < 0) return { error: `القيمة السالبة غير مسموحة في الحقل: ${f}` }
  // v4.6 — RAH-ACC: CENTRAL closed year/period fail-fast (the old local string compare
  // missed a date-with-time on the boundary day → the central gate then threw AFTER the
  // doc/balances were written). Journal quota is also preflighted — no partial state on 402.
  const perrTk = await assertOpenPeriod(db, T, b.date)
  if (perrTk) return { error: perrTk }
  if (!opts.skipQuota) { try { await assertJournalQuota(db, T) } catch (e) { return { error: e.message } } }
  const paymentMethod = b.payment_method === 'cash' ? 'cash' : 'credit'
  if (paymentMethod === 'credit' && !b.client_id) return { error: 'العميل مطلوب للحجز الآجل' }
  const cost = Number(b.cost) || 0, sale = Number(b.sale_price) || 0
  const commission = +(sale - cost).toFixed(2)
  const cli = b.client_id ? await db.collection('clients').findOne({ id: b.client_id, tenant_id: T }) : null
  const sup = await db.collection('suppliers').findOne({ id: b.supplier_id, tenant_id: T })
  if (!sup) return { error: 'المورد غير موجود' }
  if (paymentMethod === 'credit' && !cli) return { error: 'العميل غير موجود' }
  // v3.10.6 — Credit limit + freeze check
  if (paymentMethod === 'credit' && !opts.existingId) {
    const _settings_credit = await db.collection('tenant_settings').findOne({ tenant_id: T }) || {}
    const _cc = await checkClientCredit(db, T, b.client_id, sale || Number(b.sale_price) || 0, b.currency, _settings_credit)
    if (!_cc.ok) return { error: _cc.error }
  }
  // v3.10.7 — Below-cost sale prevention (Phase 6)
  const _cost = Number(b.cost) || 0
  const _sale = Number(b.sale_price) || 0
  if (_cost > 0 && _sale > 0 && _sale < _cost && !b.allow_below_cost) {
    return { error: `⚠️ سعر البيع (${_sale}) أقل من التكلفة (${_cost}) — لتجاوز هذا الحد أضف \"allow_below_cost: true\" في الطلب أو ارفع السعر أعلى من التكلفة.` }
  }
  let box = null
  if (paymentMethod === 'cash') {
    if (!b.box_id) return { error: 'اختر الصندوق/البنك للدفع النقدي' }
    box = await db.collection('boxes').findOne({ id: b.box_id, tenant_id: T })
    if (!box) return { error: 'الصندوق غير موجود' }
  }
  const doc = {
    id: opts.existingId || uuidv4(), tenant_id: T, date: new Date(b.date || Date.now()), currency: b.currency,
    exchange_rate: Number(b.exchange_rate) || 1,
    client_id: cli?.id || null, client_name: cli?.name || (paymentMethod === 'cash' ? (b.client_name || 'عميل نقدي') : ''),
    supplier_id: sup.id, supplier_name: sup.name,
    pnr: b.pnr || '', route: b.route || '', passenger_name: b.passenger_name || '',
    passport_no: b.passport_no || '', travel_date: b.travel_date ? new Date(b.travel_date) : null,
    // v3.2 — Travel mode + departure time for smart WhatsApp templates
    travel_mode: b.travel_mode === 'land' ? 'land' : 'air',
    departure_time: b.departure_time || '',
    passenger_whatsapp: b.passenger_whatsapp || b.passenger_phone || '',
    // v2.7 — Non-financial informational fields for printable ticket
    carrier_name: b.carrier_name || '',
    passenger_phone: b.passenger_phone || '',
    passenger_age: b.passenger_age || '',
    id_type: b.id_type || 'هوية شخصية',
    id_issue_place: b.id_issue_place || '',
    id_issue_date: b.id_issue_date || '',
    ticket_number: b.ticket_number || b.pnr || '',
    flight_number: b.flight_number || '',
    ticket_type: b.ticket_type || 'عادي',
    booking_date: b.booking_date ? new Date(b.booking_date) : new Date(b.date || Date.now()),
    arrival_time: b.arrival_time || '',
    departure_time: b.departure_time || '',
    boarding_point: b.boarding_point || '',
    sale_point: b.sale_point || '',
    cost, sale_price: sale, commission,
    // v3.9.27 — Commission Sharing (partner split)
    commission_partner_type: b.commission_partner_type || null,   // 'client' | 'supplier' | null
    commission_partner_id: b.commission_partner_id || null,
    commission_partner_name: b.commission_partner_name || '',
    commission_share_mode: b.commission_share_mode === 'percent' ? 'percent' : 'amount',
    commission_share_value: Number(b.commission_share_value) || 0,
    commission_share_amount: 0,   // computed below
    payment_method: paymentMethod, box_id: box?.id || null, box_name: box?.name_ar || null,
    created_at: opts.createdAt || new Date(),
    ...(opts.existingId ? { updated_at: new Date() } : {}),
  }
  // v3.9.27 — Compute partner commission share amount
  let partnerShare = 0
  if (doc.commission_partner_id && doc.commission_share_value > 0 && commission > 0) {
    if (doc.commission_share_mode === 'percent') {
      partnerShare = +(commission * (doc.commission_share_value / 100)).toFixed(2)
    } else {
      partnerShare = +Number(doc.commission_share_value).toFixed(2)
    }
    partnerShare = Math.min(partnerShare, commission) // cap at total commission
  }
  doc.commission_share_amount = partnerShare
  const officeNetCommission = +(commission - partnerShare).toFixed(2)
  // v3.88.4 — F-007: the partner-commission line must post to the partner's LEAF account
  const partnerDoc = (partnerShare > 0 && doc.commission_partner_id)
    ? await db.collection(doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients').findOne({ id: doc.commission_partner_id, tenant_id: T })
    : null
  // v3.88.5 — F-007 STRICT: resolve LEAF accounts BEFORE the first write — a legacy party
  // without a leaf account fails HERE with ZERO side-effects (no doc, no JE, no balances).
  const boxLeaf = paymentMethod === 'cash' ? partyLeafCode(box) : null
  const cliLeaf = paymentMethod === 'cash' ? null : partyLeafCode(cli)
  const supLeaf = partyLeafCode(sup)
  const partnerLeaf = partnerDoc ? partyLeafCode(partnerDoc) : null
  await db.collection('tickets').insertOne(doc)
  // Balance updates + journal
  await updateBalance(db, 'suppliers', { id: sup.id, tenant_id: T }, b.currency, cost)
  // v3.9.27 — Update partner balance if commission-share configured
  if (partnerShare > 0 && doc.commission_partner_id) {
    const col = doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
    // Partner is CREDITED (they are owed by us). For clients that means their debt to us decreases.
    // We credit them by -partnerShare (i.e., they owe us less / we owe them if supplier)
    await updateBalance(db, col, { id: doc.commission_partner_id, tenant_id: T }, b.currency, -partnerShare)
  }
  const lines = []
  if (paymentMethod === 'cash') {
    await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, b.currency, sale)
    lines.push({ account_code: boxLeaf, account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: sale, credit: 0 })
  } else {
    await updateBalance(db, 'clients', { id: cli.id, tenant_id: T }, b.currency, sale)
    lines.push({ account_code: cliLeaf, account_name: 'العملاء', party_type: 'client', party_id: cli.id, party_name: cli.name, debit: sale, credit: 0 })
  }
  lines.push({ account_code: supLeaf, account_name: 'الموردون', party_type: 'supplier', party_id: sup.id, party_name: sup.name, debit: 0, credit: cost })
  if (officeNetCommission !== 0) {
    lines.push({ account_code: COA.REV_TICKETS, account_name: 'إيرادات عمولات التذاكر', party_type: 'revenue', party_id: null, party_name: 'إيرادات عمولات التذاكر', debit: 0, credit: officeNetCommission })
  }
  if (partnerShare > 0) {
    lines.push({ account_code: partnerLeaf, account_name: doc.commission_partner_type === 'supplier' ? 'الموردون' : 'العملاء', party_type: doc.commission_partner_type, party_id: doc.commission_partner_id, party_name: doc.commission_partner_name || 'شريك عمولة', debit: 0, credit: partnerShare })
  }
  await createJournalEntry(db, T, {
    date: doc.date, description: `${opts.existingId ? 'تعديل ' : ''}حجز تذكرة ${paymentMethod === 'cash' ? '(نقد)' : '(آجل)'} PNR ${doc.pnr || '-'} — ${cli?.name || doc.client_name || sup.name}${partnerShare > 0 ? ` — عمولة مشتركة ${partnerShare} مع ${doc.commission_partner_name}` : ''}`,
    ref_type: 'ticket', ref_id: doc.id, currency: b.currency, lines,
  }, { skipQuota: !!opts.skipQuota })
  const { _id, ...rest } = doc; return { doc: rest }
}

async function createVisa(db, T, b, opts = {}) {
  if (isFutureDocDate(b.date)) return { error: `${FUTURE_DOC_DATE_MSG} (تاريخ إصدار التأشيرة)` } // v3.80
  if (!b.supplier_id) return { error: 'المورد مطلوب' }
  if (!CURRENCIES.includes(b.currency)) return { error: 'عملة غير صالحة' }
  // v3.10.2 — Strict validation for mandatory visa fields
  if (!b.beneficiary_name || !String(b.beneficiary_name).trim()) return { error: 'اسم صاحب التأشيرة / المعتمر مطلوب' }
  // v3.10.7 — Accept the real visa phone fields (beneficiary_phone / beneficiary_whatsapp / passenger_phone).
  // Legacy 'phone' key is still accepted for backward compatibility.
  const _visaPhone = (b.beneficiary_phone || b.beneficiary_whatsapp || b.passenger_phone || b.passenger_whatsapp || b.phone || '').toString().trim()
  if (!_visaPhone) return { error: 'رقم الجوال مطلوب' }
  // v3.10.2 — Reject negative amounts
  const numFields = ['cost', 'sale_price', 'discount', 'commission']
  for (const f of numFields) if (b[f] !== undefined && Number(b[f]) < 0) return { error: `القيمة السالبة غير مسموحة في الحقل: ${f}` }
  // v4.6 — RAH-ACC: CENTRAL closed year/period fail-fast (boundary-day string-compare gap
  // fixed) + journal quota preflight — no doc/balance write can precede a failing gate.
  const perrVs = await assertOpenPeriod(db, T, b.date)
  if (perrVs) return { error: perrVs }
  if (!opts.skipQuota) { try { await assertJournalQuota(db, T) } catch (e) { return { error: e.message } } }
  const paymentMethod = b.payment_method === 'cash' ? 'cash' : 'credit'
  if (paymentMethod === 'credit' && !b.client_id) return { error: 'العميل مطلوب للحجز الآجل' }
  const cost = Number(b.cost) || 0, sale = Number(b.sale_price) || 0
  const commission = +(sale - cost).toFixed(2)
  const cli = b.client_id ? await db.collection('clients').findOne({ id: b.client_id, tenant_id: T }) : null
  const sup = await db.collection('suppliers').findOne({ id: b.supplier_id, tenant_id: T })
  if (!sup) return { error: 'المورد غير موجود' }
  if (paymentMethod === 'credit' && !cli) return { error: 'العميل غير موجود' }
  // v3.10.6 — Credit limit + freeze check
  if (paymentMethod === 'credit' && !opts.existingId) {
    const _settings_credit = await db.collection('tenant_settings').findOne({ tenant_id: T }) || {}
    const _cc = await checkClientCredit(db, T, b.client_id, sale || Number(b.sale_price) || 0, b.currency, _settings_credit)
    if (!_cc.ok) return { error: _cc.error }
  }
  // v3.10.7 — Below-cost sale prevention (Phase 6)
  const _cost = Number(b.cost) || 0
  const _sale = Number(b.sale_price) || 0
  if (_cost > 0 && _sale > 0 && _sale < _cost && !b.allow_below_cost) {
    return { error: `⚠️ سعر البيع (${_sale}) أقل من التكلفة (${_cost}) — لتجاوز هذا الحد أضف \"allow_below_cost: true\" في الطلب أو ارفع السعر أعلى من التكلفة.` }
  }
  let box = null
  if (paymentMethod === 'cash') {
    if (!b.box_id) return { error: 'اختر الصندوق/البنك للدفع النقدي' }
    box = await db.collection('boxes').findOne({ id: b.box_id, tenant_id: T })
    if (!box) return { error: 'الصندوق غير موجود' }
  }
  const doc = {
    id: opts.existingId || uuidv4(), tenant_id: T, date: new Date(b.date || Date.now()), service_type: b.service_type || 'تأشيرة عمرة',
    currency: b.currency, exchange_rate: Number(b.exchange_rate) || 1,
    client_id: cli?.id || null, client_name: cli?.name || (paymentMethod === 'cash' ? (b.client_name || 'عميل نقدي') : ''),
    supplier_id: sup.id, supplier_name: sup.name,
    passenger_name: b.passenger_name || '', passport_no: b.passport_no || '',
    nationality: b.nationality || '', attachment_url: b.attachment_url || '',
    // v3.2 — Phone / WhatsApp for direct-contact smart templates
    passenger_phone: b.passenger_phone || '',
    passenger_whatsapp: b.passenger_whatsapp || b.passenger_phone || '',
    // v3.0 — Entry/Exit tracking for expiration alerts
    entry_date: b.entry_date ? new Date(b.entry_date) : null,
    expected_exit_date: b.expected_exit_date ? new Date(b.expected_exit_date) : null,
    is_exited: !!b.is_exited,
    cost, sale_price: sale, commission,
    // v3.19 — Commission Sharing (partner split) — generalized from tickets v3.9.27
    commission_partner_type: b.commission_partner_type || null,   // 'client' | 'supplier' | null
    commission_partner_id: b.commission_partner_id || null,
    commission_partner_name: b.commission_partner_name || '',
    commission_share_mode: b.commission_share_mode === 'percent' ? 'percent' : 'amount',
    commission_share_value: Number(b.commission_share_value) || 0,
    commission_share_amount: 0,
    payment_method: paymentMethod, box_id: box?.id || null, box_name: box?.name_ar || null,
    created_at: opts.createdAt || new Date(),
    ...(opts.existingId ? { updated_at: new Date() } : {}),
  }
  // v3.19 — Compute partner commission share amount (same rules as tickets)
  let partnerShare = 0
  if (doc.commission_partner_id && doc.commission_share_value > 0 && commission > 0) {
    if (doc.commission_share_mode === 'percent') partnerShare = +(commission * (doc.commission_share_value / 100)).toFixed(2)
    else partnerShare = +Number(doc.commission_share_value).toFixed(2)
    partnerShare = Math.min(partnerShare, commission)
  }
  doc.commission_share_amount = partnerShare
  const officeNetCommission = +(commission - partnerShare).toFixed(2)
  // v3.88.4 — F-007: the partner-commission line must post to the partner's LEAF account
  const partnerDoc = (partnerShare > 0 && doc.commission_partner_id)
    ? await db.collection(doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients').findOne({ id: doc.commission_partner_id, tenant_id: T })
    : null
  // v3.88.5 — F-007 STRICT: resolve LEAF accounts BEFORE the first write (zero side-effects)
  const boxLeaf = paymentMethod === 'cash' ? partyLeafCode(box) : null
  const cliLeaf = paymentMethod === 'cash' ? null : partyLeafCode(cli)
  const supLeaf = partyLeafCode(sup)
  // v4.6 — RAH-ACC CRITICAL FIX: partnerLeaf was NEVER defined in createVisa (it exists in
  // createTicket/createService) → any visa carrying a partner commission share crashed with
  // a ReferenceError AFTER the doc + balances were written (partial state, no journal).
  const partnerLeaf = partnerDoc ? partyLeafCode(partnerDoc) : null
  await db.collection('visas').insertOne(doc)
  await updateBalance(db, 'suppliers', { id: sup.id, tenant_id: T }, b.currency, cost)
  if (partnerShare > 0 && doc.commission_partner_id) {
    const col = doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
    await updateBalance(db, col, { id: doc.commission_partner_id, tenant_id: T }, b.currency, -partnerShare)
  }
  const lines = []
  if (paymentMethod === 'cash') {
    await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, b.currency, sale)
    lines.push({ account_code: boxLeaf, account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: sale, credit: 0 })
  } else {
    await updateBalance(db, 'clients', { id: cli.id, tenant_id: T }, b.currency, sale)
    lines.push({ account_code: cliLeaf, account_name: 'العملاء', party_type: 'client', party_id: cli.id, party_name: cli.name, debit: sale, credit: 0 })
  }
  lines.push({ account_code: supLeaf, account_name: 'الموردون', party_type: 'supplier', party_id: sup.id, party_name: sup.name, debit: 0, credit: cost })
  if (officeNetCommission !== 0) {
    lines.push({ account_code: COA.REV_VISAS, account_name: 'إيرادات عمولات التأشيرات', party_type: 'revenue', party_id: null, party_name: 'إيرادات عمولات التأشيرات', debit: 0, credit: officeNetCommission })
  }
  if (partnerShare > 0) {
    lines.push({ account_code: partnerLeaf, account_name: doc.commission_partner_type === 'supplier' ? 'الموردون' : 'العملاء', party_type: doc.commission_partner_type, party_id: doc.commission_partner_id, party_name: doc.commission_partner_name || 'شريك عمولة', debit: 0, credit: partnerShare })
  }
  await createJournalEntry(db, T, {
    date: doc.date, description: `${opts.existingId ? 'تعديل ' : ''}${doc.service_type} ${paymentMethod === 'cash' ? '(نقد)' : '(آجل)'} — ${doc.passenger_name || cli?.name || doc.client_name || sup.name}${partnerShare > 0 ? ` — عمولة مشتركة ${partnerShare} مع ${doc.commission_partner_name}` : ''}`,
    ref_type: 'visa', ref_id: doc.id, currency: b.currency, lines,
  }, { skipQuota: !!opts.skipQuota })
  // v3.10.5 — Auto-create Visa Monitor record if destination_country + passport are provided
  if (!opts.existingId && b.destination_country && b.passport_no) {
    try {
      const passport = String(b.passport_no).trim().toUpperCase()
      const existing = await db.collection('visa_monitoring').findOne({ tenant_id: T, passport_no: passport })
      if (!existing) {
        await db.collection('visa_monitoring').insertOne({
          id: uuidv4(), tenant_id: T,
          traveler_name: doc.passenger_name || doc.beneficiary_name || '',
          phone: b.phone || '',
          passport_no: passport,
          destination_country: b.destination_country,
          visa_type: doc.service_type,
          entry_date: b.entry_date || doc.date,
          max_exit_date: b.max_exit_date || null,
          actual_exit_date: null,
          status: 'active',
          linked_visa_id: doc.id,
          source: 'auto_from_visa',
          notes: 'إنشاء تلقائي من شاشة التأشيرات',
          created_at: new Date(), updated_at: new Date()
        })
      }
    } catch (e) { /* silent — monitor creation is optional */ }
  }
  const { _id, ...rest } = doc; return { doc: rest }
}

// v3.0 — Services: Dedicated dynamic-catalog service transactions (Hotels, Attestations, Transfers, etc.)
// Uses revenue account 4103 (إيرادات خدمات إضافية). Party label = "حساب القبض" but stored the same way.
async function createService(db, T, b, opts = {}) {
  if (isFutureDocDate(b.date)) return { error: `${FUTURE_DOC_DATE_MSG} (تاريخ الخدمة/المستند)` } // v3.80
  if (!b.supplier_id) return { error: 'المورد/المزود مطلوب' }
  // v3.89 — Task 4: beneficiary name & phone are MANDATORY for services (create + edit)
  // v3.89.4 — F-PR16-001 FIX: beneficiary_phone is checked STRICTLY on its own. The old
  // `|| b.beneficiary_whatsapp` fallback let a phone-less service through whenever whatsapp
  // held any value (the UI auto-copies the first phone keystroke into whatsapp, so clearing
  // the phone kept whatsapp filled → saved with FULL financial impact). Rejection happens
  // HERE — before ANY balance / journal / financial write in this function.
  if (!String(b.beneficiary_name || '').trim()) return { error: 'اسم المستفيد مطلوب' }
  if (!String(b.beneficiary_phone || '').trim()) return { error: 'رقم هاتف المستفيد مطلوب' }
  if (!CURRENCIES.includes(b.currency)) return { error: 'عملة غير صالحة' }
  // v3.88.4 — F-001: reject negative amounts (same rule tickets/visas had since v3.10.2 —
  // services were the only path missing it). Values are rejected, NEVER abs()-coerced.
  const numFieldsSvc = ['cost', 'sale_price', 'discount', 'commission', 'commission_share_value']
  for (const f of numFieldsSvc) if (b[f] !== undefined && Number(b[f]) < 0) return { error: `القيمة السالبة غير مسموحة في الحقل: ${f}` }
  // v4.6 — RAH-ACC: CENTRAL closed year/period fail-fast (boundary-day string-compare gap
  // fixed) + journal quota preflight — no doc/balance write can precede a failing gate.
  const perrSv = await assertOpenPeriod(db, T, b.date)
  if (perrSv) return { error: perrSv }
  if (!opts.skipQuota) { try { await assertJournalQuota(db, T) } catch (e) { return { error: e.message } } }
  const paymentMethod = b.payment_method === 'cash' ? 'cash' : 'credit'
  // v3.9.22 — Unified payment: credit needs client_id, cash needs box_id only
  if (paymentMethod === 'credit' && !b.client_id) return { error: 'العميل مطلوب للحجز الآجل' }
  const cost = Number(b.cost) || 0, sale = Number(b.sale_price) || 0
  const commission = +(sale - cost).toFixed(2)
  const cli = b.client_id ? await db.collection('clients').findOne({ id: b.client_id, tenant_id: T }) : null
  const sup = await db.collection('suppliers').findOne({ id: b.supplier_id, tenant_id: T })
  if (!sup) return { error: 'المورد غير موجود' }
  if (paymentMethod === 'credit' && !cli) return { error: 'العميل غير موجود' }
  // v3.10.6 — Credit limit + freeze check
  if (paymentMethod === 'credit' && !opts.existingId) {
    const _settings_credit = await db.collection('tenant_settings').findOne({ tenant_id: T }) || {}
    const _cc = await checkClientCredit(db, T, b.client_id, sale || Number(b.sale_price) || 0, b.currency, _settings_credit)
    if (!_cc.ok) return { error: _cc.error }
  }
  // v3.10.7 — Below-cost sale prevention (Phase 6)
  const _cost = Number(b.cost) || 0
  const _sale = Number(b.sale_price) || 0
  if (_cost > 0 && _sale > 0 && _sale < _cost && !b.allow_below_cost) {
    return { error: `⚠️ سعر البيع (${_sale}) أقل من التكلفة (${_cost}) — لتجاوز هذا الحد أضف \"allow_below_cost: true\" في الطلب أو ارفع السعر أعلى من التكلفة.` }
  }
  let box = null
  if (paymentMethod === 'cash') {
    if (!b.box_id) return { error: 'اختر الصندوق/البنك للدفع النقدي' }
    box = await db.collection('boxes').findOne({ id: b.box_id, tenant_id: T })
    if (!box) return { error: 'الصندوق غير موجود' }
  }
  const doc = {
    id: opts.existingId || uuidv4(), tenant_id: T, date: new Date(b.date || Date.now()),
    service_type: b.service_type || 'خدمات متنوعة',
    description: b.description || '',
    currency: b.currency, exchange_rate: Number(b.exchange_rate) || 1,
    client_id: cli?.id || null,
    client_name: cli?.name || (paymentMethod === 'cash' ? (b.client_name || 'عميل نقدي') : ''),
    supplier_id: sup.id, supplier_name: sup.name,
    beneficiary_name: b.beneficiary_name || '', reference_no: b.reference_no || '',
    // v3.2 — Phone / WhatsApp
    beneficiary_phone: b.beneficiary_phone || '',
    beneficiary_whatsapp: b.beneficiary_whatsapp || b.beneficiary_phone || '',
    notes: b.notes || '',
    cost, sale_price: sale, commission,
    // v3.19 — Commission Sharing (partner split) — generalized from tickets v3.9.27
    commission_partner_type: b.commission_partner_type || null,
    commission_partner_id: b.commission_partner_id || null,
    commission_partner_name: b.commission_partner_name || '',
    commission_share_mode: b.commission_share_mode === 'percent' ? 'percent' : 'amount',
    commission_share_value: Number(b.commission_share_value) || 0,
    commission_share_amount: 0,
    payment_method: paymentMethod, box_id: box?.id || null, box_name: box?.name_ar || null,
    created_at: opts.createdAt || new Date(),
    ...(opts.existingId ? { updated_at: new Date() } : {}),
  }
  // v3.19 — Compute partner commission share amount
  let partnerShare = 0
  if (doc.commission_partner_id && doc.commission_share_value > 0 && commission > 0) {
    if (doc.commission_share_mode === 'percent') partnerShare = +(commission * (doc.commission_share_value / 100)).toFixed(2)
    else partnerShare = +Number(doc.commission_share_value).toFixed(2)
    partnerShare = Math.min(partnerShare, commission)
  }
  doc.commission_share_amount = partnerShare
  const officeNetCommission = +(commission - partnerShare).toFixed(2)
  // v3.88.4 — F-007: the partner-commission line must post to the partner's LEAF account
  const partnerDoc = (partnerShare > 0 && doc.commission_partner_id)
    ? await db.collection(doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients').findOne({ id: doc.commission_partner_id, tenant_id: T })
    : null
  // v3.88.5 — F-007 STRICT: resolve LEAF accounts BEFORE the first write (zero side-effects)
  const boxLeaf = paymentMethod === 'cash' ? partyLeafCode(box) : null
  const cliLeaf = paymentMethod === 'cash' ? null : partyLeafCode(cli)
  const supLeaf = partyLeafCode(sup)
  const partnerLeaf = partnerDoc ? partyLeafCode(partnerDoc) : null
  await db.collection('services').insertOne(doc)
  await updateBalance(db, 'suppliers', { id: sup.id, tenant_id: T }, b.currency, cost)
  if (partnerShare > 0 && doc.commission_partner_id) {
    const col = doc.commission_partner_type === 'supplier' ? 'suppliers' : 'clients'
    await updateBalance(db, col, { id: doc.commission_partner_id, tenant_id: T }, b.currency, -partnerShare)
  }
  const lines = []
  if (paymentMethod === 'cash') {
    await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, b.currency, sale)
    lines.push({ account_code: boxLeaf, account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: sale, credit: 0 })
  } else {
    await updateBalance(db, 'clients', { id: cli.id, tenant_id: T }, b.currency, sale)
    lines.push({ account_code: cliLeaf, account_name: 'حساب القبض', party_type: 'client', party_id: cli.id, party_name: cli.name, debit: sale, credit: 0 })
  }
  lines.push({ account_code: supLeaf, account_name: 'الموردون', party_type: 'supplier', party_id: sup.id, party_name: sup.name, debit: 0, credit: cost })
  if (officeNetCommission !== 0) {
    lines.push({ account_code: COA.REV_SERVICES, account_name: 'إيرادات خدمات إضافية', party_type: 'revenue', party_id: null, party_name: `إيرادات ${doc.service_type}`, debit: 0, credit: officeNetCommission })
  }
  if (partnerShare > 0) {
    lines.push({ account_code: partnerLeaf, account_name: doc.commission_partner_type === 'supplier' ? 'الموردون' : 'العملاء', party_type: doc.commission_partner_type, party_id: doc.commission_partner_id, party_name: doc.commission_partner_name || 'شريك عمولة', debit: 0, credit: partnerShare })
  }
  await createJournalEntry(db, T, {
    date: doc.date, description: `${opts.existingId ? 'تعديل ' : ''}${doc.service_type} ${paymentMethod === 'cash' ? '(نقد)' : '(آجل)'} — ${doc.beneficiary_name || cli?.name || doc.client_name || sup.name}${partnerShare > 0 ? ` — عمولة مشتركة ${partnerShare} مع ${doc.commission_partner_name}` : ''}`,
    ref_type: 'service', ref_id: doc.id, currency: b.currency, lines,
  }, { skipQuota: !!opts.skipQuota })
  const { _id, ...rest } = doc; return { doc: rest }
}

async function createVoucher(db, T, b, opts = {}) {
  if (isFutureDocDate(b.date)) return { error: `${FUTURE_DOC_DATE_MSG} (تاريخ السند)` } // v3.80
  if (!['receipt', 'payment'].includes(b.type)) return { error: 'نوع السند غير صالح' }
  if (!CURRENCIES.includes(b.currency)) return { error: 'عملة غير صالحة' }
  const amount = Number(b.amount) || 0
  if (Number(b.amount) < 0) return { error: 'لا يُسمح بمبلغ سالب في السند' }
  if (amount <= 0) return { error: 'المبلغ يجب أن يكون أكبر من صفر' }
  // v4.6 — RAH-ACC: vouchers had NO closed year/period check at all before their writes —
  // the central gate then threw AFTER the voucher + balances were written (partial state).
  // Fail-fast here + journal quota preflight (no partial state on 402 either).
  const perrVc = await assertOpenPeriod(db, T, b.date)
  if (perrVc) return { error: perrVc }
  if (!opts.skipQuota) { try { await assertJournalQuota(db, T) } catch (e) { return { error: e.message } } }
  let partyName = ''
  let partyDoc = null // v3.88.4 — F-007: keep the party doc to post to its LEAF account
  let coaAccount = null // v3.79 — real COA account for expense/revenue vouchers
  if (b.party_type === 'client') {
    const c = await db.collection('clients').findOne({ id: b.party_id, tenant_id: T })
    if (!c) return { error: 'العميل غير موجود' }; partyName = c.name; partyDoc = c
  } else if (b.party_type === 'supplier') {
    const s = await db.collection('suppliers').findOne({ id: b.party_id, tenant_id: T })
    if (!s) return { error: 'المورد غير موجود' }; partyName = s.name; partyDoc = s
  } else if (b.party_type === 'expense') {
    if (b.type !== 'payment') return { error: 'المصروف متاح في سند الصرف فقط' }
    // v3.79 — expense MUST be a real account from the chart of accounts (not free text).
    // Legacy fallback (old records being re-created on edit) keeps the generic 5101 line.
    if (b.coa_account_code) {
      coaAccount = await db.collection('accounts').findOne({ tenant_id: T, code: String(b.coa_account_code) })
      if (!coaAccount) return { error: 'حساب المصروف غير موجود في دليل الحسابات' }
      if (coaAccount.type !== 'expense') return { error: `الحساب "${coaAccount.name_ar}" ليس حساب مصروف` }
      if (coaAccount.is_group) return { error: 'اختر حساب مصروف فرعياً — الحساب الأب للتصنيف فقط ولا تُسجل عليه حركة' }
      partyName = coaAccount.name_ar
    } else if (!opts.existingId) {
      // v3.88.4 — U-012: a NEW expense voucher must post to a REAL postable expense
      // account from the chart — a text description alone is no longer accepted.
      return { error: 'اختر حساب المصروف من دليل الحسابات — لا يكفي كتابة وصف نصي، ويُمنع اختيار حساب مجموعة' }
    } else {
      partyName = b.party_name || 'مصروف تشغيلي'
    }
  } else if (b.party_type === 'revenue') {
    if (b.type !== 'receipt') return { error: 'الإيراد متاح في سند القبض فقط' }
    // v3.79 — revenue MUST be a real account from the chart of accounts
    coaAccount = await db.collection('accounts').findOne({ tenant_id: T, code: String(b.coa_account_code || '') })
    if (!coaAccount) return { error: 'حساب الإيراد غير موجود في دليل الحسابات' }
    if (coaAccount.type !== 'revenue') return { error: `الحساب "${coaAccount.name_ar}" ليس حساب إيراد` }
    if (coaAccount.is_group) return { error: 'اختر حساب إيراد فرعياً — الحساب الأب للتصنيف فقط ولا تُسجل عليه حركة' }
    partyName = coaAccount.name_ar
  } else return { error: 'الطرف غير صالح' }
  const box = await db.collection('boxes').findOne({ id: b.box_id, tenant_id: T })
  if (!box) return { error: 'الصندوق/البنك غير موجود' }
  const doc = {
    id: opts.existingId || uuidv4(), tenant_id: T, type: b.type, date: new Date(b.date || Date.now()),
    currency: b.currency, amount, party_type: b.party_type, party_id: b.party_id || null,
    party_name: partyName, box_id: box.id, box_name: box.name_ar,
    coa_account_code: coaAccount?.code || null, coa_account_name: coaAccount?.name_ar || null, // v3.79
    method: b.method || (box.type === 'cash' ? 'صندوق' : 'بنك'),
    description: b.description || '', created_at: opts.createdAt || new Date(),
    ...(opts.existingId ? { updated_at: new Date() } : {}),
  }
  // v3.88.5 — F-007 STRICT: resolve LEAF accounts BEFORE the first write (zero side-effects)
  const boxLeafV = partyLeafCode(box)
  const partyLeafV = partyDoc ? partyLeafCode(partyDoc) : null
  await db.collection('vouchers').insertOne(doc)
  if (b.type === 'receipt') {
    await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, b.currency, +amount)
    if (b.party_type === 'client') await updateBalance(db, 'clients', { id: b.party_id, tenant_id: T }, b.currency, -amount)
    if (b.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: b.party_id, tenant_id: T }, b.currency, +amount)
  } else {
    await updateBalance(db, 'boxes', { id: box.id, tenant_id: T }, b.currency, -amount)
    if (b.party_type === 'supplier') await updateBalance(db, 'suppliers', { id: b.party_id, tenant_id: T }, b.currency, -amount)
    if (b.party_type === 'client') await updateBalance(db, 'clients', { id: b.party_id, tenant_id: T }, b.currency, +amount)
  }
  const lines = []
  const boxAccCode = boxLeafV // v3.88.5 — F-007 STRICT (pre-resolved before any write)
  if (b.type === 'receipt') {
    lines.push({ account_code: boxAccCode, account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: amount, credit: 0 })
    if (b.party_type === 'client') lines.push({ account_code: partyLeafV, account_name: 'العملاء', party_type: 'client', party_id: b.party_id, party_name: partyName, debit: 0, credit: amount })
    if (b.party_type === 'supplier') lines.push({ account_code: partyLeafV, account_name: 'الموردون', party_type: 'supplier', party_id: b.party_id, party_name: partyName, debit: 0, credit: amount })
    // v3.79 — revenue posts to the SELECTED revenue account (statement-able independent account)
    if (b.party_type === 'revenue') lines.push({ account_code: coaAccount.code, account_name: coaAccount.name_ar, party_type: 'account', party_id: coaAccount.id, party_name: coaAccount.name_ar, debit: 0, credit: amount })
    if (b.party_type === 'expense') lines.push({ account_code: COA.REV_SERVICES, account_name: 'إيراد متنوع', party_type: 'revenue', party_id: null, party_name: 'إيراد متنوع', debit: 0, credit: amount })
  } else {
    if (b.party_type === 'supplier') lines.push({ account_code: partyLeafV, account_name: 'الموردون', party_type: 'supplier', party_id: b.party_id, party_name: partyName, debit: amount, credit: 0 })
    if (b.party_type === 'client') lines.push({ account_code: partyLeafV, account_name: 'العملاء', party_type: 'client', party_id: b.party_id, party_name: partyName, debit: amount, credit: 0 })
    // v3.79 — expense posts to the SELECTED expense account; legacy free-text keeps generic 5101
    if (b.party_type === 'expense') {
      if (coaAccount) lines.push({ account_code: coaAccount.code, account_name: coaAccount.name_ar, party_type: 'account', party_id: coaAccount.id, party_name: coaAccount.name_ar, debit: amount, credit: 0 })
      else lines.push({ account_code: COA.OPEX, account_name: 'مصاريف تشغيلية', party_type: 'expense', party_id: null, party_name: partyName, debit: amount, credit: 0 })
    }
    lines.push({ account_code: boxAccCode, account_name: box.name_ar, party_type: 'box', party_id: box.id, party_name: box.name_ar, debit: 0, credit: amount })
  }
  await createJournalEntry(db, T, {
    date: doc.date,
    description: (b.type === 'receipt' ? 'سند قبض — ' : 'سند صرف — ') + (doc.description || partyName),
    ref_type: b.type === 'receipt' ? 'receipt' : 'payment', ref_id: doc.id, currency: b.currency, lines,
  }, { skipQuota: !!opts.skipQuota })
  const { _id, ...rest } = doc; return { doc: rest }
}

async function resolveAccountRef(db, T, ref) {
  if (!ref || !ref.id) return null
  if (ref.kind === 'client') {
    const d = await db.collection('clients').findOne({ id: ref.id, tenant_id: T })
    return d ? { kind: 'client', id: d.id, name: d.name, code: partyLeafCode(d, COA.CLIENTS), updateBalance: true, collection: 'clients', debitSign: +1 } : null
  }
  if (ref.kind === 'supplier') {
    const d = await db.collection('suppliers').findOne({ id: ref.id, tenant_id: T })
    return d ? { kind: 'supplier', id: d.id, name: d.name, code: partyLeafCode(d, COA.SUPPLIERS), updateBalance: true, collection: 'suppliers', debitSign: -1 } : null
  }
  if (ref.kind === 'box') {
    const d = await db.collection('boxes').findOne({ id: ref.id, tenant_id: T })
    return d ? { kind: 'box', id: d.id, name: d.name_ar, code: partyLeafCode(d, d.type === 'cash' ? COA.CASHBOXES : COA.BANKS), updateBalance: true, collection: 'boxes', debitSign: +1 } : null
  }
  if (ref.kind === 'account') {
    const d = await db.collection('accounts').findOne({ id: ref.id, tenant_id: T })
    return d ? { kind: 'account', id: d.id, name: d.name_ar || d.name, code: d.code, updateBalance: false, collection: 'accounts', debitSign: +1 } : null
  }
  return null
}

async function createFx(db, T, b, opts = {}) {
  if (isFutureDocDate(b.date)) return { error: `${FUTURE_DOC_DATE_MSG} (تاريخ عملية الصرافة)` } // v3.80
  // v4.5 — FAIL-FAST before box/party balance side effects (Priority 13)
  const perrFx = await assertOpenPeriod(db, T, b.date)
  if (perrFx) return { error: perrFx }
  if (!opts.skipQuota) { try { await assertJournalQuota(db, T) } catch (e) { return { error: e.message } } }
  if (!['buy', 'sell'].includes(b.type)) return { error: 'نوع العملية غير صالح' }
  if (!CURRENCIES.includes(b.currency) || !CURRENCIES.includes(b.counter_currency)) return { error: 'العملات غير صالحة' }
  if (b.currency === b.counter_currency) return { error: 'يجب اختيار عملتين مختلفتين' }
  const amount = Number(b.amount) || 0
  const rate = Number(b.exchange_rate) || 0
  if (Number(b.amount) < 0 || Number(b.exchange_rate) < 0) return { error: 'لا يُسمح بقيم سالبة في المبلغ أو سعر الصرف' }
  if (amount <= 0 || rate <= 0) return { error: 'المبلغ وسعر الصرف مطلوبان' }
  const counter_amount = +(amount * rate).toFixed(2)
  const payment_method = b.payment_method === 'account' ? 'account' : 'cash'
  // Resolve refs — 'cash' uses box_currency_id/box_counter_id; 'account' uses currency_ref/counter_ref (or falls back)
  const refCur = b.currency_ref ? { kind: b.currency_ref.kind, id: b.currency_ref.id } : { kind: 'box', id: b.box_currency_id }
  const refCounter = b.counter_ref ? { kind: b.counter_ref.kind, id: b.counter_ref.id } : { kind: 'box', id: b.box_counter_id }
  const accCur = await resolveAccountRef(db, T, refCur)
  const accCounter = await resolveAccountRef(db, T, refCounter)
  if (!accCur || !accCounter) return { error: payment_method === 'cash' ? 'اختر صناديق العملتين' : 'اختر الحسابين للطرفين' }
  const rates = (await db.collection('tenant_settings').findOne({ tenant_id: T }))?.rates || DEFAULT_RATES
  // v3.88.4 — F-004: sanity-check the rate against the registered reference range BEFORE
  // accepting the exchange. Base pairs use the currency's own min/max; cross pairs are
  // compared to the implied cross of the two transfer rates (±10%). A wildly deviant
  // rate is blocked with a clear message instead of silently producing huge FX losses.
  const FX_TOLERANCE = 0.10
  const fxBoundsErr = (() => {
    const r1 = rates[b.currency] || {}, r2 = rates[b.counter_currency] || {}
    if (b.counter_currency === BASE_CURRENCY) {
      const mn = Number(r1.min) || 0, mx = Number(r1.max) || 0
      if (mn > 0 && rate < mn) return `سعر الصرف ${rate} أقل من الحد الأدنى المسجل (${mn}) لعملة ${b.currency}`
      if (mx > 0 && rate > mx) return `سعر الصرف ${rate} أعلى من الحد الأعلى المسجل (${mx}) لعملة ${b.currency}`
    } else if (b.currency === BASE_CURRENCY) {
      const inv = rate > 0 ? 1 / rate : 0
      const mn = Number(r2.min) || 0, mx = Number(r2.max) || 0
      if (mn > 0 && inv < mn) return `السعر الضمني ${inv.toFixed(4)} أقل من الحد الأدنى المسجل (${mn}) لعملة ${b.counter_currency}`
      if (mx > 0 && inv > mx) return `السعر الضمني ${inv.toFixed(4)} أعلى من الحد الأعلى المسجل (${mx}) لعملة ${b.counter_currency}`
    } else {
      const t1 = Number(r1.transfer) || 0, t2 = Number(r2.transfer) || 0
      if (t1 > 0 && t2 > 0) {
        const implied = t1 / t2
        if (implied > 0 && Math.abs(rate - implied) / implied > FX_TOLERANCE) return `سعر الصرف ${rate} منحرف أكثر من ${FX_TOLERANCE * 100}% عن السعر المرجعي (${implied.toFixed(4)}) للزوج ${b.currency}/${b.counter_currency}`
      }
    }
    return null
  })()
  if (fxBoundsErr && !b.allow_rate_override) return { error: `⚠️ ${fxBoundsErr} — صحّح السعر أو حدّث نطاقات أسعار الصرف من الإعدادات أولاً` }
  const inBase = toBase(amount, b.currency, rates)
  const outBase = toBase(counter_amount, b.counter_currency, rates)
  const fx_gain_base = +(b.type === 'buy' ? (inBase - outBase) : (outBase - inBase)).toFixed(4)
  const doc = {
    id: opts.existingId || uuidv4(), tenant_id: T, type: b.type,
    date: new Date(b.date || Date.now()),
    currency: b.currency, amount, exchange_rate: rate,
    counter_currency: b.counter_currency, counter_amount,
    payment_method,
    // Backwards-compat + new schema
    box_currency_id: accCur.id, box_currency_name: accCur.name,
    box_counter_id: accCounter.id, box_counter_name: accCounter.name,
    currency_ref: { kind: accCur.kind, id: accCur.id, name: accCur.name, code: accCur.code },
    counter_ref: { kind: accCounter.kind, id: accCounter.id, name: accCounter.name, code: accCounter.code },
    customer_name: b.customer_name || '',
    customer_phone: b.customer_phone || '',
    id_type: b.id_type || '',
    id_number: b.id_number || '',
    source_of_funds: b.source_of_funds || '',
    purpose: b.purpose || '',
    remarks: b.remarks || '',
    fx_gain_base, fx_gain_usd: fx_gain_base,
    created_at: opts.createdAt || new Date(),
    ...(opts.existingId ? { updated_at: new Date() } : {}),
  }
  // v3.88.4 — F-004: an exchange can never drive a box below zero — the paying side
  // must hold enough balance in the paid currency (clients/suppliers/COA refs are exempt).
  const fxPayRef = b.type === 'buy' ? accCounter : accCur
  const fxPayCcy = b.type === 'buy' ? b.counter_currency : b.currency
  const fxPayAmt = b.type === 'buy' ? counter_amount : amount
  if (fxPayRef.kind === 'box') {
    const payBox = await db.collection('boxes').findOne({ id: fxPayRef.id, tenant_id: T })
    const payBal = Number(payBox?.balances?.[fxPayCcy]) || 0
    if (payBal - fxPayAmt < -0.005) return { error: `رصيد الصندوق "${fxPayRef.name}" بعملة ${fxPayCcy} (${payBal.toLocaleString()}) لا يكفي لدفع ${fxPayAmt.toLocaleString()} — لا يُسمح برصيد صندوق سالب في الصرافة` }
  }
  await db.collection('currency_exchanges').insertOne(doc)
  // Balance updates — only for accounts that track balances (client/supplier/box); COA accounts skip.
  // Buy: office receives `amount currency` (debit refCur), pays `counter_amount counter_currency` (credit refCounter)
  // Sell: opposite
  const debitAmtCur = b.type === 'buy' ? amount : -amount
  const debitAmtCounter = b.type === 'buy' ? -counter_amount : counter_amount
  if (accCur.updateBalance) {
    await updateBalance(db, accCur.collection, { id: accCur.id, tenant_id: T }, b.currency, debitAmtCur * accCur.debitSign)
  }
  if (accCounter.updateBalance) {
    await updateBalance(db, accCounter.collection, { id: accCounter.id, tenant_id: T }, b.counter_currency, debitAmtCounter * accCounter.debitSign)
  }
  const lines = []
  if (b.type === 'buy') {
    lines.push({ account_code: accCur.code, account_name: accCur.name, party_type: accCur.kind, party_id: accCur.id, party_name: accCur.name, currency: b.currency, debit: amount, credit: 0 })
    lines.push({ account_code: accCounter.code, account_name: accCounter.name, party_type: accCounter.kind, party_id: accCounter.id, party_name: accCounter.name, currency: b.counter_currency, debit: 0, credit: counter_amount })
  } else {
    lines.push({ account_code: accCounter.code, account_name: accCounter.name, party_type: accCounter.kind, party_id: accCounter.id, party_name: accCounter.name, currency: b.counter_currency, debit: counter_amount, credit: 0 })
    lines.push({ account_code: accCur.code, account_name: accCur.name, party_type: accCur.kind, party_id: accCur.id, party_name: accCur.name, currency: b.currency, debit: 0, credit: amount })
  }
  if (Math.abs(fx_gain_base) > 0.005) {
    if (fx_gain_base > 0) {
      lines.push({ account_code: COA.FX_PNL, account_name: 'أرباح فروق العملات', party_type: 'revenue', party_id: null, party_name: 'أرباح فروق العملات', currency: BASE_CURRENCY, debit: 0, credit: +fx_gain_base.toFixed(2) })
    } else {
      lines.push({ account_code: COA.FX_PNL, account_name: 'خسائر فروق العملات', party_type: 'revenue', party_id: null, party_name: 'خسائر فروق العملات', currency: BASE_CURRENCY, debit: +Math.abs(fx_gain_base).toFixed(2), credit: 0 })
    }
  }
  await createJournalEntry(db, T, {
    date: doc.date,
    description: `${opts.existingId ? 'تعديل ' : ''}${b.type === 'buy' ? 'شراء عملة' : 'بيع عملة'} — ${amount} ${b.currency} @ ${rate} ${b.counter_currency}${doc.customer_name ? ' — ' + doc.customer_name : ''}${payment_method === 'account' ? ' [حساب]' : ''}`,
    ref_type: b.type === 'buy' ? 'fx_buy' : 'fx_sell',
    ref_id: doc.id, currency: 'MULTI', lines,
  }, { skipQuota: !!opts.skipQuota })
  const { _id, ...rest } = doc; return { doc: rest }
}

async function createManualJournal(db, T, b, opts = {}) {
  if (isFutureDocDate(b.date)) return { error: `${FUTURE_DOC_DATE_MSG} (تاريخ القيد)` } // v3.80
  // v4.5 — FAIL-FAST before ANY cached-balance side effect (Priority 13): period/year
  // guard + journal quota are verified here so "balance updated but journal failed"
  // can no longer happen through this path.
  const perr0 = await assertOpenPeriod(db, T, b.date)
  if (perr0) return { error: perr0 }
  if (!opts.skipQuota) { try { await assertJournalQuota(db, T) } catch (e) { return { error: e.message } } }
  // v4.8 — PR#18-1: (a) the FINAL journal lines are dry-run through the central gate
  // (enforceJournalInvariants — accounts/tenant/group/inactive/currency/base-balance/period)
  // BEFORE any cached-balance effect; (b) every balance effect of THIS attempt is tracked,
  // so a residual gate failure (true race only) compensates exactly what was applied —
  // once, in reverse order, never a double reversal — and NEVER claims success if the
  // compensation itself did not complete. Multi-currency/FX engine logic untouched.
  const appliedFx = []
  const applyTracked = async (col, pid, cur, delta) => {
    await updateBalance(db, col, { id: pid, tenant_id: T }, cur, delta)
    appliedFx.push({ col, pid, cur, delta })
  }
  const rollbackApplied = async () => {
    for (const a of [...appliedFx].reverse()) await updateBalance(db, a.col, { id: a.pid, tenant_id: T }, a.cur, -a.delta)
  }
  // Modes:
  //  A) single: { date, currency, description, lines: [...] }
  //  B) dual:   { date, description, dual: true, debit_*, credit_* }
  if (b.dual) {
    const da = Number(b.debit_amount) || 0
    const ca = Number(b.credit_amount) || 0
    if (da < 0 || ca < 0) return { error: 'لا يُسمح بقيم سالبة في المبالغ' }
    if (da <= 0 || ca <= 0) return { error: 'المبالغ يجب أن تكون أكبر من صفر' }
    if (!CURRENCIES.includes(b.debit_currency) || !CURRENCIES.includes(b.credit_currency)) return { error: 'العملات غير صالحة' }
    // v3.10.0 strict — both sides MUST have registered account_code
    if (!b.debit_account_code || !b.credit_account_code) return { error: 'عذراً، يجب اختيار حساب معتمد من دليل الحسابات لكلا الطرفين' }
    // v3.10.0 — validate account codes exist
    const preLines = [
      { account_code: b.debit_account_code, debit: da, credit: 0 },
      { account_code: b.credit_account_code, debit: 0, credit: ca },
    ]
    const v = await validateJournalLines(db, T, preLines)
    if (!v.ok) return { error: v.error }
    const rates = (await db.collection('tenant_settings').findOne({ tenant_id: T }))?.rates || DEFAULT_RATES
    const debitInBase = toBase(da, b.debit_currency, rates)
    const creditInBase = toBase(ca, b.credit_currency, rates)
    const fxDiff = +(debitInBase - creditInBase).toFixed(4)
    const lines = [
      { account_code: b.debit_account_code || 'MANUAL', account_name: b.debit_account_name || 'حساب مدين', party_type: b.debit_party_type || 'manual', party_id: b.debit_party_id || null, party_name: b.debit_party_name || b.debit_account_name || '—', currency: b.debit_currency, debit: da, credit: 0 },
      { account_code: b.credit_account_code || 'MANUAL', account_name: b.credit_account_name || 'حساب دائن', party_type: b.credit_party_type || 'manual', party_id: b.credit_party_id || null, party_name: b.credit_party_name || b.credit_account_name || '—', currency: b.credit_currency, debit: 0, credit: ca },
    ]
    if (Math.abs(fxDiff) > 0.005) {
      if (fxDiff > 0) lines.push({ account_code: COA.FX_PNL, account_name: 'أرباح فروق العملات', party_type: 'revenue', party_id: null, party_name: 'أرباح فروق العملات', currency: BASE_CURRENCY, debit: 0, credit: +fxDiff.toFixed(2) })
      else lines.push({ account_code: COA.FX_PNL, account_name: 'خسائر فروق العملات', party_type: 'revenue', party_id: null, party_name: 'خسائر فروق العملات', currency: BASE_CURRENCY, debit: +Math.abs(fxDiff).toFixed(2), credit: 0 })
    }
    // v4.8 — PR#18-1: full central-gate DRY-RUN on the FINAL lines BEFORE any balance effect
    // (rejecting e.g. an inactive account can no longer leave a changed balance without a journal)
    try {
      await enforceJournalInvariants(db, T, { date: b.date, currency: 'MULTI', lines })
    } catch (e) { return { error: e.message } }
    try {
      for (const side of ['debit', 'credit']) {
        const pt = b[`${side}_party_type`], pid = b[`${side}_party_id`], cur = b[`${side}_currency`]
        const amt = side === 'debit' ? da : ca
        if (pt === 'client' && pid) await applyTracked('clients', pid, cur, side === 'debit' ? amt : -amt)
        if (pt === 'supplier' && pid) await applyTracked('suppliers', pid, cur, side === 'debit' ? -amt : amt)
        if (pt === 'box' && pid) await applyTracked('boxes', pid, cur, side === 'debit' ? amt : -amt)
      }
      const je = await createJournalEntry(db, T, {
        date: b.date, description: (opts.existingId ? 'تعديل — ' : '') + (b.description || 'سند قيد ثنائي (مصارفة/تسوية)'),
        ref_type: 'manual_dual', ref_id: opts.existingId || uuidv4(), currency: 'MULTI', lines,
      }, { skipQuota: !!opts.skipQuota, existingJeId: opts.existingId, createdAt: opts.createdAt, actor: opts.actor, source: 'manual_journal' })
      return { doc: { ...je, _id: undefined, fx_diff_usd: fxDiff } }
    } catch (e) {
      // v4.8.1 — PR#18-2: EXPLICIT machine-readable state for callers (PUT edit path).
      // commit_uncertain → the journal MAY be saved (same id in edit mode): NO automatic
      // compensation — reversing balances for a possibly-saved journal corrupts the books.
      if (e?.jePhase === 'commit_uncertain') {
        return { error: `⛔ حالة حفظ القيد غير مؤكدة (${e?.message}) — لم يُنفذ أي تعويض تلقائي حتى لا تُعكس أرصدة قيد ربما حُفظ؛ لا تُعد المحاولة — يلزم فحص يدوي فوري`, unsafe_state: 'uncertain', no_retry: true }
      }
      try { await rollbackApplied() } catch (rbErr) {
        return { error: `⛔ فشل القيد (${e?.message}) وتعذر اكتمال التراجع الآلي عن آثار المحاولة (${rbErr?.message}) — يلزم فحص يدوي فوري للأرصدة`, unsafe_state: 'partial', no_retry: true }
      }
      return { error: e?.message || 'فشل غير متوقع أثناء إنشاء القيد' }
    }
  }
  // Single-currency manual JE
  if (!CURRENCIES.includes(b.currency)) return { error: 'عملة غير صالحة' }
  const lines = Array.isArray(b.lines) ? b.lines : []
  if (lines.length < 2) return { error: 'يجب إدخال طرفين على الأقل' }
  // v3.10.0 — reject negative + verify accounts exist
  const v = await validateJournalLines(db, T, lines)
  if (!v.ok) return { error: v.error }
  const totalD = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalC = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  if (Math.abs(totalD - totalC) > 0.01) return { error: `القيد غير متوازن: مدين ${totalD.toFixed(2)} ≠ دائن ${totalC.toFixed(2)}` }
  // v4.8 — PR#18-1: build the EXACT final lines first, dry-run them through the central
  // gate, and only then touch balances (tracked) — identical parity with createJournalEntry.
  const mappedLines = lines.map(l => ({
    account_code: l.account_code || 'MANUAL', account_name: l.account_name || '—',
    party_type: l.party_type || 'manual', party_id: l.party_id || null, party_name: l.party_name || l.account_name || '—',
    currency: b.currency,
    debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
  }))
  try {
    await enforceJournalInvariants(db, T, { date: b.date, currency: b.currency, lines: mappedLines })
  } catch (e) { return { error: e.message } }
  try {
    for (const l of lines) {
      const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0
      const delta = debit - credit
      if (l.party_type === 'client' && l.party_id) await applyTracked('clients', l.party_id, b.currency, delta)
      if (l.party_type === 'supplier' && l.party_id) await applyTracked('suppliers', l.party_id, b.currency, -delta)
      if (l.party_type === 'box' && l.party_id) await applyTracked('boxes', l.party_id, b.currency, delta)
    }
    const je = await createJournalEntry(db, T, {
      date: b.date, description: (opts.existingId ? 'تعديل — ' : '') + (b.description || 'قيد يومية يدوي'),
      ref_type: 'manual', ref_id: opts.existingId || uuidv4(), currency: b.currency,
      lines: mappedLines,
    }, { skipQuota: !!opts.skipQuota, existingJeId: opts.existingId, createdAt: opts.createdAt, actor: opts.actor, source: 'manual_journal' })
    return { doc: { ...je, _id: undefined } }
  } catch (e) {
    // v4.8.1 — PR#18-2: EXPLICIT machine-readable state for callers (PUT edit path).
    if (e?.jePhase === 'commit_uncertain') {
      return { error: `⛔ حالة حفظ القيد غير مؤكدة (${e?.message}) — لم يُنفذ أي تعويض تلقائي حتى لا تُعكس أرصدة قيد ربما حُفظ؛ لا تُعد المحاولة — يلزم فحص يدوي فوري`, unsafe_state: 'uncertain', no_retry: true }
    }
    try { await rollbackApplied() } catch (rbErr) {
      return { error: `⛔ فشل القيد (${e?.message}) وتعذر اكتمال التراجع الآلي عن آثار المحاولة (${rbErr?.message}) — يلزم فحص يدوي فوري للأرصدة`, unsafe_state: 'partial', no_retry: true }
    }
    return { error: e?.message || 'فشل غير متوقع أثناء إنشاء القيد' }
  }
}

async function computeDashboard(db, T) {
  const now = new Date()
  const todayStart = bizDayStart(bizTodayISO()) // v3.88.4 — U-001/U-014: business-TZ day boundary
  const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30)
  const tf = { tenant_id: T }
  const rates = (await db.collection('tenant_settings').findOne(tf))?.rates || DEFAULT_RATES

  const [ticketsToday, visasToday, servicesToday, ticketsMonth, visasMonth, servicesMonth, vouchersTodayCount, fxTodayCount] = await Promise.all([
    db.collection('tickets').find({ ...tf, date: { $gte: todayStart } }).toArray(),
    db.collection('visas').find({ ...tf, date: { $gte: todayStart } }).toArray(),
    db.collection('services').find({ ...tf, date: { $gte: todayStart } }).toArray(),
    db.collection('tickets').find({ ...tf, date: { $gte: monthAgo } }).toArray(),
    db.collection('visas').find({ ...tf, date: { $gte: monthAgo } }).toArray(),
    db.collection('services').find({ ...tf, date: { $gte: monthAgo } }).toArray(),
    db.collection('vouchers').countDocuments({ ...tf, date: { $gte: todayStart } }),
    db.collection('currency_exchanges').countDocuments({ ...tf, date: { $gte: todayStart } }),
  ])
  const kpiSales = { USD: 0, SAR: 0, YER: 0 }, kpiProfit = { USD: 0, SAR: 0, YER: 0 }
  for (const t of [...ticketsToday, ...visasToday, ...servicesToday]) { kpiSales[t.currency] += t.sale_price || 0; kpiProfit[t.currency] += t.commission || 0 }
  const dayMap = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
    const key = d.toISOString().slice(0, 10); dayMap[key] = { date: key, sales: 0, profit: 0 }
  }
  for (const t of [...ticketsMonth, ...visasMonth, ...servicesMonth]) {
    const key = new Date(t.date).toISOString().slice(0, 10)
    if (dayMap[key]) { const r = getTransferRate(rates, t.currency); dayMap[key].sales += (t.sale_price||0)*r; dayMap[key].profit += (t.commission||0)*r }
  }
  for (const k of Object.keys(dayMap)) { dayMap[k].sales = +dayMap[k].sales.toFixed(2); dayMap[k].profit = +dayMap[k].profit.toFixed(2) }
  const pieMap = { 'تذاكر': 0, 'تأشيرات عمرة': 0, 'تأشيرات سياحية/عمل': 0, 'موافقات أمنية': 0, 'حجز فنادق': 0, 'خدمات إضافية': 0, 'أخرى': 0 }
  for (const t of ticketsMonth) pieMap['تذاكر'] += (t.commission||0)*getTransferRate(rates, t.currency)
  for (const v of visasMonth) {
    const st = v.service_type || 'أخرى'
    let key = 'أخرى'
    if (st.includes('عمرة')) key = 'تأشيرات عمرة'
    else if (st.includes('موافق')) key = 'موافقات أمنية'
    else if (st.includes('فندق')) key = 'حجز فنادق'
    else if (st.includes('سياح') || st.includes('عمل')) key = 'تأشيرات سياحية/عمل'
    pieMap[key] += (v.commission||0)*getTransferRate(rates, v.currency)
  }
  for (const s of servicesMonth) {
    const st = s.service_type || 'خدمات إضافية'
    let key = 'خدمات إضافية'
    if (st.includes('فندق')) key = 'حجز فنادق'
    pieMap[key] += (s.commission||0)*getTransferRate(rates, s.currency)
  }

  // v3.0 — Visa expiration alerts: visas within 10 days of expected exit, not yet exited
  const in10Days = new Date(now); in10Days.setDate(in10Days.getDate() + 10)
  const visaAlerts = await db.collection('visas').find({
    tenant_id: T,
    is_exited: { $ne: true },
    expected_exit_date: { $ne: null, $gte: todayStart, $lte: in10Days },
  }).sort({ expected_exit_date: 1 }).limit(50).toArray()
  // Also flag visas that have already passed expected exit
  const overdue = await db.collection('visas').find({
    tenant_id: T,
    is_exited: { $ne: true },
    expected_exit_date: { $ne: null, $lt: todayStart },
  }).sort({ expected_exit_date: 1 }).limit(50).toArray()
  const alertRows = await Promise.all([...overdue, ...visaAlerts].map(async v => {
    const exit = new Date(v.expected_exit_date)
    const daysLeft = Math.ceil((exit - now) / 86400000)
    // v3.2 — Resolve phone from client if visa row doesn't have one
    let phone = v.passenger_phone || ''
    let whatsapp = v.passenger_whatsapp || v.passenger_phone || ''
    if (!phone && v.client_id) {
      const c = await db.collection('clients').findOne({ id: v.client_id, tenant_id: T })
      if (c) { phone = c.phone || ''; whatsapp = c.whatsapp || c.phone || '' }
    }
    return {
      id: v.id, service_type: v.service_type, passenger_name: v.passenger_name || v.client_name || '—',
      passport_no: v.passport_no || '', nationality: v.nationality || '',
      client_name: v.client_name, entry_date: v.entry_date, expected_exit_date: v.expected_exit_date,
      passenger_phone: phone, passenger_whatsapp: whatsapp,
      days_left: daysLeft, overdue: daysLeft < 0,
    }
  }))

  const recentTickets = await db.collection('tickets').find(tf).sort({ created_at: -1 }).limit(5).toArray()
  const recentVisas   = await db.collection('visas').find(tf).sort({ created_at: -1 }).limit(5).toArray()
  const recentServices= await db.collection('services').find(tf).sort({ created_at: -1 }).limit(5).toArray()
  const recentVouchers= await db.collection('vouchers').find(tf).sort({ created_at: -1 }).limit(5).toArray()
  const activity = [
    ...recentTickets.map(t => ({ kind: 'ticket', id: t.id, when: t.created_at, title: `تذكرة ${t.pnr || ''} — ${t.client_name}`, subtitle: `${t.route || ''} • ${t.currency} ${t.sale_price}`, amount: t.commission, currency: t.currency })),
    ...recentVisas.map(v => ({ kind: 'visa', id: v.id, when: v.created_at, title: `${v.service_type} — ${v.passenger_name || v.client_name}`, subtitle: `${v.currency} ${v.sale_price}`, amount: v.commission, currency: v.currency })),
    ...recentServices.map(s => ({ kind: 'service', id: s.id, when: s.created_at, title: `${s.service_type} — ${s.beneficiary_name || s.client_name}`, subtitle: `${s.currency} ${s.sale_price}`, amount: s.commission, currency: s.currency })),
    ...recentVouchers.map(x => ({ kind: x.type, id: x.id, when: x.created_at, title: `${x.type === 'receipt' ? 'سند قبض' : 'سند صرف'} — ${x.party_name}`, subtitle: `${x.currency} ${x.amount}`, amount: x.amount, currency: x.currency })),
  ].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 12)
  return {
    kpi: {
      sales_today: kpiSales, profit_today: kpiProfit,
      // v3.88.4 — U-001: the daily movement count now includes ALL financial documents
      // (tickets + visas + services + vouchers + exchanges) so it matches the movements list.
      count_today: ticketsToday.length + visasToday.length + servicesToday.length + vouchersTodayCount + fxTodayCount,
      tickets_today: ticketsToday.length, visas_today: visasToday.length, services_today: servicesToday.length,
      vouchers_today: vouchersTodayCount, fx_today: fxTodayCount,
    },
    line: Object.values(dayMap),
    pie: Object.entries(pieMap).map(([name, value]) => ({ name, value: +value.toFixed(2) })).filter(x => x.value > 0),
    activity,
    visa_alerts: alertRows,
  }
}

async function reportProfits(db, T, q) {
  // v3.88.4 — F-013: refunded/cancelled documents are EXCLUDED — the report reflects the
  // NET activity after cancellation/refund. F-017/U-014: business-TZ (UTC+3) boundaries
  // with string/Date-safe filtering (no data migration).
  const from = q.from ? bizDayStart(q.from) : new Date(0)
  const to = q.to ? bizDayEnd(q.to) : bizDayEnd(bizTodayISO())
  const tf = { tenant_id: T, is_refunded: { $ne: true }, ...dateRangeExpr('date', from, to) }
  const [tickets, visas, services] = await Promise.all([
    db.collection('tickets').find(tf).sort({ date: 1 }).toArray(),
    db.collection('visas').find(tf).sort({ date: 1 }).toArray(),
    db.collection('services').find(tf).sort({ date: 1 }).toArray(),
  ])
  const rows = [
    ...tickets.map(t => ({ id: t.id, kind: 'تذكرة', date: t.date, client: t.client_name, supplier: t.supplier_name, ref: t.pnr || t.route, currency: t.currency, cost: t.cost, sale: t.sale_price, profit: t.commission })),
    ...visas.map(v => ({ id: v.id, kind: v.service_type, date: v.date, client: v.client_name, supplier: v.supplier_name, ref: v.passenger_name || v.passport_no, currency: v.currency, cost: v.cost, sale: v.sale_price, profit: v.commission })),
    ...services.map(s => ({ id: s.id, kind: s.service_type, date: s.date, client: s.client_name, supplier: s.supplier_name, ref: s.beneficiary_name || s.reference_no, currency: s.currency, cost: s.cost, sale: s.sale_price, profit: s.commission })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date))
  const totals = { USD: 0, SAR: 0, YER: 0 }, totalSales = { USD: 0, SAR: 0, YER: 0 }
  for (const r of rows) { totals[r.currency] += r.profit; totalSales[r.currency] += r.sale }
  return { rows, totals_profit: totals, totals_sales: totalSales }
}
async function reportStatement(db, T, q) {
  const { party_type, party_id } = q
  if (!party_type || !party_id) throw new Error('نوع الطرف والمعرف مطلوبان')

  // v3.88.4 — F-016/F-017/U-014: unified business-TZ (UTC+3) day boundaries + string/Date-safe
  // filtering (legacy opening entries stored string dates — $toDate covers both types).
  let startDate = null, endDate = null
  if (q.period === 'day') {
    const d = q.day || bizTodayISO()
    startDate = bizDayStart(d); endDate = bizDayEnd(d)
  } else if (q.period === 'month') {
    const m = q.month || bizTodayISO().slice(0, 7)
    const [y, mo] = m.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate()
    startDate = bizDayStart(`${m}-01`); endDate = bizDayEnd(`${m}-${String(lastDay).padStart(2, '0')}`)
  } else if (q.period === 'range') {
    startDate = q.from ? bizDayStart(q.from) : null
    endDate = q.to ? bizDayEnd(q.to) : bizDayEnd(bizTodayISO())
  } else if (q.period === 'up_to_date' && q.to) {
    endDate = bizDayEnd(q.to)
  }

  // Resolve the party/account FIRST — needed for unified account-code matching (F-009)
  let party = null, acct = null
  if (party_type === 'client') party = await db.collection('clients').findOne({ id: party_id, tenant_id: T })
  else if (party_type === 'supplier') party = await db.collection('suppliers').findOne({ id: party_id, tenant_id: T })
  else if (party_type === 'box') {
    const b = await db.collection('boxes').findOne({ id: party_id, tenant_id: T })
    if (b) party = { id: b.id, name: b.name_ar, phone: '', balances: b.balances, account_code: b.account_code }
  } else if (party_type === 'account') {
    acct = await db.collection('accounts').findOne({ id: party_id, tenant_id: T })
    if (acct) party = { id: acct.id, name: `${acct.code} — ${acct.name_ar || acct.name}`, phone: '', balances: {} }
  }

  // v3.88.4 — F-009: ONE matching rule across Journal/Ledger/Statement/Trial-Balance.
  // Party lines match by (party_type + party_id) OR the party's own leaf account_code.
  // Plain COA accounts match by account_code — the old party_id-only rule returned ZERO
  // for accounts like 5101999 whose lines carry party_type 'account'/'revenue'/'expense'.
  const partyAccountCode = (party && party.account_code) || null
  const matchesLine = (l) => {
    if (party_type === 'account') return !!acct && (l.account_code === acct.code || (l.party_type === 'account' && l.party_id === party_id))
    if (l.party_type === party_type && l.party_id === party_id) return true
    return !!partyAccountCode && l.account_code === partyAccountCode
  }
  const signOf = (l) => {
    if (party_type === 'supplier') return (l.credit || 0) - (l.debit || 0)
    if (party_type === 'account' && acct && ['liability', 'equity', 'revenue'].includes(acct.type)) return (l.credit || 0) - (l.debit || 0)
    return (l.debit || 0) - (l.credit || 0)
  }

  const rows = []
  const run = { USD: 0, SAR: 0, YER: 0 }
  const totals = { USD: { d: 0, c: 0 }, SAR: { d: 0, c: 0 }, YER: { d: 0, c: 0 } }
  const opening = { USD: 0, SAR: 0, YER: 0 }

  // v3.88.4 — F-016: everything BEFORE the period start is the OPENING BALANCE —
  // a period statement never starts from zero when prior activity exists.
  if (startDate) {
    const priorJes = await db.collection('journal_entries').find({ tenant_id: T, ...dateRangeExpr('date', null, new Date(startDate.getTime() - 1)) }).toArray()
    for (const je of priorJes) for (const l of je.lines || []) {
      if (!matchesLine(l)) continue
      const cur = l.currency || je.currency
      if (!['USD', 'SAR', 'YER'].includes(cur)) continue
      opening[cur] += signOf(l)
    }
    for (const c of ['USD', 'SAR', 'YER']) {
      opening[c] = +opening[c].toFixed(2)
      run[c] = opening[c]
      if (Math.abs(opening[c]) >= 0.005) rows.push({ date: startDate, description: 'رصيد سابق (قبل بداية الفترة)', ref_type: 'opening_balance', currency: c, debit: 0, credit: 0, balance: run[c] })
    }
  }

  const rangeExpr = dateRangeExpr('date', startDate, endDate)
  const jes = await db.collection('journal_entries').find({ tenant_id: T, ...(rangeExpr || {}) }).sort({ date: 1, created_at: 1 }).toArray()
  for (const je of jes) {
    for (const l of je.lines || []) {
      if (!matchesLine(l)) continue
      const cur = l.currency || je.currency
      if (!['USD', 'SAR', 'YER'].includes(cur)) continue
      run[cur] += signOf(l)
      totals[cur].d += l.debit || 0
      totals[cur].c += l.credit || 0
      rows.push({ date: je.date, description: je.description, ref_type: je.ref_type, currency: cur, debit: l.debit || 0, credit: l.credit || 0, balance: +run[cur].toFixed(2) })
    }
  }

  // Currency display mode: 'all_summary' | 'all_detail' | 'USD' | 'SAR' | 'YER'
  const mode = q.currency_mode || 'all_detail'
  let finalRows = rows
  if (['USD', 'SAR', 'YER'].includes(mode)) finalRows = rows.filter(r => r.currency === mode)

  // v3.88.4 — F-006/F-014: the summary derives from the SAME ledger rows as the movements
  // (same account, same currency, same date range): opening + movements = closing.
  const summary = CURRENCIES.map(c => ({
    currency: c,
    opening_balance: +(opening[c] || 0).toFixed(2),
    total_debit: +totals[c].d.toFixed(2),
    total_credit: +totals[c].c.toFixed(2),
    balance: +run[c].toFixed(2),
    closing_balance: +run[c].toFixed(2),
  }))

  return {
    party: party ? { id: party.id, name: party.name, phone: party.phone, balances: party.balances } : null,
    rows: mode === 'all_summary' ? [] : finalRows,
    summary, currency_mode: mode, period: q.period || 'all',
  }
}
async function reportTrialBalance(db, T) {
  const jes = await db.collection('journal_entries').find({ tenant_id: T }).toArray()
  const map = {}
  for (const je of jes) {
    for (const l of je.lines || []) {
      const cur = l.currency || je.currency
      const label = l.party_name || l.account_name
      const key = `${l.account_code}|${cur}|${label}`
      if (!map[key]) map[key] = { code: l.account_code, name: l.account_name, party_name: l.party_name, currency: cur, debit: 0, credit: 0 }
      map[key].debit += l.debit || 0; map[key].credit += l.credit || 0
    }
  }
  const rows = Object.values(map).map(r => ({ ...r, balance: r.debit - r.credit }))
  const totals = { USD: { d: 0, c: 0 }, SAR: { d: 0, c: 0 }, YER: { d: 0, c: 0 } }
  for (const r of rows) { if (totals[r.currency]) { totals[r.currency].d += r.debit; totals[r.currency].c += r.credit } }
  return { rows, totals }
}
async function reportIncome(db, T, q) {
  // v3.88.4 — F-012 ROOT-CAUSE REWRITE: the income statement now derives from the JOURNAL
  // (classified 4xxx revenue / 5xxx expense lines) — the single accounting truth — instead
  // of re-summing operational documents, which ignored manual journal entries and expense
  // vouchers posted to real COA accounts. year_close entries are excluded (they zero the
  // year), so a closed year still shows its true activity.
  let from, to
  if (q.year) {
    const yr = parseInt(q.year)
    from = bizDayStart(`${yr}-01-01`); to = bizDayEnd(`${yr}-12-31`)
  } else {
    from = q.from ? bizDayStart(q.from) : new Date(0)
    to = q.to ? bizDayEnd(q.to) : bizDayEnd(bizTodayISO())
  }
  const rates = (await db.collection('tenant_settings').findOne({ tenant_id: T }))?.rates || DEFAULT_RATES
  const jes = await db.collection('journal_entries').find({ tenant_id: T, ref_type: { $ne: 'year_close' }, ...dateRangeExpr('date', from, to) }).toArray()
  const zero = () => ({ USD: 0, SAR: 0, YER: 0 })
  const rev = { tickets: zero(), visas: zero(), services: zero(), other: zero() }
  const exp = zero()
  const expenseAccounts = {} // code → { code, name, per-currency net }
  let fx_gain_base = 0
  for (const je of jes) {
    for (const l of je.lines || []) {
      const code = String(l.account_code || '')
      if (code === COA.FX_PNL) { fx_gain_base += (l.credit || 0) - (l.debit || 0); continue }
      const cur = l.currency || je.currency
      if (!['USD', 'SAR', 'YER'].includes(cur)) continue
      if (code.startsWith('4')) {
        const net = (l.credit || 0) - (l.debit || 0)
        const bucket = code === COA.REV_TICKETS ? 'tickets' : code === COA.REV_VISAS ? 'visas' : code === COA.REV_SERVICES ? 'services' : 'other'
        rev[bucket][cur] += net
      } else if (code.startsWith('5')) {
        const net = (l.debit || 0) - (l.credit || 0)
        exp[cur] += net
        if (!expenseAccounts[code]) expenseAccounts[code] = { code, name: l.account_name || code, USD: 0, SAR: 0, YER: 0 }
        expenseAccounts[code][cur] = +(expenseAccounts[code][cur] + net).toFixed(2)
      }
    }
  }
  for (const bkt of Object.values(rev)) for (const c of ['USD', 'SAR', 'YER']) bkt[c] = +bkt[c].toFixed(2)
  for (const c of ['USD', 'SAR', 'YER']) exp[c] = +exp[c].toFixed(2)
  const totalRevBase = Object.values(rev).reduce((s, cur) => s + Object.entries(cur).reduce((ss, [c, v]) => ss + toBase(v, c, rates), 0), 0) + fx_gain_base
  const totalExpBase = Object.entries(exp).reduce((s, [c, v]) => s + toBase(v, c, rates), 0)
  return {
    base_currency: BASE_CURRENCY,
    source: 'journal', // v3.88.4 — F-012 marker
    revenue: rev, expenses: exp,
    expense_accounts: Object.values(expenseAccounts),
    fx_gain_base: +fx_gain_base.toFixed(2),
    total_revenue_base: +totalRevBase.toFixed(2),
    total_expenses_base: +totalExpBase.toFixed(2),
    net_profit_base: +(totalRevBase - totalExpBase).toFixed(2),
    // Backward compat aliases
    fx_gain_usd: +fx_gain_base.toFixed(2),
    total_revenue_usd: +totalRevBase.toFixed(2),
    total_expenses_usd: +totalExpBase.toFixed(2),
    net_profit_usd: +(totalRevBase - totalExpBase).toFixed(2),
  }
}

// Dedicated HEAD handler — required for UptimeRobot / uptime monitors which prefer HEAD requests.
// For /health, respond immediately without auth. For other paths, delegate to standard handler.
async function handleHead(request, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  if (path === '/api/health' || path.endsWith('/api/health')) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
  return handleRoute(request, ctx)
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
export const HEAD = handleHead
