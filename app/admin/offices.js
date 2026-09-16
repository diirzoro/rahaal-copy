'use client'
// ============================================================================
// v3.91 — OFFICES + OFFICE 360° (Super Admin, Phase 2) — READ-ONLY
// REUSED: GET /api/admin/tenants (extended with owner info from its own query),
//         GET /api/admin/tenants/:id/office360 (new read-only aggregation,
//         logic in lib/admin360.js), GET /api/admin/installments-overview
//         (existing — filtered client-side for the Subscription tab),
//         POST /api/admin/tenants/:id/impersonate (existing flow, reused as-is).
// All financial data is displayed AS STORED — no edits, no vouchers creation,
// no balance recomputation, no deletion. Actions (suspend/plans/reset) remain
// in the legacy panel for now.
// ============================================================================
import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Building2, ArrowRight, RefreshCw, Lock, Eye, Users, Ticket, FileBadge2, Briefcase, Package, Receipt, Calculator, Wallet, CreditCard, ListTree } from 'lucide-react'
import { api, askConfirm } from '../shared'

const n2 = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v ?? '—')
const dt = (v) => (v ? new Date(v).toLocaleDateString('ar-EG') : '—')
const dtt = (v) => (v ? new Date(v).toLocaleString('ar-EG') : '—')

// Render a { CUR: amount } map — or an explicit dash when empty (never fake zeros)
const CurMap = ({ map }) => {
  const entries = Object.entries(map || {}).filter(([, v]) => v !== 0)
  if (!entries.length) return <span className="text-slate-400">—</span>
  return (
    <span className="inline-flex flex-wrap gap-1" dir="ltr">
      {entries.map(([c, v]) => <Badge key={c} variant="outline" className="font-mono text-[10px]">{n2(v)} {c}</Badge>)}
    </span>
  )
}

const StatusBadge = ({ status }) => (
  <Badge className={(status || 'active') === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}>
    {(status || 'active') === 'active' ? 'نشط' : status === 'suspended' ? 'موقوف' : status}
  </Badge>
)

const MiniStat = ({ icon: Icon, label, value }) => (
  <div className="p-3 rounded-xl bg-white border shadow-sm flex items-center gap-2.5">
    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-slate-600" /></div>
    <div className="min-w-0">
      <div className="text-[10px] text-slate-500 font-semibold">{label}</div>
      <div className="text-lg font-black leading-tight truncate">{value ?? '—'}</div>
    </div>
  </div>
)

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'المستخدمون' },
  { key: 'branches', label: 'الفروع' }, // v5.0 — Enterprise branches (management)
  { key: 'sales', label: 'المبيعات' },
  { key: 'vouchers', label: 'السندات' },
  { key: 'accounting', label: 'الحسابات' },
  { key: 'clients', label: 'العملاء' },
  { key: 'suppliers', label: 'الموردون' },
  { key: 'boxes', label: 'الصناديق' },
  { key: 'subscription', label: 'الاشتراك' },
  { key: 'statement', label: 'كشف الحساب' }, // v5.2 — نقطة 8: كشف حساب المكتب من دفتر رحّال
  { key: 'activity', label: 'النشاط' },
]

