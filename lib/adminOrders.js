// ============================================================================
// v4.3 — UNIFIED PLATFORM ORDERS + PROGRAM COMMISSIONS LEDGER
// Architectural decision (user-approved):
//   - NO platform_sales collection: program sales are ORDER TYPES inside the
//     single `platform_orders` collection («مركز الطلبات» is the operational
//     registry; «مبيعات رحّال» reads sales-category orders from the SAME source).
//   - `platform_commissions` (approved conditionally): every record links to its
//     platform_orders order and stores a FULL SNAPSHOT (order/office/beneficiary/
//     rule/type/value/basis/amount/currency/status/actor/dates). A UNIQUE index
//     on {order_id, rule_id, beneficiary_key} prevents duplicate commissions.
//   - NO marketers collection: beneficiary = existing user / rahaal staff /
//     office / referral office (beneficiary_key is their existing id/email).
//   - Notifications reuse emitAdminNotification (admin_notifications) — no new
//     notification system. Audit goes to the existing audit_logs collection.
// NO hard delete anywhere: cancel/archive/reverse only.
// ============================================================================
import { v4 as uuidv4 } from 'uuid'
import { emitAdminNotification } from './adminNotify'
import { adminCan } from './adminStaff' // v4.8 — PR#18-2: fine-grained per-action enforcement

async function logAudit(db, sess, category, action, target, before, after, reason) {
  try {
    await db.collection('audit_logs').insertOne({
      id: uuidv4(), category, at: new Date(),
      actor_id: sess?.user?.id || null, actor_email: sess?.user?.email || null,
      action, target, before: before ?? null, after: after ?? null, reason: reason || null,
    })
  } catch { /* audit must never break the operation */ }
}

