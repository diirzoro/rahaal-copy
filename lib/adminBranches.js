// ============================================================================
// v5.0 — ENTERPRISE BRANCHES (Admin panel → Office 360 → «الفروع»)
// ADDITIVE ONLY: new `branches` collection + optional `users.branch_id` field.
// - Branch CREATION is allowed ONLY for enterprise-tier tenants (gold/silver
//   behavior and limits untouched — they simply never pass the plan gate).
// - Branch limit = tenant.max_branches with UNLIMITED semantics:
//   null / undefined / legacy 0 → unlimited (NEVER interpreted as a zero cap
//   and never converted to a fixed number). A positive per-office override
//   (explicitly defined & separately approved) is respected as-is.
// - Every branch is permanently linked to its tenant (tenant_id) — all queries
//   are tenant-scoped so cross-tenant linking is impossible.
// - users.branch_id links a user to ONE branch (null = head office) after
//   verifying BOTH belong to the same tenant. Existing users are never touched
//   automatically. NO auth / permissions / accounting / consolidation changes
//   here (accounting per-branch is a separate later task by explicit order).
// ============================================================================
import { v4 as uuidv4 } from 'uuid'

let brIndexesReady = false
let brIndexesError = null
// Idempotent, additive index creation on a brand-new collection (no existing
// data → no duplicate risk). Failures are NOT swallowed (same policy as
// adminOrders): inserts that depend on the unique name index are refused.
async function ensureBranchIndexes(db) {
  if (brIndexesReady) return { ok: true }
  try {
    await db.collection('branches').createIndex({ tenant_id: 1, name: 1 }, { unique: true })
    await db.collection('branches').createIndex({ tenant_id: 1, status: 1 })
    brIndexesReady = true
    brIndexesError = null
    return { ok: true }
  } catch (e) {
    brIndexesError = e?.message || String(e)
    console.error('[branches] ensureIndexes FAILED — duplicate-name protection NOT proven:', brIndexesError)
    return { ok: false, error: brIndexesError }
  }
}

const isUnlimited = (v) => v === null || v === undefined || Number(v) === 0

function sanitizeBranch(b) {
  if (!b) return null
  const { _id, ...rest } = b
  return rest
}