// ==================== OFFICE STATEMENT TAB (v5.2 — نقطة 8) ====================
// True COA statement of the office from the RAHAAL company book — reuses the central
// reportStatement engine via GET /admin/tenants/:id/office-statement. Displays the
// opening balance, every debit/credit movement, the running balance and per-currency
// summary. Sales-screen "paid/remaining" is display-only — THIS is the accounting truth.
const StatementTab = ({ office }) => {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const load = () => {
    setLoading(true); setErr(null)
    api(`/admin/tenants/${office.id}/office-statement`)
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  if (loading) return <Card><CardContent className="py-10 text-center text-slate-400">جارِ تحميل كشف الحساب…</CardContent></Card>
  if (err) return (
    <Card><CardContent className="py-10 text-center space-y-2">
      <div className="text-3xl">🧾</div>
      <div className="font-bold text-slate-700">لا يمكن عرض كشف الحساب</div>
      <div className="text-xs text-slate-500">{err}</div>
      <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3 h-3 ml-1" /> إعادة المحاولة</Button>
    </CardContent></Card>
  )
  const st = data?.statement || {}
  const rows = st.rows || []
  const summary = (st.summary || []).filter(s => s.opening_balance !== 0 || s.total_debit !== 0 || s.total_credit !== 0 || s.closing_balance !== 0)
  return (
    <div className="space-y-4">
      <Card><CardContent className="py-3 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1 items-center">
        <span>🧾 الحساب: <b>{data.office_client?.name || '—'}</b></span>
        <span>الكود: <b className="font-mono" dir="ltr">{data.office_client?.account_code || '—'}</b></span>
        <span className="text-slate-400">الأب: 1103 — العملاء (دفتر رحّال) · المصدر: دفتر الأستاذ المركزي — لا حساب موازٍ</span>
        <Button size="sm" variant="outline" className="h-7 text-xs mr-auto" onClick={load}><RefreshCw className="w-3 h-3 ml-1" /> تحديث</Button>
      </CardContent></Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(summary.length ? summary : [{ currency: '—', opening_balance: 0, total_debit: 0, total_credit: 0, closing_balance: 0 }]).map(s => (
          <Card key={s.currency}><CardContent className="p-3 space-y-1">
            <div className="flex items-center justify-between"><Badge variant="outline" className="font-mono">{s.currency}</Badge>
              <span className={`text-sm font-black ${s.closing_balance > 0 ? 'text-rose-600' : s.closing_balance < 0 ? 'text-emerald-600' : 'text-slate-500'}`} dir="ltr">{n2(s.closing_balance)}</span></div>
            <div className="text-[10px] text-slate-500 flex justify-between"><span>رصيد سابق: <b dir="ltr">{n2(s.opening_balance)}</b></span><span>مدين: <b dir="ltr" className="text-rose-600">{n2(s.total_debit)}</b></span><span>دائن: <b dir="ltr" className="text-emerald-600">{n2(s.total_credit)}</b></span></div>
            <div className="text-[9px] text-slate-400">الرصيد الموجب = مديونية على المكتب · السالب = رصيد دائن له</div>
          </CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="pt-4 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-6">لا حركات على حساب المكتب بعد — تظهر الحركات فور تفعيل الاشتراك (قيد البيع) وتحصيل الأقساط (سندات القبض)</div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>البيان</TableHead><TableHead>النوع</TableHead>
              <TableHead className="text-center">مدين</TableHead><TableHead className="text-center">دائن</TableHead>
              <TableHead className="text-center">الرصيد الجاري</TableHead><TableHead className="text-center">العملة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} className={r.ref_type === 'opening_balance' ? 'bg-slate-50' : ''}>
                  <TableCell className="text-xs whitespace-nowrap">{dt(r.date)}</TableCell>
                  <TableCell className="text-xs">{r.description || '—'}</TableCell>
                  <TableCell className="text-[10px] text-slate-500">{r.ref_type === 'subscription_sale' ? '🧾 بيع اشتراك' : r.ref_type === 'voucher' ? '💰 سند' : r.ref_type === 'opening_balance' ? '⏮️ رصيد سابق' : r.ref_type || '—'}</TableCell>
                  <TableCell className="text-center text-xs font-bold text-rose-600" dir="ltr">{r.debit ? n2(r.debit) : '—'}</TableCell>
                  <TableCell className="text-center text-xs font-bold text-emerald-600" dir="ltr">{r.credit ? n2(r.credit) : '—'}</TableCell>
                  <TableCell className="text-center text-xs font-black" dir="ltr">{n2(r.balance)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="font-mono text-[9px]">{r.currency}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
    </div>
  )
}

// ============================ BRANCHES TAB (v5.0 — Enterprise) ============================
// Management UI over /api/admin/tenants/:id/branches — server enforces: enterprise-only
// creation, unlimited semantics (null / legacy 0 = unlimited), tenant-scoped linkage.
const BranchesTab = ({ office }) => {
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null) // null = closed · {} = new · {id,...} = edit
  const [busy, setBusy] = useState(false)
  const load = () => api(`/admin/tenants/${office.id}/branches`).then(setData).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [])

  if (!data) return <Card><CardContent className="py-10 text-center text-slate-400">جارِ التحميل…</CardContent></Card>
  if (!data.allowed) return (
    <Card><CardContent className="py-10 text-center space-y-2">
      <div className="text-3xl">🏢</div>
      <div className="font-bold text-slate-700">الفروع متاحة لباقة «إنتربرايز» فقط</div>
      <div className="text-xs text-slate-500">باقة هذا المكتب: <b>{data.plan_tier || '—'}</b> — باقتا الفضية والذهبية بلا تغيير</div>
    </CardContent></Card>
  )

  const save = async () => {
    if (!String(form?.name || '').trim()) return toast.error('اسم الفرع مطلوب')
    setBusy(true)
    try {
      const body = { name: form.name, code: form.code, phone: form.phone, address: form.address, notes: form.notes }
      if (form.id) await api(`/admin/tenants/${office.id}/branches/${form.id}`, { method: 'PUT', body })
      else await api(`/admin/tenants/${office.id}/branches`, { method: 'POST', body })
      toast.success(form.id ? '✅ حُدّث الفرع' : '✅ أُنشئ الفرع')
      setForm(null); load()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const setStatus = async (br, action) => {
    if (!(await askConfirm({
      title: action === 'suspend' ? `إيقاف الفرع «${br.name}»` : `تفعيل الفرع «${br.name}»`,
      desc: action === 'suspend' ? 'سيُعلَّم الفرع موقوفاً فقط — لا حذف ولا مساس بأي بيانات أو مستخدمين.' : 'سيعود الفرع نشطاً ويمكن ربط مستخدمين به.',
      icon: '🏢', confirmLabel: 'تأكيد',
    }))) return
    try { await api(`/admin/tenants/${office.id}/branches/${br.id}`, { method: 'PATCH', body: { action } }); toast.success('تم'); load() } catch (e) { toast.error(e.message) }
  }
  const assign = async (u, branchId) => {
    try { await api(`/admin/tenants/${office.id}/users/${u.id}/branch`, { method: 'PATCH', body: { branch_id: branchId || null } }); toast.success('🔗 حُدّث ربط المستخدم'); load() } catch (e) { toast.error(e.message) }
  }

  const activeBranches = (data.branches || []).filter(x => x.status === 'active')
  const F = (k, ph) => <Input value={form?.[k] ?? ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={ph} className="h-8 text-xs" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-indigo-100 text-indigo-700">🏢 إنتربرايز</Badge>
        <div className="text-xs text-slate-600">
          الفروع: <b>{data.branches.length}</b> / <b>{data.unlimited ? '∞ غير محدود' : data.max_branches}</b>
          <span className="text-slate-400"> · المستخدمون: غير محدود</span>
        </div>
        <div className="flex-1" />
        <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1" onClick={() => setForm({})}>➕ إضافة فرع</Button>
      </div>

      {form && (
        <Card className="border-indigo-200">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{form.id ? `✏️ تعديل الفرع «${form.name}»` : '➕ فرع جديد تحت المكتب الرئيسي'}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {F('name', 'اسم الفرع *')}{F('code', 'كود (اختياري)')}{F('phone', 'هاتف (اختياري)')}{F('address', 'العنوان (اختياري)')}
            </div>
            {F('notes', 'ملاحظات (اختياري)')}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={save} className="bg-indigo-600 hover:bg-indigo-700">{busy ? '...' : 'حفظ'}</Button>
              <Button size="sm" variant="outline" onClick={() => setForm(null)}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">🏢 فروع المكتب ({data.branches.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>الفرع</TableHead><TableHead>الكود</TableHead><TableHead>الهاتف</TableHead>
              <TableHead className="text-center">المستخدمون</TableHead><TableHead className="text-center">الحالة</TableHead><TableHead className="text-center">إجراءات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.branches.map(br => (
                <TableRow key={br.id}>
                  <TableCell className="text-xs"><b>{br.name}</b>{br.address ? <div className="text-[10px] text-slate-400">{br.address}</div> : null}</TableCell>
                  <TableCell className="text-xs">{br.code || '—'}</TableCell>
                  <TableCell className="text-xs" dir="ltr">{br.phone || '—'}</TableCell>
                  <TableCell className="text-xs text-center">{br.users_count}</TableCell>
                  <TableCell className="text-center"><StatusBadge status={br.status} /></TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setForm({ id: br.id, name: br.name, code: br.code || '', phone: br.phone || '', address: br.address || '', notes: br.notes || '' })}>تعديل</Button>
                      {br.status === 'active'
                        ? <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-rose-600 border-rose-200" onClick={() => setStatus(br, 'suspend')}>إيقاف</Button>
                        : <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-emerald-600 border-emerald-200" onClick={() => setStatus(br, 'activate')}>تفعيل</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data.branches.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-6">لا توجد فروع بعد — أنشئ أول فرع بزر «إضافة فرع»</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">🔗 ربط المستخدمين بالفروع <span className="text-[10px] font-normal text-slate-400">(بلا فرع = المركز الرئيسي — كل مستخدم يرتبط بفرع واحد فقط)</span></CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>المستخدم</TableHead><TableHead>الدور</TableHead><TableHead>الفرع المرتبط</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data.users || []).map(u => (
                <TableRow key={u.id}>
                  <TableCell className="text-xs"><b>{u.name || '—'}</b> <span className="text-slate-400" dir="ltr">{u.email}</span>{u.active === false && <Badge variant="outline" className="mr-1 text-[9px] text-rose-600">معطل</Badge>}</TableCell>
                  <TableCell className="text-xs">{u.role === 'owner' ? 'مالك' : u.role}</TableCell>
                  <TableCell>
                    <select value={u.branch_id || ''} onChange={e => assign(u, e.target.value)}
                      className="h-7 text-xs border rounded-md px-2 bg-white min-w-[160px]">
                      <option value="">🏛️ المركز الرئيسي</option>
                      {activeBranches.map(br => <option key={br.id} value={br.id}>🏢 {br.name}</option>)}
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================ OFFICE 360° ============================
export const Office360 = ({ office, onBack }) => {
  const [tab, setTab] = useState('overview')
  const [cache, setCache] = useState({})
  const [loading, setLoading] = useState(false)
  const [installments, setInstallments] = useState(null)
  const data = cache[tab]

  const loadTab = async (t, force = false) => {
    if (t === 'branches') return // v5.0 — branches tab manages its own endpoint
    if (cache[t] && !force) return
    setLoading(true)
    try {
      const r = await api(`/admin/tenants/${office.id}/office360?tab=${t}`)
      setCache(c => ({ ...c, [t]: r }))
    } catch (e) { toast.error(e.message) }
    setLoading(false)
  }
  useEffect(() => { loadTab(tab) }, [tab])
  useEffect(() => {
    // Subscription tab REUSES the existing installments-overview endpoint (filtered here)
    if (tab === 'subscription' && installments === null) {
      api('/admin/installments-overview').then(rows => {
        const arr = Array.isArray(rows) ? rows : []
        setInstallments(arr.filter(r => r.tenant_id === office.id || r.id === office.id || r.tenant_name === office.name))
      }).catch(() => setInstallments([]))
    }
  }, [tab])

  const impersonate = async () => {
    if (!(await askConfirm({ title: `الدخول كمالك المكتب "${office.name}"`, desc: 'ستُفتح جلسة مؤقتة في تاب جديد (إعادة استخدام آلية الدخول القائمة).', icon: '👤', confirmLabel: 'فتح الجلسة' }))) return
    try {
      const r = await api(`/admin/tenants/${office.id}/impersonate`, { method: 'POST' })
      window.open('/', '_blank')
      toast.success(`🎭 جلسة "دخول كـ ${r?.tenant?.name || office.name}" فُتحت في تاب جديد`)
    } catch (e) { toast.error(e.message) }
  }

  const ov = cache.overview

  const renderRows = (rows, cols) => (
    <Table>
      <TableHeader><TableRow>{cols.map(c => <TableHead key={c.h} className={c.center ? 'text-center' : ''}>{c.h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {(rows || []).map((r, i) => (
          <TableRow key={r.id || i}>
            {cols.map(c => <TableCell key={c.h} className={`text-xs ${c.center ? 'text-center' : ''}`}>{c.v(r)}</TableCell>)}
          </TableRow>
        ))}
        {(!rows || rows.length === 0) && <TableRow><TableCell colSpan={cols.length} className="text-center text-slate-400 py-6">لا توجد بيانات</TableCell></TableRow>}
      </TableBody>
    </Table>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1"><ArrowRight className="w-4 h-4" /> رجوع للمكاتب</Button>
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center"><Building2 className="w-5 h-5" /></div>
          <div>
            <div className="font-extrabold text-lg leading-tight">{office.name}</div>
            <div className="text-[10px] text-slate-500">Office 360° — عرض قراءة فقط</div>
          </div>
          <StatusBadge status={office.status} />
        </div>
        <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 bg-amber-50"><Lock className="w-3 h-3" /> قراءة فقط — لا تعديل قيود/أرصدة/سندات</Badge>
        <Button size="sm" variant="outline" className="text-purple-600 border-purple-300" onClick={impersonate}>🎭 دخول كـ (الآلية القائمة)</Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${tab === t.key ? 'bg-blue-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100 border'}`}>
            {t.label}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => loadTab(tab, true)} className="h-7 gap-1 text-slate-500"><RefreshCw className="w-3 h-3" /></Button>
      </div>

      {loading && !data && <Card><CardContent className="py-10 text-center text-slate-400">جارِ التحميل…</CardContent></Card>}

      {/* ===== OVERVIEW ===== */}
      {tab === 'overview' && ov && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <MiniStat icon={Users} label="المستخدمون" value={n2(ov.counts?.users)} />
            <MiniStat icon={Ticket} label="التذاكر" value={n2(ov.counts?.tickets)} />
            <MiniStat icon={FileBadge2} label="التأشيرات" value={n2(ov.counts?.visas)} />
            <MiniStat icon={Briefcase} label="الخدمات" value={n2(ov.counts?.services)} />
            <MiniStat icon={Package} label="الباكجات / الحجوزات" value={`${n2(ov.counts?.packages)} / ${n2(ov.counts?.package_bookings)}`} />
            <MiniStat icon={Receipt} label="السندات" value={n2(ov.counts?.vouchers)} />
            <MiniStat icon={Calculator} label="القيود المحاسبية" value={n2(ov.counts?.journal_entries)} />
            <MiniStat icon={Users} label="العملاء / الموردون" value={`${n2(ov.counts?.clients)} / ${n2(ov.counts?.suppliers)}`} />
            <MiniStat icon={Wallet} label="الصناديق والبنوك" value={n2(ov.counts?.boxes)} />
            <MiniStat icon={ListTree} label="COA Version" value={ov.coa?.version ?? '—'} />
            <MiniStat icon={CreditCard} label="معراج (مفعل/وارد)" value={`${ov.meraaj?.module_enabled === true ? '✓' : ov.meraaj?.module_enabled === false ? '✗' : '—'} / ${n2(ov.meraaj?.inbound_count)}`} />
            <MiniStat icon={Eye} label="آخر نشاط" value={dt(ov.last_activity)} />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">💰 المبيعات (إجمالي مخزن حسب العملة)</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>التذاكر</span><CurMap map={ov.sales_by_currency?.tickets} /></div>
                <div className="flex justify-between"><span>التأشيرات</span><CurMap map={ov.sales_by_currency?.visas} /></div>
                <div className="flex justify-between"><span>الخدمات</span><CurMap map={ov.sales_by_currency?.services} /></div>
                <div className="text-[10px] text-slate-400">الأرباح: غير متاحة من endpoint إداري موثوق — Data Gap (لا حساب موازٍ)</div>
              </CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">🧾 السندات + الأرصدة المخزنة</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>المقبوضات</span><CurMap map={ov.vouchers_totals?.received} /></div>
                <div className="flex justify-between"><span>المصروفات (صرف)</span><CurMap map={ov.vouchers_totals?.paid} /></div>
                <div className="flex justify-between"><span>أرصدة العملاء (مخزنة)</span><CurMap map={ov.stored_balances?.clients} /></div>
                <div className="flex justify-between"><span>أرصدة الموردين (مخزنة)</span><CurMap map={ov.stored_balances?.suppliers} /></div>
              </CardContent></Card>
          </div>
          <Card><CardContent className="py-3 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-2 items-center">
            <span>👤 المالك: <b>{ov.owner?.name || '—'}</b></span>
            <span dir="ltr">{ov.owner?.email || '—'}</span>
            <span dir="ltr">📞 {ov.owner?.phone || '—'}</span>
            <span dir="ltr">💬 {ov.owner?.whatsapp || '—'}</span>
            {/* v5.2 — نقطة 1: تواصل مباشر — واتساب للرقم المسجل كواتساب فقط، واتصال للهاتف */}
            {ov.owner?.whatsapp && (
              <a href={`https://wa.me/${String(ov.owner.whatsapp).replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700">💬 واتساب</a>
            )}
            {ov.owner?.phone && (
              <a href={`tel:${String(ov.owner.phone).replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700">📞 اتصال</a>
            )}
            <span>الباقة: <b>{ov.tenant?.plan_tier || '—'}</b> · الاشتراك: <b>{ov.tenant?.subscription || '—'}</b></span>
            <span>حصة القيود: <b dir="ltr">{ov.tenant?.journal_quota ? `${ov.tenant.journal_quota.used ?? 0}/${ov.tenant.journal_quota.limit ?? '∞'}` : '—'}</b></span>
            <span>تسجيل: {dt(ov.tenant?.created_at)}</span>
          </CardContent></Card>
        </div>
      )}

      {/* ===== USERS ===== */}
      {tab === 'users' && data && renderRows(data.users, [
        { h: 'الاسم', v: r => <b>{r.name || '—'}</b> },
        { h: 'البريد', v: r => <span dir="ltr">{r.email || '—'}</span> },
        { h: 'الهاتف', v: r => <span dir="ltr">{r.phone || r.whatsapp || '—'}</span> },
        { h: 'الدور', v: r => r.role || '—', center: true },
        { h: 'نشط', v: r => (r.active === false ? '✗' : '✓'), center: true },
        { h: 'أُنشئ', v: r => dt(r.created_at) },
      ])}

      {/* ===== BRANCHES (v5.0 — Enterprise only) ===== */}
      {tab === 'branches' && <BranchesTab office={office} />}

      {/* ===== OFFICE STATEMENT (v5.2 — نقطة 8) ===== */}
      {tab === 'statement' && <StatementTab office={office} />}

      {/* ===== SALES ===== */}
      {tab === 'sales' && data && (
        <div className="space-y-4">
          <div className="text-[11px] text-slate-500">{data.note}</div>
          {[['🎫 التذاكر', data.tickets, r => r.passenger_name], ['🛂 التأشيرات', data.visas, r => r.passenger_name], ['🧰 الخدمات', data.services, r => r.beneficiary_name || r.service_type], ['📦 حجوزات الباكجات', data.bookings, r => r.pilgrim_name]].map(([title, rows, nameOf]) => (
            <Card key={title}><CardHeader className="pb-2"><CardTitle className="text-sm">{title} ({rows?.length ?? 0})</CardTitle></CardHeader>
              <CardContent>{renderRows(rows, [
                { h: 'الاسم', v: r => nameOf(r) || '—' },
                { h: 'التاريخ', v: r => dt(r.date || r.created_at) },
                { h: 'التكلفة', v: r => n2(r.cost ?? r.total_cost), center: true },
                { h: 'البيع', v: r => n2(r.sale_price ?? r.total_sale ?? r.total), center: true },
                { h: 'العملة', v: r => r.currency || '—', center: true },
                { h: 'الدفع', v: r => r.payment_method || '—', center: true },
              ])}</CardContent></Card>
          ))}
        </div>
      )}

      {/* ===== VOUCHERS ===== */}
      {tab === 'vouchers' && data && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(data.totals || []).map((t, i) => (
              <Badge key={i} variant="outline" className="gap-1 text-xs">
                {t.type === 'receipt' ? '⬇️ قبض' : t.type === 'payment' ? '⬆️ صرف' : t.type} · <span dir="ltr">{n2(t.total)} {t.currency}</span> · {t.count} سند
              </Badge>
            ))}
          </div>
          {renderRows(data.vouchers, [
            { h: 'النوع', v: r => (r.type === 'receipt' ? '⬇️ قبض' : r.type === 'payment' ? '⬆️ صرف' : r.type), center: true },
            { h: 'المبلغ', v: r => <span dir="ltr">{n2(r.amount)} {r.currency}</span>, center: true },
            { h: 'الطرف', v: r => r.party_name || r.client_name || r.supplier_name || '—' },
            { h: 'البيان', v: r => <span className="text-slate-500">{(r.description || r.notes || '—').slice(0, 60)}</span> },
            { h: 'التاريخ', v: r => dt(r.date || r.created_at) },
          ])}
        </div>
      )}

      {/* ===== ACCOUNTING ===== */}
      {tab === 'accounting' && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MiniStat icon={Calculator} label="إجمالي القيود" value={n2(data.journal_count)} />
            <MiniStat icon={ListTree} label="COA Version" value={data.coa?.version ?? '—'} />
            <MiniStat icon={ListTree} label="حساب 3102 (أرباح مبقاة)" value={data.coa?.retained_earnings_3102 ? '✓ موجود' : '✗ غير موجود'} />
            <MiniStat icon={Lock} label="قفل الفترة حتى" value={data.coa?.period_lock || '—'} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(data.accounts_by_type || []).map(a => <Badge key={a.type} variant="outline" className="text-xs">{a.type}: {a.count}</Badge>)}
          </div>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">📒 آخر القيود (قراءة فقط)</CardTitle></CardHeader>
            <CardContent>{renderRows(data.journal, [
              { h: 'التاريخ', v: r => dt(r.date) },
              { h: 'البيان', v: r => <span className="text-slate-600">{(r.description || '—').slice(0, 70)}</span> },
              { h: 'المرجع', v: r => r.ref_type || '—', center: true },
              { h: 'الأسطر', v: r => r.lines_count, center: true },
              { h: 'إجمالي مدين', v: r => <span dir="ltr">{n2(r.total_debit)} {r.currency}</span>, center: true },
            ])}</CardContent></Card>
        </div>
      )}

      {/* ===== CLIENTS / SUPPLIERS ===== */}
      {(tab === 'clients' || tab === 'suppliers') && data && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-500"><Lock className="w-3 h-3" /> {data.note} · الإجمالي: <CurMap map={data.totals} /></div>
          {renderRows(data.rows, [
            { h: 'الاسم', v: r => <b>{r.name}{r.is_meraaj_network ? ' 🌐' : ''}</b> },
            { h: 'الهاتف', v: r => <span dir="ltr">{r.phone || '—'}</span> },
            { h: 'كود الحساب', v: r => <span dir="ltr" className="font-mono">{r.account_code || '—'}</span>, center: true },
            { h: 'الرصيد (مخزن)', v: r => <CurMap map={r.balances} /> },
            { h: 'مجمد', v: r => (r.is_frozen ? '🧊' : '—'), center: true },
          ])}
        </div>
      )}

      {/* ===== BOXES ===== */}
      {tab === 'boxes' && data && (
        <div className="space-y-3">
          <div className="text-xs text-slate-500">الإجمالي المخزن: <CurMap map={data.totals} /></div>
          {renderRows(data.rows, [
            { h: 'الاسم', v: r => <b>{r.name}</b> },
            { h: 'النوع', v: r => (r.type === 'cash' ? 'صندوق' : r.type === 'bank' ? 'بنك' : r.type || '—'), center: true },
            { h: 'العملة', v: r => r.currency || '—', center: true },
            { h: 'الرصيد (مخزن)', v: r => <CurMap map={r.balances} /> },
            { h: 'كود الحساب', v: r => <span dir="ltr" className="font-mono">{r.account_code || '—'}</span>, center: true },
          ])}
        </div>
      )}

      {/* ===== SUBSCRIPTION ===== */}
      {tab === 'subscription' && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MiniStat icon={CreditCard} label="الاشتراك" value={data.subscription?.subscription || '—'} />
            <MiniStat icon={CreditCard} label="الباقة" value={data.subscription?.plan_tier || '—'} />
            <MiniStat icon={Users} label="حد المستخدمين / الفروع" value={`${(data.subscription?.max_users === 0 || data.subscription?.max_users == null) ? '∞' : data.subscription.max_users} / ${(data.subscription?.max_branches === 0 || data.subscription?.max_branches == null) ? '∞' : data.subscription.max_branches}`} />
            <MiniStat icon={Calculator} label="حصة القيود" value={data.subscription?.journal_quota ? `${data.subscription.journal_quota.used ?? 0}/${data.subscription.journal_quota.limit ?? '∞'}` : '—'} />
          </div>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">💳 الأقساط (من /admin/installments-overview القائم)</CardTitle></CardHeader>
            <CardContent>
              {installments === null ? <div className="text-slate-400 text-sm py-4 text-center">جارِ التحميل…</div> : renderRows(installments, [
                { h: 'الباقة', v: r => r.plan || r.plan_tier || '—' },
                { h: 'المسدد', v: r => r.paid_display || r.paid || '—', center: true },
                { h: 'القسط القادم', v: r => r.next_due || r.next_installment || '—' },
                { h: 'الحالة', v: r => (r.overdue ? <Badge className="bg-rose-100 text-rose-700">متأخر</Badge> : <Badge className="bg-emerald-100 text-emerald-700">منتظم</Badge>), center: true },
              ])}
            </CardContent></Card>
        </div>
      )}

      {/* ===== ACTIVITY ===== */}
      {tab === 'activity' && data && (
        <div className="space-y-2">
          <div className="text-[11px] text-slate-500">{data.note}</div>
          {renderRows(data.activity, [
            { h: 'النوع', v: r => <Badge variant="outline" className="text-[10px]">{r.kind}</Badge>, center: true },
            { h: 'البيان', v: r => r.label },
            { h: 'الوقت', v: r => dtt(r.at) },
          ])}
        </div>
      )}
    </div>
  )
}

// ============================ OFFICES LIST ============================
const OfficesSection = () => {
  const [data, setData] = useState(null)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const load = async () => { try { setData(await api('/admin/tenants')) } catch (e) { toast.error(e.message) } }
  useEffect(() => { load() }, [])

  if (selected) return <Office360 office={selected} onBack={() => setSelected(null)} />

  const tenants = (data?.tenants || []).filter(t =>
    !q || (t.name || '').includes(q) || (t.owner?.name || '').includes(q) || (t.owner?.email || '').includes(q)
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 بحث بالاسم / المالك / البريد…" className="max-w-xs bg-white" />
        <Badge variant="outline">{tenants.length} مكتب</Badge>
        <Button size="sm" variant="outline" onClick={load} className="gap-1 h-8"><RefreshCw className="w-3.5 h-3.5" /> تحديث</Button>
        <div className="text-[10px] text-slate-400 mr-auto">إدارة الحالة/الباقات/الاستعادة ما تزال في اللوحة الكلاسيكية (مرحلة انتقالية)</div>
      </div>
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>المكتب</TableHead>
              <TableHead>المالك</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
              <TableHead className="text-center">الباقة</TableHead>
              <TableHead className="text-center">الاشتراك</TableHead>
              <TableHead className="text-center">المستخدمون</TableHead>
              <TableHead className="text-center">حد الفروع</TableHead>
              <TableHead>تاريخ الإنشاء</TableHead>
              <TableHead className="text-center">عرض</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {!data && <TableRow><TableCell colSpan={9} className="text-center text-slate-400 py-8">جارِ التحميل…</TableCell></TableRow>}
              {data && tenants.map(t => (
                <TableRow key={t.id} className="hover:bg-slate-50">
                  <TableCell className="font-bold">{t.name}</TableCell>
                  <TableCell className="text-xs">
                    <div>{t.owner?.name || '—'}</div>
                    <div className="text-slate-400" dir="ltr">{t.owner?.email || '—'}{t.owner?.phone ? ` · ${t.owner.phone}` : ''}</div>
                  </TableCell>
                  <TableCell className="text-center"><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-center text-xs">{t.plan_tier || '—'}</TableCell>
                  <TableCell className="text-center text-xs">{t.subscription || '—'}</TableCell>
                  <TableCell className="text-center">{t.users_count ?? '—'}</TableCell>
                  <TableCell className="text-center">{t.max_branches ?? '—'}</TableCell>
                  <TableCell className="text-xs text-slate-500">{dt(t.created_at)}</TableCell>
                  <TableCell className="text-center">
                    <Button size="sm" onClick={() => setSelected(t)} className="h-8 gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs"><Eye className="w-3.5 h-3.5" /> 360°</Button>
                  </TableCell>
                </TableRow>
              ))}
              {data && tenants.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-slate-400 py-8">لا نتائج</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default OfficesSection