// ---------- Types & lifecycle ----------
export const ORDER_TYPES = {
  // sales category — «مبيعات رحّال» reads exactly these from the same collection
  new_subscription: { label: 'بيع باقة / اشتراك جديد', category: 'sales', financial: true },
  demo_to_paid: { label: 'تحويل Demo إلى Paid', category: 'sales', financial: true },
  renewal: { label: 'تجديد اشتراك', category: 'sales', financial: true },
  upgrade: { label: 'ترقية / تغيير باقة', category: 'sales', financial: true },
  addon: { label: 'إضافة مدفوعة / منتج', category: 'sales', financial: true },
  // admin category
  limits_change: { label: 'تغيير حدود (مستخدمون/حصة)', category: 'admin', financial: false },
  payment_confirmation: { label: 'تأكيد دفعة', category: 'admin', financial: true },
  cancellation_refund: { label: 'إلغاء / استرداد', category: 'admin', financial: true },
  commission_settlement: { label: 'تسوية عمولة', category: 'admin', financial: true },
  office_admin: { label: 'طلب إداري لمكتب', category: 'admin', financial: false },
  other: { label: 'طلب آخر', category: 'admin', financial: false },
}
export const ORDER_STATUSES = ['new', 'under_review', 'needs_info', 'awaiting_payment', 'awaiting_approval', 'approved', 'rejected', 'executed', 'completed', 'cancelled']
const OPEN_STATUSES = ['new', 'under_review', 'needs_info', 'awaiting_payment', 'awaiting_approval']
// legal transitions (set_status) — approve/reject/cancel have dedicated actions
const TRANSITIONS = {
  new: ['under_review', 'needs_info', 'awaiting_payment', 'awaiting_approval'],
  under_review: ['needs_info', 'awaiting_payment', 'awaiting_approval'],
  needs_info: ['under_review', 'awaiting_payment', 'awaiting_approval'],
  awaiting_payment: ['under_review', 'awaiting_approval'],
  awaiting_approval: ['under_review'],
  approved: ['executed'],
  executed: ['completed'],
}
const STATUS_AR = { new: 'جديد', under_review: 'قيد المراجعة', needs_info: 'يحتاج معلومات', awaiting_payment: 'بانتظار الدفع', awaiting_approval: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', executed: 'منفذ', completed: 'مكتمل', cancelled: 'ملغى' }

let indexesReady = false
let indexesError = null
// v4.8 — PR#18-3: index-creation failures are NO LONGER swallowed as a "race".
// A real failure (e.g. existing duplicate data, options conflict) means the
// duplicate-prevention guarantee is NOT proven — inserts that depend on the
// unique indexes are refused (503) while reads stay available. No index is
// dropped/altered here; the createIndex definitions are the pre-existing ones.
// If the cause is existing duplicate data: BLOCKED — REQUIRES APPROVAL
// (data dedup is a production-data operation and is never attempted from code).
async function ensureIndexes(db) {
  if (indexesReady) return { ok: true }
  try {
    await db.collection('platform_orders').createIndex({ ref: 1 }, { unique: true })
    await db.collection('platform_orders').createIndex({ op_id: 1 }, { unique: true, sparse: true })
    await db.collection('platform_orders').createIndex({ type: 1, status: 1, tenant_id: 1 })
    // duplicate-commission prevention: same order + same rule + same beneficiary = ONE record
    await db.collection('platform_commissions').createIndex({ order_id: 1, rule_id: 1, beneficiary_key: 1 }, { unique: true })
    indexesReady = true
    indexesError = null
    return { ok: true }
  } catch (e) {
    indexesError = e?.message || String(e)
    console.error('[adminOrders] ensureIndexes FAILED — unique-index protection NOT proven:', indexesError)
    return { ok: false, error: indexesError }
  }
}
const INDEX_BLOCK_MSG = () => ({
  error: `⛔ الإنشاء موقوف مؤقتاً: حماية منع التكرار (Unique Index) غير مثبتة — ${indexesError || 'فشل إنشاء الفهارس'}. القراءة متاحة. إن كان السبب بيانات مكررة قائمة فالمعالجة: BLOCKED — REQUIRES APPROVAL`,
  status: 503,
})

async function nextRef(db) {
  const y = new Date().getFullYear()
  const r = await db.collection('platform_settings').findOneAndUpdate(
    { id: 'platform_orders_counter' },
    { $inc: { [`seq_${y}`]: 1 } },
    { upsert: true, returnDocument: 'after' }
  )
  const doc = r?.value || r // driver version differences
  const seq = doc?.[`seq_${y}`] || 1
  return `ORD-${y}-${String(seq).padStart(4, '0')}`
}

const ev = (sess, type, note, extra = {}) => ({ at: new Date(), by: sess.user.email, type, note: String(note || '').slice(0, 400), ...extra })
const isMain = (sess) => sess.user.role === 'super_admin'

// ============================ ORDERS HANDLER ============================
export async function adminOrdersHandler(db, path, method, p, b, sess) {
  const idx = await ensureIndexes(db)
  // v4.8 — PR#18-2: SERVER-SIDE per-action enforcement (never UI-only). adminGate has
  // already bound this route to section «requests» (view for GET / any-write for writes);
  // here each specific action is verified. Main SA keeps full access (can.has → true).
  const can = await adminCan(db, sess)
  const deny = (act) => ({ error: `🚫 غير مصرح — يتطلب هذا الإجراء صلاحية «${act}» في قسم «مركز الطلبات»`, status: 403 })

  if (path === '/types' && method === 'GET') return { types: ORDER_TYPES, statuses: ORDER_STATUSES, status_labels: STATUS_AR }

  if (path === '' && method === 'GET') {
    const f = {}
    if (p.get('category')) {
      const keys = Object.keys(ORDER_TYPES).filter(k => ORDER_TYPES[k].category === p.get('category'))
      f.type = { $in: keys }
    }
    if (p.get('type')) f.type = p.get('type')
    if (p.get('status')) f.status = p.get('status')
    if (p.get('tenant')) f.tenant_id = p.get('tenant')
    if (p.get('assignee')) f.assigned_to = p.get('assignee')
    if (!p.get('archived')) f.archived = { $ne: true }
    const q = (p.get('q') || '').trim()
    if (q) f.$or = [{ ref: { $regex: q, $options: 'i' } }, { title: { $regex: q, $options: 'i' } }, { tenant_name: { $regex: q, $options: 'i' } }]
    const rows = await db.collection('platform_orders').find(f, { projection: { _id: 0, events: 0 } }).sort({ created_at: -1 }).limit(300).toArray()
    const now = Date.now()
    for (const r of rows) r.late = !!(r.due_at && OPEN_STATUSES.includes(r.status) && new Date(r.due_at).getTime() < now)
    return { rows }
  }

  if (path === '' && method === 'POST') {
    if (!can.has('requests', 'create')) return deny('create') // v4.8 — PR#18-2
    if (!idx.ok) return INDEX_BLOCK_MSG() // v4.8 — PR#18-3: ref/op_id uniqueness not proven → no insert
    const type = ORDER_TYPES[b.type] ? b.type : null
    if (!type) return { error: 'نوع الطلب غير معروف' }
    // idempotency: same op_id returns the existing order — never a second one
    if (b.op_id) {
      const dup = await db.collection('platform_orders').findOne({ op_id: String(b.op_id).slice(0, 64) }, { projection: { _id: 0, events: 0 } })
      if (dup) return { success: true, duplicate: true, order: dup }
    }
    let tenant = null
    if (b.tenant_id) tenant = await db.collection('tenants').findOne({ id: b.tenant_id }, { projection: { id: 1, name: 1, plan_tier: 1 } })
    const doc = {
      id: uuidv4(), ref: await nextRef(db), ...(b.op_id ? { op_id: String(b.op_id).slice(0, 64) } : {}),
      type, type_label: ORDER_TYPES[type].label, category: ORDER_TYPES[type].category, financial: ORDER_TYPES[type].financial,
      title: String(b.title || ORDER_TYPES[type].label).slice(0, 200),
      details: String(b.details || '').slice(0, 2000),
      tenant_id: tenant?.id || null, tenant_name: tenant?.name || null,
      plan_key: ['silver', 'gold', 'enterprise'].includes(b.plan_key) ? b.plan_key : null,
      amount: b.amount !== undefined ? Math.max(0, Number(b.amount) || 0) : null,
      currency: String(b.currency || 'USD').toUpperCase().slice(0, 8),
      priority: ['low', 'normal', 'high', 'critical'].includes(b.priority) ? b.priority : 'normal',
      status: 'new', archived: false,
      assigned_to: null, assigned_department: null,
      due_at: b.due_at ? new Date(b.due_at) : null,
      requested_by: b.requested_by ? String(b.requested_by).slice(0, 120) : sess.user.email,
      created_by: sess.user.email, created_at: new Date(), updated_at: new Date(),
      approved_by: null, approved_at: null, rejected_reason: null,
      notes: [], attachments: (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10).map(a => ({ name: String(a.name || '').slice(0, 120), ref: String(a.ref || '').slice(0, 300) })),
      events: [ev(sess, 'created', `أُنشئ الطلب (${ORDER_TYPES[type].label})`)],
    }
    await db.collection('platform_orders').insertOne({ ...doc })
    await logAudit(db, sess, 'orders', 'order_create', { id: doc.id, ref: doc.ref }, null, { type, tenant: doc.tenant_name, amount: doc.amount }, b.reason || 'إنشاء طلب')
    await emitAdminNotification(db, {
      type: 'order_new', title: `طلب جديد ${doc.ref} — ${doc.type_label}`,
      body: `${doc.tenant_name ? `المكتب: ${doc.tenant_name} · ` : ''}${doc.amount ? `المبلغ: ${doc.amount} ${doc.currency} · ` : ''}الأولوية: ${doc.priority}`,
      tenant_id: doc.tenant_id, ref_type: 'platform_order', ref_id: doc.id, dedupe_key: `order_new_${doc.id}`,
    })
    delete doc._id
    return { success: true, order: doc }
  }

  const m = path.match(/^\/([^/]+)$/)
  if (m && method === 'GET') {
    const doc = await db.collection('platform_orders').findOne({ id: m[1] }, { projection: { _id: 0 } })
    if (!doc) return { error: 'الطلب غير موجود', status: 404 }
    const commissions = await db.collection('platform_commissions').find({ order_id: doc.id }, { projection: { _id: 0, events: 0 } }).toArray()
    return { order: doc, commissions }
  }

  if (m && method === 'PATCH') {
    const doc = await db.collection('platform_orders').findOne({ id: m[1] })
    if (!doc) return { error: 'الطلب غير موجود', status: 404 }
    const { action, reason } = b || {}
    // v4.8 — PR#18-2: explicit permission per action (Maker–Checker below stays intact)
    const ORDER_ACTION_PERM = {
      update_draft: 'edit', assign: 'edit', add_note: 'edit', set_status: 'edit',
      approve: 'approve', reject: 'approve',
      cancel: 'manage', execute: 'manage', complete: 'manage', reopen: 'manage', archive: 'manage', unarchive: 'manage',
    }
    const neededPerm = ORDER_ACTION_PERM[action]
    if (!neededPerm) return { error: 'إجراء غير معروف' }
    if (!can.has('requests', neededPerm)) return deny(neededPerm)
    const set = { updated_at: new Date() }
    const push = {}
    const done = async (note, extraAudit) => {
      await db.collection('platform_orders').updateOne({ id: doc.id }, { $set: set, ...(push.events ? { $push: push } : {}) })
      await logAudit(db, sess, 'orders', `order_${action}`, { id: doc.id, ref: doc.ref }, { status: doc.status }, { status: set.status || doc.status, ...extraAudit }, reason)
      return { success: true }
    }

    if (action === 'update_draft') {
      if (!['new', 'needs_info', 'under_review'].includes(doc.status)) return { error: `التعديل متاح للمسودة/قيد المراجعة فقط — الحالة الحالية: ${STATUS_AR[doc.status]}`, status: 409 }
      for (const k of ['title', 'details']) if (b[k] !== undefined) set[k] = String(b[k]).slice(0, k === 'details' ? 2000 : 200)
      if (b.amount !== undefined) set.amount = Math.max(0, Number(b.amount) || 0)
      if (b.currency !== undefined) set.currency = String(b.currency).toUpperCase().slice(0, 8)
      if (b.priority !== undefined && ['low', 'normal', 'high', 'critical'].includes(b.priority)) set.priority = b.priority
      if (b.due_at !== undefined) set.due_at = b.due_at ? new Date(b.due_at) : null
      if (b.plan_key !== undefined) set.plan_key = ['silver', 'gold', 'enterprise'].includes(b.plan_key) ? b.plan_key : null
      push.events = ev(sess, 'updated', reason || 'تعديل بيانات الطلب')
      return done()
    }
    if (!reason) return { error: 'السبب إلزامي لهذا الإجراء' }
    if (action === 'assign') {
      set.assigned_to = b.assignee ? String(b.assignee).slice(0, 120) : null
      set.assigned_department = b.department ? String(b.department).slice(0, 80) : null
      push.events = ev(sess, 'assigned', `تعيين إلى ${set.assigned_to || set.assigned_department || '—'} — ${reason}`)
      return done(null, { assigned_to: set.assigned_to })
    }
    if (action === 'add_note') {
      await db.collection('platform_orders').updateOne({ id: doc.id }, { $push: { notes: { at: new Date(), by: sess.user.email, text: String(b.text || reason).slice(0, 500) }, events: ev(sess, 'note', reason) }, $set: set })
      return { success: true }
    }
    if (action === 'set_status') {
      const to = b.status
      if (!(TRANSITIONS[doc.status] || []).includes(to)) return { error: `انتقال غير مسموح: ${STATUS_AR[doc.status]} ← ${STATUS_AR[to] || to}`, status: 409 }
      set.status = to
      push.events = ev(sess, 'status', `${STATUS_AR[doc.status]} ← ${STATUS_AR[to]} — ${reason}`)
      return done()
    }
    if (action === 'approve') {
      if (!OPEN_STATUSES.includes(doc.status)) return { error: `لا يمكن اعتماد طلب حالته ${STATUS_AR[doc.status]}`, status: 409 }
      // Maker–Checker on financial orders: the creator cannot approve their own
      // order — the MAIN super admin is the only exception (single-admin reality).
      if (doc.financial && doc.created_by === sess.user.email && !isMain(sess)) return { error: 'Maker–Checker: لا يمكن لمقدم الطلب اعتماد طلبه المالي بنفسه', status: 403 }
      set.status = 'approved'; set.approved_by = sess.user.email; set.approved_at = new Date()
      push.events = ev(sess, 'approved', reason)
      const r = await done(null, { approved_by: sess.user.email })
      await emitAdminNotification(db, { type: 'order_event', title: `اعتُمد الطلب ${doc.ref}`, body: `${doc.type_label}${doc.tenant_name ? ` — ${doc.tenant_name}` : ''}`, tenant_id: doc.tenant_id, ref_type: 'platform_order', ref_id: doc.id, dedupe_key: `order_approved_${doc.id}` })
      return r
    }
    if (action === 'reject') {
      if (!OPEN_STATUSES.includes(doc.status)) return { error: `لا يمكن رفض طلب حالته ${STATUS_AR[doc.status]}`, status: 409 }
      set.status = 'rejected'; set.rejected_reason = String(reason).slice(0, 400)
      push.events = ev(sess, 'rejected', reason)
      return done()
    }
    if (action === 'cancel') {
      if (['completed', 'cancelled'].includes(doc.status)) return { error: 'الطلب مكتمل/ملغى بالفعل', status: 409 }
      // financial + approved orders never disappear: cancellation is an explicit documented state
      set.status = 'cancelled'
      push.events = ev(sess, 'cancelled', reason)
      return done()
    }
    if (action === 'execute' || action === 'complete') {
      const to = action === 'execute' ? 'executed' : 'completed'
      if (!(TRANSITIONS[doc.status] || []).includes(to)) return { error: `الترتيب: معتمد ← منفذ ← مكتمل (الحالة الحالية: ${STATUS_AR[doc.status]})`, status: 409 }
      set.status = to
      push.events = ev(sess, to, reason)
      return done()
    }
    if (action === 'reopen') {
      if (!['rejected', 'cancelled'].includes(doc.status)) return { error: 'إعادة الفتح متاحة للمرفوض/الملغى فقط', status: 409 }
      set.status = 'under_review'
      push.events = ev(sess, 'reopened', reason)
      return done()
    }
    if (action === 'archive' || action === 'unarchive') {
      if (action === 'archive' && OPEN_STATUSES.includes(doc.status)) return { error: 'لا تُؤرشف الطلبات المفتوحة — أغلقها أولاً (اعتماد/رفض/إلغاء)', status: 409 }
      set.archived = action === 'archive'
      push.events = ev(sess, action, reason)
      return done()
    }
    return { error: 'إجراء غير معروف' }
  }
  return { error: 'مسار غير معروف', status: 404 }
}

// ======================= COMMISSIONS LEDGER HANDLER =======================
const COMM_STATUS_AR = { pending: 'معلقة', due: 'مستحقة', approved: 'معتمدة', paid: 'مدفوعة', rejected: 'مرفوضة', cancelled: 'ملغاة', reversed: 'معكوسة' }

export async function adminCommissionsLedgerHandler(db, path, method, p, b, sess) {
  const idx = await ensureIndexes(db)
  // v4.8 — PR#18-2: server-side per-action enforcement (section «commissions»)
  const can = await adminCan(db, sess)
  const denyC = (act) => ({ error: `🚫 غير مصرح — يتطلب هذا الإجراء صلاحية «${act}» في قسم «العمولات»`, status: 403 })

  if (path === '' && method === 'GET') {
    const f = {}
    if (p.get('status')) f.status = p.get('status')
    if (p.get('order')) f.order_id = p.get('order')
    const rows = await db.collection('platform_commissions').find(f, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(300).toArray()
    return { rows, status_labels: COMM_STATUS_AR }
  }

  if (path === '' && method === 'POST') {
    if (!can.has('commissions', 'create')) return denyC('create') // v4.8 — PR#18-2
    // v4.8 — PR#18-3: THE unique index {order_id, rule_id, beneficiary_key} is the ONLY
    // guarantee against duplicate commissions — if it is not proven, no insert happens.
    if (!idx.ok) return INDEX_BLOCK_MSG()
    const order = await db.collection('platform_orders').findOne({ id: b.order_id })
    if (!order) return { error: 'الطلب/البيع الأصلي غير موجود — العمولة ترتبط بطلب في platform_orders حصراً', status: 404 }
    const rulesDoc = await db.collection('platform_settings').findOne({ id: 'commission_rules' })
    const rule = (rulesDoc?.rules || []).find(r => r.id === b.rule_id)
    if (!rule) return { error: 'قاعدة العمولة غير موجودة', status: 404 }
    if (rule.active === false) return { error: 'القاعدة معطلة — فعّلها أولاً', status: 409 }
    const beneficiaryKey = String(b.beneficiary_key || rule.beneficiary_name || '').slice(0, 160)
    if (!beneficiaryKey) return { error: 'المستفيد إلزامي (مستخدم/موظف/مكتب قائم — لا Collection مسوقين)' }
    const basis = Number(order.amount) || 0
    const amount = rule.type === 'fixed' ? Number(rule.value) || 0 : Math.round(basis * (Number(rule.value) || 0)) / 100
    const doc = {
      id: uuidv4(),
      // hard link to the source order + FULL SNAPSHOT (immutable trade terms)
      order_id: order.id, order_ref: order.ref, order_type: order.type,
      tenant_id: order.tenant_id, tenant_name: order.tenant_name, plan_key: order.plan_key || null,
      rule_id: rule.id, rule_name: rule.name, rule_type: rule.type, rule_value: Number(rule.value) || 0,
      beneficiary_type: b.beneficiary_type || rule.beneficiary_type || 'marketer',
      beneficiary_key: beneficiaryKey, beneficiary_name: String(b.beneficiary_name || rule.beneficiary_name || beneficiaryKey).slice(0, 160),
      basis, amount, currency: order.currency || 'USD',
      status: 'pending',
      voucher_id: null, journal_entry_id: null, // financial linkage lands when سند الصرف wiring is approved
      created_by: sess.user.email, created_at: new Date(), updated_at: new Date(),
      approved_by: null, approved_at: null, paid_at: null,
      events: [{ at: new Date(), by: sess.user.email, type: 'created', note: `أُنشئت من ${order.ref} وفق قاعدة «${rule.name}» (${rule.type === 'fixed' ? `ثابت ${rule.value}` : `${rule.value}%`} على أساس ${basis})` }],
    }
    try {
      await db.collection('platform_commissions').insertOne({ ...doc })
    } catch (e) {
      if (String(e.message).includes('duplicate') || e.code === 11000) {
        const dup = await db.collection('platform_commissions').findOne({ order_id: order.id, rule_id: rule.id, beneficiary_key: beneficiaryKey }, { projection: { _id: 0, events: 0 } })
        return { success: true, duplicate: true, commission: dup }
      }
      throw e
    }
    await logAudit(db, sess, 'commissions', 'commission_create', { id: doc.id, order: order.ref }, null, { amount, currency: doc.currency, beneficiary: doc.beneficiary_name }, b.reason || 'إنشاء عمولة من البيع')
    await emitAdminNotification(db, { type: 'commission_event', title: `عمولة جديدة ${amount} ${doc.currency} — ${doc.beneficiary_name}`, body: `من ${order.ref} (${order.type_label || order.type}) وفق «${rule.name}»`, tenant_id: order.tenant_id, ref_type: 'platform_commission', ref_id: doc.id, dedupe_key: `comm_new_${doc.id}` })
    delete doc._id
    return { success: true, commission: doc }
  }

  const m = path.match(/^\/([^/]+)$/)
  if (m && method === 'PATCH') {
    const doc = await db.collection('platform_commissions').findOne({ id: m[1] })
    if (!doc) return { error: 'العمولة غير موجودة', status: 404 }
    const { action, reason } = b || {}
    // v4.8 — PR#18-2: explicit permission per action (pay stays design-blocked below)
    const COMM_ACTION_PERM = { approve: 'approve', hold: 'manage', mark_due: 'manage', reject: 'manage', cancel: 'manage', reverse: 'manage', pay: 'manage' }
    const neededC = COMM_ACTION_PERM[action]
    if (!neededC) return { error: 'إجراء غير معروف' }
    if (!can.has('commissions', neededC)) return denyC(neededC)
    if (!reason) return { error: 'السبب إلزامي لكل إجراء على العمولات' }
    const set = { updated_at: new Date() }
    const finish = async (evType) => {
      await db.collection('platform_commissions').updateOne({ id: doc.id }, { $set: set, $push: { events: { at: new Date(), by: sess.user.email, type: evType, note: String(reason).slice(0, 400) } } })
      await logAudit(db, sess, 'commissions', `commission_${action}`, { id: doc.id, order: doc.order_ref }, { status: doc.status }, { status: set.status || doc.status }, reason)
      return { success: true, status: set.status || doc.status }
    }
    // approved/paid amounts are IMMUTABLE — correction is reversal only (no direct edits)
    if (action === 'approve') {
      if (!['pending', 'due'].includes(doc.status)) return { error: `الاعتماد متاح للمعلقة/المستحقة فقط (الحالية: ${COMM_STATUS_AR[doc.status]})`, status: 409 }
      set.status = 'approved'; set.approved_by = sess.user.email; set.approved_at = new Date()
      return finish('approved')
    }
    if (action === 'hold') {
      if (!['due', 'approved'].includes(doc.status) && doc.status !== 'pending') return { error: 'التعليق متاح قبل الدفع فقط', status: 409 }
      set.status = 'pending'
      return finish('held')
    }
    if (action === 'mark_due') {
      if (doc.status !== 'pending') return { error: 'الاستحقاق من حالة معلقة فقط', status: 409 }
      set.status = 'due'
      return finish('due')
    }
    if (action === 'reject') {
      if (['paid', 'reversed'].includes(doc.status)) return { error: 'لا يُرفض المدفوع/المعكوس', status: 409 }
      set.status = 'rejected'
      return finish('rejected')
    }
    if (action === 'cancel') {
      if (['paid'].includes(doc.status)) return { error: 'المدفوعة لا تُلغى — استخدم العكس (reverse)', status: 409 }
      set.status = 'cancelled'
      return finish('cancelled')
    }
    if (action === 'reverse') {
      if (!['approved', 'paid'].includes(doc.status)) return { error: 'العكس متاح للمعتمدة/المدفوعة فقط', status: 409 }
      set.status = 'reversed'
      return finish('reversed')
    }
    if (action === 'pay') {
      // financial linkage (سند صرف + قيد) is NOT wired yet — paying without it would
      // create an incomplete financial effect → blocked by design, documented.
      return { error: '⛔ الدفع محجوب: ربط سند الصرف والقيد غير مكتمل بعد — بانتظار اعتماد الربط المالي. استخدم الاعتماد/التعليق/العكس', status: 409 }
    }
    return { error: 'إجراء غير معروف' }
  }
  return { error: 'مسار غير معروف', status: 404 }
}