export async function adminBranchesHandler(db, tenantId, branchId, method, b, sess) {
  const tenant = await db.collection('tenants').findOne({ id: tenantId })
  if (!tenant) return { error: 'المكتب غير موجود', status: 404 }
  const idx = await ensureBranchIndexes(db)
  const isEnterprise = (tenant.plan_tier || '') === 'enterprise'
  // v5.1 — نقطة 2: allowance is LIMIT-based (not plan-name based): an office granted an
  // explicit branch limit (e.g. 5) can create branches up to it, regardless of tier name;
  // enterprise with null/legacy-0 limit = unlimited. Zero-limit offices see no controls.
  const unlimitedBranches = isEnterprise && isUnlimited(tenant.max_branches)
  const branchesAllowed = unlimitedBranches || Number(tenant.max_branches) >= 1

  // ---------- LIST (read — available for every plan so the tab can explain itself) ----------
  if (!branchId && method === 'GET') {
    const branches = await db.collection('branches').find({ tenant_id: tenantId }).sort({ created_at: 1 }).toArray()
    const users = await db.collection('users')
      .find({ tenant_id: tenantId }, { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, active: 1, branch_id: 1 } })
      .toArray()
    return {
      branches: branches.map(x => ({ ...sanitizeBranch(x), users_count: users.filter(u => u.branch_id === x.id).length })),
      users,
      plan_tier: tenant.plan_tier || null,
      max_branches: tenant.max_branches ?? null,
      unlimited: unlimitedBranches,
      allowed: branchesAllowed,
    }
  }

  // ---------- CREATE (limit-based — نقطة 2) ----------
  if (!branchId && method === 'POST') {
    if (!branchesAllowed) return { error: 'هذا المكتب لا يملك حد فروع — يُمنح حد الفروع من إدارة رحّال حسب الباقة أو باتفاق خاص', status: 403 }
    if (!idx.ok) return { error: `⛔ الإنشاء موقوف: حماية منع تكرار اسم الفرع (Unique Index) غير مثبتة — ${brIndexesError}`, status: 503 }
    const name = String(b?.name || '').trim()
    if (!name) return { error: 'اسم الفرع مطلوب' }
    // unlimited unless a positive per-office limit was explicitly defined
    const limit = tenant.max_branches
    if (!unlimitedBranches) {
      const c = await db.collection('branches').countDocuments({ tenant_id: tenantId })
      if (c >= Number(limit)) return { error: `تم بلوغ حد الفروع المعرَّف صراحةً لهذا المكتب (${limit})`, status: 409 }
    }
    if (await db.collection('branches').findOne({ tenant_id: tenantId, name })) return { error: 'يوجد فرع بنفس الاسم في هذا المكتب' }
    const doc = {
      id: uuidv4(), tenant_id: tenantId, name,
      code: String(b?.code || '').trim() || null,
      phone: String(b?.phone || '').trim() || null,
      address: String(b?.address || '').trim() || null,
      notes: String(b?.notes || '').trim() || null,
      status: 'active',
      created_at: new Date(), created_by: sess?.user?.email || null,
      updated_at: new Date(), updated_by: null,
    }
    try {
      await db.collection('branches').insertOne(doc)
    } catch (e) {
      if (e?.code === 11000 || String(e?.code) === '11000') return { error: 'يوجد فرع بنفس الاسم في هذا المكتب' }
      throw e
    }
    return { branch: sanitizeBranch(doc) }
  }

  // ---------- EDIT / ACTIVATE / SUSPEND (tenant-scoped) ----------
  if (branchId) {
    const br = await db.collection('branches').findOne({ id: branchId, tenant_id: tenantId })
    if (!br) return { error: 'الفرع غير موجود في هذا المكتب', status: 404 }

    if (method === 'PUT') {
      const upd = { updated_at: new Date(), updated_by: sess?.user?.email || null }
      if (b?.name !== undefined) {
        const nm = String(b.name || '').trim()
        if (!nm) return { error: 'اسم الفرع مطلوب' }
        if (nm !== br.name && await db.collection('branches').findOne({ tenant_id: tenantId, name: nm })) return { error: 'يوجد فرع بنفس الاسم في هذا المكتب' }
        upd.name = nm
      }
      for (const f of ['code', 'phone', 'address', 'notes']) if (b?.[f] !== undefined) upd[f] = String(b[f] || '').trim() || null
      await db.collection('branches').updateOne({ id: branchId, tenant_id: tenantId }, { $set: upd })
      return { branch: sanitizeBranch({ ...br, ...upd }) }
    }

    if (method === 'PATCH') {
      const action = b?.action
      if (!['activate', 'suspend'].includes(action)) return { error: 'إجراء غير معروف — المتاح: activate / suspend' }
      const status = action === 'activate' ? 'active' : 'suspended'
      await db.collection('branches').updateOne(
        { id: branchId, tenant_id: tenantId },
        { $set: { status, updated_at: new Date(), updated_by: sess?.user?.email || null } }
      )
      return { branch: sanitizeBranch({ ...br, status }) }
    }
  }

  return { error: 'مسار غير معروف', status: 404 }
}

// PATCH /admin/tenants/:id/users/:uid/branch — { branch_id: string|null }
// Links a user to ONE branch of the SAME tenant (null = head office).
// Never touches auth, role, permissions or any other user field.
export async function adminBranchUserAssignHandler(db, tenantId, userId, b) {
  const tenant = await db.collection('tenants').findOne({ id: tenantId })
  if (!tenant) return { error: 'المكتب غير موجود', status: 404 }
  const user = await db.collection('users').findOne({ id: userId, tenant_id: tenantId })
  if (!user) return { error: 'المستخدم غير موجود في هذا المكتب', status: 404 }
  const raw = b?.branch_id ?? null
  if (raw === null || raw === '') {
    await db.collection('users').updateOne({ id: userId, tenant_id: tenantId }, { $set: { branch_id: null } })
    return { user: { id: user.id, name: user.name, email: user.email, branch_id: null } }
  }
  const br = await db.collection('branches').findOne({ id: String(raw), tenant_id: tenantId })
  if (!br) return { error: 'الفرع غير موجود في هذا المكتب — لا يمكن ربط مستخدم بفرع مكتب آخر', status: 404 }
  if (br.status !== 'active') return { error: 'الفرع موقوف — فعّله أولاً قبل ربط مستخدمين به' }
  await db.collection('users').updateOne({ id: userId, tenant_id: tenantId }, { $set: { branch_id: br.id } })
  return { user: { id: user.id, name: user.name, email: user.email, branch_id: br.id } }
}
