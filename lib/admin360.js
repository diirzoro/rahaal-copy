// ============================================================================
// v3.91 — OFFICE 360° (Super Admin, Phase 2) — READ-ONLY aggregation module
// AUDIT-006 compliance: admin logic lives here, route.js only delegates.
// STRICT RULES ENFORCED IN THIS MODULE:
//   - READ ONLY: zero writes, zero schema changes, zero new collections.
//   - Reuses the EXISTING collections exactly as stored (tickets, visas,
//     services, packages, package_bookings, vouchers, clients, suppliers,
//     boxes, journal_entries, users, tenant_settings, meraaj_inbound_bookings).
//   - Displays STORED balances as-is — NO recomputation, NO parallel
//     accounting logic (per Phase-2 instruction).
//   - Anything not truly available is returned as null (never fake data).
// ============================================================================

const LIMITS = { list: 100, recent: 30, vouchers: 50, journal: 20, activity: 20 }

const sumByCur = (rows, field) => {
  const m = {}
  for (const r of rows) {
    const c = r.currency || '?'
    m[c] = +((m[c] || 0) + (Number(r[field]) || 0)).toFixed(2)
  }
  return m
}

// Sum stored per-currency balance objects AS-IS (display aggregation only)
const sumStoredBalances = (rows) => {
  const m = {}
  for (const r of rows) {
    for (const [c, v] of Object.entries(r.balances || {})) {
      if (typeof v === 'number' && v !== 0) m[c] = +((m[c] || 0) + v).toFixed(2)
    }
  }
  return m
}

const strip = (d) => { if (!d) return d; const { _id, ...rest } = d; return rest }

async function latestDate(db, coll, tf) {
  const d = await db.collection(coll).find(tf, { projection: { created_at: 1, date: 1 } }).sort({ created_at: -1 }).limit(1).next().catch(() => null)
  return d?.created_at || d?.date || null
}

