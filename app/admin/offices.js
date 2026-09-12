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
  { key: 'sales', label: 'المبيعات' },
  { key: 'vouchers', label: 'السندات' },
  { key: 'accounting', label: 'الحسابات' },
  { key: 'clients', label: 'العملاء' },
  { key: 'suppliers', label: 'الموردون' },
  { key: 'boxes', label: 'الصناديق' },
  { key: 'subscription', label: 'الاشتراك' },
  { key: 'activity', label: 'النشاط' },
]

// ============================ OFFICE 360° ============================
export const Office360 = ({ office, onBack }) => {
  const [tab, setTab] = useState('overview')
  const [cache, setCache] = useState({})
  const [loading, setLoading] = useState(false)
  const [installments, setInstallments] = useState(null)
  const data = cache[tab]

  const loadTab = async (t, force = false) => {
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
          <Card><CardContent className="py-3 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
            <span>👤 المالك: <b>{ov.owner?.name || '—'}</b></span>
            <span dir="ltr">{ov.owner?.email || '—'}</span>
            <span dir="ltr">{ov.owner?.phone || '—'}</span>
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
            <MiniStat icon={Users} label="حد المستخدمين / الفروع" value={`${data.subscription?.max_users ?? '—'} / ${data.subscription?.max_branches ?? '—'}`} />
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