export async function getOffice360(db, tenantId, tab = 'overview') {
  const tenant = await db.collection('tenants').findOne({ id: tenantId })
  if (!tenant) return { error: 'المكتب غير موجود' }
  const tf = { tenant_id: tenantId }
  const T = tenantId

  // ---------- OVERVIEW ----------
  if (tab === 'overview') {
    const countsOf = ['users', 'tickets', 'visas', 'services', 'packages', 'package_bookings', 'vouchers', 'clients', 'suppliers', 'boxes', 'journal_entries', 'meraaj_inbound_bookings']
    const [counts, settings, owner, ticketSales, visaSales, serviceSales, voucherAgg, clientsBal, suppliersBal] = await Promise.all([
      Promise.all(countsOf.map(c => db.collection(c).countDocuments(tf).catch(() => null))),
      db.collection('tenant_settings').findOne(tf, { projection: { coa_version: 1, mod_meraaj: 1 } }).catch(() => null),
      db.collection('users').findOne({ tenant_id: T, role: 'owner' }, { projection: { name: 1, email: 1, phone: 1, whatsapp: 1 } }).catch(() => null),
      db.collection('tickets').find(tf, { projection: { sale_price: 1, currency: 1 } }).toArray().catch(() => []),
      db.collection('visas').find(tf, { projection: { sale_price: 1, currency: 1 } }).toArray().catch(() => []),
      db.collection('services').find(tf, { projection: { sale_price: 1, currency: 1 } }).toArray().catch(() => []),
      db.collection('vouchers').aggregate([
        { $match: tf },
        { $group: { _id: { type: '$type', currency: '$currency' }, total: { $sum: { $ifNull: ['$amount', 0] } }, n: { $sum: 1 } } },
      ]).toArray().catch(() => []),
      db.collection('clients').find(tf, { projection: { balances: 1 } }).toArray().catch(() => []),
      db.collection('suppliers').find(tf, { projection: { balances: 1 } }).toArray().catch(() => []),
    ])
    const countMap = {}
    countsOf.forEach((c, i) => { countMap[c] = counts[i] })
    const received = {}, paid = {}
    for (const g of voucherAgg) {
      const bucket = g._id?.type === 'receipt' ? received : g._id?.type === 'payment' ? paid : null
      if (bucket) bucket[g._id?.currency || '?'] = +(g.total || 0).toFixed(2)
    }
    const [lastTicket, lastVoucher, lastJe] = await Promise.all([
      latestDate(db, 'tickets', tf), latestDate(db, 'vouchers', tf), latestDate(db, 'journal_entries', tf),
    ])
    const lastActivity = [lastTicket, lastVoucher, lastJe].filter(Boolean).sort().pop() || null
    return {
      tenant: {
        id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status,
        subscription: tenant.subscription, plan_tier: tenant.plan_tier,
        max_users: tenant.max_users, max_branches: tenant.max_branches,
        journal_quota: tenant.journal_quota || null, created_at: tenant.created_at,
      },
      owner: owner ? { name: owner.name, email: owner.email, phone: owner.phone || tenant.owner_phone || null, whatsapp: owner.whatsapp || null } : (tenant.owner_phone ? { name: null, email: null, phone: tenant.owner_phone, whatsapp: null } : null), // v5.1 — نقطة 1
      counts: countMap,
      sales_by_currency: {
        tickets: sumByCur(ticketSales, 'sale_price'),
        visas: sumByCur(visaSales, 'sale_price'),
        services: sumByCur(serviceSales, 'sale_price'),
      },
      vouchers_totals: { received, paid },
      stored_balances: { clients: sumStoredBalances(clientsBal), suppliers: sumStoredBalances(suppliersBal) },
      coa: { version: settings?.coa_version ?? null },
      meraaj: { module_enabled: settings?.mod_meraaj ?? null, inbound_count: countMap.meraaj_inbound_bookings ?? null },
      last_activity: lastActivity,
      // Not available without new accounting logic — reported as data gaps, never faked:
      profit: null,
      read_only: true,
    }
  }

  // ---------- USERS ----------
  if (tab === 'users') {
    const users = await db.collection('users').find(tf, { projection: { password: 0, password_hash: 0, _id: 0 } }).sort({ created_at: 1 }).limit(LIMITS.list).toArray()
    return { users, read_only: true }
  }

  // ---------- SALES ----------
  if (tab === 'sales') {
    const proj = { projection: { _id: 0 } }
    const [tickets, visas, services, bookings] = await Promise.all([
      db.collection('tickets').find(tf, proj).sort({ created_at: -1 }).limit(LIMITS.recent).toArray().catch(() => []),
      db.collection('visas').find(tf, proj).sort({ created_at: -1 }).limit(LIMITS.recent).toArray().catch(() => []),
      db.collection('services').find(tf, proj).sort({ created_at: -1 }).limit(LIMITS.recent).toArray().catch(() => []),
      db.collection('package_bookings').find(tf, proj).sort({ created_at: -1 }).limit(LIMITS.recent).toArray().catch(() => []),
    ])
    return {
      tickets, visas, services, bookings,
      totals: { tickets: sumByCur(tickets, 'sale_price'), visas: sumByCur(visas, 'sale_price'), services: sumByCur(services, 'sale_price') },
      note: `أحدث ${LIMITS.recent} لكل نوع — الإجماليات الكلية في Overview`,
      read_only: true,
    }
  }

  // ---------- VOUCHERS ----------
  if (tab === 'vouchers') {
    const vouchers = await db.collection('vouchers').find(tf, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(LIMITS.vouchers).toArray().catch(() => [])
    const agg = await db.collection('vouchers').aggregate([
      { $match: tf },
      { $group: { _id: { type: '$type', currency: '$currency' }, total: { $sum: { $ifNull: ['$amount', 0] } }, n: { $sum: 1 } } },
    ]).toArray().catch(() => [])
    return {
      vouchers,
      totals: agg.map(g => ({ type: g._id?.type || '?', currency: g._id?.currency || '?', total: +(g.total || 0).toFixed(2), count: g.n })),
      read_only: true,
    }
  }

  // ---------- ACCOUNTING ----------
  if (tab === 'accounting') {
    const [jeCount, journal, accountsByType, settings, retained] = await Promise.all([
      db.collection('journal_entries').countDocuments(tf).catch(() => null),
      db.collection('journal_entries').find(tf, { projection: { _id: 0, lines: 1, date: 1, description: 1, ref_type: 1, currency: 1, created_at: 1, id: 1 } }).sort({ created_at: -1 }).limit(LIMITS.journal).toArray().catch(() => []),
      db.collection('accounts').aggregate([{ $match: tf }, { $group: { _id: '$type', n: { $sum: 1 } } }]).toArray().catch(() => []),
      db.collection('tenant_settings').findOne(tf, { projection: { coa_version: 1, period_lock: 1 } }).catch(() => null),
      db.collection('accounts').findOne({ ...tf, code: '3102' }, { projection: { code: 1, name_ar: 1 } }).catch(() => null),
    ])
    return {
      journal_count: jeCount,
      journal: journal.map(j => ({
        id: j.id, date: j.date, description: j.description, ref_type: j.ref_type, currency: j.currency,
        lines_count: (j.lines || []).length,
        total_debit: +(j.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0).toFixed(2),
      })),
      accounts_by_type: accountsByType.map(a => ({ type: a._id, count: a.n })),
      coa: { version: settings?.coa_version ?? null, retained_earnings_3102: !!retained, period_lock: settings?.period_lock?.closed_until || null },
      read_only: true,
    }
  }

  // ---------- CLIENTS / SUPPLIERS ----------
  if (tab === 'clients' || tab === 'suppliers') {
    const rows = await db.collection(tab).find(tf, { projection: { _id: 0, name: 1, phone: 1, account_code: 1, balances: 1, is_frozen: 1, credit_limit: 1, credit_currency: 1, is_meraaj_network: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(LIMITS.list).toArray().catch(() => [])
    return { rows, totals: sumStoredBalances(rows), note: 'أرصدة مخزنة كما هي — بدون إعادة احتساب', read_only: true }
  }

  // ---------- BOXES ----------
  if (tab === 'boxes') {
    const rows = await db.collection('boxes').find(tf, { projection: { _id: 0 } }).sort({ created_at: 1 }).limit(LIMITS.list).toArray().catch(() => [])
    return { rows: rows.map(strip), totals: sumStoredBalances(rows), read_only: true }
  }

  // ---------- SUBSCRIPTION ----------
  if (tab === 'subscription') {
    // Installment details are REUSED from the existing /admin/installments-overview
    // endpoint (the frontend filters it by tenant) — no duplicated logic here.
    return {
      subscription: {
        status: tenant.status, subscription: tenant.subscription, plan_tier: tenant.plan_tier,
        max_users: tenant.max_users, max_branches: tenant.max_branches,
        journal_quota: tenant.journal_quota || null, referral_code: tenant.referral_code || null,
        created_at: tenant.created_at,
      },
      read_only: true,
    }
  }

  // ---------- ACTIVITY ----------
  if (tab === 'activity') {
    const src = [
      ['tickets', 'تذكرة', { passenger_name: 1 }],
      ['visas', 'تأشيرة', { passenger_name: 1 }],
      ['services', 'خدمة', { beneficiary_name: 1, service_type: 1 }],
      ['vouchers', 'سند', { type: 1, amount: 1, currency: 1 }],
      ['package_bookings', 'حجز باكج', { pilgrim_name: 1 }],
      ['journal_entries', 'قيد', { description: 1 }],
    ]
    const batches = await Promise.all(src.map(([coll, label, extra]) =>
      db.collection(coll).find(tf, { projection: { _id: 0, created_at: 1, date: 1, ...extra } }).sort({ created_at: -1 }).limit(LIMITS.activity).toArray()
        .then(rows => rows.map(r => ({
          kind: label,
          at: r.created_at || r.date || null,
          label: r.passenger_name || r.beneficiary_name || r.pilgrim_name || r.description || (r.type === 'receipt' ? `قبض ${r.amount ?? ''} ${r.currency ?? ''}` : r.type === 'payment' ? `صرف ${r.amount ?? ''} ${r.currency ?? ''}` : r.service_type) || '—',
        })))
        .catch(() => [])
    ))
    const merged = batches.flat().filter(x => x.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, LIMITS.activity)
    return { activity: merged, note: 'مشتق من تواريخ الإنشاء الفعلية — لا يوجد تتبع last_login حالياً (Data Gap)', read_only: true }
  }

  return { error: 'tab غير معروف' }
}
