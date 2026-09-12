'use client'
import React, { useEffect, useMemo, useState, useCallback, useRef, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import {
  Plane, FileBadge2, LayoutDashboard, Users, Building2, ReceiptText, Wallet, Percent, Inbox, Bell, MapPin,
  ArrowDownLeft, ArrowUpRight, ArrowRight, BookOpenText, BarChart3, PieChart as PieIcon,
  Plus, Search, Calendar, TrendingUp, DollarSign, Sparkles, LogOut,
  Filter, ChevronLeft, ChevronDown, Activity, Banknote, Loader2, Landmark, ShieldCheck,
  Building, Settings, Upload, Download, FileSpreadsheet, CheckCircle2, XCircle,
  AlertTriangle, Trash2, Power, User, Image as ImageIcon, Printer, Key, Pencil, Eye,
  ArrowLeftRight, Briefcase, CalendarClock, LogIn, Package, Copy, RefreshCw,
  Menu, X,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
// v3.87.5 — shared primitives + heavy screens extracted verbatim (structural move only)
import { CUR_SYMBOL, CUR_NAME, CURRENCIES, fmt, readFileB64, DOC_OK_TYPES, DOC_MAX_MB, DOC_MAX_FILE_BYTES, DOC_BATCH_MAX_MB, DOC_BATCH_MAX_BYTES, validateDocBatch, todayISO, api, AuthCtx, useAuth, Field, TopBar, ConfirmHost, askConfirm } from './shared'

// v4.1 — MOVED AS-IS from the v3.91–3.97 admin shell into TenantApp «إدارة رحّال»
// (transfer only — zero new sections, same components, same /api/admin/* endpoints):
import AdminStaffCenter from './admin/staff' // إدارة المستخدمين (v3.97)
import AdminPermsCenter from './admin/perms' // الأدوار والصلاحيات (v3.93)

import AdminCommissionsCenter from './admin/commissions' // مركز العمولات (v3.94)
import AdminNotifyCenter from './admin/notifications' // v4.3 — مركز التنبيهات (moved as-is)
import AdminRequestsCenter from './admin/requests' // v4.3 — الطلبات المتخصصة القائمة (moved as-is)
// v4.4 — scope-correction consolidation: existing components reused as TABS (no copies, no new engines)
import OfficesSection, { Office360 } from './admin/offices' // Office 360° viewer
import AdminSystemCenter from './admin/system'
import AdminAuditCenter from './admin/audit'
import AdminBackupCenter from './admin/backup'
import AdminHealthCenter from './admin/health'
import AdminCurrencyCenter from './admin/currency'
import AdminGeoCenter from './admin/geo'
import AdminPayFinCenter from './admin/payfin'
import { MeraajStoreScreen, BulkImportDialog } from './components-heavy'

// ================================================================
// UTILS + AUTH

// v3.9.13 — Error Boundary to isolate crashes in individual tab sections
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', this.props.tabName, error, info) }
  reset = () => this.setState({ hasError: false, error: null })
  render() {
    if (this.state.hasError) {
      const msg = String(this.state.error?.message || this.state.error || 'خطأ غير متوقع')
      return (
        <div className="p-6 md:p-10">
          <div className="max-w-2xl mx-auto bg-white border-2 border-rose-200 rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-l from-rose-500 to-orange-500 px-6 py-4 text-white">
              <div className="text-xl font-bold">⚠️ حدث خطأ في هذا القسم</div>
              <div className="text-xs opacity-90 mt-1">{this.props.tabName || 'قسم'} — لا داعي للقلق، باقي الأقسام تعمل بشكل طبيعي</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 border rounded-lg text-xs font-mono text-slate-700 break-all max-h-32 overflow-y-auto">{msg}</div>
              <div className="text-sm text-slate-600">💡 قد يكون السبب سجلاً قديماً ينقصه حقل ضروري. جرّب:</div>
              <ul className="text-sm text-slate-600 space-y-1 mr-4 list-disc">
                <li>الضغط على "إعادة المحاولة" أدناه</li>
                <li>الانتقال إلى قسم آخر ثم العودة</li>
                <li>إبلاغ الإدارة بلقطة شاشة إذا استمرت المشكلة</li>
              </ul>
              <div className="flex gap-2 pt-2">
                <button onClick={this.reset} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg">🔄 إعادة المحاولة</button>
                <button onClick={() => window.location.reload()} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2 rounded-lg">↻ تحديث الصفحة</button>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}


// ================================================================

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
// v3.77 — documents upload helpers (base64 transport, MIME whitelist mirrors the server)
// v3.87 — semantic COA anchors (mirror of the backend COA map — single source per side)
const COA_FE = { CASHBOXES: '1101', BANKS: '1102', CLIENTS: '1103', SUPPLIERS: '2101', CAPITAL: '3101', RETAINED_EARNINGS: '3102', OPENING_EQUITY: '3103' }

const fmtTime = (d) => d ? new Date(d).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'
// v3.80 — UNIFIED document-date input: never accepts a future date (issue/voucher/journal dates).
// Travel & service dates keep using the plain date input (future allowed).
const DocDateInput = ({ value, onChange, ...props }) => (
  <Input type="date" max={todayISO()} value={value} onChange={e => {
    const v = e.target.value
    if (v && v > todayISO()) { toast.error('لا يمكن أن يكون تاريخ المستند بعد تاريخ اليوم'); return }
    onChange(v)
  }} {...props} />
)

// v3.2 — WhatsApp helpers
// Normalizes a phone: keeps digits only. If starts with 0, replaces with default country code (967 Yemen).
// If no country code present (< 12 chars) and starts with 5/7 (SA/YE mobile), prefixes 966/967.
function normalizeWaPhone(raw) {
  if (!raw) return ''
  let d = String(raw).replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  // Local mobile heuristic: leading 0 → drop, then prefix best-guess (default 967 Yemen)
  if (d.startsWith('0')) d = '967' + d.slice(1)
  // If it's short (like 7xxxxxxx, 9 digits) prefix 967
  if (d.length === 9 && d.startsWith('7')) d = '967' + d
  if (d.length === 9 && d.startsWith('5')) d = '966' + d
  return d
}
function waLink(phone, message = '') {
  const p = normalizeWaPhone(phone)
  if (!p) return ''
  const q = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${p}${q}`
}
function openWhatsApp(phone, message = '') {
  const url = waLink(phone, message)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
// Smart templates for tickets / visas / services
function tplTicket(t) {
  const name = t.passenger_name || t.client_name || 'العميل'
  const date = t.travel_date ? new Date(t.travel_date).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }) : ''
  const time = t.departure_time || ''
  if (t.travel_mode === 'land') {
    return `عزيزي العميل ${name}،\nنود إشعارك بأن موعد انطلاق رحلتك البرية غداً ${date}${time ? ` في تمام الساعة ${time}` : ''}.\n⚠️ نرجو التواجد في محطة النقل قبل موعد الرحلة بـ ساعة واحدة.\nرافقتكم السلامة! 🚌`
  }
  return `عزيزي العميل ${name}،\nنود إشعارك بأن موعد إقلاع رحلتك الجوية غداً ${date}${time ? ` في تمام الساعة ${time}` : ''}.\n⚠️ نرجو التواجد في المطار قبل موعد الرحلة بـ 4 ساعات لإتمام إجراءات السفر.\nرافقتكم السلامة! ✈️`
}
function tplVisaExpiry(v) {
  const name = v.passenger_name || v.client_name || 'العميل'
  const date = v.expected_exit_date ? new Date(v.expected_exit_date).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }) : ''
  return `عزيزي العميل ${name}،\nنود تذكيرك بأن صلاحية تأشيرتك تنتهي بتاريخ ${date}.\nيرجى استكمال إجراءات المغادرة/التجديد تجنباً لأي غرامات. 🛂`
}
function tplService(s) {
  const name = s.beneficiary_name || s.client_name || 'العميل'
  const ref = s.reference_no ? ` — رقم مرجعي ${s.reference_no}` : ''
  return `عزيزي العميل ${name}،\nخدمة ${s.service_type || ''}${ref} — للاستفسار أو التأكيد، تواصل معنا مباشرة.`
}



// ================================================================
// LOGIN
// ================================================================
// ============ v2.8.1 — Brand Components (Target Media theme: royal blue + orange) ============
function RahaalLogo({ size = 'md', variant = 'dark' }) {
  const sizeMap = { sm: { box: 40, text: 'text-lg', ar: 'text-xl' }, md: { box: 56, text: 'text-2xl', ar: 'text-3xl' }, lg: { box: 76, text: 'text-4xl', ar: 'text-5xl' } }
  const s = sizeMap[size] || sizeMap.md
  const arColor = variant === 'light' ? 'text-white' : 'text-[#1e3a8a]'
  const enColor = variant === 'light' ? 'text-orange-400' : 'text-[#f97316]'
  return (
    <div className="inline-flex items-center gap-3">
      <div className="relative" style={{ width: s.box, height: s.box }}>
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#1e3a8a] via-[#1e40af] to-[#0f1e4d] shadow-xl shadow-blue-900/40 flex items-center justify-center">
          <svg viewBox="0 0 64 64" fill="none" style={{ width: s.box * 0.6, height: s.box * 0.6 }} xmlns="http://www.w3.org/2000/svg">
            <path d="M8 40 L28 36 L40 20 L50 20 L44 34 L54 32 L58 40 L44 42 L38 50 L30 50 L34 42 L14 44 Z" fill="#f97316" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
            <circle cx="52" cy="16" r="3" fill="#f97316" />
          </svg>
        </div>
        <div className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-[#f97316] border-2 border-white shadow" />
      </div>
      <div className="text-right leading-none">
        <div className={`font-extrabold tracking-tight ${s.ar} ${arColor}`}>رحّـــال</div>
        <div className={`font-black tracking-widest ${s.text} ${enColor}`} style={{ letterSpacing: '0.15em' }}>RAHAL</div>
      </div>
    </div>
  )
}

function TargetMediaBadge({ dark = false }) {
  const textCol = dark ? 'text-slate-300' : 'text-slate-600'
  const tmBlue = dark ? 'text-blue-300' : 'text-[#1e3a8a]'
  return (
    <div className="inline-flex items-center gap-2">
      <div className={`text-[11px] ${textCol}`}>Powered by</div>
      <div className="inline-flex items-center gap-1.5">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="#1e3a8a" strokeWidth="2.5" />
          <circle cx="12" cy="12" r="5" fill="#f97316" />
          <circle cx="12" cy="12" r="1.5" fill="#fff" />
        </svg>
        <div className={`text-xs font-black ${tmBlue}`}>Target Media</div>
        <span className={`text-[10px] ${textCol}`}>· تارجت ميديا</span>
      </div>
    </div>
  )
}

function RahaalFooter({ dark = false }) {
  const textCol = dark ? 'text-slate-400' : 'text-slate-600'
  return (
    <div className={`mt-6 text-center text-xs ${textCol} space-y-2`}>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span>📍 اليمن - عدن - الشيخ عثمان - بجانب بنك التضامن</span>
        <span>·</span>
        <span dir="ltr">📞 +967 781 115 482</span>
        <span>·</span>
        <span dir="ltr">📞 +967 781 455 584</span>
      </div>
      <div className="flex items-center justify-center gap-3 pt-2 border-t border-slate-700/30">
        <TargetMediaBadge dark={dark} />
        <span className={textCol}>© {new Date().getFullYear()}</span>
      </div>
    </div>
  )
}

function LoginPage({ onLogin, onBack, initialSignup }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // If user came here from "اشترك الآن", redirect to /signup route (which exists)
  useEffect(() => {
    if (initialSignup && typeof window !== 'undefined') {
      window.location.href = '/signup'
    }
  }, [initialSignup])

  const submit = async (e) => {
    e?.preventDefault()
    if (!email || !password) return toast.error('أدخل البريد وكلمة المرور')
    try {
      setLoading(true)
      const r = await api('/auth/login', { method: 'POST', body: { email, password } })
      onLogin(r)
      toast.success('مرحباً بك في رحّـــال')
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  // v3.12 — Forgot password (admin-mediated request)
  const [mode, setMode] = useState('login')
  const [fpEmail, setFpEmail] = useState('')
  const [fpNote, setFpNote] = useState('')
  const [fpLoading, setFpLoading] = useState(false)
  const [fpSent, setFpSent] = useState(false)
  const sendForgot = async () => {
    if (!fpEmail || !fpEmail.includes('@')) return toast.error('أدخل بريدك الإلكتروني المسجل')
    try {
      setFpLoading(true)
      await api('/auth/forgot-password', { method: 'POST', body: { email: fpEmail, note: fpNote } })
      setFpSent(true)
    } catch (e) { toast.error(e.message) }
    finally { setFpLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1e4d] via-[#1e3a8a] to-[#0f1e4d] p-4">
      <div className="absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(249,115,22,0.35), transparent 45%), radial-gradient(circle at 80% 80%, rgba(30,64,175,0.4), transparent 45%)' }} />
      <div className="relative w-full max-w-md animate-fade-in">
        {onBack && (
          <button onClick={onBack} className="mb-4 text-slate-300 hover:text-white text-sm font-semibold flex items-center gap-2">
            <ArrowRight className="w-4 h-4" /> الصفحة الرئيسية
          </button>
        )}
        <div className="text-center mb-6">
          <RahaalLogo size="lg" variant="light" />
          <p className="text-slate-300 text-sm mt-2">نظام محاسبة مكاتب السفريات السحابي</p>
        </div>

        <Card className="border-blue-900/60 bg-slate-900/80 backdrop-blur-xl shadow-2xl">
          <CardHeader>
            <CardTitle className="text-white">تسجيل الدخول</CardTitle>
            <CardDescription className="text-slate-400">أدخل بيانات حسابك للوصول للنظام</CardDescription>
          </CardHeader>
          <CardContent>
            {mode === 'forgot' ? (
              <div className="space-y-4">
                {fpSent ? (
                  <div className="text-center space-y-3 py-4">
                    <div className="text-4xl">📨</div>
                    <div className="text-emerald-300 font-bold">تم استلام طلبك بنجاح</div>
                    <div className="text-slate-300 text-sm">ستقوم الإدارة بمعالجة الطلب وتعيين كلمة مرور جديدة لك، ثم التواصل معك قريباً.</div>
                    <Button variant="outline" onClick={() => { setMode('login'); setFpSent(false); setFpEmail(''); setFpNote('') }} className="mt-2">← العودة لتسجيل الدخول</Button>
                  </div>
                ) : (
                  <>
                    <div className="text-slate-300 text-sm">أدخل بريدك الإلكتروني المسجل وسيصل طلبك إلى الإدارة لتعيين كلمة مرور جديدة والتواصل معك.</div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">البريد الإلكتروني</Label>
                      <Input dir="ltr" type="email" value={fpEmail} onChange={e => setFpEmail(e.target.value)} placeholder="you@company.com" className="bg-slate-800 border-slate-700 text-white" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">ملاحظة للإدارة (اختياري)</Label>
                      <Input value={fpNote} onChange={e => setFpNote(e.target.value)} placeholder="مثال: رقم جوالي للتواصل 77xxxxxxx" className="bg-slate-800 border-slate-700 text-white" />
                    </div>
                    <Button onClick={sendForgot} disabled={fpLoading} className="w-full grad-brand text-white h-11 font-bold">
                      {fpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '📨 إرسال الطلب للإدارة'}
                    </Button>
                    <div className="text-center">
                      <button type="button" onClick={() => setMode('login')} className="text-xs text-slate-400 hover:text-slate-200">← العودة لتسجيل الدخول</button>
                    </div>
                  </>
                )}
              </div>
            ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">البريد الإلكتروني</Label>
                <Input dir="ltr" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="bg-slate-800 border-slate-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">كلمة المرور</Label>
                <Input dir="ltr" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="bg-slate-800 border-slate-700 text-white" />
              </div>
              <div className="text-left">
                <button type="button" onClick={() => setMode('forgot')} className="text-xs text-slate-400 hover:text-orange-300 font-semibold">🔑 نسيت كلمة المرور؟</button>
              </div>
              <Button type="submit" disabled={loading} className="w-full grad-brand text-white h-11 font-bold">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'دخول'}
              </Button>
            </form>
            )}
            <div className="text-center mt-3">
              <a href="/signup" className="text-xs text-orange-300 hover:text-orange-200 font-bold">🎁 ليس لديك حساب؟ احصل على 30 قيد عند التسجيل، و+50 قيد إضافي عند دعوة أي مكتب آخر</a>
            </div>
          </CardContent>
        </Card>
        <RahaalFooter dark />
      </div>
    </div>
  )
}

// ================================================================
// SUPER ADMIN PANEL
// ================================================================
// v3.77 — OFFICE VERIFICATION (توثيق المكتب): upload license/owner-id documents, track review
// status (unverified → pending_review → verified | rejected + reason), re-upload after rejection.
function OfficeVerificationCard() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const [ver, setVer] = useState(null)
  const [busy, setBusy] = useState(false)
  const [docType, setDocType] = useState('license')
  const loadVer = useCallback(async () => { try { setVer(await api('/office/verification')) } catch { /* silent */ } }, [])
  useEffect(() => { loadVer() }, [loadVer])
  const VER_BADGE = {
    unverified: { label: 'غير موثق', cls: 'bg-slate-100 text-slate-600' },
    pending_review: { label: '⏳ قيد المراجعة', cls: 'bg-amber-100 text-amber-700' },
    verified: { label: '✅ مكتب موثق', cls: 'bg-emerald-100 text-emerald-700' },
    rejected: { label: '❌ مرفوض — أعد الرفع', cls: 'bg-rose-100 text-rose-700' },
  }
  const DOC_TYPE_LABELS = { license: '📜 السجل / الترخيص', owner_id: '🪪 هوية المالك / المسؤول', other: '📎 مستند آخر' }
  const upload = async (fileList) => {
    const valid = validateDocBatch(fileList)
    if (!valid.length) return

    setBusy(true)
    let okCount = 0
    let lastStatus = null

    for (const f of valid) {
      try {
        const file_base64 = await readFileB64(f)
        const r = await api('/office/verification/documents', {
          method: 'POST',
          body: {
            doc_type: docType,
            filename: f.name,
            content_type: f.type,
            file_base64
          }
        })
        okCount += 1
        lastStatus = r.verification_status
      } catch (e) {
        toast.error(`${f.name}: ${e.message}`)
      }
    }

    setBusy(false)

    if (okCount > 0) {
      toast.success(
        lastStatus === 'pending_review'
          ? `📤 رُفع ${okCount} مستند — مكتبك الآن قيد المراجعة للتوثيق`
          : `📤 رُفع ${okCount} مستند بنجاح`
      )
      loadVer()
    }
  }
  const delDoc = async (d) => {
    try { await api(`/office/verification/documents/${d.id}`, { method: 'DELETE' }); toast.success('حُذف المستند'); loadVer() } catch (e) { toast.error(e.message) }
  }
  const st = ver?.status || 'unverified'
  const badge = VER_BADGE[st] || VER_BADGE.unverified
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          🛡️ توثيق المكتب / مستندات المكتب
          <Badge className={`${badge.cls} hover:${badge.cls}`}>{badge.label}</Badge>
          {ver?.storage_driver === 'db' && <span className="text-[9px] font-normal text-slate-400">(تخزين مؤقت آمن — جاهز للترحيل إلى S3)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {st === 'rejected' && ver?.reject_reason && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
            <b>سبب الرفض:</b> {ver.reject_reason}
            <div className="text-[10px] text-rose-500 mt-0.5">صحّح المستندات وأعد رفعها — سيعود المكتب تلقائياً لقائمة المراجعة.</div>
          </div>
        )}
        {st === 'verified' && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">مكتبك موثق ✅ — حالة التوثيق تُشارك تلقائياً مع شبكة معراج (رحّال هو مصدر هوية المكتب، لا حاجة لإعادة رفع المستندات هناك).</div>}
        {st === 'unverified' && <div className="text-[11px] text-slate-500">التوثيق اختياري بعد إنشاء الحساب ويرفع موثوقية مكتبك في شبكة معراج. ارفع السجل/الترخيص وهوية المسؤول وسيراجعها فريق المنصة.</div>}
        {isOwner && st !== 'verified' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 border p-2.5">
            <select value={docType} onChange={e => setDocType(e.target.value)} className="h-8 text-xs border rounded-md px-2 bg-white font-bold">
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className={`h-8 inline-flex items-center gap-1.5 text-xs font-bold border rounded-md px-3 cursor-pointer bg-white hover:bg-slate-100 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '📤'} رفع مستندات (متعدد)
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
            </label>
            <span className="text-[10px] text-slate-400">PDF / JPG / PNG / WEBP — حتى {DOC_MAX_MB}MB لكل ملف و{DOC_BATCH_MAX_MB}MB إجمالاً للدفعة — يمكن اختيار عدة ملفات</span>
          </div>
        )}
        {(ver?.documents || []).length > 0 && (
          <div className="space-y-1">
            {(ver.documents || []).map(d => (
              <div key={d.id} className="flex items-center gap-2 text-xs border rounded-lg px-2.5 py-1.5 bg-white">
                <span className="font-bold">{(DOC_TYPE_LABELS[d.doc_type] || DOC_TYPE_LABELS.other)}</span>
                <span className="text-slate-500 truncate flex-1" dir="ltr">{d.filename}</span>
                <span className="text-[9px] text-slate-400">{((d.size || 0) / 1024).toFixed(0)}KB • {fmtDate(d.uploaded_at)}</span>
                <button onClick={() => window.open(`/api/office/verification/documents/${d.id}/download`, '_blank')} className="text-indigo-600 hover:underline text-[10px] font-bold">عرض</button>
                {isOwner && st !== 'verified' && <button onClick={() => delDoc(d)} className="text-rose-500 hover:text-rose-700 text-xs font-black px-1" title="حذف">✕</button>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// v3.99 — Batch 1: Rahaal company home — dashboard tab content for the PLATFORM
// SUPER ADMIN only (other offices keep the original travel Dashboard untouched).
// Every number comes from the OLD live admin APIs (/admin/tenants,
// /admin/password-reset-requests, /admin/installments-overview) — zero new
// endpoints, zero new collections, and NO tickets/visas KPIs by design.
function RahaalAdminHome({ setTab }) {
  const [data, setData] = useState(null)
  const [resets, setResets] = useState([])
  const [inst, setInst] = useState([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [d, rr, ins] = await Promise.all([
        api('/admin/tenants'),
        api('/admin/password-reset-requests').catch(() => []),
        api('/admin/installments-overview').catch(() => []),
      ])
      setData(d); setResets(rr || []); setInst(ins || [])
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const offices = (data?.tenants || []).filter(t => !t.is_platform_org) // exclude Rahaal's own org
  const active = offices.filter(t => t.status !== 'suspended').length
  const suspended = offices.filter(t => t.status === 'suspended').length
  const trial = offices.filter(t => (t.subscription || 'trial') === 'trial').length
  const paid = offices.filter(t => t.subscription === 'paid').length
  const now = Date.now()
  const expired = offices.filter(t => t.subscription_expires_at && new Date(t.subscription_expires_at).getTime() < now).length
  const expiring = offices.filter(t => { if (!t.subscription_expires_at) return false; const d = new Date(t.subscription_expires_at).getTime() - now; return d >= 0 && d <= 30 * 86400000 }).length
  const totalUsers = offices.reduce((s, t) => s + (t.users_count || 0), 0)
  const pendingResets = resets.filter(r => r.status === 'pending').length
  const overdueInst = inst.filter(r => r.overdue).length
  const recent = [...offices].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 5)
  const alerts = [
    pendingResets > 0 && { icon: '🔑', txt: `${pendingResets} طلب استعادة كلمة مرور معلق` },
    overdueInst > 0 && { icon: '⚠️', txt: `${overdueInst} مكتب لديه قسط متأخر` },
    suspended > 0 && { icon: '⏸️', txt: `${suspended} مكتب موقوف` },
    expiring > 0 && { icon: '⏳', txt: `${expiring} اشتراك ينتهي خلال 30 يوماً` },
    expired > 0 && { icon: '🔴', txt: `${expired} اشتراك منتهٍ` },
  ].filter(Boolean)
  if (loading && !data) return <div className="p-10 text-center text-slate-400">جارِ التحميل...</div>
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-black text-slate-800">🏢 لوحة تحكم شركة رحّال</h2>
          <div className="text-xs text-slate-500">مؤشرات إدارة المنصة — من واجهات الإدارة القديمة الحية</div>
        </div>
        <Button variant="outline" size="sm" onClick={load}>🔄 تحديث</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Building2} label="إجمالي المكاتب" value={offices.length} grad="grad-brand" />
        <StatCard icon={Power} label="المكاتب النشطة" value={active} grad="grad-green" />
        <StatCard icon={AlertTriangle} label="المكاتب الموقوفة" value={suspended} grad="grad-gold" />
        <StatCard icon={Users} label="مستخدمو المنصة" value={totalUsers} grad="grad-teal" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Key} label="اشتراكات تجريبية" value={trial} grad="grad-slate" />
        <StatCard icon={Wallet} label="اشتراكات مدفوعة" value={paid} grad="grad-green" />
        <StatCard icon={ReceiptText} label="تنتهي خلال 30 يوماً" value={expiring} grad="grad-gold" />
        <StatCard icon={AlertTriangle} label="اشتراكات منتهية" value={expired} grad="grad-brand" />
      </div>
      {alerts.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-4 space-y-2">
            <div className="font-black text-amber-900 text-sm">🔔 تنبيهات إدارية تحتاج إجراء</div>
            {alerts.map((a, i) => (
              <button key={i} onClick={() => setTab('platform-offices')} className="w-full text-right flex items-center gap-2 text-sm text-amber-800 hover:underline">
                <span>{a.icon}</span><span>{a.txt}</span><span className="text-[10px] text-amber-600 mr-auto">فتح إدارة المكاتب ←</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" /> آخر المكاتب المسجلة</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>المكتب</TableHead><TableHead>الاشتراك</TableHead><TableHead>الحالة</TableHead><TableHead className="text-center">المستخدمون</TableHead><TableHead>تاريخ التسجيل</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {recent.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-semibold text-sm">{t.name}<div className="text-[10px] text-slate-400 font-mono">{t.slug}</div></TableCell>
                  <TableCell><Badge variant="outline">{t.subscription || 'trial'} • {t.plan_tier || 'standard'}</Badge></TableCell>
                  <TableCell>{t.status === 'suspended' ? <Badge className="bg-rose-100 text-rose-700">⏸️ موقوف</Badge> : <Badge className="bg-emerald-100 text-emerald-700">✅ نشط</Badge>}</TableCell>
                  <TableCell className="text-center text-sm">{t.users_count}/{t.max_users}</TableCell>
                  <TableCell className="text-xs">{fmtDate(t.created_at)}</TableCell>
                </TableRow>
              ))}
              {recent.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-slate-400">لا مكاتب مسجلة بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickAction icon={Building2} label="إدارة المكاتب" grad="grad-brand" onClick={() => setTab('platform-offices')} />
        <QuickAction icon={ImageIcon} label="الإعلانات والعروض" grad="grad-gold" onClick={() => setTab('platform-ads')} />
        <QuickAction icon={Wallet} label="سند قبض" grad="grad-green" onClick={() => setTab('receipt')} />
        <QuickAction icon={BarChart3} label="التقارير المالية" grad="grad-teal" onClick={() => setTab('reports')} />
      </div>
    </div>
  )
}

function SuperAdminPanel({ embedded = false }) {
  const { user, logout } = useAuth()
  const [data, setData] = useState(null)
  const [openNew, setOpenNew] = useState(false)
  const [editing, setEditing] = useState(null)
  const [resetReqs, setResetReqs] = useState([])
  const [resetTarget, setResetTarget] = useState(null)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [instRows, setInstRows] = useState([])
  const [instTarget, setInstTarget] = useState(null)
  const [quotaTarget, setQuotaTarget] = useState(null) // v4.0 — unified «زيادة حصة القيود» dialog
  const [viewing, setViewing] = useState(null) // v4.9 — CRUD: View action → inline Office 360 (reused, no second details page)
  const [tq, setTq] = useState('') // v3.99 — Batch 1: search/filter (embedded mode)
  const load = async () => {
    try {
      const [d, rr, ins] = await Promise.all([
        api('/admin/tenants'),
        api('/admin/password-reset-requests').catch(() => []),
        api('/admin/installments-overview').catch(() => []),
      ])
      setData(d); setResetReqs(rr || []); setInstRows(ins || [])
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [])
  const pendingResets = resetReqs.filter(r => r.status === 'pending')
  const rejectReset = async (r) => {
    if (!(await askConfirm({ title: 'رفض طلب استعادة كلمة المرور', desc: `رفض طلب ${r.email}؟`, icon: '🚫', variant: 'danger', confirmLabel: 'رفض الطلب' }))) return
    try { await api(`/admin/password-reset-requests/${r.id}`, { method: 'PATCH', body: { action: 'reject' } }); toast.success('تم الرفض'); load() } catch (e) { toast.error(e.message) }
  }

  return (
    <div className={embedded ? '' : 'min-h-screen bg-slate-50'}>
      {!embedded && (
      <header className="grad-slate text-white p-6 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl grad-gold flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-2xl font-extrabold">لوحة الإدارة العامة</div>
              <div className="text-sm text-slate-300">Target Media Super Admin</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-left">
              <div className="text-sm font-semibold">{user.name}</div>
              <div className="text-xs text-slate-300">{user.email}</div>
            </div>
            <Button variant="ghost" onClick={logout} className="text-white hover:bg-white/10 gap-2"><LogOut className="w-4 h-4" /> خروج</Button>
          </div>
        </div>
      </header>
      )}

      <div className={embedded ? 'space-y-6' : 'max-w-7xl mx-auto p-6 space-y-6'}>
        {!embedded && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard icon={Building2} label="المكاتب" value={data?.global_stats?.tenants ?? '—'} grad="grad-brand" />
          <StatCard icon={Plane} label="إجمالي التذاكر" value={data?.global_stats?.tickets ?? '—'} grad="grad-green" />
          <StatCard icon={FileBadge2} label="إجمالي التأشيرات" value={data?.global_stats?.visas ?? '—'} grad="grad-gold" />
        </div>}

        {/* v3.12 — Password reset requests inbox (Batch 2 — hidden in embedded mode) */}
        {!embedded && pendingResets.length > 0 && (
          <Card className="border-orange-300 bg-orange-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-orange-900">
                🔑 طلبات استعادة كلمة المرور
                <Badge className="bg-orange-500 text-white">{pendingResets.length} معلق</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>البريد</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>المكتب</TableHead>
                  <TableHead>ملاحظة المستخدم</TableHead>
                  <TableHead>تاريخ الطلب</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pendingResets.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs" dir="ltr">{r.email}</TableCell>
                      <TableCell className="text-sm">{r.user_name || '—'}</TableCell>
                      <TableCell className="text-sm">{r.tenant_name || (r.role === 'super_admin' ? 'إدارة' : '—')}</TableCell>
                      <TableCell className="text-xs text-slate-500 max-w-[200px] truncate" title={r.note}>{r.note || '—'}</TableCell>
                      <TableCell className="text-xs">{r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-center">
                          <Button size="sm" onClick={() => setResetTarget(r)} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs">🔐 تعيين كلمة جديدة</Button>
                          <Button size="sm" variant="outline" onClick={() => rejectReset(r)} className="h-8 text-xs text-rose-600">رفض</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* v3.16 — Installments tracker (Batch 4 — hidden in embedded mode) */}
        {!embedded && instRows.length > 0 && (
          <Card className="border-blue-300 bg-blue-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-blue-900">
                💳 متابعة الأقساط ({instRows.length})
                {instRows.filter(r => r.overdue).length > 0 && <Badge className="bg-rose-600 text-white">⚠️ متأخر: {instRows.filter(r => r.overdue).length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المكتب</TableHead>
                  <TableHead>الباقة</TableHead>
                  <TableHead className="text-center">المسدد</TableHead>
                  <TableHead>القسط القادم</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">إدارة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {instRows.map(r => (
                    <TableRow key={r.id} className={r.overdue ? 'bg-rose-50' : ''}>
                      <TableCell className="font-semibold text-sm">{r.name}</TableCell>
                      <TableCell className="text-xs">{r.plan_tier === 'silver' ? '🥈 سيلفر' : r.plan_tier === 'gold' ? '🥇 جولد' : r.plan_tier === 'enterprise' ? '🏢 إنتربرايز' : '—'}</TableCell>
                      <TableCell className="text-center">
                        <span className="font-black">{r.paid_count}/{r.total_count || '—'}</span>
                        {r.total_count > 0 && <div className="w-20 h-1.5 bg-slate-200 rounded-full mx-auto mt-1"><div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${(r.paid_count / r.total_count) * 100}%` }} /></div>}
                      </TableCell>
                      <TableCell className="text-xs">{r.next_due ? <><b>${r.next_amount}</b> — {r.next_due}</> : (r.total_count === 0 ? 'لم يُجدول بعد' : '—')}</TableCell>
                      <TableCell className="text-center">
                        {r.all_paid
                          ? (r.unlimited_journals ? <Badge className="bg-emerald-600 text-white text-[10px]">✅ مكتمل + قيود مفتوحة</Badge> : <Badge className="bg-amber-500 text-white text-[10px]">💰 مكتمل — افتح القيود!</Badge>)
                          : r.overdue ? <Badge className="bg-rose-600 text-white text-[10px]">⚠️ قسط متأخر</Badge>
                          : r.total_count === 0 ? <Badge variant="outline" className="text-[10px]">بلا جدول</Badge>
                          : <Badge className="bg-blue-500 text-white text-[10px]">⏳ منتظم</Badge>}
                      </TableCell>
                      <TableCell className="text-center"><Button size="sm" variant="outline" onClick={() => setInstTarget(r)} className="h-7 text-xs">💳 إدارة الأقساط</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {viewing ? <Office360 office={viewing} onBack={() => setViewing(null)} /> : <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600" /> إدارة المكاتب (Tenants)</CardTitle>
            <div className="flex gap-2 items-center flex-wrap">
              {embedded && <Input value={tq} onChange={e => setTq(e.target.value)} placeholder="🔍 بحث بالاسم أو المعرف..." className="h-9 w-52" />}
              {!embedded && <Button onClick={() => setPricingOpen(true)} variant="outline" className="gap-2">💲 التسعير والخصومات</Button>}
              <Button onClick={() => setOpenNew(true)} className="grad-brand text-white gap-2"><Plus className="w-4 h-4" /> إنشاء مكتب جديد</Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم المكتب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الاشتراك</TableHead>
                  <TableHead>الإحالة</TableHead>
                  <TableHead className="text-center">المستخدمون</TableHead>
                  <TableHead className="text-center">حصة القيود</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.tenants || []).filter(t => !embedded || (!t.is_platform_org && (!tq.trim() || `${t.name} ${t.slug || ''}`.includes(tq.trim())))).map(t => {
                  const q = t.journal_quota || { used: 0, limit: 500 }
                  const pct = q.limit ? (q.used / q.limit) * 100 : 0
                  return (
                    <TableRow key={t.id}>
                      <TableCell><div className="font-semibold">{t.name}</div><div className="text-xs text-slate-500 font-mono">{t.slug}</div></TableCell>
                      <TableCell>
                        {t.status === 'suspended'
                          ? <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">⏸️ معلّق</Badge>
                          : <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">✅ نشط</Badge>}
                      </TableCell>
                      <TableCell><Badge variant="outline">{t.subscription || 'trial'} • {t.plan_tier || 'standard'}</Badge></TableCell>
                      <TableCell className="text-xs">
                        <div className="font-mono text-emerald-700 font-bold">{t.referral_code || '—'}</div>
                        {t.referred_by && <div className="text-[10px] text-slate-500 mt-0.5">مُحال بواسطة: <span className="font-mono">{t.referred_by_name || t.referred_by.slice(0,8)}...</span></div>}
                        {t.activation_confirmed && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px] mt-1">✅ دفع مؤكد</Badge>}
                      </TableCell>
                      <TableCell className="text-center">{t.users_count}/{t.max_users}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className={`text-xs font-bold ${pct >= 100 ? 'text-rose-600' : pct >= 90 ? 'text-amber-600' : 'text-slate-700'}`}>{q.used} / {q.limit}</div>
                          <div className="w-20 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className={`h-full ${pct >= 100 ? 'bg-rose-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(t.created_at)}</TableCell>
                      <TableCell className="text-left">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {/* v4.9 — CRUD Tenants Actions: View | Edit | Suspend/Activate | Delete */}
                          <Button size="sm" variant="outline" className="text-blue-600 border-blue-300" onClick={() => setViewing(t)}><Eye className="w-3 h-3" /> عرض</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(t)}><Settings className="w-3 h-3" /> تعديل</Button>
                          <Button size="sm" variant={t.status === 'suspended' ? 'default' : 'outline'} className={t.status === 'suspended' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'text-amber-600 border-amber-300'} onClick={async () => {
                            const action = t.status === 'suspended' ? 'تفعيل' : 'تعليق'
                            if (!(await askConfirm({ title: 'تغيير حالة المكتب', desc: `${action} المكتب "${t.name}"؟`, icon: '🏢', confirmLabel: 'تأكيد' }))) return
                            try { const r = await api(`/admin/tenants/${t.id}/toggle-status`, { method: 'POST' }); toast.success(`تم — الحالة الآن: ${r.status === 'active' ? 'نشط' : 'معلّق'}`); load() }
                            catch (e) { toast.error(e.message) }
                          }}>{t.status === 'suspended' ? '▶️ تفعيل' : '⏸️ تعليق'}</Button>
                          <Button size="sm" variant="outline" disabled className="text-slate-400 border-slate-200 cursor-not-allowed" title="الحذف الصلب غير متاح — يتطلب قرار تصميم (حذف ناعم / أرشيف). استخدم التعليق بدلاً منه."><Trash2 className="w-3 h-3" /> حذف</Button>
                          {!embedded && <Button size="sm" variant="outline" className="text-purple-600 border-purple-300" onClick={async () => {
                            if (!(await askConfirm({ title: `الدخول كمالك المكتب "${t.name}"`, desc: `ستُفتح جلسة مؤقتة (30 دقيقة) في تاب جديد. سيظهر شريط أحمر أعلى الشاشة يذكّرك بحالة الجلسة.`, icon: '👤', confirmLabel: 'فتح الجلسة' }))) return
                            try {
                              const r = await api(`/admin/tenants/${t.id}/impersonate`, { method: 'POST' })
                              window.open('/', '_blank')
                              toast.success(`🎭 جلسة "دخول كـ ${r.tenant.name}" فُتحت في تاب جديد`)
                            } catch (e) { toast.error(e.message) }
                          }}>🎭 دخول كـ</Button>}
                          {!embedded && !t.activation_confirmed && (
                            <Button size="sm" variant="outline" className="text-blue-600 border-blue-300" onClick={async () => {
                              if (!(await askConfirm({ title: 'تأكيد دفع القسط الأول', desc: `تأكيد أن المكتب "${t.name}" قد دفع القسط الأول؟`, icon: '💳', confirmLabel: 'تأكيد الدفع' }))) return
                              try {
                                const r = await api(`/admin/tenants/${t.id}/confirm-payment`, { method: 'POST' })
                                toast.success(r.referrer_bonus ? `✅ تم التأكيد + منح +${r.referrer_bonus.bonus_added} قيد إلى "${r.referrer_bonus.referrer_name}"` : '✅ تم تأكيد الدفع')
                                load()
                              } catch (e) { toast.error(e.message) }
                            }}>💳 تأكيد دفع</Button>
                          )}
                          {!embedded && <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => setQuotaTarget(t)}><Plus className="w-3 h-3" /> زيادة حصة القيود</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {(!data?.tenants || data.tenants.length === 0) && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-400">لا توجد مكاتب. أنشئ المكتب الأول من الأعلى.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>}

        {/* v2.8 — Announcements Management (own tab in embedded mode) */}
        {!embedded && <AnnouncementsManager />}
      </div>

      <NewTenantDialog open={openNew} onOpenChange={setOpenNew} onSaved={() => { load(); setOpenNew(false) }} />
      <EditTenantDialog tenant={editing} onOpenChange={() => setEditing(null)} onSaved={() => { load(); setEditing(null) }} />
      <AdminResetPasswordDialog req={resetTarget} onClose={() => setResetTarget(null)} onDone={load} />
      <PricingConfigDialog open={pricingOpen} onOpenChange={setPricingOpen} />
      <InstallmentsDialog row={instTarget} onClose={() => setInstTarget(null)} onChanged={load} />
      <QuotaIncreaseDialog target={quotaTarget} onClose={() => setQuotaTarget(null)} onChanged={load} />
    </div>
  )
}

function AnnouncementsManager() {
  const [list, setList] = useState([])
  const [openNew, setOpenNew] = useState(false)
  const [form, setForm] = useState({ type: 'popup', title: '', body: '', image_url: '', link_url: '', active: true })
  const load = () => api('/admin/announcements').then(setList).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [])
  const submit = async () => {
    if (!form.title || !form.body) return toast.error('العنوان والنص مطلوبان')
    try { await api('/admin/announcements', { method: 'POST', body: form }); toast.success('✅ تم النشر'); setForm({ type: 'popup', title: '', body: '', image_url: '', link_url: '', active: true }); setOpenNew(false); load() }
    catch (e) { toast.error(e.message) }
  }
  const toggleActive = async (a) => {
    try { await api(`/admin/announcements/${a.id}`, { method: 'PUT', body: { active: !a.active } }); toast.success(a.active ? 'أُوقف الإعلان' : '🚀 تم التفعيل'); load() }
    catch (e) { toast.error(e.message) }
  }
  const del = async (a) => {
    if (!(await askConfirm({ title: 'حذف الإعلان', desc: `حذف الإعلان "${a.title}"؟`, variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/admin/announcements/${a.id}`, { method: 'DELETE' }); toast.success('حُذف'); load() }
    catch (e) { toast.error(e.message) }
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">📢 إدارة الإعلانات والإشعارات</CardTitle>
        <Button onClick={() => setOpenNew(true)} className="grad-gold text-white gap-2"><Plus className="w-4 h-4" /> إعلان جديد</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>النوع</TableHead>
            <TableHead>العنوان</TableHead>
            <TableHead>النص</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead>الفترة</TableHead>
            <TableHead className="text-left">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {list.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-400">لا توجد إعلانات. أنشئ الأول من الأعلى.</TableCell></TableRow>}
            {list.map(a => (
              <TableRow key={a.id}>
                <TableCell><Badge variant={a.type === 'popup' ? 'default' : 'secondary'}>{a.type === 'popup' ? '💬 نافذة' : '📢 شريط'}</Badge></TableCell>
                <TableCell className="font-bold">{a.title}</TableCell>
                <TableCell className="text-xs max-w-[300px] truncate">{a.body}</TableCell>
                <TableCell>{a.active ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">🟢 نشط</Badge> : <Badge className="bg-slate-200 text-slate-600 hover:bg-slate-200">⏸️ متوقف</Badge>}</TableCell>
                <TableCell className="text-xs">{a.starts_at ? fmtDate(a.starts_at) : 'الآن'} → {a.ends_at ? fmtDate(a.ends_at) : 'دائم'}</TableCell>
                <TableCell className="text-left">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(a)}>{a.active ? '⏸️ إيقاف' : '▶️ تفعيل'}</Button>
                    <Button size="sm" variant="outline" className="text-rose-600 border-rose-300" onClick={() => del(a)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>إنشاء إعلان جديد</DialogTitle><DialogDescription>سيظهر لجميع المكاتب حال تسجيل دخولهم أو في أعلى لوحتهم</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Field label="النوع">
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="popup">💬 نافذة منبثقة (تظهر عند تسجيل الدخول)</SelectItem>
                  <SelectItem value="banner">📢 شريط علوي (يظهر باستمرار أعلى الشاشة)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="العنوان" required><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="عرض ترحيبي" /></Field>
            <Field label="النص" required><Textarea rows={4} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="محتوى الإعلان..." /></Field>
            <Field label="رابط الصورة (اختياري)"><Input dir="ltr" value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." /></Field>
            <Field label="رابط المزيد (اختياري)"><Input dir="ltr" value={form.link_url} onChange={e => setForm({ ...form, link_url: e.target.value })} placeholder="https://..." /></Field>
            <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} /><span className="text-sm">تفعيل فوري</span></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenNew(false)}>إلغاء</Button><Button onClick={submit} className="grad-gold text-white">🚀 نشر</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function StatCard({ icon: Icon, label, value, grad }) {
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 ${grad}`} />
      <CardContent className="p-5 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-3xl font-extrabold text-slate-800 mt-1">{value}</div>
        </div>
        <div className={`w-14 h-14 rounded-xl ${grad} flex items-center justify-center shadow-lg`}><Icon className="w-6 h-6 text-white" /></div>
      </CardContent>
    </Card>
  )
}

// v3.12 — Admin sets a new password for a reset request
function AdminResetPasswordDialog({ req, onClose, onDone }) {
  const [pw, setPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [doneInfo, setDoneInfo] = useState(null)
  useEffect(() => { if (req) { setPw(''); setDoneInfo(null) } }, [req])
  const generate = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let s = ''
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)]
    setPw(s)
  }
  const submit = async () => {
    if (!pw || pw.length < 6) return toast.error('كلمة المرور يجب ألا تقل عن 6 أحرف')
    try {
      setSaving(true)
      await api(`/admin/password-reset-requests/${req.id}`, { method: 'PATCH', body: { action: 'reset', new_password: pw } })
      setDoneInfo({ email: req.email, pw })
      toast.success('✅ تم تعيين كلمة المرور الجديدة')
      onDone()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }
  return (
    <Dialog open={!!req} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>🔐 تعيين كلمة مرور جديدة</DialogTitle>
          <DialogDescription dir="ltr" className="text-left font-mono">{req?.email}</DialogDescription>
        </DialogHeader>
        {doneInfo ? (
          <div className="space-y-3 text-center py-2">
            <div className="text-3xl">✅</div>
            <div className="font-bold text-emerald-700">تم التغيير بنجاح</div>
            <div className="p-3 rounded-lg bg-slate-100 border">
              <div className="text-xs text-slate-500 mb-1">بلّغ المستخدم بكلمة المرور الجديدة (لن تظهر مرة أخرى):</div>
              <div className="font-mono font-black text-lg select-all" dir="ltr">{doneInfo.pw}</div>
            </div>
            <Button onClick={() => { navigator.clipboard?.writeText(doneInfo.pw); toast.success('نُسخت') }} variant="outline" size="sm">📋 نسخ الكلمة</Button>
            <DialogFooter><Button onClick={onClose} className="w-full">إغلاق</Button></DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {req?.note && <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2">📝 ملاحظة المستخدم: {req.note}</div>}
              <Field label="كلمة المرور الجديدة" required>
                <div className="flex gap-2">
                  <Input dir="ltr" value={pw} onChange={e => setPw(e.target.value)} placeholder="6 أحرف على الأقل" className="font-mono" />
                  <Button type="button" variant="outline" onClick={generate} className="whitespace-nowrap">🎲 توليد</Button>
                </div>
              </Field>
              <div className="text-[11px] text-slate-500">بعد الحفظ: تُغلق جلسات المستخدم الحالية ويدخل بالكلمة الجديدة فقط. أنت من يبلّغه بها (هاتف/واتساب).</div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>إلغاء</Button>
              <Button onClick={submit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">{saving ? 'جارٍ الحفظ...' : '✅ تعيين وإنهاء الطلب'}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// v3.14 → v4.0 — Super Admin: pricing config editor (the SAME old editor, extracted so it
// can render as a full screen inside TenantApp «إدارة رحّال» AND as the legacy dialog).
// v4.0 adds: description/currency/duration/quota/unlimited/active/sort per plan,
// offer window, default trial plan, full price breakdown and the change-history log.
function PricingConfigEditor({ asScreen = false, onDone }) {
  const [cfg, setCfg] = useState(null)
  const [hist, setHist] = useState([])
  const [saving, setSaving] = useState(false)
  const loadAll = () => {
    api('/admin/pricing-config').then(setCfg).catch(e => toast.error(e.message))
    api('/admin/pricing-config/history').then(h => setHist(h.entries || [])).catch(() => {})
  }
  useEffect(() => { loadAll() }, [])
  const setPlan = (key, patch) => setCfg(c => ({ ...c, plans: c.plans.map(p => p.key === key ? { ...p, ...patch } : p) }))
  const save = async () => {
    try {
      setSaving(true)
      const r = await api('/admin/pricing-config', { method: 'PUT', body: cfg })
      toast.success(`✅ تم حفظ إعدادات التسعير — سُجّل ${r.changes_logged || 0} تغييراً في السجل`)
      loadAll()
      onDone?.()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  if (!cfg) return <div className="text-center py-8 text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /> جاري التحميل...</div>
  const disc = cfg.discount_enabled ? (Number(cfg.discount_percent) || 0) : 0
  const n = Number(cfg.installments_count) || 5
  const dateVal = (v) => v ? String(new Date(v).toISOString()).slice(0, 10) : ''
  const FIELD_LABELS = { discount_enabled: 'تفعيل الخصم', discount_percent: 'نسبة الخصم %', installments_count: 'عدد الأقساط', default_trial_plan_key: 'الباقة الافتراضية للتجربة', offer_start_at: 'بداية العرض', offer_end_at: 'نهاية العرض', name_ar: 'الاسم', description: 'الوصف', currency: 'العملة', duration_days: 'مدة الاشتراك (يوم)', annual_price: 'السعر الأساسي', max_users: 'حد المستخدمين', max_branches: 'حد الفروع', quota_limit: 'حصة القيود', unlimited_journals: 'قيود مفتوحة', active: 'مفعّلة', sort_order: 'الترتيب', features: 'المزايا' }
  const fieldLabel = (f) => { const [pk, fk] = String(f).includes('.') ? String(f).split('.') : [null, f]; const pl = pk ? (cfg.plans.find(p => p.key === pk)?.name_ar || pk) + ' — ' : ''; return pl + (FIELD_LABELS[fk] || fk) }
  const fmtVal = (v) => v === true ? 'نعم' : v === false ? 'لا' : (v === null || v === undefined || v === '') ? '—' : String(v).length > 24 ? String(v).slice(0, 24) + '…' : String(v)
  return (
    <div className="space-y-4">
      {asScreen && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-extrabold flex items-center gap-2">💲 الباقات والتسعير والخصومات</h2>
            <div className="text-xs text-slate-500">أي تغيير ينعكس آلياً على شاشة الباقات لدى المشتركين — ولا يمس اشتراكات أو أقساطاً سابقة بأثر رجعي</div>
          </div>
          <Button onClick={save} disabled={saving} className="grad-brand text-white">{saving ? 'جارٍ الحفظ...' : '💾 حفظ ونشر التسعير'}</Button>
        </div>
      )}
      {/* التسعير والخصومات — flexible discount + offer window + installments count */}
      <div className={`p-3 rounded-lg border-2 ${cfg.discount_enabled ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'}`}>
        <div className="text-xs font-black text-slate-700 mb-2">🔥 التسعير والخصومات</div>
        <div className="flex items-center gap-4 flex-wrap">
          <Button type="button" size="sm" onClick={() => setCfg({ ...cfg, discount_enabled: !cfg.discount_enabled })}
            className={cfg.discount_enabled ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-slate-300 hover:bg-slate-400 text-slate-700'}>
            {cfg.discount_enabled ? '🔥 الخصم مفعّل' : '⭕ الخصم متوقف'}
          </Button>
          <div className="flex items-center gap-2">
            <Label className="text-xs">نسبة الخصم %</Label>
            <Input type="number" min="0" max="95" value={cfg.discount_percent} onChange={e => setCfg({ ...cfg, discount_percent: Number(e.target.value) })} className="w-24 font-black text-center" disabled={!cfg.discount_enabled} />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">عدد الأقساط</Label>
            <Input type="number" min="1" max="24" value={cfg.installments_count} onChange={e => setCfg({ ...cfg, installments_count: Number(e.target.value) })} className="w-20 font-black text-center" />
          </div>
          {/* v4.0 — offer window (فارغ = الخصم دائم ما دام مفعلاً) */}
          <div className="flex items-center gap-2">
            <Label className="text-xs">بداية العرض</Label>
            <Input type="date" value={dateVal(cfg.offer_start_at)} onChange={e => setCfg({ ...cfg, offer_start_at: e.target.value || null })} className="w-36 text-xs" disabled={!cfg.discount_enabled} />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">نهاية العرض</Label>
            <Input type="date" value={dateVal(cfg.offer_end_at)} onChange={e => setCfg({ ...cfg, offer_end_at: e.target.value || null })} className="w-36 text-xs" disabled={!cfg.discount_enabled} />
          </div>
        </div>
        <div className="text-[10px] text-slate-500 mt-2">معنى الخصم: {disc}% خصم = المشترك يدفع {100 - disc}% من السعر الأساسي. إلغاء الخصم = 0%. ترك تاريخي العرض فارغين = خصم دائم ما دام مفعلاً.</div>
      </div>
      {/* إدارة الباقات — plans editor with live breakdown */}
      <div className="text-xs font-black text-slate-700">📦 إدارة الباقات <span className="font-normal text-slate-400">(القيم الحالية افتراضية وقابلة للتعديل بالكامل)</span></div>
      <div className="grid md:grid-cols-3 gap-3">
        {cfg.plans.slice().sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)).map(p => {
          const base = Number(p.annual_price) || 0
          const final = Math.round(base * (100 - disc)) / 100
          const discountValue = Math.round((base - final) * 100) / 100
          const cur = (p.currency || 'USD') === 'USD' ? '$' : `${p.currency} `
          return (
            <Card key={p.key} className={`border-2 ${p.active === false ? 'opacity-60 border-dashed' : ''}`}>
              <CardHeader className="pb-2 bg-slate-50">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{p.icon} {p.name_ar} <span className="text-[10px] text-slate-400 font-mono">({p.key})</span></span>
                  <Button type="button" size="sm" variant={p.active === false ? 'outline' : 'default'}
                    className={p.active === false ? 'h-6 text-[10px] text-rose-600' : 'h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white'}
                    onClick={() => setPlan(p.key, { active: p.active === false })}>
                    {p.active === false ? '⛔ معطّلة' : '✅ مفعّلة'}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="اسم الباقة"><Input value={p.name_ar} onChange={e => setPlan(p.key, { name_ar: e.target.value })} /></Field>
                  <Field label="ترتيب الظهور"><Input type="number" min="0" value={p.sort_order ?? 0} onChange={e => setPlan(p.key, { sort_order: Number(e.target.value) })} /></Field>
                </div>
                <Field label="وصف الباقة"><Textarea rows={2} value={p.description || ''} onChange={e => setPlan(p.key, { description: e.target.value })} className="text-xs" placeholder="وصف يظهر للمشتركين..." /></Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="السعر الأساسي"><Input type="number" min="0" value={p.annual_price} onChange={e => setPlan(p.key, { annual_price: Number(e.target.value) })} className="font-black" /></Field>
                  <Field label="العملة"><Input value={p.currency || 'USD'} onChange={e => setPlan(p.key, { currency: e.target.value.toUpperCase() })} dir="ltr" className="text-center" /></Field>
                  <Field label="المدة (يوم)"><Input type="number" min="1" value={p.duration_days || 365} onChange={e => setPlan(p.key, { duration_days: Number(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="المستخدمون (0=∞)"><Input type="number" min="0" value={p.max_users} onChange={e => setPlan(p.key, { max_users: Number(e.target.value) })} /></Field>
                  <Field label="الفروع (0=∞) ⚠️ غير مفعل تشغيلياً حالياً"><Input type="number" min="0" value={p.max_branches} onChange={e => setPlan(p.key, { max_branches: Number(e.target.value) })} /></Field>
                  <Field label="حصة القيود (0=يدوي)"><Input type="number" min="0" value={p.quota_limit || 0} onChange={e => setPlan(p.key, { quota_limit: Number(e.target.value) })} /></Field>
                </div>
                <div className="flex items-center justify-between p-2 rounded border bg-slate-50">
                  <span className="text-[11px] font-bold">{p.unlimited_journals ? '♾️ الباقة تمنح قيوداً مفتوحة' : '🔒 قيود محدودة بالحصة'}</span>
                  <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setPlan(p.key, { unlimited_journals: !p.unlimited_journals })}>{p.unlimited_journals ? 'إلغاء' : 'منح ∞'}</Button>
                </div>
                <label className="flex items-center gap-2 p-2 rounded border cursor-pointer bg-blue-50/50 text-[11px]">
                  <input type="radio" name="default_trial_plan" checked={cfg.default_trial_plan_key === p.key} onChange={() => setCfg({ ...cfg, default_trial_plan_key: p.key })} />
                  <span className="font-bold">الباقة الافتراضية للتجربة</span> <span className="text-slate-400">(حدودها تُطبق على التسجيلات الجديدة)</span>
                </label>
                <Field label={`المزايا (سطر لكل ميزة — ${(p.features || []).length})`}>
                  <Textarea rows={5} value={(p.features || []).join('\n')} onChange={e => setPlan(p.key, { features: e.target.value.split('\n') })} className="text-xs" />
                </Field>
                {/* v4.0 — full breakdown: أساسي / نسبة / قيمة الخصم / نهائي */}
                <div className="p-2 rounded bg-blue-50 border border-blue-200 text-[11px] space-y-0.5">
                  <div className="font-bold text-blue-800">معاينة حية:</div>
                  <div>السعر الأساسي: <b>{cur}{base}</b> · نسبة الخصم: <b>{disc}%</b> · قيمة الخصم: <b className="text-rose-600">-{cur}{discountValue}</b></div>
                  <div>السعر النهائي سنوياً: {disc > 0 && <span className="line-through text-slate-400">{cur}{base}</span>} <b className="text-slate-900">{cur}{disc > 0 ? final : base}</b> <span className="text-slate-400">(يدفع {100 - disc}%)</span></div>
                  <div>القسط: {disc > 0 && <span className="line-through text-slate-400">{cur}{Math.round((base / n) * 100) / 100}</span>} <b className="text-slate-900">{cur}{Math.round(((disc > 0 ? final : base) / n) * 100) / 100}</b> × {n}</div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ تذكير: مراقبة التأشيرات وإدارة البكجات متاحة في جميع الباقات بلا استثناء — أبقِها ضمن المزايا الثلاث. تغيير الأسعار/الخصم لا يمس اشتراكات أو أقساطاً قائمة — يسري على الجديد فقط، إلا بتدخل يدوي صريح على مكتب محدد.</div>
      {!asScreen && (
        <DialogFooter>
          <Button onClick={save} disabled={saving} className="grad-brand text-white">{saving ? 'جارٍ الحفظ...' : '💾 حفظ ونشر التسعير'}</Button>
        </DialogFooter>
      )}
      {/* v4.0 — change history: who / when / old → new */}
      {asScreen && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">🕘 سجل تغييرات الباقات والخصومات ({hist.length})</CardTitle></CardHeader>
          <CardContent>
            {hist.length === 0 ? <div className="text-center text-slate-400 text-sm py-3">لا توجد تغييرات مسجلة بعد — أول حفظ سيبدأ السجل</div> : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {hist.map((h, i) => (
                  <div key={i} className="p-2 rounded border bg-slate-50 text-[11px]">
                    <div className="flex items-center justify-between font-bold text-slate-700">
                      <span>👤 {h.by}</span>
                      <span className="font-mono text-slate-500">{h.at ? new Date(h.at).toLocaleString('ar-EG') : '—'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(h.changes || []).map((c, j) => (
                        <span key={j} className="px-1.5 py-0.5 rounded bg-white border text-slate-600">{fieldLabel(c.field)}: <b className="text-rose-600">{fmtVal(c.from)}</b> ← <b className="text-emerald-700">{fmtVal(c.to)}</b></span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Legacy thin wrapper — the old «💲 التسعير والخصومات» dialog now renders the SAME editor
function PricingConfigDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>💲 إعدادات التسعير والخصومات</DialogTitle>
          <DialogDescription>أي تغيير هنا ينعكس آلياً على شاشة الباقات لدى جميع المشتركين</DialogDescription>
        </DialogHeader>
        {open && <PricingConfigEditor onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

// v3.16 — Installments management dialog (schedule + per-installment toggle + open-quota shortcut)
function InstallmentsDialog({ row, onClose, onChanged }) {
  const [list, setList] = useState([])
  const [init, setInit] = useState({ total: 250, count: 5, start_date: new Date().toISOString().slice(0, 10) })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (row) setList(row.installments || []) }, [row])
  if (!row) return null
  const allPaid = list.length > 0 && list.every(i => i.paid)
  const generate = async () => {
    if (!Number(init.total)) return toast.error('أدخل المبلغ الإجمالي')
    if (list.length > 0 && !(await askConfirm({ title: 'استبدال الجدول الحالي', desc: 'سيتم استبدال الجدول الحالي بالكامل.', icon: '🔄', variant: 'danger', confirmLabel: 'استبدال' }))) return
    try {
      setBusy(true)
      const r = await api(`/admin/tenants/${row.id}/installments`, { method: 'PUT', body: init })
      setList(r.installments); toast.success('✅ تم إنشاء جدول الأقساط'); onChanged()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const togglePaid = async (ins) => {
    try {
      const r = await api(`/admin/tenants/${row.id}/installments`, { method: 'PATCH', body: { no: ins.no, paid: !ins.paid } })
      setList(l => l.map(x => x.no === ins.no ? { ...x, paid: !ins.paid, paid_at: !ins.paid ? new Date().toISOString() : null } : x))
      onChanged()
      if (r.all_paid) toast.success('🎉 كل الأقساط مسددة! يمكنك الآن فتح القيود للمكتب', { duration: 6000 })
    } catch (e) { toast.error(e.message) }
  }
  const openQuota = async () => {
    try {
      await api(`/admin/tenants/${row.id}`, { method: 'PATCH', body: { unlimited_journals: true } })
      toast.success('♾️ تم فتح القيود المحاسبية للمكتب'); onChanged(); onClose()
    } catch (e) { toast.error(e.message) }
  }
  return (
    <Dialog open={!!row} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>💳 أقساط: {row.name}</DialogTitle>
          <DialogDescription>جدولة ومتابعة سداد الأقساط — {row.plan_tier ? `الباقة: ${row.plan_tier}` : 'بدون باقة'}</DialogDescription></DialogHeader>
        {/* Schedule generator */}
        <div className="p-3 rounded-lg border bg-slate-50 space-y-2">
          <div className="text-xs font-bold text-slate-600">{list.length > 0 ? '🔄 إعادة جدولة (تستبدل الحالي)' : '➕ إنشاء جدول أقساط'}</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="الإجمالي $"><Input type="number" min="0" value={init.total} onChange={e => setInit({ ...init, total: Number(e.target.value) })} className="font-bold" /></Field>
            <Field label="عدد الأقساط"><Input type="number" min="1" max="24" value={init.count} onChange={e => setInit({ ...init, count: Number(e.target.value) })} /></Field>
            <Field label="أول استحقاق"><Input type="date" value={init.start_date} onChange={e => setInit({ ...init, start_date: e.target.value })} /></Field>
          </div>
          <Button size="sm" onClick={generate} disabled={busy} variant="outline" className="w-full border-blue-300 text-blue-700">📅 توليد الجدول (شهري)</Button>
        </div>
        {/* Installments list */}
        {list.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-3">لا يوجد جدول أقساط بعد</div>
        ) : (
          <div className="space-y-1.5">
            {list.map(ins => {
              const overdue = !ins.paid && ins.due_date < new Date().toISOString().slice(0, 10)
              return (
                <div key={ins.no} className={`flex items-center justify-between p-2 rounded-lg border ${ins.paid ? 'bg-emerald-50 border-emerald-200' : overdue ? 'bg-rose-50 border-rose-300' : 'bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${ins.paid ? 'bg-emerald-500 text-white' : 'bg-slate-200'}`}>{ins.no}</span>
                    <div>
                      <div className="text-sm font-bold">${ins.amount}</div>
                      <div className="text-[10px] text-slate-500">استحقاق: {ins.due_date}{overdue && <span className="text-rose-600 font-bold"> — متأخر!</span>}{ins.paid && ins.paid_at && <span className="text-emerald-600"> — سُدد {String(ins.paid_at).slice(0, 10)}</span>}</div>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => togglePaid(ins)} variant={ins.paid ? 'outline' : 'default'} className={ins.paid ? 'h-7 text-xs text-rose-600' : 'h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white'}>
                    {ins.paid ? '↩️ تراجع' : '✅ تسجيل السداد'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        {allPaid && !row.unlimited_journals && (
          <Button onClick={openQuota} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold">🎉 كل الأقساط مسددة — ♾️ فتح القيود المحاسبية الآن</Button>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>إغلاق</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v4.0 — «زيادة حصة القيود» (renamed from the misleading «إضافة رصيد»): it raises the
// JOURNAL-ENTRIES quota — it adds NO money to any wallet. ONE path only: POST /topup.
function QuotaIncreaseDialog({ target, onClose, onChanged }) {
  const [amount, setAmount] = useState(500)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [opId, setOpId] = useState(null) // v4.0.1 — idempotency key per dialog session
  useEffect(() => { if (target) setOpId((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`) }, [target])
  if (!target) return null
  const q = target.journal_quota || { used: 0, limit: 0 }
  const remaining = Math.max(0, (q.limit || 0) - (q.used || 0))
  const submit = async () => {
    const n = Number(amount)
    if (!n || n < 1) return toast.error('أدخل مقدار الزيادة')
    if (!note.trim()) return toast.error('سبب الزيادة مطلوب')
    try {
      setBusy(true)
      const r = await api(`/admin/tenants/${target.id}/topup`, { method: 'POST', body: { amount: n, note, op_id: opId } })
      toast.success(r.duplicate ? 'ℹ️ هذه العملية نُفذت مسبقاً — لم تُنشأ زيادة ثانية' : `✅ زيدت حصة القيود: ${r.quota.prev_limit} ← ${r.quota.new_limit} (المتبقي الآن ${r.quota.remaining})`)
      onChanged(); onClose()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!target} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>➕ زيادة حصة القيود: {target.name}</DialogTitle>
          <DialogDescription>تزيد حصة قيود اليومية فقط — لا تضيف أي أموال إلى محفظة المكتب</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded border bg-slate-50"><div className="text-[10px] text-slate-500">الحصة الحالية</div><div className="font-black">{q.limit ?? 0}</div></div>
          <div className="p-2 rounded border bg-amber-50"><div className="text-[10px] text-slate-500">المستخدم</div><div className="font-black text-amber-700">{q.used ?? 0}</div></div>
          <div className="p-2 rounded border bg-emerald-50"><div className="text-[10px] text-slate-500">المتبقي</div><div className="font-black text-emerald-700">{remaining}</div></div>
        </div>
        <Field label="مقدار الزيادة (عدد القيود) *"><Input type="number" min="1" max="1000000" value={amount} onChange={e => setAmount(e.target.value)} className="font-black" /></Field>
        <Field label="سبب الزيادة *"><Input value={note} onChange={e => setNote(e.target.value)} placeholder="مثال: تجديد اشتراك سنوي / تعويض / عرض ترويجي" /></Field>
        <div className="text-[10px] text-slate-500">تُسجَّل العملية باسم المنفذ والتاريخ والسبب في سجل زيادات المكتب (top_ups).</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white">{busy ? '...' : '➕ تنفيذ الزيادة'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v4.0 — Batch 2: «الاشتراكات والأقساط» screen inside TenantApp — reuses the OLD APIs
// and dialogs verbatim (confirm-payment v2.8, installments v3.16, unlimited toggle v3.14,
// EditTenantDialog overrides). Demo→Paid conversion lives here.
function PlatformSubscriptionsScreen() {
  const [data, setData] = useState(null)
  const [instRows, setInstRows] = useState([])
  const [instTarget, setInstTarget] = useState(null)
  const [editing, setEditing] = useState(null)
  const [quotaTarget, setQuotaTarget] = useState(null)
  const [q, setQ] = useState('')
  const load = async () => {
    try {
      const [d, ins] = await Promise.all([
        api('/admin/tenants'),
        api('/admin/installments-overview').catch(() => []),
      ])
      setData(d); setInstRows(ins || [])
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [])
  const insById = {}
  for (const r of instRows) insById[r.id] = r
  const tenants = (data?.tenants || []).filter(t => !t.is_platform_org && (!q.trim() || `${t.name} ${t.slug || ''}`.includes(q.trim())))
  const trialCount = tenants.filter(t => (t.subscription || 'trial') === 'trial').length
  const paidCount = tenants.filter(t => t.subscription === 'paid' || t.activation_confirmed).length
  const overdueCount = instRows.filter(r => r.overdue).length
  const confirmPayment = async (t) => {
    if (!(await askConfirm({ title: 'تحويل إلى مدفوع (Demo → Paid)', desc: `تأكيد أن المكتب "${t.name}" قد دفع؟ سيُفعَّل الاشتراك المدفوع فوراً.`, icon: '💳', confirmLabel: 'تأكيد الدفع' }))) return
    try {
      const r = await api(`/admin/tenants/${t.id}/confirm-payment`, { method: 'POST' })
      toast.success(r.referrer_bonus ? `✅ تم التأكيد + منح +${r.referrer_bonus.bonus_added} قيد إلى "${r.referrer_bonus.referrer_name}"` : '✅ تم تأكيد الدفع — المكتب مدفوع الآن')
      load()
    } catch (e) { toast.error(e.message) }
  }
  const toggleUnlimited = async (t) => {
    const next = !t.unlimited_journals
    if (!(await askConfirm({ title: next ? '♾️ فتح القيود المحاسبية' : '🔒 إغلاق القيود المحاسبية', desc: next ? `فتح قيود غير محدودة للمكتب "${t.name}"؟ (مثلاً بعد سداد آخر قسط أو دفع سنوي)` : `إعادة المكتب "${t.name}" إلى الحصة المحدودة؟`, icon: next ? '♾️' : '🔒', confirmLabel: 'تأكيد' }))) return
    try { await api(`/admin/tenants/${t.id}`, { method: 'PATCH', body: { unlimited_journals: next } }); toast.success(next ? '♾️ فُتحت القيود' : '🔒 أُغلقت القيود'); load() }
    catch (e) { toast.error(e.message) }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-extrabold">💳 الاشتراكات والأقساط</h2>
          <div className="text-xs text-slate-500">التحويل من تجريبي إلى مدفوع، جدولة الأقساط، فتح/إغلاق القيود، وزيادة حصة القيود</div>
        </div>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 بحث بالاسم..." className="h-9 w-52" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">المكاتب</div><div className="text-xl font-black">{tenants.length}</div></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">تجريبي</div><div className="text-xl font-black text-amber-600">{trialCount}</div></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">مدفوع</div><div className="text-xl font-black text-emerald-600">{paidCount}</div></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">أقساط متأخرة</div><div className={`text-xl font-black ${overdueCount ? 'text-rose-600' : 'text-slate-700'}`}>{overdueCount}</div></CardContent></Card>
      </div>
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>المكتب</TableHead>
              <TableHead>الاشتراك</TableHead>
              <TableHead>الباقة · الدفع</TableHead>
              <TableHead className="text-center">حصة القيود</TableHead>
              <TableHead className="text-center">الأقساط</TableHead>
              <TableHead>انتهاء الاشتراك</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {tenants.map(t => {
                const qta = t.journal_quota || { used: 0, limit: 0 }
                const ins = insById[t.id]
                const isPaid = t.subscription === 'paid' || t.activation_confirmed
                const expired = t.subscription_expires_at && new Date(t.subscription_expires_at) < new Date()
                return (
                  <TableRow key={t.id} className={ins?.overdue ? 'bg-rose-50/60' : ''}>
                    <TableCell><div className="font-semibold text-sm">{t.name}</div><div className="text-[10px] text-slate-400 font-mono">{t.slug}</div></TableCell>
                    <TableCell>
                      {isPaid
                        ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">💰 مدفوع</Badge>
                        : <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">🧪 تجريبي</Badge>}
                      {t.activation_confirmed && <div className="text-[9px] text-emerald-600 mt-0.5">✅ دفع مؤكد</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{t.plan_tier === 'silver' ? '🥈 سيلفر' : t.plan_tier === 'gold' ? '🥇 جولد' : t.plan_tier === 'enterprise' ? '🏢 إنتربرايز' : t.plan_tier || '—'}</div>
                      <div className="text-[10px] text-slate-500">{t.billing_mode === 'annual' ? '📅 سنوي' : t.billing_mode === 'installments' ? '💳 أقساط' : '—'} {t.unlimited_journals && <span className="text-emerald-600 font-bold">♾️</span>}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="text-xs font-bold">{t.unlimited_journals ? '♾️ مفتوحة' : `${qta.used} / ${qta.limit}`}</div>
                      {!t.unlimited_journals && <div className="text-[9px] text-slate-400">متبقٍ {Math.max(0, (qta.limit || 0) - (qta.used || 0))}</div>}
                    </TableCell>
                    <TableCell className="text-center">
                      {ins && ins.total_count > 0 ? (
                        <div>
                          <span className="text-xs font-black">{ins.paid_count}/{ins.total_count}</span>
                          {ins.overdue && <Badge className="bg-rose-600 text-white text-[9px] mr-1">متأخر</Badge>}
                          {ins.all_paid && <Badge className="bg-emerald-600 text-white text-[9px] mr-1">مكتمل</Badge>}
                        </div>
                      ) : <span className="text-[10px] text-slate-400">بلا جدول</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.subscription_expires_at ? <span className={expired ? 'text-rose-600 font-bold' : ''}>{String(t.subscription_expires_at).slice(0, 10)}{expired && ' ⚠️'}</span> : '—'}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {!t.activation_confirmed && <Button size="sm" variant="outline" className="h-7 text-[11px] text-blue-600 border-blue-300" onClick={() => confirmPayment(t)}>💳 تأكيد الدفع</Button>}
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setInstTarget({ id: t.id, name: t.name, plan_tier: t.plan_tier, installments: (insById[t.id]?.installments) || t.installments || [], unlimited_journals: !!t.unlimited_journals })}>📅 الأقساط</Button>
                        <Button size="sm" variant="outline" className={`h-7 text-[11px] ${t.unlimited_journals ? 'text-rose-600' : 'text-emerald-600'}`} onClick={() => toggleUnlimited(t)}>{t.unlimited_journals ? '🔒 إغلاق القيود' : '♾️ فتح القيود'}</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] text-emerald-700" onClick={() => setQuotaTarget(t)}>➕ زيادة حصة القيود</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEditing(t)}><Settings className="w-3 h-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {tenants.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-400">لا توجد مكاتب</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <InstallmentsDialog row={instTarget} onClose={() => setInstTarget(null)} onChanged={load} />
      <EditTenantDialog tenant={editing} onOpenChange={v => { if (!v) setEditing(null) }} onSaved={() => { setEditing(null); load() }} />
      <QuotaIncreaseDialog target={quotaTarget} onClose={() => setQuotaTarget(null)} onChanged={load} />
    </div>
  )
}

// v4.2 — «مبيعات برنامج رحّال»: PROGRAM sales (plans/subscriptions/renewals) built on
// EXISTING data only (tenants + pricing_config + installments + confirm-payment) —
// NO parallel sales engine, NO travel data (tickets/visas/services are excluded by design).
// A true draft-sale object with its own timeline needs a NEW collection → pending approval.
function ProgramSalesScreen() {
  const [data, setData] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [instRows, setInstRows] = useState([])
  const [editing, setEditing] = useState(null)
  const [instTarget, setInstTarget] = useState(null)
  const [q, setQ] = useState('')
  const [fPlan, setFPlan] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const load = async () => {
    try {
      const [d, c, ins] = await Promise.all([
        api('/admin/tenants'),
        api('/admin/pricing-config').catch(() => null),
        api('/admin/installments-overview').catch(() => []),
      ])
      setData(d); setCfg(c); setInstRows(ins || [])
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [])
  const insById = {}; for (const r of instRows) insById[r.id] = r
  const disc = cfg?.discount_enabled ? (Number(cfg.discount_percent) || 0) : 0
  const saleRow = (t) => {
    const p = (cfg?.plans || []).find(x => x.key === t.plan_tier)
    const base = p ? Number(p.annual_price) || 0 : null
    const final = base !== null ? Math.round(base * (100 - disc)) / 100 : null
    const ins = insById[t.id]
    const paidAmt = (ins?.installments || t.installments || []).filter(i => i.paid).reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const totalAmt = Number(t.subscription_price) || final || 0
    const isPaid = t.subscription === 'paid' || t.activation_confirmed
    const status = isPaid ? 'مدفوع/مفعل'
      : paidAmt > 0 ? 'دفع جزئي'
        : ['silver', 'gold', 'enterprise'].includes(t.plan_tier) ? 'بانتظار الدفع'
          : 'تجريبي (بلا بيع)'
    return { t, p, base, final, ins, paidAmt, totalAmt, remaining: Math.max(0, totalAmt - paidAmt), status, currency: p?.currency || 'USD' }
  }
  const rows = (data?.tenants || []).filter(t => !t.is_platform_org).map(saleRow)
    .filter(r => (fPlan === 'all' || r.t.plan_tier === fPlan))
    .filter(r => (fStatus === 'all' || r.status === fStatus))
    .filter(r => !q.trim() || `${r.t.name} ${r.t.slug || ''}`.includes(q.trim()))
  const confirmPayment = async (t) => {
    if (!(await askConfirm({ title: 'اعتماد البيع وتأكيد الدفع', desc: `اعتماد بيع الباقة للمكتب "${t.name}"؟ يتحول لمدفوع فوراً (لا يمكن تنفيذه مرتين).`, icon: '💳', confirmLabel: 'اعتماد وتأكيد' }))) return
    try { await api(`/admin/tenants/${t.id}/confirm-payment`, { method: 'POST' }); toast.success('✅ اعتُمد البيع — المكتب مدفوع'); load() } catch (e) { toast.error(e.message) }
  }
  const exportCSV = () => {
    const head = ['المكتب', 'الباقة', 'الحالة', 'السعر الأساسي', 'الخصم%', 'السعر النهائي (مرجعي)', 'سعر الاشتراك المسجل', 'العملة', 'طريقة الدفع', 'المدفوع', 'المتبقي', 'بداية التفعيل', 'انتهاء الاشتراك']
    const lines = rows.map(r => [r.t.name, r.t.plan_tier || '', r.status, r.base ?? '', disc, r.final ?? '', r.t.subscription_price || '', r.currency, r.t.billing_mode || '', r.paidAmt, r.remaining, r.t.activation_confirmed_at ? String(r.t.activation_confirmed_at).slice(0, 10) : '', r.t.subscription_expires_at ? String(r.t.subscription_expires_at).slice(0, 10) : ''])
    const csv = '\ufeff' + [head, ...lines].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `rahaal-program-sales-${todayISO()}.csv`; a.click()
  }
  const st = { 'مدفوع/مفعل': 'bg-emerald-100 text-emerald-700', 'دفع جزئي': 'bg-blue-100 text-blue-700', 'بانتظار الدفع': 'bg-amber-100 text-amber-700', 'تجريبي (بلا بيع)': 'bg-slate-100 text-slate-600' }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-extrabold">📈 مبيعات برنامج رحّال</h2>
          <div className="text-xs text-slate-500">بيع الباقات والاشتراكات والتجديد — فوق بيانات الاشتراكات القائمة (بلا تذاكر/تأشيرات/سفر)</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 بحث..." className="h-9 w-44" />
          <select value={fPlan} onChange={e => setFPlan(e.target.value)} className="h-9 rounded-md border px-2 text-xs bg-white"><option value="all">كل الباقات</option><option value="silver">سيلفر</option><option value="gold">جولد</option><option value="enterprise">إنتربرايز</option></select>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="h-9 rounded-md border px-2 text-xs bg-white"><option value="all">كل الحالات</option><option>بانتظار الدفع</option><option>دفع جزئي</option><option>مدفوع/مفعل</option><option>تجريبي (بلا بيع)</option></select>
          <Button size="sm" variant="outline" onClick={exportCSV}>⬇️ تصدير CSV</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['بانتظار الدفع', 'دفع جزئي', 'مدفوع/مفعل', 'تجريبي (بلا بيع)'].map(s => (
          <Card key={s}><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">{s}</div><div className="text-xl font-black">{rows.filter(r => r.status === s).length}</div></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="pt-4 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>المكتب العميل</TableHead><TableHead>الباقة</TableHead><TableHead>حالة البيع</TableHead>
            <TableHead className="text-center">التسعير المرجعي الحالي</TableHead><TableHead className="text-center">سعر الاشتراك</TableHead>
            <TableHead className="text-center">المدفوع / المتبقي</TableHead><TableHead>الدفع</TableHead><TableHead>البداية → الانتهاء</TableHead><TableHead className="text-left">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(({ t, p, base, final, ins, paidAmt, remaining, status, currency }) => {
              const cur = currency === 'USD' ? '$' : `${currency} `
              return (
                <TableRow key={t.id}>
                  <TableCell><div className="font-semibold text-sm">{t.name}</div><div className="text-[10px] text-slate-400 font-mono">{t.slug}</div></TableCell>
                  <TableCell className="text-xs">{p ? `${p.icon} ${p.name_ar}` : (t.plan_tier || '—')}</TableCell>
                  <TableCell><Badge className={`${st[status]} hover:${st[status]}`}>{status}</Badge></TableCell>
                  <TableCell className="text-center text-xs">{base !== null ? <><span className={disc > 0 ? 'line-through text-slate-400' : 'font-bold'}>{cur}{base}</span>{disc > 0 && <> <b>{cur}{final}</b> <span className="text-rose-600">(-{disc}%)</span></>}</> : '—'}</TableCell>
                  <TableCell className="text-center text-xs font-bold">{t.subscription_price ? `${cur}${t.subscription_price}` : '—'}</TableCell>
                  <TableCell className="text-center text-xs"><span className="text-emerald-700 font-bold">{cur}{paidAmt}</span> / <span className="text-amber-700">{cur}{remaining}</span>{ins?.overdue && <Badge className="bg-rose-600 text-white text-[9px] mr-1">متأخر</Badge>}</TableCell>
                  <TableCell className="text-xs">{t.billing_mode === 'annual' ? '📅 سنوي' : t.billing_mode === 'installments' ? `💳 أقساط ${ins ? `${ins.paid_count}/${ins.total_count}` : ''}` : '—'}</TableCell>
                  <TableCell className="text-[10px]">{t.activation_confirmed_at ? String(t.activation_confirmed_at).slice(0, 10) : '—'} ← {t.subscription_expires_at ? String(t.subscription_expires_at).slice(0, 10) : '—'}</TableCell>
                  <TableCell className="text-left"><div className="flex gap-1 justify-end flex-wrap">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" title="مسودة البيع: الباقة/السعر/العملة/طريقة الدفع/التواريخ" onClick={() => setEditing(t)}>📝 مسودة/تعديل</Button>
                    {!t.activation_confirmed && ['silver', 'gold', 'enterprise'].includes(t.plan_tier) && <Button size="sm" variant="outline" className="h-7 text-[11px] text-blue-600 border-blue-300" onClick={() => confirmPayment(t)}>💳 اعتماد البيع</Button>}
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setInstTarget({ id: t.id, name: t.name, plan_tier: t.plan_tier, installments: (insById[t.id]?.installments) || t.installments || [], unlimited_journals: !!t.unlimited_journals })}>📅 الأقساط</Button>
                  </div></TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-400">لا نتائج</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ حدود موثقة: الإلغاء/الاسترداد المالي غير متاح — لا ربط بعد بين الاعتماد وسندات القبض (فجوة موثقة)، وسجل «مسودة بيع» مستقل بجدول حالات كامل يحتاج Collection جديدة بانتظار موافقتك.</div>
      <EditTenantDialog tenant={editing} onOpenChange={v => { if (!v) setEditing(null) }} onSaved={() => { setEditing(null); load() }} />
      <InstallmentsDialog row={instTarget} onClose={() => setInstTarget(null)} onChanged={load} />
    </div>
  )
}

// v4.2 — Commission RULES manager (operational): stored in the existing platform_settings
// collection — the financial commissions LEDGER awaits approval for a new collection.
function CommissionRulesManager() {
  const [rules, setRules] = useState(null)
  const [meta, setMeta] = useState({})
  const load = () => api('/admin/commission-rules').then(r => { setRules(r.rules || []); setMeta({ at: r.updated_at, by: r.updated_by }) }).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [])
  const save = async (next, reasonMsg) => {
    const reason = prompt('السبب (إلزامي — يسجل في التدقيق):', reasonMsg || '')
    if (!reason) return
    try { await api('/admin/commission-rules', { method: 'PUT', body: { rules: next, reason } }); toast.success('✅ حُفظت قواعد العمولات'); load() } catch (e) { toast.error(e.message) }
  }
  const addRule = () => {
    const name = prompt('اسم القاعدة:', ''); if (!name) return
    const type = prompt('النوع: percent = نسبة | fixed = مبلغ ثابت', 'percent'); if (type === null) return
    const value = prompt(type === 'fixed' ? 'المبلغ:' : 'النسبة %:', '10'); if (value === null) return
    const applies = prompt('تطبق على: silver / gold / enterprise / all', 'all'); if (applies === null) return
    const benef = prompt('اسم المستفيد (مسوق/جهة):', ''); if (benef === null) return
    save([...(rules || []), { name, type: type === 'fixed' ? 'fixed' : 'percent', value: Number(value) || 0, applies_to: applies, beneficiary_type: 'marketer', beneficiary_name: benef, active: true, priority: (rules || []).length }], `إضافة قاعدة ${name}`)
  }
  if (rules === null) return <div className="text-center py-4 text-slate-400 text-sm">جاري تحميل قواعد العمولات...</div>
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">📐 قواعد العمولات (تشغيلي — v4.2)</CardTitle>
        <Button size="sm" onClick={addRule}>➕ إضافة قاعدة</Button>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? <div className="text-center text-slate-400 text-sm py-3">لا قواعد بعد — أضف الأولى</div> : (
          <Table>
            <TableHeader><TableRow><TableHead>القاعدة</TableHead><TableHead>النوع/القيمة</TableHead><TableHead>النطاق</TableHead><TableHead>المستفيد</TableHead><TableHead>الفترة</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">—</TableHead></TableRow></TableHeader>
            <TableBody>
              {rules.map((r, i) => (
                <TableRow key={r.id || i} className={r.active === false ? 'opacity-50' : ''}>
                  <TableCell className="font-semibold text-sm">{r.name}</TableCell>
                  <TableCell className="text-xs">{r.type === 'fixed' ? `💵 ثابت ${r.value}` : `٪ نسبة ${r.value}%`}</TableCell>
                  <TableCell className="text-xs">{r.applies_to === 'all' ? 'كل الباقات' : r.applies_to}</TableCell>
                  <TableCell className="text-xs">{r.beneficiary_name || '—'} <span className="text-slate-400">({r.beneficiary_type})</span></TableCell>
                  <TableCell className="text-[10px]">{r.start_at ? String(r.start_at).slice(0, 10) : '∞'} ← {r.end_at ? String(r.end_at).slice(0, 10) : '∞'}</TableCell>
                  <TableCell><Badge className={r.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}>{r.active !== false ? 'نشطة' : 'معطلة'}</Badge></TableCell>
                  <TableCell className="text-left"><div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => {
                      const value = prompt('القيمة الجديدة:', r.value); if (value === null) return
                      save(rules.map((x, j) => j === i ? { ...x, value: Number(value) || 0 } : x), `تعديل قيمة ${r.name}`)
                    }}>✏️ تعديل</Button>
                    <Button size="sm" variant="outline" className={`h-7 text-[10px] ${r.active !== false ? 'text-rose-600' : 'text-emerald-600'}`} onClick={() => save(rules.map((x, j) => j === i ? { ...x, active: x.active === false } : x), `${r.active !== false ? 'تعطيل' : 'تفعيل'} ${r.name}`)}>{r.active !== false ? '⛔ تعطيل' : '✅ تفعيل'}</Button>
                  </div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="text-[10px] text-slate-500 mt-2">آخر تحديث: {meta.by || '—'} · {meta.at ? new Date(meta.at).toLocaleString('ar-EG') : '—'} — منع التداخل مفروض في الخادم (409) · كل حفظ يسجل في التدقيق بسبب إلزامي</div>
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">⚠️ سجل عمليات العمولة المالي (استحقاق/اعتماد/دفع/عكس) يتطلب Collection مالية جديدة — متوقف بانتظار موافقتك الصريحة قبل الإنشاء.</div>
      </CardContent>
    </Card>
  )
}

// v4.3 — «مركز الطلبات»: the ONE operational registry (platform_orders). Sales are
// order types here; the existing specialized requests aggregation is embedded below.
function OrdersScreen({ salesOnly = false }) {
  const [rows, setRows] = useState(null)
  const [types, setTypes] = useState({ types: {}, status_labels: {} })
  const [tenants, setTenants] = useState([])
  const [fStatus, setFStatus] = useState('')
  const [fType, setFType] = useState('')
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState(null)
  const [creating, setCreating] = useState(false)
  const load = () => {
    const qs = new URLSearchParams()
    if (salesOnly) qs.set('category', 'sales')
    if (fStatus) qs.set('status', fStatus)
    if (fType) qs.set('type', fType)
    if (q.trim()) qs.set('q', q.trim())
    api(`/admin/orders?${qs}`).then(r => setRows(r.rows || [])).catch(e => toast.error(e.message))
  }
  useEffect(() => {
    api('/admin/orders/types').then(setTypes).catch(() => {})
    api('/admin/tenants').then(d => setTenants((d?.tenants || []).filter(t => !t.is_platform_org))).catch(() => {})
  }, [])
  useEffect(() => { load() }, [fStatus, fType, salesOnly])
  const SL = types.status_labels || {}
  const act = async (o, action, extra = {}, promptReason = true) => {
    const reason = promptReason ? prompt('السبب (إلزامي):') : 'تحديث'
    if (promptReason && !reason) return
    try { await api(`/admin/orders/${o.id}`, { method: 'PATCH', body: { action, reason, ...extra } }); toast.success('✅ تم'); load(); if (detail?.order?.id === o.id) openDetail(o) } catch (e) { toast.error(e.message) }
  }
  const openDetail = async (o) => { try { setDetail(await api(`/admin/orders/${o.id}`)) } catch (e) { toast.error(e.message) } }
  const exportCSV = () => {
    const head = ['المرجع', 'النوع', 'المكتب', 'الحالة', 'الأولوية', 'المبلغ', 'العملة', 'المسؤول', 'الاستحقاق', 'أُنشئ']
    const lines = (rows || []).map(o => [o.ref, o.type_label, o.tenant_name || '', SL[o.status] || o.status, o.priority, o.amount ?? '', o.currency, o.assigned_to || '', o.due_at ? String(o.due_at).slice(0, 10) : '', String(o.created_at).slice(0, 10)])
    const csv = '\ufeff' + [head, ...lines].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `rahaal-orders-${todayISO()}.csv`; a.click()
  }
  const stBadge = { new: 'bg-blue-100 text-blue-700', under_review: 'bg-indigo-100 text-indigo-700', needs_info: 'bg-purple-100 text-purple-700', awaiting_payment: 'bg-amber-100 text-amber-700', awaiting_approval: 'bg-orange-100 text-orange-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700', executed: 'bg-teal-100 text-teal-700', completed: 'bg-green-100 text-green-800', cancelled: 'bg-slate-200 text-slate-600' }
  const openCount = (rows || []).filter(o => ['new', 'under_review', 'needs_info', 'awaiting_payment', 'awaiting_approval'].includes(o.status)).length
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-extrabold">{salesOnly ? '🧾 أوامر البيع (من مركز الطلبات — المصدر نفسه)' : '📥 مركز الطلبات'}</h2>
          {!salesOnly && <div className="text-xs text-slate-500">السجل التشغيلي الموحد — المبيعات أنواع طلبات هنا (platform_orders) بلا نسخة ثانية</div>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder="🔍 مرجع/مكتب..." className="h-9 w-40" />
          <select value={fType} onChange={e => setFType(e.target.value)} className="h-9 rounded-md border px-2 text-xs bg-white"><option value="">كل الأنواع</option>{Object.entries(types.types || {}).filter(([, v]) => !salesOnly || v.category === 'sales').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="h-9 rounded-md border px-2 text-xs bg-white"><option value="">كل الحالات</option>{Object.entries(SL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <Button size="sm" variant="outline" onClick={exportCSV}>⬇️ CSV</Button>
          <Button size="sm" onClick={() => setCreating(true)}>➕ طلب جديد</Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">إجمالي (المعروض)</div><div className="text-xl font-black">{rows?.length ?? '—'}</div></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">مفتوحة</div><div className="text-xl font-black text-amber-600">{openCount}</div></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><div className="text-[11px] text-slate-500">متأخرة</div><div className="text-xl font-black text-rose-600">{(rows || []).filter(o => o.late).length}</div></CardContent></Card>
      </div>
      <Card><CardContent className="pt-4 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>النوع</TableHead><TableHead>المكتب</TableHead><TableHead>المبلغ</TableHead><TableHead>الحالة</TableHead><TableHead>الأولوية</TableHead><TableHead>المسؤول</TableHead><TableHead>الاستحقاق</TableHead><TableHead className="text-left">إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows === null ? <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-400">جاري التحميل...</TableCell></TableRow>
              : rows.map(o => (
                <TableRow key={o.id} className={o.late ? 'bg-rose-50/60' : ''}>
                  <TableCell className="font-mono text-xs font-bold">{o.ref}</TableCell>
                  <TableCell className="text-xs">{o.type_label}<div className="text-[9px] text-slate-400">{o.category === 'sales' ? '🧾 مبيعات' : '🛠️ إداري'}{o.financial && ' · مالي'}</div></TableCell>
                  <TableCell className="text-xs">{o.tenant_name || '—'}</TableCell>
                  <TableCell className="text-xs font-bold">{o.amount != null ? `${o.currency === 'USD' ? '$' : o.currency + ' '}${o.amount}` : '—'}</TableCell>
                  <TableCell><Badge className={`${stBadge[o.status]} hover:${stBadge[o.status]}`}>{SL[o.status] || o.status}</Badge>{o.late && <div className="text-[9px] text-rose-600 font-bold">⏰ متأخر</div>}</TableCell>
                  <TableCell className="text-xs">{o.priority}</TableCell>
                  <TableCell className="text-[10px]">{o.assigned_to || o.assigned_department || '—'}</TableCell>
                  <TableCell className="text-[10px]">{o.due_at ? String(o.due_at).slice(0, 10) : '—'}</TableCell>
                  <TableCell className="text-left"><div className="flex gap-1 justify-end flex-wrap">
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => openDetail(o)}>👁️ Timeline</Button>
                    {['new', 'under_review', 'needs_info', 'awaiting_payment', 'awaiting_approval'].includes(o.status) && <>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { const a2 = prompt('تعيين إلى (بريد المدير أو اسم القسم):', o.assigned_to || ''); if (a2 === null) return; act(o, 'assign', { assignee: a2 }) }}>👤 تعيين</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-700" onClick={() => act(o, 'approve')}>✅ اعتماد</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px] text-rose-600" onClick={() => act(o, 'reject')}>⛔ رفض</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => act(o, 'cancel')}>🚫 إلغاء</Button>
                    </>}
                    {o.status === 'approved' && <Button size="sm" variant="outline" className="h-7 text-[10px] text-teal-700" onClick={() => act(o, 'execute')}>⚙️ تنفيذ</Button>}
                    {o.status === 'executed' && <Button size="sm" variant="outline" className="h-7 text-[10px] text-green-700" onClick={() => act(o, 'complete')}>🏁 إكمال</Button>}
                    {['rejected', 'cancelled'].includes(o.status) && <>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => act(o, 'reopen')}>↩️ إعادة فتح</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => act(o, 'archive')}>🗄️ أرشفة</Button>
                    </>}
                  </div></TableCell>
                </TableRow>
              ))}
            {rows?.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-400">لا طلبات — أنشئ الأول</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
      {creating && <OrderCreateDialog types={types.types} tenants={tenants} salesOnly={salesOnly} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
      {detail && (
        <Dialog open onOpenChange={() => setDetail(null)}><DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>📄 {detail.order?.ref} — {detail.order?.type_label}</DialogTitle>
            <DialogDescription>{detail.order?.tenant_name || ''} · الحالة: {SL[detail.order?.status] || detail.order?.status} · أنشأه {detail.order?.created_by}</DialogDescription></DialogHeader>
          {detail.order?.details && <div className="text-xs bg-slate-50 rounded p-2">{detail.order.details}</div>}
          {(detail.commissions || []).length > 0 && <div className="text-xs bg-fuchsia-50 border border-fuchsia-200 rounded p-2">٪ عمولات مرتبطة: {detail.commissions.map(c => `${c.amount} ${c.currency} (${c.beneficiary_name})`).join(' · ')}</div>}
          <div className="text-xs font-black">Timeline:</div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {(detail.order?.events || []).slice().reverse().map((e, i) => (
              <div key={i} className="text-[11px] p-2 rounded border bg-white flex justify-between gap-2">
                <span><b>{e.type}</b> — {e.note}</span>
                <span className="text-slate-400 font-mono whitespace-nowrap">{e.by?.split('@')[0]} · {e.at ? new Date(e.at).toLocaleString('ar-EG') : ''}</span>
              </div>
            ))}
          </div>
        </DialogContent></Dialog>
      )}
    </div>
  )
}

function OrderCreateDialog({ types, tenants, salesOnly, onClose, onDone }) {
  const [f, setF] = useState({ type: salesOnly ? 'new_subscription' : 'other', tenant_id: '', plan_key: '', amount: '', currency: 'USD', priority: 'normal', due_at: '', details: '' })
  const [busy, setBusy] = useState(false)
  const [opId] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
  const submit = async () => {
    try {
      setBusy(true)
      const r = await api('/admin/orders', { method: 'POST', body: { ...f, amount: f.amount === '' ? undefined : Number(f.amount), op_id: opId } })
      toast.success(r.duplicate ? 'ℹ️ الطلب موجود مسبقاً (منع التكرار)' : `✅ أُنشئ الطلب ${r.order.ref}`)
      onDone()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}><DialogContent className="max-w-lg" dir="rtl">
      <DialogHeader><DialogTitle>➕ طلب جديد {salesOnly ? '(أمر بيع)' : ''}</DialogTitle><DialogDescription>رقم مرجعي موحد ORD تلقائي · Idempotency مفعلة</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-2">
        <Field label="النوع *"><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} className="h-9 w-full rounded-md border px-2 text-xs bg-white">{Object.entries(types || {}).filter(([, v]) => !salesOnly || v.category === 'sales').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="المكتب"><select value={f.tenant_id} onChange={e => setF({ ...f, tenant_id: e.target.value })} className="h-9 w-full rounded-md border px-2 text-xs bg-white"><option value="">— بلا —</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="الباقة"><select value={f.plan_key} onChange={e => setF({ ...f, plan_key: e.target.value })} className="h-9 w-full rounded-md border px-2 text-xs bg-white"><option value="">—</option><option value="silver">سيلفر</option><option value="gold">جولد</option><option value="enterprise">إنتربرايز</option></select></Field>
        <Field label="الأولوية"><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} className="h-9 w-full rounded-md border px-2 text-xs bg-white"><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option><option value="critical">حرجة</option></select></Field>
        <Field label="المبلغ"><Input type="number" min="0" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="العملة"><Input value={f.currency} onChange={e => setF({ ...f, currency: e.target.value.toUpperCase() })} dir="ltr" className="text-center" /></Field>
        <Field label="تاريخ الاستحقاق"><Input type="date" value={f.due_at} onChange={e => setF({ ...f, due_at: e.target.value })} /></Field>
      </div>
      <Field label="التفاصيل"><Textarea rows={3} value={f.details} onChange={e => setF({ ...f, details: e.target.value })} /></Field>
      <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={submit} disabled={busy}>{busy ? '...' : '➕ إنشاء'}</Button></DialogFooter>
    </DialogContent></Dialog>
  )
}

// v4.3 — Program commissions LEDGER (platform_commissions): linked to platform_orders,
// full snapshot, unique index against duplicates. Pay is blocked until financial linkage.
function CommissionsLedger() {
  const [rows, setRows] = useState(null)
  const [labels, setLabels] = useState({})
  const [rules, setRules] = useState([])
  const [salesOrders, setSalesOrders] = useState([])
  const load = () => {
    api('/admin/commissions-ledger').then(r => { setRows(r.rows || []); setLabels(r.status_labels || {}) }).catch(e => toast.error(e.message))
    api('/admin/commission-rules').then(r => setRules(r.rules || [])).catch(() => {})
    api('/admin/orders?category=sales').then(r => setSalesOrders(r.rows || [])).catch(() => {})
  }
  useEffect(() => { load() }, [])
  const createComm = async () => {
    const activeRules = rules.filter(r => r.active !== false)
    if (!salesOrders.length) return toast.error('لا أوامر بيع في مركز الطلبات بعد')
    if (!activeRules.length) return toast.error('لا قواعد عمولة نشطة')
    const oref = prompt(`مرجع أمر البيع:\n${salesOrders.slice(0, 8).map(o => `${o.ref} — ${o.tenant_name || ''} (${o.amount ?? '—'} ${o.currency})`).join('\n')}`)
    if (!oref) return
    const order = salesOrders.find(o => o.ref === oref.trim())
    if (!order) return toast.error('مرجع غير موجود')
    const rname = prompt(`اسم القاعدة:\n${activeRules.map(r => `${r.name} (${r.type === 'fixed' ? r.value : r.value + '%'})`).join('\n')}`, activeRules[0]?.name)
    if (!rname) return
    const rule = activeRules.find(r => r.name === rname.trim())
    if (!rule) return toast.error('قاعدة غير موجودة')
    const benef = prompt('المستفيد (بريد مستخدم/موظف قائم أو معرف مكتب — لا حسابات مسوقين):', rule.beneficiary_name || '')
    if (!benef) return
    try {
      const r = await api('/admin/commissions-ledger', { method: 'POST', body: { order_id: order.id, rule_id: rule.id, beneficiary_key: benef, beneficiary_name: benef, reason: 'إنشاء عمولة من البيع' } })
      toast.success(r.duplicate ? 'ℹ️ العمولة موجودة مسبقاً — لم تتكرر (Unique Index)' : `✅ أُنشئت عمولة ${r.commission.amount} ${r.commission.currency}`)
      load()
    } catch (e) { toast.error(e.message) }
  }
  const act = async (c, action) => {
    const reason = prompt('السبب (إلزامي):'); if (!reason) return
    try { await api(`/admin/commissions-ledger/${c.id}`, { method: 'PATCH', body: { action, reason } }); toast.success('✅ تم'); load() } catch (e) { toast.error(e.message) }
  }
  const stC = { pending: 'bg-slate-200 text-slate-700', due: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', paid: 'bg-green-200 text-green-800', rejected: 'bg-rose-100 text-rose-700', cancelled: 'bg-slate-100 text-slate-500', reversed: 'bg-purple-100 text-purple-700' }
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">💰 سجل عمولات البرنامج (platform_commissions — مرتبط بمركز الطلبات)</CardTitle>
        <Button size="sm" onClick={createComm}>➕ عمولة من بيع</Button>
      </CardHeader>
      <CardContent>
        {rows === null ? <div className="text-center text-slate-400 text-sm py-3">جاري التحميل...</div>
          : rows.length === 0 ? <div className="text-center text-slate-400 text-sm py-3">لا عمولات مسجلة — أنشئ الأولى من أمر بيع</div>
            : <Table>
              <TableHeader><TableRow><TableHead>الطلب</TableHead><TableHead>المكتب/الباقة</TableHead><TableHead>القاعدة (Snapshot)</TableHead><TableHead>المستفيد</TableHead><TableHead className="text-center">الأساس ← العمولة</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">إجراءات</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-bold">{c.order_ref}</TableCell>
                    <TableCell className="text-xs">{c.tenant_name || '—'}<div className="text-[9px] text-slate-400">{c.plan_key || ''}</div></TableCell>
                    <TableCell className="text-xs">{c.rule_name}<div className="text-[9px] text-slate-400">{c.rule_type === 'fixed' ? `ثابت ${c.rule_value}` : `${c.rule_value}%`}</div></TableCell>
                    <TableCell className="text-xs">{c.beneficiary_name}<div className="text-[9px] text-slate-400">{c.beneficiary_type}</div></TableCell>
                    <TableCell className="text-center text-xs">{c.basis} ← <b className="text-fuchsia-700">{c.amount} {c.currency}</b></TableCell>
                    <TableCell><Badge className={`${stC[c.status]} hover:${stC[c.status]}`}>{labels[c.status] || c.status}</Badge></TableCell>
                    <TableCell className="text-left"><div className="flex gap-1 justify-end flex-wrap">
                      {c.status === 'pending' && <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => act(c, 'mark_due')}>⏳ استحقاق</Button>}
                      {['pending', 'due'].includes(c.status) && <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-700" onClick={() => act(c, 'approve')}>✅ اعتماد</Button>}
                      {['due', 'approved'].includes(c.status) && <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => act(c, 'hold')}>⏸️ تعليق</Button>}
                      {!['paid', 'reversed', 'cancelled', 'rejected'].includes(c.status) && <Button size="sm" variant="outline" className="h-7 text-[10px] text-rose-600" onClick={() => act(c, 'reject')}>⛔ رفض</Button>}
                      {c.status === 'approved' && <Button size="sm" variant="outline" className="h-7 text-[10px] text-purple-700" onClick={() => act(c, 'reverse')}>↩️ عكس</Button>}
                      {['pending', 'due'].includes(c.status) && <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => act(c, 'cancel')}>🚫 إلغاء</Button>}
                      <Button size="sm" variant="outline" className="h-7 text-[10px] opacity-60" onClick={() => act(c, 'pay')}>💵 دفع</Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
        <div className="text-[10px] text-slate-500 mt-2">المبلغ المعتمد/المدفوع لا يُعدل مباشرة — التصحيح بالعكس الموثق فقط · التكرار ممنوع بـUnique Index (طلب+قاعدة+مستفيد) · الدفع محجوب حتى اكتمال ربط سند الصرف</div>
      </CardContent>
    </Card>
  )
}

// ============ v4.4 — CONSOLIDATION HUBS (reuse-only: existing components as tabs) ============
function HubTabs({ tabs, initial }) {
  const [t, setT] = useState(initial || tabs[0].key)
  const cur = tabs.find(x => x.key === t) || tabs[0]
  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {tabs.map(x => (
          <button key={x.key} onClick={() => setT(x.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold border ${t === x.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            {x.label}
          </button>
        ))}
      </div>
      <div key={cur.key}>{cur.render()}</div>
    </div>
  )
}

// «إدارة المكاتب» — one section: offices list (old panel) + verifications tab + Office 360°
function PlatformOfficesHub() {
  return <HubTabs tabs={[
    { key: 'list', label: '🏢 المكاتب', render: () => <SuperAdminPanel embedded /> },
    { key: 'verify', label: '✅ توثيق المكاتب', render: () => <OfficeVerificationsPanel /> },
    { key: 'office360', label: '🔍 Office 360°', render: () => <OfficesSection /> },
  ]} />
}

// «المستخدمون والصلاحيات» — one section: rahaal managers + roles/permissions + password reset requests
function PlatformPeopleHub() {
  return <HubTabs tabs={[
    { key: 'staff', label: '👑 مديرو رحّال', render: () => <AdminStaffCenter /> },
    { key: 'perms', label: '🛡️ الأدوار والصلاحيات (مستخدمو المنصة)', render: () => <AdminPermsCenter /> },
    { key: 'resets', label: '🔑 طلبات استعادة كلمة المرور', render: () => <ResetRequestsPanel /> },
  ]} />
}

// «إعدادات النظام» — one entry: general/maintenance, backup, audit&security, health
// (v4.4.1 — «العملات وأسعار الصرف» moved OUT of system settings into «الصناديق والبنوك»)
function PlatformSystemHub() {
  return <HubTabs tabs={[
    { key: 'system', label: '⚙️ عام وصيانة وبيئة', render: () => <AdminSystemCenter /> },
    { key: 'backup', label: '💾 النسخ الاحتياطي والاستعادة', render: () => <AdminBackupCenter /> },
    { key: 'audit', label: '🕵️ Audit & Security', render: () => <AdminAuditCenter /> },
    { key: 'health', label: '❤️ System Health', render: () => <AdminHealthCenter /> },
  ]} />
}

// «الصناديق والبنوك» (super admin only wrapper): tab 1 = the ORIGINAL financial screen
// untouched (boxes + bank accounts); then (v4.4.1 order): currencies & FX rates —
// definitions/buy-sell rates/history (NOT «حركة العملات» which stays untouched for
// actual exchange operations) — then payment methods & financial entities (with
// receiving accounts). Single source: existing components/APIs/collections only.
function BoxesBanksHub() {
  return <HubTabs tabs={[
    { key: 'boxes', label: '🏦 الصناديق والحسابات البنكية (المحتوى الأصلي)', render: () => <BoxesScreen /> },
    { key: 'currency', label: '💱 العملات وأسعار الصرف', render: () => <AdminCurrencyCenter /> },
    { key: 'payfin', label: '💳 طرق الدفع والجهات المالية وحسابات الاستلام', render: () => <AdminPayFinCenter /> },
  ]} />
}

// v4.4 — «توثيق المكاتب» tab (reuses the existing verification APIs — no new workflow)
function OfficeVerificationsPanel() {
  const [rows, setRows] = useState(null)
  const load = () => api('/admin/office-verifications').then(r => setRows(r.verifications || r.rows || r.requests || (Array.isArray(r) ? r : []))).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [])
  const decide = async (r, decision) => {
    const reason = prompt(decision === 'verified' ? 'ملاحظة الاعتماد (اختياري):' : 'سبب الرفض (إلزامي):')
    if (decision === 'rejected' && !reason) return
    if (reason === null) return
    try { await api(`/admin/office-verifications/${r.tenant_id}/decision`, { method: 'POST', body: { decision, reason: reason || '' } }); toast.success('✅ تم'); load() } catch (e) { toast.error(e.message) }
  }
  const stV = { pending: 'bg-amber-100 text-amber-700', verified: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700', unverified: 'bg-slate-100 text-slate-500' }
  const stL = { pending: 'معلق للمراجعة', verified: 'موثق', rejected: 'مرفوض', unverified: 'لم يقدم طلباً' }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">✅ طلبات توثيق المكاتب</CardTitle></CardHeader>
      <CardContent>
        {rows === null ? <div className="text-center text-slate-400 text-sm py-4">جاري التحميل...</div>
          : rows.length === 0 ? <div className="text-center text-slate-400 text-sm py-4">لا طلبات توثيق</div>
            : <Table>
              <TableHeader><TableRow><TableHead>المكتب</TableHead><TableHead>المستندات</TableHead><TableHead>تاريخ التقديم</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">القرار</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.tenant_id}>
                    <TableCell className="text-sm font-semibold">{r.office_name || r.tenant_id}</TableCell>
                    <TableCell className="text-xs">{(r.documents || []).length} مستند{r.reject_reason && <div className="text-[9px] text-rose-500">آخر رفض: {r.reject_reason}</div>}</TableCell>
                    <TableCell className="text-[10px]">{r.submitted_at ? String(r.submitted_at).slice(0, 10) : '—'}</TableCell>
                    <TableCell><Badge className={stV[r.status] || 'bg-slate-100 text-slate-600'}>{stL[r.status] || r.status}</Badge></TableCell>
                    <TableCell className="text-left">{['pending', 'rejected'].includes(r.status) && <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-700" onClick={() => decide(r, 'verified')}>✅ اعتماد</Button>
                      {r.status === 'pending' && <Button size="sm" variant="outline" className="h-7 text-[10px] text-rose-600" onClick={() => decide(r, 'rejected')}>⛔ رفض</Button>}
                    </div>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
      </CardContent>
    </Card>
  )
}

// v4.4 — password reset requests moved to its proper tab (reuses the same APIs and the
// existing AdminResetPasswordDialog — the legacy inline card was hidden in embedded mode)
function ResetRequestsPanel() {
  const [rows, setRows] = useState(null)
  const [target, setTarget] = useState(null)
  const load = () => api('/admin/password-reset-requests').then(r => setRows(Array.isArray(r) ? r : (r.rows || []))).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [])
  const reject = async (r) => {
    if (!(await askConfirm({ title: 'رفض الطلب', desc: `رفض طلب استعادة كلمة المرور لـ ${r.email}؟`, icon: '⛔', confirmLabel: 'رفض' }))) return
    try { await api(`/admin/password-reset-requests/${r.id}`, { method: 'PATCH', body: { action: 'reject' } }); toast.success('تم الرفض'); load() } catch (e) { toast.error(e.message) }
  }
  const pending = (rows || []).filter(r => r.status === 'pending')
  const done = (rows || []).filter(r => r.status !== 'pending')
  return (
    <div className="space-y-4">
      <Card className={pending.length ? 'border-orange-300' : ''}>
        <CardHeader className="pb-2"><CardTitle className="text-sm">🔑 طلبات استعادة كلمة المرور {pending.length > 0 && <Badge className="bg-orange-500 text-white mr-2">{pending.length} معلق</Badge>}</CardTitle></CardHeader>
        <CardContent>
          {rows === null ? <div className="text-center text-slate-400 text-sm py-4">جاري التحميل...</div>
            : rows.length === 0 ? <div className="text-center text-slate-400 text-sm py-4">لا طلبات</div>
              : <Table>
                <TableHeader><TableRow><TableHead>البريد</TableHead><TableHead>الاسم/المكتب</TableHead><TableHead>الهاتف</TableHead><TableHead>التاريخ</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">إجراءات</TableHead></TableRow></TableHeader>
                <TableBody>
                  {[...pending, ...done].map(r => (
                    <TableRow key={r.id} className={r.status === 'pending' ? 'bg-orange-50/50' : ''}>
                      <TableCell className="font-mono text-xs" dir="ltr">{r.email}</TableCell>
                      <TableCell className="text-xs">{r.user_name || '—'}<div className="text-[9px] text-slate-400">{r.tenant_name || ''}</div></TableCell>
                      <TableCell className="text-xs" dir="ltr">{r.phone || '—'}</TableCell>
                      <TableCell className="text-[10px]">{r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '—'}</TableCell>
                      <TableCell><Badge className={r.status === 'pending' ? 'bg-orange-100 text-orange-700' : r.status === 'reset' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>{r.status === 'pending' ? 'معلق' : r.status === 'reset' ? 'تم التعيين' : 'مرفوض'}</Badge></TableCell>
                      <TableCell className="text-left">{r.status === 'pending' && <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-700" onClick={() => setTarget(r)}>🔐 تعيين كلمة مرور</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[10px] text-rose-600" onClick={() => reject(r)}>⛔ رفض</Button>
                      </div>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>}
        </CardContent>
      </Card>
      <AdminResetPasswordDialog req={target} onClose={() => setTarget(null)} onDone={load} />
    </div>
  )
}

function NewTenantDialog({ open, onOpenChange, onSaved }) {
  const [f, setF] = useState({ name: '', owner_name: '', owner_email: '', owner_password: '', max_users: 2, max_branches: 1, subscription: 'trial', referral_code: '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!f.name || !f.owner_email || !f.owner_password) return toast.error('املأ جميع الحقول المطلوبة')
    try { setSaving(true); await api('/admin/tenants', { method: 'POST', body: f }); toast.success('تم إنشاء المكتب' + (f.referral_code ? ' + منح +15 قيد للمُحيل' : '')); onSaved(); setF({ name: '', owner_name: '', owner_email: '', owner_password: '', max_users: 2, max_branches: 1, subscription: 'trial', referral_code: '' }) }
    catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader><DialogTitle>إنشاء مكتب سفريات جديد</DialogTitle><DialogDescription>سيتم إنشاء مكتب معزول تماماً مع حساب مالك وبيانات محاسبية افتراضية</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="اسم المكتب" required><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="مكتب الأنوار للسفريات" /></Field>
          <Field label="نوع الاشتراك">
            <Select value={f.subscription} onValueChange={v => setF({ ...f, subscription: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="trial">تجريبي</SelectItem><SelectItem value="basic">أساسي</SelectItem><SelectItem value="pro">احترافي</SelectItem><SelectItem value="enterprise">مؤسسي</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="اسم المالك"><Input value={f.owner_name} onChange={e => setF({ ...f, owner_name: e.target.value })} placeholder="أحمد محمد" /></Field>
          <Field label="بريد المالك" required><Input dir="ltr" type="email" value={f.owner_email} onChange={e => setF({ ...f, owner_email: e.target.value })} placeholder="owner@office.com" /></Field>
          <Field label="كلمة المرور" required><Input dir="ltr" type="text" value={f.owner_password} onChange={e => setF({ ...f, owner_password: e.target.value })} placeholder="اختر كلمة مرور قوية" /></Field>
          <Field label="حد المستخدمين"><Input type="number" min={1} value={f.max_users} onChange={e => setF({ ...f, max_users: e.target.value })} /></Field>
          <Field label="عدد الفروع ⚠️ غير مفعل تشغيلياً"><Input type="number" min={1} value={f.max_branches} onChange={e => setF({ ...f, max_branches: e.target.value })} /></Field>
          <Field label="🎁 رمز الإحالة (اختياري)"><Input dir="ltr" value={f.referral_code} onChange={e => setF({ ...f, referral_code: e.target.value.toUpperCase() })} placeholder="مثال: ABCD1234" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="grad-brand text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'إنشاء المكتب'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditTenantDialog({ tenant, onOpenChange, onSaved }) {
  const [f, setF] = useState({})
  useEffect(() => { if (tenant) setF({ name: tenant.name, max_users: tenant.max_users, max_branches: tenant.max_branches, status: tenant.status, plan_key: ['silver', 'gold', 'enterprise'].includes(tenant.plan_tier) ? tenant.plan_tier : '', billing_mode: tenant.billing_mode || '', unlimited_journals: !!tenant.unlimited_journals }) }, [tenant])
  if (!tenant) return null
  const submit = async () => {
    try {
      const body = { ...f }
      if (!body.plan_key) delete body.plan_key
      if (!body.billing_mode) delete body.billing_mode
      await api(`/admin/tenants/${tenant.id}`, { method: 'PATCH', body })
      toast.success('تم التحديث'); onSaved()
    }
    catch (e) { toast.error(e.message) }
  }
  const PLAN_LIMITS = { silver: 'فرع واحد + مستخدمان', gold: 'حتى 8 مستخدمين + 3 فروع', enterprise: 'غير محدود (فروع ومستخدمين)' }
  return (
    <Dialog open={!!tenant} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>تعديل المكتب: {tenant.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="اسم المكتب"><Input value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="الحالة">
            <Select value={f.status} onValueChange={v => setF({ ...f, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="active">نشط</SelectItem><SelectItem value="suspended">موقوف</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="الباقة (تُطبّق الحدود آلياً)">
            <Select value={f.plan_key || 'none'} onValueChange={v => setF({ ...f, plan_key: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="بدون باقة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— بدون —</SelectItem>
                <SelectItem value="silver">🥈 سيلفر</SelectItem>
                <SelectItem value="gold">🥇 جولد</SelectItem>
                <SelectItem value="enterprise">🏢 إنتربرايز</SelectItem>
              </SelectContent>
            </Select>
            {f.plan_key && <div className="text-[10px] text-blue-600 mt-1">سيُطبّق: {PLAN_LIMITS[f.plan_key]}</div>}
          </Field>
          <Field label="طريقة الدفع">
            <Select value={f.billing_mode || 'none'} onValueChange={v => setF({ ...f, billing_mode: v === 'none' ? '' : v, ...(v === 'annual' ? { unlimited_journals: true } : {}) })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— بدون —</SelectItem>
                <SelectItem value="installments">💳 أقساط (قيود محدودة)</SelectItem>
                <SelectItem value="annual">📅 سنوي دفعة واحدة (قيود مفتوحة)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="حد المستخدمين"><Input type="number" min="0" value={f.max_users || 1} onChange={e => setF({ ...f, max_users: Number(e.target.value) })} /></Field>
          <Field label="عدد الفروع ⚠️ غير مفعل تشغيلياً"><Input type="number" min="0" value={f.max_branches || 1} onChange={e => setF({ ...f, max_branches: Number(e.target.value) })} /></Field>
        </div>
        {/* v3.14 — Manual unlimited-journals switch (e.g. after final installment payment) */}
        <div className={`p-3 rounded-lg border flex items-center justify-between ${f.unlimited_journals ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'}`}>
          <div>
            <div className="font-bold text-sm">{f.unlimited_journals ? '♾️ القيود المحاسبية: مفتوحة (Unlimited)' : '🔒 القيود المحاسبية: محدودة بالحصة'}</div>
            <div className="text-[11px] text-slate-500">فعّل يدوياً عند سداد آخر قسط أو الدفع الكلي المباشر</div>
          </div>
          <Button type="button" size="sm" variant={f.unlimited_journals ? 'outline' : 'default'}
            className={f.unlimited_journals ? 'text-rose-600' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}
            onClick={() => setF({ ...f, unlimited_journals: !f.unlimited_journals })}>
            {f.unlimited_journals ? 'إغلاق القيود' : '♾️ فتح القيود'}
          </Button>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button onClick={submit} className="grad-brand text-white">حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================
// COMMON FIELD COMPONENT
// ================================================================

// v3.79 — UNIFIED Account Selector (المكوّن الموحّد لكل حقول الحساب في النظام):
//   type: 'client' | 'supplier' | 'box' | 'account' | 'party' (عميل+مورد) | 'all'
//   acctType: 'expense' | 'revenue' | ... — يحصر حسابات الدليل بنوع محدد (لحقلي المصروف/الإيراد)
//   suggestedParent: كود الحساب الأب المقترح عند الإضافة السريعة (قابل للتغيير قبل الحفظ)
//   compact: ارتفاع مصغّر لصفوف الجداول
function AccountAutocomplete({ type = 'all', value = null, onChange, placeholder = 'بحث بالاسم أو الكود...', disabled = false, allowClear = true, dropdownWidth = '420px', allowQuickAdd, acctType = null, suggestedParent = null, compact = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddType, setQuickAddType] = useState(null) // 'client' | 'supplier'
  // v3.79 — inline COA account creation (independent account, parent = classification only)
  const [coaAdd, setCoaAdd] = useState(false)
  const [coaName, setCoaName] = useState('')
  const [coaParent, setCoaParent] = useState(suggestedParent || '')
  const [coaParents, setCoaParents] = useState([])
  const [coaSaving, setCoaSaving] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const popRef = useRef(null)
  // Default: quick-add enabled everywhere except plain box pickers
  const enableQA = allowQuickAdd !== undefined ? allowQuickAdd : ['client', 'supplier', 'party', 'all', 'account'].includes(type)
  // Debounced search
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const rs = await api(`/accounts/search?q=${encodeURIComponent(query)}&type=${type}&limit=30${acctType ? `&acct_type=${acctType}` : ''}`)
        setResults(Array.isArray(rs) ? rs : [])
      } catch (_) { setResults([]) }
      setLoading(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, type, open, acctType])
  // Load selected by value once
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected?.id === value) return
    api(`/accounts/search?q=&type=${type}&limit=300${acctType ? `&acct_type=${acctType}` : ''}`).then(list => {
      const found = (list || []).find(x => x.id === value || x.account_code === value)
      if (found) setSelected(found)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, type])
  // Load COA group parents for inline account creation
  const openCoaAdd = async () => {
    setCoaName(query.trim())
    setCoaAdd(true)
    try {
      const rows = await api('/accounts')
      const groups = (rows || []).filter(a => (!acctType || a.type === acctType) && a.is_group)
      const list = groups.length ? groups : (rows || []).filter(a => !acctType || a.type === acctType)
      setCoaParents(list)
      setCoaParent(p => p || suggestedParent || list[0]?.code || '')
    } catch { setCoaParents([]) }
  }
  const submitCoaAdd = async () => {
    if (!coaName.trim()) { toast.error('اسم الحساب مطلوب'); return }
    if (!coaParent) { toast.error('اختر الحساب الأب (للتصنيف فقط)'); return }
    setCoaSaving(true)
    try {
      const parentAcc = coaParents.find(p => p.code === coaParent)
      const created = await api('/accounts', { method: 'POST', body: { name_ar: coaName.trim(), type: acctType || parentAcc?.type || 'expense', parent: coaParent } })
      const entity = { id: created.id, name: created.name_ar, type: 'account', account_code: created.code, parent_code: created.parent, acct_type: created.type }
      toast.success(`✅ أُنشئ حساب مستقل في دليل الحسابات بكود ${created.code} تحت «${parentAcc?.name_ar || coaParent}»`)
      setCoaAdd(false); setCoaName('')
      pick(entity)
    } catch (e) { toast.error(e.message) } finally { setCoaSaving(false) }
  }
  // v3.87 — FIXED-POSITION popover: escapes dialog overflow clipping, flips upward when the
  // space below is tight, dynamic max-height, wheel + touch scrolling, never exits the viewport.
  const [popPos, setPopPos] = useState(null)
  const computePopPos = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const vw = window.innerWidth, vh = window.innerHeight
    const wantW = Math.min(Math.max(parseInt(dropdownWidth) || 420, r.width), vw - 16)
    const left = Math.min(Math.max(r.left, 8), Math.max(8, vw - wantW - 8))
    const spaceBelow = vh - r.bottom - 12
    const spaceAbove = r.top - 12
    const flip = spaceBelow < 260 && spaceAbove > spaceBelow
    const maxH = Math.max(220, Math.min(460, Math.floor(flip ? spaceAbove : spaceBelow), Math.floor(vh * 0.7)))
    setPopPos({ left, width: wantW, maxH, top: flip ? undefined : r.bottom + 4, bottom: flip ? vh - r.top + 4 : undefined })
  }, [dropdownWidth])
  useEffect(() => {
    if (!open) return
    computePopPos()
    const onWin = () => computePopPos()
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => { window.removeEventListener('resize', onWin); window.removeEventListener('scroll', onWin, true) }
  }, [open, computePopPos])
  // Click outside — close popover (popover lives in a body portal, so check BOTH refs)
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return
      if (popRef.current && popRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  // Auto-focus search input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])
  const typeIcon = { client: '👤', supplier: '🏭', box: '💰', account: '📒' }
  const typeLabel = { client: 'عميل', supplier: 'مورد', box: 'صندوق', account: 'حساب' }
  const typeBadge = { client: 'bg-emerald-50 text-emerald-700 border-emerald-200', supplier: 'bg-rose-50 text-rose-700 border-rose-200', box: 'bg-blue-50 text-blue-700 border-blue-200', account: 'bg-purple-50 text-purple-700 border-purple-200' }
  const pick = (r) => { setSelected(r); onChange?.(r); setOpen(false); setQuery('') }
  const clear = (e) => { e.stopPropagation(); setSelected(null); onChange?.(null); setQuery('') }
  const openPopover = () => { if (!disabled) { setOpen(true); setQuery('') } }
  const openQuickAdd = (t) => { setQuickAddType(t); setQuickAddOpen(true) }
  const onQuickAddDone = (entity) => {
    // Auto-select the newly created entity
    setQuickAddOpen(false); setSelected(entity); onChange?.(entity); setOpen(false); setQuery('')
  }
  return (
    <div ref={wrapRef} className="relative w-full">
      {/* Field trigger — v3.87.1: while open, the trigger ITSELF hosts the search input
          (it lives inside the Dialog, so Radix focus-trap keeps typing working) and only
          the results list floats in the body portal below/above. */}
      <div
        className={`flex items-center gap-1 border-2 rounded-md bg-white px-2 ${compact ? 'py-0.5 text-xs min-h-[30px]' : 'py-1.5 text-sm min-h-[38px]'} ${disabled ? 'opacity-60 pointer-events-none' : 'cursor-pointer hover:border-blue-400'} ${open ? 'border-blue-500 ring-1 ring-blue-200' : 'border-slate-200'}`}
        onClick={openPopover}
      >
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={selected ? `${selected.account_code} — ${selected.name}` : `🔍 ${placeholder}`}
            className="flex-1 min-w-0 bg-transparent outline-none"
            onClick={e => e.stopPropagation()}
          />
        ) : selected ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-base shrink-0">{typeIcon[selected.type] || '•'}</span>
            <span className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${typeBadge[selected.type] || 'bg-slate-50 border-slate-200'}`}>{selected.account_code}</span>
            <span className="truncate">{selected.name}</span>
            {allowClear && !disabled && <button type="button" onClick={clear} className="ms-auto text-slate-400 hover:text-rose-500 shrink-0 text-lg leading-none" title="مسح">✕</button>}
          </div>
        ) : (
          <div className="flex-1 text-slate-400 truncate">{placeholder}</div>
        )}
        <span className="text-slate-400 text-xs shrink-0">▾</span>
      </div>
      {/* Popover dropdown — v3.87.1: rendered in a BODY PORTAL (position:fixed breaks inside
          the transformed Radix DialogContent — translate(-50%,-50%) re-anchors fixed elements).
          Portal + fixed + flip + dynamic height + touch/wheel scroll = never clipped, never off-screen. */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          dir="rtl"
          className="bg-white border-2 border-blue-300 rounded-lg shadow-2xl flex flex-col"
          style={{ position: 'fixed', left: popPos?.left ?? 8, top: popPos?.top, bottom: popPos?.bottom, width: popPos?.width || 420, maxWidth: 'calc(100vw - 16px)', maxHeight: popPos?.maxH || 320, zIndex: 9999, pointerEvents: 'auto' }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
            {loading && <div className="p-4 text-center text-xs text-slate-400">جاري البحث...</div>}
            {!loading && results.length === 0 && (
              <div className="p-4 text-center text-xs text-slate-400">لا نتائج مطابقة{query.trim() ? ' — يمكنك الإضافة من الأسفل' : ''}</div>
            )}
            {!loading && results.map(r => {
              const isGroupRow = r.type === 'account' && r.is_group
              return (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                onClick={() => { if (isGroupRow) { toast.error('هذا حساب أب (تصنيف) — اختر حساباً فرعياً أو أضف جديداً تحته'); return } pick(r) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0 text-right ${isGroupRow ? 'bg-slate-50 text-slate-500 font-black cursor-default' : 'hover:bg-blue-50'} ${selected?.id === r.id ? 'bg-blue-100' : ''}`}
              >
                <span className="text-base shrink-0">{typeIcon[r.type] || '•'}</span>
                <span className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap ${typeBadge[r.type] || 'bg-slate-50 border-slate-200'}`}>{r.account_code}</span>
                <span className="flex-1 truncate text-slate-800">{r.name}</span>
                <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">{typeLabel[r.type] || ''}</span>
                <span className="text-[10px] font-mono text-slate-500 shrink-0 whitespace-nowrap">
                  {Object.entries(r.balances || {}).filter(([, v]) => Number(v) !== 0).slice(0, 1).map(([c, v]) => `${c}:${Number(v).toLocaleString()}`).join('')}
                </span>
              </button>
            )})}
          </div>
          {/* v3.79 — unified quick-add footer: always available while typing (never leave the flow) */}
          {enableQA && query.trim().length > 0 && !coaAdd && (
            <div className="p-2 border-t bg-slate-50/70 space-y-1.5 shrink-0">
              {(type === 'client' || type === 'party' || type === 'all') && (
                <button type="button" onClick={() => openQuickAdd('client')} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border-2 border-dashed border-emerald-300 text-emerald-700 font-bold text-xs hover:bg-emerald-100">
                  👤 ➕ إضافة عميل جديد باسم "{query.trim().slice(0, 30)}"
                </button>
              )}
              {(type === 'supplier' || type === 'party' || type === 'all') && (
                <button type="button" onClick={() => openQuickAdd('supplier')} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 border-2 border-dashed border-rose-300 text-rose-700 font-bold text-xs hover:bg-rose-100">
                  🏭 ➕ إضافة مورد جديد باسم "{query.trim().slice(0, 30)}"
                </button>
              )}
              {(type === 'account' || type === 'all') && (
                <button type="button" onClick={openCoaAdd} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 border-2 border-dashed border-purple-300 text-purple-700 font-bold text-xs hover:bg-purple-100">
                  📒 ➕ إضافة حساب {acctType === 'expense' ? 'مصروف' : acctType === 'revenue' ? 'إيراد' : ''} جديد باسم "{query.trim().slice(0, 30)}"
                </button>
              )}
            </div>
          )}
          {/* v3.79 — inline COA account creation: independent account, parent = classification only (changeable) */}
          {coaAdd && (
            <div className="p-2.5 border-t bg-purple-50/60 space-y-2 shrink-0">
              <div className="text-[11px] font-black text-purple-800">📒 حساب جديد في دليل الحسابات (مستقل — يمكن استخراج كشفه لاحقاً)</div>
              <input value={coaName} onChange={e => setCoaName(e.target.value)} placeholder="اسم الحساب (مثال: إيجار المكتب)" className="w-full px-2 py-1.5 text-xs border rounded bg-white outline-none focus:border-purple-400" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 shrink-0">الحساب الأب (تصنيف فقط):</span>
                <select value={coaParent} onChange={e => setCoaParent(e.target.value)} className="flex-1 text-[11px] border rounded px-1.5 py-1 bg-white font-bold">
                  {coaParents.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name_ar}</option>)}
                </select>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={submitCoaAdd} disabled={coaSaving} className="flex-1 px-3 py-1.5 rounded-lg bg-purple-600 text-white font-bold text-xs hover:bg-purple-700 disabled:opacity-50">{coaSaving ? '...' : '✅ إنشاء واختيار (الكود تلقائي)'}</button>
                <button type="button" onClick={() => setCoaAdd(false)} className="px-3 py-1.5 rounded-lg border text-xs font-bold text-slate-600 bg-white">إلغاء</button>
              </div>
            </div>
          )}
          <div className="p-1.5 border-t bg-slate-50 rounded-b-lg text-[10px] text-slate-500 text-center shrink-0">
            {results.length > 0 ? `${results.length} نتيجة — اضغط للاختيار` : (enableQA ? 'ابحث أولاً أو اضغط لإضافة جديد' : 'استخدم البحث الذكي')}
          </div>
        </div>,
        document.body
      )}
      {/* Quick-Add Dialog */}
      {quickAddOpen && (
        <QuickAddEntityDialog
          open={quickAddOpen}
          type={quickAddType}
          initialName={query.trim()}
          onOpenChange={setQuickAddOpen}
          onCreated={onQuickAddDone}
        />
      )}
    </div>
  )
}

// v3.10.3 — Quick-Add Client/Supplier Dialog
function QuickAddEntityDialog({ open, onOpenChange, type, initialName = '', onCreated }) {
  const [form, setForm] = useState({ name: initialName, phone: '', parent_code: type === 'client' ? COA_FE.CLIENTS : COA_FE.SUPPLIERS })
  const [saving, setSaving] = useState(false)
  const [parents, setParents] = useState([])
  useEffect(() => { setForm(f => ({ ...f, name: initialName })) }, [initialName])
  useEffect(() => {
    if (!open) return
    // Load possible parent accounts (assets for clients, liabilities for suppliers)
    const filterType = type === 'client' ? 'asset' : 'liability'
    api('/accounts').then(rows => {
      const list = (rows || []).filter(a => a.type === filterType && a.is_group)
      setParents(list.length ? list : (rows || []).filter(a => a.type === filterType))
    }).catch(() => setParents([]))
  }, [open, type])
  const submit = async () => {
    if (!form.name || !form.name.trim()) return toast.error('الاسم مطلوب')
    if (!form.phone || !form.phone.trim()) return toast.error('رقم الجوال مطلوب')
    try {
      setSaving(true)
      const endpoint = type === 'client' ? '/clients' : '/suppliers'
      const created = await api(endpoint, { method: 'POST', body: { name: form.name.trim(), phone: form.phone.trim(), parent_code: form.parent_code } })
      const entity = { id: created.id, name: created.name, type, account_code: created.account_code, parent_code: created.account_parent_code, balances: created.balances || {} }
      toast.success(`✅ تم إنشاء ${type === 'client' ? 'العميل' : 'المورد'} بكود: ${created.account_code}`)
      onCreated?.(entity)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const isClient = type === 'client'
  const clr = isClient ? 'emerald' : 'rose'
  const label = isClient ? 'عميل' : 'مورد'
  const icon = isClient ? '👤' : '🏭'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="text-2xl">{icon}</span>
            <span>إضافة {label} جديد سريعاً</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="الاسم" required>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={`اسم ال${label}`} className="font-semibold" />
          </Field>
          <Field label="رقم الجوال" required>
            <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="7XXXXXXXX" />
          </Field>
          <Field label="الحساب الأب (شجرة الحسابات)">
            <Select value={form.parent_code} onValueChange={v => setForm({ ...form, parent_code: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {parents.map(p => (
                  <SelectItem key={p.code} value={p.code}>
                    <span className="font-mono text-xs">{p.code}</span> — {p.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className={`text-[11px] p-2 rounded bg-${clr}-50 border border-${clr}-200 text-${clr}-700`}>
            💡 سيتم توليد كود الحساب تلقائياً بشكل تسلسلي تحت الحساب الأب المختار (مثال: {form.parent_code}0001)
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className={`bg-${clr}-600 hover:bg-${clr}-700 text-white`}>
            {saving ? 'جاري الحفظ...' : `✅ حفظ ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ================================================================
// TENANT SIDEBAR & TOP BAR
// ================================================================
// v3.2 — Reusable WhatsApp button. Grays out if phone is empty.
function WaBtn({ phone, message = '', size = 'sm', label, iconOnly = false }) {
  const normalized = normalizeWaPhone(phone)
  const disabled = !normalized
  const cls = `inline-flex items-center gap-1 rounded-md font-semibold transition-all ${
    disabled
      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
      : 'bg-[#25D366] hover:bg-[#128C7E] text-white shadow-sm hover:shadow'
  } ${size === 'xs' ? 'text-xs h-6 px-2' : size === 'md' ? 'text-sm h-8 px-3' : 'text-xs h-7 px-2'}`
  const handleClick = (e) => {
    e.stopPropagation()
    if (disabled) return toast.error('لا يوجد رقم هاتف مسجل — أضف الرقم أولاً')
    openWhatsApp(phone, message)
  }
  return (
    <button type="button" onClick={handleClick} className={cls} title={disabled ? 'لا يوجد رقم هاتف' : `إرسال واتساب إلى ${phone}`}>
      <svg viewBox="0 0 32 32" width={size === 'xs' ? 12 : 14} height={size === 'xs' ? 12 : 14} fill="currentColor" className="shrink-0">
        <path d="M16.001 3.2C9.075 3.2 3.401 8.874 3.401 15.8c0 2.196.578 4.348 1.677 6.246l-1.876 6.85 7.048-1.848a12.578 12.578 0 0 0 5.751 1.398c6.926 0 12.6-5.674 12.6-12.6S22.927 3.2 16.001 3.2Zm0 22.968a10.36 10.36 0 0 1-5.286-1.446l-.379-.225-4.185 1.098 1.116-4.078-.247-.394A10.4 10.4 0 1 1 16 26.168Zm5.706-7.784c-.312-.156-1.848-.913-2.135-1.017-.286-.104-.494-.156-.703.156s-.807 1.017-.989 1.226c-.182.208-.364.234-.676.078-.312-.156-1.319-.486-2.512-1.551-.929-.828-1.555-1.851-1.737-2.163-.182-.312-.019-.481.137-.636.14-.14.312-.364.468-.546.156-.182.208-.312.312-.52.104-.208.052-.39-.026-.546-.078-.156-.703-1.694-.963-2.32-.254-.61-.512-.527-.703-.537-.182-.008-.39-.01-.598-.01-.208 0-.546.078-.833.39-.286.312-1.093 1.068-1.093 2.606s1.119 3.023 1.275 3.231c.156.208 2.203 3.362 5.336 4.712.746.322 1.328.514 1.782.658.749.238 1.43.204 1.968.124.601-.09 1.848-.755 2.109-1.484.26-.729.26-1.354.182-1.484-.078-.13-.286-.208-.598-.364Z"/>
      </svg>
      {!iconOnly && (label || 'واتساب')}
    </button>
  )
}

const NAV = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, color: 'from-blue-600 to-cyan-500' },
  { id: 'tickets',   label: 'حجز التذاكر', icon: Plane, color: 'from-sky-600 to-blue-500' },
  { id: 'visas',     label: 'التأشيرات', icon: FileBadge2, color: 'from-emerald-600 to-teal-500' },
  { id: 'services',  label: 'الخدمات', icon: Briefcase, color: 'from-orange-600 to-amber-500' },
  { id: 'packages',  label: 'الباكجات والبرامج', icon: FileBadge2, color: 'from-teal-600 to-emerald-500' },
  { id: 'meraaj',    label: '🕋 متجر معراج', icon: Package, color: 'from-purple-700 to-fuchsia-500' },
  { id: 'visa-monitor', label: 'مراقبة التأشيرات', icon: CalendarClock, color: 'from-red-600 to-orange-500' },
  { id: 'query',     label: 'مركز الاستعلامات', icon: BarChart3, color: 'from-violet-600 to-indigo-500' },
  { id: 'fx',        label: 'صرافة العملات', icon: ArrowLeftRight, color: 'from-fuchsia-600 to-purple-500' },
  { id: 'receipt',   label: 'سند قبض', icon: ArrowDownLeft, color: 'from-green-600 to-emerald-500' },
  { id: 'payment',   label: 'سند صرف', icon: ArrowUpRight, color: 'from-rose-600 to-pink-500' },
  { id: 'clients',   label: 'العملاء', icon: Users, color: 'from-indigo-600 to-violet-500' },
  { id: 'suppliers', label: 'الموردون والوكلاء', icon: Building2, color: 'from-amber-600 to-orange-500' },
  { id: 'boxes',     label: 'الصناديق والبنوك', icon: Wallet, color: 'from-yellow-600 to-amber-500' },
  { id: 'chart',     label: 'الدليل المحاسبي', icon: BookOpenText, color: 'from-purple-600 to-fuchsia-500' },
  { id: 'journal',   label: 'قيود اليومية', icon: ReceiptText, color: 'from-slate-700 to-slate-500' },
  { id: 'reports',   label: 'التقارير المالية', icon: BarChart3, color: 'from-cyan-600 to-blue-500' },
  { id: 'affiliate', label: 'التسويق بالعمولة', icon: User, color: 'from-emerald-600 to-teal-500' },
  // v3.99 — Batch 1: old Super Admin sections merged into the shared sidebar (platform SA only — see canModule)
  { id: 'platform-offices', label: 'إدارة المكاتب', icon: Building2, color: 'from-slate-700 to-blue-600', group: 'إدارة رحّال' },
  // v4.0 — Batch 2: old plans/pricing + subscriptions/installments restored inside TenantApp
  { id: 'platform-plans', label: 'الباقات والتسعير', icon: Wallet, color: 'from-emerald-700 to-teal-500', group: 'إدارة رحّال' },
  { id: 'platform-subs', label: 'الاشتراكات والأقساط', icon: ReceiptText, color: 'from-blue-700 to-indigo-500', group: 'إدارة رحّال' },
  // v4.4 — ONE consolidated entry «المستخدمون والصلاحيات» (tabs: مديرو رحّال / الأدوار / طلبات استعادة كلمة المرور) — replaces the two separate entries
  { id: 'platform-people', label: 'المستخدمون والصلاحيات', icon: Users, color: 'from-cyan-700 to-sky-500', group: 'إدارة رحّال' },
  // v4.1 — Group 2 (moved as-is): Rahaal software sales + commissions center
  { id: 'platform-sales', label: 'مبيعات برنامج رحّال', icon: TrendingUp, color: 'from-green-700 to-emerald-500', group: 'إدارة رحّال' },
  { id: 'platform-commissions', label: 'مركز العمولات', icon: Percent, color: 'from-fuchsia-700 to-pink-500', group: 'إدارة رحّال' },
  // v4.3 — Group 3: unified orders registry + notifications center
  { id: 'platform-orders', label: 'مركز الطلبات', icon: Inbox, color: 'from-amber-700 to-orange-500', group: 'إدارة رحّال' },
  { id: 'platform-notify', label: 'مركز التنبيهات', icon: Bell, color: 'from-rose-700 to-red-500', group: 'إدارة رحّال' },
  // v4.4 — consolidated admin entries: system settings hub + standalone geo section
  { id: 'platform-system', label: 'إعدادات النظام', icon: Settings, color: 'from-slate-700 to-gray-500', group: 'إدارة رحّال' },
  { id: 'platform-geo', label: 'المواقع الجغرافية', icon: MapPin, color: 'from-lime-700 to-green-500', group: 'إدارة رحّال' },
  { id: 'platform-ads', label: 'الإعلانات والعروض', icon: ImageIcon, color: 'from-orange-600 to-amber-500', group: 'إدارة رحّال' },
  { id: 'help',      label: '📖 دليل الاستخدام', icon: BookOpenText, color: 'from-pink-600 to-rose-500' },
  { id: 'settings',  label: 'إعدادات المكتب', icon: Settings, color: 'from-slate-800 to-slate-600' },
]

// v3.45 — RBAC Phase 1: module access catalog + helper (owner always allowed; settings owner-only)
const MODULE_LABELS = [
  { k: 'mod_dashboard', l: 'لوحة التحكم' }, { k: 'mod_tickets', l: 'حجز التذاكر' }, { k: 'mod_visas', l: 'التأشيرات' },
  { k: 'mod_services', l: 'الخدمات' }, { k: 'mod_packages', l: 'الباكجات والبرامج' }, { k: 'mod_meraaj', l: '🕋 متجر معراج' },
  { k: 'mod_visa_monitor', l: 'مراقبة التأشيرات' }, { k: 'mod_query', l: 'مركز الاستعلامات' }, { k: 'mod_fx', l: 'صرافة العملات' },
  { k: 'mod_receipt', l: 'سند قبض' }, { k: 'mod_payment', l: 'سند صرف' }, { k: 'mod_clients', l: 'العملاء' },
  { k: 'mod_suppliers', l: 'الموردون والوكلاء' }, { k: 'mod_boxes', l: 'الصناديق والبنوك' }, { k: 'mod_chart', l: 'الدليل المحاسبي' },
  { k: 'mod_journal', l: 'قيود اليومية' }, { k: 'mod_reports', l: 'التقارير المالية' }, { k: 'mod_affiliate', l: 'التسويق بالعمولة' },
  { k: 'mod_help', l: 'دليل الاستخدام' },
]
const canModule = (user, tabId) => {
  if (!user) return false
  // v3.99 — Batch 1: «إدارة رحّال» group is for the PLATFORM SUPER ADMIN only
  // (checked BEFORE the owner shortcut so office owners never see it)
  if (String(tabId).startsWith('platform-')) return user.role === 'super_admin'
  if (user.role === 'owner') return true
  // v3.98 — Phase 1: the platform SA manages his own company office settings
  // (currencies & rates live here). Staff still never see settings.
  if (tabId === 'settings') return user.role === 'super_admin'
  return user.permissions?.[`mod_${String(tabId).replace(/-/g, '_')}`] !== false
}

// v4.7 — SA sidebar VISUAL grouping only (collapsible). Existing NAV entries/ids/labels are
// reused untouched — this is a render-time arrangement for the platform Super Admin ONLY;
// office owners/staff keep the exact flat sidebar they had. No section merge, no new dashboard.
const SA_SIDEBAR_GROUPS = [
  {
    id: 'grp-rahaal', label: 'إدارة رحّال', emoji: '🏢',
    items: ['platform-offices', 'platform-people', 'platform-plans', 'platform-subs', 'platform-sales', 'platform-orders', 'platform-commissions', 'platform-ads', 'platform-notify'],
  },
  {
    id: 'grp-finance', label: 'المحاسبة والإدارة المالية', emoji: '💰',
    items: ['fx', 'receipt', 'payment', 'clients', 'suppliers', 'boxes', 'chart', 'journal'],
  },
  {
    id: 'grp-reports', label: 'التقارير', emoji: '📊',
    items: ['reports'],
  },
  {
    id: 'grp-system', label: 'النظام والإعدادات', emoji: '⚙️',
    items: ['platform-system', 'platform-geo'],
  },
]

// v5.1 — Travel-office operational modules are HIDDEN from the platform SA / Rahaal company
// book (render-time visibility filter in the SA sidebar branch only). Their permissions for
// regular travel offices remain exactly as-is — this list never touches canModule or the RBAC.
const SA_OFFICE_MODULES = new Set(['tickets', 'visas', 'services', 'packages', 'meraaj', 'visa-monitor', 'query', 'affiliate'])

// v3.46 — Idle session auto-lock configuration (centralized — adjust here)
const IDLE_TIMEOUT_MINUTES = 15
// sessionStorage key set ONLY at idle-logout and consumed once on next login.
// Deliberately NOT written on normal navigation, so a hard refresh (Ctrl+R / Ctrl+Shift+R)
// always lands on the Dashboard (tab state is in-memory only), keeping both behaviors separate.
const IDLE_RESUME_KEY = 'rahaal_idle_resume_tab'

// v3.54 — Short pleasant two-tone chime for new Meraaj bookings (Web Audio — no external file)
const playMeraajChime = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    if (!globalThis.__rahaalAudioCtx) globalThis.__rahaalAudioCtx = new Ctx()
    const ctx = globalThis.__rahaalAudioCtx
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const t0 = ctx.currentTime
    ;[[880, 0], [1174.66, 0.14]].forEach(([freq, delay]) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + delay)
      g.gain.exponentialRampToValueAtTime(0.18, t0 + delay + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.35)
      o.connect(g); g.connect(ctx.destination)
      o.start(t0 + delay); o.stop(t0 + delay + 0.4)
    })
  } catch { /* autoplay blocked — silent fallback, toast still shows */ }
}

function Sidebar({ current, onChange, mobileOpen, onMobileClose }) {
  const { tenant, settings, user } = useAuth()
  // v4.7 — SA collapsible groups: multiple groups may stay open; the group holding the
  // active tab opens automatically (without closing others). Pure visual state.
  const isPlatformSA = user?.role === 'super_admin'
  const [openGroups, setOpenGroups] = useState(() => {
    const g = SA_SIDEBAR_GROUPS.find(x => x.items.includes(current))
    return new Set(g ? [g.id] : [])
  })
  useEffect(() => {
    const g = SA_SIDEBAR_GROUPS.find(x => x.items.includes(current))
    if (g) setOpenGroups(prev => (prev.has(g.id) ? prev : new Set([...prev, g.id])))
  }, [current])
  const toggleGroup = (gid) => setOpenGroups(prev => {
    const next = new Set(prev)
    if (next.has(gid)) next.delete(gid); else next.add(gid)
    return next
  })
  // v3.86 — swipe-right on the drawer closes it (RTL: drawer lives on the right edge)
  const swipeRef = useRef(null)
  const onTouchStart = (e) => { swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchMove = (e) => {
    if (!swipeRef.current || !onMobileClose) return
    const dx = e.touches[0].clientX - swipeRef.current.x
    const dy = Math.abs(e.touches[0].clientY - swipeRef.current.y)
    if (dx > 50 && dy < 60) { onMobileClose(); swipeRef.current = null }
  }
  const onTouchEnd = () => { swipeRef.current = null }
  return (
    <aside
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      className={`fixed md:sticky inset-y-0 right-0 z-50 md:z-auto w-72 max-w-[85vw] md:w-64 md:max-w-none h-[100dvh] md:h-screen shrink-0 bg-gradient-to-b from-[#0f1e4d] via-[#1e3a8a] to-[#0a1544] text-slate-100 flex flex-col border-l border-blue-900/60 transform transition-transform duration-200 ease-out ${mobileOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0`}
    >
      <div className="p-4 md:p-5 border-b border-blue-900/50">
        <div className="flex items-center gap-3">
          {settings?.logo_base64 ? (
            <img src={settings.logo_base64} alt="logo" className="w-11 h-11 rounded-xl object-cover bg-white" />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#1e40af] to-[#0f1e4d] flex items-center justify-center shadow-lg shadow-orange-500/20 border border-orange-400/40 shrink-0">
              <svg viewBox="0 0 64 64" fill="none" className="w-7 h-7">
                <path d="M8 40 L28 36 L40 20 L50 20 L44 34 L54 32 L58 40 L44 42 L38 50 L30 50 L34 42 L14 44 Z" fill="#f97316" />
                <circle cx="52" cy="16" r="3" fill="#f97316" />
              </svg>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-lg font-extrabold tracking-tight truncate">{settings?.agency_name || tenant?.name || 'رحّـــال'}</div>
            <div className="text-[10px] text-orange-300 font-black tracking-widest" style={{ letterSpacing: '0.15em' }}>RAHAL ERP</div>
            {/* v3.15 — Plan badge (approved suggestion) */}
            {(['silver', 'gold', 'enterprise'].includes(tenant?.plan_tier) || tenant?.unlimited_journals || tenant?.billing_mode) && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {tenant?.plan_tier === 'silver' && <span className="text-[9px] bg-slate-600 text-white px-1.5 py-0.5 rounded-full font-bold">🥈 سيلفر</span>}
                {tenant?.plan_tier === 'gold' && <span className="text-[9px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold">🥇 جولد</span>}
                {tenant?.plan_tier === 'enterprise' && <span className="text-[9px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full font-bold">🏢 إنتربرايز</span>}
                {(tenant?.unlimited_journals || tenant?.billing_mode === 'annual') && <span className="text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-bold">♾️ قيود مفتوحة</span>}
                {tenant?.billing_mode === 'installments' && !tenant?.unlimited_journals && <span className="text-[9px] bg-blue-500 text-white px-1.5 py-0.5 rounded-full font-bold">💳 أقساط</span>}
              </div>
            )}
          </div>
          {/* v3.86 — explicit close button (mobile drawer only) */}
          <button onClick={onMobileClose} aria-label="إغلاق القائمة" className="md:hidden shrink-0 w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto overscroll-contain p-2 md:p-3 space-y-1" style={{ touchAction: 'pan-y' }}>
        {(() => {
          // permission filtering stays EXACTLY as before (canModule) — a hidden item never
          // renders, and a group with zero visible items disappears entirely.
          const allowed = NAV.filter(n => canModule(user, n.id))
          const renderItem = (item) => {
            const Icon = item.icon
            const active = current === item.id
            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                title={item.label}
                className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-all ${
                  active ? 'bg-white/10 text-white shadow-inner' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className={`w-8 h-8 rounded-md flex items-center justify-center bg-gradient-to-br ${item.color} ${active ? 'shadow-lg' : 'opacity-80'} shrink-0`}>
                  <Icon className="w-4 h-4 text-white" />
                </span>
                <span className="flex-1 text-right">{item.label}</span>
                {active && <ChevronLeft className="w-4 h-4 text-slate-400" />}
              </button>
            )
          }
          if (!isPlatformSA) {
            // office owners/staff: the exact same flat sidebar as before (untouched)
            return allowed.map((item, idx, arr) => {
              const groupHeader = item.group && arr[idx - 1]?.group !== item.group
                ? <div key={`${item.id}-group`} className="pt-3 pb-1 px-3 text-[10px] font-black text-amber-400/90 tracking-widest">🏢 {item.group}</div>
                : null
              return [groupHeader, renderItem(item)]
            })
          }
          // v4.7 — platform SA: «لوحة التحكم» pinned on top, then the 4 collapsible groups,
          // then the remaining standalone entries in their original order.
          const byId = Object.fromEntries(allowed.map(n => [n.id, n]))
          const groupedIds = new Set(SA_SIDEBAR_GROUPS.flatMap(g => g.items))
          const dash = byId['dashboard']
          // v5.1 — the «أقسام المكتب» operational group stays invisible for the platform SA /
          // Rahaal company book. Only the SA sidebar branch is filtered — travel offices keep
          // the exact flat sidebar (per canModule) below. «إعدادات المكتب» is an office-only
          // skin (agency name/logo/header) that renders nearly empty for SA — hidden too.
          const standalone = allowed.filter(n => n.id !== 'dashboard' && !groupedIds.has(n.id) && !SA_OFFICE_MODULES.has(n.id) && n.id !== 'settings')
          return (
            <>
              {dash && renderItem(dash)}
              {SA_SIDEBAR_GROUPS.map(g => {
                const items = g.items.map(id => byId[id]).filter(Boolean)
                if (items.length === 0) return null // group fully hidden by permissions
                const open = openGroups.has(g.id)
                const hasActive = items.some(i => i.id === current)
                return (
                  <div key={g.id} className="pt-1">
                    <button
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={open}
                      className={`w-full flex items-center gap-2 px-3 py-2 min-h-[42px] rounded-lg text-[12px] font-black tracking-wide transition-all ${
                        hasActive ? 'text-amber-300 bg-white/5' : 'text-amber-400/90 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-sm">{g.emoji}</span>
                      <span className="flex-1 text-right">{g.label}</span>
                      <span className="text-[9px] font-bold text-slate-400 bg-white/10 rounded-full px-1.5 py-0.5">{items.length}</span>
                      {open ? <ChevronDown className="w-4 h-4 text-slate-300" /> : <ChevronLeft className="w-4 h-4 text-slate-400" />}
                    </button>
                    {open && (
                      <div className="mr-3 pr-1 border-r border-white/10 space-y-1 mt-1">
                        {items.map(renderItem)}
                      </div>
                    )}
                  </div>
                )
              })}
              {standalone.some(n => SA_OFFICE_MODULES.has(n.id)) && <div className="pt-2 pb-1 px-3 text-[10px] font-black text-slate-400/80 tracking-widest">أقسام المكتب</div>}
              {standalone.map(renderItem)}
            </>
          )
        })()}
      </nav>
      {/* v4.8 — Phase 2: «إدارة المنصة» is now a pure in-TenantApp navigation shortcut for the
          platform SA — jumps to the «إدارة رحّال» group (first entry: platform-offices).
          No AdminApp switch exists anymore — every role renders inside TenantApp. The nav id
          follows the existing NAV/canModule path, so the group auto-opens via the existing
          Sidebar effect, gated by RBAC only. */}
      {isPlatformSA && (
        <div className="p-2 md:p-3 border-t border-slate-800/70">
          <button
            onClick={() => onChange('platform-offices')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-bold bg-gradient-to-l from-amber-600 to-orange-500 text-white shadow-lg hover:opacity-90 transition"
          >
            🛡️ إدارة المنصة
          </button>
        </div>
      )}
      <div className="p-2 md:p-3 border-t border-slate-800/70">
        <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
          <div className="w-9 h-9 rounded-full grad-brand flex items-center justify-center shrink-0"><User className="w-4 h-4 text-white" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate">{user.name}</div>
            <div className="text-[10px] text-slate-400 truncate">{user.role === 'owner' ? 'مالك المكتب' : user.role === 'super_admin' ? 'المشرف العام' : 'موظف'}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}


// ================================================================
// DASHBOARD (same as v1 but tenant-aware)
// ================================================================
function Dashboard({ setTab }) {
  const [data, setData] = useState(null)
  const [tomorrow, setTomorrow] = useState([])
  const [monAlerts, setMonAlerts] = useState(null)
  const [digest, setDigest] = useState(null) // v3.61 — owner Meraaj daily digest (null for staff/errors)
  // v3.63 — full digest card in morning hours (before 12:00), compact strip afterwards (expandable)
  const [digestOpen, setDigestOpen] = useState(() => new Date().getHours() < 12)
  const [refillBusy, setRefillBusy] = useState(null)
  const refillSeats = async (w) => {
    setRefillBusy(w.id)
    try {
      const r = await api(`/meraaj/packages/${w.id}/add-seats`, { method: 'POST', body: { add: 5 } })
      toast.success(`✅ أُضيفت ${r.added} مقاعد لـ«${w.name}» — المتاح الآن ${r.remaining} من ${r.seats_allocated} (تم إشعار معراج)`)
      const dg = await api('/meraaj/daily-digest').catch(() => null)
      setDigest(dg)
    } catch (e) { toast.error(e.message) } finally { setRefillBusy(null) }
  }
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [d, tw, ma, dg] = await Promise.all([
        api('/dashboard'),
        api('/dashboard/tomorrow-travelers').catch(() => []),
        api('/visa-monitor/alerts').catch(() => null),
        api('/meraaj/daily-digest').catch(() => null), // owner-only; staff → null → card hidden
      ])
      setData(d); setTomorrow(tw || []); setMonAlerts(ma); setDigest(dg)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])
  const pieColors = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#64748b']

  const sendWhatsApp = (r) => {
    // v3.2 — Uses smart air/land template based on travel_mode
    const msg = tplTicket(r)
    const phone = r.passenger_whatsapp || r.passenger_phone || r.client_whatsapp || r.client_phone
    openWhatsApp(phone, msg)
  }

  // v3.62 — one-tap WhatsApp share of the morning Meraaj digest
  const sendDigestWhatsApp = () => {
    if (!digest) return
    const y = digest.yesterday || {}, t = digest.today || {}
    let msg = `🌅 ملخص معراج الصباحي — ${new Date().toLocaleDateString('en-GB')}\n\n📅 أمس:\n• الحجوزات: ${y.bookings || 0}\n• المقاعد: ${y.seats || 0}\n• صافي الإيراد: ${(y.net_to_seller || 0).toLocaleString('en-US')}\n\n📆 اليوم حتى الآن:\n• الحجوزات: ${t.bookings || 0} — صافي: ${(t.net_to_seller || 0).toLocaleString('en-US')}\n\n🔔 بانتظار الاعتماد: ${digest.pending || 0}`
    if (digest.alert) msg += `\n\n🚨 تحذير: ${digest.rejected_today} ويبهوك مرفوض اليوم (الحد: ${digest.reject_alert_threshold})`
    // v3.65 — weekly comparison line in the WhatsApp digest
    if (digest.week) {
      const g = digest.week.growth_pct
      msg += `\n\n📈 هذا الأسبوع: ${digest.week.this_week?.bookings || 0} حجز — صافي ${(digest.week.this_week?.net_to_seller || 0).toLocaleString('en-US')}\n(الأسبوع السابق: ${digest.week.prev_week?.bookings || 0} حجز — ${(digest.week.prev_week?.net_to_seller || 0).toLocaleString('en-US')})${g === null ? ' ✨ نشاط جديد' : g > 0 ? ` ▲ +${g}%` : g < 0 ? ` ▼ ${g}%` : ''}`
    }
    if ((digest.capacity_warnings || []).length > 0) msg += `\n\n⚠️ باكجات تقترب من نفاد المقاعد:\n` + digest.capacity_warnings.map(w => `• ${w.name}: ${w.remaining} متبقٍ من ${w.seats_allocated} (${w.pct}%)`).join('\n')
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <TopBar title="لوحة التحكم" subtitle="نظرة سريعة على أداء المكتب اليوم"
        right={<Button variant="outline" onClick={load} className="gap-2"><Activity className="w-4 h-4" /> تحديث</Button>} />
      {/* v3.9.22 — 4 quick action cards (Amadeus flight browser hidden until API keys available) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickAction icon={FileBadge2} label="التأشيرات" grad="grad-green" onClick={() => setTab('visas')} />
        <QuickAction icon={Plane} label="التذاكر" grad="grad-brand" onClick={() => setTab('tickets')} />
        <QuickAction icon={Package} label="الباقات" grad="grad-teal" onClick={() => setTab('packages')} />
        <QuickAction icon={Briefcase} label="الخدمات" grad="grad-gold" onClick={() => setTab('services')} />
      </div>
      {/* v3.61 — Rejected-webhooks alert banner (owner, threshold configurable in متجر معراج → صحة المزامنة) */}
      {digest?.alert && (
        <div className="flex items-center gap-3 bg-rose-50 border-2 border-rose-300 rounded-xl p-3">
          <span className="text-2xl">🚨</span>
          <div className="flex-1">
            <div className="text-sm font-black text-rose-700">تحذير: {digest.rejected_today} ويبهوك مرفوض اليوم (الحد المسموح: {digest.reject_alert_threshold})</div>
            <div className="text-[11px] text-rose-600">قد يشير هذا لمشكلة في مفتاح الربط (HMAC) مع معراج — راجع تبويب صحة المزامنة</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTab('meraaj')} className="border-rose-300 text-rose-700 hover:bg-rose-100 text-xs shrink-0">فحص الصحة ←</Button>
        </div>
      )}
      {/* v3.61 — Owner morning digest. v3.63 — full card in morning hours only; compact strip otherwise */}
      {digest && !digestOpen && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-indigo-50/70 border border-indigo-200 rounded-xl px-3 py-2">
          <span className="text-xs font-black text-indigo-900">🌅 ملخص معراج:</span>
          <span className="text-[11px] font-bold text-slate-600">أمس {digest.yesterday?.bookings ?? 0} حجز • صافي <span className="font-mono">{(digest.yesterday?.net_to_seller ?? 0).toLocaleString('en-US')}</span></span>
          <span className="text-[11px] font-bold text-slate-600">اليوم {digest.today?.bookings ?? 0} حجز</span>
          {digest.pending > 0 && <button onClick={() => setTab('meraaj')} className="text-[11px] font-black text-amber-700 hover:underline">🔔 {digest.pending} معلق</button>}
          {(digest.capacity_warnings || []).length > 0 && <span className="text-[11px] font-black text-amber-700">⚠️ {digest.capacity_warnings.length} باكج قرب النفاد</span>}
          <button onClick={() => setDigestOpen(true)} className="text-[11px] font-bold text-indigo-600 hover:underline mr-auto">عرض التفاصيل ▾</button>
        </div>
      )}
      {digest && digestOpen && (
        <Card className="border-indigo-200 bg-gradient-to-l from-indigo-50/60 via-white to-white">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-sm font-black text-indigo-900">🌅 ملخص معراج الصباحي</div>
              <div className="flex items-center gap-1.5">
                {/* v3.62 — one-tap WhatsApp share */}
                <Button size="sm" variant="outline" onClick={sendDigestWhatsApp} className="h-7 text-[11px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50">📱 إرسال واتساب</Button>
                {digest.pending > 0 ? (
                  <Button size="sm" onClick={() => setTab('meraaj')} className="h-7 text-[11px] gap-1 bg-amber-500 hover:bg-amber-600">🔔 {digest.pending} حجز بانتظار الاعتماد ←</Button>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-600">✅ لا حجوزات معلقة</span>
                )}
                {/* v3.63 — collapse to compact strip */}
                <button onClick={() => setDigestOpen(false)} title="طي الملخص" className="text-slate-400 hover:text-slate-600 text-sm px-1">▴</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-white border border-indigo-100 rounded-lg p-2.5 text-center">
                <div className="text-xl font-black text-indigo-700">{digest.yesterday?.bookings ?? 0}</div>
                <div className="text-[10px] text-slate-500">حجوزات أمس</div>
              </div>
              <div className="bg-white border border-indigo-100 rounded-lg p-2.5 text-center">
                <div className="text-xl font-black text-indigo-700">{digest.yesterday?.seats ?? 0}</div>
                <div className="text-[10px] text-slate-500">مقاعد أمس</div>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-2.5 text-center">
                <div className="text-lg font-black text-emerald-700 font-mono">{(digest.yesterday?.net_to_seller ?? 0).toLocaleString('en-US')}</div>
                <div className="text-[10px] text-slate-500">صافي إيراد أمس</div>
              </div>
              <div className="bg-white border border-blue-100 rounded-lg p-2.5 text-center">
                <div className="text-lg font-black text-blue-700">{digest.today?.bookings ?? 0} <span className="text-[10px] font-bold text-slate-400">حجز</span> <span className="font-mono text-sm">{(digest.today?.net_to_seller ?? 0).toLocaleString('en-US')}</span></div>
                <div className="text-[10px] text-slate-500">اليوم حتى الآن (حجوزات / صافي)</div>
              </div>
            </div>
            {/* v3.65 — week-over-week Meraaj sales comparison (same accounting source as digest) */}
            {digest.week && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold bg-white border border-indigo-100 rounded-lg px-2.5 py-1.5">
                <span className="text-indigo-900 font-black">📈 هذا الأسبوع:</span>
                <span>{digest.week.this_week?.bookings ?? 0} حجز • صافي <span className="font-mono">{(digest.week.this_week?.net_to_seller ?? 0).toLocaleString('en-US')}</span></span>
                <span className="text-slate-400">الأسبوع السابق: {digest.week.prev_week?.bookings ?? 0} حجز • <span className="font-mono">{(digest.week.prev_week?.net_to_seller ?? 0).toLocaleString('en-US')}</span></span>
                {digest.week.growth_pct === null ? <span className="text-emerald-600 font-black">✨ نشاط جديد هذا الأسبوع</span>
                  : digest.week.growth_pct > 0 ? <span className="text-emerald-600 font-black">▲ +{digest.week.growth_pct}%</span>
                  : digest.week.growth_pct < 0 ? <span className="text-rose-600 font-black">▼ {digest.week.growth_pct}%</span>
                  : <span className="text-slate-400 font-black">— ثابت</span>}
                {/* v3.66 — 4-week net revenue sparkline (same accounting source) */}
                {Array.isArray(digest.week.weeks) && digest.week.weeks.length > 0 && (() => {
                  const maxN = Math.max(1, ...digest.week.weeks.map(w => w.net_to_seller || 0))
                  return (
                    <span className="flex items-end gap-0.5 h-5 mr-1" title="صافي إيراد معراج لآخر 4 أسابيع (الأقدم → الأحدث)">
                      {digest.week.weeks.map((w, i) => (
                        <span key={w.start} title={`أسبوع ${w.start}: ${(w.net_to_seller || 0).toLocaleString('en-US')} صافي • ${w.bookings || 0} حجز`}
                          className={`w-2 rounded-t ${i === digest.week.weeks.length - 1 ? 'bg-indigo-600' : 'bg-indigo-300'}`}
                          style={{ height: `${Math.max(10, Math.round(((w.net_to_seller || 0) / maxN) * 100))}%` }} />
                      ))}
                    </span>
                  )
                })()}
              </div>
            )}
            {/* v3.62 — seat capacity warnings for shared packages close to selling out */}
            {(digest.capacity_warnings || []).length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[11px] font-black text-amber-700">⚠️ باكجات تقترب من نفاد المقاعد المخصصة لمعراج:</div>
                {digest.capacity_warnings.map(w => (
                  <div key={w.id} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-black text-slate-800">{w.name}</span>
                      <span className="text-[10px] text-amber-700 font-bold mr-2">{w.seats_sold}/{w.seats_allocated} مقعد — متبقٍ {w.remaining}</span>
                    </div>
                    <div className="w-24 h-2 bg-amber-100 rounded-full overflow-hidden shrink-0">
                      <div className={`h-full rounded-full ${w.pct >= 95 ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, w.pct)}%` }} />
                    </div>
                    <span className={`text-[10px] font-black shrink-0 ${w.pct >= 95 ? 'text-rose-600' : 'text-amber-700'}`}>{w.pct}%</span>
                    {/* v3.63 — one-tap seat refill (+5, notifies Meraaj) */}
                    <Button size="sm" onClick={() => refillSeats(w)} disabled={refillBusy === w.id}
                      className="h-6 text-[10px] px-2 gap-1 bg-amber-600 hover:bg-amber-700 shrink-0" title="زيادة 5 مقاعد وإشعار معراج فوراً">
                      {refillBusy === w.id ? <Loader2 className="w-3 h-3 animate-spin" /> : '➕'} 5 مقاعد
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="مبيعات اليوم" icon={DollarSign} grad="grad-brand"
          values={CURRENCIES.map(c => ({ label: c, value: fmt(data?.kpi?.sales_today?.[c] || 0, c) }))} loading={loading} />
        <KpiCard title="أرباح اليوم" icon={TrendingUp} grad="grad-green"
          values={CURRENCIES.map(c => ({ label: c, value: fmt(data?.kpi?.profit_today?.[c] || 0, c) }))} loading={loading} />
        <KpiCard title="عدد الحركات اليوم" icon={Activity} grad="grad-purple" bigValue={data?.kpi?.count_today || 0}
          details={[{ label: 'تذاكر', value: data?.kpi?.tickets_today || 0 }, { label: 'تأشيرات', value: data?.kpi?.visas_today || 0 }, { label: 'خدمات', value: data?.kpi?.services_today || 0 }]} loading={loading} />
        <KpiCard title="تاريخ اليوم" icon={Calendar} grad="grad-slate"
          bigValue={new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' })}
          details={[{ label: '', value: new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric' }) }]} loading={loading} />
      </div>

      {/* v3.11 — Visa Monitoring Alerts Widget (yellow + red + overstay ONLY) */}
      {monAlerts && monAlerts.total > 0 && (
        <Card className="border-red-300 bg-gradient-to-l from-red-50 to-slate-50 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-red-900 flex-wrap">
              <span className="text-xl">🛃</span> تنبيهات مراقبة التأشيرات ({monAlerts.total})
              {monAlerts.counts?.overstay > 0 && <Badge className="bg-slate-900 text-white">⚫ مخالف: {monAlerts.counts.overstay}</Badge>}
              {monAlerts.counts?.red > 0 && <Badge className="bg-red-600 text-white">🔴 خطر: {monAlerts.counts.red}</Badge>}
              {monAlerts.counts?.yellow > 0 && <Badge className="bg-yellow-400 text-yellow-950">🟡 قريب: {monAlerts.counts.yellow}</Badge>}
              <Button size="sm" variant="outline" onClick={() => setTab('visa-monitor')} className="ms-auto h-7 text-xs">فتح مركز المراقبة ←</Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المعتمر</TableHead>
                  <TableHead>الجواز</TableHead>
                  <TableHead>الوكيل</TableHead>
                  <TableHead>الانتهاء المتوقع</TableHead>
                  <TableHead className="text-center">الأيام المتبقية</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {monAlerts.rows.slice(0, 8).map(r => {
                    const meta = MON_TRACK[r.track_status] || {}
                    return (
                      <TableRow key={r.id} className={meta.row || ''}>
                        <TableCell className="font-semibold text-xs">{r.traveler_name}</TableCell>
                        <TableCell className="font-mono text-xs">{r.passport_no}</TableCell>
                        <TableCell className="text-xs">{r.agent_name || '—'}</TableCell>
                        <TableCell className="text-xs font-bold">{r.expected_exit_date || '—'}</TableCell>
                        <TableCell className="text-center text-xs">
                          {r.remaining_days < 0
                            ? <span className="font-black text-white bg-slate-900 px-2 py-0.5 rounded">متجاوز {Math.abs(r.remaining_days)} يوم</span>
                            : <span className={`font-black ${r.remaining_days <= 15 ? 'text-red-700' : 'text-yellow-700'}`}>{r.remaining_days} يوم</span>}
                        </TableCell>
                        <TableCell className="text-center"><Badge className={`${meta.badge || ''} border text-[10px] whitespace-nowrap`}>{meta.icon} {meta.label}</Badge></TableCell>
                        <TableCell className="text-center"><WaBtn phone={r.agent_phone} message={monWaMessage(r)} size="xs" label="إشعار الوكيل" iconOnly={false} /></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {monAlerts.total > 8 && <div className="text-center text-xs text-slate-500 mt-2">... و {monAlerts.total - 8} حالة أخرى — افتح مركز المراقبة للاطلاع الكامل</div>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v3.0 — Visa Expiration Alerts Widget (10 days ahead + overdue) */}
      {data?.visa_alerts && data.visa_alerts.length > 0 && (
        <Card className="border-amber-300 bg-gradient-to-l from-amber-50 to-orange-50 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="w-5 h-5 text-amber-600" /> تنبيهات انتهاء التأشيرات ({data.visa_alerts.length})
              <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 mr-2 border border-amber-300">
                خلال 10 أيام + متأخرة
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>صاحب التأشيرة</TableHead>
                  <TableHead>نوع التأشيرة</TableHead>
                  <TableHead>الجواز</TableHead>
                  <TableHead>الجنسية</TableHead>
                  <TableHead>حساب القبض</TableHead>
                  <TableHead>تاريخ الدخول</TableHead>
                  <TableHead>تاريخ الخروج المتوقع</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.visa_alerts.map(v => (
                    <TableRow key={v.id} className={v.overdue ? 'bg-rose-50/50' : v.days_left <= 3 ? 'bg-amber-50/40' : ''}>
                      <TableCell className="font-semibold">{v.passenger_name}</TableCell>
                      <TableCell className="text-xs">{v.service_type}</TableCell>
                      <TableCell className="font-mono text-xs">{v.passport_no || '—'}</TableCell>
                      <TableCell className="text-xs">{v.nationality || '—'}</TableCell>
                      <TableCell className="text-xs">{v.client_name}</TableCell>
                      <TableCell className="text-xs">{v.entry_date ? new Date(v.entry_date).toLocaleDateString('ar-EG') : '—'}</TableCell>
                      <TableCell className="text-xs font-bold">{v.expected_exit_date ? new Date(v.expected_exit_date).toLocaleDateString('ar-EG') : '—'}</TableCell>
                      <TableCell className="text-center">
                        {v.overdue ? (
                          <Badge className="bg-rose-500 text-white hover:bg-rose-600">متأخر {Math.abs(v.days_left)} يوم</Badge>
                        ) : v.days_left === 0 ? (
                          <Badge className="bg-orange-500 text-white hover:bg-orange-600">اليوم</Badge>
                        ) : (
                          <Badge className={v.days_left <= 3 ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-yellow-400 text-amber-900 hover:bg-yellow-400'}>باقٍ {v.days_left} يوم</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <WaBtn phone={v.passenger_whatsapp || v.passenger_phone} message={tplVisaExpiry(v)} size="xs" label="تنبيه" iconOnly={false} />
                          <Button size="sm" onClick={async () => {
                            try { await api(`/visas/${v.id}/mark-exited`, { method: 'POST' }); toast.success('تم تسجيل الخروج'); load() }
                            catch (e) { toast.error(e.message) }
                          }} className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1 h-7 px-2 text-xs">
                            <LogIn className="w-3 h-3 rotate-180" /> تم الخروج
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tomorrow's Travelers Widget */}
      {tomorrow.length > 0 && (
        <Card className="border-emerald-200 bg-gradient-to-l from-emerald-50 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-emerald-800">
              <Plane className="w-5 h-5 -rotate-45" /> رحلات الغد ({tomorrow.length} مسافر)
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 mr-2">اضغط 📲 لإرسال تذكير عبر الواتساب</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المسافر</TableHead>
                  <TableHead>الوسيلة</TableHead>
                  <TableHead>PNR</TableHead>
                  <TableHead>المسار</TableHead>
                  <TableHead>الجواز</TableHead>
                  <TableHead>حساب القبض / الهاتف</TableHead>
                  <TableHead>موعد السفر</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {tomorrow.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-semibold">{r.passenger_name || '—'}</TableCell>
                      <TableCell>
                        {r.travel_mode === 'land'
                          ? <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border border-orange-200">🚌 برية</Badge>
                          : <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100 border border-sky-200">✈️ جوية</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs"><Badge variant="outline">{r.pnr || '—'}</Badge></TableCell>
                      <TableCell className="text-xs">{r.route || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.passport_no || '—'}</TableCell>
                      <TableCell className="text-xs">{r.client_name}<br /><span className="text-slate-500">{r.passenger_phone || r.client_phone || 'لا يوجد رقم'}</span></TableCell>
                      <TableCell className="text-xs">
                        <div>{new Date(r.travel_date).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                        {r.departure_time && <div className="font-bold text-blue-700">🕐 {r.departure_time}</div>}
                      </TableCell>
                      <TableCell className="text-center">
                        <WaBtn phone={r.passenger_whatsapp || r.passenger_phone || r.client_whatsapp || r.client_phone} message={tplTicket(r)} size="md" label="واتساب" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-slate-200">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-slate-800"><TrendingUp className="w-5 h-5 text-blue-600" /> حركة المبيعات والأرباح — آخر 30 يوم (بمعادل الدولار)</CardTitle></CardHeader>
          <CardContent className="h-72">
            {data?.line?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.line}>
                  <defs>
                    <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} /></linearGradient>
                    <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.5} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <RTip contentStyle={{ direction: 'rtl', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Area type="monotone" dataKey="sales" name="مبيعات" stroke="#3b82f6" fillOpacity={1} fill="url(#gs)" strokeWidth={2} />
                  <Area type="monotone" dataKey="profit" name="أرباح" stroke="#10b981" fillOpacity={1} fill="url(#gp)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-slate-800"><PieIcon className="w-5 h-5 text-purple-600" /> توزيع الإيرادات</CardTitle></CardHeader>
          <CardContent className="h-72">
            {data?.pie?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.pie} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={80} innerRadius={45} paddingAngle={2}>
                    {data.pie.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <RTip contentStyle={{ direction: 'rtl', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>
      </div>
      <Card className="border-slate-200">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-slate-800"><Activity className="w-5 h-5 text-amber-500" /> شريط الحركة المباشر</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            <AnimatePresence>
              {(data?.activity || []).map((a) => (
                <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <ActivityIcon kind={a.kind} />
                  <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-slate-800 truncate">{a.title}</div><div className="text-xs text-slate-500">{a.subtitle}</div></div>
                  <div className="text-left"><div className="text-sm font-bold text-slate-700">{fmt(a.amount, a.currency)}</div><div className="text-[11px] text-slate-400">{fmtTime(a.when)}</div></div>
                </motion.div>
              ))}
              {(!data?.activity || data.activity.length === 0) && (
                <div className="text-center text-sm text-slate-400 py-10">لا توجد حركات بعد — ابدأ بتسجيل أول تذكرة أو تأشيرة</div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function QuickAction({ icon: Icon, label, grad, onClick }) {
  return (
    <button onClick={onClick} className={`${grad} text-white rounded-xl p-4 flex items-center gap-3 shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5`}>
      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center backdrop-blur-sm"><Icon className="w-5 h-5" /></div>
      <div className="text-right"><div className="font-bold">{label}</div><div className="text-xs opacity-90">إضافة سريعة</div></div>
    </button>
  )
}
function KpiCard({ title, icon: Icon, grad, values, bigValue, details, loading }) {
  return (
    <Card className="overflow-hidden border-slate-200 relative">
      <div className={`absolute inset-x-0 top-0 h-1 ${grad}`} />
      <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardDescription className="text-slate-500 text-xs">{title}</CardDescription><div className={`w-9 h-9 rounded-lg ${grad} flex items-center justify-center`}><Icon className="w-4 h-4 text-white" /></div></div></CardHeader>
      <CardContent className="pt-0">
        {loading ? <div className="h-16 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div> :
          bigValue !== undefined ? (
            <><div className="text-2xl font-extrabold text-slate-800">{bigValue}</div>{details?.map((d, i) => <div key={i} className="text-xs text-slate-500 mt-1">{d.label} <span className="font-semibold text-slate-700">{d.value}</span></div>)}</>
          ) : (
            <div className="space-y-1">{values.map(v => (<div key={v.label} className="flex items-center justify-between text-sm"><span className="text-xs text-slate-500">{v.label}</span><span className="font-bold text-slate-800">{v.value}</span></div>))}</div>
          )}
      </CardContent>
    </Card>
  )
}
function ActivityIcon({ kind }) {
  const map = {
    ticket:  { i: Plane, c: 'from-sky-500 to-blue-600' },
    visa:    { i: FileBadge2, c: 'from-emerald-500 to-teal-600' },
    receipt: { i: ArrowDownLeft, c: 'from-green-500 to-emerald-600' },
    payment: { i: ArrowUpRight, c: 'from-rose-500 to-pink-600' },
  }
  const { i: Icon, c } = map[kind] || map.ticket
  return <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${c} flex items-center justify-center shrink-0`}><Icon className="w-4 h-4 text-white" /></div>
}
const EmptyChart = () => <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2"><BarChart3 className="w-8 h-8 opacity-40" /><div>لا توجد بيانات بعد</div></div>

// ================================================================
// TICKETS SCREEN with Manual + Bulk import
// ================================================================
function TicketsScreen() {
  const { settings, tenant } = useAuth()
  const [tickets, setTickets] = useState([])
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [boxes, setBoxes] = useState([]) // v3.9.10 — for bulk edit
  const [openManual, setOpenManual] = useState(false)
  const [openBulk, setOpenBulk] = useState(false)
  const [openBulkEdit, setOpenBulkEdit] = useState(false) // v3.9.10
  const [openSearch, setOpenSearch] = useState(false)
  const [filter, setFilter] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set()) // v3.9.9 — multi-select
  const [dateRange, setDateRange] = useState({ preset: 'month', from: '', to: '' }) // v3.9.9
  const [editing, setEditing] = useState(null)
  const [refundTarget, setRefundTarget] = useState(null)
  const [rates, setRates] = useState(null)
  const load = async () => {
    try {
      const [t, c, s, r, bx] = await Promise.all([api('/tickets'), api('/clients'), api('/suppliers'), api('/rates'), api('/boxes').catch(() => [])])
      setTickets(t); setClients(c); setSuppliers(s); setRates(r.rates); setBoxes(bx)
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [])
  // v3.9.9 — Date range computation from preset
  const dateRangeBounds = useMemo(() => {
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (dateRange.preset === 'today') return { from: today, to: new Date(today.getTime() + 86400000 - 1) }
    if (dateRange.preset === 'week') { const d = new Date(today); d.setDate(d.getDate() - 6); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'month') { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'custom' && dateRange.from) {
      const f = new Date(dateRange.from); const t = dateRange.to ? new Date(dateRange.to + 'T23:59:59') : new Date()
      return { from: f, to: t }
    }
    return null // all
  }, [dateRange])
  const filteredByDate = useMemo(() => {
    const safe = (tickets || []).filter(Boolean)
    if (!dateRangeBounds) return safe
    return safe.filter(t => { const d = new Date(t?.date); return !isNaN(d) && d >= dateRangeBounds.from && d <= dateRangeBounds.to })
  }, [tickets, dateRangeBounds])
  const filtered = applyFilter(filteredByDate, filter)
  const selected = filtered.find(t => t?.id === selectedId)
  const allSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t?.id))
  const toggleAll = () => { if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(filtered.map(t => t.id))) }
  const toggleOne = (id) => { const s = new Set(selectedIds); if (s.has(id)) s.delete(id); else s.add(id); setSelectedIds(s) }
  const handleDelete = async () => {
    if (!selectedId) return
    if (!(await askConfirm({ title: 'حذف التذكرة', desc: 'سيتم حذف هذه التذكرة وعكس القيد المحاسبي المرتبط بها.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/tickets/${selectedId}`, { method: 'DELETE' }); toast.success('تم الحذف'); setSelectedId(null); load() }
    catch (e) { toast.error(e.message) }
  }
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return toast.error('لم يتم اختيار أي تذكرة')
    if (!(await askConfirm({ title: 'حذف جماعي للتذاكر', desc: `حذف ${ids.length} تذكرة وعكس قيودها المحاسبية دفعة واحدة؟`, variant: 'danger', irreversible: true, confirmLabel: 'حذف الكل' }))) return
    try {
      const r = await api('/tickets/bulk-delete', { method: 'POST', body: { ids } })
      toast.success(`✅ تم حذف ${r.deleted}${r.failed ? ` • فشل ${r.failed}` : ''}`)
      setSelectedIds(new Set()); setSelectedId(null); load()
    } catch (e) { toast.error(e.message) }
  }
  const handleEdit = () => {
    if (!selected) return toast.error('اختر تذكرة أولاً')
    setEditing(selected); setOpenManual(true)
  }
  const handleAdd = () => { setEditing(null); setOpenManual(true) }
  const handlePrintVoucher = () => {
    if (!selected) return toast.error('اختر تذكرة أولاً')
    printVoucher({ kind: 'ticket', record: selected, settings, tenant })
  }
  const handlePrintTable = () => {
    const totals = { cost: 0, sale_price: 0, commission: 0 }
    for (const r of filtered) { totals.cost += r.cost; totals.sale_price += r.sale_price; totals.commission += r.commission }
    printTable({
      title: 'كشف التذاكر', settings, tenant, rows: filtered,
      columns: [
        { key: 'date', label: 'التاريخ', render: r => fmtDate(r.date) },
        { key: 'pnr', label: 'PNR' },
        { key: 'route', label: 'خط السير' },
        { key: 'passenger_name', label: 'المسافر' },
        { key: 'client_name', label: 'حساب القبض' },
        { key: 'supplier_name', label: 'المورد' },
        { key: 'currency', label: 'عملة' },
        { key: 'cost', label: 'تكلفة', align: 'left', render: r => fmt(r.cost, r.currency) },
        { key: 'sale_price', label: 'بيع', align: 'left', render: r => fmt(r.sale_price, r.currency) },
        { key: 'commission', label: 'عمولة', align: 'left', render: r => fmt(r.commission, r.currency) },
      ],
      totals: { cost: totals.cost.toFixed(2), sale_price: totals.sale_price.toFixed(2), commission: totals.commission.toFixed(2) },
    })
  }

  return (
    <div className="space-y-4">
      <TopBar
        title="حجز التذاكر"
        subtitle="شاشة مدمجة للشراء والبيع وحساب العمولة تلقائياً"
        right={<Button variant="outline" onClick={() => setOpenBulk(true)} className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"><FileSpreadsheet className="w-4 h-4" /> رفع Excel/CSV</Button>}
      />
      <ActionToolbar
        addLabel="تذكرة جديدة" onAdd={handleAdd} onRefresh={load} onSearch={() => setOpenSearch(true)}
        onEdit={handleEdit} onDelete={handleDelete} onRefund={() => { if (!selected) return toast.error('اختر تذكرة أولاً'); if (selected.is_refunded) return toast.error('التذكرة مستردة مسبقاً'); setRefundTarget(selected) }} onPrintVoucher={handlePrintVoucher} onPrintTable={handlePrintTable}
        selectedId={selectedId} count={filtered.length}
      />
      {filter && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs">
          <Filter className="w-4 h-4 text-blue-600" /> فلتر نشط: <b>{filter.field}</b> {filter.condition === 'equals' ? 'يساوي' : 'يحتوي على'} "<b>{filter.term}</b>"
          <Button size="sm" variant="ghost" onClick={() => setFilter(null)} className="mr-auto text-rose-600">مسح</Button>
        </div>
      )}
      {/* v3.9.9 — Date range presets + Bulk actions bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg">
        <span className="text-xs font-bold text-slate-600 flex items-center gap-1">📅 عرض:</span>
        {[
          { k: 'today', l: 'اليوم' },
          { k: 'week', l: 'آخر ٧ أيام' },
          { k: 'month', l: 'هذا الشهر' },
          { k: 'all', l: 'الكل' },
          { k: 'custom', l: 'مخصص' },
        ].map(p => (
          <button key={p.k} onClick={() => setDateRange({ ...dateRange, preset: p.k })}
            className={`px-3 py-1 rounded-md text-xs font-semibold border ${dateRange.preset === p.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>{p.l}</button>
        ))}
        {dateRange.preset === 'custom' && (
          <>
            <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} className="text-xs border rounded px-2 py-1" />
            <span className="text-xs">إلى</span>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} className="text-xs border rounded px-2 py-1" />
          </>
        )}
        {selectedIds.size > 0 && (
          <div className="mr-auto flex items-center gap-2">
            <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">✓ محدد: {selectedIds.size}</span>
            <Button size="sm" onClick={() => setOpenBulkEdit(true)} className="gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white">✏️ تعديل المحدد ({selectedIds.size})</Button>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} className="gap-1 text-xs">🗑️ حذف المحدد ({selectedIds.size})</Button>
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} className="text-xs">إلغاء التحديد</Button>
          </div>
        )}
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plane className="w-5 h-5 text-sky-600" /> سجل التذاكر ({filtered.length}{(filter || dateRangeBounds) ? ` من ${tickets.length}` : ''})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} title="تحديد الكل" /></TableHead>
                <TableHead className="w-8"></TableHead><TableHead>التاريخ</TableHead><TableHead>PNR</TableHead>
                <TableHead>خط السير</TableHead><TableHead>المسافر</TableHead>
                <TableHead>🚌 الشركة الناقلة</TableHead>
                <TableHead>حساب القبض</TableHead>
                <TableHead>المورد</TableHead><TableHead>الدفع</TableHead><TableHead>العملة</TableHead>
                <TableHead className="text-left">تكلفة</TableHead><TableHead className="text-left">بيع</TableHead>
                <TableHead className="text-left text-emerald-600">عمولة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={14} className="text-center text-slate-400 py-8">{filter || dateRangeBounds ? 'لا نتائج ضمن الفلتر/النطاق التاريخي' : 'لا توجد تذاكر'}</TableCell></TableRow>}
                {filtered.map(t => (
                  <TableRow key={t.id} className={selectedIds.has(t.id) ? 'bg-rose-50' : selectedId === t.id ? 'bg-blue-50' : 'cursor-pointer hover:bg-slate-50'} onClick={(e) => { if (e.target.tagName === 'INPUT') return; setSelectedId(t.id === selectedId ? null : t.id) }}>
                    <TableCell><input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleOne(t.id)} onClick={e => e.stopPropagation()} /></TableCell>
                    <TableCell><input type="radio" checked={selectedId === t.id} onChange={() => setSelectedId(t.id)} onClick={e => e.stopPropagation()} /></TableCell>
                    <TableCell className="text-xs">{fmtDate(t.date)}</TableCell>
                    <TableCell className="font-mono text-xs">{t.pnr || '—'}</TableCell>
                    <TableCell className="text-xs">{t.route || '—'}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-2">
                        <span>{t.passenger_name || '—'}</span>
                        {(t.passenger_whatsapp || t.passenger_phone) && (
                          <WaBtn phone={t.passenger_whatsapp || t.passenger_phone} message={tplTicket(t)} size="xs" iconOnly={true} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{t.carrier_name ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 font-semibold">🚌 {t.carrier_name}</span> : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell>{t.client_name}</TableCell>
                    <TableCell>{t.supplier_name}</TableCell>
                    <TableCell>{t.payment_method === 'cash' ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">💵 نقد</Badge> : <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">🕓 آجل</Badge>}</TableCell>
                    <TableCell><Badge variant="outline">{t.currency}</Badge></TableCell>
                    <TableCell className="text-left font-semibold">{fmt(t.cost, t.currency)}</TableCell>
                    <TableCell className="text-left font-semibold">{fmt(t.sale_price, t.currency)}</TableCell>
                    <TableCell className="text-left font-bold text-emerald-600">{fmt(t.commission, t.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <TicketDialog open={openManual} onOpenChange={(v) => { setOpenManual(v); if (!v) setEditing(null) }} clients={clients} suppliers={suppliers} rates={rates} record={editing}
        onSaved={() => { load(); setEditing(null); toast.success(editing ? '✅ تم تعديل التذكرة وعكس القيد السابق تلقائياً' : 'تم حفظ التذكرة وإنشاء القيد المحاسبي تلقائياً') }} />
      <RefundDialog open={!!refundTarget} onOpenChange={v => !v && setRefundTarget(null)} record={refundTarget} refType="ticket" onSaved={() => { setRefundTarget(null); load() }} />
      <BulkImportDialog open={openBulk} onOpenChange={setOpenBulk} kind="tickets" onDone={() => { load(); setOpenBulk(false) }} />
      <BulkEditDialog open={openBulkEdit} onOpenChange={setOpenBulkEdit} kind="tickets" ids={Array.from(selectedIds)} suppliers={suppliers} boxes={boxes} onDone={() => { load(); setOpenBulkEdit(false); setSelectedIds(new Set()) }} />
      <UniversalSearchModal open={openSearch} onOpenChange={setOpenSearch}
        fields={[
          { key: 'pnr', label: 'رقم التذكرة (PNR)' }, { key: 'passenger_name', label: 'اسم المسافر' },
          { key: 'client_name', label: 'حساب القبض' }, { key: 'supplier_name', label: 'اسم المورد' },
          { key: 'route', label: 'خط السير' }, { key: 'sale_price', label: 'سعر البيع' }, { key: 'currency', label: 'العملة' },
        ]}
        onApply={setFilter} onClear={() => setFilter(null)}
      />
    </div>
  )
}

// v3.20 — Reusable Partner Commission Sharing block (Tickets / Visas / Services / Packages)
function CommissionShareBlock({ form, setForm, clients, suppliers, commission, entityLabel = 'العملية' }) {
  if (!(commission > 0)) return null
  return (
    <div className="bg-gradient-to-l from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-xl p-4 mt-2">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-slate-800 flex items-center gap-2">🤝 <span>مشاركة العمولة (اختياري)</span></div>
        {form.commission_partner_id && (
          <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, commission_partner_type: '', commission_partner_id: '', commission_partner_name: '', commission_share_value: '' })} className="text-rose-600 h-7 text-xs">إلغاء المشاركة</Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Field label="الشريك (المستفيد) 🔍">
          <AccountAutocomplete
            type="party"
            value={form.commission_partner_id || null}
            onChange={(sel) => setForm({ ...form, commission_partner_type: sel?.type || '', commission_partner_id: sel?.id || '', commission_partner_name: sel?.name || '' })}
            placeholder="ابحث عن عميل / مورد..."
          />
        </Field>
        <Field label="الصيغة">
          <Select value={form.commission_share_mode} onValueChange={v => setForm({ ...form, commission_share_mode: v })} disabled={!form.commission_partner_id}>
            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="amount">💰 مبلغ ثابت</SelectItem>
              <SelectItem value="percent">📊 نسبة من العمولة</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={form.commission_share_mode === 'percent' ? 'النسبة %' : `المبلغ (${form.currency})`}>
          <Input type="number" min="0" step="0.01" value={form.commission_share_value} onChange={e => setForm({ ...form, commission_share_value: e.target.value })} disabled={!form.commission_partner_id} placeholder={form.commission_share_mode === 'percent' ? '50' : '5'} className="bg-white" />
        </Field>
        <Field label="حصة المكتب">
          {(() => {
            const share = form.commission_share_mode === 'percent'
              ? +(commission * (Number(form.commission_share_value) || 0) / 100).toFixed(2)
              : +(Number(form.commission_share_value) || 0).toFixed(2)
            const cappedShare = Math.min(Math.max(0, share), commission)
            const netOffice = +(commission - cappedShare).toFixed(2)
            return (
              <div className="text-sm space-y-0.5">
                <div className="flex justify-between"><span className="text-slate-500">حصة الشريك:</span><b className="text-amber-700">{fmt(cappedShare, form.currency)}</b></div>
                <div className="flex justify-between border-t pt-0.5"><span className="text-slate-500">حصة المكتب:</span><b className="text-emerald-700">{fmt(netOffice, form.currency)}</b></div>
              </div>
            )
          })()}
        </Field>
      </div>
      <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">
        💡 عند حفظ {entityLabel}، سيُنشأ سطر إضافي في قيد اليومية يخصم حصة الشريك من إيرادات المكتب ويقيدها لحسابه — مما يُسهّل المقاصة المالية لاحقاً بدون كشوفات يدوية.
      </div>
    </div>
  )
}

function TicketDialog({ open, onOpenChange, clients, suppliers, rates, onSaved, record }) {
  const { user } = useAuth() // v3.9.9 — for default_box_id & lock_box
  const isEdit = !!record
  const emptyForm = {
    date: todayISO(), currency: 'USD', exchange_rate: 1, client_id: '', supplier_id: '',
    pnr: '', route: '', passenger_name: '', passport_no: '', travel_date: '',
    cost: '', sale_price: '', payment_method: 'credit', box_id: '',
    // v2.7 non-financial fields
    carrier_name: '', passenger_phone: '', passenger_age: '', id_type: 'هوية شخصية',
    id_issue_place: '', id_issue_date: '', ticket_number: '', flight_number: '',
    ticket_type: 'عادي', arrival_time: '', departure_time: '', boarding_point: '', sale_point: '',
    // v3.2 — Travel mode + WhatsApp
    travel_mode: 'air', passenger_whatsapp: '',
    // v3.9.27 — Commission Sharing
    commission_partner_type: '', commission_partner_id: '', commission_partner_name: '',
    commission_share_mode: 'amount', commission_share_value: '',
  }
  const [form, setForm] = useState(emptyForm)
  const [boxes, setBoxes] = useState([])
  const [saving, setSaving] = useState(false)
  const [quickC, setQuickC] = useState(false); const [quickS, setQuickS] = useState(false)
  useEffect(() => {
    if (!open) return
    if (record) {
      setForm({
        date: record.date ? new Date(record.date).toISOString().slice(0,10) : todayISO(),
        currency: record.currency || 'USD',
        exchange_rate: record.exchange_rate || 1,
        client_id: record.client_id || '', supplier_id: record.supplier_id || '',
        pnr: record.pnr || '', route: record.route || '',
        passenger_name: record.passenger_name || '', passport_no: record.passport_no || '',
        travel_date: record.travel_date ? new Date(record.travel_date).toISOString().slice(0,10) : '',
        cost: record.cost ?? '', sale_price: record.sale_price ?? '',
        payment_method: record.payment_method || 'credit', box_id: record.box_id || '',
        carrier_name: record.carrier_name || '', passenger_phone: record.passenger_phone || '',
        passenger_age: record.passenger_age || '', id_type: record.id_type || 'هوية شخصية',
        id_issue_place: record.id_issue_place || '',
        id_issue_date: record.id_issue_date ? String(record.id_issue_date).slice(0,10) : '',
        ticket_number: record.ticket_number || record.pnr || '',
        flight_number: record.flight_number || '',
        ticket_type: record.ticket_type || 'عادي',
        arrival_time: record.arrival_time || '',
        departure_time: record.departure_time || '',
        boarding_point: record.boarding_point || '',
        sale_point: record.sale_point || '',
        travel_mode: record.travel_mode === 'land' ? 'land' : 'air',
        passenger_whatsapp: record.passenger_whatsapp || record.passenger_phone || '',
        commission_partner_type: record.commission_partner_type || '',
        commission_partner_id: record.commission_partner_id || '',
        commission_partner_name: record.commission_partner_name || '',
        commission_share_mode: record.commission_share_mode || 'amount',
        commission_share_value: record.commission_share_value ?? '',
      })
    } else {
      setForm(emptyForm)
    }
  }, [open, record])
  useEffect(() => { if (rates && form.currency && !isEdit) setForm(f => ({ ...f, exchange_rate: rates[f.currency] || 1 })) }, [rates, form.currency])
  useEffect(() => { if (open) api('/boxes').then(setBoxes).catch(()=>{}) }, [open])
  useEffect(() => { if (form.payment_method === 'cash' && boxes[0] && !form.box_id) setForm(f => ({ ...f, box_id: (user?.default_box_id && boxes.find(b => b.id === user.default_box_id)) ? user.default_box_id : boxes[0].id })) }, [form.payment_method, boxes, user])
  const commission = useMemo(() => (Number(form.sale_price) || 0) - (Number(form.cost) || 0), [form.sale_price, form.cost])
  const submit = async () => {
    // v3.9.22 — Unified payment: credit → client_id required; cash → box_id required
    if (!form.supplier_id) return toast.error('اختر المورد')
    // v3.89 — Task 5: FE checks mirror backend mandatory fields exactly
    if (!String(form.passenger_name || '').trim()) return toast.error('اسم المسافر مطلوب')
    if (!form.travel_date) return toast.error('تاريخ السفر مطلوب')
    if (!String(form.passenger_phone || form.passenger_whatsapp || '').trim()) return toast.error('رقم الجوال مطلوب')
    if (form.payment_method === 'credit' && !form.client_id) return toast.error('اختر حساب القبض / العميل (للحجز الآجل)')
    if (form.payment_method === 'cash' && !form.box_id) return toast.error('اختر الصندوق / البنك (للنقد)')
    if (!form.cost || !form.sale_price) return toast.error('أدخل التكلفة وسعر البيع')
    try {
      setSaving(true)
      if (isEdit) {
        await api(`/tickets/${record.id}`, { method: 'PUT', body: form })
      } else {
        await api('/tickets', { method: 'POST', body: form })
      }
      onOpenChange(false); setForm(emptyForm); onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-xl"><div className="w-9 h-9 rounded-lg grad-brand flex items-center justify-center"><Plane className="w-4 h-4 text-white -rotate-45" /></div>{isEdit ? '✏️ تعديل تذكرة' : 'حجز تذكرة جديدة'}</DialogTitle><DialogDescription>{isEdit ? 'سيتم عكس القيد المحاسبي القديم وإعادة الترحيل بالقيم الجديدة تلقائياً — دون خصم من حصة القيود' : 'سيتم إنشاء قيد يومية تلقائي — نقد (خصم من الصندوق) أو آجل (على حساب القبض)'}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
            <Field label="تاريخ الحركة"><DocDateInput value={form.date} onChange={v => setForm({ ...form, date: v })} /></Field>
            <Field label="نوع العملة"><Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c} — {CUR_NAME[c]}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="سعر الصرف"><Input type="number" min="0" step="0.0001" value={form.exchange_rate} onChange={e => setForm({ ...form, exchange_rate: e.target.value })} /></Field>
            <Field label="اسم المورد 🔍" required>
              <AccountAutocomplete type="supplier" value={form.supplier_id || null}
                onChange={(sel) => setForm({ ...form, supplier_id: sel?.id || '' })}
                placeholder="ابحث عن المورد بالاسم أو الكود..." />
            </Field>
            <Field label="رقم التذكرة / PNR"><Input value={form.pnr} onChange={e => setForm({ ...form, pnr: e.target.value })} /></Field>
            <Field label="خط السير"><Input value={form.route} onChange={e => setForm({ ...form, route: e.target.value })} placeholder="RUH - CAI" /></Field>
            <Field label="اسم المسافر" required><Input value={form.passenger_name} onChange={e => setForm({ ...form, passenger_name: e.target.value })} /></Field>
            <Field label="رقم الجواز"><Input value={form.passport_no} onChange={e => setForm({ ...form, passport_no: e.target.value })} /></Field>
            <Field label="تاريخ السفر" required><Input type="date" value={form.travel_date} onChange={e => setForm({ ...form, travel_date: e.target.value })} /></Field>
          </div>

          {/* v3.2 — Travel mode + carrier + smart WhatsApp phone */}
          <div className="bg-gradient-to-l from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-2">
              🚌 <span>نوع الرحلة والشركة الناقلة (يُطبع على التذكرة + يُستخدم في قوالب الواتساب الذكية)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="وسيلة الرحلة" required>
                <Select value={form.travel_mode} onValueChange={v => setForm({ ...form, travel_mode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="air">✈️ رحلة جوية (طيران)</SelectItem>
                    <SelectItem value="land">🚌 رحلة برية (حافلة / نقل بري)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={form.travel_mode === 'land' ? 'شركة النقل البري' : 'شركة الطيران'}>
                <Input value={form.carrier_name} onChange={e => setForm({ ...form, carrier_name: e.target.value })}
                  placeholder={form.travel_mode === 'land' ? 'مثال: البركة، الرويشان' : 'مثال: الخطوط السعودية، فلاي دبي'}
                  className="bg-white border-amber-300" />
              </Field>
              <Field label="⏰ موعد الإقلاع/الانطلاق">
                <Input type="time" value={form.departure_time} onChange={e => setForm({ ...form, departure_time: e.target.value })} className="bg-white border-amber-300 font-bold text-base" />
              </Field>
            </div>
          </div>

          {/* v3.2 — Contact panel (Phone + WhatsApp for smart templates) */}
          <div className="bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-emerald-900 mb-2 flex items-center gap-2">
              📱 <span>بيانات التواصل — لتفعيل زر إرسال الواتساب مباشرة إلى المسافر</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="رقم هاتف المسافر" required><Input dir="ltr" value={form.passenger_phone} onChange={e => {
                const v = e.target.value; setForm(f => ({ ...f, passenger_phone: v, passenger_whatsapp: f.passenger_whatsapp || v }))
              }} placeholder="777xxxxxxx أو 5xxxxxxxx" className="bg-white" /></Field>
              <Field label="رقم واتساب (إن اختلف عن الهاتف)"><Input dir="ltr" value={form.passenger_whatsapp} onChange={e => setForm({ ...form, passenger_whatsapp: e.target.value })} placeholder="اختياري — يستخدم رقم الهاتف افتراضياً" className="bg-white" /></Field>
            </div>
          </div>

          <div className="bg-slate-50 border rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">👤 بيانات المسافر الإضافية (للطباعة)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="العمر"><Input value={form.passenger_age} onChange={e => setForm({ ...form, passenger_age: e.target.value })} placeholder="30" /></Field>
              <Field label="نوع الهوية">
                <Select value={form.id_type} onValueChange={v => setForm({ ...form, id_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="هوية شخصية">هوية شخصية</SelectItem>
                    <SelectItem value="جواز سفر">جواز سفر</SelectItem>
                    <SelectItem value="بطاقة عائلية">بطاقة عائلية</SelectItem>
                    <SelectItem value="رخصة قيادة">رخصة قيادة</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="جهة إصدار الهوية"><Input value={form.id_issue_place} onChange={e => setForm({ ...form, id_issue_place: e.target.value })} placeholder="عدن، صنعاء..." /></Field>
              <Field label="تاريخ إصدار الهوية"><Input type="date" value={form.id_issue_date} onChange={e => setForm({ ...form, id_issue_date: e.target.value })} /></Field>
            </div>
          </div>

          <div className="bg-slate-50 border rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">🎫 بيانات الرحلة الإضافية (للطباعة)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="رقم التذكرة (المُسلسل)"><Input value={form.ticket_number} onChange={e => setForm({ ...form, ticket_number: e.target.value })} placeholder="262054673" /></Field>
              <Field label="رقم الرحلة"><Input value={form.flight_number} onChange={e => setForm({ ...form, flight_number: e.target.value })} placeholder="26205054" /></Field>
              <Field label="نوع التذكرة">
                <Select value={form.ticket_type} onValueChange={v => setForm({ ...form, ticket_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="عادي">عادي</SelectItem>
                    <SelectItem value="VIP">VIP</SelectItem>
                    <SelectItem value="سياحية">سياحية</SelectItem>
                    <SelectItem value="أعمال">أعمال</SelectItem>
                    <SelectItem value="ذهاب">ذهاب</SelectItem>
                    <SelectItem value="ذهاب وعودة">ذهاب وعودة</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="وقت الحضور"><Input value={form.arrival_time} onChange={e => setForm({ ...form, arrival_time: e.target.value })} placeholder="07:30 ص" /></Field>
              <Field label="وقت الانطلاق"><Input value={form.departure_time} onChange={e => setForm({ ...form, departure_time: e.target.value })} placeholder="08:00 ص" /></Field>
              <Field label="نقطة الصعود"><Input value={form.boarding_point} onChange={e => setForm({ ...form, boarding_point: e.target.value })} placeholder="محطة عدن الرئيسية" /></Field>
              <div className="md:col-span-3">
                <Field label="نقطة البيع / الفرع"><Input value={form.sale_point} onChange={e => setForm({ ...form, sale_point: e.target.value })} placeholder="مكتب الرحّال — الفرع الرئيسي" /></Field>
              </div>
            </div>
          </div>

          {/* v3.9.22 — Unified Payment Selector: one dropdown, conditional client/box selector */}
          <div className="bg-gradient-to-l from-slate-50 to-blue-50 border-2 border-blue-200 rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
              💳 <span>طريقة الدفع + جهة الاستلام</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="طريقة الدفع" required>
                <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">🕓 آجل (على حساب عميل)</SelectItem>
                    <SelectItem value="cash">💵 نقد (صندوق / بنك)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.payment_method === 'credit' ? (
                <Field label="حساب القبض / العميل 🔍" required>
                  <AccountAutocomplete type="client" value={form.client_id || null}
                    onChange={(sel) => setForm({ ...form, client_id: sel?.id || '' })}
                    placeholder="ابحث عن العميل بالاسم أو الكود..." />
                </Field>
              ) : (
                <Field label="الصندوق / البنك 🔍" required>
                  <AccountAutocomplete type="box" value={form.box_id || null}
                    onChange={(sel) => setForm({ ...form, box_id: sel?.id || '' })}
                    placeholder="ابحث عن صندوق أو بنك..."
                    disabled={!!user?.lock_box && user?.role !== 'owner'} />
                </Field>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-l from-blue-50 to-emerald-50 border rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Banknote className="w-4 h-4 text-blue-600" /> الجانب المالي</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label={`سعر التكلفة (${form.currency})`} required><Input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} className="text-lg font-bold" /></Field>
              <Field label={`سعر البيع (${form.currency})`} required><Input type="number" min="0" step="0.01" value={form.sale_price} onChange={e => setForm({ ...form, sale_price: e.target.value })} className="text-lg font-bold" /></Field>
              <Field label={`العمولة (${form.currency})`}>
                <div className={`px-3 py-2 rounded-md border text-lg font-extrabold ${commission >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{fmt(commission, form.currency)}</div>
              </Field>
            </div>
          </div>

          {/* v3.9.27 — Commission Sharing block */}
          {commission > 0 && (
            <div className="bg-gradient-to-l from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-xl p-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-slate-800 flex items-center gap-2">🤝 <span>مشاركة العمولة (اختياري)</span></div>
                {form.commission_partner_id && (
                  <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, commission_partner_type: '', commission_partner_id: '', commission_partner_name: '', commission_share_value: '' })} className="text-rose-600 h-7 text-xs">إلغاء المشاركة</Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <Field label="الشريك (المستفيد) 🔍">
                  <AccountAutocomplete
                    type="party"
                    value={form.commission_partner_id || null}
                    onChange={(sel) => setForm({ ...form, commission_partner_type: sel?.type || '', commission_partner_id: sel?.id || '', commission_partner_name: sel?.name || '' })}
                    placeholder="ابحث عن عميل / مورد..."
                  />
                </Field>
                <Field label="الصيغة">
                  <Select value={form.commission_share_mode} onValueChange={v => setForm({ ...form, commission_share_mode: v })} disabled={!form.commission_partner_id}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="amount">💰 مبلغ ثابت</SelectItem>
                      <SelectItem value="percent">📊 نسبة من العمولة</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={form.commission_share_mode === 'percent' ? 'النسبة %' : `المبلغ (${form.currency})`}>
                  <Input type="number" min="0" step="0.01" value={form.commission_share_value} onChange={e => setForm({ ...form, commission_share_value: e.target.value })} disabled={!form.commission_partner_id} placeholder={form.commission_share_mode === 'percent' ? '50' : '5'} />
                </Field>
                <Field label="حصة المكتب">
                  {(() => {
                    const share = form.commission_share_mode === 'percent'
                      ? +(commission * (Number(form.commission_share_value) || 0) / 100).toFixed(2)
                      : +(Number(form.commission_share_value) || 0).toFixed(2)
                    const cappedShare = Math.min(Math.max(0, share), commission)
                    const netOffice = +(commission - cappedShare).toFixed(2)
                    return (
                      <div className="text-sm space-y-0.5">
                        <div className="flex justify-between"><span className="text-slate-500">حصة الشريك:</span><b className="text-amber-700">{fmt(cappedShare, form.currency)}</b></div>
                        <div className="flex justify-between border-t pt-0.5"><span className="text-slate-500">حصة المكتب:</span><b className="text-emerald-700">{fmt(netOffice, form.currency)}</b></div>
                      </div>
                    )
                  })()}
                </Field>
              </div>
              <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                💡 عند حفظ التذكرة، سيُنشأ سطر إضافي في قيد اليومية يخصم حصة الشريك من إيرادات المكتب ويقيدها لحسابه — مما يُسهّل المقاصة المالية لاحقاً بدون كشوفات يدوية.
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button onClick={submit} disabled={saving} className="grad-brand text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? '💾 حفظ التعديل + عكس القيد' : 'حفظ + إنشاء قيد')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <QuickAddDialog open={quickC} onOpenChange={setQuickC} kind="client" onSaved={onSaved} />
      <QuickAddDialog open={quickS} onOpenChange={setQuickS} kind="supplier" onSaved={onSaved} />
    </>
  )
}

function QuickAddDialog({ open, onOpenChange, kind, onSaved, initialName }) {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState(''); const [serviceType, setServiceType] = useState('')
  // v3.10.3 — parent account selection (COA integration)
  const [parentCode, setParentCode] = useState(kind === 'client' ? COA_FE.CLIENTS : COA_FE.SUPPLIERS)
  const [parents, setParents] = useState([])
  useEffect(() => { if (open && initialName) setName(initialName) }, [open, initialName])
  useEffect(() => {
    if (!open) return
    setParentCode(kind === 'client' ? COA_FE.CLIENTS : COA_FE.SUPPLIERS)
    // Load possible parent accounts (assets for clients, liabilities for suppliers)
    const filterType = kind === 'client' ? 'asset' : 'liability'
    api('/accounts').then(rows => {
      const list = (rows || []).filter(a => a.type === filterType)
      // Prefer group accounts + relevant defaults
      setParents(list.length ? list : [])
    }).catch(() => setParents([]))
  }, [open, kind])
  const save = async () => {
    if (!name || !name.trim()) return toast.error('الاسم مطلوب')
    if (!phone || !phone.trim()) return toast.error('رقم الجوال مطلوب')
    try {
      const body = { name: name.trim(), phone: phone.trim(), notes: [address, serviceType].filter(Boolean).join(' • '), parent_code: parentCode }
      const created = await api(`/${kind === 'client' ? 'clients' : 'suppliers'}`, { method: 'POST', body })
      toast.success(`✅ تمت الإضافة بكود: ${created.account_code}`); onOpenChange(false); setName(''); setPhone(''); setAddress(''); setServiceType('')
      onSaved && onSaved(created)
    } catch (e) { toast.error(e.message) }
  }
  const isClient = kind === 'client'
  const clr = isClient ? 'emerald' : 'rose'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{isClient ? '👤' : '🏭'}</span>
            <span>إضافة {isClient ? 'عميل' : 'مورد'} سريع</span>
          </DialogTitle>
          <DialogDescription>سيُضاف مباشرةً للدليل المحاسبي وتُختار في الحقل الحالي</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="الاسم" required><Input value={name} onChange={e => setName(e.target.value)} className="font-semibold" /></Field>
          <Field label="رقم الجوال" required><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="7XXXXXXXX" /></Field>
          <Field label="العنوان"><Input value={address} onChange={e => setAddress(e.target.value)} /></Field>
          {kind === 'supplier' && <Field label="نوع الخدمة"><Input value={serviceType} onChange={e => setServiceType(e.target.value)} placeholder="تذاكر / تأشيرات / فنادق" /></Field>}
          <Field label="الحساب الأب (شجرة الحسابات)">
            <Select value={parentCode} onValueChange={setParentCode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {parents.map(p => (
                  <SelectItem key={p.code} value={p.code}>
                    <span className="font-mono text-xs">{p.code}</span> — {p.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className={`text-[11px] p-2 rounded bg-${clr}-50 border border-${clr}-200 text-${clr}-700`}>
            💡 سيتم توليد كود الحساب تلقائياً تحت الحساب الأب المختار (مثال: <b>{parentCode}0001</b>)
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} className={`bg-${clr}-600 hover:bg-${clr}-700 text-white`}>✅ حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================
// PRINT ENGINE (Voucher + Table with tenant branding)
// ================================================================
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) }

function buildPrintHead(settings, tenant, title) {
  const color = settings?.primary_color || '#1e3a8a'
  const logo = settings?.logo_base64 ? `<img src="${settings.logo_base64}" style="height:64px;object-fit:contain;" />` : `<div style="width:64px;height:64px;background:${color};border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:22px;">${(settings?.agency_name || tenant?.name || 'R')[0]}</div>`
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;font-family:'Cairo',sans-serif}
body{margin:0;padding:24px;color:#0f172a;background:#fff}
.brand{border-bottom:4px solid ${color};padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.brand .r{text-align:left}
.brand h1{color:${color};font-size:24px;margin:0 0 4px}
.meta{font-size:11px;color:#64748b;line-height:1.6}
.title{background:${color}15;border-right:4px solid ${color};padding:10px 14px;margin:16px 0;font-weight:800;font-size:16px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
th{background:${color}10;color:${color};padding:8px 10px;text-align:right;border-bottom:2px solid ${color}55;font-weight:700}
td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right}
.total-row{background:${color}08;font-weight:800}
.total-row td{border-top:2px solid ${color};border-bottom:none;color:${color}}
.info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px;font-size:13px;margin:12px 0;padding:12px;background:#f8fafc;border-radius:8px}
.info-grid div{padding:4px 0;border-bottom:1px dashed #e2e8f0}
.info-grid b{color:${color}}
.big{font-size:22px;font-weight:800;color:${color};text-align:left;padding:12px;background:${color}10;border-radius:8px;margin-top:12px}
.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:40px;font-size:12px;text-align:center;color:#64748b}
.sig div{border-top:1px solid #94a3b8;padding-top:6px}
.footer{margin-top:24px;padding-top:12px;border-top:1px dashed #cbd5e1;text-align:center;font-size:10px;color:#94a3b8}
.badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
.badge-cash{background:#d1fae5;color:#065f46}
.badge-credit{background:#fef3c7;color:#92400e}
@media print{body{padding:12px}@page{margin:12mm}}
</style></head><body>
<div class="brand">
  <div style="display:flex;gap:14px;align-items:center">
    ${logo}
    <div>
      <h1>${escHtml(settings?.agency_name || tenant?.name || 'مكتب السفريات')}</h1>
      <div class="meta">
        ${settings?.address ? `📍 ${escHtml(settings.address)}<br/>` : ''}
        ${settings?.phone ? `📞 ${escHtml(settings.phone)}` : ''}
        ${settings?.email ? ` • ✉ ${escHtml(settings.email)}` : ''}
        ${settings?.tax_id ? `<br/>الرقم الضريبي: ${escHtml(settings.tax_id)}` : ''}
        ${settings?.commercial_id ? ` • س.ت: ${escHtml(settings.commercial_id)}` : ''}
      </div>
    </div>
  </div>
  <div class="r">
    <div style="font-size:13px;color:#64748b">${escHtml(title)}</div>
    <div style="font-weight:800;font-size:14px;color:${color}">${fmtDate(new Date())}</div>
  </div>
</div>
${settings?.header ? `<div style="text-align:center;padding:8px;background:#f1f5f9;border-radius:6px;margin-bottom:12px;font-size:13px">${escHtml(settings.header)}</div>` : ''}
`
}
function buildPrintFoot(settings, extra = '') {
  return `${extra}
${settings?.footer ? `<div style="text-align:center;font-size:12px;color:#64748b;margin-top:24px;padding-top:12px;border-top:1px dashed #cbd5e1">${escHtml(settings.footer)}</div>` : ''}
<div class="footer">Powered by <b>Target Media ERP</b> • Rahaal SaaS © 2025</div>
</body></html>`
}
function openPrint(html) {
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (!w) return toast.error('السماح للنوافذ المنبثقة مطلوب للطباعة')
  w.document.write(html); w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 400)
}

function printVoucher({ kind, record, settings, tenant }) {
  const titleMap = {
    ticket: 'سند/فاتورة حجز تذكرة',
    visa: 'سند/فاتورة تأشيرة/خدمة',
    receipt: 'سند قبض',
    payment: 'سند صرف',
    fx: 'سند صرافة عملات',
  }
  const title = titleMap[kind] || 'سند'
  let content = ''
  if (kind === 'ticket') {
    // v3.2 — Three-coupon ticket layout with travel_mode-aware header + prominent departure time
    const travelMode = record.travel_mode === 'land' ? 'land' : 'air'
    const modeIcon = travelMode === 'land' ? '🚌' : '✈️'
    const modeLabel = travelMode === 'land' ? 'قسيمة تذكرة نقل بري' : 'قسيمة تذكرة سفر جوي'
    const modeCopyLabel = travelMode === 'land' ? 'نسخة الراكب — Land Trip' : 'نسخة الراكب — Air Trip'
    const carrierIcon = travelMode === 'land' ? '🚌' : '✈️'
    const carrierLabel = travelMode === 'land' ? 'شركة النقل' : 'شركة الطيران'
    const modeHeaderGrad = travelMode === 'land' ? 'linear-gradient(90deg,#f97316,#ea580c)' : 'linear-gradient(90deg,#1e40af,#0ea5e9)'
    const modeBorder = travelMode === 'land' ? '#c2410c' : '#1e40af'
    const modeBg = travelMode === 'land' ? '#fff7ed' : '#eff6ff'
    const carrier = escHtml(record.carrier_name || 'غير محددة')
    const tktNum = escHtml(record.ticket_number || record.pnr || '—')
    const flightNo = escHtml(record.flight_number || record.pnr || '—')
    const tktType = escHtml(record.ticket_type || 'عادي')
    const passName = escHtml(record.passenger_name || '—')
    const passPhone = escHtml(record.passenger_phone || '—')
    const passAge = escHtml(record.passenger_age || '—')
    const idType = escHtml(record.id_type || 'هوية')
    const idNo = escHtml(record.passport_no || '—')
    const idPlace = escHtml(record.id_issue_place || '—')
    const idDate = record.id_issue_date ? fmtDate(record.id_issue_date) : '—'
    const route = escHtml(record.route || '—')
    const bookDate = fmtDate(record.date)
    const travelDate = record.travel_date ? fmtDate(record.travel_date) : '—'
    const arrTime = escHtml(record.arrival_time || '—')
    const depTime = escHtml(record.departure_time || '—')
    const boarding = escHtml(record.boarding_point || '—')
    const salePoint = escHtml(record.sale_point || (tenant?.name || '—'))
    const priceStr = fmt(record.sale_price, record.currency)
    // v3.2 — Prominent yellow departure-time badge next to travel date
    const depTimeBadge = record.departure_time
      ? `<div style="background: #fde047; border: 2px solid #ca8a04; border-radius: 10px; padding: 8px 14px; font-size: 18px; font-weight: 900; color: #713f12; text-align:center; box-shadow: 0 2px 4px rgba(0,0,0,0.08); letter-spacing: 1px;">⏰ ${depTime}</div>`
      : ''
    const dateTimeBlock = `
      <div style="display:flex; gap:10px; align-items:center; justify-content:center; padding:10px; background:linear-gradient(135deg,#f0f9ff,#e0f2fe); border:2px solid #0284c7; border-radius:12px; margin-bottom:10px;">
        <div style="flex:1;">
          <div style="font-size:11px; color:#075985; font-weight:700;">📅 موعد ${travelMode === 'land' ? 'الانطلاق' : 'الإقلاع'}</div>
          <div style="font-size:16px; font-weight:900; color:#0c4a6e;">${travelDate}</div>
        </div>
        ${depTimeBadge}
      </div>
    `

    const carrierBanner = `<div style="border:2px solid ${modeBorder}; background: ${modeHeaderGrad}; padding: 10px 14px; border-radius: 10px; margin-bottom: 12px; text-align:center; font-size: 16px; font-weight: 900; color: #ffffff; letter-spacing: 0.5px;">${carrierIcon} ${carrierLabel}: ${carrier}</div>`

    const infoRow = (label, val) => `<div style="display:flex; gap:6px; padding: 4px 6px; border-bottom:1px dotted #cbd5e1; font-size: 12px;"><span style="font-weight:700; color:#475569;">${label}:</span><span style="color:#0f172a;">${val}</span></div>`

    const passengerCopy = `
      <div style="border: 3px solid ${modeBorder}; border-radius: 12px; padding: 14px; margin-bottom: 14px; background: #ffffff;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size: 18px; font-weight: 900; color: ${modeBorder};">${modeIcon} ${modeLabel} — ${modeCopyLabel}</div>
          <div style="font-size: 13px; padding: 4px 10px; background:${modeBg}; border-radius: 6px; color:${modeBorder}; font-weight:700; border:1px solid ${modeBorder};">نوع التذكرة: ${tktType}</div>
        </div>
        ${carrierBanner}
        ${dateTimeBlock}
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
          <div style="padding:8px; background:#f0f9ff; border-radius:8px; border:1px solid #bae6fd;">
            <div style="font-weight:900; color:#0369a1; margin-bottom:4px; font-size:13px;">👤 بيانات المسافر</div>
            ${infoRow('الاسم', passName)}
            ${infoRow('رقم الهاتف', passPhone)}
            ${infoRow('العمر', passAge)}
            ${infoRow('نوع الهوية', idType)}
            ${infoRow('رقم الهوية/الجواز', idNo)}
            ${infoRow('جهة الإصدار', idPlace)}
            ${infoRow('تاريخ الإصدار', idDate)}
          </div>
          <div style="padding:8px; background:#f0fdf4; border-radius:8px; border:1px solid #bbf7d0;">
            <div style="font-weight:900; color:#047857; margin-bottom:4px; font-size:13px;">${modeIcon} تفاصيل الرحلة</div>
            ${infoRow('رقم التذكرة', tktNum)}
            ${infoRow(travelMode === 'land' ? 'رقم الحافلة/الرحلة' : 'رقم الرحلة', flightNo)}
            ${infoRow('المسار', route)}
            ${infoRow('تاريخ الحجز', bookDate)}
            ${infoRow(travelMode === 'land' ? 'تاريخ السفر' : 'تاريخ الرحلة', travelDate)}
            ${infoRow('وقت الحضور', arrTime)}
            ${infoRow(travelMode === 'land' ? 'وقت الانطلاق' : 'وقت الإقلاع', depTime)}
            ${infoRow(travelMode === 'land' ? 'محطة الانطلاق' : 'نقطة الصعود', boarding)}
            ${infoRow('نقطة البيع', salePoint)}
          </div>
        </div>
        <div style="padding:10px; background:#fef2f2; border:1px dashed #fecaca; border-radius:8px; font-size:11px; color:#7f1d1d;">
          <div style="font-weight:900; margin-bottom:4px;">⚠️ ملاحظات وشروط الحجز:</div>
          <ul style="margin:0; padding-right:18px; line-height:1.6;">
            ${travelMode === 'land'
              ? `<li><b>الحضور في محطة النقل قبل موعد الانطلاق بساعة واحدة على الأقل.</b></li>`
              : `<li><b>الحضور في المطار قبل موعد الإقلاع بـ 4 ساعات لإتمام إجراءات السفر.</b></li>`}
            <li>غرامة التأجيل: 10% من قيمة التذكرة إن كان قبل الرحلة بأقل من 24 ساعة.</li>
            <li>الإلغاء: يخضع لسياسة الشركة الناقلة، تُخصم رسوم إدارية 5% مع استرداد الباقي.</li>
            <li>على الراكب حمل بطاقته الأصلية وعرضها عند ${travelMode === 'land' ? 'محطة الانطلاق' : 'نقطة الصعود'}.</li>
            <li>غير قابلة للتحويل لشخص آخر بدون إشعار مسبق.</li>
          </ul>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; padding:8px 12px; background:${modeHeaderGrad}; border-radius:8px; color:white;">
          <div style="font-size:13px;">إجمالي القيمة المدفوعة</div>
          <div style="font-size:22px; font-weight:900;">${priceStr}</div>
        </div>
      </div>
    `

    const stubCopy = (label, color, bgColor) => `
      <div style="border: 2px dashed ${color}; border-radius: 10px; padding: 10px; margin-bottom: 10px; background: ${bgColor};">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="font-size: 14px; font-weight: 900; color: ${color};">${modeIcon} ${label}</div>
          <div style="font-size: 11px; color:#64748b;">قصّ عند النقاط</div>
        </div>
        <div style="border:1px solid ${color}; background:#fff; border-radius:6px; padding:6px; font-size: 11px; margin-bottom:6px; text-align:center; font-weight: 800; color: ${color};">${carrierIcon} ${carrier}</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; font-size:11px;">
          <div><b>المسافر:</b> ${passName}</div>
          <div><b>رقم التذكرة:</b> ${tktNum}</div>
          <div><b>${travelMode === 'land' ? 'الحافلة' : 'الرحلة'}:</b> ${flightNo}</div>
          <div><b>المسار:</b> ${route}</div>
          <div><b>التاريخ:</b> ${travelDate}</div>
          <div style="background:#fef3c7; padding:2px 4px; border-radius:4px; font-weight:900;"><b>⏰ الوقت:</b> ${depTime}</div>
          <div><b>الهوية:</b> ${idNo}</div>
          <div><b>${travelMode === 'land' ? 'المحطة' : 'نقطة الصعود'}:</b> ${boarding}</div>
          <div style="font-weight:900; color:${color};">السعر: ${priceStr}</div>
        </div>
      </div>
    `

    const dispatchLabel = travelMode === 'land' ? 'نسخة المحطة — Dispatch Copy' : 'نسخة الترحيل — Dispatch Copy'
    content = `<div style="max-width: 100%;">
      ${passengerCopy}
      ${stubCopy(dispatchLabel, '#065f46', '#ecfdf5')}
      ${stubCopy('نسخة الفرع — Branch Copy', '#7c3aed', '#faf5ff')}
    </div>`
  } else if (kind === 'visa') {
    content = `<div class="title">${title} — ${escHtml(record.service_type)}</div>
      <div class="info-grid">
        <div><b>التاريخ:</b> ${fmtDate(record.date)}</div><div><b>نوع الخدمة:</b> ${escHtml(record.service_type)}</div>
        <div><b>اسم المسافر:</b> ${escHtml(record.passenger_name || '—')}</div><div><b>رقم الجواز:</b> ${escHtml(record.passport_no || '—')}</div>
        <div><b>الجنسية:</b> ${escHtml(record.nationality || '—')}</div><div><b>العميل:</b> ${escHtml(record.client_name)}</div>
        <div><b>المورد:</b> ${escHtml(record.supplier_name)}</div>
        <div><b>طريقة الدفع:</b> <span class="badge ${record.payment_method === 'cash' ? 'badge-cash' : 'badge-credit'}">${record.payment_method === 'cash' ? 'نقد' : 'آجل'}</span></div>
      </div>
      <table><thead><tr><th>الوصف</th><th style="text-align:left">التكلفة</th><th style="text-align:left">البيع</th><th style="text-align:left">العمولة</th></tr></thead>
      <tbody><tr><td>${escHtml(record.service_type)}</td><td style="text-align:left">${fmt(record.cost, record.currency)}</td><td style="text-align:left">${fmt(record.sale_price, record.currency)}</td><td style="text-align:left"><b>${fmt(record.commission, record.currency)}</b></td></tr></tbody></table>
      <div class="big">المبلغ المستحق: ${fmt(record.sale_price, record.currency)}</div>`
  } else if (kind === 'receipt' || kind === 'payment') {
    content = `<div class="title">${title} — ${escHtml(record.party_name)}</div>
      <div class="info-grid">
        <div><b>التاريخ:</b> ${fmtDate(record.date)}</div>
        <div><b>${kind === 'receipt' ? 'المستلم من' : 'المدفوع إلى'}:</b> ${escHtml(record.party_name)}</div>
        <div><b>الطريقة:</b> ${escHtml(record.method)}</div>
        <div><b>الصندوق/البنك:</b> ${escHtml(record.box_name)}</div>
      </div>
      ${record.description ? `<p style="padding:12px;background:#f8fafc;border-radius:6px"><b>البيان:</b> ${escHtml(record.description)}</p>` : ''}
      <div class="big">${kind === 'receipt' ? 'مبلغ القبض' : 'مبلغ الصرف'}: ${fmt(record.amount, record.currency)}</div>`
  } else if (kind === 'fx') {
    content = `<div class="title">${title} — ${record.type === 'buy' ? 'شراء عملة' : 'بيع عملة'}</div>
      <div class="info-grid">
        <div><b>التاريخ:</b> ${fmtDate(record.date)}</div><div><b>النوع:</b> ${record.type === 'buy' ? 'شراء' : 'بيع'}</div>
        <div><b>الزبون:</b> ${escHtml(record.customer_name || '—')}</div><div><b>الهاتف:</b> ${escHtml(record.customer_phone || '—')}</div>
        <div><b>نوع الهوية:</b> ${escHtml(record.id_type || '—')}</div><div><b>رقم الهوية:</b> ${escHtml(record.id_number || '—')}</div>
        <div><b>مصدر الأموال:</b> ${escHtml(record.source_of_funds || '—')}</div><div><b>الغرض:</b> ${escHtml(record.purpose || '—')}</div>
      </div>
      <table><thead><tr><th>الوصف</th><th style="text-align:left">المبلغ</th><th style="text-align:left">السعر</th><th style="text-align:left">القيمة</th></tr></thead>
      <tbody><tr><td>${record.type === 'buy' ? 'شراء' : 'بيع'} ${escHtml(record.currency)}</td><td style="text-align:left"><b>${fmt(record.amount, record.currency)}</b></td><td style="text-align:left">${record.exchange_rate}</td><td style="text-align:left"><b>${fmt(record.counter_amount, record.counter_currency)}</b></td></tr></tbody></table>
      ${record.remarks ? `<p style="padding:10px;background:#f8fafc;border-radius:6px"><b>ملاحظات:</b> ${escHtml(record.remarks)}</p>` : ''}`
  }
  const sig = `<div class="sig"><div>المحاسب</div><div>أمين الصندوق</div><div>توقيع العميل</div></div>`
  openPrint(buildPrintHead(settings, tenant, title) + content + buildPrintFoot(settings, sig))
}

function printTable({ title, columns, rows, totals, settings, tenant }) {
  const head = `<div class="title">${escHtml(title)} — إجمالي ${rows.length} سجل</div>
  <table><thead><tr>${columns.map(c => `<th${c.align === 'left' ? ' style="text-align:left"' : ''}>${escHtml(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${columns.map(c => `<td${c.align === 'left' ? ' style="text-align:left"' : ''}>${escHtml(c.render ? c.render(r) : (r[c.key] ?? '—'))}</td>`).join('')}</tr>`).join('')}
  ${totals ? `<tr class="total-row">${columns.map((c, i) => `<td${c.align === 'left' ? ' style="text-align:left"' : ''}>${i === 0 ? 'الإجمالي' : (totals[c.key] !== undefined ? escHtml(totals[c.key]) : '')}</td>`).join('')}</tr>` : ''}
  </tbody></table>`
  openPrint(buildPrintHead(settings, tenant, title) + head + buildPrintFoot(settings))
}


function SmartAutocomplete({ kind, items, value, onChange, placeholder, onCreated }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const ref = useRef(null)

  const selected = items.find(i => i.id === value)
  const displayText = selected?.name || ''

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const filtered = query.trim()
    ? items.filter(i => i.name.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 8)
    : items.slice(0, 8)
  const exactMatch = items.find(i => i.name.trim() === query.trim())

  return (
    <div className="relative" ref={ref}>
      <Input
        value={open ? query : displayText}
        onFocus={() => { setQuery(displayText); setOpen(true) }}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange('') }}
        placeholder={placeholder || (kind === 'client' ? 'اكتب اسم العميل أو اختر' : 'اكتب اسم المورد أو اختر')}
      />
      {open && (
        <div className="absolute z-50 top-full right-0 left-0 mt-1 bg-white border rounded-lg shadow-2xl max-h-72 overflow-y-auto">
          {filtered.length === 0 && query.trim() && !exactMatch && (
            <button type="button" onClick={() => { setShowCreate(true); setOpen(false) }}
              className="w-full text-right p-3 hover:bg-emerald-50 border-b border-slate-100 flex items-center gap-2 text-emerald-700 font-semibold">
              <Plus className="w-4 h-4" /> إنشاء {kind === 'client' ? 'عميل' : 'مورد'} جديد: "{query}"
            </button>
          )}
          {filtered.map(i => (
            <button key={i.id} type="button" onClick={() => { onChange(i.id); setOpen(false); setQuery('') }}
              className={`w-full text-right p-2.5 hover:bg-blue-50 border-b border-slate-100 text-sm ${i.id === value ? 'bg-blue-100 font-bold' : ''}`}>
              <div className="flex items-center justify-between">
                <span>{i.name}</span>
                {i.phone && <span className="text-xs text-slate-500">{i.phone}</span>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && !query.trim() && <div className="p-3 text-sm text-slate-400 text-center">اكتب للبحث أو أضف جديد</div>}
        </div>
      )}
      <QuickAddDialog open={showCreate} onOpenChange={setShowCreate} kind={kind} initialName={query}
        onSaved={(created) => { onCreated && onCreated(created); onChange(created.id); setQuery(''); }} />
    </div>
  )
}

// ================================================================
// ACTION TOOLBAR (unified across screens)
// ================================================================
// ================================================================
// v3.5 — REFUND DIALOG + BULK STATEMENT MODAL
// ================================================================
function RefundDialog({ open, onOpenChange, record, refType, onSaved }) {
  const { tenant } = useAuth()
  const [f, setF] = useState({ supplier_penalty: '', office_fee: '', reason: '', notes: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setF({ supplier_penalty: '', office_fee: '', reason: '', notes: '' }) }, [open, record])
  if (!record) return null
  const sale = Number(record.sale_price) || 0
  const cost = Number(record.cost) || 0
  const sp = Number(f.supplier_penalty) || 0
  const of = Number(f.office_fee) || 0
  const refundToClient = +(sale - sp - of).toFixed(2)
  const totalFees = +(sp + of).toFixed(2)
  const invalid = refundToClient < 0
  const submit = async () => {
    if (invalid) return toast.error('مجموع الرسوم أكبر من قيمة البيع')
    try {
      setSaving(true)
      const doc = await api('/refunds', { method: 'POST', body: {
        ref_type: refType, ref_id: record.id,
        supplier_penalty: sp, office_fee: of, reason: f.reason, notes: f.notes,
      } })
      toast.success('✅ تم إنشاء سند الاسترداد وعكس القيد')
      onSaved && onSaved(doc)
      onOpenChange(false)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const printCredit = () => {
    const passenger = record.passenger_name || record.beneficiary_name || record.client_name || '—'
    const dateStr = new Date().toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' })
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>سند استرداد</title>
<style>body{font-family:'Tahoma',sans-serif;background:#f8fafc;padding:24px;color:#0f172a}
.doc{max-width:700px;margin:auto;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.06);overflow:hidden}
.hdr{background:linear-gradient(135deg,#dc2626,#f97316);color:#fff;padding:22px 28px;display:flex;justify-content:space-between;align-items:center}
.hdr h1{margin:0;font-size:22px;font-weight:900}
.sec{padding:18px 28px;border-bottom:1px solid #e2e8f0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.row{padding:6px 10px;background:#f8fafc;border-radius:6px;font-size:12px;display:flex;justify-content:space-between}
.big{background:#fef2f2;border:2px solid #fecaca;border-radius:10px;padding:14px;text-align:center;margin:10px 0}
.big .n{font-size:32px;font-weight:900;color:#dc2626}
.foot{padding:16px 28px;background:#f8fafc;font-size:11px;color:#64748b;text-align:center}
@media print{.actions{display:none}}
</style></head><body><div class="doc">
<div class="hdr"><h1>🔄 سند استرداد (Credit Note)</h1><div style="text-align:left"><div style="font-size:14px;font-weight:800">${escHtml(tenant?.name || 'مكتب رحّال')}</div><div style="font-size:11px;opacity:.9">${dateStr}</div></div></div>
<div class="sec"><div class="grid">
<div class="row"><b>العميل:</b><span>${escHtml(record.client_name)}</span></div>
<div class="row"><b>المسافر/المستفيد:</b><span>${escHtml(passenger)}</span></div>
<div class="row"><b>${refType === 'ticket' ? 'PNR' : refType === 'visa' ? 'الجواز' : 'المرجع'}:</b><span>${escHtml(record.pnr || record.passport_no || record.reference_no || '—')}</span></div>
<div class="row"><b>العملة:</b><span>${escHtml(record.currency)}</span></div>
<div class="row"><b>قيمة البيع الأصلية:</b><span>${fmt(sale, record.currency)}</span></div>
<div class="row"><b>غرامة المورد:</b><span style="color:#dc2626">-${fmt(sp, record.currency)}</span></div>
<div class="row"><b>رسوم خدمة المكتب:</b><span style="color:#dc2626">-${fmt(of, record.currency)}</span></div>
<div class="row"><b>سبب الإلغاء:</b><span>${escHtml(f.reason || '—')}</span></div>
</div>
<div class="big"><div style="font-size:12px;color:#7f1d1d;font-weight:700;margin-bottom:6px">صافي المبلغ المسترد للعميل</div><div class="n">${fmt(refundToClient, record.currency)}</div></div>
</div>
<div class="foot">صادر إلكترونياً من نظام رحّال — Rahaal ERP • ${dateStr}</div>
</div><div class="actions" style="text-align:center;margin-top:16px"><button onclick="window.print()" style="background:#dc2626;color:#fff;border:0;padding:10px 20px;border-radius:8px;font-weight:800;cursor:pointer">🖨️ طباعة</button></div>
</body></html>`
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) return toast.error('السماح بالنوافذ المنبثقة مطلوب')
    w.document.open(); w.document.write(html); w.document.close(); w.focus()
  }
  const shareWA = () => {
    const passenger = record.passenger_name || record.beneficiary_name || record.client_name
    const msg = `عزيزنا العميل ${record.client_name}،\n\n🔄 سند استرداد\n📋 ${refType === 'ticket' ? 'تذكرة' : refType === 'visa' ? 'تأشيرة' : 'خدمة'} ${passenger}\n💰 قيمة البيع: ${fmt(sale, record.currency)}\n➖ غرامة المورد: ${fmt(sp, record.currency)}\n➖ رسوم المكتب: ${fmt(of, record.currency)}\n\n✅ *صافي المبلغ المسترد: ${fmt(refundToClient, record.currency)}*\n\n${f.reason ? `السبب: ${f.reason}\n\n` : ''}شكراً لتعاملكم — ${tenant?.name || 'مكتب رحّال'}`
    const phone = record.passenger_whatsapp || record.passenger_phone || record.beneficiary_whatsapp || record.beneficiary_phone
    openWhatsApp(phone, msg)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-orange-600" /> استرداد/إلغاء {refType === 'ticket' ? 'تذكرة' : refType === 'visa' ? 'تأشيرة' : 'خدمة'}</DialogTitle>
          <DialogDescription>سيتم عكس القيد الأصلي، وإنشاء قيد جديد يخصم الرسوم ويعيد الرصيد للعميل</DialogDescription>
        </DialogHeader>
        <div className="bg-slate-50 border rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">العميل:</span><span className="font-semibold">{record.client_name}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">المسافر/المستفيد:</span><span>{record.passenger_name || record.beneficiary_name || '—'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">قيمة البيع الأصلية:</span><span className="font-bold text-blue-600">{fmt(sale, record.currency)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">التكلفة الأصلية:</span><span>{fmt(cost, record.currency)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">طريقة الدفع الأصلية:</span><span>{record.payment_method === 'cash' ? '💵 نقد' : '🕓 آجل'}</span></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="غرامة المورد/الشركة"><Input type="number" min="0" step="0.01" value={f.supplier_penalty} onChange={e => setF({ ...f, supplier_penalty: e.target.value })} placeholder="0" /></Field>
          <Field label="رسوم خدمة المكتب"><Input type="number" min="0" step="0.01" value={f.office_fee} onChange={e => setF({ ...f, office_fee: e.target.value })} placeholder="0" /></Field>
          <div className="md:col-span-2"><Field label="سبب الإلغاء"><Input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="طلب العميل / تعذر السفر / تأجيل ..." /></Field></div>
          <div className="md:col-span-2"><Field label="ملاحظات"><Textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field></div>
        </div>
        <div className={`rounded-xl p-4 border-2 ${invalid ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
          <div className="text-xs text-slate-600 mb-1">صافي المبلغ الذي سيُعاد للعميل</div>
          <div className={`text-3xl font-extrabold ${invalid ? 'text-rose-600' : 'text-emerald-700'}`}>{fmt(refundToClient, record.currency)}</div>
          <div className="text-[10px] text-slate-500 mt-1">= قيمة البيع ({fmt(sale, record.currency)}) − إجمالي الرسوم ({fmt(totalFees, record.currency)})</div>
          {invalid && <div className="text-xs text-rose-700 mt-2 font-semibold">⚠️ مجموع الرسوم أكبر من قيمة البيع</div>}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={printCredit} variant="outline" className="gap-1"><Printer className="w-4 h-4" /> طباعة سند الاسترداد</Button>
          <WaBtn phone={record.passenger_whatsapp || record.passenger_phone || record.beneficiary_whatsapp || record.beneficiary_phone} message={`سيتم إرسال تفاصيل الاسترداد على واتساب`} size="md" label="مشاركة على واتساب" />
          <Button onClick={submit} disabled={saving || invalid} className="bg-orange-600 hover:bg-orange-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '💾 تنفيذ الاسترداد + قيد عكسي'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkStatementDialog({ open, onOpenChange }) {
  const [kind, setKind] = useState('clients')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const generate = async () => {
    try {
      setLoading(true)
      const r = await api('/bulk-statement/generate', { method: 'POST', body: { kind, period: 'month' } })
      setResults(r); toast.success(`تم توليد ${r.count} كشف`)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  const openAll = async () => {
    if (!results?.items) return
    if (!(await askConfirm({ title: 'فتح نوافذ واتساب', desc: `سيتم فتح ${results.items.length} نافذة واتساب — تأكد من السماح بالنوافذ المنبثقة.`, icon: '📲', confirmLabel: 'فتح النوافذ' }))) return
    results.items.forEach((it, i) => setTimeout(() => window.open(it.wa_link, '_blank', 'noopener'), i * 300))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">📢 إرسال جماعي لكشوفات الحسابات</DialogTitle>
          <DialogDescription>يولّد رسائل واتساب جاهزة لجميع {kind === 'clients' ? 'العملاء' : 'الموردين'} الذين لديهم رصيد + رقم هاتف</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setKind('clients')} className={`flex-1 px-4 py-2 rounded-lg font-bold border-2 ${kind === 'clients' ? 'bg-blue-500 text-white border-blue-600' : 'bg-white border-slate-300'}`}>العملاء</button>
          <button onClick={() => setKind('suppliers')} className={`flex-1 px-4 py-2 rounded-lg font-bold border-2 ${kind === 'suppliers' ? 'bg-orange-500 text-white border-orange-600' : 'bg-white border-slate-300'}`}>الموردون</button>
          <Button onClick={generate} disabled={loading} className="grad-brand text-white gap-2">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '🔄 توليد'}</Button>
        </div>
        {results && (
          <div className="space-y-2">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
              <div><b>{results.count}</b> كشف جاهز للإرسال</div>
              <Button onClick={openAll} className="bg-[#25D366] hover:bg-[#128C7E] text-white gap-2">📤 فتح الكل على واتساب</Button>
            </div>
            <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
              {results.items.map(it => (
                <div key={it.id} className="flex items-center justify-between p-2 hover:bg-slate-50">
                  <div>
                    <div className="font-semibold">{it.name}</div>
                    <div className="text-xs text-slate-500" dir="ltr">📞 {it.phone || 'لا يوجد'}</div>
                  </div>
                  <div className="flex gap-1">
                    <div className="text-xs text-slate-600 self-center ml-2">
                      {['USD', 'SAR', 'YER'].filter(c => Math.abs(it.balances[c] || 0) > 0.01).map(c => `${c}: ${(it.balances[c] || 0).toFixed(0)}`).join(' • ')}
                    </div>
                    <a href={it.wa_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-[#25D366] hover:bg-[#128C7E] text-white text-xs font-semibold">
                      💬 إرسال
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ActionToolbar({ onAdd, onRefresh, onDelete, onSearch, onPrint, onPrintVoucher, onPrintTable, onEdit, onExit, onRefund, selectedId, count, addLabel }) {
  const btn = (icon, label, cb, cls = '', disabled = false) => (
    <Button size="sm" variant="outline" onClick={cb} disabled={disabled}
      className={`gap-2 ${cls}`}>{icon}<span className="hidden md:inline">{label}</span></Button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-white border rounded-lg shadow-sm mb-4">
      {onAdd && <Button onClick={onAdd} size="sm" className="grad-brand text-white gap-2"><Plus className="w-4 h-4" /> {addLabel || 'إضافة'}</Button>}
      {onEdit && btn(<Key className="w-4 h-4" />, 'تعديل', onEdit, 'text-amber-600 hover:bg-amber-50', !selectedId)}
      {onRefund && btn(<ArrowLeftRight className="w-4 h-4" />, 'استرداد/إلغاء', onRefund, 'text-orange-600 hover:bg-orange-50', !selectedId)}
      {onDelete && btn(<Trash2 className="w-4 h-4" />, 'حذف', onDelete, 'text-rose-600 hover:bg-rose-50', !selectedId)}
      {onRefresh && btn(<Activity className="w-4 h-4" />, 'تحديث', onRefresh)}
      {onSearch && btn(<Search className="w-4 h-4" />, 'بحث', onSearch)}
      {onPrintVoucher && btn(<Printer className="w-4 h-4" />, 'طباعة السند', onPrintVoucher, 'text-blue-600 hover:bg-blue-50', !selectedId)}
      {onPrintTable && btn(<FileSpreadsheet className="w-4 h-4" />, 'طباعة الجدول', onPrintTable, 'text-emerald-600 hover:bg-emerald-50')}
      {onPrint && btn(<Printer className="w-4 h-4" />, 'طباعة', onPrint, 'text-blue-600 hover:bg-blue-50', !selectedId)}
      <div className="flex-1" />
      {count !== undefined && <Badge variant="secondary">{count} سجل</Badge>}
      {onExit && btn(<LogOut className="w-4 h-4" />, 'خروج', onExit, 'text-slate-500')}
    </div>
  )
}

// ================================================================
// UNIVERSAL SEARCH MODAL
// ================================================================
function UniversalSearchModal({ open, onOpenChange, fields, onApply, onClear }) {
  const [field, setField] = useState(fields[0]?.key || '')
  const [condition, setCondition] = useState('contains')
  const [term, setTerm] = useState('')
  useEffect(() => { if (open) { setField(fields[0]?.key || ''); setTerm('') } }, [open])
  const apply = () => { onApply({ field, condition, term }); onOpenChange(false) }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Search className="w-5 h-5 text-blue-600" /> بحث متقدم</DialogTitle><DialogDescription>اختر الحقل والشرط ثم أدخل قيمة البحث</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="حقل البحث">
            <Select value={field} onValueChange={setField}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{fields.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="الشرط">
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">يحتوي على</SelectItem>
                <SelectItem value="equals">يساوي بالضبط</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="قيمة البحث"><Input value={term} onChange={e => setTerm(e.target.value)} placeholder="اكتب هنا..." autoFocus /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onClear(); onOpenChange(false) }} className="text-slate-500">مسح الفلتر</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={apply} className="grad-brand text-white gap-2"><Search className="w-4 h-4" /> بحث</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function applyFilter(data, filter) {
  if (!filter || !filter.term) return data
  const t = String(filter.term).toLowerCase().trim()
  return data.filter(row => {
    const v = row[filter.field]
    if (v === undefined || v === null) return false
    const vs = String(v).toLowerCase()
    if (filter.condition === 'equals') return vs === t
    return vs.includes(t)
  })
}

// ================================================================
// QUOTA BANNER
// ================================================================
function QuotaBanner({ quota }) {
  if (!quota) return null
  const pct = quota.limit ? (quota.used / quota.limit) * 100 : 0
  if (pct < 90) return null
  const isMax = quota.used >= quota.limit
  return (
    <div className={`mb-4 p-4 rounded-xl border-2 flex items-center gap-3 ${isMax ? 'bg-rose-50 border-rose-300' : 'bg-amber-50 border-amber-300'}`}>
      <AlertTriangle className={`w-6 h-6 ${isMax ? 'text-rose-600' : 'text-amber-600'} shrink-0`} />
      <div className="flex-1">
        <div className={`font-bold ${isMax ? 'text-rose-800' : 'text-amber-800'}`}>
          {isMax ? '🚫 انتهت حصة قيود اليومية — النظام في وضع القراءة فقط' : `⚠️ تحذير: اقتربت من نهاية حصة قيود اليومية`}
        </div>
        <div className="text-sm text-slate-600 mt-1">تم استخدام <b>{quota.used}</b> من أصل <b>{quota.limit}</b> قيد ({pct.toFixed(0)}%). {isMax ? 'تواصل مع Target Media لتجديد الاشتراك.' : 'يُنصح بالتجديد قريباً لتجنب إيقاف الإدخال.'}</div>
      </div>
      <div className={`w-24 h-3 rounded-full bg-slate-200 overflow-hidden shrink-0`}>
        <div className={`h-full ${isMax ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

// ================================================================
// BULK IMPORT DIALOG (Excel/CSV -> Mapping -> Preview -> Confirm)
// ================================================================

// v3.9.10 — Bulk Edit Dialog for Tickets/Visas
function BulkEditDialog({ open, onOpenChange, kind, ids, suppliers, boxes, onDone }) {
  const [changeSupplier, setChangeSupplier] = useState(false)
  const [changeDate, setChangeDate] = useState(false)
  const [changePayment, setChangePayment] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [newDate, setNewDate] = useState(todayISO())
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [boxId, setBoxId] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!open) { setChangeSupplier(false); setChangeDate(false); setChangePayment(false); setSupplierId(''); setNewDate(todayISO()); setPaymentMethod('credit'); setBoxId(''); setResult(null) }
  }, [open])

  const submit = async () => {
    if (!changeSupplier && !changeDate && !changePayment) return toast.error('اختر حقلاً واحداً على الأقل للتعديل')
    if (changeSupplier && !supplierId) return toast.error('اختر المورد')
    if (changePayment && paymentMethod === 'cash' && !boxId) return toast.error('اختر الصندوق للبيع النقدي')
    const changes = {}
    if (changeSupplier) changes.supplier_id = supplierId
    if (changeDate) changes.date = newDate
    if (changePayment) {
      changes.payment_method = paymentMethod
      if (paymentMethod === 'cash') changes.box_id = boxId
    }
    if (!(await askConfirm({ title: 'تعديل جماعي', desc: `تعديل ${ids.length} سجل — سيتم عكس القيود القديمة وإنشاء قيود جديدة.`, icon: '✏️', confirmLabel: 'تنفيذ التعديل' }))) return
    try {
      setSaving(true)
      const r = await api(`/${kind}/bulk-edit`, { method: 'POST', body: { ids, changes } })
      setResult(r)
      if (r.updated > 0) toast.success(`✅ تم تعديل ${r.updated}${r.failed ? ` • فشل ${r.failed}` : ''}`)
      else if (r.failed > 0) toast.error(`❌ فشل تعديل ${r.failed} سجل`)
      onDone && onDone()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Pencil className="w-5 h-5 text-blue-600" /> تعديل جماعي — {ids.length} {kind === 'tickets' ? 'تذكرة' : 'خدمة/تأشيرة'}
          </DialogTitle>
          <DialogDescription>حدّد الحقول التي تريد تغييرها فقط. الحقول غير المحدّدة تبقى كما هي.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className={`p-4 rounded-lg border-2 ${result.updated > 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-rose-50 border-rose-300'}`}>
              <div className="font-bold text-lg">{result.updated > 0 ? '✅ تم' : '❌ فشل'}</div>
              <div className="text-sm mt-1">✔️ نجح: <b>{result.updated}</b></div>
              <div className="text-sm">❌ فشل: <b>{result.failed}</b></div>
            </div>
            {result.errors?.length > 0 && (
              <div className="max-h-40 overflow-y-auto bg-slate-50 p-2 rounded text-xs">
                {result.errors.slice(0, 20).map((e, i) => <div key={i} className="p-1 border-b">🔴 {e.id?.slice(0, 8)}: {e.error}</div>)}
              </div>
            )}
            <Button onClick={() => onOpenChange(false)} className="w-full">إغلاق</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Supplier */}
            <div className={`p-3 rounded-lg border-2 ${changeSupplier ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={changeSupplier} onChange={e => setChangeSupplier(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                <span className="font-bold text-sm">تغيير المورد</span>
              </label>
              {changeSupplier && (
                <div className="mt-2">
                  <AccountAutocomplete type="supplier" value={supplierId || null} onChange={(sel) => setSupplierId(sel?.id || '')} placeholder="ابحث عن المورد الجديد بالاسم أو الكود..." />
                </div>
              )}
            </div>
            {/* Date */}
            <div className={`p-3 rounded-lg border-2 ${changeDate ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={changeDate} onChange={e => setChangeDate(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                <span className="font-bold text-sm">تغيير التاريخ</span>
              </label>
              {changeDate && <DocDateInput value={newDate} onChange={v => setNewDate(v)} className="mt-2" />}
            </div>
            {/* Payment */}
            <div className={`p-3 rounded-lg border-2 ${changePayment ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={changePayment} onChange={e => setChangePayment(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                <span className="font-bold text-sm">تغيير طريقة الدفع</span>
              </label>
              {changePayment && (
                <div className="mt-2 space-y-2">
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">آجل (على الحساب)</SelectItem>
                      <SelectItem value="cash">نقدي (صندوق)</SelectItem>
                    </SelectContent>
                  </Select>
                  {paymentMethod === 'cash' && (
                    <AccountAutocomplete type="box" value={boxId || null} onChange={(sel) => setBoxId(sel?.id || '')} placeholder="ابحث عن صندوق أو بنك..." />
                  )}
                </div>
              )}
            </div>
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">⚠️ سيتم عكس القيود المحاسبية القديمة تلقائياً وإنشاء قيود جديدة بالبيانات الجديدة.</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">إلغاء</Button>
              <Button onClick={submit} disabled={saving} className="flex-1 grad-blue text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : `تطبيق على ${ids.length} سجل`}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}



// ================================================================
// VISAS SCREEN with Manual + Bulk import
// ================================================================
const VISA_TYPES = ['تأشيرة عمرة', 'تأشيرة زيارة', 'موافقة أمنية', 'فيزا سياحية', 'فيزا عمل', 'حجز فندق', 'خدمات أخرى']

function VisasScreen() {
  const { settings, tenant } = useAuth()
  const [visas, setVisas] = useState([])
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [boxes, setBoxes] = useState([]) // v3.9.10
  const [openManual, setOpenManual] = useState(false)
  const [openBulk, setOpenBulk] = useState(false)
  const [openBulkEdit, setOpenBulkEdit] = useState(false) // v3.9.10
  const [openSearch, setOpenSearch] = useState(false)
  const [filter, setFilter] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [dateRange, setDateRange] = useState({ preset: 'month', from: '', to: '' })
  const [editing, setEditing] = useState(null)
  const [refundTarget, setRefundTarget] = useState(null)
  const [rates, setRates] = useState(null)
  const load = async () => {
    try {
      const [v, c, s, r, bx] = await Promise.all([api('/visas'), api('/clients'), api('/suppliers'), api('/rates'), api('/boxes').catch(() => [])])
      setVisas(v); setClients(c); setSuppliers(s); setRates(r.rates); setBoxes(bx)
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [])
  const dateRangeBounds = useMemo(() => {
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (dateRange.preset === 'today') return { from: today, to: new Date(today.getTime() + 86400000 - 1) }
    if (dateRange.preset === 'week') { const d = new Date(today); d.setDate(d.getDate() - 6); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'month') { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'custom' && dateRange.from) { const f = new Date(dateRange.from); const t = dateRange.to ? new Date(dateRange.to + 'T23:59:59') : new Date(); return { from: f, to: t } }
    return null
  }, [dateRange])
  const filteredByDate = useMemo(() => {
    const safe = (visas || []).filter(Boolean)
    if (!dateRangeBounds) return safe
    return safe.filter(v => { const d = new Date(v?.date); return !isNaN(d) && d >= dateRangeBounds.from && d <= dateRangeBounds.to })
  }, [visas, dateRangeBounds])
  const filtered = applyFilter(filteredByDate, filter)
  const selected = filtered.find(v => v?.id === selectedId)
  const allSelected = filtered.length > 0 && filtered.every(v => selectedIds.has(v?.id))
  const toggleAll = () => { if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(filtered.map(v => v.id))) }
  const toggleOne = (id) => { const s = new Set(selectedIds); if (s.has(id)) s.delete(id); else s.add(id); setSelectedIds(s) }
  const handleAdd = () => { setEditing(null); setOpenManual(true) }
  const handleEdit = () => { if (!selected) return toast.error('اختر خدمة أولاً'); setEditing(selected); setOpenManual(true) }
  const handleDelete = async () => {
    if (!selectedId) return
    if (!(await askConfirm({ title: 'حذف الخدمة/التأشيرة', desc: 'سيتم حذف هذه الخدمة/التأشيرة وعكس القيد المحاسبي المرتبط بها.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/visas/${selectedId}`, { method: 'DELETE' }); toast.success('تم الحذف'); setSelectedId(null); load() }
    catch (e) { toast.error(e.message) }
  }
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return toast.error('لم يتم اختيار أي سجل')
    if (!(await askConfirm({ title: 'حذف جماعي', desc: `حذف ${ids.length} تأشيرة/خدمة وعكس قيودها المحاسبية دفعة واحدة؟`, variant: 'danger', confirmLabel: 'حذف الكل' }))) return
    try {
      const r = await api('/visas/bulk-delete', { method: 'POST', body: { ids } })
      toast.success(`✅ تم حذف ${r.deleted}${r.failed ? ` • فشل ${r.failed}` : ''}`)
      setSelectedIds(new Set()); setSelectedId(null); load()
    } catch (e) { toast.error(e.message) }
  }
  const handlePrintVoucher = () => {
    if (!selected) return toast.error('اختر سجلاً أولاً')
    printVoucher({ kind: 'visa', record: selected, settings, tenant })
  }
  const handlePrintTable = () => {
    const totals = { cost: 0, sale_price: 0, commission: 0 }
    for (const r of filtered) { totals.cost += r.cost; totals.sale_price += r.sale_price; totals.commission += r.commission }
    printTable({
      title: 'كشف التأشيرات والخدمات', settings, tenant, rows: filtered,
      columns: [
        { key: 'date', label: 'التاريخ', render: r => fmtDate(r.date) },
        { key: 'service_type', label: 'الخدمة' },
        { key: 'passenger_name', label: 'المسافر' },
        { key: 'passport_no', label: 'الجواز' },
        { key: 'client_name', label: 'حساب القبض' },
        { key: 'supplier_name', label: 'المورد' },
        { key: 'currency', label: 'العملة' },
        { key: 'cost', label: 'تكلفة', align: 'left', render: r => fmt(r.cost, r.currency) },
        { key: 'sale_price', label: 'بيع', align: 'left', render: r => fmt(r.sale_price, r.currency) },
        { key: 'commission', label: 'عمولة', align: 'left', render: r => fmt(r.commission, r.currency) },
      ],
      totals: { cost: totals.cost.toFixed(2), sale_price: totals.sale_price.toFixed(2), commission: totals.commission.toFixed(2) },
    })
  }
  return (
    <div className="space-y-4">
      <TopBar
        title="التأشيرات والخدمات"
        subtitle="تأشيرات عمرة، موافقات أمنية، فيز، حجز فنادق — إدخال يدوي أو استيراد Excel"
        right={<Button variant="outline" onClick={() => setOpenBulk(true)} className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"><FileSpreadsheet className="w-4 h-4" /> رفع Excel/CSV</Button>}
      />
      <ActionToolbar
        addLabel="خدمة جديدة" onAdd={handleAdd} onRefresh={load} onSearch={() => setOpenSearch(true)}
        onEdit={handleEdit} onDelete={handleDelete} onRefund={() => { if (!selected) return toast.error('اختر تأشيرة أولاً'); if (selected.is_refunded) return toast.error('التأشيرة مستردة مسبقاً'); setRefundTarget(selected) }} onPrintVoucher={handlePrintVoucher} onPrintTable={handlePrintTable}
        selectedId={selectedId} count={filtered.length}
      />
      {filter && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs">
          <Filter className="w-4 h-4 text-blue-600" /> فلتر نشط: <b>{filter.field}</b> {filter.condition === 'equals' ? 'يساوي' : 'يحتوي على'} "<b>{filter.term}</b>"
          <Button size="sm" variant="ghost" onClick={() => setFilter(null)} className="mr-auto text-rose-600">مسح</Button>
        </div>
      )}
      {/* v3.9.9 — Date range + Bulk actions */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg">
        <span className="text-xs font-bold text-slate-600 flex items-center gap-1">📅 عرض:</span>
        {[{ k: 'today', l: 'اليوم' }, { k: 'week', l: 'آخر ٧ أيام' }, { k: 'month', l: 'هذا الشهر' }, { k: 'all', l: 'الكل' }, { k: 'custom', l: 'مخصص' }].map(p => (
          <button key={p.k} onClick={() => setDateRange({ ...dateRange, preset: p.k })}
            className={`px-3 py-1 rounded-md text-xs font-semibold border ${dateRange.preset === p.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>{p.l}</button>
        ))}
        {dateRange.preset === 'custom' && (
          <>
            <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} className="text-xs border rounded px-2 py-1" />
            <span className="text-xs">إلى</span>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} className="text-xs border rounded px-2 py-1" />
          </>
        )}
        {selectedIds.size > 0 && (
          <div className="mr-auto flex items-center gap-2">
            <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">✓ محدد: {selectedIds.size}</span>
            <Button size="sm" onClick={() => setOpenBulkEdit(true)} className="gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white">✏️ تعديل المحدد ({selectedIds.size})</Button>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} className="gap-1 text-xs">🗑️ حذف المحدد ({selectedIds.size})</Button>
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} className="text-xs">إلغاء التحديد</Button>
          </div>
        )}
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileBadge2 className="w-5 h-5 text-emerald-600" /> سجل التأشيرات ({filtered.length}{(filter || dateRangeBounds) ? ` من ${visas.length}` : ''})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} title="تحديد الكل" /></TableHead>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>المسافر</TableHead>
                  <TableHead>الجواز</TableHead><TableHead>الجنسية</TableHead><TableHead>حساب القبض</TableHead>
                  <TableHead>المورد</TableHead><TableHead>الدفع</TableHead><TableHead>العملة</TableHead>
                  <TableHead className="text-left">تكلفة</TableHead><TableHead className="text-left">بيع</TableHead>
                  <TableHead className="text-left text-emerald-600">عمولة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={14} className="text-center text-slate-400 py-8">{filter || dateRangeBounds ? 'لا نتائج ضمن الفلتر/النطاق' : 'لا توجد خدمات'}</TableCell></TableRow>}
                {filtered.map(v => (
                  <TableRow key={v.id} className={selectedIds.has(v.id) ? 'bg-rose-50' : selectedId === v.id ? 'bg-blue-50' : 'cursor-pointer hover:bg-slate-50'} onClick={(e) => { if (e.target.tagName === 'INPUT') return; setSelectedId(v.id === selectedId ? null : v.id) }}>
                    <TableCell><input type="checkbox" checked={selectedIds.has(v.id)} onChange={() => toggleOne(v.id)} onClick={e => e.stopPropagation()} /></TableCell>
                    <TableCell><input type="radio" checked={selectedId === v.id} onChange={() => setSelectedId(v.id)} onClick={e => e.stopPropagation()} /></TableCell>
                    <TableCell className="text-xs">{fmtDate(v.date)}</TableCell>
                    <TableCell><Badge variant="secondary">{v.service_type}</Badge></TableCell>
                    <TableCell>{v.passenger_name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{v.passport_no || '—'}</TableCell>
                    <TableCell className="text-xs">{v.nationality || '—'}</TableCell>
                    <TableCell>{v.client_name}</TableCell>
                    <TableCell>{v.supplier_name}</TableCell>
                    <TableCell>{v.payment_method === 'cash' ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">💵 نقد</Badge> : <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">🕓 آجل</Badge>}</TableCell>
                    <TableCell><Badge variant="outline">{v.currency}</Badge></TableCell>
                    <TableCell className="text-left font-semibold">{fmt(v.cost, v.currency)}</TableCell>
                    <TableCell className="text-left font-semibold">{fmt(v.sale_price, v.currency)}</TableCell>
                    <TableCell className="text-left font-bold text-emerald-600">{fmt(v.commission, v.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <VisaDialog open={openManual} onOpenChange={(v) => { setOpenManual(v); if (!v) setEditing(null) }} clients={clients} suppliers={suppliers} rates={rates} record={editing}
        onSaved={() => { load(); setEditing(null); toast.success(editing ? '✅ تم تعديل الخدمة وعكس القيد السابق تلقائياً' : 'تم حفظ الخدمة') }} />
      <RefundDialog open={!!refundTarget} onOpenChange={v => !v && setRefundTarget(null)} record={refundTarget} refType="visa" onSaved={() => { setRefundTarget(null); load() }} />
      <BulkImportDialog open={openBulk} onOpenChange={setOpenBulk} kind="visas" onDone={() => { load(); setOpenBulk(false) }} />
      <BulkEditDialog open={openBulkEdit} onOpenChange={setOpenBulkEdit} kind="visas" ids={Array.from(selectedIds)} suppliers={suppliers} boxes={boxes} onDone={() => { load(); setOpenBulkEdit(false); setSelectedIds(new Set()) }} />
      <UniversalSearchModal open={openSearch} onOpenChange={setOpenSearch}
        fields={[
          { key: 'passenger_name', label: 'اسم المسافر' }, { key: 'passport_no', label: 'رقم الجواز' },
          { key: 'client_name', label: 'حساب القبض' }, { key: 'supplier_name', label: 'اسم المورد' },
          { key: 'service_type', label: 'نوع الخدمة' }, { key: 'nationality', label: 'الجنسية' },
          { key: 'sale_price', label: 'سعر البيع' }, { key: 'currency', label: 'العملة' },
        ]}
        onApply={setFilter} onClear={() => setFilter(null)}
      />
    </div>
  )
}

function VisaDialog({ open, onOpenChange, clients, suppliers, rates, onSaved, record }) {
  const { user } = useAuth() // v3.9.9
  const isEdit = !!record
  const emptyForm = { date: todayISO(), service_type: 'تأشيرة عمرة', currency: 'SAR', exchange_rate: 0.267, client_id: '', supplier_id: '', passenger_name: '', passport_no: '', nationality: '', entry_date: '', expected_exit_date: '', passenger_phone: '', passenger_whatsapp: '', cost: '', sale_price: '', payment_method: 'credit', box_id: '',
    // v3.20 — Commission Sharing (partner split)
    commission_partner_type: '', commission_partner_id: '', commission_partner_name: '',
    commission_share_mode: 'amount', commission_share_value: '',
  }
  const [form, setForm] = useState(emptyForm)
  const [boxes, setBoxes] = useState([])
  const [saving, setSaving] = useState(false)
  const [qc, setQc] = useState(false); const [qs, setQs] = useState(false)
  useEffect(() => {
    if (!open) return
    if (record) {
      setForm({
        date: record.date ? new Date(record.date).toISOString().slice(0,10) : todayISO(),
        service_type: record.service_type || 'تأشيرة عمرة',
        currency: record.currency || 'SAR', exchange_rate: record.exchange_rate || 1,
        client_id: record.client_id || '', supplier_id: record.supplier_id || '',
        passenger_name: record.passenger_name || '', passport_no: record.passport_no || '',
        nationality: record.nationality || '',
        entry_date: record.entry_date ? new Date(record.entry_date).toISOString().slice(0,10) : '',
        expected_exit_date: record.expected_exit_date ? new Date(record.expected_exit_date).toISOString().slice(0,10) : '',
        passenger_phone: record.passenger_phone || '',
        passenger_whatsapp: record.passenger_whatsapp || record.passenger_phone || '',
        cost: record.cost ?? '', sale_price: record.sale_price ?? '',
        payment_method: record.payment_method || 'credit', box_id: record.box_id || '',
        // v3.20 — Commission Sharing
        commission_partner_type: record.commission_partner_type || '',
        commission_partner_id: record.commission_partner_id || '',
        commission_partner_name: record.commission_partner_name || '',
        commission_share_mode: record.commission_share_mode || 'amount',
        commission_share_value: record.commission_share_value ?? '',
      })
    } else { setForm(emptyForm) }
  }, [open, record])
  useEffect(() => { if (rates && !isEdit) setForm(f => ({ ...f, exchange_rate: rates[f.currency] || 1 })) }, [rates, form.currency])
  useEffect(() => { if (open) api('/boxes').then(setBoxes).catch(()=>{}) }, [open])
  useEffect(() => { if (form.payment_method === 'cash' && boxes[0] && !form.box_id) setForm(f => ({ ...f, box_id: (user?.default_box_id && boxes.find(b => b.id === user.default_box_id)) ? user.default_box_id : boxes[0].id })) }, [form.payment_method, boxes, user])
  const commission = (Number(form.sale_price) || 0) - (Number(form.cost) || 0)
  const submit = async () => {
    // v3.9.22 — Unified payment: credit → client_id required; cash → box_id required
    if (!form.supplier_id) return toast.error('اختر المورد')
    // v3.89 — Task 5: FE checks mirror backend mandatory fields exactly
    if (!String(form.passenger_name || '').trim()) return toast.error('اسم صاحب التأشيرة / المعتمر مطلوب')
    if (!String(form.passenger_phone || form.passenger_whatsapp || '').trim()) return toast.error('رقم الجوال مطلوب')
    if (form.payment_method === 'credit' && !form.client_id) return toast.error('اختر حساب القبض / العميل (للحجز الآجل)')
    if (form.payment_method === 'cash' && !form.box_id) return toast.error('اختر الصندوق / البنك (للنقد)')
    if (!form.cost || !form.sale_price) return toast.error('أدخل التكلفة وسعر البيع')
    try {
      setSaving(true)
      // v3.89 — compatibility bridge: backend validates beneficiary_* while the form stores passenger_*
      const body = { ...form, beneficiary_name: form.passenger_name, beneficiary_phone: form.passenger_phone, beneficiary_whatsapp: form.passenger_whatsapp }
      if (isEdit) await api(`/visas/${record.id}`, { method: 'PUT', body })
      else await api('/visas', { method: 'POST', body })
      onOpenChange(false); onSaved(); setForm(emptyForm)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-xl"><div className="w-9 h-9 rounded-lg grad-green flex items-center justify-center"><FileBadge2 className="w-4 h-4 text-white" /></div>{isEdit ? '✏️ تعديل خدمة / تأشيرة' : 'خدمة / تأشيرة جديدة'}</DialogTitle>{isEdit && <DialogDescription>سيتم عكس القيد المحاسبي القديم وإعادة الترحيل تلقائياً — دون خصم من الحصة</DialogDescription>}</DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="التاريخ"><DocDateInput value={form.date} onChange={v => setForm({ ...form, date: v })} /></Field>
            <Field label="نوع الخدمة"><Select value={form.service_type} onValueChange={v => setForm({ ...form, service_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VISA_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="العملة"><Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c} — {CUR_NAME[c]}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="المورد 🔍" required><AccountAutocomplete type="supplier" value={form.supplier_id || null} onChange={(sel) => setForm({ ...form, supplier_id: sel?.id || '' })} placeholder="ابحث عن المورد بالاسم أو الكود..." /></Field>
            <Field label="سعر الصرف"><Input type="number" min="0" step="0.0001" value={form.exchange_rate} onChange={e => setForm({ ...form, exchange_rate: e.target.value })} /></Field>
            <Field label="اسم صاحب التأشيرة" required><Input value={form.passenger_name} onChange={e => setForm({ ...form, passenger_name: e.target.value })} /></Field>
            <Field label="رقم الجواز"><Input value={form.passport_no} onChange={e => setForm({ ...form, passport_no: e.target.value })} /></Field>
            <Field label="الجنسية"><Input value={form.nationality} onChange={e => setForm({ ...form, nationality: e.target.value })} /></Field>
          </div>
          {/* v3.0 — Entry / Expected Exit tracking for expiration alerts */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-2">
            <div className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-2">
              <CalendarClock className="w-4 h-4" /> تتبع الدخول والخروج (اختياري — لتفعيل تنبيه لوحة التحكم قبل 10 أيام)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="تاريخ الدخول"><Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} /></Field>
              <Field label="تاريخ الخروج المتوقع"><Input type="date" value={form.expected_exit_date} onChange={e => setForm({ ...form, expected_exit_date: e.target.value })} /></Field>
            </div>
          </div>

          {/* v3.2 — Contact for smart WhatsApp expiration alerts */}
          <div className="bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3 mt-2">
            <div className="text-sm font-bold text-emerald-900 mb-2 flex items-center gap-2">
              📱 <span>بيانات التواصل — لإرسال تنبيه واتساب قبل انتهاء التأشيرة</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="رقم هاتف المسافر" required><Input dir="ltr" value={form.passenger_phone} onChange={e => {
                const v = e.target.value; setForm(f => ({ ...f, passenger_phone: v, passenger_whatsapp: f.passenger_whatsapp || v }))
              }} placeholder="777xxxxxxx" className="bg-white" /></Field>
              <Field label="رقم واتساب (إن اختلف)"><Input dir="ltr" value={form.passenger_whatsapp} onChange={e => setForm({ ...form, passenger_whatsapp: e.target.value })} placeholder="اختياري" className="bg-white" /></Field>
            </div>
          </div>
          {/* v3.9.22 — Unified Payment Selector (Visa) */}
          <div className="bg-gradient-to-l from-slate-50 to-blue-50 border-2 border-blue-200 rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
              💳 <span>طريقة الدفع + جهة الاستلام</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="طريقة الدفع" required>
                <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">🕓 آجل (على حساب عميل)</SelectItem>
                    <SelectItem value="cash">💵 نقد (صندوق / بنك)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.payment_method === 'credit' ? (
                <Field label="حساب القبض / العميل 🔍" required>
                  <AccountAutocomplete type="client" value={form.client_id || null}
                    onChange={(sel) => setForm({ ...form, client_id: sel?.id || '' })}
                    placeholder="ابحث عن العميل بالاسم أو الكود..." />
                </Field>
              ) : (
                <Field label="الصندوق / البنك 🔍" required>
                  <AccountAutocomplete type="box" value={form.box_id || null}
                    onChange={(sel) => setForm({ ...form, box_id: sel?.id || '' })}
                    placeholder="ابحث عن صندوق أو بنك..."
                    disabled={!!user?.lock_box && user?.role !== 'owner'} />
                </Field>
              )}
            </div>
          </div>
          <div className="bg-gradient-to-l from-emerald-50 to-blue-50 border rounded-xl p-4 mt-2">
            <div className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Banknote className="w-4 h-4 text-emerald-600" /> الجانب المالي</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label={`التكلفة (${form.currency})`} required><Input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} className="text-lg font-bold" /></Field>
              <Field label={`سعر البيع (${form.currency})`} required><Input type="number" min="0" step="0.01" value={form.sale_price} onChange={e => setForm({ ...form, sale_price: e.target.value })} className="text-lg font-bold" /></Field>
              <Field label={`العمولة (${form.currency})`}><div className={`px-3 py-2 rounded-md border text-lg font-extrabold ${commission >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{fmt(commission, form.currency)}</div></Field>
            </div>
          </div>
          {/* v3.20 — Partner Commission Sharing (Visa) */}
          <CommissionShareBlock form={form} setForm={setForm} clients={clients} suppliers={suppliers} commission={commission} entityLabel="التأشيرة" />
          <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button onClick={submit} disabled={saving} className="grad-green text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? '💾 حفظ التعديل + عكس القيد' : 'حفظ + قيد')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <QuickAddDialog open={qc} onOpenChange={setQc} kind="client" onSaved={onSaved} />
      <QuickAddDialog open={qs} onOpenChange={setQs} kind="supplier" onSaved={onSaved} />
    </>
  )
}

// ================================================================
// SERVICES SCREEN (v3.0) — Dedicated dynamic-catalog services module
// Label: "حساب القبض" (Receivable Account) instead of "اسم العميل"
// ================================================================
function ServicesScreen() {
  const { settings, tenant } = useAuth()
  const [services, setServices] = useState([])
  const [serviceTypes, setServiceTypes] = useState([])
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [boxes, setBoxes] = useState([]) // v3.9.11
  const [openManual, setOpenManual] = useState(false)
  const [openTypes, setOpenTypes] = useState(false)
  const [openSearch, setOpenSearch] = useState(false)
  const [openBulkEdit, setOpenBulkEdit] = useState(false) // v3.9.11
  const [filter, setFilter] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set()) // v3.9.11
  const [dateRange, setDateRange] = useState({ preset: 'month', from: '', to: '' }) // v3.9.11
  const [editing, setEditing] = useState(null)
  const [refundTarget, setRefundTarget] = useState(null)
  const [rates, setRates] = useState(null)
  const load = async () => {
    try {
      const [sv, st, c, s, r, bx] = await Promise.all([
        api('/services'), api('/service-types'), api('/clients'), api('/suppliers'), api('/rates'), api('/boxes').catch(() => [])
      ])
      setServices(sv); setServiceTypes(st); setClients(c); setSuppliers(s); setRates(r.rates); setBoxes(bx)
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [])
  const dateRangeBounds = useMemo(() => {
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (dateRange.preset === 'today') return { from: today, to: new Date(today.getTime() + 86400000 - 1) }
    if (dateRange.preset === 'week') { const d = new Date(today); d.setDate(d.getDate() - 6); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'month') { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'custom' && dateRange.from) { const f = new Date(dateRange.from); const t = dateRange.to ? new Date(dateRange.to + 'T23:59:59') : new Date(); return { from: f, to: t } }
    return null
  }, [dateRange])
  const filteredByDate = useMemo(() => { if (!dateRangeBounds) return (services || []).filter(Boolean); return (services || []).filter(Boolean).filter(v => { const d = new Date(v?.date); return !isNaN(d) && d >= dateRangeBounds.from && d <= dateRangeBounds.to }) }, [services, dateRangeBounds])
  const filtered = applyFilter(filteredByDate, filter)
  const selected = filtered.find(v => v?.id === selectedId)
  const allSelected = filtered.length > 0 && filtered.every(v => selectedIds.has(v.id))
  const toggleAll = () => { if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(filtered.map(v => v.id))) }
  const toggleOne = (id) => { const s = new Set(selectedIds); if (s.has(id)) s.delete(id); else s.add(id); setSelectedIds(s) }
  const handleAdd = () => { setEditing(null); setOpenManual(true) }
  const handleEdit = () => { if (!selected) return toast.error('اختر خدمة أولاً'); setEditing(selected); setOpenManual(true) }
  const handleDelete = async () => {
    if (!selectedId) return
    if (!(await askConfirm({ title: 'حذف الخدمة', desc: 'سيتم حذف هذه الخدمة وعكس القيد المحاسبي المرتبط بها.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/services/${selectedId}`, { method: 'DELETE' }); toast.success('تم الحذف'); setSelectedId(null); load() }
    catch (e) { toast.error(e.message) }
  }
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds); if (ids.length === 0) return toast.error('لم يتم اختيار أي سجل')
    if (!(await askConfirm({ title: 'حذف جماعي', desc: `حذف ${ids.length} خدمة وعكس قيودها المحاسبية دفعة واحدة؟`, variant: 'danger', confirmLabel: 'حذف الكل' }))) return
    try { const r = await api('/services/bulk-delete', { method: 'POST', body: { ids } }); toast.success(`✅ تم حذف ${r.deleted}${r.failed ? ` • فشل ${r.failed}` : ''}`); setSelectedIds(new Set()); setSelectedId(null); load() }
    catch (e) { toast.error(e.message) }
  }
  const handlePrintTable = () => {
    const totals = { cost: 0, sale_price: 0, commission: 0 }
    for (const r of filtered) { totals.cost += r.cost; totals.sale_price += r.sale_price; totals.commission += r.commission }
    printTable({
      title: 'كشف الخدمات', settings, tenant, rows: filtered,
      columns: [
        { key: 'date', label: 'التاريخ', render: r => fmtDate(r.date) },
        { key: 'service_type', label: 'الخدمة' },
        { key: 'beneficiary_name', label: 'المستفيد' },
        { key: 'reference_no', label: 'الرقم المرجعي' },
        { key: 'client_name', label: 'حساب القبض' },
        { key: 'supplier_name', label: 'المورد / المزود' },
        { key: 'currency', label: 'العملة' },
        { key: 'cost', label: 'تكلفة', align: 'left', render: r => fmt(r.cost, r.currency) },
        { key: 'sale_price', label: 'بيع', align: 'left', render: r => fmt(r.sale_price, r.currency) },
        { key: 'commission', label: 'عمولة', align: 'left', render: r => fmt(r.commission, r.currency) },
      ],
      totals: { cost: totals.cost.toFixed(2), sale_price: totals.sale_price.toFixed(2), commission: totals.commission.toFixed(2) },
    })
  }
  return (
    <div className="space-y-4">
      <TopBar
        title="الخدمات"
        subtitle="حجز فنادق، تصديق شهادات، خدمات نقل، وأي خدمة إضافية — كتالوج ديناميكي مع قيود محاسبية تلقائية"
        right={
          <Button variant="outline" onClick={() => setOpenTypes(true)} className="gap-2 border-orange-200 text-orange-700 hover:bg-orange-50">
            <Settings className="w-4 h-4" /> إدارة أنواع الخدمات ({serviceTypes.length})
          </Button>
        }
      />
      <ActionToolbar
        addLabel="خدمة جديدة" onAdd={handleAdd} onRefresh={load} onSearch={() => setOpenSearch(true)}
        onEdit={handleEdit} onDelete={handleDelete} onRefund={() => { if (!selected) return toast.error('اختر خدمة أولاً'); if (selected.is_refunded) return toast.error('الخدمة مستردة مسبقاً'); setRefundTarget(selected) }} onPrintTable={handlePrintTable}
        selectedId={selectedId} count={filtered.length}
      />
      {filter && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs">
          <Filter className="w-4 h-4 text-blue-600" /> فلتر نشط: <b>{filter.field}</b> {filter.condition === 'equals' ? 'يساوي' : 'يحتوي على'} "<b>{filter.term}</b>"
          <Button size="sm" variant="ghost" onClick={() => setFilter(null)} className="mr-auto text-rose-600">مسح</Button>
        </div>
      )}
      {/* v3.9.11 — Date range + Bulk actions */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg">
        <span className="text-xs font-bold text-slate-600 flex items-center gap-1">📅 عرض:</span>
        {[{ k: 'today', l: 'اليوم' }, { k: 'week', l: 'آخر ٧ أيام' }, { k: 'month', l: 'هذا الشهر' }, { k: 'all', l: 'الكل' }, { k: 'custom', l: 'مخصص' }].map(p => (
          <button key={p.k} onClick={() => setDateRange({ ...dateRange, preset: p.k })}
            className={`px-3 py-1 rounded-md text-xs font-semibold border ${dateRange.preset === p.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>{p.l}</button>
        ))}
        {dateRange.preset === 'custom' && (
          <>
            <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} className="text-xs border rounded px-2 py-1" />
            <span className="text-xs">إلى</span>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} className="text-xs border rounded px-2 py-1" />
          </>
        )}
        {selectedIds.size > 0 && (
          <div className="mr-auto flex items-center gap-2">
            <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">✓ محدد: {selectedIds.size}</span>
            <Button size="sm" onClick={() => setOpenBulkEdit(true)} className="gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white">✏️ تعديل المحدد ({selectedIds.size})</Button>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} className="gap-1 text-xs">🗑️ حذف المحدد ({selectedIds.size})</Button>
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} className="text-xs">إلغاء التحديد</Button>
          </div>
        )}
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5 text-orange-600" /> سجل الخدمات ({filtered.length}{(filter || dateRangeBounds) ? ` من ${services.length}` : ''})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} title="تحديد الكل" /></TableHead>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>التاريخ</TableHead><TableHead>نوع الخدمة</TableHead>
                  <TableHead>المستفيد</TableHead><TableHead>الرقم المرجعي</TableHead>
                  <TableHead>حساب القبض</TableHead><TableHead>المورد / المزود</TableHead>
                  <TableHead>الدفع</TableHead><TableHead>العملة</TableHead>
                  <TableHead className="text-left">تكلفة</TableHead><TableHead className="text-left">بيع</TableHead>
                  <TableHead className="text-left text-emerald-600">عمولة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={13} className="text-center text-slate-400 py-8">{filter || dateRangeBounds ? 'لا نتائج ضمن الفلتر/النطاق' : 'لا توجد خدمات — أضف خدمة جديدة من الأعلى'}</TableCell></TableRow>}
                {filtered.map(v => (
                  <TableRow key={v?.id} className={selectedIds.has(v?.id) ? 'bg-rose-50' : selectedId === v?.id ? 'bg-blue-50' : 'cursor-pointer hover:bg-slate-50'} onClick={(e) => { if (e.target.tagName === 'INPUT') return; setSelectedId(v?.id === selectedId ? null : v?.id) }}>
                    <TableCell><input type="checkbox" checked={selectedIds.has(v?.id)} onChange={() => toggleOne(v?.id)} onClick={e => e.stopPropagation()} /></TableCell>
                    <TableCell><input type="radio" checked={selectedId === v?.id} onChange={() => setSelectedId(v?.id)} onClick={e => e.stopPropagation()} /></TableCell>
                    <TableCell className="text-xs">{fmtDate(v?.date)}</TableCell>
                    <TableCell><Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border border-orange-200">{v?.service_type || '—'}</Badge></TableCell>
                    <TableCell>{v?.beneficiary_name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{v?.reference_no || '—'}</TableCell>
                    <TableCell>{v?.client_name || '—'}</TableCell>
                    <TableCell>{v?.supplier_name || '—'}</TableCell>
                    <TableCell>{v?.payment_method === 'cash' ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">💵 نقد</Badge> : <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">🕓 آجل</Badge>}</TableCell>
                    <TableCell><Badge variant="outline">{v?.currency || '—'}</Badge></TableCell>
                    <TableCell className="text-left font-semibold">{fmt(v?.cost, v?.currency)}</TableCell>
                    <TableCell className="text-left font-semibold">{fmt(v?.sale_price, v?.currency)}</TableCell>
                    <TableCell className="text-left font-bold text-emerald-600">{fmt(v?.commission, v?.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <BulkEditDialog open={openBulkEdit} onOpenChange={setOpenBulkEdit} kind="services" ids={Array.from(selectedIds)} suppliers={suppliers} boxes={boxes} onDone={() => { load(); setOpenBulkEdit(false); setSelectedIds(new Set()) }} />
      <ServiceDialog open={openManual} onOpenChange={(v) => { setOpenManual(v); if (!v) setEditing(null) }}
        clients={clients} suppliers={suppliers} rates={rates} serviceTypes={serviceTypes} record={editing}
        onSaved={() => { load(); setEditing(null); toast.success(editing ? '✅ تم تعديل الخدمة وعكس القيد السابق' : 'تم حفظ الخدمة') }} />
      <ServiceTypesDialog open={openTypes} onOpenChange={setOpenTypes} onChanged={load} />
      <RefundDialog open={!!refundTarget} onOpenChange={v => !v && setRefundTarget(null)} record={refundTarget} refType="service" onSaved={() => { setRefundTarget(null); load() }} />
      <UniversalSearchModal open={openSearch} onOpenChange={setOpenSearch}
        fields={[
          { key: 'service_type', label: 'نوع الخدمة' }, { key: 'beneficiary_name', label: 'المستفيد' },
          { key: 'reference_no', label: 'الرقم المرجعي' }, { key: 'client_name', label: 'حساب القبض' },
          { key: 'supplier_name', label: 'المورد' }, { key: 'sale_price', label: 'سعر البيع' },
          { key: 'currency', label: 'العملة' },
        ]}
        onApply={setFilter} onClear={() => setFilter(null)}
      />
    </div>
  )
}

function ServiceDialog({ open, onOpenChange, clients, suppliers, rates, serviceTypes, onSaved, record }) {
  const { user } = useAuth() // v3.9.9
  const isEdit = !!record
  const activeTypes = (serviceTypes || []).filter(t => t.active !== false)
  const emptyForm = {
    date: todayISO(), service_type: activeTypes[0]?.name || 'خدمات متنوعة',
    currency: 'SAR', exchange_rate: 0.267,
    client_id: '', supplier_id: '', beneficiary_name: '', reference_no: '', description: '',
    beneficiary_phone: '', beneficiary_whatsapp: '',
    cost: '', sale_price: '', payment_method: 'credit', box_id: '', notes: '',
    // v3.20 — Commission Sharing (partner split)
    commission_partner_type: '', commission_partner_id: '', commission_partner_name: '',
    commission_share_mode: 'amount', commission_share_value: '',
  }
  const [form, setForm] = useState(emptyForm)
  const [boxes, setBoxes] = useState([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    if (record) {
      setForm({
        date: record.date ? new Date(record.date).toISOString().slice(0,10) : todayISO(),
        service_type: record.service_type || 'خدمات متنوعة',
        currency: record.currency || 'SAR', exchange_rate: record.exchange_rate || 1,
        client_id: record.client_id || '', supplier_id: record.supplier_id || '',
        beneficiary_name: record.beneficiary_name || '', reference_no: record.reference_no || '',
        description: record.description || '', notes: record.notes || '',
        beneficiary_phone: record.beneficiary_phone || '',
        beneficiary_whatsapp: record.beneficiary_whatsapp || record.beneficiary_phone || '',
        cost: record.cost ?? '', sale_price: record.sale_price ?? '',
        payment_method: record.payment_method || 'credit', box_id: record.box_id || '',
        // v3.20 — Commission Sharing
        commission_partner_type: record.commission_partner_type || '',
        commission_partner_id: record.commission_partner_id || '',
        commission_partner_name: record.commission_partner_name || '',
        commission_share_mode: record.commission_share_mode || 'amount',
        commission_share_value: record.commission_share_value ?? '',
      })
    } else { setForm({ ...emptyForm, service_type: activeTypes[0]?.name || 'خدمات متنوعة' }) }
  }, [open, record])
  useEffect(() => { if (rates && !isEdit) setForm(f => ({ ...f, exchange_rate: rates[f.currency] || 1 })) }, [rates, form.currency])
  useEffect(() => { if (open) api('/boxes').then(setBoxes).catch(()=>{}) }, [open])
  useEffect(() => { if (form.payment_method === 'cash' && boxes[0] && !form.box_id) setForm(f => ({ ...f, box_id: (user?.default_box_id && boxes.find(b => b.id === user.default_box_id)) ? user.default_box_id : boxes[0].id })) }, [form.payment_method, boxes, user])
  const commission = (Number(form.sale_price) || 0) - (Number(form.cost) || 0)
  const submit = async () => {
    // v3.9.22 — Unified payment: credit → client_id required; cash → box_id required
    if (!form.supplier_id) return toast.error('اختر المورد / المزود')
    // v3.89 — Task 4: beneficiary name & phone are mandatory (matches backend validation)
    // v3.89.4 — F-PR16-001: phone checked STRICTLY (no whatsapp fallback — mirrors backend)
    if (!String(form.beneficiary_name || '').trim()) return toast.error('اسم المستفيد مطلوب')
    if (!String(form.beneficiary_phone || '').trim()) return toast.error('رقم هاتف المستفيد مطلوب')
    if (form.payment_method === 'credit' && !form.client_id) return toast.error('اختر حساب القبض / العميل (للحجز الآجل)')
    if (form.payment_method === 'cash' && !form.box_id) return toast.error('اختر الصندوق / البنك (للنقد)')
    if (!form.cost || !form.sale_price) return toast.error('أدخل التكلفة وسعر البيع')
    try {
      setSaving(true)
      if (isEdit) await api(`/services/${record.id}`, { method: 'PUT', body: form })
      else await api('/services', { method: 'POST', body: form })
      onOpenChange(false); onSaved(); setForm(emptyForm)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className="w-9 h-9 rounded-lg grad-gold flex items-center justify-center"><Briefcase className="w-4 h-4 text-white" /></div>
            {isEdit ? '✏️ تعديل خدمة' : 'خدمة جديدة'}
          </DialogTitle>
          {isEdit && <DialogDescription>سيتم عكس القيد المحاسبي القديم وإعادة الترحيل تلقائياً — دون خصم من الحصة</DialogDescription>}
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="التاريخ"><DocDateInput value={form.date} onChange={v => setForm({ ...form, date: v })} /></Field>
          <Field label="نوع الخدمة">
            <Select value={form.service_type} onValueChange={v => setForm({ ...form, service_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{activeTypes.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="العملة"><Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c} — {CUR_NAME[c]}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="المورد / المزود 🔍" required><AccountAutocomplete type="supplier" value={form.supplier_id || null} onChange={(sel) => setForm({ ...form, supplier_id: sel?.id || '' })} placeholder="ابحث عن المورد بالاسم أو الكود..." /></Field>
          <Field label="سعر الصرف"><Input type="number" min="0" step="0.0001" value={form.exchange_rate} onChange={e => setForm({ ...form, exchange_rate: e.target.value })} /></Field>
          <Field label="اسم المستفيد" required><Input value={form.beneficiary_name} onChange={e => setForm({ ...form, beneficiary_name: e.target.value })} placeholder="مثال: أحمد محمد" /></Field>
          <Field label="الرقم المرجعي"><Input value={form.reference_no} onChange={e => setForm({ ...form, reference_no: e.target.value })} placeholder="مثال: HTL-2025-001" /></Field>
          <Field label="وصف مختصر"><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="مثال: 3 ليالٍ فندق البلد" /></Field>
        </div>
        {/* v3.2 — Contact panel */}
        <div className="bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3 mt-2">
          <div className="text-sm font-bold text-emerald-900 mb-2 flex items-center gap-2">
            📱 <span>بيانات التواصل — لإرسال تفاصيل الخدمة أو تنبيهات عبر الواتساب</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="رقم هاتف المستفيد" required><Input dir="ltr" value={form.beneficiary_phone} onChange={e => {
              const v = e.target.value; setForm(f => ({ ...f, beneficiary_phone: v, beneficiary_whatsapp: f.beneficiary_whatsapp || v }))
            }} placeholder="777xxxxxxx" className="bg-white" /></Field>
            <Field label="رقم واتساب (اختياري)"><Input dir="ltr" value={form.beneficiary_whatsapp} onChange={e => setForm({ ...form, beneficiary_whatsapp: e.target.value })} className="bg-white" /></Field>
          </div>
        </div>
        {/* v3.9.22 — Unified Payment Selector (Service) */}
        <div className="bg-gradient-to-l from-slate-50 to-blue-50 border-2 border-blue-200 rounded-xl p-4 mt-2">
          <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
            💳 <span>طريقة الدفع + جهة الاستلام</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="طريقة الدفع" required>
              <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">🕓 آجل (على حساب عميل)</SelectItem>
                  <SelectItem value="cash">💵 نقد (صندوق / بنك)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.payment_method === 'credit' ? (
              <Field label="حساب القبض / العميل 🔍" required>
                <AccountAutocomplete type="client" value={form.client_id || null}
                  onChange={(sel) => setForm({ ...form, client_id: sel?.id || '' })}
                  placeholder="ابحث عن العميل بالاسم أو الكود..." />
              </Field>
            ) : (
              <Field label="الصندوق / البنك 🔍" required>
                <AccountAutocomplete type="box" value={form.box_id || null}
                  onChange={(sel) => setForm({ ...form, box_id: sel?.id || '' })}
                  placeholder="ابحث عن صندوق أو بنك..."
                  disabled={!!user?.lock_box && user?.role !== 'owner'} />
              </Field>
            )}
          </div>
        </div>
        <div className="bg-gradient-to-l from-orange-50 to-amber-50 border rounded-xl p-4 mt-2">
          <div className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Banknote className="w-4 h-4 text-orange-600" /> الجانب المالي</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={`التكلفة (${form.currency})`} required><Input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} className="text-lg font-bold" /></Field>
            <Field label={`سعر البيع (${form.currency})`} required><Input type="number" min="0" step="0.01" value={form.sale_price} onChange={e => setForm({ ...form, sale_price: e.target.value })} className="text-lg font-bold" /></Field>
            <Field label={`العمولة (${form.currency})`}><div className={`px-3 py-2 rounded-md border text-lg font-extrabold ${commission >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{fmt(commission, form.currency)}</div></Field>
          </div>
        </div>
        {/* v3.20 — Partner Commission Sharing (Service) */}
        <CommissionShareBlock form={form} setForm={setForm} clients={clients} suppliers={suppliers} commission={commission} entityLabel="الخدمة" />
        <Field label="ملاحظات (اختياري)">
          <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="grad-gold text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? '💾 حفظ التعديل + عكس القيد' : 'حفظ + قيد')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServiceTypesDialog({ open, onOpenChange, onChanged }) {
  const [types, setTypes] = useState([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const load = async () => { try { setTypes(await api('/service-types')) } catch (e) { toast.error(e.message) } }
  useEffect(() => { if (open) load() }, [open])
  const add = async () => {
    const n = name.trim()
    if (!n) return toast.error('أدخل اسم نوع الخدمة')
    try {
      setSaving(true)
      await api('/service-types', { method: 'POST', body: { name: n } })
      setName(''); await load(); onChanged && onChanged()
      toast.success('تمت الإضافة')
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const del = async (id) => {
    if (!(await askConfirm({ title: 'حذف نوع الخدمة', desc: 'سيتم حذف نوع الخدمة من القائمة.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/service-types/${id}`, { method: 'DELETE' }); await load(); onChanged && onChanged(); toast.success('تم الحذف') }
    catch (e) { toast.error(e.message) }
  }
  const toggle = async (t) => {
    try { await api(`/service-types/${t.id}`, { method: 'PATCH', body: { active: !t.active } }); await load(); onChanged && onChanged() }
    catch (e) { toast.error(e.message) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5 text-orange-600" /> إدارة أنواع الخدمات</DialogTitle>
          <DialogDescription>أضف/أخفِ أنواع الخدمات التي يقدمها مكتبك (فنادق، تصديقات، خدمات نقل، ...)</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="اسم نوع الخدمة الجديد" onKeyDown={e => e.key === 'Enter' && add()} />
          <Button onClick={add} disabled={saving} className="grad-gold text-white gap-1"><Plus className="w-4 h-4" /> إضافة</Button>
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto border rounded-lg divide-y">
          {types.length === 0 && <div className="p-4 text-center text-slate-400 text-sm">لا توجد أنواع بعد</div>}
          {types.map(t => (
            <div key={t.id} className={`flex items-center justify-between p-2 ${t.active === false ? 'bg-slate-50 opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-orange-500" />
                <span className="font-semibold">{t.name}</span>
                {t.active === false && <Badge variant="outline" className="text-xs">مخفي</Badge>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => toggle(t)} className="text-xs">{t.active === false ? 'إظهار' : 'إخفاء'}</Button>
                <Button size="sm" variant="ghost" onClick={() => del(t.id)} className="text-rose-600"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================
// VOUCHER + PARTIES + BOXES + CHART + JOURNAL + REPORTS (same as v1)
// ================================================================
function VoucherScreen({ mode }) {
  const { settings, tenant } = useAuth()
  const cfg = mode === 'receipt'
    ? { title: 'سند قبض', subtitle: 'المستلم من العميل / المورد', icon: ArrowDownLeft, grad: 'grad-green', partyLabel: 'المستلم من', defaultParty: 'client' }
    : { title: 'سند صرف', subtitle: 'المدفوع إلى المورد / مصروفات', icon: ArrowUpRight, grad: 'grad-rose', partyLabel: 'المدفوع إلى', defaultParty: 'supplier' }
  const [vouchers, setVouchers] = useState([])
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [boxes, setBoxes] = useState([])
  const [open, setOpen] = useState(false)
  const [openSearch, setOpenSearch] = useState(false)
  const [filter, setFilter] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(null)
  const load = async () => {
    try {
      const [v, c, s, b] = await Promise.all([api(`/vouchers?type=${mode}`), api('/clients'), api('/suppliers'), api('/boxes')])
      setVouchers(v); setClients(c); setSuppliers(s); setBoxes(b)
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load(); setSelectedId(null); setFilter(null) }, [mode])
  const filtered = applyFilter(vouchers, filter)
  const selected = filtered.find(v => v.id === selectedId)
  const handleAdd = () => { setEditing(null); setOpen(true) }
  const handleEdit = () => { if (!selected) return toast.error('اختر سنداً أولاً'); setEditing(selected); setOpen(true) }
  const handleDelete = async () => {
    if (!selectedId) return
    if (!(await askConfirm({ title: 'حذف السند', desc: 'سيتم حذف هذا السند وعكس القيد المحاسبي المرتبط به.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/vouchers/${selectedId}`, { method: 'DELETE' }); toast.success('تم الحذف'); setSelectedId(null); load() }
    catch (e) { toast.error(e.message) }
  }
  const handlePrintVoucher = () => {
    if (!selected) return toast.error('اختر سنداً أولاً')
    printVoucher({ kind: mode, record: selected, settings, tenant })
  }
  const handlePrintTable = () => {
    const totals = { amount: 0 }
    for (const r of filtered) { totals.amount += r.amount }
    printTable({
      title: `كشف ${cfg.title}`, settings, tenant, rows: filtered,
      columns: [
        { key: 'date', label: 'التاريخ', render: r => fmtDate(r.date) },
        { key: 'party_name', label: cfg.partyLabel },
        { key: 'description', label: 'البيان' },
        { key: 'method', label: 'الطريقة' },
        { key: 'box_name', label: 'الصندوق' },
        { key: 'currency', label: 'العملة' },
        { key: 'amount', label: 'المبلغ', align: 'left', render: r => fmt(r.amount, r.currency) },
      ],
      totals: { amount: totals.amount.toFixed(2) },
    })
  }
  return (
    <div className="space-y-4">
      <TopBar title={cfg.title} subtitle={cfg.subtitle} />
      <ActionToolbar
        addLabel={`${cfg.title} جديد`} onAdd={handleAdd} onRefresh={load} onSearch={() => setOpenSearch(true)}
        onEdit={handleEdit} onDelete={handleDelete} onPrintVoucher={handlePrintVoucher} onPrintTable={handlePrintTable}
        selectedId={selectedId} count={filtered.length}
      />
      {filter && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs">
          <Filter className="w-4 h-4 text-blue-600" /> فلتر: <b>{filter.field}</b> "<b>{filter.term}</b>"
          <Button size="sm" variant="ghost" onClick={() => setFilter(null)} className="mr-auto text-rose-600">مسح</Button>
        </div>
      )}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><cfg.icon className="w-5 h-5" /> سجل السندات ({filtered.length}{filter ? ` من ${vouchers.length}` : ''})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead className="w-8"></TableHead><TableHead>التاريخ</TableHead><TableHead>{cfg.partyLabel}</TableHead><TableHead>البيان</TableHead><TableHead>الطريقة</TableHead><TableHead>الصندوق</TableHead><TableHead>العملة</TableHead><TableHead className="text-left">المبلغ</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-slate-400 py-8">لا توجد سندات</TableCell></TableRow>}
              {filtered.map(v => (
                <TableRow key={v.id} className={selectedId === v.id ? 'bg-blue-50' : 'cursor-pointer hover:bg-slate-50'} onClick={() => setSelectedId(v.id === selectedId ? null : v.id)}>
                  <TableCell><input type="radio" checked={selectedId === v.id} onChange={() => setSelectedId(v.id)} /></TableCell>
                  <TableCell className="text-xs">{fmtDate(v.date)}</TableCell>
                  <TableCell className="font-semibold">{v.party_name}</TableCell>
                  <TableCell className="text-xs">{v.description || '—'}</TableCell>
                  <TableCell><Badge variant="secondary">{v.method}</Badge></TableCell>
                  <TableCell>{v.box_name}</TableCell>
                  <TableCell><Badge variant="outline">{v.currency}</Badge></TableCell>
                  <TableCell className={`text-left font-bold ${mode === 'receipt' ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(v.amount, v.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <VoucherDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null) }} mode={mode} clients={clients} suppliers={suppliers} boxes={boxes} record={editing}
        onSaved={() => { load(); setEditing(null); toast.success(editing ? '✅ تم تعديل السند وعكس القيد تلقائياً' : 'تم حفظ السند') }} />
      <UniversalSearchModal open={openSearch} onOpenChange={setOpenSearch}
        fields={[
          { key: 'party_name', label: 'اسم الطرف' }, { key: 'description', label: 'البيان' },
          { key: 'amount', label: 'المبلغ' }, { key: 'currency', label: 'العملة' },
          { key: 'method', label: 'طريقة الدفع' },
        ]}
        onApply={setFilter} onClear={() => setFilter(null)}
      />
    </div>
  )
}

function VoucherDialog({ open, onOpenChange, mode, clients, suppliers, boxes, onSaved, record }) {
  const { user } = useAuth() // v3.9.16 — Fix "user is not defined" — used in box Select disabled state
  const isEdit = !!record
  const defaultParty = mode === 'receipt' ? 'client' : 'supplier'
  const emptyForm = { date: todayISO(), currency: 'USD', amount: '', party_type: defaultParty, party_id: '', party_name: '', box_id: '', method: '', description: '' }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    if (record) {
      setForm({
        date: record.date ? new Date(record.date).toISOString().slice(0,10) : todayISO(),
        currency: record.currency || 'USD',
        amount: record.amount ?? '',
        party_type: record.party_type || defaultParty,
        party_id: record.party_id || '', party_name: record.party_name || '',
        coa_account_code: record.coa_account_code || '', // v3.79 — real expense/revenue account
        box_id: record.box_id || '', method: record.method || '', description: record.description || '',
      })
    } else {
      setForm({ ...emptyForm, party_type: defaultParty })
    }
  }, [open, record, mode])
  useEffect(() => { if (!isEdit) setForm(f => ({ ...f, party_type: defaultParty, party_id: '', party_name: '' })) }, [mode, defaultParty])
  useEffect(() => { if (boxes[0] && !form.box_id) setForm(f => ({ ...f, box_id: boxes[0].id })) }, [boxes])
  const list = form.party_type === 'client' ? clients : form.party_type === 'supplier' ? suppliers : []
  const submit = async () => {
    if (!form.amount) return toast.error('أدخل المبلغ')
    if (form.party_type === 'expense' && !form.coa_account_code) return toast.error('اختر حساب المصروف من دليل الحسابات — أو أضفه من نفس الحقل')
    if (form.party_type === 'revenue' && !form.coa_account_code) return toast.error('اختر حساب الإيراد من دليل الحسابات — أو أضفه من نفس الحقل')
    if (!['expense', 'revenue'].includes(form.party_type) && !form.party_id) return toast.error('اختر الطرف')
    if (!form.box_id) return toast.error('اختر الصندوق')
    try {
      setSaving(true)
      if (isEdit) await api(`/vouchers/${record.id}`, { method: 'PUT', body: { type: mode, ...form } })
      else await api('/vouchers', { method: 'POST', body: { type: mode, ...form } })
      onOpenChange(false); setForm({ ...emptyForm, party_type: defaultParty, box_id: boxes[0]?.id || '' }); onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader><DialogTitle>{isEdit ? `✏️ تعديل ${mode === 'receipt' ? 'سند قبض' : 'سند صرف'}` : (mode === 'receipt' ? 'سند قبض جديد' : 'سند صرف جديد')}</DialogTitle>{isEdit && <DialogDescription>سيتم عكس القيد المحاسبي القديم وإعادة الترحيل بالقيم الجديدة تلقائياً</DialogDescription>}</DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="التاريخ"><DocDateInput value={form.date} onChange={v => setForm({ ...form, date: v })} /></Field>
          <Field label="نوع الطرف"><Select value={form.party_type} onValueChange={v => setForm({ ...form, party_type: v, party_id: '', coa_account_code: '' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="client">عميل</SelectItem><SelectItem value="supplier">مورد</SelectItem>{mode === 'payment' && <SelectItem value="expense">مصروف</SelectItem>}{mode === 'receipt' && <SelectItem value="revenue">إيراد</SelectItem>}</SelectContent></Select></Field>
          {form.party_type === 'expense' || form.party_type === 'revenue' ? (
            <div className="md:col-span-1">
              {/* v3.79 — REAL account from the chart of accounts (not free text). The «البيان» field below stays for description only. */}
              <Field label={form.party_type === 'expense' ? 'حساب المصروف 🔍 (من دليل الحسابات)' : 'حساب الإيراد 🔍 (من دليل الحسابات)'} required>
                <AccountAutocomplete
                  type="account"
                  acctType={form.party_type === 'expense' ? 'expense' : 'revenue'}
                  suggestedParent={form.party_type === 'expense' ? '51' : '4'}
                  value={form.coa_account_code || null}
                  onChange={(sel) => setForm({ ...form, coa_account_code: sel?.account_code || '', party_name: sel?.name || '' })}
                  placeholder={form.party_type === 'expense' ? 'اكتب: إيجار / مرتبات / كهرباء...' : 'اكتب اسم حساب الإيراد...'}
                />
              </Field>
            </div>
          ) : (
            <div className="md:col-span-1">
              <Field label={`${mode === 'receipt' ? 'المستلم من' : 'المدفوع إلى'} 🔍 (بحث ذكي)`} required>
                <AccountAutocomplete
                  type={form.party_type}
                  value={form.party_id || null}
                  onChange={(sel) => setForm({ ...form, party_id: sel?.id || '', party_name: sel?.name || '' })}
                  placeholder={`ابحث عن ${form.party_type === 'client' ? 'عميل' : 'مورد'} بالاسم أو الكود...`}
                />
              </Field>
            </div>
          )}
          <div className="md:col-span-1">
            <Field label="الصندوق/البنك 🔍" required>
              <AccountAutocomplete
                type="box"
                value={form.box_id || null}
                onChange={(sel) => setForm({ ...form, box_id: sel?.id || '' })}
                placeholder="اختر صندوق أو بنك..."
                disabled={!!user?.lock_box && user?.role !== 'owner'}
              />
            </Field>
          </div>
          <Field label="العملة"><Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="المبلغ" required><Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="text-lg font-bold" /></Field>
          <Field label="طريقة الدفع"><Input value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} placeholder="نقدي / حوالة" /></Field>
          <div className="md:col-span-2"><Field label="البيان"><Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button onClick={submit} disabled={saving} className={mode === 'receipt' ? 'grad-green text-white' : 'grad-rose text-white'}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? '💾 حفظ التعديل' : 'حفظ')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PartiesScreen({ kind }) {
  const cfg = kind === 'clients' ? { title: 'العملاء', icon: Users, grad: 'grad-purple' } : { title: 'الموردون والوكلاء', icon: Building2, grad: 'grad-gold' }
  const defaultParent = kind === 'clients' ? COA_FE.CLIENTS : COA_FE.SUPPLIERS
  const parentType = kind === 'clients' ? 'asset' : 'liability'
  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [q, setQ] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', whatsapp: '', address: '', email: '', notes: '', parent_code: defaultParent, credit_limit: 0, credit_currency: 'USD', is_frozen: false })
  const load = async () => { try { setRows(await api(`/${kind}`)) } catch (e) { toast.error(e.message) } }
  const loadAccounts = async () => { try { setAccounts(await api('/accounts')) } catch (_) {} }
  useEffect(() => { load(); loadAccounts() }, [kind])
  useEffect(() => {
    if (!open) return
    if (editing) setForm({ name: editing.name || '', phone: editing.phone || '', whatsapp: editing.whatsapp || editing.phone || '', address: editing.address || '', email: editing.email || '', notes: editing.notes || '', parent_code: editing.parent_code || defaultParent, credit_limit: editing.credit_limit || 0, credit_currency: editing.credit_currency || 'USD', is_frozen: !!editing.is_frozen })
    else setForm({ name: '', phone: '', whatsapp: '', address: '', email: '', notes: '', parent_code: defaultParent, credit_limit: 0, credit_currency: 'USD', is_frozen: false })
  }, [open, editing])
  const save = async () => {
    if (!form.name) return toast.error('الاسم مطلوب')
    try {
      if (editing) await api(`/${kind}/${editing.id}`, { method: 'PUT', body: form })
      else await api(`/${kind}`, { method: 'POST', body: form })
      setOpen(false); setEditing(null); load(); toast.success(editing ? 'تم التعديل' : 'تمت الإضافة')
    } catch (e) { toast.error(e.message) }
  }
  const del = async (r) => {
    if (!(await askConfirm({ title: 'تأكيد الحذف', desc: `حذف ${r.name}؟`, variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/${kind}/${r.id}`, { method: 'DELETE' }); load(); toast.success('تم الحذف') }
    catch (e) { toast.error(e.message) }
  }
  const filtered = rows.filter(r => !q || r.name.includes(q) || (r.phone || '').includes(q))
  // Eligible parents: accounts of matching type (asset for clients, liability for suppliers) that are groups
  const parentOptions = accounts.filter(a => a.type === parentType && a.is_group)
  return (
    <div className="space-y-6">
      <TopBar title={cfg.title} subtitle={`إجمالي: ${rows.length}`}
        right={<div className="flex items-center gap-2"><div className="relative"><Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input placeholder="بحث..." value={q} onChange={e => setQ(e.target.value)} className="pr-9 w-64" /></div><Button onClick={() => { setEditing(null); setOpen(true) }} className={`gap-2 ${cfg.grad} text-white`}><Plus className="w-4 h-4" /> إضافة</Button></div>} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(r => (
          <Card key={r.id} className="overflow-hidden hover:shadow-md transition-shadow">
            <div className={`h-1 ${cfg.grad}`} />
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-bold text-slate-800">{r.name}</div>
                  {r.phone && <div className="text-xs text-slate-500 flex items-center gap-1" dir="ltr">📞 {r.phone}</div>}
                  {r.address && <div className="text-xs text-slate-500 truncate">📍 {r.address}</div>}
                  {r.email && <div className="text-xs text-slate-500 truncate" dir="ltr">✉️ {r.email}</div>}
                </div>
                <div className={`w-10 h-10 rounded-lg ${cfg.grad} flex items-center justify-center`}><cfg.icon className="w-5 h-5 text-white" /></div>
              </div>
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <WaBtn phone={r.whatsapp || r.phone} message={`السلام عليكم ${r.name}،`} size="xs" iconOnly={false} label="واتساب" />
                <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true) }} className="h-6 px-2 text-xs gap-1"><Pencil className="w-3 h-3" /> تعديل</Button>
                <Button size="sm" variant="ghost" onClick={() => del(r)} className="h-6 px-2 text-xs text-rose-600 gap-1"><Trash2 className="w-3 h-3" /> حذف</Button>
              </div>
              <Separator className="my-3" />
              <div className="space-y-1">{CURRENCIES.map(c => { const bal = r.balances?.[c] || 0; return <div key={c} className="flex items-center justify-between text-sm"><span className="text-xs text-slate-500">{c}</span><span className={`font-bold ${bal > 0 ? 'text-emerald-600' : bal < 0 ? 'text-rose-600' : 'text-slate-400'}`}>{fmt(bal, c)}</span></div> })}</div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <div className="col-span-full text-center text-slate-400 py-10">لا توجد بيانات</div>}
      </div>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null) }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? `تعديل ${kind === 'clients' ? 'عميل' : 'مورد'}` : `إضافة ${kind === 'clients' ? 'عميل' : 'مورد'}`}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><Field label="الاسم" required><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field></div>
            <Field label="📞 رقم الهاتف"><Input dir="ltr" value={form.phone} onChange={e => {
              const v = e.target.value; setForm(f => ({ ...f, phone: v, whatsapp: f.whatsapp || v }))
            }} placeholder="777xxxxxxx" /></Field>
            <Field label="📱 رقم واتساب"><Input dir="ltr" value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })} placeholder="اختياري — يستخدم الهاتف افتراضياً" /></Field>
            <div className="md:col-span-2"><Field label="📍 العنوان"><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="المدينة، الحي، الشارع..." /></Field></div>
            <div className="md:col-span-2"><Field label="✉️ البريد الإلكتروني"><Input dir="ltr" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field></div>
            <div className="md:col-span-2">
              <Field label={`🌲 الحساب الأب (شجرة الحسابات)`}>
                <Select value={form.parent_code} onValueChange={(v) => setForm({ ...form, parent_code: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر الحساب الأب" /></SelectTrigger>
                  <SelectContent>
                    {parentOptions.map(a => (
                      <SelectItem key={a.code} value={a.code}>
                        {a.code} — {a.name_ar}{a.code === defaultParent ? ' ⭐ افتراضي' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="text-xs text-slate-500 mt-1">سيندرج {kind === 'clients' ? 'العميل' : 'المورد'} كحساب فرعي تحت هذا الأب في شجرة الحسابات.</div>
            </div>
            {kind === 'clients' && (
              <>
                <Field label="💳 سقف الائتمان">
                  <Input type="number" min="0" value={form.credit_limit || 0} onChange={e => setForm({ ...form, credit_limit: e.target.value })} placeholder="0 = بدون سقف" />
                </Field>
                <Field label="💱 عملة السقف">
                  <Select value={form.credit_currency || 'USD'} onValueChange={v => setForm({ ...form, credit_currency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 p-2 rounded border cursor-pointer bg-slate-50">
                    <input type="checkbox" checked={!!form.is_frozen} onChange={e => setForm({ ...form, is_frozen: e.target.checked })} className="w-5 h-5" />
                    <div>
                      <div className="font-bold text-red-700">❄️ تجميد الحساب</div>
                      <div className="text-xs text-slate-500">يمنع إصدار أي حركات آجلة على هذا العميل</div>
                    </div>
                  </label>
                </div>
              </>
            )}
            <div className="md:col-span-2"><Field label="ملاحظات"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className={`${cfg.grad} text-white`}>{editing ? '💾 حفظ التعديل' : 'حفظ'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BoxesScreen() {
  const [rows, setRows] = useState([]); const [accounts, setAccounts] = useState([]); const [open, setOpen] = useState(false)
  const [name, setName] = useState(''); const [type, setType] = useState('cash')
  const [parentCode, setParentCode] = useState(COA_FE.CASHBOXES)
  const load = async () => { try { setRows(await api('/boxes')) } catch (e) { toast.error(e.message) } }
  const loadAccounts = async () => { try { setAccounts(await api('/accounts')) } catch (_) {} }
  useEffect(() => { load(); loadAccounts() }, [])
  // Update default parent when type changes
  useEffect(() => { setParentCode(type === 'cash' ? COA_FE.CASHBOXES : COA_FE.BANKS) }, [type])
  const save = async () => { if (!name) return toast.error('الاسم مطلوب'); try { await api('/boxes', { method: 'POST', body: { name_ar: name, type, parent_code: parentCode } }); setName(''); setOpen(false); load() } catch (e) { toast.error(e.message) } }
  const defaultParent = type === 'cash' ? COA_FE.CASHBOXES : COA_FE.BANKS
  // Eligible parents for boxes/banks: asset accounts that are groups
  const parentOptions = accounts.filter(a => a.type === 'asset' && a.is_group)
  return (
    <div className="space-y-6">
      <TopBar title="الصناديق والبنوك" subtitle="أرصدة الصناديق النقدية والحسابات البنكية"
        right={<Button onClick={() => setOpen(true)} className="gap-2 grad-gold text-white"><Plus className="w-4 h-4" /> إضافة</Button>} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(b => (
          <Card key={b.id} className="overflow-hidden"><div className={`h-1 ${b.type === 'cash' ? 'grad-gold' : 'grad-brand'}`} />
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${b.type === 'cash' ? 'grad-gold' : 'grad-brand'}`}>{b.type === 'cash' ? <Wallet className="w-5 h-5 text-white" /> : <Landmark className="w-5 h-5 text-white" />}</div>
                <div><div className="font-bold text-slate-800">{b.name_ar}</div><div className="text-xs text-slate-500">{b.type === 'cash' ? 'صندوق نقدي' : 'حساب بنكي'} {b.parent_code && <span className="ml-1 font-mono text-[10px] text-slate-400">· {b.parent_code}</span>}</div></div>
              </div>
              <Separator className="my-2" />
              <div className="space-y-1">{CURRENCIES.map(c => (<div key={c} className="flex items-center justify-between text-sm"><span className="text-xs text-slate-500">{c}</span><span className={`font-bold ${(b.balances?.[c] || 0) >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>{fmt(b.balances?.[c] || 0, c)}</span></div>))}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>إضافة صندوق / بنك</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="الاسم" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="النوع">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">صندوق نقدي</SelectItem>
                  <SelectItem value="bank">بنك</SelectItem>
                </SelectContent>
              </Select>

            </Field>
            <Field label="🌲 الحساب الأب (شجرة الحسابات)">
              <Select value={parentCode} onValueChange={setParentCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {parentOptions.map(a => (
                    <SelectItem key={a.code} value={a.code}>
                      {a.code} — {a.name_ar}{a.code === defaultParent ? ' ⭐ افتراضي' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-slate-500 mt-1">افتراضي: {type === 'cash' ? 'الصناديق (1101)' : 'الحسابات البنكية (1201)'} — يمكن تغييره.</div>
            </Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button onClick={save} className="grad-gold text-white">حفظ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ChartScreen() {
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ code: '', name_ar: '', type: 'asset', parent: '', is_group: false, notes: '' })
  // v3.89 — Task 1+2: inline sub-account creation (+ button) with auto-generated code preview
  const [prefill, setPrefill] = useState(null)
  const [autoCode, setAutoCode] = useState('')
  // v3.10.0 — Full tree view (parents + sub-entities: clients/suppliers/boxes)
  const [viewMode, setViewMode] = useState('tree') // 'tree' | 'classic'
  const [treeData, setTreeData] = useState([])
  const [treeSearch, setTreeSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [expanded, setExpanded] = useState({})
  const load = () => api('/accounts').then(setRows).catch(e => toast.error(e.message))
  const loadTree = () => api(`/accounts/tree${showInactive ? '?include_inactive=1' : ''}`).then(setTreeData).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => { if (viewMode === 'tree') loadTree() }, [viewMode, showInactive])
  useEffect(() => {
    if (!open) return
    if (editing) setForm({ code: editing.code || '', name_ar: editing.name_ar || '', type: editing.type || 'asset', parent: editing.parent || '', is_group: !!editing.is_group, notes: editing.notes || '' })
    else setForm({ code: '', name_ar: '', type: prefill?.type || 'asset', parent: prefill?.parent || '', is_group: false, notes: '' })
  }, [open, editing, prefill])
  // v3.89 — Task 1: fetch the auto-generated code PREVIEW when a parent is selected.
  // The final code is still generated atomically at POST /accounts — zero collision risk.
  useEffect(() => {
    if (!open || editing) return
    if (!form.parent) { setAutoCode(''); return }
    let alive = true
    api(`/accounts/next-code?parent=${encodeURIComponent(form.parent)}`)
      .then(r => { if (alive) { setAutoCode(r.next_code); setForm(f => ({ ...f, code: r.next_code })) } })
      .catch(() => { if (alive) setAutoCode('') })
    return () => { alive = false }
  }, [open, editing, form.parent])
  const save = async () => {
    if (!form.name_ar) return toast.error('الاسم مطلوب')
    if (!form.code && !form.parent) return toast.error('الرمز مطلوب — أو اختر الحساب الأب ليتولد الرمز تلقائياً')
    // v3.88.4 — U-010: invalid codes are REJECTED with a clear message — never silently modified
    if (!editing && form.code && !/^\d+$/.test(form.code)) return toast.error(`رمز الحساب "${form.code}" غير صالح — يجب أن يكون أرقاماً فقط (لن يُعدَّل تلقائياً)`)
    try {
      if (editing) await api(`/accounts/${editing.id}`, { method: 'PUT', body: { name_ar: form.name_ar, type: form.type, parent: form.parent || null, is_group: form.is_group, notes: form.notes } })
      // v3.89 — when the code matches the auto-preview, send it EMPTY so the backend
      // generates it atomically (collision-free even under concurrent creation)
      else {
        const created = await api('/accounts', { method: 'POST', body: (form.parent && (!form.code || form.code === autoCode)) ? { ...form, code: '' } : form })
        // v3.92 — COA→operational auto-link feedback
        if (created?.operational_link?.created) toast.success(`🔗 أُنشئ ${created.operational_link.kind} تشغيلي مرتبط تلقائياً (${created.code}) — سيظهر في الشاشة التشغيلية والسندات`)
      }
      setOpen(false); setEditing(null); load(); loadTree(); toast.success(editing ? 'تم التعديل' : 'تمت الإضافة') // v3.88.4 — U-008: refresh the TREE view too
    } catch (e) { toast.error(e.message) }
  }
  // v3.92 — orphan-link audit & safe repair (owner-triggered, idempotent)
  const [linkAudit, setLinkAudit] = useState(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const runLinkAudit = async () => { try { setLinkAudit(await api('/accounts/link-audit')); setLinkOpen(true) } catch (e) { toast.error(e.message) } }
  const runLinkRepair = async () => {
    if (!(await askConfirm({ title: 'ربط الحسابات اليتيمة بالسجلات التشغيلية', desc: 'سيُنشأ سجل تشغيلي (صندوق/عميل/مورد) لكل حساب غير مرتبط — عملية آمنة وIdempotent بدون إعادة ترقيم. حالات تعارض الأسماء تُتخطى وتُعرض.', icon: '🔗', confirmLabel: 'تنفيذ الربط الآمن' }))) return
    try {
      const r = await api('/accounts/link-repair', { method: 'POST' })
      toast.success(`🔗 تم ربط ${r.repaired_count} حساباً${r.skipped_conflicts?.length ? ` — تُخطي ${r.skipped_conflicts.length} (تعارض أسماء)` : ''}`)
      setLinkAudit(await api('/accounts/link-audit')); load(); loadTree()
    } catch (e) { toast.error(e.message) }
  }
  const del = async (a) => {
    // v3.92.1 — required copy: unused accounts get the standard irreversible-delete confirm;
    // used accounts are blocked by the backend with the "linked to operations" message.
    if (!(await askConfirm({ title: 'حذف الحساب المحاسبي', desc: `هل أنت متأكد من حذف الحساب ${a.code} — ${a.name_ar}؟ لا يمكن التراجع بعد الحذف.`, variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try {
      const r = await api(`/accounts/${a.id}`, { method: 'DELETE' }); load(); loadTree()
      toast.success(r?.cascade_deleted ? `تم حذف الحساب و${r.cascade_deleted} المرتبط به (غير مستخدم)` : 'تم الحذف')
    } // v3.88.4 — U-008
    catch (e) { toast.error(e.message) }
  }
  // v3.88.3 — Equity added as a first-class account type (COA v2 already contains the
  // equity section 3/31/31xx — the UI simply never offered it in the type dropdown).
  const byType = { asset: rows.filter(r => r.type === 'asset'), liability: rows.filter(r => r.type === 'liability'), equity: rows.filter(r => r.type === 'equity'), revenue: rows.filter(r => r.type === 'revenue'), expense: rows.filter(r => r.type === 'expense') }
  const typeLabel = { asset: 'الأصول', liability: 'الخصوم', equity: 'حقوق الملكية', revenue: 'الإيرادات', expense: 'المصروفات' }
  const typeGrad = { asset: 'grad-brand', liability: 'grad-rose', equity: 'grad-purple', revenue: 'grad-green', expense: 'grad-gold' }
  // Build a tree: group by parent code
  // v3.88.3 — parents are ALWAYS same-type only (unchanged rule). For Equity specifically,
  // only GROUP accounts are offered as parents (per COA v2 the 3xx groups) — the other four
  // types keep their existing parent filtering exactly as before.
  // v3.89.1 — BLOCKER 2 FIX: parents can ONLY be Group accounts (matches the backend guard)
  const eligibleParents = rows.filter(r => r.type === form.type && r.is_group)
  // v3.89 — Task 2: keep the prefilled parent visible even if outside the default filter
  const parentOptions = form.parent && !eligibleParents.some(p => p.code === form.parent)
    ? [...eligibleParents, ...rows.filter(r => r.code === form.parent)]
    : eligibleParents
  const buildTree = (list) => {
    const map = new Map(); list.forEach(a => map.set(a.code, { ...a, children: [] }))
    const roots = []
    for (const a of list) {
      if (a.parent && map.has(a.parent)) map.get(a.parent).children.push(map.get(a.code))
      else roots.push(map.get(a.code))
    }
    return roots
  }
  const renderNode = (node, depth = 0) => (
    <div key={node.id}>
      <div className={`flex items-center justify-between p-2 rounded-md ${node.is_group ? 'bg-slate-50 font-semibold' : ''}`} style={{ paddingRight: `${8 + depth * 20}px` }}>
        <div className="flex items-center gap-2">
          {depth > 0 && <span className="text-slate-300">↳</span>}
          <span className="font-mono text-xs text-slate-500">{node.code}</span>
          <span className="text-sm">{node.name_ar}</span>
          {node.is_group && <Badge variant="outline" className="text-xs">مجموعة</Badge>}
        </div>
        <div className="flex items-center gap-1 opacity-60 hover:opacity-100">
          {node.id && node.is_group === true && (
            <Button size="sm" variant="ghost" title={`➕ إضافة حساب فرعي تحت ${node.code}`} onClick={() => { setEditing(null); setPrefill({ type: node.type, parent: String(node.code) }); setOpen(true) }} className="h-6 w-6 p-0 text-emerald-600"><Plus className="w-3.5 h-3.5" /></Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => { setEditing(node); setOpen(true) }} className="h-6 w-6 p-0"><Pencil className="w-3 h-3" /></Button>
          <Button size="sm" variant="ghost" onClick={() => del(node)} className="h-6 w-6 p-0 text-rose-600"><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>
      {node.children?.map(c => renderNode(c, depth + 1))}
    </div>
  )

  // v3.10.0 — Full-tree renderer with sub_entities (clients/suppliers/boxes)
  const typeColor = { asset: 'text-emerald-700 bg-emerald-50 border-emerald-200', liability: 'text-rose-700 bg-rose-50 border-rose-200', equity: 'text-violet-700 bg-violet-50 border-violet-200', revenue: 'text-blue-700 bg-blue-50 border-blue-200', expense: 'text-amber-700 bg-amber-50 border-amber-200' }
  const subEntityIcon = { client: '👤', supplier: '🏭', box: '💰' }
  const matchesSearch = (text) => !treeSearch || String(text || '').toLowerCase().includes(treeSearch.toLowerCase())
  const nodeMatches = (node) => {
    if (matchesSearch(node.name) || matchesSearch(node.code)) return true
    if ((node.children || []).some(c => nodeMatches(c))) return true
    if ((node.sub_entities || []).some(s => matchesSearch(s.name) || matchesSearch(s.code))) return true
    return false
  }
  const toggleExp = (code) => setExpanded(e => ({ ...e, [code]: !e[code] }))
  const renderTreeNode = (node, depth = 0) => {
    if (!nodeMatches(node)) return null
    const hasChildren = (node.children || []).length > 0
    const hasSubs = (node.sub_entities || []).length > 0
    const canExpand = hasChildren || hasSubs
    const isOpen = expanded[node.code] !== false // default open
    const clr = typeColor[node.type] || 'text-slate-700 bg-slate-50'
    return (
      <div key={node.code} className="mb-1">
        <div className={`flex items-center justify-between gap-2 p-2 rounded-lg border ${clr}`} style={{ marginRight: `${depth * 16}px` }}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {canExpand ? (
              <button onClick={() => toggleExp(node.code)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/60 text-xs font-bold">
                {isOpen ? '▾' : '▸'}
              </button>
            ) : <span className="w-5 h-5 inline-block" />}
            <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-white/70 border">{node.code}</span>
            <span className="text-sm font-semibold truncate">{node.name}</span>
            {node.linked_entity && <span title={`مرتبط بسجل تشغيلي (${node.linked_entity.type === 'box' ? 'صندوق/بنك' : node.linked_entity.type === 'client' ? 'عميل' : 'مورد'})`} className="text-emerald-600 text-xs">🔗</span>}
            {node.is_group && <Badge variant="outline" className="text-[10px] shrink-0">📁 مجموعة</Badge>}
            {node.is_parent && <Badge variant="outline" className="text-[10px] shrink-0 bg-white">🌳 شجري · {node.next_child_seq} فرع</Badge>}
          </div>
          <div className="flex items-center gap-1 opacity-70 hover:opacity-100 shrink-0">
            {node.id && node.is_group === true && (
              <Button size="sm" variant="ghost" title={`➕ إضافة حساب فرعي تحت ${node.code}`} onClick={() => { setEditing(null); setPrefill({ type: node.type, parent: String(node.code) }); setOpen(true) }} className="h-6 w-6 p-0 text-emerald-600"><Plus className="w-3.5 h-3.5" /></Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setEditing({ id: node.id, code: node.code, name_ar: node.name, type: node.type, parent: node.parent, is_group: node.is_group }); setOpen(true) }} className="h-6 w-6 p-0"><Pencil className="w-3 h-3" /></Button>
          </div>
        </div>
        {isOpen && hasChildren && (
          <div className="mt-1 space-y-1 border-r-2 border-dashed border-slate-200 pr-2 mr-4">
            {(node.children || []).map(c => renderTreeNode(c, depth + 1))}
          </div>
        )}
        {isOpen && hasSubs && (
          <div className="mt-1 space-y-1 border-r-2 border-dotted border-purple-200 pr-2 mr-8">
            {(node.sub_entities || []).filter(s => matchesSearch(s.name) || matchesSearch(s.code)).map(se => (
              <div key={se.id} className={`flex items-center justify-between gap-2 p-1.5 rounded-md text-xs bg-white border ${se.inactive ? 'border-slate-200 opacity-60' : 'border-slate-200 hover:border-purple-300'}`}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span>{subEntityIcon[se.type] || '•'}</span>
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700">{se.code}</span>
                  <span className="text-slate-800 truncate">{se.name}</span>
                  {se.inactive && <Badge variant="outline" className="text-[9px] shrink-0 bg-slate-100 text-slate-500">🌙 غير نشط</Badge>}
                </div>
                <div className="text-[10px] text-slate-500 shrink-0 font-mono">
                  {Object.entries(se.balances || {}).filter(([, v]) => Number(v) !== 0).slice(0, 2).map(([c, v]) => `${c}:${Number(v).toLocaleString()}`).join(' · ') || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <TopBar title="الدليل المحاسبي" subtitle="شجرة الحسابات الرئيسية والفرعية — يدعم الحسابات المجمعة (parent/child)"
        right={<div className="flex items-center gap-2">
          <Button variant="outline" onClick={runLinkAudit} className="gap-2">🔗 فحص الربط التشغيلي</Button>
          <Button onClick={() => { setEditing(null); setOpen(true) }} className="gap-2 grad-brand text-white"><Plus className="w-4 h-4" /> حساب جديد</Button>
        </div>} />
      {/* v3.92 — orphan-link audit dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>🔗 ربط حسابات الدليل بالسجلات التشغيلية (1101 / 1102 / 1103 / 2101)</DialogTitle></DialogHeader>
          {!linkAudit ? <div className="text-slate-400 text-center py-6">جارِ الفحص…</div> : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-emerald-100 text-emerald-700">مرتبط: {linkAudit.linked}</Badge>
                <Badge className={linkAudit.orphans?.length ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}>يتيم (بلا سجل تشغيلي): {linkAudit.orphans?.length || 0}</Badge>
                <Badge className={linkAudit.conflicts?.length ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}>تعارض اسم: {linkAudit.conflicts?.length || 0}</Badge>
              </div>
              {(linkAudit.orphans?.length > 0) && (
                <div className="border rounded-lg p-3 bg-rose-50/50 max-h-48 overflow-y-auto space-y-1">
                  {linkAudit.orphans.map(o => <div key={o.code} className="text-xs flex gap-2"><span className="font-mono text-slate-500" dir="ltr">{o.code}</span><b>{o.name}</b><Badge variant="outline" className="text-[9px]">{o.kind}</Badge></div>)}
                </div>
              )}
              {(linkAudit.conflicts?.length > 0) && (
                <div className="border rounded-lg p-3 bg-orange-50/60 max-h-40 overflow-y-auto space-y-1">
                  <div className="text-[11px] font-bold text-orange-800">تعارضات أسماء — لن تُربط تلقائياً (قرار يدوي): غيّر اسم الحساب أو السجل ثم أعد الفحص</div>
                  {linkAudit.conflicts.map(o => <div key={o.code} className="text-xs flex gap-2"><span className="font-mono text-slate-500" dir="ltr">{o.code}</span><b>{o.name}</b><span className="text-orange-700">يتعارض مع حساب {o.conflict_with || '—'}</span></div>)}
                </div>
              )}
              {(linkAudit.orphans?.length === 0 && linkAudit.conflicts?.length === 0) && <div className="text-emerald-700 font-semibold">✅ كل الحسابات مرتبطة بسجلاتها التشغيلية</div>}
              <div className="flex justify-between items-center pt-2">
                <div className="text-[10px] text-slate-400">الربط بالهوية (account_code) وليس بالاسم · Idempotent · بدون إعادة ترقيم</div>
                {linkAudit.orphans?.length > 0 && <Button onClick={runLinkRepair} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1">🔗 ربط آمن ({linkAudit.orphans.length})</Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* v3.10.0 — View mode toggle bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 border">
              <button onClick={() => setViewMode('tree')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'tree' ? 'bg-white shadow border' : 'text-slate-500'}`}>🌳 عرض الشجرة الشاملة</button>
              <button onClick={() => setViewMode('classic')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'classic' ? 'bg-white shadow border' : 'text-slate-500'}`}>📚 العرض التقليدي</button>
            </div>
            {viewMode === 'tree' && (
              <>
                <div className="flex-1 min-w-[200px]">
                  <Input placeholder="🔍 بحث في الشجرة (اسم أو كود)..." value={treeSearch} onChange={e => setTreeSearch(e.target.value)} className="h-8 text-sm" />
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  <span>إظهار الحسابات الخاملة (🌙)</span>
                </label>
                <Button size="sm" variant="outline" onClick={() => setExpanded({})} className="h-8 text-xs">📂 توسيع الكل</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const all = {}; const collect = (n) => { all[n.code] = false; (n.children || []).forEach(collect) }; treeData.forEach(collect); setExpanded(all)
                }} className="h-8 text-xs">📁 طي الكل</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {viewMode === 'tree' ? (
        <Card>
          <CardContent className="p-4">
            {treeData.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">جاري تحميل شجرة الحسابات...</div>}
            <div className="space-y-2">
              {treeData.map(root => renderTreeNode(root, 0))}
            </div>
            <div className="mt-4 pt-3 border-t text-[11px] text-slate-500 flex flex-wrap gap-3">
              <span>🎨 <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">الأصول</span></span>
              <span><span className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 font-semibold">الخصوم</span></span>
              <span><span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 font-semibold">الإيرادات</span></span>
              <span><span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-semibold">المصروفات</span></span>
              <span className="ms-auto">👤 عميل · 🏭 مورد · 💰 صندوق/بنك</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(byType).map(([t, list]) => (
            <Card key={t}>
              <CardHeader><CardTitle className="flex items-center gap-2"><div className={`w-8 h-8 rounded-md ${typeGrad[t]}`} /> {typeLabel[t]} <Badge variant="outline">{list.length}</Badge></CardTitle></CardHeader>
              <CardContent><div className="space-y-1">
                {list.length === 0 && <div className="text-xs text-slate-400 text-center py-4">لا توجد حسابات — أضف حساباً جديداً</div>}
                {buildTree(list).map(n => renderNode(n))}
              </div></CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setPrefill(null); setAutoCode('') } }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل حساب: ${editing.code}` : 'إضافة حساب جديد إلى الدليل المحاسبي'}</DialogTitle>
            <DialogDescription>اختر النوع أولاً، ثم اختر الحساب الأب لبناء التسلسل الهرمي</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="نوع الحساب" required>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v, parent: '' })} disabled={!!editing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="asset">الأصول (Assets)</SelectItem>
                  <SelectItem value="liability">الخصوم (Liabilities)</SelectItem>
                  <SelectItem value="equity">حقوق الملكية (Equity)</SelectItem>
                  <SelectItem value="revenue">الإيرادات (Revenue)</SelectItem>
                  <SelectItem value="expense">المصروفات (Expenses)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="رمز الحساب" required>
              <Input dir="ltr" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} disabled={!!editing} placeholder={form.parent ? 'يتولد تلقائياً...' : 'مثال: 1102'} />
              {!editing && form.parent && autoCode && form.code === autoCode && (
                <div className="text-[10px] text-emerald-600 font-semibold mt-1">✨ رمز تلقائي تحت الأب {form.parent} — يُثبَّت نهائياً عند الحفظ</div>
              )}
            </Field>
            <div className="md:col-span-2"><Field label="اسم الحساب (عربي)" required>
              <Input value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} placeholder="مثال: صندوق فرع عدن" />
            </Field></div>
            <div className="md:col-span-2"><Field label="الحساب الأب (اختياري)">
              <Select value={form.parent || 'none'} onValueChange={v => setForm({ ...form, parent: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="بدون (حساب رئيسي)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— لا يوجد أب (حساب رئيسي) —</SelectItem>
                  {parentOptions.map(p => (
                    <SelectItem key={p.id} value={p.code}>
                      {'   '.repeat(Math.max(0, (p.code?.length || 1) - 1))} {p.code} — {p.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field></div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-50 rounded-md border">
                <input type="checkbox" checked={form.is_group} onChange={e => setForm({ ...form, is_group: e.target.checked })} />
                <span className="text-sm font-semibold">حساب مجموعة (Group) — لا يُقيَّد عليه مباشرة، فقط يجمع الحسابات الفرعية</span>
              </label>
            </div>
            <div className="md:col-span-2"><Field label="ملاحظات"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className="grad-brand text-white">{editing ? '💾 حفظ التعديل' : 'إضافة'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// v3.87 — journal ref-type Arabic labels
// v3.88.4 — DEP-001/DEP-002: environment-aware public origin — the Test environment must
// only ever emit Test URLs (referral/invite links, extension setup). Live and previews
// keep the official domain (preview links are ephemeral — official is the safe default).
const publicSiteOrigin = () => { try { if (/rahaal-test/.test(window.location.hostname)) return window.location.origin } catch { /* SSR */ } return 'https://rahaal.targetmediagrp.com' }

const JE_REF_LABEL = { manual: 'قيد يدوي', manual_dual: 'قيد مزدوج', opening: 'قيد افتتاحي', opening_close: 'إقفال أرصدة افتتاحية', opening_balance: 'رصيد سابق', ticket: 'تذكرة', visa: 'تأشيرة', service: 'خدمة', voucher: 'سند', receipt: 'سند قبض', payment: 'سند صرف', fx: 'مصارفة', fx_buy: 'شراء عملة', fx_sell: 'بيع عملة', refund: 'استرداد', year_close: 'إقفال سنة مالية', package_booking: 'حجز باكج', meraaj_settle: 'تسوية معراج' } // v3.88.4 — U-004: full labels, no raw technical names

// v3.87 — OPENING BALANCE ENTRY: user enters ONE side only (account/box/client/supplier +
// currency + amount + debit/credit) — the system auto-balances against 3103.
function OpeningJournalDialog({ open, onOpenChange, onSaved }) {
  const [entity, setEntity] = useState(null)
  const [form, setForm] = useState({ amount: '', side: 'debit', currency: 'SAR', date: todayISO(), note: '' })
  const [saving, setSaving] = useState(false)
  const reset = () => { setEntity(null); setForm(f => ({ ...f, amount: '', note: '' })) }
  const submit = async (keepOpen) => {
    if (!entity) { toast.error('اختر الحساب / الصندوق / العميل / المورد أولاً'); return }
    if (!Number(form.amount) || Number(form.amount) <= 0) { toast.error('أدخل مبلغاً أكبر من صفر'); return }
    setSaving(true)
    try {
      await api('/journal-entries/opening', {
        method: 'POST',
        body: {
          party_type: entity.type === 'account' ? 'account' : entity.type,
          party_id: entity.id,
          account_code: entity.account_code,
          currency: form.currency, amount: Number(form.amount), side: form.side, date: form.date, note: form.note,
        },
      })
      toast.success(`✅ سُجّل الرصيد الافتتاحي — الطرف المقابل تلقائياً: 3103 ${'تسوية الأرصدة الافتتاحية'}`)
      onSaved?.()
      if (keepOpen) reset()
      else onOpenChange(false)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>🏦 قيد افتتاحي (رصيد مُرحَّل)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-[11px] bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800 leading-relaxed">
            أدخل طرفاً واحداً فقط — النظام يوازن القيد تلقائياً على حساب <b>3103 تسوية الأرصدة الافتتاحية</b>.
            الأصول والخصوم وحقوق الملكية فقط (نتيجة السنة السابقة تُقفل في الأرباح المبقاة).
            الصندوق الواحد متعدد العملات: اختر نفس الصندوق وغيّر العملة لكل رصيد.
          </div>
          <Field label="الحساب / الصندوق / العميل / المورد *">
            <AccountAutocomplete type="all" value={entity?.id || null} onChange={setEntity} placeholder="ابحث بالاسم أو الكود..." allowQuickAdd={false} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="المبلغ *"><Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="طبيعة الرصيد *">
              <Select value={form.side} onValueChange={v => setForm({ ...form, side: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="debit">مدين</SelectItem><SelectItem value="credit">دائن</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="العملة *">
              <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="SAR">SAR ر.س</SelectItem><SelectItem value="USD">USD $</SelectItem><SelectItem value="YER">YER ﷼</SelectItem></SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="تاريخ الافتتاح *"><DocDateInput value={form.date} onChange={v => setForm({ ...form, date: v })} /></Field>
            <Field label="ملاحظة"><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="اختياري" /></Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => submit(true)} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700">{saving ? '...' : '💾 حفظ وإضافة رصيد آخر'}</Button>
            <Button onClick={() => submit(false)} disabled={saving} variant="outline" className="flex-1">حفظ وإغلاق</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// v3.87 — 3103 review + close: NEVER closes without showing a clear per-currency result first.
function OpeningEquityDialog({ open, onOpenChange, onChanged }) {
  const [status, setStatus] = useState(null)
  const [target, setTarget] = useState(COA_FE.RETAINED_EARNINGS)
  const [ccy, setCcy] = useState('ALL')
  const [date, setDate] = useState(todayISO())
  const [busy, setBusy] = useState(false)
  const loadStatus = () => api('/journal-entries/opening-equity-status').then(setStatus).catch(e => toast.error(e.message))
  useEffect(() => { if (open) loadStatus() }, [open])
  const doClose = async () => {
    const all = (status?.per_currency || []).filter(r => Math.abs(r.net_credit) >= 0.01)
    const nonZero = ccy === 'ALL' ? all : all.filter(r => r.currency === ccy)
    if (nonZero.length === 0) { toast.error(ccy === 'ALL' ? 'رصيد 3103 صفر في جميع العملات — لا يوجد ما يُقفل' : `رصيد 3103 بعملة ${ccy} صفر — لا يوجد ما يُقفل`); return }
    if (!(await askConfirm({ title: 'إقفال الأرصدة الافتتاحية', desc: `سيُنشأ قيد إقفال لكل عملة (${nonZero.map(r => `${r.currency}: ${Math.abs(r.net_credit).toLocaleString()}`).join(' • ')}) إلى ${target === COA_FE.CAPITAL ? 'رأس المال 3101' : 'الأرباح المبقاة 3102'}.`, confirmLabel: 'تأكيد الإقفال' }))) return
    setBusy(true)
    try {
      const r = await api('/journal-entries/opening-equity-close', { method: 'POST', body: { target, date, ...(ccy !== 'ALL' ? { currency: ccy } : {}) } })
      toast.success(`🔐 أُقفل حساب التسوية: ${r.closed.map(c => `${c.currency} ${c.amount.toLocaleString()}`).join(' • ')} → ${r.target.name}`)
      loadStatus(); onChanged?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>⚖️ حساب تسوية الأرصدة الافتتاحية (3103)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!status && <div className="text-center text-slate-400 py-6">جاري التحميل...</div>}
          {status && (
            <>
              <div className="text-[11px] text-slate-500">قيود افتتاحية مسجلة: <b>{status.opening_entries}</b></div>
              <Table>
                <TableHeader><TableRow><TableHead>العملة</TableHead><TableHead className="text-left">مدين</TableHead><TableHead className="text-left">دائن</TableHead><TableHead className="text-left">الصافي</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(status.per_currency || []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-400">لا حركات على 3103 بعد</TableCell></TableRow>}
                  {(status.per_currency || []).map(r => (
                    <TableRow key={r.currency}>
                      <TableCell className="font-bold">{r.currency}</TableCell>
                      <TableCell className="text-left">{r.debit.toLocaleString()}</TableCell>
                      <TableCell className="text-left">{r.credit.toLocaleString()}</TableCell>
                      <TableCell className={`text-left font-black ${Math.abs(r.net_credit) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {Math.abs(r.net_credit) < 0.01 ? '✓ متوازن' : `${Math.abs(r.net_credit).toLocaleString()} ${r.net_credit > 0 ? '(دائن)' : '(مدين)'}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t pt-3 space-y-2">
                <div className="text-xs font-bold text-slate-600">إقفال الرصيد إلى:</div>
                <div className="grid grid-cols-3 gap-2">
                  <Select value={target} onValueChange={setTarget}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={COA_FE.RETAINED_EARNINGS}>3102 — الأرباح المبقاة</SelectItem>
                      <SelectItem value={COA_FE.CAPITAL}>3101 — رأس المال</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={ccy} onValueChange={setCcy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">كل العملات</SelectItem>
                      <SelectItem value="SAR">SAR فقط</SelectItem>
                      <SelectItem value="USD">USD فقط</SelectItem>
                      <SelectItem value="YER">YER فقط</SelectItem>
                    </SelectContent>
                  </Select>
                  <DocDateInput value={date} onChange={setDate} />
                </div>
                <Button onClick={doClose} disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-700">{busy ? '...' : `🔐 إقفال الأرصدة الافتتاحية ${ccy === 'ALL' ? '(قيد لكل عملة)' : `(${ccy} فقط)`}`}</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function JournalScreen() {
  const { settings, tenant } = useAuth()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [openingOpen, setOpeningOpen] = useState(false)
  const [equityOpen, setEquityOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(null)
  const load = () => api('/journal-entries').then(setRows).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [])
  const selected = rows.find(je => je.id === selectedId)
  const isEditableJe = selected && (selected.ref_type === 'manual' || selected.ref_type === 'manual_dual')
  const isDeletableJe = selected && ['manual', 'manual_dual', 'opening', 'opening_close'].includes(selected.ref_type)
  const handleAdd = () => { setEditing(null); setOpen(true) }
  const handleEdit = () => {
    if (!selected) return toast.error('اختر قيداً أولاً')
    if (!isEditableJe) return toast.error(selected.ref_type === 'opening' ? 'القيد الافتتاحي لا يُعدَّل — احذفه وأعد إدخاله من زر "قيد افتتاحي"' : 'لا يمكن تعديل قيود المعاملات مباشرةً — عدّل السجل الأصلي (تذكرة/تأشيرة/سند...)')
    setEditing(selected); setOpen(true)
  }
  const handleDelete = async () => {
    if (!selected) return
    if (!isDeletableJe) return toast.error('لا يمكن حذف قيد معاملة مباشرةً — احذف السجل الأصلي')
    const isOpening = selected.ref_type === 'opening' || selected.ref_type === 'opening_close'
    if (!(await askConfirm({
      title: isOpening ? 'حذف قيد افتتاحي' : 'حذف القيد اليدوي',
      desc: isOpening
        ? 'سيُحذف القيد وتُعكس آثاره على أرصدة الأطراف. إن كان حساب التسوية 3103 قد أُقفل سابقاً فسيصبح غير متوازن ويلزم إعادة التسوية.'
        : 'سيتم حذف هذا القيد اليدوي من دفتر اليومية وعكس آثاره على الأرصدة.',
      variant: 'danger', confirmLabel: 'تأكيد الحذف',
    }))) return
    try {
      const r = await api(`/journal-entries/${selected.id}`, { method: 'DELETE' })
      if (r.warning) toast.warning(r.warning, { duration: 10000 })
      else toast.success('🗑️ تم حذف القيد وعكس آثاره')
      setSelectedId(null); load()
    } catch (e) { toast.error(e.message) }
  }
  const handlePrintTable = () => {
    // Flatten JE lines for printing
    const flat = []
    for (const je of rows) {
      for (const l of je.lines || []) {
        flat.push({
          date: je.date, description: je.description, ref_type: je.ref_type,
          account: `${l.account_code} — ${l.account_name}`,
          party: l.party_name || '—',
          currency: l.currency || je.currency,
          debit: l.debit || 0, credit: l.credit || 0,
        })
      }
    }
    const totals = flat.reduce((a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }), { debit: 0, credit: 0 })
    printTable({
      title: 'كشف قيود اليومية', settings, tenant, rows: flat,
      columns: [
        { key: 'date', label: 'التاريخ', render: r => fmtDate(r.date) },
        { key: 'ref_type', label: 'النوع' },
        { key: 'description', label: 'البيان' },
        { key: 'account', label: 'الحساب' },
        { key: 'party', label: 'الطرف' },
        { key: 'currency', label: 'العملة' },
        { key: 'debit', label: 'مدين', align: 'left', render: r => r.debit ? fmt(r.debit, r.currency) : '—' },
        { key: 'credit', label: 'دائن', align: 'left', render: r => r.credit ? fmt(r.credit, r.currency) : '—' },
      ],
      totals: { debit: totals.debit.toFixed(2), credit: totals.credit.toFixed(2) },
    })
  }
  return (
    <div className="space-y-4">
      <TopBar title="قيود اليومية" subtitle="جميع القيود المحاسبية التلقائية واليدوية"
        right={<div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setOpeningOpen(true)} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">🏦 قيد افتتاحي</Button>
          <Button size="sm" onClick={() => setEquityOpen(true)} variant="outline" className="gap-1 border-indigo-300 text-indigo-700 hover:bg-indigo-50">⚖️ إقفال الأرصدة الافتتاحية (3103)</Button>
        </div>} />
      <ActionToolbar
        addLabel="إضافة قيد يومي" onAdd={handleAdd} onRefresh={load}
        onEdit={handleEdit} onDelete={handleDelete} onPrintTable={handlePrintTable}
        selectedId={selectedId} count={rows.length}
      />
      <div className="space-y-3">
        {rows.map(je => {
          const totalDebit = (je.lines || []).reduce((s, l) => s + (l.debit || 0), 0)
          const isMulti = je.currency === 'MULTI'
          const isSelected = selectedId === je.id
          const editable = je.ref_type === 'manual' || je.ref_type === 'manual_dual'
          return (
            <Card key={je.id} className={`overflow-hidden cursor-pointer ${isSelected ? 'ring-2 ring-blue-500' : ''}`} onClick={() => setSelectedId(je.id === selectedId ? null : je.id)}>
              <CardHeader className="pb-2 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input type="radio" checked={isSelected} onChange={() => setSelectedId(je.id)} onClick={e => e.stopPropagation()} />
                    <div>
                      <div className="text-sm font-bold text-slate-800">{je.description}</div>
                      <div className="text-xs text-slate-500">{fmtDate(je.date)} • {JE_REF_LABEL[je.ref_type] || je.ref_type} • {isMulti ? 'متعدد العملات' : je.currency}{editable && <Badge variant="outline" className="mr-2 text-emerald-600 border-emerald-300">قابل للتعديل</Badge>}{(je.ref_type === 'opening' || je.ref_type === 'opening_close') && <Badge variant="outline" className="mr-2 text-amber-600 border-amber-300">{JE_REF_LABEL[je.ref_type]}</Badge>}</div>
                    </div>
                  </div>
                  {!isMulti && <Badge variant="secondary" className="text-sm font-bold">{fmt(totalDebit, je.currency)}</Badge>}
                  {isMulti && <Badge className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-100">قيد متعدد العملات</Badge>}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>الحساب</TableHead><TableHead>الطرف</TableHead>{isMulti && <TableHead>العملة</TableHead>}<TableHead className="text-left">مدين</TableHead><TableHead className="text-left">دائن</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(je.lines || []).map((l, i) => {
                      const cur = l.currency || je.currency
                      return (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{l.account_code} — {l.account_name}</TableCell>
                          <TableCell className="text-xs">{l.party_name}</TableCell>
                          {isMulti && <TableCell><Badge variant="outline">{cur}</Badge></TableCell>}
                          <TableCell className="text-left font-semibold text-blue-700">{l.debit ? fmt(l.debit, cur) : '—'}</TableCell>
                          <TableCell className="text-left font-semibold text-rose-700">{l.credit ? fmt(l.credit, cur) : '—'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        })}
        {rows.length === 0 && <div className="text-center text-slate-400 py-10">لا توجد قيود</div>}
      </div>
      <ManualJournalDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null) }} record={editing} onSaved={() => { load(); setEditing(null) }} />
      <OpeningJournalDialog open={openingOpen} onOpenChange={setOpeningOpen} onSaved={load} />
      <OpeningEquityDialog open={equityOpen} onOpenChange={setEquityOpen} onChanged={load} />
    </div>
  )
}

function ReportsScreen() {
  // v3.51 — RBAC Phase 3: account statements restricted to owner / fin_statements holders
  const { user: rsUser } = useAuth()
  const canStatements = rsUser?.role === 'owner' || rsUser?.permissions?.fin_statements === true
  return (
    <div className="space-y-6">
      <TopBar title="التقارير المالية" subtitle="الأرباح، كشوف الحسابات، ميزان المراجعة، قائمة الدخل، الإقفال السنوي" />
      <Tabs defaultValue="profits">
        <TabsList className="w-full justify-start bg-slate-100"><TabsTrigger value="profits">الأرباح</TabsTrigger>{canStatements && <TabsTrigger value="statement">كشف حساب</TabsTrigger>}<TabsTrigger value="trial">ميزان المراجعة</TabsTrigger><TabsTrigger value="income">قائمة الدخل</TabsTrigger><TabsTrigger value="year-close" className="text-rose-700 font-bold">🔒 الإقفال السنوي</TabsTrigger></TabsList>
        <TabsContent value="profits" className="mt-4"><ProfitsReport /></TabsContent>
        {canStatements && <TabsContent value="statement" className="mt-4"><StatementReport /></TabsContent>}
        <TabsContent value="trial" className="mt-4"><TrialBalanceReport /></TabsContent>
        <TabsContent value="income" className="mt-4"><IncomeStatement /></TabsContent>
        <TabsContent value="year-close" className="mt-4"><YearCloseScreen /></TabsContent>
      </Tabs>
    </div>
  )
}


// ================================================================
// v3.10.4 — QUERY CENTER (Custom Query & Statistics)
// Visas + Tickets filtered stats with export
// ================================================================
function QueryCenterScreen() {
  const { settings, tenant } = useAuth()
  const [filters, setFilters] = useState({ from: '', to: '', kind: 'all', service_type: '', ticket_type: '', client_id: '', supplier_id: '', payment_method: '', min_qty: '', search: '' })
  const [data, setData] = useState({ stats: {}, visas: [], tickets: [] })
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('visas')

  const runQuery = async () => {
    setLoading(true)
    try {
      const qs = Object.entries(filters).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      const res = await api(`/reports/query?${qs}`)
      setData(res)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { runQuery() }, [])

  const s = data.stats || {}
  const baseCcy = s.base_currency || 'USD'

  const exportExcel = () => {
    const rows = activeTab === 'visas' ? data.visas : data.tickets
    if (!rows || rows.length === 0) return toast.error('لا توجد بيانات للتصدير')
    const cols = activeTab === 'visas'
      ? ['date', 'service_type', 'beneficiary_name', 'phone', 'passport_no', 'nationality', 'client_name', 'supplier_name', 'currency', 'cost', 'sale_price', 'commission', 'payment_method']
      : ['date', 'ticket_type', 'passenger_name', 'phone', 'pnr', 'travel_date', 'route', 'client_name', 'supplier_name', 'currency', 'cost', 'sale_price', 'commission', 'payment_method']
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `query_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const printReport = () => {
    const rows = activeTab === 'visas' ? data.visas : data.tickets
    const cols = activeTab === 'visas'
      ? [{ key: 'date', label: 'التاريخ' }, { key: 'service_type', label: 'النوع' }, { key: 'beneficiary_name', label: 'المستفيد' }, { key: 'phone', label: 'الجوال' }, { key: 'client_name', label: 'العميل' }, { key: 'supplier_name', label: 'المورد' }, { key: 'sale_price', label: 'المبيع', align: 'left' }, { key: 'commission', label: 'العمولة', align: 'left' }]
      : [{ key: 'date', label: 'التاريخ' }, { key: 'passenger_name', label: 'المسافر' }, { key: 'pnr', label: 'PNR' }, { key: 'travel_date', label: 'تاريخ السفر' }, { key: 'client_name', label: 'العميل' }, { key: 'supplier_name', label: 'المورد' }, { key: 'sale_price', label: 'المبيع', align: 'left' }, { key: 'commission', label: 'العمولة', align: 'left' }]
    printTable({ title: `مركز الاستعلامات — ${activeTab === 'visas' ? 'التأشيرات' : 'التذاكر'}`, columns: cols, rows: rows || [], settings, tenant })
  }

  return (
    <div className="space-y-6">
      <TopBar title="📊 مركز الاستعلامات والإحصائيات" subtitle="بحث وفلترة متقدمة على التأشيرات والتذاكر مع تصدير النتائج"
        right={<div className="flex gap-2">
          <Button onClick={exportExcel} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" size="sm"><Download className="w-4 h-4" /> Excel</Button>
          <Button onClick={printReport} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" size="sm"><Printer className="w-4 h-4" /> طباعة</Button>
        </div>} />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center text-2xl">📄</div>
              <div>
                <div className="text-xs text-slate-500">إجمالي التأشيرات</div>
                <div className="text-3xl font-black text-emerald-700">{s.visas_count || 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-sky-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-sky-100 flex items-center justify-center text-2xl">✈️</div>
              <div>
                <div className="text-xs text-slate-500">إجمالي التذاكر</div>
                <div className="text-3xl font-black text-sky-700">{s.tickets_count || 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-indigo-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-indigo-100 flex items-center justify-center text-2xl">💰</div>
              <div>
                <div className="text-xs text-slate-500">إجمالي المبيعات ({baseCcy})</div>
                <div className="text-2xl font-black text-indigo-700">{Number(s.total_sales || 0).toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center text-2xl">💎</div>
              <div>
                <div className="text-xs text-slate-500">صافي العمولات ({baseCcy})</div>
                <div className="text-2xl font-black text-amber-700">{Number(s.total_commission || 0).toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Filter className="w-4 h-4" /> الفلاتر المتقدمة</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="من تاريخ"><Input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></Field>
            <Field label="إلى تاريخ"><Input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></Field>
            <Field label="النوع الرئيسي">
              <Select value={filters.kind} onValueChange={v => setFilters({ ...filters, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">📊 الكل</SelectItem>
                  <SelectItem value="visa">📄 التأشيرات فقط</SelectItem>
                  <SelectItem value="ticket">✈️ التذاكر فقط</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="طريقة الدفع">
              <Select value={filters.payment_method || 'all'} onValueChange={v => setFilters({ ...filters, payment_method: v === 'all' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="cash">💵 نقدي</SelectItem>
                  <SelectItem value="credit">📅 آجل</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="نوع التأشيرة (إن وُجد)">
              <Select value={filters.service_type || 'all'} onValueChange={v => setFilters({ ...filters, service_type: v === 'all' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {VISA_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="نوع التذكرة (إن وُجد)">
              <Select value={filters.ticket_type || 'all'} onValueChange={v => setFilters({ ...filters, ticket_type: v === 'all' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="ذهاب فقط">ذهاب فقط</SelectItem>
                  <SelectItem value="ذهاب وعودة">ذهاب وعودة</SelectItem>
                  <SelectItem value="متعدد الوجهات">متعدد الوجهات</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="الحد الأدنى للكمية"><Input type="number" min="0" value={filters.min_qty} onChange={e => setFilters({ ...filters, min_qty: e.target.value })} placeholder="0" /></Field>
            <Field label="بحث عام (اسم/جواز/PNR)"><Input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} placeholder="اكتب للبحث..." /></Field>
          </div>
          <div className="mt-3 flex justify-between items-center">
            <div className="text-xs text-slate-500">
              {loading ? 'جاري البحث...' : `${(data.visas?.length || 0) + (data.tickets?.length || 0)} سجل`}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFilters({ from: '', to: '', kind: 'all', service_type: '', ticket_type: '', client_id: '', supplier_id: '', payment_method: '', min_qty: '', search: '' })} size="sm">🧹 مسح</Button>
              <Button onClick={runQuery} className="bg-violet-600 hover:bg-violet-700 text-white" size="sm"><Search className="w-4 h-4 me-1" /> بحث</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs Results */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 border w-fit mb-4">
            <button onClick={() => setActiveTab('visas')} className={`px-4 py-1.5 rounded-md text-xs font-bold transition ${activeTab === 'visas' ? 'bg-white shadow border' : 'text-slate-500'}`}>📄 التأشيرات ({data.visas?.length || 0})</button>
            <button onClick={() => setActiveTab('tickets')} className={`px-4 py-1.5 rounded-md text-xs font-bold transition ${activeTab === 'tickets' ? 'bg-white shadow border' : 'text-slate-500'}`}>✈️ التذاكر ({data.tickets?.length || 0})</button>
          </div>

          {activeTab === 'visas' ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>المستفيد</TableHead><TableHead>الجواز</TableHead><TableHead>العميل</TableHead><TableHead>المورد</TableHead><TableHead className="text-left">التكلفة</TableHead><TableHead className="text-left">المبيع</TableHead><TableHead className="text-left">العمولة</TableHead><TableHead>الدفع</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(data.visas || []).map((v, i) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-xs text-slate-400">{i + 1}</TableCell>
                      <TableCell className="text-xs">{v.date}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{v.service_type}</Badge></TableCell>
                      <TableCell className="font-semibold">{v.beneficiary_name || v.passenger_name}</TableCell>
                      <TableCell className="text-xs font-mono">{v.passport_no || '—'}</TableCell>
                      <TableCell className="text-xs">{v.client_name || '—'}</TableCell>
                      <TableCell className="text-xs">{v.supplier_name}</TableCell>
                      <TableCell className="text-left text-xs">{fmt(v.cost, v.currency)}</TableCell>
                      <TableCell className="text-left text-xs font-bold text-emerald-700">{fmt(v.sale_price, v.currency)}</TableCell>
                      <TableCell className="text-left text-xs font-bold text-amber-700">{fmt(v.commission, v.currency)}</TableCell>
                      <TableCell><Badge className={v.payment_method === 'cash' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{v.payment_method === 'cash' ? 'نقد' : 'آجل'}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {(data.visas || []).length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-slate-400 py-6">لا توجد نتائج مطابقة</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>المسافر</TableHead><TableHead>PNR</TableHead><TableHead>تاريخ السفر</TableHead><TableHead>العميل</TableHead><TableHead>المورد</TableHead><TableHead className="text-left">التكلفة</TableHead><TableHead className="text-left">المبيع</TableHead><TableHead className="text-left">العمولة</TableHead><TableHead>الدفع</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(data.tickets || []).map((t, i) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs text-slate-400">{i + 1}</TableCell>
                      <TableCell className="text-xs">{t.date}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{t.ticket_type || '—'}</Badge></TableCell>
                      <TableCell className="font-semibold">{t.passenger_name}</TableCell>
                      <TableCell className="text-xs font-mono">{t.pnr || '—'}</TableCell>
                      <TableCell className="text-xs">{t.travel_date}</TableCell>
                      <TableCell className="text-xs">{t.client_name || '—'}</TableCell>
                      <TableCell className="text-xs">{t.supplier_name}</TableCell>
                      <TableCell className="text-left text-xs">{fmt(t.cost, t.currency)}</TableCell>
                      <TableCell className="text-left text-xs font-bold text-emerald-700">{fmt(t.sale_price, t.currency)}</TableCell>
                      <TableCell className="text-left text-xs font-bold text-amber-700">{fmt(t.commission, t.currency)}</TableCell>
                      <TableCell><Badge className={t.payment_method === 'cash' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{t.payment_method === 'cash' ? 'نقد' : 'آجل'}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {(data.tickets || []).length === 0 && <TableRow><TableCell colSpan={12} className="text-center text-slate-400 py-6">لا توجد نتائج مطابقة</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// v3.11 — VISA MONITORING CENTER (B2B Grid + WhatsApp alerts + 5-state tracker)
function VisaMonitorScreen() {
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState({})
  const [countries, setCountries] = useState([])
  const [filters, setFilters] = useState({ track: 'inside', agent: '', search: '' })
  const [loading, setLoading] = useState(false)
  const [dlgOpen, setDlgOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [countryDlgOpen, setCountryDlgOpen] = useState(false)
  const [exitRow, setExitRow] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const qs = Object.entries(filters).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      const [list, s, c] = await Promise.all([
        api(`/visa-monitor?${qs}`),
        api('/visa-monitor/stats'),
        api('/countries').catch(() => []),
      ])
      setRows(list || []); setStats(s || {}); setCountries(c || [])
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters.track])

  const del = async (row) => {
    if (!(await askConfirm({ title: 'حذف السجل نهائياً', desc: `حذف سجل ${row.traveler_name} نهائياً؟`, variant: 'danger', irreversible: true, confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/visa-monitor/${row.id}`, { method: 'DELETE' }); toast.success('حُذف'); load() } catch (e) { toast.error(e.message) }
  }
  const reactivate = async (row) => {
    if (!(await askConfirm({ title: 'إعادة تفعيل السجل', desc: 'سيتم إلغاء حالة المغادرة وإعادة تفعيل السجل.', icon: '↩️', confirmLabel: 'إعادة التفعيل' }))) return
    try { await api(`/visa-monitor/${row.id}`, { method: 'PATCH', body: { action: 'reactivate' } }); toast.success('✅ أُعيد التفعيل'); load() } catch (e) { toast.error(e.message) }
  }

  const EXPORT_HEADERS = (r, i) => ({
    'م': i + 1,
    'اسم المعتمر': r.traveler_name || '',
    'رقم الجواز': r.passport_no || '',
    'الجنسية': r.nationality || '',
    'اسم الوكيل': r.agent_name || '',
    'جوال الوكيل': r.agent_phone || '',
    'رقم التأشيرة': r.visa_no || '',
    'تاريخ إصدار التأشيرة': r.visa_issue_date || '',
    'المستضيف / رقم الإقامة': r.host_name || '',
    'تاريخ الدخول': r.entry_date || '',
    'منفذ الدخول': r.entry_port || '',
    'مدة الإقامة (يوم)': r.allowed_days || '',
    'تاريخ الانتهاء المتوقع': r.expected_exit_date || '',
    'الأيام المتبقية': r.remaining_days ?? '',
    'تاريخ المغادرة الفعلي': r.actual_exit_date || '',
    'منفذ المغادرة': r.exit_port || '',
    'الحالة': (MON_TRACK[r.track_status] || {}).label || '',
    'ملاحظات': r.notes || ''
  })

  const exportExcel = () => {
    if (rows.length === 0) return toast.error('لا توجد سجلات للتصدير')
    const ws = XLSX.utils.json_to_sheet(rows.map((r, i) => EXPORT_HEADERS(r, i)))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'مراقبة التأشيرات')
    XLSX.writeFile(wb, `visa-monitoring-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success('📥 تم تنزيل ملف Excel')
  }

  const printPDF = () => {
    if (rows.length === 0) return toast.error('لا توجد سجلات للطباعة')
    const heads = Object.keys(EXPORT_HEADERS(rows[0] || {}, 0))
    const body = rows.map((r, i) => `<tr class="tr-${r.track_status}">${Object.values(EXPORT_HEADERS(r, i)).map(v => `<td>${String(v ?? '')}</td>`).join('')}</tr>`).join('')
    const w = window.open('', '_blank')
    if (!w) return toast.error('فضلاً اسمح بالنوافذ المنبثقة للطباعة')
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير مراقبة التأشيرات</title>
      <style>
        body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:16px;color:#0f172a}
        h1{font-size:18px;margin:0 0 4px} .sub{font-size:11px;color:#64748b;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;font-size:9.5px}
        th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:right}
        th{background:#f1f5f9;font-weight:700}
        .tr-yellow td{background:#fefce8}.tr-red td{background:#fef2f2}.tr-overstay td{background:#e2e8f0}.tr-departed td{color:#94a3b8}
        @media print{@page{size:A4 landscape;margin:8mm}}
      </style></head><body>
      <h1>🛃 تقرير مراقبة التأشيرات</h1>
      <div class="sub">تاريخ التقرير: ${new Date().toLocaleDateString('ar-EG')} — عدد السجلات: ${rows.length}</div>
      <table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
      </body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400)
  }

  const remainCell = (r) => {
    if (r.track_status === 'departed') return <span className="text-slate-400">—</span>
    if (r.remaining_days === null) return <span className="text-slate-400">—</span>
    if (r.remaining_days < 0) return <span className="font-black text-white bg-slate-900 px-2 py-0.5 rounded">متجاوز {Math.abs(r.remaining_days)} يوم</span>
    return <span className={`font-black ${r.remaining_days <= 15 ? 'text-red-700' : r.remaining_days <= 30 ? 'text-yellow-700' : 'text-emerald-700'}`}>{r.remaining_days} يوم</span>
  }

  return (
    <div className="space-y-6">
      <TopBar title="🛃 مركز مراقبة التأشيرات" subtitle="جدول المراقبة الحية B2B — عدّاد آلي وتنبيهات واتساب حسب الحالة"
        right={<div className="flex gap-2 flex-wrap">
          <Button onClick={() => setCountryDlgOpen(true)} variant="outline" size="sm">🌍 إعدادات الدول</Button>
          <Button onClick={exportExcel} variant="outline" size="sm">📤 تصدير Excel</Button>
          <Button onClick={printPDF} variant="outline" size="sm">🖨️ طباعة PDF</Button>
          <Button onClick={() => setImportOpen(true)} variant="outline" size="sm">📥 استيراد Excel</Button>
          <Button onClick={() => { setEditing(null); setDlgOpen(true) }} className="grad-brand text-white" size="sm"><Plus className="w-4 h-4 me-1" /> إضافة معتمر</Button>
        </div>} />

      {/* Stats Cards — new 5-state tracking */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/40 cursor-pointer hover:shadow-md" onClick={() => setFilters(f => ({ ...f, track: 'green' }))}>
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">🟢 في المهلة</div>
            <div className="text-3xl font-black text-emerald-700">{stats.green || 0}</div>
            <div className="text-[10px] text-slate-500">أكثر من 30 يوم متبقية</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500 bg-yellow-50/40 cursor-pointer hover:shadow-md" onClick={() => setFilters(f => ({ ...f, track: 'yellow' }))}>
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">🟡 قريب من الانتهاء</div>
            <div className="text-3xl font-black text-yellow-700">{stats.yellow || 0}</div>
            <div className="text-[10px] text-slate-500">30 يوم أو أقل</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500 bg-red-50/40 cursor-pointer hover:shadow-md" onClick={() => setFilters(f => ({ ...f, track: 'red' }))}>
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">🔴 متأخر — خطر</div>
            <div className="text-3xl font-black text-red-700">{stats.red || 0}</div>
            <div className="text-[10px] text-slate-500">15 يوم أو أقل</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-slate-900 bg-slate-100 cursor-pointer hover:shadow-md" onClick={() => setFilters(f => ({ ...f, track: 'overstay' }))}>
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">⚫ مخالف Overstay</div>
            <div className="text-3xl font-black text-slate-900">{stats.overstay || 0}</div>
            <div className="text-[10px] text-red-600 font-bold">تجاوز المدة — غرامات!</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-slate-400 bg-slate-50 cursor-pointer hover:shadow-md" onClick={() => setFilters(f => ({ ...f, track: 'departed' }))}>
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">⚪ غادر</div>
            <div className="text-3xl font-black text-slate-500">{stats.departed || 0}</div>
            <div className="text-[10px] text-slate-500">تم تسجيل مغادرتهم</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="الحالة">
              <Select value={filters.track} onValueChange={v => setFilters({ ...filters, track: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inside">🏠 داخل المملكة (الكل عدا المغادرين)</SelectItem>
                  <SelectItem value="alerts">🚨 تنبيهات فقط (أصفر + أحمر + مخالف)</SelectItem>
                  <SelectItem value="green">🟢 في المهلة</SelectItem>
                  <SelectItem value="yellow">🟡 قريب من الانتهاء</SelectItem>
                  <SelectItem value="red">🔴 متأخر — خطر</SelectItem>
                  <SelectItem value="overstay">⚫ مخالف Overstay</SelectItem>
                  <SelectItem value="departed">⚪ غادر</SelectItem>
                  <SelectItem value="all">📋 الكل</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="اسم الوكيل / المكتب"><Input value={filters.agent} onChange={e => setFilters({ ...filters, agent: e.target.value })} onKeyDown={e => e.key === 'Enter' && load()} placeholder="فلترة حسب الوكيل..." /></Field>
            <Field label="بحث (اسم / جواز / رقم تأشيرة)"><Input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} onKeyDown={e => e.key === 'Enter' && load()} placeholder="اكتب للبحث..." /></Field>
            <Field label=" ">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setFilters({ track: 'inside', agent: '', search: '' })} size="sm" className="flex-1">🧹 مسح</Button>
                <Button onClick={load} className="grad-brand text-white flex-1" size="sm"><Search className="w-4 h-4 me-1" /> تطبيق</Button>
              </div>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Monitoring Grid — 16 approved columns */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-slate-50">
                <TableHead className="text-[11px]">م</TableHead>
                <TableHead className="text-[11px] min-w-[130px]">اسم المعتمر</TableHead>
                <TableHead className="text-[11px]">رقم الجواز</TableHead>
                <TableHead className="text-[11px]">الجنسية</TableHead>
                <TableHead className="text-[11px] min-w-[120px]">الوكيل / المكتب</TableHead>
                <TableHead className="text-[11px]">رقم التأشيرة</TableHead>
                <TableHead className="text-[11px]">تاريخ الإصدار</TableHead>
                <TableHead className="text-[11px]">المستضيف / الإقامة</TableHead>
                <TableHead className="text-[11px]">تاريخ الدخول</TableHead>
                <TableHead className="text-[11px]">منفذ الدخول</TableHead>
                <TableHead className="text-[11px] text-center">المدة</TableHead>
                <TableHead className="text-[11px]">الانتهاء المتوقع</TableHead>
                <TableHead className="text-[11px] text-center">الأيام المتبقية</TableHead>
                <TableHead className="text-[11px]">المغادرة الفعلية</TableHead>
                <TableHead className="text-[11px]">منفذ المغادرة</TableHead>
                <TableHead className="text-[11px] text-center">الحالة</TableHead>
                <TableHead className="text-[11px] text-center">واتساب / إجراءات</TableHead>
                <TableHead className="text-[11px]">ملاحظات</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={18} className="text-center py-6"><Loader2 className="w-6 h-6 animate-spin inline" /></TableCell></TableRow>}
                {!loading && rows.length === 0 && <TableRow><TableCell colSpan={18} className="text-center text-slate-400 py-6">لا توجد سجلات مطابقة</TableCell></TableRow>}
                {!loading && rows.map((r, i) => {
                  const meta = MON_TRACK[r.track_status] || MON_TRACK.green
                  return (
                    <TableRow key={r.id} className={meta.row}>
                      <TableCell className="text-xs text-slate-400">{i + 1}</TableCell>
                      <TableCell className="font-semibold text-xs">{r.traveler_name}</TableCell>
                      <TableCell className="text-xs font-mono font-bold">{r.passport_no}</TableCell>
                      <TableCell className="text-xs">{r.nationality || '—'}</TableCell>
                      <TableCell className="text-xs">{r.agent_name || '—'}<div className="text-[10px] text-slate-500 font-mono" dir="ltr">{r.agent_phone || ''}</div></TableCell>
                      <TableCell className="text-xs font-mono">{r.visa_no || '—'}</TableCell>
                      <TableCell className="text-xs">{r.visa_issue_date || '—'}</TableCell>
                      <TableCell className="text-xs">{r.host_name || '—'}</TableCell>
                      <TableCell className="text-xs font-semibold">{r.entry_date || '—'}</TableCell>
                      <TableCell className="text-xs">{r.entry_port || '—'}</TableCell>
                      <TableCell className="text-xs text-center font-bold">{r.allowed_days || '—'}</TableCell>
                      <TableCell className="text-xs font-semibold">{r.expected_exit_date || '—'}</TableCell>
                      <TableCell className="text-center text-xs">{remainCell(r)}</TableCell>
                      <TableCell className="text-xs">{r.actual_exit_date || '—'}</TableCell>
                      <TableCell className="text-xs">{r.exit_port || '—'}</TableCell>
                      <TableCell className="text-center"><Badge className={`${meta.badge} border text-[10px] whitespace-nowrap`}>{meta.icon} {meta.label}</Badge></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-center">
                          {['yellow', 'red', 'overstay'].includes(r.track_status) && (
                            <WaBtn phone={r.agent_phone} message={monWaMessage(r)} size="xs" label="إشعار" iconOnly={false} />
                          )}
                          {r.track_status !== 'departed'
                            ? <Button size="sm" variant="outline" onClick={() => setExitRow(r)} className="h-7 px-2 text-[10px] bg-emerald-50 hover:bg-emerald-100 border-emerald-300" title="تسجيل المغادرة">🛫 غادر</Button>
                            : <Button size="sm" variant="outline" onClick={() => reactivate(r)} className="h-7 px-2 text-[10px]" title="إعادة تفعيل">🔄</Button>}
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setDlgOpen(true) }} className="h-7 w-7 p-0"><Pencil className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => del(r)} className="h-7 w-7 p-0 text-rose-600"><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-[10px] text-slate-500 max-w-[140px] truncate" title={r.notes}>{r.notes || '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <VisaMonitorDialog open={dlgOpen} onOpenChange={setDlgOpen} record={editing} countries={countries} onSaved={load} />
      <VisaMonitorImportDialog open={importOpen} onOpenChange={setImportOpen} countries={countries} onDone={load} />
      <CountriesSettingsDialog open={countryDlgOpen} onOpenChange={setCountryDlgOpen} onChanged={load} />
      <MonitorExitDialog row={exitRow} onOpenChange={() => setExitRow(null)} onSaved={load} />
    </div>
  )
}

// v3.11 — Track status meta (5 states)
const MON_TRACK = {
  green: { label: 'في المهلة', icon: '🟢', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', row: '' },
  yellow: { label: 'قريب من الانتهاء', icon: '🟡', badge: 'bg-yellow-100 text-yellow-800 border-yellow-300', row: 'bg-yellow-50/70 border-r-4 border-yellow-400' },
  red: { label: 'متأخر — خطر', icon: '🔴', badge: 'bg-red-100 text-red-800 border-red-300', row: 'bg-red-50/70 border-r-4 border-red-500' },
  overstay: { label: 'مخالف Overstay', icon: '⚫', badge: 'bg-slate-900 text-white border-slate-900', row: 'bg-red-100/60 border-r-4 border-slate-900' },
  departed: { label: 'غادر', icon: '⚪', badge: 'bg-slate-200 text-slate-600 border-slate-300', row: 'opacity-60' },
}

// v3.11 — WhatsApp message templates per status (tone escalates)
function monWaMessage(r) {
  const name = r.traveler_name || '', pass = r.passport_no || '', exp = r.expected_exit_date || '', rem = r.remaining_days
  if (r.track_status === 'overstay') {
    return `🚨 مخالفة إقامة — عاجل جداً:\nالمعتمر ${name} (جواز ${pass}) تجاوز مدة الإقامة المسموحة منذ ${Math.abs(rem)} يوم (انتهت بتاريخ ${exp}).\nمكتبكم يتحمل كافة الغرامات والتبعات القانونية المترتبة. يجب التواصل والترتيب لمغادرته فوراً دون أي تأخير.`
  }
  if (r.track_status === 'red') {
    return `⚠️ عاجل وهام:\nالمعتمر ${name} (جواز ${pass}) متبقي له ${rem} يوماً فقط على انتهاء فترة إقامته (تنتهي بتاريخ ${exp}).\nيجب خروج المعتمر فوراً وإلا سيتحمل مكتبكم كافة الغرامات والتبعات القانونية. يجب متابعة المعتمر فوراً.`
  }
  return `عزيزنا الوكيل ${r.agent_name || ''}،\nنود تذكيركم بأن المعتمر ${name} (جواز ${pass}) متبقي له ${rem} يوماً على انتهاء فترة إقامته (تنتهي بتاريخ ${exp}).\nنرجو الترتيب لمغادرته في الوقت المحدد. شاكرين حسن تعاونكم 🌹`
}

// v3.11 — Exit registration dialog (actual exit date + port)
function MonitorExitDialog({ row, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ actual_exit_date: new Date().toISOString().slice(0, 10), exit_port: '' })
  useEffect(() => { if (row) setForm({ actual_exit_date: new Date().toISOString().slice(0, 10), exit_port: row.exit_port || '' }) }, [row])
  const submit = async () => {
    if (!form.actual_exit_date) return toast.error('تاريخ المغادرة مطلوب')
    try {
      await api(`/visa-monitor/${row.id}`, { method: 'PATCH', body: { action: 'exited', ...form } })
      toast.success('🛫 تم تسجيل المغادرة — الحالة الآن: ⚪ غادر')
      onOpenChange(); onSaved()
    } catch (e) { toast.error(e.message) }
  }
  return (
    <Dialog open={!!row} onOpenChange={v => { if (!v) onOpenChange() }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>🛫 تسجيل مغادرة: {row?.traveler_name}</DialogTitle>
          <DialogDescription>سيتحول السجل تلقائياً إلى حالة ⚪ غادر ويختفي من التنبيهات</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ المغادرة الفعلي" required><Input type="date" value={form.actual_exit_date} onChange={e => setForm({ ...form, actual_exit_date: e.target.value })} /></Field>
          <Field label="منفذ المغادرة"><Input value={form.exit_port} onChange={e => setForm({ ...form, exit_port: e.target.value })} placeholder="مطار جدة / منفذ الوديعة..." /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onOpenChange}>إلغاء</Button><Button onClick={submit} className="bg-emerald-600 hover:bg-emerald-700 text-white">✅ تأكيد المغادرة</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v3.11 — Add/Edit Monitor Record Dialog (B2B mandatory fields + auto 85 days)
function VisaMonitorDialog({ open, onOpenChange, record, countries, onSaved }) {
  const EMPTY = { traveler_name: '', passport_no: '', nationality: '', agent_name: '', agent_phone: '', phone: '', visa_no: '', visa_issue_date: new Date().toISOString().slice(0, 10), host_name: '', entry_date: new Date().toISOString().slice(0, 10), entry_port: '', allowed_days: 85, actual_exit_date: '', exit_port: '', visa_type: 'تأشيرة عمرة', notes: '' }
  const [form, setForm] = useState(EMPTY)
  useEffect(() => {
    if (record) setForm({ ...EMPTY, ...record, allowed_days: record.allowed_days || 85, actual_exit_date: record.actual_exit_date || '' })
    else setForm(EMPTY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, open])
  // Live computed expected exit date
  const expectedExit = (() => {
    if (!form.entry_date || !Number(form.allowed_days)) return '—'
    const d = new Date(form.entry_date); d.setDate(d.getDate() + Number(form.allowed_days))
    return d.toISOString().slice(0, 10)
  })()
  const submit = async () => {
    if (!form.traveler_name?.trim()) return toast.error('اسم المعتمر مطلوب')
    if (!form.passport_no?.trim()) return toast.error('رقم الجواز مطلوب')
    if (!form.agent_name?.trim()) return toast.error('اسم الوكيل مطلوب')
    if (!form.agent_phone?.trim()) return toast.error('رقم جوال الوكيل (واتساب) مطلوب')
    if (!form.visa_no?.trim()) return toast.error('رقم التأشيرة مطلوب')
    if (!form.visa_issue_date) return toast.error('تاريخ إصدار التأشيرة مطلوب')
    if (!form.entry_date) return toast.error('تاريخ الدخول مطلوب')
    try {
      const body = { ...form, allowed_days: Number(form.allowed_days) || 85, actual_exit_date: form.actual_exit_date || null }
      if (record?.id) await api(`/visa-monitor/${record.id}`, { method: 'PATCH', body })
      else await api('/visa-monitor', { method: 'POST', body })
      toast.success('✅ تم الحفظ'); onOpenChange(false); onSaved()
    } catch (e) { toast.error(e.message) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><span className="text-2xl">🛃</span>{record ? 'تعديل سجل مراقبة' : 'إضافة معتمر للمراقبة'}</DialogTitle>
          <DialogDescription>الحقول المعلّمة بـ * إجبارية — مدة الإقامة الافتراضية 85 يوم وقابلة للتعديل</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="text-xs font-bold text-slate-500 border-b pb-1">👤 بيانات المعتمر</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="اسم المعتمر" required><Input value={form.traveler_name} onChange={e => setForm({ ...form, traveler_name: e.target.value })} /></Field>
            <Field label="رقم الجواز" required><Input value={form.passport_no} onChange={e => setForm({ ...form, passport_no: e.target.value.toUpperCase() })} placeholder="A1234567" className="font-mono" /></Field>
            <Field label="الجنسية"><Input value={form.nationality} onChange={e => setForm({ ...form, nationality: e.target.value })} placeholder="يمني / مصري..." /></Field>
          </div>
          <div className="text-xs font-bold text-slate-500 border-b pb-1">🏢 الوكيل (B2B)</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="اسم الوكيل / المكتب" required><Input value={form.agent_name} onChange={e => setForm({ ...form, agent_name: e.target.value })} placeholder="كتابة حرة — اسم المكتب الوكيل" /></Field>
            <Field label="جوال الوكيل (واتساب)" required><Input dir="ltr" value={form.agent_phone} onChange={e => setForm({ ...form, agent_phone: e.target.value })} placeholder="9677XXXXXXXX" className="font-mono" /></Field>
            <Field label="جوال المعتمر (اختياري)"><Input dir="ltr" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="font-mono" /></Field>
          </div>
          <div className="text-xs font-bold text-slate-500 border-b pb-1">🛂 التأشيرة والمستضيف</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="رقم التأشيرة" required><Input value={form.visa_no} onChange={e => setForm({ ...form, visa_no: e.target.value })} className="font-mono" /></Field>
            <Field label="تاريخ إصدار التأشيرة" required><DocDateInput value={form.visa_issue_date} onChange={v => setForm({ ...form, visa_issue_date: v })} /></Field>
            <Field label="نوع التأشيرة">
              <Select value={form.visa_type} onValueChange={v => setForm({ ...form, visa_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VISA_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="col-span-3"><Field label="اسم المستضيف / رقم الإقامة"><Input value={form.host_name} onChange={e => setForm({ ...form, host_name: e.target.value })} /></Field></div>
          </div>
          <div className="text-xs font-bold text-slate-500 border-b pb-1">🛬 الحركة والمراقبة</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="تاريخ الدخول" required><Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} /></Field>
            <Field label="منفذ الدخول"><Input value={form.entry_port} onChange={e => setForm({ ...form, entry_port: e.target.value })} placeholder="منفذ الوديعة / مطار جدة..." /></Field>
            <Field label="مدة الإقامة المسموحة (يوم)" required><Input type="number" min="1" value={form.allowed_days} onChange={e => setForm({ ...form, allowed_days: e.target.value })} className="font-bold text-lg" /></Field>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm flex items-center gap-2">
            📅 <b>تاريخ المغادرة المتوقع (يُحسب آلياً):</b> <span className="font-mono font-black text-blue-700">{expectedExit}</span>
            <span className="text-[11px] text-slate-500">= تاريخ الدخول + {form.allowed_days || 0} يوم</span>
          </div>
          {record && (
            <>
              <div className="text-xs font-bold text-slate-500 border-b pb-1">🛫 المغادرة (عند الخروج)</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="تاريخ المغادرة الفعلي"><Input type="date" value={form.actual_exit_date || ''} onChange={e => setForm({ ...form, actual_exit_date: e.target.value })} /></Field>
                <Field label="منفذ المغادرة"><Input value={form.exit_port} onChange={e => setForm({ ...form, exit_port: e.target.value })} /></Field>
              </div>
            </>
          )}
          <Field label="ملاحظات"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button onClick={submit} className="grad-brand text-white">✅ حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v3.11 — Excel Import Dialog (B2B columns) with template download
function VisaMonitorImportDialog({ open, onOpenChange, countries, onDone }) {
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState([])
  const [uploading, setUploading] = useState(false)
  const TPL_HEADERS = ['اسم المعتمر', 'رقم الجواز', 'الجنسية', 'اسم الوكيل', 'جوال الوكيل', 'رقم التأشيرة', 'تاريخ إصدار التأشيرة', 'اسم المستضيف / رقم الإقامة', 'تاريخ الدخول', 'منفذ الدخول', 'مدة الإقامة (يوم)', 'تاريخ المغادرة الفعلي', 'منفذ المغادرة', 'ملاحظات']
  const downloadTemplate = () => {
    const example = { 'اسم المعتمر': 'محمد أحمد علي', 'رقم الجواز': 'A1234567', 'الجنسية': 'يمني', 'اسم الوكيل': 'مكتب النور للعمرة', 'جوال الوكيل': '967781455584', 'رقم التأشيرة': 'V998877', 'تاريخ إصدار التأشيرة': '2026-08-01', 'اسم المستضيف / رقم الإقامة': 'شركة الرحاب - 2233445566', 'تاريخ الدخول': '2026-08-10', 'منفذ الدخول': 'منفذ الوديعة', 'مدة الإقامة (يوم)': 85, 'تاريخ المغادرة الفعلي': '', 'منفذ المغادرة': '', 'ملاحظات': '' }
    const ws = XLSX.utils.json_to_sheet([example], { header: TPL_HEADERS })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'قالب المراقبة')
    XLSX.writeFile(wb, 'visa-monitoring-template.xlsx')
    toast.success('📥 تم تنزيل القالب — عبّئه ثم ارفعه هنا')
  }
  const parseExcel = async (f) => {
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const parsed = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const fmtDate = (v) => { if (!v) return ''; if (v instanceof Date) return v.toISOString().slice(0, 10); return String(v).slice(0, 10) }
      const mapped = parsed.map(row => {
        // Exact template header first, then fuzzy fallback
        const findVal = (exact, fuzzy = []) => {
          for (const key in row) { if (String(key).trim() === exact) return row[key] }
          for (const fz of fuzzy) { for (const key in row) { if (String(key).toLowerCase().includes(fz.toLowerCase())) return row[key] } }
          return ''
        }
        return {
          traveler_name: findVal('اسم المعتمر', ['معتمر', 'traveler', 'passenger', 'name', 'اسم']),
          passport_no: String(findVal('رقم الجواز', ['جواز', 'passport'])).toUpperCase().trim(),
          nationality: findVal('الجنسية', ['nationality', 'جنسية']),
          agent_name: findVal('اسم الوكيل', ['وكيل', 'agent']),
          agent_phone: String(findVal('جوال الوكيل', ['جوال الوكيل', 'رقم الوكيل', 'agent_phone', 'agent phone', 'whatsapp', 'واتساب'])).trim(),
          visa_no: String(findVal('رقم التأشيرة', ['visa_no', 'visa no', 'visa number'])).trim(),
          visa_issue_date: fmtDate(findVal('تاريخ إصدار التأشيرة', ['إصدار', 'issue'])),
          host_name: findVal('اسم المستضيف / رقم الإقامة', ['مستضيف', 'host']),
          entry_date: fmtDate(findVal('تاريخ الدخول', ['entry date', 'entry_date'])),
          entry_port: findVal('منفذ الدخول', ['entry port', 'entry_port']),
          allowed_days: Number(findVal('مدة الإقامة (يوم)', ['مدة الإقامة', 'allowed', 'duration'])) || 85,
          actual_exit_date: fmtDate(findVal('تاريخ المغادرة الفعلي', ['actual exit', 'خرج فعلياً'])),
          exit_port: findVal('منفذ المغادرة', ['exit port', 'exit_port']),
          notes: findVal('ملاحظات', ['note', 'ملاحظ'])
        }
      }).filter(r => r.passport_no && r.traveler_name)
      setRows(mapped)
      toast.success(`تم قراءة ${mapped.length} سجل`)
    } catch (e) { toast.error('فشل قراءة الملف: ' + e.message) }
  }
  const submit = async () => {
    if (rows.length === 0) return toast.error('لا توجد بيانات صالحة')
    // Client-side validation of mandatory columns
    const invalid = rows.filter(r => !r.agent_name || !r.agent_phone || !r.visa_no || !r.visa_issue_date || !r.entry_date)
    if (invalid.length > 0 && !(await askConfirm({ title: 'سجلات ناقصة', desc: `${invalid.length} سجل ينقصه حقول إجبارية (وكيل/جوال/تأشيرة/تواريخ) وسيتم تجاهله عند الإدراج الجديد.`, icon: '⚠️', confirmLabel: 'متابعة' }))) return
    setUploading(true)
    try {
      const res = await api('/visa-monitor/import', { method: 'POST', body: { rows } })
      toast.success(`✅ تم: ${res.inserted} إضافة، ${res.updated} تحديث، ${res.skipped} متجاهل`)
      if (res.skip_reasons?.length) console.warn('Import skips:', res.skip_reasons)
      onOpenChange(false); setFile(null); setRows([]); onDone()
    } catch (e) { toast.error(e.message) } finally { setUploading(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><span className="text-2xl">📥</span>استيراد سجلات المراقبة من Excel</DialogTitle>
          <DialogDescription>تحديث تلقائي للسجلات الموجودة (Upsert برقم الجواز) — بنفس أعمدة الشاشة المعتمدة</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Button variant="outline" onClick={downloadTemplate} className="w-full border-dashed border-2 border-blue-300 text-blue-700 hover:bg-blue-50">📄 تنزيل قالب Excel الجاهز (بالأعمدة المعتمدة)</Button>
          <Field label="اختر ملف Excel">
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); parseExcel(f) } }} />
          </Field>
          {rows.length > 0 && (
            <div className="text-xs bg-slate-50 p-3 rounded border">
              <div className="font-bold mb-2">معاينة ({rows.length} سجل):</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {rows.slice(0, 5).map((r, i) => <div key={i} className="font-mono text-[10px]">{r.passport_no} · {r.traveler_name} · وكيل: {r.agent_name || '؟'} ({r.agent_phone || 'بدون جوال!'}) · دخول {r.entry_date} · {r.allowed_days} يوم</div>)}
                {rows.length > 5 && <div className="text-slate-500">... و {rows.length - 5} آخرين</div>}
              </div>
            </div>
          )}
          <div className="text-[11px] text-blue-700 bg-blue-50 p-2 rounded border border-blue-200">
            💡 الأعمدة الإجبارية: <b>اسم المعتمر · رقم الجواز · اسم الوكيل · جوال الوكيل · رقم التأشيرة · تاريخ الإصدار · تاريخ الدخول</b> — مدة الإقامة الافتراضية 85 يوم إن تُركت فارغة
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button onClick={submit} disabled={rows.length === 0 || uploading} className="grad-brand text-white">{uploading ? 'جاري الاستيراد...' : '📤 استيراد'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v3.10.5 — Countries Settings Dialog
function CountriesSettingsDialog({ open, onOpenChange, onChanged }) {
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null)
  useEffect(() => { if (open) api('/countries').then(setRows).catch(() => {}) }, [open])
  const updateRule = async (country, visaType, hasFines) => {
    const cfg = { ...(country.fines_config || {}) }
    cfg[visaType] = { has_fines: hasFines }
    await api(`/countries/${country.id}`, { method: 'PATCH', body: { fines_config: cfg } })
    toast.success('تم التحديث')
    api('/countries').then(setRows); onChanged && onChanged()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader><DialogTitle>🌍 إعدادات الدول والغرامات</DialogTitle>
          <DialogDescription>عدّل تصنيف الغرامات لكل دولة + نوع تأشيرة (has_fines)</DialogDescription></DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {rows.map(c => (
            <Card key={c.id} className="border">
              <CardContent className="p-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl">{c.flag}</span>
                  <div className="flex-1">
                    <div className="font-bold text-lg">{c.name_ar}</div>
                    <div className="text-xs text-slate-500 font-mono">{c.code}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {['default', ...VISA_TYPES].map(vt => {
                    const rule = (c.fines_config || {})[vt]
                    const hasFines = rule?.has_fines ?? false
                    return (
                      <label key={vt} className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs cursor-pointer ${hasFines ? 'bg-red-50 border-red-300' : 'bg-emerald-50 border-emerald-300'}`}>
                        <span>{vt === 'default' ? '⚙️ الافتراضي' : vt}</span>
                        <input type="checkbox" checked={hasFines} onChange={e => updateRule(c, vt, e.target.checked)} className="w-4 h-4" />
                      </label>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <DialogFooter><Button onClick={() => onOpenChange(false)} className="grad-brand text-white">إغلاق</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// v3.9.14 — Year-End Financial Closing Engine UI
function YearCloseScreen() {
  const { user, tenant } = useAuth()
  const [years, setYears] = useState([])
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(null) // { year, revenue, expense, netProfit }
  const [previewData, setPreviewData] = useState(null)
  const load = async () => {
    try {
      setLoading(true)
      const y = await api('/accounting/closable-years')
      setYears(y || [])
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const previewYear = async (year) => {
    try {
      const income = await api(`/reports/income-statement?year=${year}`)
      setPreviewData({ year, ...income })
      setClosing({ year })
    } catch (e) { toast.error(e.message) }
  }
  const confirmClose = async () => {
    if (!closing?.year) return
    if (!(await askConfirm({ title: `إقفال السنة المالية ${closing.year}`, desc: `سيتم:\n• إنشاء قيد إقفال تلقائي بتاريخ 31/12/${closing.year}\n• تصفير أرصدة الإيرادات والمصروفات\n• ترحيل صافي الربح/الخسارة إلى حساب 3900 (الأرباح المُدوّرة)\n• قفل السنة — لن تُقبل أي إضافة أو تعديل بتاريخها`, icon: '🔒', variant: 'danger', irreversible: true, confirmLabel: 'إقفال السنة' }))) return
    try {
      setLoading(true)
      const r = await api('/accounting/close-year', { method: 'POST', body: { year: closing.year } })
      toast.success(`✅ تم إقفال السنة ${r.year} — صافي ${r.net_profit >= 0 ? 'ربح' : 'خسارة'}: ${r.net_profit.toFixed(2)}`)
      setClosing(null); setPreviewData(null)
      await load()
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  if (loading) return <Card><CardContent className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></CardContent></Card>
  return (
    <div className="space-y-4">
      <Card className="border-2 border-rose-200 bg-gradient-to-l from-rose-50 to-orange-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="text-3xl">🔒</div>
            <div>
              <div className="font-extrabold text-lg text-rose-800">آلية الإقفال السنوي</div>
              <div className="text-sm text-slate-700 mt-1">
                يُنشئ قيد إقفال تلقائي في نهاية السنة (31/12) يُصفّر الإيرادات والمصروفات، ويُرحّل صافي الربح/الخسارة إلى حساب <b>3900 — الأرباح المُدوّرة</b>. بعد الإقفال يمنع النظام أي تعديل بتاريخ السنة المقفلة.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5 text-blue-600" /> السنوات المالية</CardTitle></CardHeader>
        <CardContent>
          {years.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">لا توجد قيود بعد — ابدأ بإضافة معاملات ثم عُد لإقفالها في نهاية السنة</div>}
          <div className="space-y-2">
            {years.map(y => (
              <div key={y.year} className={`flex items-center justify-between p-3 rounded-lg border-2 ${y.is_closed ? 'bg-slate-100 border-slate-300' : 'bg-white border-emerald-200 hover:border-emerald-400'}`}>
                <div className="flex items-center gap-3">
                  <div className={`text-2xl font-black ${y.is_closed ? 'text-slate-500' : 'text-emerald-700'}`}>{y.year}</div>
                  <div className="text-xs text-slate-600">
                    <div>📊 {y.entries} قيد يومية</div>
                    {y.is_closed ? <Badge className="bg-slate-600 text-white mt-1">🔒 مُقفلة</Badge> : <Badge className="bg-emerald-100 text-emerald-800 mt-1">🟢 مفتوحة</Badge>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!y.is_closed && user?.role === 'owner' && (
                    <Button onClick={() => previewYear(y.year)} className="bg-rose-600 hover:bg-rose-700 text-white gap-2 font-bold">🔒 إقفال السنة {y.year}</Button>
                  )}
                  {y.is_closed && user?.role === 'super_admin' && (
                    <Button variant="outline" onClick={async () => {
                      if (!(await askConfirm({ title: `فتح السنة ${y.year} المقفلة`, desc: 'سيتم حذف قيد الإقفال. (صلاحية سوبر أدمن)', icon: '🔓', variant: 'danger', confirmLabel: 'فتح السنة' }))) return
                      try { await api('/accounting/reopen-year', { method: 'POST', body: { year: y.year } }); toast.success('تم فتح السنة'); load() } catch (e) { toast.error(e.message) }
                    }} className="text-xs">🔓 فتح</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Preview + confirmation dialog */}
      <Dialog open={!!closing && !!previewData} onOpenChange={v => !v && (setClosing(null), setPreviewData(null))}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">🔒 معاينة إقفال السنة {closing?.year}</DialogTitle>
            <DialogDescription>راجع الأرقام قبل تأكيد الإقفال. لا يمكن التراجع إلا بصلاحية السوبر أدمن.</DialogDescription>
          </DialogHeader>
          {previewData && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="text-xs text-slate-600">إجمالي الإيرادات (بالعملة الأساسية)</div>
                  <div className="text-lg font-extrabold text-emerald-700">{Number(previewData.total_revenue_base || previewData.total_revenue || 0).toFixed(2)}</div>
                </div>
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200">
                  <div className="text-xs text-slate-600">إجمالي المصروفات</div>
                  <div className="text-lg font-extrabold text-rose-700">{Number(previewData.total_expenses_base || previewData.total_expense || 0).toFixed(2)}</div>
                </div>
              </div>
              <div className={`p-4 rounded-lg border-2 ${(previewData.net_profit_base || previewData.net_profit || 0) >= 0 ? 'bg-blue-50 border-blue-300' : 'bg-orange-50 border-orange-300'}`}>
                <div className="text-xs text-slate-600 mb-1">صافي {(previewData.net_profit_base || previewData.net_profit || 0) >= 0 ? 'الربح' : 'الخسارة'} — يُرحّل إلى 3102 الأرباح المبقاة (COA v2)</div>
                <div className={`text-2xl font-black ${(previewData.net_profit_base || previewData.net_profit || 0) >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{Number(previewData.net_profit_base || previewData.net_profit || 0).toFixed(2)}</div>
              </div>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">⚠️ بعد الإقفال، لن يمكن إضافة أو تعديل قيود بتاريخ {closing?.year} إلا بصلاحية استثنائية.</div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => { setClosing(null); setPreviewData(null) }} className="flex-1">إلغاء</Button>
                <Button onClick={confirmClose} disabled={loading} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white gap-2">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '🔒'} تأكيد الإقفال</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DateRange({ from, setFrom, to, setTo }) {
  return <div className="flex items-end gap-2 mb-4"><Field label="من"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="إلى"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></div>
}

function ProfitsReport() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(todayISO()); const [data, setData] = useState(null)
  const load = async () => { try { setData(await api(`/reports/profits?from=${from}&to=${to}`)) } catch (e) { toast.error(e.message) } }
  useEffect(() => { load() }, [from, to])
  return (
    <Card><CardContent className="p-4">
      <DateRange from={from} setFrom={setFrom} to={to} setTo={setTo} />
      {data && (<>
        <div className="grid grid-cols-3 gap-3 mb-4">{CURRENCIES.map(c => (<Card key={c}><CardContent className="p-3"><div className="text-xs text-slate-500">إجمالي الأرباح — {c}</div><div className="text-lg font-extrabold text-emerald-600">{fmt(data.totals_profit[c], c)}</div><div className="text-xs text-slate-500 mt-1">مبيعات: {fmt(data.totals_sales[c], c)}</div></CardContent></Card>))}</div>
        <Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>مرجع</TableHead><TableHead>حساب القبض</TableHead><TableHead>المورد</TableHead><TableHead>عملة</TableHead><TableHead className="text-left">تكلفة</TableHead><TableHead className="text-left">بيع</TableHead><TableHead className="text-left">ربح</TableHead></TableRow></TableHeader>
          <TableBody>{data.rows.map(r => (<TableRow key={r.id}><TableCell className="text-xs">{fmtDate(r.date)}</TableCell><TableCell><Badge variant="outline">{r.kind}</Badge></TableCell><TableCell className="font-mono text-xs">{r.ref || '—'}</TableCell><TableCell>{r.client}</TableCell><TableCell>{r.supplier}</TableCell><TableCell>{r.currency}</TableCell><TableCell className="text-left">{fmt(r.cost, r.currency)}</TableCell><TableCell className="text-left">{fmt(r.sale, r.currency)}</TableCell><TableCell className="text-left font-bold text-emerald-600">{fmt(r.profit, r.currency)}</TableCell></TableRow>))}</TableBody>
        </Table>
      </>)}
    </CardContent></Card>
  )
}

function StatementReport() {
  const { tenant, settings } = useAuth()
  const [bulkOpen, setBulkOpen] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [id, setId] = useState('')
  const [data, setData] = useState(null)
  const [q, setQ] = useState('')
  const [currencyMode, setCurrencyMode] = useState('all_detail')
  const [period, setPeriod] = useState('all')
  const [day, setDay] = useState(todayISO())
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(todayISO())
  useEffect(() => { api('/accounts/all').then(setAccounts).catch(() => {}) }, [])
  const selected = accounts.find(a => a.id === id)
  const list = accounts.filter(x => !q || x.name.includes(q) || (x.code || '').includes(q))
  const load = async () => {
    if (!selected) return
    const p = new URLSearchParams({ party_type: selected.kind, party_id: selected.id, currency_mode: currencyMode, period })
    if (period === 'day') p.set('day', day)
    if (period === 'month') p.set('month', month)
    if (period === 'range' || period === 'up_to_date') { p.set('from', from); p.set('to', to) }
    try { setData(await api(`/reports/statement?${p}`)) } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [id, currencyMode, period, day, month, from, to])

  // v3.3 — Human-readable period text
  const periodLabel = () => {
    if (period === 'all') return 'كل الفترات (منذ البداية)'
    if (period === 'day') return `يوم ${fmtDate(day)}`
    if (period === 'month') return `شهر ${month}`
    if (period === 'range') return `من ${fmtDate(from)} إلى ${fmtDate(to)}`
    if (period === 'up_to_date') return `حتى ${fmtDate(to)}`
    return ''
  }

  // v3.3 — Print a professional statement of account
  const handlePrint = () => {
    if (!data || !data.party) return toast.error('اختر حساباً وحمّل الكشف أولاً')
    const p = data.party
    const rowsHtml = (data.rows || []).map(r => `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td style="font-size:11px;">${escHtml(r.description)}</td>
        <td><span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:10px;">${escHtml(JE_REF_LABEL[r.ref_type] || r.ref_type || '')}</span></td>
        <td><b>${r.currency}</b></td>
        <td style="text-align:left; color:#1e40af; font-weight:600;">${r.debit ? fmt(r.debit, r.currency) : '—'}</td>
        <td style="text-align:left; color:#b91c1c; font-weight:600;">${r.credit ? fmt(r.credit, r.currency) : '—'}</td>
        <td style="text-align:left; font-weight:800; color:${r.balance >= 0 ? '#059669' : '#dc2626'};">${fmt(r.balance, r.currency)}</td>
      </tr>
    `).join('')
    const summaryHtml = (data.summary && data.summary.length > 0) ? data.summary.map(s => `
      <tr>
        <td><b>${s.currency}</b></td>
        <td style="text-align:left; color:#1e40af;">${fmt(s.total_debit, s.currency)}</td>
        <td style="text-align:left; color:#b91c1c;">${fmt(s.total_credit, s.currency)}</td>
        <td style="text-align:left; font-weight:900; color:${s.balance >= 0 ? '#059669' : '#dc2626'}; font-size:14px;">${fmt(s.balance, s.currency)}</td>
      </tr>
    `).join('') : CURRENCIES.map(c => {
      const bal = p.balances?.[c] || 0
      return `<tr><td><b>${c}</b></td><td>—</td><td>—</td><td style="text-align:left; font-weight:900; color:${bal >= 0 ? '#059669' : '#dc2626'};">${fmt(bal, c)}</td></tr>`
    }).join('')

    const off = tenant?.name || 'مكتب رحّال'
    const offPhone = tenant?.phone || settings?.phone || ''
    const offAddr = settings?.address || ''
    const partyPhone = p.phone || ''
    const partyAddr = p.address || ''

    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف حساب — ${escHtml(p.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Tahoma','Segoe UI',sans-serif; background:#f8fafc; margin:0; padding:24px; color:#0f172a; }
  .doc { max-width: 820px; margin: 0 auto; background:#fff; border-radius:14px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); padding:0; overflow:hidden; }
  .hdr { background: linear-gradient(135deg,#1e3a8a 0%,#3b82f6 60%,#f97316 100%); color:#fff; padding:22px 28px; display:flex; justify-content:space-between; align-items:center; }
  .hdr h1 { margin:0; font-size:22px; font-weight:900; letter-spacing:0.5px; }
  .hdr .off { text-align:left; }
  .hdr .off .n { font-size:16px; font-weight:800; }
  .hdr .off .p { font-size:12px; opacity:0.92; margin-top:2px; }
  .band { background: #eff6ff; border-bottom:2px solid #dbeafe; padding:14px 28px; display:flex; justify-content:space-between; align-items:center; font-size:12px; }
  .band .k { color:#475569; }
  .band .v { color:#0f172a; font-weight:800; }
  .party { padding:18px 28px; background:#fff; border-bottom:1px solid #e2e8f0; }
  .party h2 { margin:0 0 6px 0; font-size:18px; color:#1e3a8a; }
  .party .meta { display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:#475569; margin-top:6px; }
  .party .meta span { padding:4px 10px; background:#f1f5f9; border-radius:8px; }
  .sec { padding:14px 28px; }
  .sec h3 { margin:0 0 10px 0; font-size:14px; color:#1e3a8a; border-right:4px solid #f97316; padding-right:8px; }
  table { width:100%; border-collapse: collapse; font-size:12px; }
  thead th { background:#1e3a8a; color:#fff; padding:8px 6px; text-align:right; font-weight:700; font-size:11px; }
  tbody td { padding:6px 6px; border-bottom:1px solid #e2e8f0; }
  tbody tr:nth-child(even) { background:#fafafa; }
  .totals { margin-top:10px; }
  .totals table thead th { background:#1e40af; }
  .totals table tbody td { padding:10px 8px; font-size:13px; background:#f8fafc; border-bottom:2px solid #e2e8f0; }
  .foot { padding:16px 28px 24px; background:#f8fafc; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:end; font-size:11px; color:#64748b; }
  .sig { text-align:center; }
  .sig .l { border-top: 1px dashed #94a3b8; padding-top:4px; width:180px; margin-top:24px; }
  .actions { text-align:center; margin-top: 16px; padding-bottom:10px; }
  .actions button { border:none; padding: 10px 18px; margin: 0 4px; border-radius:8px; font-weight:800; cursor:pointer; font-size:12px; }
  .actions .prn { background:#1e3a8a; color:#fff; }
  .actions .cls { background:#e2e8f0; color:#475569; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; border-radius:0; } .actions { display:none; } }
</style>
</head><body>
<div class="doc">
  <div class="hdr">
    <h1>📊 كشف حساب</h1>
    <div class="off"><div class="n">${escHtml(off)}</div><div class="p">${escHtml(offPhone)}${offAddr ? ' • ' + escHtml(offAddr) : ''}</div></div>
  </div>
  <div class="band">
    <div><span class="k">الفترة:</span> <span class="v">${escHtml(periodLabel())}</span></div>
    <div><span class="k">تاريخ الطباعة:</span> <span class="v">${fmtDate(new Date())}</span></div>
    <div><span class="k">عدد الحركات:</span> <span class="v">${(data.rows || []).length}</span></div>
  </div>
  <div class="party">
    <h2>${escHtml(p.name)}</h2>
    <div class="meta">
      ${partyPhone ? `<span>📞 ${escHtml(partyPhone)}</span>` : ''}
      ${partyAddr ? `<span>📍 ${escHtml(partyAddr)}</span>` : ''}
      <span>نوع الحساب: <b>${escHtml({client:'عميل', supplier:'مورد', box:'صندوق/بنك', account:'حساب دفتري'}[selected?.kind] || '—')}</b></span>
    </div>
  </div>
  <div class="sec">
    <h3>💼 ملخص الأرصدة النهائية بحسب العملة</h3>
    <div class="totals">
      <table>
        <thead><tr><th>العملة</th><th style="text-align:left;">إجمالي مدين</th><th style="text-align:left;">إجمالي دائن</th><th style="text-align:left;">الرصيد النهائي</th></tr></thead>
        <tbody>${summaryHtml}</tbody>
      </table>
    </div>
  </div>
  <div class="sec">
    <h3>📋 تفصيل الحركات (الرصيد التراكمي بجانب كل حركة)</h3>
    <table>
      <thead><tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>العملة</th><th style="text-align:left;">مدين</th><th style="text-align:left;">دائن</th><th style="text-align:left;">الرصيد التراكمي</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:20px;">لا توجد حركات في هذه الفترة</td></tr>'}</tbody>
    </table>
  </div>
  <div class="foot">
    <div>
      <div>هذا الكشف صادر إلكترونياً من نظام رحّال — Rahaal ERP</div>
      <div style="margin-top:2px;">يعتمد الرصيد النهائي على القيود المحاسبية المرحّلة حتى تاريخ الطباعة.</div>
    </div>
    <div class="sig">توقيع المحاسب <div class="l"></div></div>
  </div>
</div>
<div class="actions">
  <button class="prn" onclick="window.print()">🖨️ طباعة</button>
  <button class="cls" onclick="window.close()">إغلاق</button>
</div>
</body></html>`
    const w = window.open('', '_blank', 'width=900,height=1000')
    if (!w) return toast.error('السماح بالنوافذ المنبثقة مطلوب للطباعة')
    w.document.open(); w.document.write(html); w.document.close(); w.focus()
    setTimeout(() => { try { w.print() } catch(e){} }, 400)
  }

  // v3.3 — Share statement summary via WhatsApp (formatted text)
  const handleWhatsAppShare = () => {
    if (!data || !data.party) return toast.error('اختر حساباً وحمّل الكشف أولاً')
    const p = data.party
    if (!p.phone && !p.whatsapp) return toast.error('العميل لا يمتلك رقم هاتف مسجل — أضف الرقم أولاً في شاشة العملاء')
    const off = tenant?.name || 'مكتب رحّال'
    const balances = (data.summary && data.summary.length > 0)
      ? data.summary.map(s => `• ${s.currency}: ${fmt(s.balance, s.currency)} ${s.balance >= 0 ? '(لكم)' : '(علينا)'}`).join('\n')
      : CURRENCIES.map(c => { const b = p.balances?.[c] || 0; return b !== 0 ? `• ${c}: ${fmt(b, c)} ${b >= 0 ? '(لكم)' : '(علينا)'}` : null }).filter(Boolean).join('\n') || '• لا توجد أرصدة'
    const lastRows = (data.rows || []).slice(-5).reverse()
    const lastText = lastRows.length > 0
      ? '\n\n📋 آخر ' + Math.min(5, lastRows.length) + ' حركات:\n' + lastRows.map(r => {
          const dc = r.debit > 0 ? `مدين ${fmt(r.debit, r.currency)}` : `دائن ${fmt(r.credit, r.currency)}`
          return `• ${fmtDate(r.date)} — ${r.description?.slice(0,40) || ''} (${dc})`
        }).join('\n')
      : ''
    const msg = `عزيزنا العميل ${p.name}،\n\n📊 هذا ملخص كشف حسابكم لدى ${off}\n📅 الفترة: ${periodLabel()}\n\n💰 الأرصدة الحالية:\n${balances}${lastText}\n\n📞 للاستفسار عن أي حركة تواصل معنا مباشرة.\nشكراً لثقتكم بنا 🌹`
    openWhatsApp(p.whatsapp || p.phone, msg)
  }

  return (
    <Card><CardContent className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2 p-2 bg-gradient-to-l from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg">
        <span className="text-sm font-bold text-emerald-800">📢 v3.5 جديد:</span>
        <span className="text-xs text-slate-600">أرسل ملخص كشف الحساب لجميع العملاء ذوي الأرصدة بضغطة واحدة</span>
        <Button size="sm" onClick={() => setBulkOpen(true)} className="mr-auto bg-[#25D366] hover:bg-[#128C7E] text-white gap-1 h-8">
          <span>📤</span> إرسال جماعي عبر واتساب
        </Button>
      </div>
      <BulkStatementDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg">
        <Field label="بحث بالاسم / الرمز"><Input value={q} onChange={e => setQ(e.target.value)} placeholder="اكتب اسم أو رمز الحساب..." /></Field>
        <div className="md:col-span-2">
          <Field label="اختر الحساب (كافة أنواع الحسابات)">
            <Select value={id} onValueChange={setId}>
              <SelectTrigger><SelectValue placeholder={`— اختر من ${accounts.length} حساب —`} /></SelectTrigger>
              <SelectContent>
                {list.map(x => (
                  <SelectItem key={`${x.kind}-${x.id}`} value={x.id}>
                    <span className="inline-flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{x.group}</Badge>
                      <span className="font-mono text-xs text-slate-500">{x.code}</span>
                      <span>{x.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-xs font-bold text-slate-600 mb-2">عرض العملات</div>
          <div className="flex flex-wrap gap-1">
            {[{v:'all_summary',l:'كافة العملات (إجمالي)'},{v:'all_detail',l:'كافة العملات (تفصيلي)'},{v:'YER',l:'ريال يمني'},{v:'SAR',l:'ريال سعودي'},{v:'USD',l:'دولار'}].map(o => (
              <button key={o.v} onClick={() => setCurrencyMode(o.v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${currencyMode === o.v ? 'bg-blue-500 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}>{o.l}</button>
            ))}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs font-bold text-slate-600 mb-2">النطاق الزمني</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {[{v:'all',l:'كل الفترات'},{v:'up_to_date',l:'حتى تاريخ'},{v:'day',l:'خلال يوم'},{v:'month',l:'خلال شهر'},{v:'range',l:'من — إلى'}].map(o => (
              <button key={o.v} onClick={() => setPeriod(o.v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${period === o.v ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'}`}>{o.l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {period === 'day' && <Input type="date" value={day} onChange={e => setDay(e.target.value)} />}
            {period === 'month' && <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />}
            {period === 'range' && <><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></>}
            {period === 'up_to_date' && <Input type="date" value={to} onChange={e => setTo(e.target.value)} />}
          </div>
        </CardContent></Card>
      </div>

      {data?.party && (
        <div className="p-3 rounded-lg bg-gradient-to-l from-blue-50 to-slate-50 border border-blue-100">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-lg font-bold text-slate-800">{data.party.name}</div>
              {data.party.phone && <div className="text-xs text-slate-500" dir="ltr">📞 {data.party.phone}</div>}
              {data.party.address && <div className="text-xs text-slate-500">📍 {data.party.address}</div>}
            </div>
            <div className="flex gap-2">
              {CURRENCIES.map(c => (
                <div key={c} className="text-center px-3 py-1.5 rounded-lg bg-white border">
                  <div className="text-[10px] text-slate-500">{c}</div>
                  <div className={`text-sm font-bold ${(data.party.balances?.[c] || 0) > 0 ? 'text-emerald-600' : (data.party.balances?.[c] || 0) < 0 ? 'text-rose-600' : 'text-slate-400'}`}>{fmt(data.party.balances?.[c] || 0, c)}</div>
                </div>
              ))}
            </div>
          </div>
          {/* v3.3 — Print + WhatsApp Share buttons */}
          <div className="flex gap-2 mt-3 pt-3 border-t border-blue-200">
            <Button onClick={handlePrint} className="grad-brand text-white gap-2 h-9">
              <Printer className="w-4 h-4" /> طباعة كشف الحساب
            </Button>
            {(selected?.kind === 'client' || selected?.kind === 'supplier') && (
              <WaBtn phone={data.party.whatsapp || data.party.phone} message={''} size="md" label="مشاركة الكشف عبر واتساب" />
            )}
            {(selected?.kind === 'client' || selected?.kind === 'supplier') && (
              <Button onClick={handleWhatsAppShare} className="bg-[#25D366] hover:bg-[#128C7E] text-white gap-2 h-9" title="إرسال ملخص كشف الحساب">
                📊 ملخص الرصيد + آخر 5 حركات
              </Button>
            )}
          </div>
        </div>
      )}

      {data && data.currency_mode === 'all_summary' && (
        <div>
          <div className="text-sm font-bold text-slate-700 mb-2">إجمالي كل العملات في الفترة المحددة</div>
          <Table>
            <TableHeader><TableRow><TableHead>العملة</TableHead><TableHead className="text-left">إجمالي مدين</TableHead><TableHead className="text-left">إجمالي دائن</TableHead><TableHead className="text-left">الرصيد</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data.summary || []).map(s => (
                <TableRow key={s.currency}>
                  <TableCell><Badge variant="outline" className="font-bold">{s.currency}</Badge></TableCell>
                  <TableCell className="text-left text-blue-700 font-bold">{fmt(s.total_debit, s.currency)}</TableCell>
                  <TableCell className="text-left text-rose-700 font-bold">{fmt(s.total_credit, s.currency)}</TableCell>
                  <TableCell className={`text-left font-extrabold ${s.balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(s.balance, s.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.currency_mode !== 'all_summary' && (
        <Table>
          <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>البيان</TableHead><TableHead>مرجع</TableHead><TableHead>عملة</TableHead><TableHead className="text-left">مدين</TableHead><TableHead className="text-left">دائن</TableHead><TableHead className="text-left">الرصيد</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data.rows || []).map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{fmtDate(r.date)}</TableCell>
                <TableCell className="text-xs">{r.description}</TableCell>
                <TableCell className="text-xs"><Badge variant="outline">{JE_REF_LABEL[r.ref_type] || r.ref_type}</Badge></TableCell>
                <TableCell><Badge variant="secondary">{r.currency}</Badge></TableCell>
                <TableCell className="text-left text-blue-700">{r.debit ? fmt(r.debit, r.currency) : '—'}</TableCell>
                <TableCell className="text-left text-rose-700">{r.credit ? fmt(r.credit, r.currency) : '—'}</TableCell>
                <TableCell className={`text-left font-bold ${r.balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.balance, r.currency)}</TableCell>
              </TableRow>
            ))}
            {(!data.rows || data.rows.length === 0) && <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-6">لا توجد حركات في هذا النطاق</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
    </CardContent></Card>
  )
}

function TrialBalanceReport() {
  const [data, setData] = useState(null)
  useEffect(() => { api('/reports/trial-balance').then(setData).catch(e => toast.error(e.message)) }, [])
  return (
    <Card><CardContent className="p-4">
      {data && (<>
        <div className="grid grid-cols-3 gap-3 mb-4">{CURRENCIES.map(c => (<Card key={c}><CardContent className="p-3"><div className="text-xs text-slate-500">{c}</div><div className="flex justify-between text-sm mt-1"><span>مدين:</span><span className="font-bold text-blue-700">{fmt(data.totals[c].d, c)}</span></div><div className="flex justify-between text-sm"><span>دائن:</span><span className="font-bold text-rose-700">{fmt(data.totals[c].c, c)}</span></div><div className="flex justify-between text-sm mt-1 pt-1 border-t"><span>الفرق:</span><span className={`font-bold ${Math.abs(data.totals[c].d - data.totals[c].c) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>{fmt(data.totals[c].d - data.totals[c].c, c)}</span></div></CardContent></Card>))}</div>
        <Table><TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الحساب</TableHead><TableHead>الطرف</TableHead><TableHead>عملة</TableHead><TableHead className="text-left">مدين</TableHead><TableHead className="text-left">دائن</TableHead><TableHead className="text-left">الرصيد</TableHead></TableRow></TableHeader>
          <TableBody>{data.rows.map((r, i) => (<TableRow key={i}><TableCell className="font-mono text-xs">{r.code}</TableCell><TableCell>{r.name}</TableCell><TableCell className="text-xs">{r.party_name || '—'}</TableCell><TableCell>{r.currency}</TableCell><TableCell className="text-left text-blue-700">{fmt(r.debit, r.currency)}</TableCell><TableCell className="text-left text-rose-700">{fmt(r.credit, r.currency)}</TableCell><TableCell className={`text-left font-bold ${r.balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.balance, r.currency)}</TableCell></TableRow>))}</TableBody>
        </Table>
      </>)}
    </CardContent></Card>
  )
}

function IncomeStatement() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(todayISO()); const [data, setData] = useState(null)
  const load = async () => { try { setData(await api(`/reports/income-statement?from=${from}&to=${to}`)) } catch (e) { toast.error(e.message) } }
  useEffect(() => { load() }, [from, to])
  return (
    <Card><CardContent className="p-4">
      <DateRange from={from} setFrom={setFrom} to={to} setTo={setTo} />
      {data && (
        <div className="space-y-4">
          <div><div className="text-sm font-bold text-slate-700 mb-2">الإيرادات</div>
            <div className="grid grid-cols-3 gap-2">{['tickets', 'visas', 'other'].map(k => (<Card key={k}><CardContent className="p-3"><div className="text-xs text-slate-500">{k === 'tickets' ? 'عمولات تذاكر' : k === 'visas' ? 'عمولات تأشيرات' : 'أخرى'}</div>{CURRENCIES.map(c => <div key={c} className="text-xs flex justify-between"><span>{c}</span><span className="font-bold text-emerald-600">{fmt(data.revenue[k][c], c)}</span></div>)}</CardContent></Card>))}</div>
          </div>
          {(data.fx_gain_base ?? data.fx_gain_usd) !== undefined && (
            <Card className={`border-2 ${(data.fx_gain_base ?? data.fx_gain_usd) >= 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50'}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div><div className="text-sm font-bold text-slate-700">{(data.fx_gain_base ?? data.fx_gain_usd) >= 0 ? 'أرباح' : 'خسائر'} فروق العملات (المصارفة) — حساب 4104</div><div className="text-xs text-slate-500">بالريال اليمني</div></div>
                <div className={`text-2xl font-extrabold ${(data.fx_gain_base ?? data.fx_gain_usd) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(data.fx_gain_base ?? data.fx_gain_usd, 'YER')}</div>
              </CardContent>
            </Card>
          )}
          <div><div className="text-sm font-bold text-slate-700 mb-2">المصروفات</div>
            <Card><CardContent className="p-3">{CURRENCIES.map(c => <div key={c} className="text-sm flex justify-between"><span>{c}</span><span className="font-bold text-rose-600">{fmt(data.expenses[c], c)}</span></div>)}</CardContent></Card>
          </div>
          <Card className="grad-brand text-white"><CardContent className="p-4"><div className="text-xs opacity-80">صافي الربح (بالريال اليمني - العملة الأساسية)</div><div className="text-3xl font-extrabold">{fmt(data.net_profit_base ?? data.net_profit_usd, 'YER')}</div><div className="text-xs opacity-80 mt-2 grid grid-cols-2 gap-2"><div>إيرادات: {fmt(data.total_revenue_base ?? data.total_revenue_usd, 'YER')}</div><div>مصروفات: {fmt(data.total_expenses_base ?? data.total_expenses_usd, 'YER')}</div></div></CardContent></Card>
        </div>
      )}
    </CardContent></Card>
  )
}

// ================================================================
// OFFICE SETTINGS (White-Labeling)
// ================================================================
// v3.8 — Chrome Extension management tab (Personal Access Tokens + download)
function ExtensionTab() {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newToken, setNewToken] = useState(null)
  const [creating, setCreating] = useState(false)
  const publicBase = typeof window !== 'undefined' ? window.location.origin : ''
  const load = () => api('/pats').then(setTokens).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  const createToken = async () => {
    try {
      setCreating(true)
      const r = await api('/pats', { method: 'POST', body: { name: newName || 'إضافة المتصفح' } })
      setNewToken(r); setNewName(''); load()
    } catch (e) { toast.error(e.message) } finally { setCreating(false) }
  }
  const revokeToken = async (id) => {
    if (!(await askConfirm({ title: 'إلغاء الرمز نهائياً', desc: 'الإضافة المرتبطة به لن تعمل بعد ذلك.', variant: 'danger', irreversible: true, confirmLabel: 'إلغاء الرمز' }))) return
    try { await api(`/pats/${id}`, { method: 'DELETE' }); toast.success('تم الإلغاء'); load() }
    catch (e) { toast.error(e.message) }
  }
  const copy = (text) => { navigator.clipboard.writeText(text); toast.success('📋 تم النسخ') }
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-0 shadow-md bg-gradient-to-l from-indigo-600 via-blue-600 to-cyan-600 text-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-white/15 flex items-center justify-center text-3xl">🕋</div>
              <div>
                <div className="text-xs uppercase tracking-wider opacity-90">Rahaal Scraper Extension</div>
                <div className="text-lg font-extrabold">قارئ رحّال الآلي للمتصفح</div>
                <div className="text-xs opacity-90 mt-1">يسحب بيانات التذاكر والتأشيرات تلقائياً من صفحات شركات الطيران والتأشيرات إلى نظام رحّال ERP بضغطة زر واحدة.</div>
              </div>
            </div>
            <a href="/rahal-extension.zip" download className="bg-white text-blue-700 hover:bg-blue-50 font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 shrink-0">
              <Upload className="w-4 h-4 rotate-180" /> تحميل الإضافة (.zip)
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Key className="w-4 h-4" /> رموز الوصول (Personal Access Tokens)</CardTitle>
            <CardDescription className="mt-1">أنشئ رمزاً واحداً لكل جهاز/مستعرض تستخدم عليه الإضافة. الحد الأقصى: 5 رموز نشطة.</CardDescription>
          </div>
          <Button onClick={() => { setShowNew(true); setNewToken(null); setNewName('') }} className="grad-brand text-white gap-2 shrink-0"><Plus className="w-4 h-4" /> إنشاء رمز جديد</Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">لا توجد رموز — اضغط "إنشاء رمز جديد" للبدء</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>البادئة</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                  <TableHead>آخر استخدام</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-semibold">{t.name}</TableCell>
                    <TableCell dir="ltr" className="font-mono text-xs">{t.prefix}…</TableCell>
                    <TableCell className="text-xs text-slate-500">{fmtDate(t.created_at)}</TableCell>
                    <TableCell className="text-xs text-slate-500">{t.last_used_at ? fmtDate(t.last_used_at) : '—'}</TableCell>
                    <TableCell>
                      {t.revoked_at ? (
                        <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">ملغى</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">نشط</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-left">
                      {!t.revoked_at && (
                        <Button size="sm" variant="outline" onClick={() => revokeToken(t.id)} className="text-rose-600 border-rose-200 hover:bg-rose-50"><Trash2 className="w-3 h-3" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">📖 دليل التثبيت السريع</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal pr-5 space-y-2 text-slate-700 leading-7">
            <li>حمّل الإضافة من الزر أعلاه <b>(rahal-extension.zip)</b> وفك الضغط في مجلد ثابت مثل <code className="bg-slate-100 px-1 rounded" dir="ltr">~/rahal-extension/</code>.</li>
            <li>افتح Chrome واذهب إلى <code className="bg-slate-100 px-1 rounded" dir="ltr">chrome://extensions/</code> ثم فعّل <b>Developer mode</b> أعلى اليمين.</li>
            <li>اضغط <b>Load unpacked</b> واختر المجلد المفكوك — ستظهر أيقونة الإضافة 🕋 في شريط الأدوات.</li>
            <li>هنا في رحّال: اضغط <b>"إنشاء رمز جديد"</b> أعلاه، انسخ الـ Token فوراً (لن يظهر مرة أخرى).</li>
            <li>افتح الإضافة والصق:
              <ul className="list-disc pr-5 mt-1 text-slate-600">
                <li>عنوان الخادم: <code className="bg-slate-100 px-1 rounded" dir="ltr">{publicBase}</code> <button onClick={() => copy(publicBase)} className="text-blue-600 text-xs mr-1">نسخ</button></li>
                <li>الرمز الشخصي: <code className="bg-slate-100 px-1 rounded" dir="ltr">rhl_pat_...</code></li>
              </ul>
            </li>
            <li>افتح صفحة تذكرة (يمنية / Fly Aden) أو تأشيرة (KSA e-Visa) → افتح الإضافة → <b>قراءة المستند من الصفحة</b> → <b>سحب إلى رحّال 🚀</b>.</li>
          </ol>
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
            💡 <b>الجديد v1.2:</b> الإضافة الآن تدعم قراءة ملفات PDF ومعاينة الطباعة! يكفي فتح صفحة الـ PDF والضغط "قراءة PDF". البوابات المدعومة: Yemenia · Fly Aden · KSA e-Visa (عمرة/زيارة/عمل) · البركة للنقل · الموافقات الأمنية (Ethiopia/Egypt).
          </div>
        </CardContent>
      </Card>

      {/* Create Token Dialog */}
      <Dialog open={showNew} onOpenChange={(v) => { setShowNew(v); if (!v) { setNewToken(null); setNewName('') } }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Key className="w-5 h-5 text-blue-600" /> {newToken ? 'الرمز الجديد' : 'إنشاء رمز شخصي جديد'}</DialogTitle>
          </DialogHeader>
          {!newToken ? (
            <>
              <div className="space-y-3">
                <Field label="اسم الرمز (لتذكر مكان استخدامه)">
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="لابتوب المكتب — Chrome" />
                </Field>
                <div className="text-xs text-slate-500">سيُعرض الرمز الكامل مرة واحدة فقط — انسخه فوراً.</div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setShowNew(false)}>إلغاء</Button>
                <Button onClick={createToken} disabled={creating} className="grad-brand text-white gap-2">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} إنشاء الرمز
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900">
                  ✅ تم إنشاء الرمز بنجاح باسم <b>{newToken.name}</b>
                </div>
                <div className="bg-slate-900 text-white rounded-lg p-3 font-mono text-xs break-all" dir="ltr">
                  {newToken.token}
                </div>
                <Button onClick={() => copy(newToken.token)} className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                  📋 نسخ الرمز إلى الحافظة
                </Button>
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                  ⚠️ <b>تنبيه:</b> {newToken.warning || 'انسخ الرمز الآن — لن يظهر مرة أخرى.'}
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowNew(false); setNewToken(null) }} className="grad-brand text-white">تم — إغلاق</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReferralsTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api('/referrals').then(setData).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [])
  if (loading) return <div className="text-center py-10 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /> جاري التحميل...</div>
  if (!data) return null
  // v3.9.16 — Unified official domain for referral links (avoids ephemeral preview URLs)
  const OFFICIAL_DOMAIN = publicSiteOrigin() // v3.88.4 — DEP-002: Test emits Test links only
  const fullLink = `${OFFICIAL_DOMAIN}/signup?ref=${data.code}`
  const copy = (text) => { navigator.clipboard.writeText(text); toast.success('📋 تم النسخ') }
  const shareWhatsApp = () => {
    const msg = `🎁 انضم إلى منصة رحّال (Rahaal ERP) للمكاتب السياحية!\nسجّل الآن بحسابك التجريبي المجاني عبر رابط الإحالة الخاص بي:\n${fullLink}\n\n✅ 500 قيد يومي مجاناً في التسجيل\n✅ محاسبة متعددة العملات (YER / USD / SAR)\n✅ إدارة تذاكر / تأشيرات / صرافة`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }
  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-l from-emerald-50 to-blue-50 border-emerald-200">
        <CardHeader><CardTitle className="flex items-center gap-2">🎁 برنامج الإحالة والمكافآت</CardTitle><CardDescription>ادعُ مكاتب سياحية أخرى وأكسب قيوداً مجانية عند تسجيلهم وعند دفعهم</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard icon={Users} label="مكاتب مسجّلة عبرك" value={data.stats.signups} grad="grad-brand" />
            <StatCard icon={CheckCircle2} label="مكاتب فعّلت الاشتراك" value={data.stats.activations} grad="grad-green" />
            <StatCard icon={Sparkles} label="قيود مجانية اكتسبتها" value={data.stats.bonus_earned} grad="grad-gold" />
          </div>
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-bold text-slate-700">رمز الإحالة الخاص بك</div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-white border-2 border-emerald-300">
                <code className="text-2xl font-extrabold text-emerald-700 tracking-wider">{data.code}</code>
                <Button size="sm" variant="outline" onClick={() => copy(data.code)} className="mr-auto">📋 نسخ الرمز</Button>
              </div>
              <div className="text-sm font-bold text-slate-700 mt-3">رابط التسجيل بالإحالة</div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-white border" dir="ltr">
                <code className="text-sm text-blue-700 flex-1 truncate">{fullLink}</code>
                <Button size="sm" variant="outline" onClick={() => copy(fullLink)}>📋 نسخ</Button>
                <Button size="sm" onClick={shareWhatsApp} className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1">📲 مشاركة</Button>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <div className="font-bold mb-1">💡 كيف تعمل المكافآت؟</div>
                <ul className="list-disc list-inside space-y-1">
                  <li>عند تسجيل مكتب جديد عبر رابطك → <b>+50 قيد مجاني</b> يُضاف إلى حصتك فوراً وتلقائياً.</li>
                  <li>لا حدود لعدد الإحالات — كل مكتب جديد يعني +50 قيد إضافي لك!</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-blue-600" /> المكاتب المسجّلة عبر إحالتك ({data.invitees.length})</CardTitle></CardHeader>
        <CardContent>
          {data.invitees.length === 0 ? (
            <div className="text-center py-8 text-slate-400">لم يسجّل أي مكتب عبر رابطك بعد — شارك الرابط الآن!</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>اسم المكتب</TableHead>
                <TableHead>تاريخ التسجيل</TableHead>
                <TableHead>الاشتراك</TableHead>
                <TableHead>حالة المكافأة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.invitees.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="font-semibold">{v.name}</TableCell>
                    <TableCell className="text-xs">{fmtDate(v.created_at)}</TableCell>
                    <TableCell><Badge variant={v.subscription === 'paid' ? 'default' : 'secondary'}>{v.subscription === 'paid' ? 'مدفوع' : 'تجريبي'}</Badge></TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">✅ تم منح +50 قيد مكافأة</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ================================================================
// v3.4 — Permissions Dialog + Affiliate Screen
// ================================================================
const PERMISSION_GROUPS = [
  {
    // v3.45 — RBAC Phase 1: module-level access (full sidebar sections)
    title: '🧭 الوصول إلى الأقسام (القائمة الجانبية)', keys: MODULE_LABELS.map(m => ({ k: m.k, l: m.l }))
  },
  {
    title: '🎫 التذاكر', keys: [
      { k: 'tickets_view', l: 'عرض التذاكر' },
      { k: 'tickets_add',  l: 'إضافة تذكرة' },
      { k: 'tickets_edit', l: 'تعديل تذكرة' },
      { k: 'tickets_delete', l: 'حذف تذكرة' },
    ]
  },
  {
    title: '🛂 التأشيرات', keys: [
      { k: 'visas_view', l: 'عرض التأشيرات' },
      { k: 'visas_add', l: 'إضافة تأشيرة' },
      { k: 'visas_edit', l: 'تعديل تأشيرة' },
      { k: 'visas_delete', l: 'حذف تأشيرة' },
    ]
  },
  {
    title: '🛎️ الخدمات', keys: [
      { k: 'services_view', l: 'عرض الخدمات' },
      { k: 'services_add', l: 'إضافة خدمة' },
      { k: 'services_edit', l: 'تعديل خدمة' },
      { k: 'services_delete', l: 'حذف خدمة' },
    ]
  },
  {
    title: '📊 التقارير والأرباح', keys: [
      { k: 'reports_view', l: 'الوصول إلى التقارير المالية' },
      { k: 'fin_statements', l: '📄 كشوفات الحساب (عملاء/موردين)' },
      { k: 'fin_partner_summary', l: '🤝 ملخص وكشوفات الشركاء' },
      { k: 'show_profit', l: 'إظهار عمود الربح والعمولة' },
    ]
  },
  {
    title: '💳 السندات والدليل المحاسبي', keys: [
      { k: 'vouchers_manage', l: 'إدارة سندات القبض/الصرف' },
      { k: 'accounts_manage', l: 'إدارة الدليل المحاسبي (شجرة الحسابات)' },
    ]
  },
  {
    title: '💰 الأسعار والخصومات', keys: [
      { k: 'edit_price', l: 'تعديل السعر المعتمد للتذكرة/الخدمة' },
      { k: 'apply_discount', l: 'منح خصومات للعميل' },
    ]
  },
]

function PermissionsDialog({ target, onClose, onSaved }) {
  const [perms, setPerms] = useState({})
  const [saving, setSaving] = useState(false)
  const [boxes, setBoxes] = useState([]) // v3.9.9
  const [defaultBoxId, setDefaultBoxId] = useState('')
  const [lockBox, setLockBox] = useState(false)
  // v3.45 — RBAC role templates (baseline + individual overrides)
  const [templates, setTemplates] = useState([])
  const [roleKey, setRoleKey] = useState('')
  const [allowedBoxIds, setAllowedBoxIds] = useState([]) // v3.51 — Phase 3: box restriction (empty = all)
  useEffect(() => {
    if (target) {
      setPerms(target.permissions || {})
      setDefaultBoxId(target.default_box_id || '')
      setLockBox(!!target.lock_box)
      setRoleKey(target.role_key || '')
      setAllowedBoxIds(Array.isArray(target.allowed_box_ids) ? [...target.allowed_box_ids] : [])
      api('/boxes').then(setBoxes).catch(() => {})
      api('/rbac/templates').then(r => setTemplates(r?.templates || [])).catch(() => {})
    }
  }, [target])
  const toggleAllowedBox = (id) => setAllowedBoxIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const applyTemplate = (t) => {
    setPerms({ ...t.perms })
    setRoleKey(t.key)
    toast.success(`تم تطبيق قالب "${t.label}" — عدّل أي مفتاح أدناه كاستثناء فردي قبل الحفظ`)
  }
  const setKey = (k, v) => setPerms(p => ({ ...p, [k]: v }))
  const setAll = (val) => {
    const next = {}
    PERMISSION_GROUPS.forEach(g => g.keys.forEach(({ k }) => next[k] = val))
    setPerms(next)
  }
  const save = async () => {
    try {
      setSaving(true)
      await api(`/tenant/users/${target.id}`, { method: 'PATCH', body: { permissions: perms, role_key: roleKey, default_box_id: defaultBoxId || null, lock_box: lockBox, allowed_box_ids: allowedBoxIds } })
      onSaved && onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const allTrue = PERMISSION_GROUPS.every(g => g.keys.every(({ k }) => perms[k]))
  return (
    <Dialog open={!!target} onOpenChange={v => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Key className="w-5 h-5 text-blue-600" /> صلاحيات {target?.name || ''}
          </DialogTitle>
          <DialogDescription>حدد بالضبط ما يستطيع هذا الموظف فعله. المالك دائماً لديه صلاحيات كاملة (لا يحتاج ضبط).</DialogDescription>
        </DialogHeader>
        {/* v3.45 — RBAC role templates: apply a baseline, then tweak checkboxes as individual overrides */}
        <div className="border-2 border-blue-200 rounded-lg p-3 bg-blue-50 mb-3">
          <div className="font-bold text-sm text-blue-800 mb-2 flex items-center gap-2 flex-wrap">
            🎭 قوالب الأدوار الجاهزة
            {roleKey && <Badge className="bg-blue-600 text-white hover:bg-blue-600">{templates.find(t => t.key === roleKey)?.label || roleKey}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map(t => (
              <button key={t.key} type="button" onClick={() => applyTemplate(t)} title={t.desc}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${roleKey === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400 hover:bg-blue-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-500 mt-2">اختر قالباً لتطبيق صلاحياته الافتراضية دفعة واحدة، ثم عدّل أي مفتاح أدناه كاستثناء فردي لهذا الموظف.</div>
        </div>
        {/* v3.51 — RBAC Phase 3: restrict the employee to specific boxes/bank accounts */}
        <div className="border-2 border-emerald-200 rounded-lg p-3 bg-emerald-50/50 mb-3">
          <div className="font-bold text-sm text-emerald-800 mb-1">🏦 الصناديق والحسابات البنكية المسموحة</div>
          <div className="text-[11px] text-slate-500 mb-2">اترك الكل بدون تحديد = يرى جميع الصناديق. حدّد صناديق معينة = يرى ويتعامل معها <b>فقط</b> وتُخفى أرصدة الصناديق الأخرى عنه تماماً (مفروض من الخادم).</div>
          <div className="flex flex-wrap gap-2">
            {boxes.map(bx => (
              <button key={bx.id} type="button" onClick={() => toggleAllowedBox(bx.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${allowedBoxIds.includes(bx.id) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:border-emerald-400'}`}>
                {allowedBoxIds.includes(bx.id) ? '✓ ' : ''}{bx.type === 'cash' ? '💵' : '🏦'} {bx.name_ar || bx.name}
              </button>
            ))}
            {boxes.length === 0 && <span className="text-xs text-slate-400">لا توجد صناديق بعد</span>}
          </div>
          {allowedBoxIds.length > 0 && <div className="text-[11px] font-bold text-emerald-700 mt-2">مقيّد بـ {allowedBoxIds.length} صندوق — باقي الصناديق محجوبة عنه بالكامل</div>}
        </div>
        {/* v3.9.9 — Default cash box for cashiers */}
        <div className="border-2 border-emerald-200 rounded-lg p-3 bg-emerald-50 mb-3">
          <div className="font-bold text-sm text-emerald-800 mb-2 flex items-center gap-2">💵 الصندوق الافتراضي للكاشير</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">الصندوق الافتراضي (يُختار تلقائياً عند البيع النقدي)</label>
              <AccountAutocomplete type="box" value={defaultBoxId || null} onChange={(sel) => setDefaultBoxId(sel?.id || '')} placeholder="ابحث عن صندوق أو بنك..." />
            </div>
            <label className="flex items-center gap-2 p-2 bg-white border rounded cursor-pointer text-sm">
              <input type="checkbox" checked={lockBox} onChange={e => setLockBox(e.target.checked)} className="w-4 h-4 accent-rose-600" />
              <span className={lockBox ? 'font-bold text-rose-700' : 'text-slate-600'}>🔒 قفل تغيير الصندوق (لضمان مطابقة الوردية)</span>
            </label>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">عند تفعيل القفل، سيُعرض صندوق الموظف فقط في شاشات البيع النقدي بدون إمكانية تغييره.</div>
        </div>
        <div className="flex gap-2 mb-2 pb-2 border-b">
          <Button size="sm" variant="outline" onClick={() => setAll(true)} className="text-xs gap-1"><Power className="w-3 h-3 text-emerald-600" /> منح جميع الصلاحيات</Button>
          <Button size="sm" variant="outline" onClick={() => setAll(false)} className="text-xs gap-1"><Power className="w-3 h-3 text-rose-600" /> إلغاء جميع الصلاحيات</Button>
          {allTrue && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">الصلاحيات كاملة</Badge>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PERMISSION_GROUPS.map(g => (
            <div key={g.title} className="border rounded-lg p-3 bg-slate-50">
              <div className="font-bold text-sm text-slate-800 mb-2">{g.title}</div>
              <div className="space-y-1">
                {g.keys.map(({ k, l }) => (
                  <label key={k} className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer text-sm">
                    <input type="checkbox" checked={!!perms[k]} onChange={e => setKey(k, e.target.checked)} className="w-4 h-4 accent-blue-600" />
                    <span className={perms[k] ? 'font-semibold text-slate-800' : 'text-slate-500'}>{l}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} disabled={saving} className="grad-brand text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '💾 حفظ الصلاحيات'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// v3.9.19 — Interactive In-App Help Center (Product Tour + Field Guide per screen)
const HELP_SCREENS = [
  { id: 'tickets', icon: '🎫', title: 'حجز التذاكر', color: 'from-sky-500 to-blue-600', purpose: 'تسجيل مبيعات تذاكر الطيران مع إنشاء قيد محاسبي تلقائي', fields: [
    { name: 'التاريخ', required: true, desc: 'تاريخ إصدار التذكرة' },
    { name: 'المسافر', required: true, desc: 'اسم المسافر كما في جواز السفر' },
    { name: 'PNR / رقم التذكرة', required: false, desc: 'يُستخدم لكشف التكرار عند الاستيراد' },
    { name: 'المسار (route)', required: false, desc: 'مثل SAH-CAI' },
    { name: 'الشركة الناقلة', required: false, desc: 'يمنية، سعودية، إلخ' },
    { name: 'حساب القبض', required: true, desc: 'عميل (بيع آجل) أو صندوق/بنك (بيع نقدي)' },
    { name: 'المورد', required: true, desc: 'من دليل الحسابات' },
    { name: 'التكلفة / سعر البيع', required: true, desc: 'الفارق = العمولة تلقائياً' },
    { name: 'طريقة الدفع', required: true, desc: 'آجل / نقدي (نقدي يتطلب صندوق)' },
  ], workflow: ['اضغط "+ سند تذكرة" أو "استيراد Excel"', 'أدخل بيانات المسافر والتذكرة', 'اختر حساب القبض (عميل أو صندوق)', 'اضغط "حفظ" — سيتم إنشاء قيد محاسبي تلقائي'] },
  { id: 'visas', icon: '🛂', title: 'التأشيرات', color: 'from-emerald-500 to-teal-600', purpose: 'تسجيل تأشيرات العمرة/الحج/السياحة/العمل مع القيد التلقائي', fields: [
    { name: 'نوع الخدمة', required: true, desc: 'عمرة/حج/سياحة/عمل/زيارة' },
    { name: 'اسم المعتمر/المسافر', required: true, desc: 'كما في الجواز' },
    { name: 'رقم الجواز', required: true, desc: 'يُستخدم لكشف التكرار' },
    { name: 'الجنسية', required: false, desc: 'يمني/سعودي/مصري إلخ' },
    { name: 'تاريخ الدخول/الخروج', required: false, desc: 'لتتبع صلاحية التأشيرة' },
    { name: 'التكلفة/سعر البيع/العملة', required: true, desc: '' },
  ], workflow: ['اختر نوع التأشيرة', 'أدخل بيانات المسافر ورقم الجواز', 'حدد المورد والتكلفة وسعر البيع', 'حفظ — قيد تلقائي في 4102 إيرادات تأشيرات'] },
  { id: 'services', icon: '🛠️', title: 'الخدمات الأخرى', color: 'from-orange-500 to-amber-600', purpose: 'تسجيل خدمات متنوعة (ترجمة، توثيق، حجوزات فنادق منفصلة)', fields: [
    { name: 'نوع الخدمة', required: true, desc: 'قابل للتخصيص من دليل الأنواع' },
    { name: 'المستفيد', required: false, desc: '' },
    { name: 'الرقم المرجعي', required: false, desc: 'رقم عقد أو حجز' },
    { name: 'حساب القبض + المورد + التكاليف', required: true, desc: '' },
  ], workflow: ['أضف نوع خدمة جديد أو استخدم موجود', 'أدخل تكلفة وسعر بيع', 'حفظ — قيد يومية آلي'] },
  { id: 'packages', icon: '📦', title: 'الباكجات والبرامج', color: 'from-teal-500 to-emerald-600', purpose: 'إدارة البرامج السياحية (عمرة/حج/سياحة) مع مكونات ديناميكية', fields: [
    { name: 'اسم الباكج + النوع', required: true, desc: '' },
    { name: 'تاريخ البداية والنهاية', required: true, desc: '' },
    { name: 'العملة الأساسية', required: true, desc: '' },
    { name: 'المكونات (Dynamic Builder)', required: true, desc: 'طيران + فندق + تأشيرة + نقل — كل مكون له مورد وتكلفة' },
    { name: 'المسجلون', required: false, desc: 'قائمة الحجاج/المسافرين مع أسعارهم' },
  ], workflow: ['أنشئ باكج جديد', 'أضف المكونات ديناميكياً مع الموردين', 'سجّل المسافرين', 'راجع تقرير الربحية', 'أغلق الباكج بعد انتهاء الرحلة'] },
  { id: 'receipt', icon: '💵', title: 'سند قبض', color: 'from-green-500 to-emerald-600', purpose: 'تسجيل استلام دفعة من عميل', fields: [
    { name: 'التاريخ', required: true, desc: 'تاريخ استلام المبلغ' },
    { name: 'المستلم منه (العميل)', required: true, desc: 'من قائمة العملاء' },
    { name: 'الصندوق / البنك', required: true, desc: 'الوجهة التي دخل إليها المبلغ' },
    { name: 'المبلغ + العملة', required: true, desc: '' },
    { name: 'طريقة الدفع', required: false, desc: 'نقدي / تحويل / شيك' },
    { name: 'البيان', required: false, desc: 'وصف اختياري' },
  ], workflow: ['اختر العميل', 'اختر الصندوق/البنك', 'أدخل المبلغ والعملة', 'حفظ — قيد: مدين صندوق / دائن عميل'] },
  { id: 'payment', icon: '💸', title: 'سند صرف', color: 'from-rose-500 to-pink-600', purpose: 'دفع مبلغ لمورد أو مصروف', fields: [
    { name: 'التاريخ + المبلغ + العملة', required: true, desc: '' },
    { name: 'المدفوع إليه', required: true, desc: 'مورد أو حساب مصروف' },
    { name: 'الصندوق المصدر', required: true, desc: 'الذي خرج منه المبلغ' },
  ], workflow: ['اختر المستفيد (مورد/مصروف)', 'اختر الصندوق المصدر', 'أدخل المبلغ', 'حفظ — قيد: مدين المورد / دائن الصندوق'] },
  { id: 'fx', icon: '💱', title: 'صرافة العملات', color: 'from-fuchsia-500 to-purple-600', purpose: 'شراء/بيع عملة مقابل أخرى', fields: [
    { name: 'النوع', required: true, desc: 'شراء أو بيع' },
    { name: 'العملة والمبلغ', required: true, desc: 'مثل 1000 USD' },
    { name: 'العملة المقابلة والمبلغ', required: true, desc: 'مثل 3750 SAR' },
    { name: 'صندوقان (مصدر + وجهة)', required: true, desc: '' },
  ], workflow: ['حدد النوع (شراء/بيع)', 'أدخل مبلغ العملة الرئيسية', 'أدخل المبلغ المقابل بالعملة الثانية', 'اختر الصندوقين', 'حفظ — قيد مركب مع هامش ربح 4103'] },
  { id: 'extension', icon: '🔌', title: 'إضافة المتصفح (Chrome Extension)', color: 'from-indigo-500 to-purple-600', purpose: 'استخراج بيانات التذاكر والتأشيرات تلقائياً من مواقع الحجز والـ PDF', fields: [
    { name: 'PAT Token', required: true, desc: 'مفتاح شخصي تولّده من إعدادات المكتب — إضافة المتصفح' },
    { name: 'رابط الخادم', required: true, desc: publicSiteOrigin() }, // v3.88.4 — DEP-001: never hardcode an environment URL
  ], workflow: ['نزّل rahal-extension.zip من الرابط الرسمي', 'فك الضغط وثبّت الإضافة في Chrome (Load Unpacked)', 'الصق PAT Token + رابط الخادم', 'افتح صفحة تذكرة/تأشيرة — اضغط أيقونة رحّال — قراءة الصفحة', 'راجع البيانات — اضغط "سحب إلى رحّال"', 'الحصة المجانية: 30 قراءة لكل مكتب Trial'] },
]

function HelpCenter({ setTab }) {
  const [expanded, setExpanded] = useState(null)
  return (
    <div className="space-y-4">
      <TopBar title="📖 دليل الاستخدام والمساعدة" subtitle="جولة تفاعلية لكل شاشة — تعرّف على الحقول وخطوات العمل بسهولة" />

      <Card className="bg-gradient-to-l from-pink-50 via-rose-50 to-orange-50 border-2 border-pink-200">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="text-4xl">💡</div>
            <div className="flex-1">
              <div className="font-black text-lg text-slate-800">مرحباً بك في مركز المساعدة!</div>
              <div className="text-sm text-slate-600 mt-1">اضغط على أي شاشة أدناه لعرض شرح مفصّل لكل حقل + خطوات العمل. جميع الشروحات مبنية على النظام الفعلي وتتحدث بشكل تلقائي مع كل إصدار.</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {HELP_SCREENS.map(s => (
          <Card key={s.id} className={`overflow-hidden hover:shadow-lg transition ${expanded === s.id ? 'ring-2 ring-blue-400' : ''}`}>
            <div className={`h-1 bg-gradient-to-l ${s.color}`} />
            <CardContent className="p-4 cursor-pointer" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-2xl shadow`}>{s.icon}</div>
                  <div>
                    <div className="font-bold text-slate-800">{s.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{s.purpose}</div>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 mt-1">{expanded === s.id ? '▲' : '▼'}</Badge>
              </div>

              {expanded === s.id && (
                <div className="mt-4 space-y-3 pt-3 border-t">
                  <div>
                    <div className="text-xs font-bold text-blue-700 mb-2">📋 الحقول:</div>
                    <div className="space-y-1.5">
                      {s.fields.map((f, i) => (
                        <div key={i} className="text-xs bg-slate-50 rounded p-2 flex items-start gap-2">
                          <span className={`shrink-0 font-mono px-1.5 py-0.5 rounded ${f.required ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>{f.required ? '★' : '○'}</span>
                          <div>
                            <span className="font-bold text-slate-800">{f.name}</span>
                            {f.desc && <span className="text-slate-600"> — {f.desc}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-emerald-700 mb-2">🚀 خطوات العمل:</div>
                    <ol className="text-xs text-slate-700 space-y-1 mr-4 list-decimal">
                      {s.workflow.map((w, i) => <li key={i}>{w}</li>)}
                    </ol>
                  </div>
                  {s.id !== 'extension' && (
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); setTab && setTab(s.id) }} className={`w-full bg-gradient-to-l ${s.color} text-white gap-2`}>
                      🔗 انتقل إلى شاشة {s.title}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-50 border-2 border-slate-200">
        <CardContent className="p-5 text-center space-y-2">
          <div className="text-2xl">📞</div>
          <div className="font-bold text-slate-800">تحتاج مساعدة إضافية؟</div>
          <div className="text-sm text-slate-600">تواصل مع فريق الدعم عبر واتساب لدى Target Media Group</div>
          <div className="text-xs text-slate-500">دليل PDF مُفصّل متوفر في: <span className="font-mono">/app/memory/RAHAAL_USER_GUIDE.md</span></div>
        </CardContent>
      </Card>
    </div>
  )
}


function AffiliateScreen() {
  const [data, setData] = useState(null)
  const [pmOpen, setPmOpen] = useState(false)
  const [editingPm, setEditingPm] = useState(null)
  const [cashoutOpen, setCashoutOpen] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const load = () => api('/affiliate').then(setData).catch(e => toast.error(e.message))
  useEffect(() => { load() }, [])
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(data.link); toast.success('تم نسخ الرابط') } catch (e) { toast.error('تعذّر النسخ') }
  }
  const shareBanner = (b) => {
    const msg = `${b.headline}\n\n${b.body}\n\n${b.cta}: ${data.link}`
    openWhatsApp('', msg)  // Opens WA share with pre-filled text (no specific number)
  }
  const copyBanner = async (b) => {
    const msg = `${b.headline}\n\n${b.body}\n\n${b.cta}: ${data.link}`
    try { await navigator.clipboard.writeText(msg); toast.success('تم نسخ نص البانر') } catch (e) { toast.error('تعذّر النسخ') }
  }
  if (!data) return <div className="p-8 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
  const pct = Math.round((data.commission_rate || 0.1) * 100)
  const target = data.is_individual ? 'أفراد' : 'مكتب'
  return (
    <div className="space-y-6">
      <TopBar
        title="التسويق بالعمولة (Affiliate)"
        subtitle={`اربح ${pct}% من قيمة اشتراك كل مكتب تدعوه عبر رابطك — سواء اشترك شهرياً أو سنوياً`}
        right={<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border border-blue-200">حسابك: {target}</Badge>}
      />

      {/* Balance + KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="grad-brand text-white border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="text-xs opacity-90">الرصيد الحالي</div>
            <div className="text-3xl font-extrabold">${data.balance_usd.toFixed(2)}</div>
            <div className="text-[10px] opacity-80 mt-1">قابل للسحب أو التحويل للاشتراك</div>
          </CardContent>
        </Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-slate-500">إجمالي ما اكتسبته</div>
          <div className="text-2xl font-bold text-emerald-600">${data.total_earned_usd.toFixed(2)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-slate-500">مكاتب أحلتها</div>
          <div className="text-2xl font-bold text-slate-800">{data.referred_offices}</div>
          <div className="text-[10px] text-emerald-600 mt-1">{data.activated_offices} نشط • {data.pending_offices} قيد التفعيل</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-slate-500">الحد الأدنى للسحب</div>
          <div className="text-2xl font-bold text-orange-600">${data.min_cashout_usd}</div>
        </CardContent></Card>
      </div>

      {/* Referral link */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><User className="w-5 h-5 text-blue-600" /> رابط الإحالة الخاص بك</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 p-3 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg font-mono text-xs" dir="ltr">{data.link}</div>
            <Button onClick={copyLink} className="gap-2"><span>📋</span> نسخ</Button>
            <WaBtn phone="" message={`جرّب برنامج رحّال لمحاسبة مكاتب السفريات 🚀\nسجّل مجاناً عبر رابطي:\n${data.link}`} size="md" label="مشاركة" />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-bold">🔑 كودك:</span>
            <Badge className="font-mono">{data.code}</Badge>
            <span>• كل من يسجّل عبر رابطك تكسب <b>{pct}%</b> من قيمة اشتراكه في رصيدك.</span>
          </div>
        </CardContent>
      </Card>

      {/* Marketing banners */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ImageIcon className="w-5 h-5 text-orange-600" /> بانرات ونصوص تسويقية جاهزة</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.banners.map(b => (
            <div key={b.id} className="border-2 border-blue-100 rounded-xl overflow-hidden">
              <div className="grad-brand p-4 text-white">
                <div className="text-lg font-extrabold">{b.headline}</div>
              </div>
              <div className="p-3 space-y-2 bg-white">
                <div className="text-xs text-slate-500 font-semibold">{b.title}</div>
                <div className="text-sm text-slate-700 leading-relaxed">{b.body}</div>
                <div className="text-sm font-bold text-orange-600">{b.cta} → {data.link}</div>
                <div className="flex gap-2 pt-2 border-t">
                  <Button size="sm" onClick={() => copyBanner(b)} variant="outline" className="gap-1 text-xs h-8"><span>📋</span> نسخ النص</Button>
                  <button onClick={() => shareBanner(b)} className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-[#25D366] hover:bg-[#128C7E] text-white text-xs font-semibold">
                    <svg viewBox="0 0 32 32" width={12} height={12} fill="currentColor"><path d="M16.001 3.2C9.075 3.2 3.401 8.874 3.401 15.8c0 2.196.578 4.348 1.677 6.246l-1.876 6.85 7.048-1.848a12.578 12.578 0 0 0 5.751 1.398c6.926 0 12.6-5.674 12.6-12.6S22.927 3.2 16.001 3.2Z"/></svg>
                    مشاركة على واتساب
                  </button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payout methods */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5 text-emerald-600" /> طرق السحب المحفوظة ({data.payout_methods.length})</CardTitle>
          <Button onClick={() => { setEditingPm(null); setPmOpen(true) }} className="gap-2 grad-gold text-white"><Plus className="w-4 h-4" /> إضافة طريقة سحب</Button>
        </CardHeader>
        <CardContent>
          {data.payout_methods.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">لا توجد طرق سحب محفوظة. أضف طريقة قبل طلب السحب.</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.payout_methods.map(m => (
              <div key={m.id} className={`border-2 rounded-lg p-3 ${m.is_default ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-slate-800">
                    {m.method_type === 'bank' ? '🏦 تحويل بنكي' : m.method_type === 'wallet' ? '📱 محفظة رقمية' : '📮 حوالة محلية'}
                  </div>
                  {m.is_default && <Badge className="bg-emerald-500 text-white hover:bg-emerald-600">الافتراضية</Badge>}
                </div>
                <div className="text-xs space-y-1 text-slate-600">
                  {m.provider && <div><b>الجهة:</b> {m.provider}</div>}
                  <div><b>الاسم:</b> {m.account_name}</div>
                  {m.account_number && <div dir="ltr"><b>الرقم:</b> {m.account_number}</div>}
                  {m.phone && <div dir="ltr"><b>الهاتف:</b> {m.phone}</div>}
                  {m.city && <div><b>المدينة:</b> {m.city}</div>}
                </div>
                <div className="flex gap-1 mt-3 pt-2 border-t">
                  <Button size="sm" variant="ghost" onClick={() => { setEditingPm(m); setPmOpen(true) }} className="h-7 px-2 text-xs gap-1"><Pencil className="w-3 h-3" /> تعديل</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { if (await askConfirm({ title: 'حذف طريقة السحب', desc: 'سيتم حذف طريقة السحب هذه.', variant: 'danger', confirmLabel: 'تأكيد الحذف' })) { await api(`/affiliate/payout-methods/${m.id}`, { method: 'DELETE' }); load(); toast.success('تم الحذف') } }} className="h-7 px-2 text-xs text-rose-600 gap-1"><Trash2 className="w-3 h-3" /> حذف</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-2 border-emerald-200">
          <CardContent className="p-5">
            <div className="text-lg font-bold text-emerald-700 mb-2">💵 طلب سحب نقدي (Cash Out)</div>
            <div className="text-xs text-slate-600 mb-3">اسحب رصيدك المكتسب — الحد الأدنى ${data.min_cashout_usd} — عبر إحدى طرق السحب المحفوظة.</div>
            <Button onClick={() => setCashoutOpen(true)} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2" disabled={data.balance_usd < data.min_cashout_usd || data.payout_methods.length === 0}>
              <span>💸</span> طلب سحب رصيدي
            </Button>
            {data.payout_methods.length === 0 && <div className="text-[10px] text-rose-600 mt-1 text-center">أضف طريقة سحب أولاً</div>}
          </CardContent>
        </Card>
        <Card className="border-2 border-blue-200">
          <CardContent className="p-5">
            <div className="text-lg font-bold text-blue-700 mb-2">🔄 تحويل الرصيد لتغطية الاشتراك</div>
            <div className="text-xs text-slate-600 mb-3">استخدم رصيد الأفلييت لتغطية اشتراكك الشهري/السنوي أو رسوم الصيانة السنوية بدلاً من الدفع نقداً.</div>
            <Button onClick={() => setApplyOpen(true)} className="w-full grad-brand text-white gap-2" disabled={data.balance_usd <= 0}>
              <span>🎫</span> تحويل الرصيد للاشتراك
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Withdrawal history */}
      {data.withdrawals.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ReceiptText className="w-5 h-5 text-slate-600" /> سجل عمليات السحب والتحويل</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead><TableHead>الطريقة</TableHead><TableHead>الحالة</TableHead><TableHead>ملاحظات</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.withdrawals.map(w => (
                  <TableRow key={w.id}>
                    <TableCell className="text-xs">{fmtDate(w.created_at)}</TableCell>
                    <TableCell className="font-bold">${(w.amount_usd || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{w.payout_method_snapshot?.method_type === 'subscription' ? 'اشتراك (رصيد داخلي)' : (w.payout_method_snapshot?.provider || w.payout_method_snapshot?.method_type || '—')}</TableCell>
                    <TableCell>
                      {w.status === 'pending' && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">قيد المراجعة</Badge>}
                      {w.status === 'processing' && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">جاري التنفيذ</Badge>}
                      {w.status === 'paid' && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">تم الدفع</Badge>}
                      {w.status === 'rejected' && <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">مرفوض</Badge>}
                      {w.status === 'applied_to_subscription' && <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">تم التحويل للاشتراك</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{w.notes || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <PayoutMethodDialog open={pmOpen} onOpenChange={setPmOpen} editing={editingPm} onSaved={() => { setPmOpen(false); setEditingPm(null); load() }} />
      <CashoutDialog open={cashoutOpen} onOpenChange={setCashoutOpen} data={data} onSaved={() => { setCashoutOpen(false); load() }} />
      <ApplyToSubscriptionDialog open={applyOpen} onOpenChange={setApplyOpen} data={data} onSaved={() => { setApplyOpen(false); load() }} />
    </div>
  )
}

function PayoutMethodDialog({ open, onOpenChange, editing, onSaved }) {
  const [f, setF] = useState({ method_type: 'wallet', provider: '', account_name: '', account_number: '', phone: '', city: '', is_default: false, notes: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    if (editing) setF({
      method_type: editing.method_type, provider: editing.provider || '',
      account_name: editing.account_name, account_number: editing.account_number || '',
      phone: editing.phone || '', city: editing.city || '', is_default: !!editing.is_default, notes: editing.notes || '',
    })
    else setF({ method_type: 'wallet', provider: '', account_name: '', account_number: '', phone: '', city: '', is_default: false, notes: '' })
  }, [open, editing])
  const save = async () => {
    if (!f.account_name) return toast.error('اسم صاحب الحساب مطلوب')
    try {
      setSaving(true)
      if (editing) await api(`/affiliate/payout-methods/${editing.id}`, { method: 'PUT', body: f })
      else await api('/affiliate/payout-methods', { method: 'POST', body: f })
      toast.success(editing ? 'تم التحديث' : 'تمت الإضافة')
      onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const typeLabel = { bank: '🏦 تحويل بنكي', wallet: '📱 محفظة رقمية', local_remittance: '📮 حوالة محلية' }
  const providerPlaceholder = f.method_type === 'bank' ? 'اسم البنك (البنك اليمني، بنك الكريمي...)' : f.method_type === 'wallet' ? 'اسم المحفظة (كريمي، جوالي، فلوسي، الكيبل...)' : 'اسم شبكة الحوالة (النجم، الإمتياز، بن دوّل...)'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="w-5 h-5 text-emerald-600" /> {editing ? 'تعديل طريقة سحب' : 'إضافة طريقة سحب جديدة'}</DialogTitle>
          <DialogDescription>احفظ بيانات السحب لمرة واحدة، وستُستخدم تلقائياً عند طلب السحب في المرات القادمة.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><Field label="نوع طريقة السحب" required>
            <Select value={f.method_type} onValueChange={v => setF({ ...f, method_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">🏦 تحويل بنكي (IBAN)</SelectItem>
                <SelectItem value="wallet">📱 محفظة رقمية (Creami, Jawali, Floosak...)</SelectItem>
                <SelectItem value="local_remittance">📮 حوالة محلية (النجم، الإمتياز، بن دوّل...)</SelectItem>
              </SelectContent>
            </Select>
          </Field></div>
          <div className="md:col-span-2"><Field label="الجهة/المُقدّم"><Input value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })} placeholder={providerPlaceholder} /></Field></div>
          <Field label="اسم صاحب الحساب" required><Input value={f.account_name} onChange={e => setF({ ...f, account_name: e.target.value })} /></Field>
          <Field label={f.method_type === 'bank' ? 'رقم الحساب / IBAN' : 'رقم الهاتف / المرجع'}><Input dir="ltr" value={f.account_number} onChange={e => setF({ ...f, account_number: e.target.value })} /></Field>
          <Field label="رقم الهاتف (للتواصل عند الحوالة)"><Input dir="ltr" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="المدينة"><Input value={f.city} onChange={e => setF({ ...f, city: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="ملاحظات"><Input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="أي تعليمات إضافية لتنفيذ الحوالة" /></Field></div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer p-2 bg-emerald-50 rounded-md border border-emerald-200">
              <input type="checkbox" checked={f.is_default} onChange={e => setF({ ...f, is_default: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
              <span className="text-sm font-semibold">اجعل هذه الطريقة الافتراضية</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving} className="grad-gold text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editing ? '💾 حفظ التعديل' : 'إضافة')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CashoutDialog({ open, onOpenChange, data, onSaved }) {
  const [amount, setAmount] = useState('')
  const [pmId, setPmId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    setAmount(''); setNotes('')
    const def = data.payout_methods?.find(m => m.is_default) || data.payout_methods?.[0]
    setPmId(def?.id || '')
  }, [open, data])
  const submit = async () => {
    const amt = Number(amount) || 0
    if (amt < data.min_cashout_usd) return toast.error(`الحد الأدنى ${data.min_cashout_usd} USD`)
    if (amt > data.balance_usd) return toast.error('المبلغ يتجاوز رصيدك')
    if (!pmId) return toast.error('اختر طريقة السحب')
    try {
      setSaving(true)
      await api('/affiliate/cashout', { method: 'POST', body: { amount_usd: amt, payout_method_id: pmId, notes } })
      toast.success('✅ تم إرسال طلب السحب — قيد المراجعة')
      onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>💸 طلب سحب رصيد الأفلييت</DialogTitle>
          <DialogDescription>الرصيد المتاح: <b>${data.balance_usd.toFixed(2)}</b> • الحد الأدنى: <b>${data.min_cashout_usd}</b></DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="المبلغ المطلوب (USD)" required>
            <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="text-xl font-bold" />
          </Field>
          <Field label="طريقة السحب" required>
            <Select value={pmId} onValueChange={setPmId}>
              <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
              <SelectContent>
                {(data.payout_methods || []).map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.method_type === 'bank' ? '🏦' : m.method_type === 'wallet' ? '📱' : '📮'} {m.provider || m.method_type} — {m.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="ملاحظات (اختياري)"><Input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '💵 إرسال طلب السحب'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApplyToSubscriptionDialog({ open, onOpenChange, data, onSaved }) {
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setAmount(data.balance_usd.toFixed(2)) }, [open, data])
  const submit = async () => {
    const amt = Number(amount) || 0
    if (amt <= 0) return toast.error('أدخل مبلغاً صالحاً')
    if (amt > data.balance_usd) return toast.error('المبلغ يتجاوز رصيدك')
    try {
      setSaving(true)
      await api('/affiliate/apply-to-subscription', { method: 'POST', body: { amount_usd: amt } })
      toast.success('✅ تم تحويل الرصيد لتغطية الاشتراك')
      onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>🔄 تحويل الرصيد لتغطية الاشتراك</DialogTitle>
          <DialogDescription>سيتم خصم المبلغ من رصيد الأفلييت وإضافته كرصيد اشتراك يُستخدم تلقائياً عند التجديد.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
            💰 رصيد الأفلييت الحالي: <b className="text-emerald-700">${data.balance_usd.toFixed(2)}</b>
          </div>
          <Field label="المبلغ (USD)" required>
            <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="text-xl font-bold" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="grad-brand text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : '🎫 تحويل الآن'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================
// v3.6 — PACKAGES & TOURS SCREEN
// ================================================================
const PACKAGE_TYPES = [
  { v: 'umrah', l: '🕋 عمرة' },
  { v: 'hajj', l: '🕋 حج' },
  { v: 'tourism', l: '🌍 سياحة خارجية' },
  { v: 'group', l: '👥 قروبات' },
]
const COMPONENT_TYPES = [
  { v: 'visa', l: 'تأشيرة' }, { v: 'ticket', l: 'تذكرة' }, { v: 'hotel', l: 'فندق' },
  { v: 'transport', l: 'نقل/مواصلات' }, { v: 'other', l: 'أخرى' },
]

function PackagesScreen() {
  // v3.45 — RBAC: profits/commissions visible only to owner or staff with show_profit
  const { user: rbacUser } = useAuth()
  const canProfit = rbacUser?.role === 'owner' || rbacUser?.permissions?.show_profit === true
  const [packages, setPackages] = useState([])
  const [leaderboard, setLeaderboard] = useState(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detailsPkg, setDetailsPkg] = useState(null)
  const [reportPkg, setReportPkg] = useState(null)
  const [comparePeriod, setComparePeriod] = useState(null) // null | 'all' | 'month' | 'year'
  const [extendPkg, setExtendPkg] = useState(null)
  // v3.21 — Partner Commission Statement
  const [partnerStmtOpen, setPartnerStmtOpen] = useState(false)
  // v3.24 — Meraaj share dialog
  const [meraajPkg, setMeraajPkg] = useState(null)
  // v3.25 — Marketing showcase (view mode)
  const [showcasePkg, setShowcasePkg] = useState(null)
  // v3.27 — WhatsApp sales log
  const [waLogsOpen, setWaLogsOpen] = useState(false)
  const [waReminders, setWaReminders] = useState(0)
  // v3.28 — Soft archive
  const [showArchived, setShowArchived] = useState(false)
  const [archivedList, setArchivedList] = useState([])
  useEffect(() => { api('/whatsapp-logs/reminders').then(r => setWaReminders(r?.count || 0)).catch(() => {}) }, [waLogsOpen])
  const loadArchived = () => api('/packages?archived=1').then(setArchivedList).catch(() => {})
  const archivePkg = async (p) => {
    if (!(await askConfirm({ title: `أرشفة الباكج "${p?.name}"`, desc: `أرشفة ناعمة آمنة: سيختفي من واجهات العرض ومن سوق معراج${p?.meraaj?.shared ? ' (وسيُبلغ معراج بإيقافه)' : ''}، لكن تبقى كل بياناته وحجوزاته وقيوده المحاسبية سليمة في النظام — ويمكن استعادته في أي وقت.`, icon: '🗂️', confirmLabel: 'أرشفة' }))) return
    try {
      await api(`/packages/${p.id}/archive`, { method: 'POST', body: { archived: true } })
      toast.success('🗂️ تمت الأرشفة — البيانات والقيود محفوظة بالكامل')
      load(); if (showArchived) loadArchived()
    } catch (e) { toast.error(e.message) }
  }
  const restorePkg = async (p) => {
    try {
      await api(`/packages/${p.id}/archive`, { method: 'POST', body: { archived: false } })
      toast.success('✅ تمت الاستعادة')
      load(); loadArchived()
    } catch (e) { toast.error(e.message) }
  }
  // v3.9.11 — Bulk operations for packages
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [dateRange, setDateRange] = useState({ preset: 'all', from: '', to: '' })
  const load = () => {
    api('/packages').then(setPackages).catch(e => toast.error(e.message))
    api('/packages/comparison?period=month').then(setLeaderboard).catch(() => {})
  }
  useEffect(() => { load() }, [])
  const closePkg = async (p) => {
    if (!(await askConfirm({ title: `إغلاق الباكج "${p?.name}"`, desc: 'لن يمكن إضافة تسجيلات جديدة بعد الإغلاق — ويمكن إعادة فتحه لاحقاً.', icon: '🔒', confirmLabel: 'إغلاق الباكج' }))) return
    try { await api(`/packages/${p.id}`, { method: 'PATCH', body: { status: 'closed' } }); toast.success('تم إغلاق الباكج'); load() }
    catch (e) { toast.error(e.message) }
  }
  const reopenPkg = async (p) => {
    try { await api(`/packages/${p.id}`, { method: 'PATCH', body: { status: 'open' } }); toast.success('تم إعادة فتح الباكج'); load() }
    catch (e) { toast.error(e.message) }
  }
  const delPkg = async (p) => {
    if (!(await askConfirm({ title: 'حذف الباكج', desc: `حذف الباكج "${p?.name}"؟`, variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/packages/${p.id}`, { method: 'DELETE' }); toast.success('تم الحذف'); load() }
    catch (e) { toast.error(e.message) }
  }
  // v3.21/v3.31 — Duplicate package: full independent copy (components + transports + image, fresh Meraaj identity)
  // then immediately open the FULL edit form so the user can modify anything before using it.
  const dupPkg = async (p) => {
    if (!(await askConfirm({ title: `نسخ الباكج "${p?.name}"`, desc: `سيتم نسخ الباكج بكامل بياناته (الأسعار، المكونات، الفنادق، النقل، المميزات، الصورة) كباكج مستقل جديد.\n\nسيُفتح نموذج التعديل الكامل للنسخة فور إنشائها.`, icon: '📋', confirmLabel: 'نسخ الآن' }))) return
    try {
      const res = await api(`/packages/${p.id}/duplicate`, { method: 'POST', body: {} })
      toast.success(`✅ تم النسخ: ${res.name} (${res.components_copied || 0} مكوّن${res.transports_copied ? ` + ${res.transports_copied} وسيلة نقل` : ''}) — عدّل ما تشاء ثم احفظ`)
      await load()
      setEditing(res)
      setOpen(true)
    } catch (e) { toast.error(e.message) }
  }
  const dateBounds = useMemo(() => {
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (dateRange.preset === 'today') return { from: today, to: new Date(today.getTime() + 86400000 - 1) }
    if (dateRange.preset === 'week') { const d = new Date(today); d.setDate(d.getDate() - 6); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'month') { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { from: d, to: new Date(today.getTime() + 86400000 - 1) } }
    if (dateRange.preset === 'custom' && dateRange.from) { const f = new Date(dateRange.from); const t = dateRange.to ? new Date(dateRange.to + 'T23:59:59') : new Date(); return { from: f, to: t } }
    return null
  }, [dateRange])
  const safePackages = (packages || []).filter(Boolean)
  const filteredPackages = useMemo(() => {
    if (!dateBounds) return safePackages
    return safePackages.filter(p => { const d = new Date(p?.start_date || p?.created_at); return !isNaN(d) && d >= dateBounds.from && d <= dateBounds.to })
  }, [safePackages, dateBounds])
  const openPackages = filteredPackages.filter(p => p?.status !== 'closed')
  const closedPackages = filteredPackages.filter(p => p?.status === 'closed')
  const top = leaderboard?.top
  const toggleOne = (id) => { const s = new Set(selectedIds); if (s.has(id)) s.delete(id); else s.add(id); setSelectedIds(s) }
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds); if (ids.length === 0) return toast.error('لم يتم اختيار أي باكج')
    if (!(await askConfirm({ title: 'حذف جماعي للباكجات', desc: `حذف ${ids.length} باكج دفعة واحدة؟ (لن يتم حذف الباكجات التي بها تسجيلات)`, variant: 'danger', confirmLabel: 'حذف الكل' }))) return
    try { const r = await api('/packages/bulk-delete', { method: 'POST', body: { ids } }); toast.success(`✅ تم حذف ${r.deleted}${r.failed ? ` • فشل ${r.failed} (بسبب وجود حجوزات)` : ''}`); setSelectedIds(new Set()); load() }
    catch (e) { toast.error(e.message) }
  }
  const handleBulkClose = async (status) => {
    const ids = Array.from(selectedIds); if (ids.length === 0) return toast.error('لم يتم اختيار أي باكج')
    if (!(await askConfirm({ title: 'عملية جماعية', desc: `${status === 'closed' ? 'إغلاق' : 'إعادة فتح'} ${ids.length} باكج دفعة واحدة؟`, icon: '📦', confirmLabel: 'تأكيد' }))) return
    try { const r = await api('/packages/bulk-close', { method: 'POST', body: { ids, status } }); toast.success(`✅ تم تحديث ${r.updated} باكج`); setSelectedIds(new Set()); load() }
    catch (e) { toast.error(e.message) }
  }
  return (
    <div className="space-y-4">
      <TopBar title="الباكجات والبرامج السياحية" subtitle={`${openPackages.length} باكج نشط • ${closedPackages.length} مغلق`}
        right={<div className="flex gap-2">
          <Button variant="outline" onClick={() => { setShowArchived(!showArchived); if (!showArchived) loadArchived() }} className={`gap-2 ${showArchived ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>🗂️ المؤرشفة</Button>
          <Button variant="outline" onClick={() => setWaLogsOpen(true)} className="gap-2 border-green-300 text-green-700 hover:bg-green-50 relative">📲 سجل الواتساب{waReminders > 0 && <span className="absolute -top-2 -left-2 bg-rose-500 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold">{waReminders}</span>}</Button>
          {(rbacUser?.role === 'owner' || rbacUser?.permissions?.fin_partner_summary === true) && <Button variant="outline" onClick={() => setPartnerStmtOpen(true)} className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50">🤝 كشف الشريك</Button>}
          {canProfit && <Button variant="outline" onClick={() => setComparePeriod('all')} className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"><BarChart3 className="w-4 h-4" /> مقارنة الربحية</Button>}
          <Button onClick={() => { setEditing(null); setOpen(true) }} className="grad-brand text-white gap-2"><Plus className="w-4 h-4" /> باكج جديد</Button>
        </div>} />
      {/* v3.7 — Top Profitable Package KPI (current month) — v3.45: hidden without show_profit */}
      {canProfit && top && top.bookings > 0 && (
        <Card className="overflow-hidden border-0 shadow-md bg-gradient-to-l from-emerald-500 via-teal-500 to-cyan-500 text-white">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl">🏆</div>
                <div>
                  <div className="text-xs uppercase tracking-wider opacity-90">الباكج الأكثر ربحية هذا الشهر</div>
                  <div className="text-lg font-extrabold">{top.name}</div>
                  <div className="text-xs opacity-90">👥 {top.pax} مسافر • 🧾 {top.bookings} حجز • {PACKAGE_TYPES.find(t => t.v === top.package_type)?.l || top.package_type}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-[10px] opacity-90">صافي الربح</div>
                  <div className="text-xl font-black">{top.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-[10px] opacity-90">{top.currency}</div>
                </div>
                <div>
                  <div className="text-[10px] opacity-90">الإيرادات</div>
                  <div className="text-xl font-black">{top.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-[10px] opacity-90">{top.currency}</div>
                </div>
                <div>
                  <div className="text-[10px] opacity-90">هامش الربح</div>
                  <div className="text-xl font-black">{top.margin_pct}%</div>
                  <div className="text-[10px] opacity-90">Margin</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* v3.9.11 — Date range + Bulk actions bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg">
        <span className="text-xs font-bold text-slate-600 flex items-center gap-1">📅 عرض:</span>
        {[{ k: 'all', l: 'الكل' }, { k: 'today', l: 'اليوم' }, { k: 'week', l: 'آخر ٧ أيام' }, { k: 'month', l: 'هذا الشهر' }, { k: 'custom', l: 'مخصص' }].map(p => (
          <button key={p.k} onClick={() => setDateRange({ ...dateRange, preset: p.k })}
            className={`px-3 py-1 rounded-md text-xs font-semibold border ${dateRange.preset === p.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>{p.l}</button>
        ))}
        {dateRange.preset === 'custom' && (
          <>
            <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} className="text-xs border rounded px-2 py-1" />
            <span className="text-xs">إلى</span>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} className="text-xs border rounded px-2 py-1" />
          </>
        )}
        {selectedIds.size > 0 && (
          <div className="mr-auto flex items-center gap-2">
            <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">✓ محدد: {selectedIds.size}</span>
            <Button size="sm" onClick={() => handleBulkClose('closed')} className="gap-1 text-xs bg-orange-600 hover:bg-orange-700 text-white">🔒 إغلاق المحدد</Button>
            <Button size="sm" onClick={() => handleBulkClose('open')} className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">🔓 فتح المحدد</Button>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} className="gap-1 text-xs">🗑️ حذف المحدد ({selectedIds.size})</Button>
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} className="text-xs">إلغاء التحديد</Button>
          </div>
        )}
      </div>
      <div>
        {/* v3.28 — Archived packages panel (soft archive — data & JEs intact) */}
        {showArchived && (
          <div className="mb-4 rounded-xl border-2 border-slate-300 bg-slate-50/70 p-3">
            <div className="text-sm font-bold text-slate-700 mb-2">🗂️ الباكجات المؤرشفة ({archivedList.length}) <span className="text-[10px] font-normal text-slate-400">— مخفية عن الموظفين ومعراج، وبياناتها وقيودها سليمة</span></div>
            {archivedList.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-3">لا توجد باقات مؤرشفة</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {archivedList.map(p => (
                  <div key={p.id} className="rounded-lg border bg-white p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-700 truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-400">أُرشف {p.archived_at ? new Date(p.archived_at).toLocaleDateString('en-GB') : ''} • {p.bookings_count || 0} حجز محفوظ</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => restorePkg(p)} className="h-7 text-[10px] border-emerald-300 text-emerald-700 hover:bg-emerald-50 shrink-0">↩️ استعادة</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="text-sm font-bold text-slate-700 mb-2">🟢 الباكجات المفتوحة</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {openPackages.map(p => <PkgCard key={p?.id} p={p} onOpen={() => setDetailsPkg(p)} onClose={() => closePkg(p)} onEdit={() => { setEditing(p); setOpen(true) }} onDelete={() => delPkg(p)} onReport={canProfit ? () => setReportPkg(p) : undefined} onExtend={() => setExtendPkg(p)} onDuplicate={() => dupPkg(p)} onMeraaj={canProfit ? () => setMeraajPkg(p) : undefined} onShowcase={() => setShowcasePkg(p)} onArchive={() => archivePkg(p)} selectable selected={selectedIds.has(p?.id)} onToggleSelect={() => toggleOne(p?.id)} />)}
          {openPackages.length === 0 && <div className="col-span-full text-center text-slate-400 py-8 text-sm">{dateBounds ? 'لا نتائج ضمن النطاق التاريخي' : 'لا توجد باكجات مفتوحة — أنشئ باكج جديد'}</div>}
        </div>
      </div>
      {closedPackages.length > 0 && <div>
        <div className="text-sm font-bold text-slate-500 mt-6 mb-2">🗄️ أرشيف الباكجات المغلقة</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {closedPackages.map(p => <PkgCard key={p?.id} p={p} closed onOpen={() => setDetailsPkg(p)} onReopen={() => reopenPkg(p)} onReport={canProfit ? () => setReportPkg(p) : undefined} onDuplicate={() => dupPkg(p)} onShowcase={() => setShowcasePkg(p)} onArchive={() => archivePkg(p)} selectable selected={selectedIds.has(p?.id)} onToggleSelect={() => toggleOne(p?.id)} />)}
        </div>
      </div>}
      <PackageDialog open={open} onOpenChange={v => { setOpen(v); if (!v) setEditing(null) }} record={editing} onSaved={load} />
      {detailsPkg && <PackageDetailsDialog pkg={detailsPkg} onClose={() => setDetailsPkg(null)} onChanged={load} />}
      <PartnerStatementDialog open={partnerStmtOpen} onOpenChange={setPartnerStmtOpen} />
      {meraajPkg && <MeraajShareDialog pkg={meraajPkg} onClose={() => setMeraajPkg(null)} onSaved={load} />}
      {showcasePkg && <PackageShowcaseDialog pkg={showcasePkg} onClose={() => setShowcasePkg(null)} />}
      <WhatsAppLogsDialog open={waLogsOpen} onOpenChange={setWaLogsOpen} />
      {reportPkg && <PackageReportDialog pkg={reportPkg} onClose={() => setReportPkg(null)} />}
      {comparePeriod && <PackageCompareDialog initialPeriod={comparePeriod} onClose={() => setComparePeriod(null)} />}
      {extendPkg && <ExtendPackageDateDialog pkg={extendPkg} onClose={() => setExtendPkg(null)} onSaved={load} />}
    </div>
  )
}

// v3.7 — Extend Package End-Date (quick dialog)
function ExtendPackageDateDialog({ pkg, onClose, onSaved }) {
  const currentEnd = pkg.end_date ? new Date(pkg.end_date).toISOString().slice(0, 10) : ''
  const [newDate, setNewDate] = useState(currentEnd)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!newDate) return toast.error('اختر تاريخاً جديداً')
    if (pkg.end_date && new Date(newDate) <= new Date(pkg.end_date)) {
      if (!(await askConfirm({ title: 'تنبيه التاريخ', desc: 'التاريخ الجديد ليس بعد التاريخ الحالي — هل تريد المتابعة؟', icon: '⚠️', confirmLabel: 'متابعة' }))) return
    }
    try {
      setSaving(true)
      await api(`/packages/${pkg.id}`, { method: 'PATCH', body: { end_date: newDate } })
      toast.success('✅ تم تمديد تاريخ نهاية الباكج')
      onSaved(); onClose()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Calendar className="w-5 h-5 text-teal-600" /> تمديد تاريخ نهاية الباكج</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <div className="font-bold text-slate-700">{pkg.name}</div>
            <div className="text-xs text-slate-500 mt-1">{PACKAGE_TYPES.find(t => t.v === pkg.package_type)?.l}</div>
            <div className="text-xs text-slate-600 mt-2">التاريخ الحالي: <span className="font-mono">{currentEnd || '—'}</span></div>
          </div>
          <Field label="تاريخ النهاية الجديد" required>
            <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
          </Field>
          <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 flex gap-2">
            <span>💡</span>
            <span>مدّد التاريخ لتسجيل معتمرين أو مسافرين متأخرين دون الحاجة لإغلاق الباكج وإعادة فتحه.</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white gap-2"><Calendar className="w-4 h-4" /> {saving ? 'جارٍ الحفظ...' : 'تمديد التاريخ'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v3.7 — Packages Profitability Comparison Report
function PackageCompareDialog({ initialPeriod = 'all', onClose }) {
  const [period, setPeriod] = useState(initialPeriod)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const load = () => {
    setLoading(true)
    api(`/packages/comparison?period=${period}`).then(d => { setData(d); setLoading(false) }).catch(e => { toast.error(e.message); setLoading(false) })
  }
  useEffect(() => { load() }, [period])
  const rows = data?.rows || []
  const totals = data?.totals || { revenue: 0, cost: 0, profit: 0, margin_pct: 0, bookings: 0, pax: 0 }
  // v3.57 — per-age tier totals (only rows where tier profit is computable)
  const tierTotals = rows.reduce((acc, r) => {
    if (r.tiers?.computable) {
      acc.adult += r.tiers.profit?.adult || 0
      acc.child += r.tiers.profit?.child || 0
      acc.infant += r.tiers.profit?.infant || 0
    }
    return acc
  }, { adult: 0, child: 0, infant: 0 })
  const periodLabel = { all: 'كل الفترات', month: 'الشهر الحالي', year: 'السنة الحالية' }[period]
  const printReport = () => window.print()
  // v3.59 — Excel export including the per-age tier columns
  const exportExcel = () => {
    try {
      const headers = ['#', 'الباكج', 'النوع', 'الحالة', 'الحجوزات', 'المسافرون', 'الإيرادات', 'التكاليف', 'صافي الربح', 'ربح البالغين', 'عدد البالغين', 'ربح الأطفال', 'عدد الأطفال', 'ربح الرضع', 'عدد الرضع', 'الهامش %', 'العملة']
      const body = rows.map((r, i) => [
        i + 1, r.name, r.package_type || '', r.status === 'open' ? 'مفتوح' : 'مغلق', r.bookings, r.pax,
        r.revenue, r.cost, r.profit,
        r.tiers?.computable ? (r.tiers?.profit?.adult ?? 0) : '', r.tiers?.counts?.adult || 0,
        r.tiers?.computable ? (r.tiers?.profit?.child ?? 0) : '', r.tiers?.counts?.child || 0,
        r.tiers?.computable ? (r.tiers?.profit?.infant ?? 0) : '', r.tiers?.counts?.infant || 0,
        r.margin_pct, r.currency || '',
      ])
      const totalRow = ['', 'الإجمالي', '', '', totals.bookings, totals.pax, totals.revenue, totals.cost, totals.profit,
        tierTotals.adult, '', tierTotals.child, '', tierTotals.infant, '', totals.margin_pct, '']
      const ws = XLSX.utils.aoa_to_sheet([[`تقرير مقارنة ربحية الباكجات — ${periodLabel}`], [], headers, ...body, totalRow])
      ws['!cols'] = [{ wch: 4 }, { wch: 34 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 9 }, { wch: 7 }]
      const wb = XLSX.utils.book_new()
      wb.Workbook = { Views: [{ RTL: true }] }
      XLSX.utils.book_append_sheet(wb, ws, 'مقارنة الربحية')
      XLSX.writeFile(wb, `مقارنة_ربحية_الباكجات_${new Date().toISOString().slice(0, 10)}.xlsx`)
      toast.success('✅ تم تنزيل تقرير Excel بأعمدة الفئات العمرية')
    } catch (e) { toast.error('خطأ في التصدير: ' + e.message) }
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-blue-600" /> تقرير مقارنة ربحية الباكجات</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <div className="flex gap-1">
              {['all', 'month', 'year'].map(p => (
                <Button key={p} size="sm" variant={period === p ? 'default' : 'outline'} onClick={() => setPeriod(p)} className={period === p ? 'bg-blue-600 text-white' : ''}>
                  {p === 'all' ? 'الكل' : p === 'month' ? 'هذا الشهر' : 'هذه السنة'}
                </Button>
              ))}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={exportExcel} className="gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"><FileSpreadsheet className="w-3 h-3" /> تصدير Excel</Button>
              <Button size="sm" variant="outline" onClick={printReport} className="gap-1"><ReceiptText className="w-3 h-3" /> طباعة</Button>
            </div>
          </div>
          <div className="text-xs text-slate-500">الفترة: <b className="text-slate-700">{periodLabel}</b> • {rows.filter(r => r.bookings > 0).length} باكج نشط من أصل {rows.length}</div>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-lg border p-2 bg-white">
              <div className="text-[10px] text-slate-500">إجمالي الإيرادات</div>
              <div className="text-lg font-black text-emerald-600">{totals.revenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
            </div>
            <div className="rounded-lg border p-2 bg-white">
              <div className="text-[10px] text-slate-500">إجمالي التكاليف</div>
              <div className="text-lg font-black text-orange-600">{totals.cost.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
            </div>
            <div className="rounded-lg border p-2 bg-white">
              <div className="text-[10px] text-slate-500">صافي الربح</div>
              <div className="text-lg font-black text-blue-600">{totals.profit.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
            </div>
            <div className="rounded-lg border p-2 bg-white">
              <div className="text-[10px] text-slate-500">متوسط الهامش</div>
              <div className="text-lg font-black text-fuchsia-600">{totals.margin_pct}%</div>
            </div>
          </div>
          {/* Comparison table */}
          {loading ? (
            <div className="text-center py-8 text-sm text-slate-400">جارٍ التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">لا توجد باكجات</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs">
                  <tr>
                    <th className="p-2 text-right">#</th>
                    <th className="p-2 text-right">الباكج</th>
                    <th className="p-2 text-right">النوع</th>
                    <th className="p-2 text-center">الحالة</th>
                    <th className="p-2 text-center">الحجوزات</th>
                    <th className="p-2 text-center">المسافرون</th>
                    <th className="p-2 text-left">الإيرادات</th>
                    <th className="p-2 text-left">التكاليف</th>
                    <th className="p-2 text-left">صافي الربح</th>
                    <th className="p-2 text-left">👨 ربح البالغين</th>
                    <th className="p-2 text-left">🧒 ربح الأطفال</th>
                    <th className="p-2 text-left">👶 ربح الرضع</th>
                    <th className="p-2 text-center">الهامش %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.package_id} className={`border-t hover:bg-slate-50 ${idx === 0 && r.bookings > 0 ? 'bg-emerald-50/70 font-semibold' : ''}`}>
                      <td className="p-2 text-slate-400">{idx === 0 && r.bookings > 0 ? '🏆' : idx + 1}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2 text-xs text-slate-500">{PACKAGE_TYPES.find(t => t.v === r.package_type)?.l || r.package_type}</td>
                      <td className="p-2 text-center">
                        <Badge className={r.status === 'closed' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}>{r.status === 'closed' ? 'مغلق' : 'مفتوح'}</Badge>
                      </td>
                      <td className="p-2 text-center">{r.bookings}</td>
                      <td className="p-2 text-center">{r.pax}</td>
                      <td className="p-2 text-left font-mono text-emerald-700">{r.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="p-2 text-left font-mono text-orange-700">{r.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`p-2 text-left font-mono font-bold ${r.profit >= 0 ? 'text-blue-700' : 'text-rose-700'}`}>{r.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      {/* v3.57 — per-age tier realized profit (direct pricing packages) */}
                      {['adult', 'child', 'infant'].map(cat => {
                        const cnt = r.tiers?.counts?.[cat] || 0
                        const val = r.tiers?.computable ? (r.tiers?.profit?.[cat] || 0) : null
                        return (
                          <td key={cat} className="p-2 text-left font-mono text-xs whitespace-nowrap">
                            {cnt === 0 ? <span className="text-slate-300">—</span>
                              : val === null ? <span className="text-slate-400" title="تسعير مكوّنات — الربح حسب الفئة غير متاح">{cnt} مسافر</span>
                              : <span className={val >= 0 ? 'text-emerald-700' : 'text-rose-600'}>{val.toLocaleString('en-US')} <span className="text-[9px] text-slate-400">({cnt})</span></span>}
                          </td>
                        )
                      })}
                      <td className="p-2 text-center font-mono">
                        <span className={`px-2 py-0.5 rounded ${r.margin_pct >= 20 ? 'bg-emerald-100 text-emerald-700' : r.margin_pct >= 10 ? 'bg-amber-100 text-amber-700' : r.margin_pct > 0 ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-600'}`}>{r.margin_pct}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold text-xs">
                  <tr>
                    <td colSpan={4} className="p-2 text-left">الإجمالي</td>
                    <td className="p-2 text-center">{totals.bookings}</td>
                    <td className="p-2 text-center">{totals.pax}</td>
                    <td className="p-2 text-left font-mono">{totals.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="p-2 text-left font-mono">{totals.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="p-2 text-left font-mono">{totals.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`p-2 text-left font-mono text-xs ${tierTotals.adult >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{tierTotals.adult.toLocaleString('en-US')}</td>
                    <td className={`p-2 text-left font-mono text-xs ${tierTotals.child >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{tierTotals.child.toLocaleString('en-US')}</td>
                    <td className={`p-2 text-left font-mono text-xs ${tierTotals.infant >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{tierTotals.infant.toLocaleString('en-US')}</td>
                    <td className="p-2 text-center font-mono">{totals.margin_pct}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        <DialogFooter className="print:hidden"><Button variant="ghost" onClick={onClose}>إغلاق</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v3.21 — Partner Commission Statement (كشف حساب الشريك B2B)
function PartnerStatementDialog({ open, onOpenChange }) {
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [partnerKey, setPartnerKey] = useState('') // "client:id" | "supplier:id"
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  // v3.22 — Archive & Settlement
  const [boxes, setBoxes] = useState([])
  const [archivedStmt, setArchivedStmt] = useState(null) // saved snapshot for the current view
  const [archiveList, setArchiveList] = useState([])
  const [showArchive, setShowArchive] = useState(false)
  const [settleFor, setSettleFor] = useState(null) // { stmt, currency, due }
  const [settleForm, setSettleForm] = useState({ box_id: '', amount: '', notes: '' })
  const [settling, setSettling] = useState(false)
  // v3.26 — Partners monthly summary (earned / settled / outstanding)
  const [summary, setSummary] = useState(null)
  const [showSummary, setShowSummary] = useState(false)
  const loadSummary = () => api('/partners/summary').then(setSummary).catch(() => {})
  useEffect(() => {
    if (!open) return
    api('/clients').then(setClients).catch(() => {})
    api('/suppliers').then(setSuppliers).catch(() => {})
    api('/boxes').then(setBoxes).catch(() => {})
    loadArchive()
    loadSummary()
    // default: current month
    const now = new Date()
    setFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
    setTo(now.toISOString().slice(0, 10))
    setData(null); setPartnerKey(''); setArchivedStmt(null); setSettleFor(null); setShowArchive(false)
  }, [open])
  const loadArchive = () => api('/partners/statements').then(setArchiveList).catch(() => {})
  const partnerName = useMemo(() => {
    if (!partnerKey) return ''
    const [type, id] = partnerKey.split(':')
    const items = type === 'supplier' ? suppliers : clients
    return items.find(x => x.id === id)?.name || ''
  }, [partnerKey, clients, suppliers])
  const fetchStmt = async () => {
    if (!partnerKey) return toast.error('اختر الشريك أولاً')
    const [, id] = partnerKey.split(':')
    try {
      setLoading(true)
      setArchivedStmt(null); setSettleFor(null)
      const qs = new URLSearchParams({ partner_id: id })
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const res = await api(`/partners/commissions?${qs.toString()}`)
      setData(res)
      if ((res.rows || []).length === 0) toast.info('لا توجد عمولات مشتركة لهذا الشريك في الفترة المحددة')
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }
  // v3.22 — Save immutable snapshot (server recomputes for integrity)
  const archiveStmt = async (silent = false) => {
    if (!partnerKey) return null
    const [type, id] = partnerKey.split(':')
    try {
      const doc = await api('/partners/statements', { method: 'POST', body: { partner_type: type, partner_id: id, from: from || null, to: to || null } })
      setArchivedStmt(doc)
      loadArchive()
      if (!silent) toast.success('📁 تم حفظ الكشف في الأرشيف')
      return doc
    } catch (e) { if (!silent) toast.error(e.message); else throw e; return null }
  }
  // v3.22 — Open settlement panel (from live view or from archive)
  const openSettle = (stmt, currency, due) => {
    setSettleFor({ stmt, currency, due })
    setSettleForm({ box_id: '', amount: String(due), notes: '' })
  }
  const doSettle = async () => {
    if (!settleFor) return
    if (!settleForm.box_id) return toast.error('اختر الصندوق / البنك للصرف منه')
    const amt = Number(settleForm.amount)
    if (!(amt > 0)) return toast.error('أدخل مبلغاً صحيحاً')
    try {
      setSettling(true)
      let stmtDoc = settleFor.stmt?.id ? settleFor.stmt : archivedStmt
      // Live view not archived yet → archive first (audit chain)
      if (!stmtDoc?.id) {
        stmtDoc = await archiveStmt(true)
        if (!stmtDoc) throw new Error('تعذر أرشفة الكشف قبل التسوية')
      }
      const res = await api(`/partners/statements/${stmtDoc.id}/settle`, { method: 'POST', body: { box_id: settleForm.box_id, currency: settleFor.currency, amount: amt, notes: settleForm.notes } })
      toast.success(`✅ تمت التسوية — سند صرف ${fmt(res.settled_amount, res.settled_currency)} وقيد محاسبي متوازن`)
      setSettleFor(null)
      loadArchive()
      loadSummary()
      setArchivedStmt({ ...stmtDoc, settlement_voucher_id: res.voucher?.id, settled_amount: res.settled_amount, settled_currency: res.settled_currency })
    } catch (e) { toast.error(e.message) } finally { setSettling(false) }
  }
  const printStmt = (src = null) => {
    // src: archived statement doc OR null (uses live data)
    const d = src ? { rows: src.rows, totals: src.totals, count: src.count } : data
    const pName = src ? src.partner_name : partnerName
    const pFrom = src ? src.from : from
    const pTo = src ? src.to : to
    if (!d || (d.rows || []).length === 0) return toast.error('لا توجد بيانات للطباعة')
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (!w) return toast.error('اسمح بالنوافذ المنبثقة للطباعة')
    const rowsHtml = d.rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}</td>
        <td>${r.module_label}</td>
        <td style="text-align:right">${r.description || '—'}</td>
        <td>${r.total_commission.toLocaleString('en-US')} ${r.currency}</td>
        <td style="font-weight:bold; color:#b45309">${r.partner_share.toLocaleString('en-US')} ${r.currency}</td>
      </tr>`).join('')
    const totalsHtml = Object.entries(d.totals || {}).map(([cur, t]) => `
      <div style="display:flex; justify-content:space-between; padding:6px 12px; border-bottom:1px dashed #e2e8f0">
        <b>${cur}</b>
        <span>عمليات: ${t.count}</span>
        <span>إجمالي العمولة: <b>${t.total_commission.toLocaleString('en-US')}</b></span>
        <span style="color:#b45309">مستحق الشريك: <b>${t.partner_share.toLocaleString('en-US')}</b></span>
        <span style="color:#047857">صافي المكتب: <b>${t.office_share.toLocaleString('en-US')}</b></span>
      </div>`).join('')
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف حساب الشريك — ${pName}</title>
      <style>
        body{font-family:'Segoe UI',Tahoma,sans-serif; margin:24px; color:#1e293b}
        h1{font-size:20px; margin:0} .sub{color:#64748b; font-size:12px; margin-top:4px}
        table{width:100%; border-collapse:collapse; margin-top:16px; font-size:12px}
        th,td{border:1px solid #cbd5e1; padding:6px 8px; text-align:center}
        th{background:#f1f5f9}
        .totals{margin-top:16px; border:2px solid #f59e0b; border-radius:8px; overflow:hidden}
        .totals-h{background:#fef3c7; padding:8px 12px; font-weight:bold}
        .foot{margin-top:24px; font-size:11px; color:#94a3b8; display:flex; justify-content:space-between}
        @media print{ .noprint{display:none} }
      </style></head><body>
      <div style="display:flex; justify-content:space-between; align-items:start">
        <div>
          <h1>🤝 كشف حساب عمولات الشريك</h1>
          <div class="sub">الشريك: <b style="color:#1e293b; font-size:14px">${pName}</b></div>
          <div class="sub">الفترة: ${pFrom ? new Date(pFrom).toLocaleDateString('en-GB') : 'البداية'} ← ${pTo ? new Date(pTo).toLocaleDateString('en-GB') : 'اليوم'}</div>
          ${src?.settlement_voucher_id ? '<div class="sub" style="color:#047857; font-weight:bold">✅ كشف مُسوّى — تم السداد بسند صرف</div>' : ''}
        </div>
        <div class="sub" style="text-align:left">تاريخ الإصدار: ${src ? new Date(src.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')}<br/>عدد العمليات: ${d.count}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>التاريخ</th><th>الوحدة</th><th>البيان</th><th>إجمالي العمولة</th><th>مستحق الشريك</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals"><div class="totals-h">الإجماليات حسب العملة</div>${totalsHtml}</div>
      <div class="foot"><span>توقيع المكتب: ______________</span><span>توقيع الشريك: ______________</span></div>
      <script>window.onload=()=>window.print()</script>
      </body></html>`)
    w.document.close()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2">🤝 كشف حساب عمولات الشريك (B2B)</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <Field label="الشريك">
            <AccountAutocomplete
              type="party"
              value={partnerKey ? String(partnerKey).split(':')[1] : null}
              onChange={(sel) => setPartnerKey(sel ? `${sel.type}:${sel.id}` : '')}
              placeholder="ابحث عن عميل / مورد..."
            />
          </Field>
          <Field label="من تاريخ"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="إلى تاريخ"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button onClick={fetchStmt} disabled={loading} className="flex-1 grad-brand text-white">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '🔍 عرض'}</Button>
            {data && (data.rows || []).length > 0 && <Button variant="outline" onClick={() => printStmt(null)} className="gap-1 border-amber-300 text-amber-700"><Printer className="w-4 h-4" /> طباعة</Button>}
          </div>
        </div>
        {/* v3.22 — Archive toggle + save snapshot */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant={showSummary ? 'default' : 'outline'} onClick={() => { setShowSummary(!showSummary); if (!showSummary) setShowArchive(false) }} className={`h-8 text-xs gap-1 ${showSummary ? 'bg-amber-600 text-white' : ''}`}>📊 ملخص الشركاء {summary?.partners?.filter(p => p.has_outstanding).length > 0 && <span className="bg-rose-500 text-white rounded-full px-1.5 text-[9px]">{summary.partners.filter(p => p.has_outstanding).length}</span>}</Button>
          <Button size="sm" variant={showArchive ? 'default' : 'outline'} onClick={() => { setShowArchive(!showArchive); if (!showArchive) setShowSummary(false) }} className={`h-8 text-xs gap-1 ${showArchive ? 'bg-slate-700 text-white' : ''}`}>📁 الأرشيف ({archiveList.length})</Button>
          {data && (data.rows || []).length > 0 && !archivedStmt && (
            <Button size="sm" variant="outline" onClick={() => archiveStmt(false)} className="h-8 text-xs gap-1 border-indigo-300 text-indigo-700 hover:bg-indigo-50">💾 حفظ الكشف في الأرشيف</Button>
          )}
          {archivedStmt && <Badge className="bg-indigo-100 text-indigo-700 border border-indigo-300">📁 محفوظ في الأرشيف {archivedStmt.settlement_voucher_id ? '• ✅ مُسوّى' : ''}</Badge>}
        </div>
        {/* v3.22 — Settlement panel */}
        {settleFor && (
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-800">💸 تسوية وسداد مستحقات الشريك — {settleFor.stmt?.partner_name || partnerName}</div>
              <Button size="sm" variant="ghost" onClick={() => setSettleFor(null)} className="h-7 text-rose-600 text-xs">إلغاء</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Field label="الصندوق / البنك (الصرف منه)">
                <AccountAutocomplete type="box" value={settleForm.box_id || null} onChange={(sel) => setSettleForm({ ...settleForm, box_id: sel?.id || '' })} placeholder="ابحث عن صندوق أو بنك..." />
              </Field>
              <Field label={`المبلغ (${settleFor.currency}) — المستحق: ${settleFor.due}`}>
                <Input type="number" min="0" step="0.01" value={settleForm.amount} onChange={e => setSettleForm({ ...settleForm, amount: e.target.value })} className="bg-white font-bold" />
              </Field>
              <Field label="ملاحظة (اختياري)">
                <Input value={settleForm.notes} onChange={e => setSettleForm({ ...settleForm, notes: e.target.value })} className="bg-white" placeholder="تسوية شهر ..." />
              </Field>
              <div className="flex items-end">
                <Button onClick={doSettle} disabled={settling} className="w-full grad-green text-white gap-1">{settling ? <Loader2 className="w-4 h-4 animate-spin" /> : '✅ تأكيد التسوية + سند صرف'}</Button>
              </div>
            </div>
            <div className="text-[11px] text-slate-500">💡 سيُنشأ سند صرف باسم الشريك يخفّض رصيد العمولة المستحقة له، مع قيد محاسبي متوازن آلياً. {!settleFor.stmt?.id && 'وسيُحفظ الكشف في الأرشيف تلقائياً قبل التسوية (Audit Trail).'}</div>
          </div>
        )}
        {/* v3.26 — Partners summary view */}
        {showSummary && (
          !summary || (summary.partners || []).length === 0 ? (
            <div className="text-center text-slate-400 py-6 text-sm">لا توجد عمولات شركاء مسجلة بعد</div>
          ) : (
            <div className="space-y-2">
              {summary.partners.map(p => (
                <div key={p.partner_id} className={`rounded-lg border p-3 ${p.has_outstanding ? 'bg-amber-50/60 border-amber-300' : 'bg-white'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div className="text-sm font-bold text-slate-800">{p.partner_type === 'supplier' ? '🏢' : '👤'} {p.partner_name || 'شريك'} <span className="text-[10px] text-slate-400 font-normal">({p.ops_count} عملية)</span></div>
                    <div className="flex gap-2">
                      {p.has_outstanding && <Badge className="bg-rose-100 text-rose-700 border border-rose-300">⏳ مستحقات غير مسوّاة</Badge>}
                      <Button size="sm" variant="outline" onClick={() => { setPartnerKey(`${p.partner_type}:${p.partner_id}`); setShowSummary(false); setFrom(''); setTo(new Date().toISOString().slice(0, 10)) }} className="h-6 text-[10px]">📄 عرض الكشف</Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
                    {Object.entries(p.currencies).map(([cur, c]) => (
                      <div key={cur} className="rounded border bg-white p-2 text-[11px] space-y-0.5">
                        <div className="font-bold text-slate-600">{cur}</div>
                        <div className="flex justify-between"><span className="text-slate-500">مكتسب:</span><b>{c.earned.toLocaleString('en-US')}</b></div>
                        <div className="flex justify-between text-emerald-700"><span>مُسوّى:</span><b>{c.settled.toLocaleString('en-US')}</b></div>
                        <div className={`flex justify-between border-t pt-0.5 ${c.outstanding > 0.009 ? 'text-rose-600' : 'text-slate-400'}`}><span>المتبقي:</span><b>{c.outstanding.toLocaleString('en-US')}</b></div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {/* v3.22 — Archive list */}
        {showArchive && (
          archiveList.length === 0 ? (
            <div className="text-center text-slate-400 py-6 text-sm">لا توجد كشوفات محفوظة بعد — اعرض كشفاً واضغط "حفظ في الأرشيف"</div>
          ) : (
            <div className="space-y-2">
              {archiveList.map(s => (
                <div key={s.id} className="rounded-lg border bg-white p-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-sm font-bold text-slate-800">{s.partner_type === 'supplier' ? '🏢' : '👤'} {s.partner_name}</div>
                    <div className="text-[11px] text-slate-500">
                      {s.from ? new Date(s.from).toLocaleDateString('en-GB') : 'البداية'} ← {s.to ? new Date(s.to).toLocaleDateString('en-GB') : '—'} • {s.count} عملية • حُفظ {new Date(s.created_at).toLocaleDateString('en-GB')}
                    </div>
                    <div className="text-[11px] mt-0.5">
                      {Object.entries(s.totals || {}).map(([cur, t]) => <span key={cur} className="me-3 text-amber-700 font-bold">{cur}: {t.partner_share.toLocaleString('en-US')}</span>)}
                    </div>
                  </div>
                  {s.settlement_voucher_id
                    ? <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-300">✅ مُسوّى {s.settled_amount ? `— ${s.settled_amount.toLocaleString('en-US')} ${s.settled_currency}` : ''}</Badge>
                    : <div className="flex gap-1">{Object.entries(s.totals || {}).filter(([, t]) => t.partner_share > 0).map(([cur, t]) => (
                        <Button key={cur} size="sm" onClick={() => openSettle(s, cur, t.partner_share)} className="h-7 text-xs grad-green text-white">💸 تسوية {cur}</Button>
                      ))}</div>}
                  <Button size="sm" variant="outline" onClick={() => printStmt(s)} className="h-7 text-xs gap-1"><Printer className="w-3 h-3" /> طباعة</Button>
                </div>
              ))}
            </div>
          )
        )}
        {!showArchive && !showSummary && data && (
          (data.rows || []).length === 0 ? (
            <div className="text-center text-slate-400 py-8 text-sm">لا توجد عمولات مشتركة لهذا الشريك في الفترة المحددة</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {Object.entries(data.totals || {}).map(([cur, t]) => (
                  <div key={cur} className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-3">
                    <div className="text-xs font-bold text-slate-500 mb-1">{cur} — {t.count} عملية</div>
                    <div className="flex justify-between text-xs"><span>إجمالي العمولة:</span><b>{fmt(t.total_commission, cur)}</b></div>
                    <div className="flex justify-between text-xs text-amber-700"><span>مستحق الشريك:</span><b>{fmt(t.partner_share, cur)}</b></div>
                    <div className="flex justify-between text-xs text-emerald-700 border-t mt-1 pt-1"><span>صافي المكتب:</span><b>{fmt(t.office_share, cur)}</b></div>
                    {t.partner_share > 0 && !(archivedStmt?.settlement_voucher_id) && (
                      <Button size="sm" onClick={() => openSettle(archivedStmt || {}, cur, t.partner_share)} className="w-full mt-2 h-7 text-xs grad-green text-white">💸 تسوية وسداد {cur}</Button>
                    )}
                  </div>
                ))}
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الوحدة</TableHead><TableHead>البيان</TableHead><TableHead className="text-left">إجمالي العمولة</TableHead><TableHead className="text-left">مستحق الشريك</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.rows.map(r => (
                    <TableRow key={`${r.module}-${r.id}`}>
                      <TableCell className="text-xs whitespace-nowrap">{r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}</TableCell>
                      <TableCell className="text-xs">{r.module_label}</TableCell>
                      <TableCell className="text-xs font-semibold">{r.description}</TableCell>
                      <TableCell className="text-left text-xs">{fmt(r.total_commission, r.currency)}</TableCell>
                      <TableCell className="text-left text-xs font-bold text-amber-700">{fmt(r.partner_share, r.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

// v3.24/v3.25 — Meraaj Network: SMART Share dialog — prices pulled automatically, only commission is manual
function MeraajShareDialog({ pkg, onClose, onSaved }) {
  const shared = pkg?.meraaj?.shared
  const roomRows = (pkg?.room_pricing || []).filter(r => (Number(r.sale_per_pax) || 0) > 0)
  const [form, setForm] = useState({
    buyer_commission_mode: pkg?.meraaj?.buyer_commission_mode || 'amount',
    buyer_commission_value: pkg?.meraaj?.buyer_commission_value ?? '',
    buyer_commission_child_value: pkg?.meraaj?.buyer_commission_child_value ?? '',   // v3.53
    buyer_commission_infant_value: pkg?.meraaj?.buyer_commission_infant_value ?? '', // v3.53
    commission_direction: pkg?.meraaj?.commission_direction || 'deducted',
    seats_allocated: pkg?.meraaj?.seats_allocated ?? '',
  })
  const [saving, setSaving] = useState(false)
  // Live preview: mirrors the backend computeMeraajMarketPricing logic (v3.53: per-age commission)
  const cv = Number(form.buyer_commission_value) || 0
  const cvFor = (cat) => {
    if (cat === 'child' && form.buyer_commission_child_value !== '') return Number(form.buyer_commission_child_value) || 0
    if (cat === 'infant' && form.buyer_commission_infant_value !== '') return Number(form.buyer_commission_infant_value) || 0
    return cv
  }
  const commFor = (base, cat) => !(base > 0) ? 0 : (form.buyer_commission_mode === 'percent' ? +(base * cvFor(cat) / 100).toFixed(2) : +cvFor(cat).toFixed(2))
  const preview = roomRows.map(rp => {
    const base = { adult: Number(rp.sale_per_pax) || 0, child: (rp.sale_child === null || rp.sale_child === undefined) ? (Number(rp.sale_per_pax) || 0) : (Number(rp.sale_child) || 0), infant: Number(rp.sale_infant) || 0 }
    const out = { room_type: rp.type, base, customer: {}, net: {} }
    for (const cat of ['adult', 'child', 'infant']) {
      const c = commFor(base[cat], cat)
      if (form.commission_direction === 'added') { out.customer[cat] = +(base[cat] + c).toFixed(2); out.net[cat] = base[cat] }
      else { out.customer[cat] = base[cat]; out.net[cat] = +(base[cat] - c).toFixed(2) }
    }
    return out
  })
  const deductProblem = form.commission_direction === 'deducted' && preview.some(r => r.base.adult > 0 && r.net.adult <= 0)
  const submit = async (enabled) => {
    try {
      setSaving(true)
      if (enabled === false) {
        await api(`/packages/${pkg.id}/meraaj-share`, { method: 'POST', body: { enabled: false } })
        toast.success('تم إيقاف المشاركة — سيُزال الباكج من سوق معراج')
      } else {
        await api(`/packages/${pkg.id}/meraaj-share`, { method: 'POST', body: { enabled: true, ...form } })
        toast.success(shared ? '✅ تم تحديث بيانات المشاركة' : '🕋 تمت المشاركة في معراج نتورك')
      }
      onSaved(); onClose()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={!!pkg} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2">🕋 مشاركة في معراج نتورك — {pkg?.name}</DialogTitle></DialogHeader>
        {roomRows.length === 0 ? (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-center space-y-2">
            <div className="text-3xl">⚠️</div>
            <div className="font-bold text-amber-800">لا توجد أسعار غرف معرّفة في هذا الباكج</div>
            <div className="text-xs text-slate-600 leading-relaxed">المشاركة الذكية تسحب الأسعار آلياً من التسعير المباشر (غرفة + عمر).<br />عدّل الباكج وأضف أنواع الغرف مع أسعارها أولاً، ثم عد للمشاركة.</div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-500 bg-slate-50 border rounded-lg p-2">⚡ الأسعار تُسحب <b>آلياً</b> من تسعير الباكج في رحّال وتبقى متزامنة معه — أي تعديل مستقبلي على أسعار الباقة ينعكس فوراً في السوق. الحقل اليدوي الوحيد: عمولة الوكيل.</div>
            {/* Commission direction toggle */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, commission_direction: 'added' })} className={`text-right rounded-lg border-2 p-3 transition ${form.commission_direction === 'added' ? 'border-fuchsia-500 bg-fuchsia-50 shadow-sm' : 'border-slate-200 bg-white hover:border-fuchsia-300'}`}>
                <div className="text-sm font-bold text-slate-800">➕ تُضاف فوق السعر (Net Price)</div>
                <div className="text-[10px] text-slate-500 mt-1">الوكيل يبيع بسعرنا + عمولته — نقبض سعرنا كاملاً</div>
              </button>
              <button type="button" onClick={() => setForm({ ...form, commission_direction: 'deducted' })} className={`text-right rounded-lg border-2 p-3 transition ${form.commission_direction === 'deducted' ? 'border-fuchsia-500 bg-fuchsia-50 shadow-sm' : 'border-slate-200 bg-white hover:border-fuchsia-300'}`}>
                <div className="text-sm font-bold text-slate-800">➖ تُقتطع من السعر (سعر سوق موحد)</div>
                <div className="text-[10px] text-slate-500 mt-1">الزبون يدفع سعرنا نفسه — عمولة الوكيل من هامشنا</div>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="صيغة عمولة الوكيل">
                <Select value={form.buyer_commission_mode} onValueChange={v => setForm({ ...form, buyer_commission_mode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amount">💰 مبلغ / للفرد</SelectItem>
                    <SelectItem value="percent">📊 نسبة %</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={form.buyer_commission_mode === 'percent' ? 'النسبة %' : `المبلغ (${pkg?.currency})`}>
                <Input type="number" min="0" step="0.01" value={form.buyer_commission_value} onChange={e => setForm({ ...form, buyer_commission_value: e.target.value })} className="font-bold" />
              </Field>
              {/* v3.53 — per-age commission overrides */}
              <Field label={`🧒 عمولة الطفل${form.buyer_commission_mode === 'percent' ? ' %' : ''} (فارغ = كالبالغ)`}>
                <Input type="number" min="0" step="0.01" value={form.buyer_commission_child_value} onChange={e => setForm({ ...form, buyer_commission_child_value: e.target.value })} placeholder="كالبالغ" />
              </Field>
              <Field label={`👶 عمولة الرضيع${form.buyer_commission_mode === 'percent' ? ' %' : ''} (فارغ = كالبالغ)`}>
                <Input type="number" min="0" step="0.01" value={form.buyer_commission_infant_value} onChange={e => setForm({ ...form, buyer_commission_infant_value: e.target.value })} placeholder="كالبالغ" />
              </Field>
              <Field label="المقاعد المخصصة للسوق" required>
                <Input type="number" min="1" value={form.seats_allocated} onChange={e => setForm({ ...form, seats_allocated: e.target.value })} />
              </Field>
            </div>
            {shared && <div className="text-[10px] text-slate-500">مباع حالياً عبر معراج: {pkg?.meraaj?.seats_sold || 0} مقعد — لا يمكن التخصيص أقل من ذلك</div>}
            {/* Auto price table preview */}
            <div className="rounded-xl border-2 border-purple-200 overflow-hidden">
              <div className="bg-purple-50 px-3 py-2 text-xs font-bold text-purple-800">💵 جدول الأسعار في السوق (محسوب آلياً)</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">الغرفة</TableHead>
                  <TableHead className="text-xs">👨 زبون / صافينا</TableHead>
                  <TableHead className="text-xs">🧒 زبون / صافينا</TableHead>
                  <TableHead className="text-xs">👶 زبون / صافينا</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {preview.map(r => (
                    <TableRow key={r.room_type}>
                      <TableCell className="text-xs font-bold">🛏️ {r.room_type}</TableCell>
                      {['adult', 'child', 'infant'].map(cat => (
                        <TableCell key={cat} className="text-xs">
                          <span className="font-bold text-purple-700">{r.customer[cat].toLocaleString('en-US')}</span>
                          <span className="text-slate-400"> / </span>
                          <span className={`font-bold ${r.net[cat] > 0 || r.base[cat] === 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{r.net[cat].toLocaleString('en-US')}</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {deductProblem && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">⚠️ العمولة تلتهم كامل سعر بعض الغرف — خفّضها أو بدّل الاتجاه إلى "تُضاف فوق السعر"</div>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {shared && <Button variant="outline" onClick={() => submit(false)} disabled={saving} className="border-rose-300 text-rose-600 hover:bg-rose-50">⛔ إيقاف المشاركة</Button>}
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          {roomRows.length > 0 && <Button onClick={() => submit(true)} disabled={saving || deductProblem} className="bg-gradient-to-l from-purple-700 to-fuchsia-500 text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (shared ? '💾 تحديث المشاركة' : '🕋 مشاركة الآن')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v3.27 — WhatsApp Sales Log (Mini CRM): sent offers + follow-up status per lead
function WhatsAppLogsDialog({ open, onOpenChange }) {
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('all')
  const WA_STATUSES = [
    { v: 'sent', l: '📤 مُرسل', cls: 'bg-slate-100 text-slate-600' },
    { v: 'interested', l: '🤝 مهتم', cls: 'bg-amber-100 text-amber-700' },
    { v: 'booked', l: '✅ حجز', cls: 'bg-emerald-100 text-emerald-700' },
    { v: 'no_answer', l: '📵 لا يرد', cls: 'bg-rose-100 text-rose-700' },
  ]
  useEffect(() => { if (open) load() }, [open])
  const load = () => {
    api('/whatsapp-logs').then(setLogs).catch(() => {})
    api('/whatsapp-logs/reminders').then(setReminders).catch(() => {})
  }
  // v3.28 — performance report + follow-up reminders
  const [view, setView] = useState('log') // log | performance
  const [reminders, setReminders] = useState(null)
  const [perf, setPerf] = useState(null)
  const [perfMonth, setPerfMonth] = useState(new Date().toISOString().slice(0, 7))
  useEffect(() => { if (open && view === 'performance') api(`/whatsapp-logs/performance?month=${perfMonth}`).then(setPerf).catch(() => {}) }, [open, view, perfMonth])
  const reminderIds = new Set((reminders?.logs || []).map(r => r.id))
  const updLog = async (id, upd) => {
    try { await api(`/whatsapp-logs/${id}`, { method: 'PATCH', body: upd }); load() }
    catch (e) { toast.error(e.message) }
  }
  const delLog = async (id) => {
    if (!(await askConfirm({ title: 'حذف السجل', desc: 'سيتم حذف هذا السجل نهائياً.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/whatsapp-logs/${id}`, { method: 'DELETE' }); load() } catch (e) { toast.error(e.message) }
  }
  const shown = filter === 'all' ? logs : logs.filter(l => l.status === filter)
  const counts = { all: logs.length }
  for (const s of WA_STATUSES) counts[s.v] = logs.filter(l => l.status === s.v).length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2">📲 أرشيف مبيعات الواتساب <span className="text-xs font-normal text-slate-400">— متابعة العملاء المحتملين (Mini CRM)</span></DialogTitle></DialogHeader>
        {/* v3.28 — Follow-up reminders banner */}
        {(reminders?.count || 0) > 0 && (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
            <div className="text-sm font-bold text-amber-800 mb-1.5">⏰ {reminders.count} زبون "مهتم" بلا متابعة منذ يومين أو أكثر — لا تفقدهم!</div>
            <div className="flex flex-wrap gap-1.5">
              {reminders.logs.slice(0, 6).map(r => (
                <span key={r.id} className="text-[10px] bg-white border border-amber-200 rounded-full px-2 py-1">
                  👤 {r.customer_name || r.phone || 'غير مسمى'} <span className="text-slate-400">({r.package_name} — {r.sent_by})</span>
                  {r.phone && <a href={`https://wa.me/${r.phone}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-bold ms-1">📲 تابع الآن</a>}
                </span>
              ))}
              {reminders.count > 6 && <span className="text-[10px] text-slate-400 py-1">+{reminders.count - 6} آخرون</span>}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1.5">
            <Button size="sm" variant={view === 'log' ? 'default' : 'outline'} onClick={() => setView('log')} className="h-7 text-xs">📋 السجل</Button>
            <Button size="sm" variant={view === 'performance' ? 'default' : 'outline'} onClick={() => setView('performance')} className="h-7 text-xs">📊 تقرير الأداء</Button>
          </div>
          {view === 'performance' && <Input type="month" value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="h-7 text-xs w-40" />}
        </div>
        {/* v3.28 — Performance report per employee */}
        {view === 'performance' && (
          !perf || (perf.rows || []).length === 0 ? (
            <div className="text-center text-slate-400 py-10 text-sm">لا توجد رسائل في شهر {perfMonth}</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Card><CardContent className="p-3 text-center"><div className="text-xl font-black text-slate-700">{perf.totals.sent_total}</div><div className="text-[10px] text-slate-500">عروض مُرسلة</div></CardContent></Card>
                <Card><CardContent className="p-3 text-center"><div className="text-xl font-black text-amber-600">{perf.totals.interested}</div><div className="text-[10px] text-slate-500">مهتمون</div></CardContent></Card>
                <Card><CardContent className="p-3 text-center"><div className="text-xl font-black text-emerald-600">{perf.totals.booked}</div><div className="text-[10px] text-slate-500">حجوزات</div></CardContent></Card>
                <Card><CardContent className="p-3 text-center"><div className="text-xl font-black text-purple-700">{perf.totals.conversion_rate}%</div><div className="text-[10px] text-slate-500">معدل التحويل العام</div></CardContent></Card>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">الموظف</TableHead><TableHead className="text-xs">مُرسل</TableHead>
                  <TableHead className="text-xs">🤝 مهتم</TableHead><TableHead className="text-xs">✅ حجز</TableHead>
                  <TableHead className="text-xs">📵 لا يرد</TableHead><TableHead className="text-xs">معدل التحويل</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {perf.rows.map((r, i) => (
                    <TableRow key={r.employee} className={i === 0 && r.booked > 0 ? 'bg-emerald-50/50' : ''}>
                      <TableCell className="text-xs font-bold">{i === 0 && r.booked > 0 ? '🏆 ' : ''}{r.employee}</TableCell>
                      <TableCell className="text-xs">{r.sent_total}</TableCell>
                      <TableCell className="text-xs text-amber-700">{r.interested}</TableCell>
                      <TableCell className="text-xs text-emerald-700 font-bold">{r.booked}</TableCell>
                      <TableCell className="text-xs text-rose-600">{r.no_answer}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-l from-emerald-500 to-teal-400" style={{ width: `${Math.min(100, r.conversion_rate)}%` }} /></div>
                          <span className="text-xs font-bold text-slate-700">{r.conversion_rate}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
        {view === 'log' && <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')} className="h-7 text-xs">الكل ({counts.all})</Button>
          {WA_STATUSES.map(s => <Button key={s.v} size="sm" variant={filter === s.v ? 'default' : 'outline'} onClick={() => setFilter(s.v)} className="h-7 text-xs">{s.l} ({counts[s.v]})</Button>)}
        </div>}
        {view === 'log' && (shown.length === 0 ? (
          <div className="text-center text-slate-400 py-10 text-sm">لا توجد رسائل — كل عرض تسويقي يُرسل من شاشة "👁️ عرض" يُسجل هنا تلقائياً</div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead className="text-xs">التاريخ</TableHead><TableHead className="text-xs">الموظف</TableHead>
              <TableHead className="text-xs">الباكج</TableHead><TableHead className="text-xs">الزبون / الرقم</TableHead>
              <TableHead className="text-xs">حالة المتابعة</TableHead><TableHead className="text-xs">ملاحظات</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map(l => {
                const st = WA_STATUSES.find(s => s.v === l.status) || WA_STATUSES[0]
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-[11px] whitespace-nowrap">{new Date(l.created_at).toLocaleDateString('en-GB')}<div className="text-[9px] text-slate-400">{new Date(l.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div></TableCell>
                    <TableCell className="text-[11px]">{l.sent_by}</TableCell>
                    <TableCell className="text-[11px] font-bold">{l.package_name || '—'}</TableCell>
                    <TableCell className="text-[11px]">
                      <div className="font-semibold">{l.customer_name || 'غير مسمى'}</div>
                      <div className="text-slate-400 flex items-center gap-1" dir="ltr">{l.phone || '—'}
                        {l.phone && <a href={`https://wa.me/${l.phone}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">↗</a>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select value={l.status} onValueChange={v => updLog(l.id, { status: v })}>
                        <SelectTrigger className={`h-7 text-[11px] w-28 border ${st.cls}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{WA_STATUSES.map(s => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input defaultValue={l.notes || ''} onBlur={e => { if (e.target.value !== (l.notes || '')) updLog(l.id, { notes: e.target.value }) }} placeholder="ملاحظة متابعة..." className="h-7 text-[11px] w-36" />
                    </TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => delLog(l.id)} className="h-6 w-6 p-0 text-rose-400 hover:text-rose-600"><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ))}
      </DialogContent>
    </Dialog>
  )
}

// v3.25 — Marketing Showcase (read-only view for staff to present the package to customers)
function PackageShowcaseDialog({ pkg, onClose }) {
  const [waPhone, setWaPhone] = useState('')
  const [waName, setWaName] = useState('')
  if (!pkg) return null
  const nights = pkg.start_date && pkg.end_date ? Math.max(0, Math.ceil((new Date(pkg.end_date) - new Date(pkg.start_date)) / 86400000)) : null
  const roomRows = (pkg.room_pricing || []).filter(r => (Number(r.sale_per_pax) || 0) > 0)
  const TYPE_LABELS = { umrah: '🕋 عمرة', hajj: '🕋 حج', tourism: '🏝️ سياحة', other: '📦 برنامج' }
  // v3.26 — WhatsApp marketing message
  const sendWhatsApp = () => {
    const L = []
    L.push(`🕋 *${pkg.name}*`)
    if (pkg.start_date) L.push(`🛫 الانطلاق: ${new Date(pkg.start_date).toLocaleDateString('en-GB')}${pkg.end_date ? ` — 🛬 العودة: ${new Date(pkg.end_date).toLocaleDateString('en-GB')}` : ''}${nights !== null ? ` (🌙 ${nights} ليلة)` : ''}`)
    if ((pkg.features || []).length > 0) {
      L.push('', '✨ *مميزات البرنامج:*')
      for (const f of pkg.features) L.push(`✅ ${f}`)
    }
    // v3.49 — hotels & nights in the marketing message
    const pkgHotels = (pkg.hotels || []).filter(h => h.name)
    if (pkgHotels.length > 0) {
      L.push('', '🏨 *الإقامة الفندقية:*')
      for (const h of pkgHotels) L.push(`🏨 ${h.name}${h.city ? ` — ${h.city}` : ''}${Number(h.nights) > 0 ? ` (🌙 ${h.nights} ليالٍ)` : ''}`)
    }
    if (roomRows.length > 0) {
      L.push('', `💵 *الأسعار (${pkg.currency}):*`)
      for (const r of roomRows) {
        const child = (r.sale_child === null || r.sale_child === undefined) ? (Number(r.sale_per_pax) || 0) : (Number(r.sale_child) || 0)
        const infant = Number(r.sale_infant) || 0
        L.push(`🛏️ ${r.type}: بالغ ${(Number(r.sale_per_pax) || 0).toLocaleString('en-US')} • طفل ${child.toLocaleString('en-US')} • رضيع ${infant > 0 ? infant.toLocaleString('en-US') : 'مجاناً'}`)
      }
    }
    if (pkg.notes) L.push('', `📝 ${pkg.notes}`)
    L.push('', '📞 للحجز والاستفسار تواصل معنا')
    const rawText = L.join('\n')
    const text = encodeURIComponent(rawText)
    const phone = waPhone.replace(/[^0-9]/g, '')
    // v3.27 — Mini CRM: log the send (fire-and-forget)
    api('/whatsapp-logs', { method: 'POST', body: { package_id: pkg.id, package_name: pkg.name, phone, customer_name: waName, message: rawText } }).catch(() => {})
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer')
    toast.success('📲 فُتح واتساب — وسُجّل الإرسال في أرشيف المبيعات')
  }
  return (
    <Dialog open={!!pkg} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0">
        {/* Hero */}
        <div className="relative">
          {pkg.has_image ? (
            <img src={`/api/packages/${pkg.id}/image?t=${Date.now()}`} alt={pkg.name} className="w-full h-56 object-cover" />
          ) : (
            <div className="w-full h-40 bg-gradient-to-l from-teal-600 via-emerald-500 to-teal-400 flex items-center justify-center text-6xl">🕋</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <div className="absolute bottom-3 right-4 left-4 text-white">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 backdrop-blur border border-white/30">{TYPE_LABELS[pkg.package_type] || pkg.package_type}</span>
              {pkg.meraaj?.shared && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/60 backdrop-blur border border-white/30">🕋 في معراج نتورك</span>}
            </div>
            <div className="text-2xl font-black drop-shadow">{pkg.name}</div>
          </div>
        </div>
        <div className="px-5 pb-5 space-y-4">
          {/* Dates strip */}
          <div className="grid grid-cols-3 gap-2 -mt-2">
            <div className="rounded-xl border bg-teal-50/60 border-teal-200 p-2 text-center">
              <div className="text-[10px] text-slate-500">🛫 الانطلاق</div>
              <div className="text-sm font-black text-teal-800">{pkg.start_date ? new Date(pkg.start_date).toLocaleDateString('en-GB') : 'غير محدد'}</div>
            </div>
            <div className="rounded-xl border bg-emerald-50/60 border-emerald-200 p-2 text-center">
              <div className="text-[10px] text-slate-500">🛬 العودة</div>
              <div className="text-sm font-black text-emerald-800">{pkg.end_date ? new Date(pkg.end_date).toLocaleDateString('en-GB') : 'غير محدد'}</div>
            </div>
            <div className="rounded-xl border bg-indigo-50/60 border-indigo-200 p-2 text-center">
              <div className="text-[10px] text-slate-500">🌙 الليالي</div>
              <div className="text-sm font-black text-indigo-800">{nights !== null ? `${nights} ليلة` : '—'}</div>
            </div>
          </div>
          {/* v3.49 — Hotels & nights distribution */}
          {(pkg.hotels || []).filter(h => h.name).length > 0 && (
            <div>
              <div className="text-sm font-black text-slate-800 mb-2">🏨 الإقامة الفندقية</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {(pkg.hotels || []).filter(h => h.name).map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm text-slate-700 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-bold truncate">🏨 {h.name}</div>
                      {h.city && <div className="text-[11px] text-slate-500">📍 {h.city}</div>}
                    </div>
                    {Number(h.nights) > 0 && <div className="text-xs font-black text-amber-700 whitespace-nowrap">🌙 {h.nights} ليالٍ</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Features */}
          {(pkg.features || []).length > 0 && (
            <div>
              <div className="text-sm font-black text-slate-800 mb-2">✨ مميزات البرنامج</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {pkg.features.map(feat => (
                  <div key={feat} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 border rounded-lg px-3 py-1.5">
                    <span className="text-emerald-500 font-black">✓</span> {feat}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Room prices */}
          {roomRows.length > 0 && (
            <div>
              <div className="text-sm font-black text-slate-800 mb-2">🛏️ الأسعار حسب التسكين ({pkg.currency})</div>
              <div className="rounded-xl border-2 border-teal-200 overflow-hidden">
                <Table>
                  <TableHeader><TableRow className="bg-teal-50">
                    <TableHead className="text-xs">نوع الغرفة</TableHead>
                    <TableHead className="text-xs">👨 بالغ</TableHead>
                    <TableHead className="text-xs">🧒 طفل (2-11)</TableHead>
                    <TableHead className="text-xs">👶 رضيع</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {roomRows.map(r => (
                      <TableRow key={r.type}>
                        <TableCell className="text-sm font-bold">🛏️ {r.type}</TableCell>
                        <TableCell className="text-sm font-black text-teal-700">{(Number(r.sale_per_pax) || 0).toLocaleString('en-US')}</TableCell>
                        <TableCell className="text-sm font-bold text-slate-700">{((r.sale_child === null || r.sale_child === undefined) ? (Number(r.sale_per_pax) || 0) : (Number(r.sale_child) || 0)).toLocaleString('en-US')}</TableCell>
                        <TableCell className="text-sm text-slate-600">{(Number(r.sale_infant) || 0) > 0 ? (Number(r.sale_infant) || 0).toLocaleString('en-US') : 'مجاناً'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {/* Notes */}
          {pkg.notes && (
            <div className="text-xs text-slate-600 bg-amber-50/60 border border-amber-200 rounded-xl p-3 leading-relaxed">
              <b>📝 ملاحظات:</b> {pkg.notes}
            </div>
          )}
          <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-end justify-between border-t pt-3">
            <div className="flex-1 flex gap-2 items-end">
              <div className="w-32">
                <div className="text-[10px] text-slate-500 mb-1">👤 اسم الزبون (اختياري)</div>
                <Input value={waName} onChange={e => setWaName(e.target.value)} placeholder="أحمد..." className="h-9" />
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-slate-500 mb-1">📲 رقم واتساب الزبون (بالرمز الدولي، اختياري)</div>
                <Input value={waPhone} onChange={e => setWaPhone(e.target.value)} placeholder="9677xxxxxxxx" className="h-9" dir="ltr" />
              </div>
              <Button onClick={sendWhatsApp} className="bg-gradient-to-l from-green-600 to-emerald-500 text-white gap-1 h-9">📲 إرسال العرض واتساب</Button>
            </div>
            <Button variant="outline" onClick={onClose} className="h-9">إغلاق</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// v3.24 — Meraaj Network Store screen (iframe عند توفر الرابط + مركز مزامنة)
function PkgCard({ p, onOpen, onClose, onEdit, onDelete, onReopen, onReport, onExtend, onDuplicate, onMeraaj, onShowcase, onArchive, closed, selectable, selected, onToggleSelect }) {
  const typeL = PACKAGE_TYPES.find(t => t.v === p?.package_type)?.l || p?.package_type || '—'
  return (
    <Card className={`overflow-hidden hover:shadow-md transition ${closed ? 'opacity-70' : ''} ${selected ? 'ring-2 ring-rose-400' : ''}`}>
      <div className={closed ? 'h-1 bg-slate-400' : 'h-1 grad-brand'} />
      {/* v3.47 — Optimized package image: fixed 16/9 ratio + object-cover (consistent on desktop/tablet/mobile) */}
      {p?.has_image && (
        <div className="w-full aspect-[16/9] overflow-hidden bg-slate-100">
          <img src={`/api/packages/${p.id}/image`} alt={p?.name || 'صورة الباكج'} loading="lazy"
            className="w-full h-full object-cover" onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }} />
        </div>
      )}
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2">
            {selectable && (
              <input type="checkbox" checked={!!selected} onChange={onToggleSelect} onClick={e => e.stopPropagation()} className="mt-1 w-4 h-4 accent-rose-600" title="تحديد للحذف الجماعي" />
            )}
            <div>
              <div className="font-bold text-slate-800">{p?.name || '—'}</div>
              <div className="text-xs text-slate-500">{typeL}</div>
            </div>
          </div>
          <Badge className={closed ? 'bg-slate-200 text-slate-600 hover:bg-slate-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'}>{closed ? 'مغلق' : 'مفتوح'}</Badge>
        </div>
        {p?.meraaj?.shared && (
          <div className="text-[10px] px-2 py-1 rounded-lg bg-gradient-to-l from-purple-50 to-fuchsia-50 border border-purple-200 text-purple-700 font-bold flex items-center justify-between">
            <span>🕋 مُشارَك في معراج نتورك</span>
            <span>{Math.max(0, (Number(p.meraaj.seats_allocated) || 0) - (Number(p.meraaj.seats_sold) || 0))} مقعد متاح</span>
          </div>
        )}
        <div className="text-xs text-slate-500 space-y-0.5">
          {p?.start_date && <div>📅 من {fmtDate(p.start_date)} {p?.end_date && `→ ${fmtDate(p.end_date)}`}</div>}
          <div>🧩 {p?.components_count || 0} مكوّن • 👥 {p?.bookings_count || 0} مسجل {p?.has_image ? '• 📷' : ''}</div>
          {/* v3.52 — pending Meraaj bookings are never invisible anymore */}
          {Number(p?.meraaj_pending_seats) > 0 && (
            <div className="text-[11px] font-black text-amber-700 bg-amber-50 border border-amber-300 rounded-md px-2 py-1 animate-pulse">
              🕋 {p.meraaj_pending_seats} مقعد من معراج بانتظار الاعتماد — افتح "التسجيل والمواصلات"
            </div>
          )}
        </div>
        {/* v3.23 — Feature chips preview */}
        {Array.isArray(p?.features) && p.features.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {p.features.slice(0, 4).map(feat => <span key={feat} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">{feat}</span>)}
            {p.features.length > 4 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">+{p.features.length - 4}</span>}
          </div>
        )}
        <div className="flex flex-wrap gap-1 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={onOpen} className="h-7 px-2 text-xs gap-1"><FileBadge2 className="w-3 h-3" /> التسجيل والمواصلات</Button>
          {onReport && <Button size="sm" variant="outline" onClick={onReport} className="h-7 px-2 text-xs gap-1 text-blue-600"><ReceiptText className="w-3 h-3" /> التقرير</Button>}
          {!closed && onExtend && <Button size="sm" variant="outline" onClick={onExtend} className="h-7 px-2 text-xs gap-1 text-teal-600 border-teal-200 hover:bg-teal-50"><Calendar className="w-3 h-3" /> تمديد التاريخ</Button>}
          {onDuplicate && <Button size="sm" variant="outline" onClick={onDuplicate} className="h-7 px-2 text-xs gap-1 text-purple-600 border-purple-200 hover:bg-purple-50" title="نسخ الباكج بكل مكوناته وأسعاره كمسودة جديدة"><Copy className="w-3 h-3" /> نسخ</Button>}
          {onShowcase && <Button size="sm" variant="outline" onClick={onShowcase} className="h-7 px-2 text-xs gap-1 text-sky-600 border-sky-200 hover:bg-sky-50" title="عرض تسويقي للزبون: الصورة والمميزات والأسعار">👁️ عرض</Button>}
          {onArchive && <Button size="sm" variant="outline" onClick={onArchive} className="h-7 px-2 text-xs gap-1 text-slate-500 border-slate-200 hover:bg-slate-50" title="أرشفة ناعمة: يختفي من الواجهات ومعراج، وتبقى بياناته وقيوده سليمة في النظام">🗂️ أرشفة</Button>}
          {!closed && onMeraaj && <Button size="sm" variant="outline" onClick={onMeraaj} className={`h-7 px-2 text-xs gap-1 ${p?.meraaj?.shared ? 'text-fuchsia-700 border-fuchsia-300 bg-fuchsia-50' : 'text-fuchsia-600 border-fuchsia-200 hover:bg-fuchsia-50'}`} title="مشاركة الباكج في سوق معراج نتورك B2B">🕋 معراج</Button>}
          {!closed && onEdit && <Button size="sm" variant="ghost" onClick={onEdit} className="h-7 px-2 text-xs"><Pencil className="w-3 h-3" /></Button>}
          {!closed && onClose && <Button size="sm" variant="ghost" onClick={onClose} className="h-7 px-2 text-xs text-orange-600">إغلاق</Button>}
          {closed && onReopen && <Button size="sm" variant="ghost" onClick={onReopen} className="h-7 px-2 text-xs text-emerald-600">فتح</Button>}
          {!closed && onDelete && (p?.bookings_count || 0) === 0 && <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 px-2 text-xs text-rose-600"><Trash2 className="w-3 h-3" /></Button>}
        </div>
      </CardContent>
    </Card>
  )
}

// v3.20 — Dual pricing frontend helpers (live preview only; backend is authoritative)
// v3.39 — Searchable account picker with inline quick-add (used for suppliers & clients everywhere)
function SearchPick({ items, value, onChange, placeholder = 'اكتب للبحث...', quickAdds = [], compact = false }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [extra, setExtra] = useState([]) // accounts created inline in this session
  const boxRef = useRef(null)
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const all = [...(items || []), ...extra.filter(x => !(items || []).some(i => i.id === x.id))]
  const sel = all.find(x => x.id === value)
  const norm = (s) => String(s || '').toLowerCase().trim()
  const filtered = all.filter(x => !q.trim() || norm(x.name).includes(norm(q)))
  const exact = all.some(x => norm(x.name) === norm(q))
  const doQuickAdd = async (qa) => {
    const name = q.trim(); if (!name || busy) return
    setBusy(true)
    try {
      const created = await qa.fn(name)
      if (created?.id) {
        const item = { id: created.id, name: created.name || name, badge: qa.badge }
        setExtra(x => [...x, item])
        onChange(created.id, item)
        toast.success(`✅ تمت إضافة "${created.name || name}"`)
        setOpen(false); setQ('')
      }
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 rounded-md border border-input bg-white px-3 text-right ${compact ? 'h-8 text-xs' : 'h-10 text-sm'} ${sel ? 'text-slate-800' : 'text-slate-400'}`}>
        <span className="truncate">{sel ? `${sel.badge ? sel.badge + ' ' : ''}${sel.name}` : placeholder}</span>
        <span className="text-slate-400 text-[10px]">▼</span>
      </button>
      {open && (
        <div className="absolute z-[70] mt-1 w-full min-w-[220px] rounded-lg border bg-white shadow-xl p-2 space-y-1.5">
          <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 اكتب اسم للبحث..." className="h-8 text-xs" />
          <div className="max-h-44 overflow-y-auto space-y-0.5">
            {filtered.slice(0, 60).map(x => (
              <button key={x.id} type="button" onClick={() => { onChange(x.id, x); setOpen(false); setQ('') }}
                className={`w-full text-right px-2 py-1.5 rounded text-xs hover:bg-teal-50 ${x.id === value ? 'bg-teal-50 font-bold text-teal-700' : 'text-slate-700'}`}>
                {x.badge ? `${x.badge} ` : ''}{x.name}
              </button>
            ))}
            {filtered.length === 0 && !q.trim() && <div className="text-[11px] text-slate-400 text-center py-2">لا توجد حسابات بعد — اكتب اسماً لإضافته</div>}
            {filtered.length === 0 && q.trim() && <div className="text-[11px] text-amber-700 text-center py-1.5">"{q.trim()}" غير موجود في القائمة</div>}
          </div>
          {q.trim() && !exact && quickAdds.length > 0 && (
            <div className="border-t pt-1.5 space-y-1">
              {quickAdds.map((qa, i) => (
                <button key={i} type="button" disabled={busy} onClick={() => doQuickAdd(qa)}
                  className="w-full text-right px-2 py-1.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                  {busy ? '⏳ جارِ الإضافة...' : `➕ ${qa.label}: "${q.trim()}"`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
// v3.39 — shared quick-add factories
const quickAddSupplier = (badge = '') => ({ label: 'مورد غير موجود — إضافة جديد', badge, fn: async (name) => await api('/suppliers', { method: 'POST', body: { name } }) })
const quickAddClient = (badge = '') => ({ label: 'عميل غير موجود — إضافة جديد', badge, fn: async (name) => await api('/clients', { method: 'POST', body: { name } }) })
const regAgeCat = (age) => { if (age === '' || age === null || age === undefined) return 'adult'; const a = Number(age); if (a < 2) return 'infant'; if (a < 12) return 'child'; return 'adult' }
function directRoomSaleFE(roomPricing, registrants) {
  const map = {}; (roomPricing || []).forEach(rp => { map[rp.type] = rp })
  let s = 0
  for (const r of (registrants || [])) {
    const rp = map[r.room_type]; if (!rp) continue
    const cat = regAgeCat(r.age)
    if (cat === 'infant') s += Number(rp.sale_infant) || 0
    else if (cat === 'child') s += (rp.sale_child === null || rp.sale_child === undefined || rp.sale_child === '') ? (Number(rp.sale_per_pax) || 0) : (Number(rp.sale_child) || 0)
    else s += Number(rp.sale_per_pax) || 0
  }
  return +s.toFixed(2)
}
function compSaleFE(comps, registrants, billed) {
  let s = 0
  const regs = registrants || []
  for (const c of (comps || [])) {
    const pt = c.pricing_type || 'flat'
    if (regs.length > 0 && pt === 'per_age') {
      for (const r of regs) s += Number(c[`sale_${regAgeCat(r.age)}`]) || 0
    } else if (regs.length > 0 && pt === 'room_age') {
      const map = {}; (c.room_rates || []).forEach(rr => { map[rr.room_type] = rr })
      for (const r of regs) { const rr = map[r.room_type]; if (rr) s += Number(rr[`sale_${regAgeCat(r.age)}`]) || 0 }
    } else {
      const n = (regs.length > 0 && c.include_infants) ? regs.length : billed
      s += (Number(c.sale_per_pax) || 0) * n
    }
  }
  return +s.toFixed(2)
}
const COMP_PRICING_TYPES = [
  { v: 'flat', l: '⚖️ سعر ثابت للفرد (تأشيرة...)' },
  { v: 'per_age', l: '👨‍👩‍👧 حسب العمر (نقل...)' },
  { v: 'room_age', l: '🛏️ غرفة + عمر (فندق...)' },
]

// v3.23 — Package features presets (Miraj Network marketplace readiness)
const FEATURE_PRESETS = ['🧳 شنطة سفر', '🕋 قريب من الحرم', '🤍 إحرام', '🕌 مصلى خاص', '🍽️ وجبات يومية', '☕ إفطار مجاني', '🚌 مواصلات VIP', '🧭 مرشد ديني', '🕍 زيارات المعالم', '💧 ماء زمزم', '📶 واي فاي مجاني', '🛎️ خدمة 24 ساعة']
// v3.23 — Client-side image compression before upload (max 1200px, JPEG)
const compressImage = (file, maxDim = 1200, quality = 0.78) => new Promise((resolve, reject) => {
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.onload = () => {
    let { width, height } = img
    const scale = Math.min(1, maxDim / Math.max(width, height))
    width = Math.round(width * scale); height = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)
    URL.revokeObjectURL(url)
    resolve(canvas.toDataURL('image/jpeg', quality))
  }
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')) }
  img.src = url
})

function PackageDialog({ open, onOpenChange, record, onSaved }) {
  // v3.53 — per-age costs visible only to owner / show_profit holders
  const { user: pfUser } = useAuth()
  const pfCanProfit = pfUser?.role === 'owner' || pfUser?.permissions?.show_profit === true
  // v3.9.6 — Dynamic Package Builder: items list + live totals + supplier per item
  // v3.20 — Dual pricing: 'direct' (room+age matrix, B2B) | 'components' (assembled)
  const [f, setF] = useState({ name: '', package_type: 'umrah', currency: 'SAR', start_date: '', end_date: '', notes: '', pricing_mode: 'direct', supplier_id: '' })
  const [items, setItems] = useState([]) // [{ component_type, name, supplier_id, cost, sale, pricing_type, ... }]
  const [rooms, setRooms] = useState([]) // v3.15/v3.20 — [{type, sale_per_pax, sale_child, sale_infant}]
  const [suppliers, setSuppliers] = useState([])
  const [saving, setSaving] = useState(false)
  // v3.23 — Features + package image (Miraj Network readiness)
  const [features, setFeatures] = useState([])
  const [featureInput, setFeatureInput] = useState('')
  const [imgPreview, setImgPreview] = useState(null) // dataURL (new) or server URL (existing)
  const [imgChanged, setImgChanged] = useState(false)
  const [imgRemoved, setImgRemoved] = useState(false)
  useEffect(() => {
    if (!open) return
    api('/suppliers').then(setSuppliers).catch(() => {})
    if (record) {
      setF({ name: record.name, package_type: record.package_type, currency: record.currency, start_date: record.start_date ? new Date(record.start_date).toISOString().slice(0,10) : '', end_date: record.end_date ? new Date(record.end_date).toISOString().slice(0,10) : '', notes: record.notes || '', pricing_mode: record.pricing_mode || ((record.room_pricing || []).length > 0 ? 'direct' : 'components'), supplier_id: record.supplier_id || '' })
      setItems([])
      setRooms(Array.isArray(record.room_pricing) ? record.room_pricing.map(r => ({ ...r })) : [])
      setHotels(Array.isArray(record.hotels) ? record.hotels.map(h => ({ ...h })) : []) // v3.49
      setFeatures(Array.isArray(record.features) ? [...record.features] : [])
      setImgPreview(record.has_image ? `/api/packages/${record.id}/image?t=${Date.now()}` : null)
      setImgChanged(false); setImgRemoved(false); setFeatureInput('')
    } else {
      setF({ name: '', package_type: 'umrah', currency: 'SAR', start_date: todayISO(), end_date: '', notes: '', pricing_mode: 'direct', supplier_id: '' })
      setItems([])
      setRooms([])
      setHotels([]) // v3.49
      setFeatures([]); setImgPreview(null); setImgChanged(false); setImgRemoved(false); setFeatureInput('')
    }
  }, [open, record])
  // v3.23 — feature helpers
  const toggleFeature = (feat) => setFeatures(fs => fs.includes(feat) ? fs.filter(x => x !== feat) : [...fs, feat])
  const addCustomFeature = () => {
    const v = featureInput.trim().slice(0, 60)
    if (!v) return
    if (!features.includes(v)) setFeatures([...features, v])
    setFeatureInput('')
  }
  const onPickImage = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('اختر ملف صورة (JPG / PNG / WebP)')
    try {
      const dataUrl = await compressImage(file)
      setImgPreview(dataUrl); setImgChanged(true); setImgRemoved(false)
    } catch (err) { toast.error(err.message) }
    e.target.value = ''
  }
  // v3.15 — Room pricing helpers
  const ROOM_PRESETS = ['ثنائي', 'ثلاثي', 'رباعي', 'جماعي']
  const addRoom = (type = '') => setRooms(r => [...r, { type, sale_per_pax: 0, sale_child: '', sale_infant: '' }])
  const updRoom = (i, k, v) => { const c = [...rooms]; c[i] = { ...c[i], [k]: v }; setRooms(c) }
  const rmRoom = (i) => setRooms(rooms.filter((_, idx) => idx !== i))
  // v3.49 — Hotels quick-details helpers (name + city + nights)
  const [hotels, setHotels] = useState([])
  const addHotel = (city = '') => setHotels(h => [...h, { name: '', city, nights: '' }])
  const updHotel = (i, k, v) => { const c = [...hotels]; c[i] = { ...c[i], [k]: v }; setHotels(c) }
  const rmHotel = (i) => setHotels(hotels.filter((_, idx) => idx !== i))
  const hotelNightsTotal = hotels.reduce((s, h) => s + (Number(h.nights) || 0), 0)
  const addItem = () => setItems([...items, { component_type: 'hotel', name: '', supplier_id: '', cost: 0, sale: 0, pricing_type: 'flat', include_infants: false, nights: '', city: '', cost_adult: '', cost_child: '', cost_infant: '', sale_adult: '', sale_child: '', sale_infant: '', room_rates: {} }])
  const updItem = (i, k, v) => { const c = [...items]; c[i] = { ...c[i], [k]: v }; setItems(c) }
  const updItemRoomRate = (i, roomType, k, v) => {
    const c = [...items]
    const rr = { ...(c[i].room_rates || {}) }
    rr[roomType] = { ...(rr[roomType] || {}), [k]: v }
    c[i] = { ...c[i], room_rates: rr }
    setItems(c)
  }
  const rmItem = (i) => setItems(items.filter((_, idx) => idx !== i))
  const nights = f.start_date && f.end_date ? Math.max(0, Math.ceil((new Date(f.end_date) - new Date(f.start_date)) / 86400000)) : 0
  // v3.20 — Estimated per-adult totals for the live summary
  const estCost = (it) => it.pricing_type === 'per_age' ? (Number(it.cost_adult) || 0) : it.pricing_type === 'room_age' ? (Number(Object.values(it.room_rates || {})[0]?.cost_adult) || 0) : (Number(it.cost) || 0)
  const estSale = (it) => it.pricing_type === 'per_age' ? (Number(it.sale_adult) || 0) : it.pricing_type === 'room_age' ? (Number(Object.values(it.room_rates || {})[0]?.sale_adult) || 0) : (Number(it.sale) || 0)
  const totalCost = items.reduce((s, it) => s + estCost(it), 0)
  const totalSale = items.reduce((s, it) => s + estSale(it), 0)
  const profit = totalSale - totalCost
  const marginPct = totalSale > 0 ? +((profit / totalSale) * 100).toFixed(2) : 0
  const save = async () => {
    if (!f.name) return toast.error('اسم الباكج مطلوب')
    if (!record && items.length > 0) {
      const bad = items.find(it => !it.name || !it.supplier_id)
      if (bad) return toast.error('كل بند يحتاج اسم ومورد')
      const badRoomAge = items.find(it => it.pricing_type === 'room_age' && rooms.filter(r => String(r.type || '').trim()).length === 0)
      if (badRoomAge) return toast.error('بند (غرفة + عمر) يحتاج تعريف أنواع الغرف أولاً في قسم التسكين')
    }
    // v3.89 — Task 3: cost must never exceed the sale price (mirrors backend rule:
    // every tier with a sale price > 0 must satisfy cost <= sale)
    const costSaleErr = (() => {
      for (const r of rooms.filter(x => String(x.type || '').trim())) {
        const saleA = Number(r.sale_per_pax) || 0
        const saleC = ((r.sale_child ?? '') === '') ? saleA : (Number(r.sale_child) || 0)
        const saleI = Number(r.sale_infant) || 0
        if (saleA > 0 && (Number(r.cost_adult) || 0) > saleA) return `غرفة «${r.type}»: تكلفة البالغ أعلى من سعر البيع`
        if (saleC > 0 && (Number(r.cost_child) || 0) > saleC) return `غرفة «${r.type}»: تكلفة الطفل أعلى من سعر البيع`
        if (saleI > 0 && (Number(r.cost_infant) || 0) > saleI) return `غرفة «${r.type}»: تكلفة الرضيع أعلى من سعر البيع`
      }
      if (!record && f.pricing_mode !== 'direct') {
        const tiers = [['cost_adult', 'sale_adult', 'بالغ'], ['cost_child', 'sale_child', 'طفل'], ['cost_infant', 'sale_infant', 'رضيع']]
        for (const it of items) {
          if ((it.pricing_type || 'flat') === 'flat') {
            const s = Number(it.sale) || 0
            if (s > 0 && (Number(it.cost) || 0) > s) return `بند «${it.name || '؟'}»: التكلفة أعلى من سعر البيع`
          } else if (it.pricing_type === 'per_age') {
            for (const [ck, sk, lbl] of tiers) {
              const s = Number(it[sk]) || 0
              if (s > 0 && (Number(it[ck]) || 0) > s) return `بند «${it.name || '؟'}» (${lbl}): التكلفة أعلى من سعر البيع`
            }
          } else if (it.pricing_type === 'room_age') {
            for (const [rt, rr] of Object.entries(it.room_rates || {})) {
              for (const [ck, sk, lbl] of tiers) {
                const s = Number(rr?.[sk]) || 0
                if (s > 0 && (Number(rr?.[ck]) || 0) > s) return `بند «${it.name || '؟'}» — غرفة «${rt}» (${lbl}): التكلفة أعلى من سعر البيع`
              }
            }
          }
        }
      }
      return null
    })()
    if (costSaleErr) return toast.error(`🚫 ${costSaleErr} — لا يمكن أن تتجاوز التكلفة سعر البيع`)
    try {
      setSaving(true)
      const roomPricing = rooms.filter(r => String(r.type || '').trim()).map(r => ({ type: r.type, sale_per_pax: Number(r.sale_per_pax) || 0, sale_child: r.sale_child === '' || r.sale_child === null || r.sale_child === undefined ? null : Number(r.sale_child) || 0, sale_infant: r.sale_infant === '' || r.sale_infant === null || r.sale_infant === undefined ? null : Number(r.sale_infant) || 0, cost_adult: r.cost_adult === '' || r.cost_adult === null || r.cost_adult === undefined ? null : Number(r.cost_adult) || 0, cost_child: r.cost_child === '' || r.cost_child === null || r.cost_child === undefined ? null : Number(r.cost_child) || 0, cost_infant: r.cost_infant === '' || r.cost_infant === null || r.cost_infant === undefined ? null : Number(r.cost_infant) || 0 }))
      const hotelsClean = hotels.filter(h => String(h.name || '').trim()).map(h => ({ name: h.name.trim(), city: String(h.city || '').trim(), nights: Number(h.nights) || 0 })) // v3.49
      let savedId = record?.id
      if (record) {
        await api(`/packages/${record.id}`, { method: 'PATCH', body: { name: f.name, package_type: f.package_type, currency: f.currency, start_date: f.start_date || null, end_date: f.end_date || null, notes: f.notes, room_pricing: roomPricing, pricing_mode: f.pricing_mode, features, hotels: hotelsClean, supplier_id: f.supplier_id || null } })
        toast.success('تم التحديث')
      } else {
        const pkg = await api('/packages', { method: 'POST', body: { ...f, room_pricing: roomPricing, features, hotels: hotelsClean } })
        savedId = pkg.id
        // Create each item as a package component
        // v3.39 — unified pricing: in direct mode sale prices come ONLY from the room table (components sale = 0)
        for (const it of items) {
          const isDirectMode = f.pricing_mode === 'direct'
          const body = {
            component_type: it.component_type, name: it.name, supplier_id: it.supplier_id,
            cost_per_pax: Number(it.cost) || 0, sale_per_pax: isDirectMode ? 0 : (Number(it.sale) || 0),
            pricing_type: isDirectMode ? 'flat' : (it.pricing_type || 'flat'), include_infants: !!it.include_infants,
            nights: Number(it.nights) || 0, city: it.city || '',
          }
          if (!isDirectMode && it.pricing_type === 'per_age') {
            for (const k of ['cost_adult', 'cost_child', 'cost_infant', 'sale_adult', 'sale_child', 'sale_infant']) body[k] = Number(it[k]) || 0
          }
          if (!isDirectMode && it.pricing_type === 'room_age') {
            body.room_rates = rooms.filter(r => String(r.type || '').trim()).map(r => {
              const rr = (it.room_rates || {})[r.type] || {}
              return { room_type: r.type, cost_adult: Number(rr.cost_adult) || 0, cost_child: Number(rr.cost_child) || 0, cost_infant: Number(rr.cost_infant) || 0, sale_adult: Number(rr.sale_adult) || 0, sale_child: Number(rr.sale_child) || 0, sale_infant: Number(rr.sale_infant) || 0 }
            })
          }
          await api(`/packages/${pkg.id}/components`, { method: 'POST', body })
        }
        toast.success(`✅ تم إنشاء الباكج${items.length ? ` مع ${items.length} بند` : ''}`)
      }
      // v3.23 — package image upload / removal (after the package doc exists)
      if (savedId) {
        if (imgRemoved && record?.has_image) { try { await api(`/packages/${savedId}/image`, { method: 'DELETE' }) } catch {} }
        if (imgChanged && imgPreview && imgPreview.startsWith('data:')) {
          try { await api(`/packages/${savedId}/image`, { method: 'POST', body: { data: imgPreview } }) }
          catch (e2) { toast.error(`حُفظ الباكج لكن الصورة لم تُرفع: ${e2.message}`) }
        }
      }
      onSaved(); onOpenChange(false)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">🕋 {record ? 'تعديل الباكج' : 'باكج جديد — Dynamic Builder'}</DialogTitle>
        </DialogHeader>
        {/* Package info */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <div className="md:col-span-2"><Field label="اسم الباكج" required><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="عمرة رجب 2026" /></Field></div>
          <Field label="النوع" required><Select value={f.package_type} onValueChange={v => setF({ ...f, package_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PACKAGE_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="العملة"><Select value={f.currency} onValueChange={v => setF({ ...f, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="تاريخ البداية"><Input type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="تاريخ النهاية"><Input type="date" value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label={`المدة${nights > 0 ? ` (${nights} ليلة تلقائي)` : ''}`}><Input value={nights ? `${nights} ليلة` : ''} disabled className="bg-slate-50" /></Field></div>
          {/* v3.51 — Main package supplier: saved with the package in one shot */}
          <div className="md:col-span-6"><Field label="🏢 المورد الرئيسي للباقة (اختياري)"><AccountAutocomplete type="supplier" value={f.supplier_id || null} onChange={(sel) => setF({ ...f, supplier_id: sel?.id || '' })} placeholder="ابحث أو أضف المورد الرئيسي..." /></Field></div>
        </div>
        {/* v3.23 — Features + Image (Miraj Network marketplace readiness) */}
        <div className="border-2 border-purple-200 rounded-xl p-3 mb-3 bg-purple-50/30">
          <div className="font-bold text-slate-800 text-sm mb-2">✨ مميزات البرنامج وصورته <span className="text-[10px] font-normal text-purple-500">(ستظهر للموزعين في سوق معراج نتورك)</span></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {FEATURE_PRESETS.map(feat => (
                  <button key={feat} type="button" onClick={() => toggleFeature(feat)} className={`text-[11px] px-2 py-1 rounded-full border transition ${features.includes(feat) ? 'bg-purple-600 text-white border-purple-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-purple-300'}`}>{feat}</button>
                ))}
              </div>
              {features.filter(x => !FEATURE_PRESETS.includes(x)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {features.filter(x => !FEATURE_PRESETS.includes(x)).map(feat => (
                    <span key={feat} className="text-[11px] px-2 py-1 rounded-full bg-purple-100 text-purple-700 border border-purple-300 flex items-center gap-1">
                      {feat}
                      <button type="button" onClick={() => toggleFeature(feat)} className="text-purple-400 hover:text-rose-500">✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomFeature() } }} placeholder="ميزة مخصصة (مثال: إطلالة على الحرم)..." className="h-8 text-xs flex-1 bg-white" />
                <Button type="button" size="sm" variant="outline" onClick={addCustomFeature} className="h-8 text-xs border-purple-300 text-purple-700">+ إضافة</Button>
              </div>
            </div>
            <div>
              {imgPreview && !imgRemoved ? (
                <div className="relative rounded-lg overflow-hidden border-2 border-purple-200 bg-white">
                  <img src={imgPreview} alt="صورة الباكج" className="w-full h-28 object-cover" />
                  <div className="absolute top-1 left-1 flex gap-1">
                    <label className="cursor-pointer bg-white/90 rounded px-1.5 py-0.5 text-[10px] font-bold text-purple-700 shadow">
                      استبدال<input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickImage} className="hidden" />
                    </label>
                    <button type="button" onClick={() => { setImgRemoved(true); setImgChanged(false); setImgPreview(null) }} className="bg-white/90 rounded px-1.5 py-0.5 text-[10px] font-bold text-rose-600 shadow">حذف</button>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-28 rounded-lg border-2 border-dashed border-purple-300 bg-white cursor-pointer hover:bg-purple-50 transition">
                  <span className="text-2xl">📷</span>
                  <span className="text-[11px] text-slate-500 font-semibold">صورة الباكج (اختياري)</span>
                  <span className="text-[9px] text-slate-400">JPG / PNG — تُضغط تلقائياً</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickImage} className="hidden" />
                </label>
              )}
            </div>
          </div>
        </div>
        {/* v3.20 — Dual Pricing Mode selector */}
        <div className="border-2 border-teal-200 rounded-xl p-3 mb-3 bg-teal-50/40">
          <div className="font-bold text-slate-800 text-sm mb-2">⚙️ نظام التسعير</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button type="button" onClick={() => setF({ ...f, pricing_mode: 'direct' })} className={`text-right rounded-lg border-2 p-3 transition ${f.pricing_mode === 'direct' ? 'border-teal-500 bg-teal-50 shadow-sm' : 'border-slate-200 bg-white hover:border-teal-300'}`}>
              <div className="text-sm font-bold text-slate-800">🏨 تسعير مباشر (غرفة + عمر)</div>
              <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">للباقات الجاهزة B2B — سعر البيع يُحدد لكل فئة عمرية (بالغ / طفل / رضيع) داخل كل نوع غرفة. التكلفة تُحسب من البنود.</div>
            </button>
            <button type="button" onClick={() => setF({ ...f, pricing_mode: 'components' })} className={`text-right rounded-lg border-2 p-3 transition ${f.pricing_mode === 'components' ? 'border-teal-500 bg-teal-50 shadow-sm' : 'border-slate-200 bg-white hover:border-teal-300'}`}>
              <div className="text-sm font-bold text-slate-800">🧩 تسعير المكوّنات</div>
              <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">للمكاتب المُجمِّعة — البيع والتكلفة يُحسبان من كل بند حسب نوعه: تأشيرة (ثابت)، نقل (حسب العمر)، فندق (غرفة + عمر).</div>
            </button>
          </div>
        </div>
        {/* v3.15/v3.20 — Room-type pricing (accommodation) — available in create AND edit */}
        <div className="border-2 border-dashed border-indigo-200 rounded-xl p-3 mb-3 bg-indigo-50/40">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="font-bold text-slate-800 text-sm">🛏️ {f.pricing_mode === 'direct' ? 'التسعير المباشر حسب الغرفة والعمر (سعر البيع للفرد)' : 'أنواع التسكين (لتوزيع الغرف في الحجوزات)'}</div>
            <div className="flex gap-1 flex-wrap">
              {ROOM_PRESETS.filter(p => !rooms.some(r => r.type === p)).map(p => (
                <Button key={p} size="sm" variant="outline" onClick={() => addRoom(p)} className="h-7 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50">+ {p}</Button>
              ))}
              <Button size="sm" variant="outline" onClick={() => addRoom('')} className="h-7 text-xs">+ نوع آخر</Button>
            </div>
          </div>
          {rooms.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-2">{f.pricing_mode === 'direct' ? 'أضف أنواع الغرف وحدد سعر كل فئة عمرية — سيُحسب سعر كل مسجّل حسب غرفته وعمره.' : 'لم تُحدد أنواع تسكين — أضفها لتظهر كخيارات توزيع الغرف عند تسجيل الأفراد.'}</div>
          ) : f.pricing_mode === 'direct' ? (
            <div className="space-y-2">
              <div className="hidden md:grid md:grid-cols-12 gap-2 px-2 text-[10px] text-slate-500 font-semibold">
                <div className="col-span-3">نوع الغرفة</div>
                <div className="col-span-3">👨 بالغ (12+)</div>
                <div className="col-span-3">🧒 طفل (2-11) — فارغ = كالبالغ</div>
                <div className="col-span-2">👶 رضيع (&lt;2) — فارغ = 0</div>
              </div>
              <div className="text-[10px] text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-2 py-1">
                ℹ️ تُرسل الأسعار لمعراج <b>مكتملة دائماً</b>: الطفل الفارغ يُرسل بسعر البالغ، والرضيع الفارغ يُرسل 0 — لا قيم فارغة تسبب NaN.
              </div>
              {rooms.map((r, i) => (
                <div key={i} className="bg-white rounded-lg border p-2 space-y-1.5">
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center">
                  <Input value={r.type} onChange={e => updRoom(i, 'type', e.target.value)} placeholder="نوع الغرفة (ثنائي...)" className="h-8 text-xs md:col-span-3" />
                  <Input type="number" min="0" value={r.sale_per_pax} onChange={e => updRoom(i, 'sale_per_pax', e.target.value)} placeholder="سعر البالغ" className="h-8 text-xs font-bold md:col-span-3" />
                  <Input type="number" min="0" value={r.sale_child ?? ''} onChange={e => updRoom(i, 'sale_child', e.target.value)} placeholder="سعر الطفل" className="h-8 text-xs md:col-span-3" />
                  <div className="flex items-center gap-1 md:col-span-3">
                    <Input type="number" min="0" value={r.sale_infant ?? ''} onChange={e => updRoom(i, 'sale_infant', e.target.value)} placeholder="سعر الرضيع" className="h-8 text-xs flex-1" />
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">{f.currency}</span>
                    <Button size="sm" variant="ghost" onClick={() => rmRoom(i)} className="h-7 w-7 p-0 text-rose-500"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                  </div>
                  {/* v3.53 — per-age COSTS row (owner/show_profit only) for accurate per-category profit */}
                  {pfCanProfit && (
                    <div className="grid grid-cols-3 md:grid-cols-12 gap-2 items-center bg-rose-50/40 border border-rose-100 rounded-md p-1.5">
                      <div className="hidden md:block md:col-span-3 text-[10px] font-bold text-rose-700">💸 التكلفة لكل فئة:</div>
                      <Input type="number" min="0" value={r.cost_adult ?? ''} onChange={e => updRoom(i, 'cost_adult', e.target.value)} placeholder="تكلفة البالغ" className="h-7 text-[11px] md:col-span-3" />
                      <Input type="number" min="0" value={r.cost_child ?? ''} onChange={e => updRoom(i, 'cost_child', e.target.value)} placeholder="تكلفة الطفل" className="h-7 text-[11px] md:col-span-3" />
                      <Input type="number" min="0" value={r.cost_infant ?? ''} onChange={e => updRoom(i, 'cost_infant', e.target.value)} placeholder="تكلفة الرضيع" className="h-7 text-[11px] md:col-span-3" />
                      {/* v3.55 — LIVE per-age profit badges (updates as you type; mirrors backend semantics: empty child sale = adult, empty infant sale = 0, empty costs = 0) */}
                      {(() => {
                        const saleA = Number(r.sale_per_pax) || 0
                        const saleC = ((r.sale_child ?? '') === '') ? saleA : (Number(r.sale_child) || 0)
                        const saleI = Number(r.sale_infant) || 0
                        const costA = Number(r.cost_adult) || 0
                        const costC = Number(r.cost_child) || 0
                        const costI = Number(r.cost_infant) || 0
                        const tiers = [
                          { key: 'a', icon: '👨', label: 'بالغ', sale: saleA, cost: costA },
                          { key: 'c', icon: '🧒', label: 'طفل', sale: saleC, cost: costC },
                          { key: 'i', icon: '👶', label: 'رضيع', sale: saleI, cost: costI },
                        ].filter(t => t.sale > 0 || t.cost > 0)
                        if (tiers.length === 0) return null
                        return (
                          <div className="col-span-3 md:col-span-12 flex flex-wrap items-center gap-1.5 pt-0.5">
                            <span className="text-[10px] font-bold text-slate-500">📈 الربح المباشر:</span>
                            {tiers.map(t => {
                              const profit = t.sale - t.cost
                              const pct = t.sale > 0 ? Math.round((profit / t.sale) * 1000) / 10 : null
                              const cls = profit > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : profit < 0 ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-slate-50 border-slate-200 text-slate-500'
                              return (
                                <span key={t.key} className={`text-[10px] font-bold border rounded-md px-1.5 py-0.5 whitespace-nowrap ${cls}`}>
                                  {t.icon} {t.label}: {profit.toLocaleString('en-US')} {f.currency}{pct !== null ? ` (${pct}%)` : ''}{profit < 0 ? ' ⚠️ خسارة' : ''}
                                </span>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-2">
              {rooms.map((r, i) => (
                <div key={i} className="flex items-center gap-2 bg-white rounded-lg border p-2">
                  <Input value={r.type} onChange={e => updRoom(i, 'type', e.target.value)} placeholder="نوع الغرفة (ثنائي...)" className="h-8 text-xs flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => rmRoom(i)} className="h-7 w-7 p-0 text-rose-500"><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* v3.49 — Hotels quick-details: name + city + nights (shown in program details & showcase) */}
        <div className="border-2 border-dashed border-amber-200 rounded-xl p-3 mb-3 bg-amber-50/40">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="font-bold text-slate-800 text-sm">🏨 تفاصيل الفنادق والليالي</div>
            <div className="flex gap-1 flex-wrap">
              {!hotels.some(h => h.city === 'مكة المكرمة') && <Button size="sm" variant="outline" onClick={() => addHotel('مكة المكرمة')} className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50">+ فندق مكة</Button>}
              {!hotels.some(h => h.city === 'المدينة المنورة') && <Button size="sm" variant="outline" onClick={() => addHotel('المدينة المنورة')} className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50">+ فندق المدينة</Button>}
              <Button size="sm" variant="outline" onClick={() => addHotel('')} className="h-7 text-xs">+ فندق آخر</Button>
            </div>
          </div>
          {hotels.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-2">أضف فنادق البرنامج (الاسم + المدينة + عدد الليالي) — ستظهر بدقة في تفاصيل البرنامج ورسالة الواتساب.</div>
          ) : (
            <div className="space-y-2">
              <div className="hidden md:grid md:grid-cols-12 gap-2 px-2 text-[10px] text-slate-500 font-semibold">
                <div className="col-span-5">اسم الفندق</div>
                <div className="col-span-4">المدينة</div>
                <div className="col-span-3">🌙 عدد الليالي</div>
              </div>
              {hotels.map((h, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center bg-white rounded-lg border p-2">
                  <Input value={h.name} onChange={e => updHotel(i, 'name', e.target.value)} placeholder="اسم الفندق (رتاج الحرم...)" className="h-8 text-xs font-semibold md:col-span-5 col-span-2" />
                  <Input value={h.city} onChange={e => updHotel(i, 'city', e.target.value)} placeholder="المدينة (مكة المكرمة...)" className="h-8 text-xs md:col-span-4" />
                  <div className="flex items-center gap-1 md:col-span-3">
                    <Input type="number" min="0" value={h.nights} onChange={e => updHotel(i, 'nights', e.target.value)} placeholder="الليالي" className="h-8 text-xs flex-1" />
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">ليلة</span>
                    <Button size="sm" variant="ghost" onClick={() => rmHotel(i)} className="h-7 w-7 p-0 text-rose-500"><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
              {nights > 0 && (
                <div className={`text-[11px] font-bold rounded-md px-2 py-1 border ${hotelNightsTotal === nights ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700'}`}>
                  🌙 مجموع ليالي الفنادق: {hotelNightsTotal} من أصل {nights} ليلة للبرنامج {hotelNightsTotal === nights ? '✓ متطابق' : hotelNightsTotal > nights ? '⚠️ أكثر من مدة البرنامج' : `(${nights - hotelNightsTotal} ليلة غير موزعة)`}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Dynamic items list — only for NEW packages */}
        {!record && (
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-3 mb-3 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold text-slate-800 text-sm">📦 بنود الخدمات الديناميكية</div>
              <Button size="sm" variant="outline" onClick={addItem} className="gap-1 h-7 text-xs border-teal-300 text-teal-700 hover:bg-teal-50"><Plus className="w-3 h-3" /> إضافة بند/خدمة</Button>
            </div>
            {items.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-4">لا توجد بنود بعد — اضغط "+ إضافة بند/خدمة" لبناء الباكج</div>
            ) : (
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="bg-white p-2 rounded-lg border space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-2">
                        <div className="text-[10px] text-slate-500 mb-1">نوع الخدمة</div>
                        <Select value={it.component_type} onValueChange={v => updItem(i, 'component_type', v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{COMPONENT_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <div className="text-[10px] text-slate-500 mb-1">الاسم / التفاصيل</div>
                        <Input value={it.name} onChange={e => updItem(i, 'name', e.target.value)} className="h-8 text-xs" placeholder="فندق مكة رتاج الحرم" />
                      </div>
                      <div className="col-span-3">
                        <div className="text-[10px] text-slate-500 mb-1">المورد (شجرة الحسابات) *</div>
                        <AccountAutocomplete type="supplier" compact value={it.supplier_id || null} onChange={(sel) => updItem(i, 'supplier_id', sel?.id || '')} placeholder="ابحث أو أضف مورداً..." />
                      </div>
                      {f.pricing_mode !== 'direct' ? (
                        <div className="col-span-3">
                          <div className="text-[10px] text-slate-500 mb-1">طريقة تسعير البند</div>
                          <Select value={it.pricing_type || 'flat'} onValueChange={v => updItem(i, 'pricing_type', v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{COMP_PRICING_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="col-span-3 flex items-end pb-1.5"><span className="text-[10px] text-teal-700 font-semibold">💡 سعر البيع من جدول الغرف أعلاه</span></div>
                      )}
                      <div className="col-span-1"><Button size="sm" variant="ghost" onClick={() => rmItem(i)} className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"><Trash2 className="w-3 h-3" /></Button></div>
                    </div>
                    {it.component_type === 'hotel' && (
                      <div className="grid grid-cols-12 gap-2 items-end bg-indigo-50/60 border border-indigo-200 rounded p-1.5">
                        <div className="col-span-3"><div className="text-[10px] text-indigo-700 mb-1">🌙 عدد الليالي</div><Input type="number" min="1" value={it.nights} onChange={e => updItem(i, 'nights', e.target.value)} placeholder="3" className="h-8 text-xs bg-white" /></div>
                        <div className="col-span-5"><div className="text-[10px] text-indigo-700 mb-1">🕌 المدينة</div><Input value={it.city} onChange={e => updItem(i, 'city', e.target.value)} placeholder="مكة المكرمة" className="h-8 text-xs bg-white" /></div>
                        <div className="col-span-4 flex items-end pb-1.5">
                          <span className="text-[10px] text-indigo-700 font-bold">مجموع ليالي الفنادق: {items.filter(x => x.component_type === 'hotel').reduce((s, x) => s + (Number(x.nights) || 0), 0)}{f.start_date && f.end_date ? ` / المدة ${Math.max(0, Math.round((new Date(f.end_date) - new Date(f.start_date)) / 86400000))} ليلة` : ''}</span>
                        </div>
                      </div>
                    )}
                    {(f.pricing_mode === 'direct' || (it.pricing_type || 'flat') === 'flat') && (
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-3"><div className="text-[10px] text-slate-500 mb-1">{f.pricing_mode === 'direct' ? '💰 تكلفة المورد / فرد (اختياري)' : 'تكلفة / فرد'}</div><Input type="number" min="0" value={it.cost} onChange={e => updItem(i, 'cost', e.target.value)} className="h-8 text-xs" step="0.01" /></div>
                        {f.pricing_mode !== 'direct' && <div className="col-span-3"><div className="text-[10px] text-slate-500 mb-1">بيع / فرد</div><Input type="number" min="0" value={it.sale} onChange={e => updItem(i, 'sale', e.target.value)} className="h-8 text-xs" step="0.01" /></div>}
                        {f.pricing_mode !== 'direct' && <div className="col-span-2 text-center">
                          <div className="text-[10px] text-slate-500 mb-1">ربح / فرد</div>
                          <div className={`text-xs font-bold ${(Number(it.sale) - Number(it.cost)) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{((Number(it.sale) || 0) - (Number(it.cost) || 0)).toFixed(2)}</div>
                        </div>}
                        <div className="col-span-4 flex items-center gap-2 pb-1">
                          <input type="checkbox" id={`inf-${i}`} checked={!!it.include_infants} onChange={e => updItem(i, 'include_infants', e.target.checked)} className="w-4 h-4 accent-teal-600" />
                          <label htmlFor={`inf-${i}`} className="text-[11px] text-slate-600 cursor-pointer">يُحتسب للرضّع أيضاً (مثل رسوم التأشيرة)</label>
                        </div>
                      </div>
                    )}
                    {f.pricing_mode !== 'direct' && it.pricing_type === 'per_age' && (
                      <div className="grid grid-cols-3 gap-2">
                        {[{ k: 'adult', l: '👨 بالغ (12+)' }, { k: 'child', l: '🧒 طفل (2-11)' }, { k: 'infant', l: '👶 رضيع (<2)' }].map(cat => (
                          <div key={cat.k} className="rounded-lg border bg-slate-50/60 p-2 space-y-1">
                            <div className="text-[10px] font-bold text-slate-600">{cat.l}</div>
                            <Input type="number" min="0" value={it[`cost_${cat.k}`]} onChange={e => updItem(i, `cost_${cat.k}`, e.target.value)} placeholder="تكلفة" className="h-7 text-xs" step="0.01" />
                            <Input type="number" min="0" value={it[`sale_${cat.k}`]} onChange={e => updItem(i, `sale_${cat.k}`, e.target.value)} placeholder="بيع" className="h-7 text-xs font-bold" step="0.01" />
                          </div>
                        ))}
                      </div>
                    )}
                    {f.pricing_mode !== 'direct' && it.pricing_type === 'room_age' && (
                      rooms.filter(r => String(r.type || '').trim()).length === 0 ? (
                        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ أضف أنواع الغرف في قسم التسكين أعلاه أولاً — ثم حدّد أسعار هذا البند لكل غرفة.</div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="hidden md:grid md:grid-cols-13 gap-1 px-1 text-[9px] text-slate-500 font-semibold" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
                            <div>الغرفة</div>
                            <div className="col-span-2">تكلفة بالغ</div><div className="col-span-2">بيع بالغ</div>
                            <div className="col-span-2">تكلفة طفل</div><div className="col-span-2">بيع طفل</div>
                            <div className="col-span-2">تكلفة رضيع</div><div className="col-span-2">بيع رضيع</div>
                          </div>
                          {rooms.filter(r => String(r.type || '').trim()).map(r => {
                            const rr = (it.room_rates || {})[r.type] || {}
                            return (
                              <div key={r.type} className="grid gap-1 items-center" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
                                <div className="text-[10px] font-bold text-slate-700 truncate">🛏️ {r.type}</div>
                                <Input type="number" min="0" value={rr.cost_adult ?? ''} onChange={e => updItemRoomRate(i, r.type, 'cost_adult', e.target.value)} className="h-7 text-[10px] col-span-2" placeholder="0" />
                                <Input type="number" min="0" value={rr.sale_adult ?? ''} onChange={e => updItemRoomRate(i, r.type, 'sale_adult', e.target.value)} className="h-7 text-[10px] col-span-2 font-bold" placeholder="0" />
                                <Input type="number" min="0" value={rr.cost_child ?? ''} onChange={e => updItemRoomRate(i, r.type, 'cost_child', e.target.value)} className="h-7 text-[10px] col-span-2" placeholder="0" />
                                <Input type="number" min="0" value={rr.sale_child ?? ''} onChange={e => updItemRoomRate(i, r.type, 'sale_child', e.target.value)} className="h-7 text-[10px] col-span-2 font-bold" placeholder="0" />
                                <Input type="number" min="0" value={rr.cost_infant ?? ''} onChange={e => updItemRoomRate(i, r.type, 'cost_infant', e.target.value)} className="h-7 text-[10px] col-span-2" placeholder="0" />
                                <Input type="number" min="0" value={rr.sale_infant ?? ''} onChange={e => updItemRoomRate(i, r.type, 'sale_infant', e.target.value)} className="h-7 text-[10px] col-span-2 font-bold" placeholder="0" />
                              </div>
                            )
                          })}
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Live Totals */}
            {items.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-200">
                <div className="rounded-lg bg-orange-50 border border-orange-200 p-2 text-center">
                  <div className="text-[10px] text-orange-700 font-semibold">التكلفة التقديرية / بالغ</div>
                  <div className="text-sm font-black text-orange-800">{totalCost.toLocaleString('en-US', { maximumFractionDigits: 2 })} {f.currency}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-center">
                  <div className="text-[10px] text-emerald-700 font-semibold">البيع التقديري / بالغ</div>
                  <div className="text-sm font-black text-emerald-800">{totalSale.toLocaleString('en-US', { maximumFractionDigits: 2 })} {f.currency}</div>
                </div>
                <div className={`rounded-lg border p-2 text-center ${profit >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className={`text-[10px] font-semibold ${profit >= 0 ? 'text-blue-700' : 'text-rose-700'}`}>الربح المتوقع</div>
                  <div className={`text-sm font-black ${profit >= 0 ? 'text-blue-800' : 'text-rose-800'}`}>{profit.toLocaleString('en-US', { maximumFractionDigits: 2 })} {f.currency}</div>
                </div>
                <div className="rounded-lg bg-fuchsia-50 border border-fuchsia-200 p-2 text-center">
                  <div className="text-[10px] text-fuchsia-700 font-semibold">هامش الربح</div>
                  <div className="text-sm font-black text-fuchsia-800">{marginPct}%</div>
                </div>
              </div>
            )}
          </div>
        )}
        <Field label="ملاحظات"><Textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving} className="grad-brand text-white gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (record ? 'حفظ' : `🚀 إنشاء الباكج${items.length ? ` + ${items.length} بند` : ''}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PackageDetailsDialog({ pkg, onClose, onChanged }) {
  // v3.50 — RBAC Phase 2: costs/components/transports tabs are financial — owner or show_profit only
  const { user: pdUser } = useAuth()
  const canProfit = pdUser?.role === 'owner' || pdUser?.permissions?.show_profit === true
  const [tab, setTab] = useState(canProfit ? 'components' : 'bookings')
  const [comps, setComps] = useState([])
  const [bookings, setBookings] = useState([])
  const [transports, setTransports] = useState([]) // v3.9.26 — Package transports
  const [newTransport, setNewTransport] = useState({ name: '', type: 'bus', capacity: 44, driver_name: '', driver_phone: '', vehicle_plate: '', flight_no: '' })
  const [bookingSearch, setBookingSearch] = useState('') // v3.9.20 — Search field
  const [editingBooking, setEditingBooking] = useState(null) // v3.9.21 — Booking edit state
  const [monitorBooking, setMonitorBooking] = useState(null) // v3.16 — Send registrants to visa monitoring
  const [suppliers, setSuppliers] = useState([])
  const [clients, setClients] = useState([])
  const [boxes, setBoxes] = useState([])
  const [newComp, setNewComp] = useState({ name: '', component_type: 'ticket', supplier_id: '', cost_per_pax: '', sale_per_pax: '', notes: '', pricing_type: 'flat', include_infants: false, nights: '', city: '', cost_adult: '', cost_child: '', cost_infant: '', sale_adult: '', sale_child: '', sale_infant: '', room_rates: {} })
  const [newBooking, setNewBooking] = useState({ client_id: '', pilgrim_name: '', passport_no: '', pax_adults: 1, pax_children: 0, pax_infants: 0, birth_date: '', payment_method: 'credit', box_id: '', transport_id: '', notes: '', registrants: [], discount: '', discount_reason: '' })
  const [inbound, setInbound] = useState([]) // v3.52 — pending Meraaj bookings visible in the registrants tab
  const load = () => Promise.all([
    api(`/packages/${pkg.id}/components`).then(setComps),
    api(`/packages/${pkg.id}/bookings`).then(setBookings),
    api(`/packages/${pkg.id}/transports`).then(setTransports).catch(() => setTransports([])),
    api(`/packages/${pkg.id}/inbound-bookings`).then(r => setInbound((r || []).filter(x => x.status === 'new'))).catch(() => setInbound([])),
    api('/suppliers').then(setSuppliers), api('/clients').then(setClients), api('/boxes').then(setBoxes),
  ]).catch(e => toast.error(e.message))
  // v3.52 — approve a pending Meraaj booking directly from the registrants tab
  const canApproveMeraaj = pdUser?.role === 'owner' || pdUser?.permissions?.mod_meraaj === true
  const approveInbound = async (ib) => {
    if (!(await askConfirm({ title: `اعتماد حجز "${ib.buyer_office_name}"`, desc: `اعتماد الحجز (${ib.seats} مقعد — ${(ib.registrants || []).length} مسافر) وتحويله لحجز فعلي؟ ستظهر أسماء المسافرين فوراً في قائمة المسجلين.`, icon: '✅', confirmLabel: 'اعتماد وإظهار المسجلين' }))) return
    try {
      await api(`/meraaj/inbound-bookings/${ib.id}/approve`, { method: 'POST' })
      toast.success('✅ تم الاعتماد — المسافرون الآن في قائمة المسجلين')
      await load(); onChanged && onChanged()
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [pkg.id])
  // v3.39 — UNIFIED PRICING: direct mode = package room table is THE price source; components = details only
  const pkgIsDirect = (pkg.pricing_mode || ((pkg.room_pricing || []).length > 0 ? 'direct' : 'components')) === 'direct'
  const addComp = async () => {
    if (!newComp.name || !newComp.supplier_id) return toast.error('اسم المكوّن والمورد مطلوبان')
    if (newComp.pricing_type === 'room_age' && (pkg.room_pricing || []).length === 0) return toast.error('حدّد أنواع الغرف في إعدادات الباكج أولاً (تعديل الباكج → التسكين)')
    try {
      const body = { ...newComp }
      delete body._showCost
      // v3.39 — UNIFIED PRICING: in direct mode the package room table is the single source of sale prices.
      // Components carry details only (name/supplier) + optional supplier cost for accounting.
      if (pkgIsDirect) { body.pricing_type = 'flat'; body.sale_per_pax = 0 }
      if (newComp.pricing_type === 'room_age' && !pkgIsDirect) {
        body.room_rates = (pkg.room_pricing || []).map(rp => {
          const rr = (newComp.room_rates || {})[rp.type] || {}
          return { room_type: rp.type, cost_adult: Number(rr.cost_adult) || 0, cost_child: Number(rr.cost_child) || 0, cost_infant: Number(rr.cost_infant) || 0, sale_adult: Number(rr.sale_adult) || 0, sale_child: Number(rr.sale_child) || 0, sale_infant: Number(rr.sale_infant) || 0 }
        })
      } else { delete body.room_rates }
      await api(`/packages/${pkg.id}/components`, { method: 'POST', body }); toast.success('تمت الإضافة'); setNewComp({ name: '', component_type: 'ticket', supplier_id: '', cost_per_pax: '', sale_per_pax: '', notes: '', pricing_type: 'flat', include_infants: false, nights: '', city: '', cost_adult: '', cost_child: '', cost_infant: '', sale_adult: '', sale_child: '', sale_infant: '', room_rates: {} }); load(); onChanged && onChanged() }
    catch (e) { toast.error(e.message) }
  }
  const delComp = async (id) => { if (!(await askConfirm({ title: 'حذف المكوّن', desc: 'سيتم حذف هذا المكوّن من الباكج.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return; try { await api(`/packages/${pkg.id}/components/${id}`, { method: 'DELETE' }); load(); onChanged && onChanged() } catch (e) { toast.error(e.message) } }
  // v3.9.26 — Transport CRUD
  const addTransport = async () => {
    if (!newTransport.name.trim()) return toast.error('اسم وسيلة النقل مطلوب')
    try { await api(`/packages/${pkg.id}/transports`, { method: 'POST', body: newTransport }); toast.success('✅ تمت الإضافة'); setNewTransport({ name: '', type: 'bus', capacity: 44, driver_name: '', driver_phone: '', vehicle_plate: '', flight_no: '' }); load() }
    catch (e) { toast.error(e.message) }
  }
  const delTransport = async (t) => { if (!(await askConfirm({ title: 'حذف وسيلة النقل', desc: `حذف وسيلة النقل "${t.name}"؟`, variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return; try { await api(`/packages/${pkg.id}/transports/${t.id}`, { method: 'DELETE' }); toast.success('تم الحذف'); load() } catch (e) { toast.error(e.message) } }
  const toggleTransportStatus = async (t) => { try { await api(`/packages/${pkg.id}/transports/${t.id}`, { method: 'PATCH', body: { status: t.status === 'open' ? 'closed' : 'open' } }); load() } catch (e) { toast.error(e.message) } }
  const addBooking = async () => {
    // v3.9.22 — Unified payment: credit → client_id required; cash → box_id required
    if (newBooking.payment_method === 'credit' && !newBooking.client_id) return toast.error('اختر حساب القبض / العميل (للحجز الآجل)')
    if (newBooking.payment_method === 'cash' && !newBooking.box_id) return toast.error('اختر الصندوق / البنك (للنقد)')
    if (comps.length === 0) return toast.error('أضف مكونات الباكج أولاً')
    try { await api(`/packages/${pkg.id}/bookings`, { method: 'POST', body: newBooking }); toast.success('✅ تم التسجيل + قيد محاسبي'); setNewBooking({ client_id: '', pilgrim_name: '', passport_no: '', pax_adults: 1, pax_children: 0, pax_infants: 0, birth_date: '', payment_method: 'credit', box_id: '', transport_id: '', notes: '', registrants: [], discount: '', discount_reason: '' }); load(); onChanged && onChanged() }
    catch (e) { toast.error(e.message) }
  }
  const totalCost = comps.reduce((s, c) => s + (c.cost_per_pax || 0), 0)
  const totalSale = comps.reduce((s, c) => s + (c.sale_per_pax || 0), 0)
  const profit = totalSale - totalCost
  // v3.16 — Rooming List print (hotel-ready, grouped by room type)
  const printRoomingList = () => {
    const regs = []
    bookings.forEach(b => (b.registrants || []).forEach(r => regs.push({ ...r, client: b.client_name || b.pilgrim_name || '—' })))
    if (regs.length === 0) return toast.error('لا يوجد مسجلون بقوائم تسكين في هذا الباكج بعد')
    const groups = {}
    regs.forEach(r => { const k = r.room_type || 'غير محدد'; (groups[k] = groups[k] || []).push(r) })
    const sections = Object.entries(groups).map(([room, list]) => `
      <h2>🛏️ ${room} — ${list.length} فرد</h2>
      <table><thead><tr><th>م</th><th>الاسم</th><th>رقم الجواز</th><th>العمر</th><th>رقم التأشيرة</th><th>صاحب الحجز</th></tr></thead>
      <tbody>${list.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name || ''}</td><td>${r.passport_no || ''}</td><td>${r.age ?? ''}</td><td>${r.visa_no || ''}</td><td>${r.client || ''}</td></tr>`).join('')}</tbody></table>`).join('')
    const w = window.open('', '_blank')
    if (!w) return toast.error('فضلاً اسمح بالنوافذ المنبثقة للطباعة')
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف التسكين — ${pkg.name}</title>
      <style>
        body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:18px;color:#0f172a}
        h1{font-size:18px;margin:0} .sub{font-size:11px;color:#64748b;margin:4px 0 14px}
        h2{font-size:14px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:6px 10px;margin:14px 0 6px}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
        th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:right}
        th{background:#f1f5f9}
        @media print{@page{size:A4;margin:10mm}}
      </style></head><body>
      <h1>🛏️ كشف التسكين — ${pkg.name}</h1>
      <div class="sub">التاريخ: ${new Date().toLocaleDateString('ar-EG')} • إجمالي المسجلين: ${regs.length} • أنواع الغرف: ${Object.keys(groups).length}${pkg.start_date ? ' • البرنامج: ' + String(pkg.start_date).slice(0, 10) + (pkg.end_date ? ' → ' + String(pkg.end_date).slice(0, 10) : '') : ''}</div>
      ${sections}
      </body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400)
  }
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pkg.name} — {PACKAGE_TYPES.find(t => t.v === pkg.package_type)?.l}</DialogTitle>
          <DialogDescription>{canProfit ? (<>سعر الفرد الواحد: تكلفة <b>{fmt(totalCost, pkg.currency)}</b> • بيع <b>{fmt(totalSale, pkg.currency)}</b> • ربح <b className="text-emerald-600">{fmt(profit, pkg.currency)}</b></>) : (<>سعر الفرد الواحد (بيع): <b>{fmt(totalSale, pkg.currency)}</b></>)}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 mb-3 border-b flex-wrap">
          {canProfit && <button onClick={() => setTab('components')} className={`px-4 py-2 text-sm font-bold border-b-2 ${tab === 'components' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}>🧩 المكونات ({comps.length})</button>}
          {canProfit && <button onClick={() => setTab('transports')} className={`px-4 py-2 text-sm font-bold border-b-2 ${tab === 'transports' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>🚌 وسائل النقل ({transports.length})</button>}
          <button onClick={() => setTab('bookings')} className={`px-4 py-2 text-sm font-bold border-b-2 ${tab === 'bookings' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500'}`}>👥 المسجلون ({bookings.length}){inbound.length > 0 && <span className="ms-1 text-[10px] bg-amber-500 text-white rounded-full px-1.5 py-0.5">🕋 +{inbound.length}</span>}</button>
          <button onClick={printRoomingList} className="px-4 py-2 text-sm font-bold text-indigo-600 hover:text-indigo-800 ms-auto">🖨️ كشف التسكين</button>
        </div>
        {canProfit && tab === 'components' && (
          <div className="space-y-3">
            {pkg.status !== 'closed' && (
              <div className="p-3 bg-slate-50 rounded-lg space-y-2">
                <div className={`grid grid-cols-1 ${pkgIsDirect ? 'md:grid-cols-4' : 'md:grid-cols-5'} gap-2`}>
                  <Field label="نوع"><Select value={newComp.component_type} onValueChange={v => setNewComp({ ...newComp, component_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COMPONENT_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="الاسم"><Input value={newComp.name} onChange={e => setNewComp({ ...newComp, name: e.target.value })} placeholder="فندق البلد" /></Field>
                  <Field label="المورد"><AccountAutocomplete type="supplier" value={newComp.supplier_id || null} onChange={(sel) => setNewComp({ ...newComp, supplier_id: sel?.id || '' })} placeholder="ابحث أو أضف مورداً..." /></Field>
                  {!pkgIsDirect && <Field label="طريقة التسعير"><Select value={newComp.pricing_type} onValueChange={v => setNewComp({ ...newComp, pricing_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{COMP_PRICING_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent></Select></Field>}
                  <div className="flex items-end"><Button onClick={addComp} className="w-full grad-brand text-white gap-1"><Plus className="w-4 h-4" /> إضافة</Button></div>
                </div>
                {newComp.component_type === 'hotel' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 bg-indigo-50/60 border border-indigo-200 rounded-lg p-2">
                    <Field label="🌙 عدد الليالي"><Input type="number" min="1" value={newComp.nights} onChange={e => setNewComp({ ...newComp, nights: e.target.value })} placeholder="مثال: 3" className="bg-white" /></Field>
                    <Field label="🕌 المدينة"><Input value={newComp.city} onChange={e => setNewComp({ ...newComp, city: e.target.value })} placeholder="مكة المكرمة / المدينة المنورة" className="bg-white" /></Field>
                    {(() => {
                      const hotelNights = comps.filter(x => x.component_type === 'hotel').reduce((s, x) => s + (Number(x.nights) || 0), 0) + (Number(newComp.nights) || 0)
                      const durationNights = pkg.start_date && pkg.end_date ? Math.max(0, Math.round((new Date(pkg.end_date) - new Date(pkg.start_date)) / 86400000)) : null
                      return (
                        <div className="flex items-end pb-1">
                          <span className={`text-[11px] font-bold px-2 py-1 rounded ${durationNights !== null && hotelNights > durationNights ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'}`}>
                            مجموع الليالي: {hotelNights}{durationNights !== null ? ` / مدة البرنامج ${durationNights} ليلة` : ''}
                            {durationNights !== null && hotelNights > durationNights ? ' ⚠️ يتجاوز المدة' : ''}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                )}
                {pkgIsDirect && (
                  <div className="space-y-2">
                    <div className="text-[11px] text-teal-800 bg-teal-50 border border-teal-200 rounded-lg p-2">
                      💡 <b>التسعير موحد:</b> أسعار البيع تُؤخذ تلقائياً من جدول الغرف في الباكج — المكونات هنا للتفاصيل فقط (اسم الفندق، المورد...) بدون إدخال أسعار.
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-600">
                      <input type="checkbox" checked={!!newComp._showCost} onChange={e => setNewComp({ ...newComp, _showCost: e.target.checked, ...(e.target.checked ? {} : { cost_per_pax: '' }) })} className="w-4 h-4 accent-teal-600" />
                      💰 إضافة تكلفة المورد (اختياري — لحساب مستحقات المورد وهامش الربح)
                    </label>
                    {!!newComp._showCost && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <Field label={`تكلفة المورد / فرد (${pkg.currency})`}><Input type="number" min="0" value={newComp.cost_per_pax} onChange={e => setNewComp({ ...newComp, cost_per_pax: e.target.value })} className="bg-white" /></Field>
                        <div className="flex items-end gap-2 pb-2">
                          <input type="checkbox" id="nc-inf-d" checked={!!newComp.include_infants} onChange={e => setNewComp({ ...newComp, include_infants: e.target.checked })} className="w-4 h-4 accent-teal-600" />
                          <label htmlFor="nc-inf-d" className="text-[11px] text-slate-600 cursor-pointer">تُحتسب للرضّع أيضاً</label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {!pkgIsDirect && newComp.pricing_type === 'flat' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Field label={`تكلفة/فرد (${pkg.currency})`}><Input type="number" min="0" value={newComp.cost_per_pax} onChange={e => setNewComp({ ...newComp, cost_per_pax: e.target.value })} className="bg-white" /></Field>
                    <Field label={`بيع/فرد (${pkg.currency})`}><Input type="number" min="0" value={newComp.sale_per_pax} onChange={e => setNewComp({ ...newComp, sale_per_pax: e.target.value })} className="bg-white" /></Field>
                    <div className="flex items-end gap-2 pb-2">
                      <input type="checkbox" id="nc-inf" checked={!!newComp.include_infants} onChange={e => setNewComp({ ...newComp, include_infants: e.target.checked })} className="w-4 h-4 accent-teal-600" />
                      <label htmlFor="nc-inf" className="text-[11px] text-slate-600 cursor-pointer">يُحتسب للرضّع أيضاً (كرسوم التأشيرة)</label>
                    </div>
                  </div>
                )}
                {!pkgIsDirect && newComp.pricing_type === 'per_age' && (
                  <div className="grid grid-cols-3 gap-2">
                    {[{ k: 'adult', l: '👨 بالغ (12+)' }, { k: 'child', l: '🧒 طفل (2-11)' }, { k: 'infant', l: '👶 رضيع (<2)' }].map(cat => (
                      <div key={cat.k} className="rounded-lg border bg-white p-2 space-y-1">
                        <div className="text-[10px] font-bold text-slate-600">{cat.l}</div>
                        <Input type="number" min="0" value={newComp[`cost_${cat.k}`]} onChange={e => setNewComp({ ...newComp, [`cost_${cat.k}`]: e.target.value })} placeholder="تكلفة" className="h-8 text-xs" />
                        <Input type="number" min="0" value={newComp[`sale_${cat.k}`]} onChange={e => setNewComp({ ...newComp, [`sale_${cat.k}`]: e.target.value })} placeholder="بيع" className="h-8 text-xs font-bold" />
                      </div>
                    ))}
                  </div>
                )}
                {!pkgIsDirect && newComp.pricing_type === 'room_age' && (
                  (pkg.room_pricing || []).length === 0 ? (
                    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ لا توجد أنواع غرف معرّفة في الباكج — عدّل الباكج وأضف أنواع التسكين أولاً.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {(pkg.room_pricing || []).map(rp => {
                        const rr = (newComp.room_rates || {})[rp.type] || {}
                        const setRR = (k, v) => setNewComp({ ...newComp, room_rates: { ...(newComp.room_rates || {}), [rp.type]: { ...rr, [k]: v } } })
                        return (
                          <div key={rp.type} className="grid gap-1 items-center bg-white rounded border p-1.5" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
                            <div className="text-[10px] font-bold text-slate-700 truncate">🛏️ {rp.type}</div>
                            <Input type="number" min="0" value={rr.cost_adult ?? ''} onChange={e => setRR('cost_adult', e.target.value)} className="h-7 text-[10px] col-span-2" placeholder="تكلفة بالغ" />
                            <Input type="number" min="0" value={rr.sale_adult ?? ''} onChange={e => setRR('sale_adult', e.target.value)} className="h-7 text-[10px] col-span-2 font-bold" placeholder="بيع بالغ" />
                            <Input type="number" min="0" value={rr.cost_child ?? ''} onChange={e => setRR('cost_child', e.target.value)} className="h-7 text-[10px] col-span-2" placeholder="تكلفة طفل" />
                            <Input type="number" min="0" value={rr.sale_child ?? ''} onChange={e => setRR('sale_child', e.target.value)} className="h-7 text-[10px] col-span-2 font-bold" placeholder="بيع طفل" />
                            <Input type="number" min="0" value={rr.cost_infant ?? ''} onChange={e => setRR('cost_infant', e.target.value)} className="h-7 text-[10px] col-span-2" placeholder="تكلفة رضيع" />
                            <Input type="number" min="0" value={rr.sale_infant ?? ''} onChange={e => setRR('sale_infant', e.target.value)} className="h-7 text-[10px] col-span-2 font-bold" placeholder="بيع رضيع" />
                          </div>
                        )
                      })}
                    </div>
                  )
                )}
              </div>
            )}
            <Table>
              <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>الاسم</TableHead><TableHead>المورد</TableHead><TableHead className="text-left">تكلفة/فرد</TableHead><TableHead className="text-left">بيع/فرد</TableHead><TableHead className="text-left text-emerald-600">ربح/فرد</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {comps.map(c => (
                  <TableRow key={c.id}>
                    <TableCell><Badge variant="outline">{COMPONENT_TYPES.find(t => t.v === c.component_type)?.l || c.component_type}</Badge></TableCell>
                    <TableCell className="font-semibold">
                      {c.name}
                      {c.component_type === 'hotel' && (Number(c.nights) > 0 || c.city) && (
                        <div className="text-[10px] text-indigo-600 font-normal mt-0.5">
                          {Number(c.nights) > 0 ? `🌙 ${c.nights} ${Number(c.nights) === 1 ? 'ليلة' : Number(c.nights) === 2 ? 'ليلتان' : Number(c.nights) <= 10 ? 'ليالٍ' : 'ليلة'}` : ''}{Number(c.nights) > 0 && c.city ? ' — ' : ''}{c.city || ''}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{c.supplier_name}</TableCell>
                    <TableCell className="text-left">{c.pricing_type === 'per_age' ? <span className="text-[10px] whitespace-nowrap">👨{c.cost_adult ?? 0} 🧒{c.cost_child ?? 0} 👶{c.cost_infant ?? 0}</span> : c.pricing_type === 'room_age' ? <span className="text-[10px] text-indigo-600 font-bold">🛏️ غرفة+عمر</span> : fmt(c.cost_per_pax, pkg.currency)}</TableCell>
                    <TableCell className="text-left">{c.pricing_type === 'per_age' ? <span className="text-[10px] whitespace-nowrap">👨{c.sale_adult ?? 0} 🧒{c.sale_child ?? 0} 👶{c.sale_infant ?? 0}</span> : c.pricing_type === 'room_age' ? <span className="text-[10px] text-indigo-600 font-bold">🛏️ غرفة+عمر</span> : fmt(c.sale_per_pax, pkg.currency)}</TableCell>
                    <TableCell className="text-left text-emerald-600 font-bold">{fmt(c.sale_per_pax - c.cost_per_pax, pkg.currency)}</TableCell>
                    <TableCell>{pkg.status !== 'closed' && <Button size="sm" variant="ghost" onClick={() => delComp(c.id)} className="text-rose-600 h-6 w-6 p-0"><Trash2 className="w-3 h-3" /></Button>}</TableCell>
                  </TableRow>
                ))}
                {comps.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-6">لا توجد مكونات — أضف تأشيرة، تذكرة، فندق، نقل...</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        )}
        {canProfit && tab === 'transports' && (
          <div className="space-y-3">
            {pkg.status !== 'closed' && (
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                <div className="text-sm font-bold text-slate-800 mb-2">➕ إضافة وسيلة نقل جديدة (باص / طائرة / قطار)</div>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <Field label="الاسم *"><Input value={newTransport.name} onChange={e => setNewTransport({ ...newTransport, name: e.target.value })} placeholder="باص 1 / رحلة 1" /></Field>
                  <Field label="النوع">
                    <Select value={newTransport.type} onValueChange={v => setNewTransport({ ...newTransport, type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bus">🚌 باص</SelectItem>
                        <SelectItem value="flight">✈️ طائرة</SelectItem>
                        <SelectItem value="train">🚂 قطار</SelectItem>
                        <SelectItem value="car">🚗 سيارة</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="السعة *"><Input type="number" min="1" value={newTransport.capacity} onChange={e => setNewTransport({ ...newTransport, capacity: e.target.value })} /></Field>
                  <Field label="السائق / الطيران #"><Input value={newTransport.type === 'flight' ? newTransport.flight_no : newTransport.driver_name} onChange={e => setNewTransport({ ...newTransport, [newTransport.type === 'flight' ? 'flight_no' : 'driver_name']: e.target.value })} placeholder={newTransport.type === 'flight' ? 'IY123' : 'اسم السائق'} /></Field>
                  <Field label={newTransport.type === 'flight' ? 'شركة الطيران' : 'رقم اللوحة'}><Input value={newTransport.type === 'flight' ? newTransport.driver_name : newTransport.vehicle_plate} onChange={e => setNewTransport({ ...newTransport, [newTransport.type === 'flight' ? 'driver_name' : 'vehicle_plate']: e.target.value })} placeholder={newTransport.type === 'flight' ? 'Yemenia' : 'أ ب ج 1234'} /></Field>
                  <div className="flex items-end"><Button onClick={addTransport} className="w-full bg-indigo-600 text-white gap-1"><Plus className="w-4 h-4" /> إضافة</Button></div>
                </div>
              </div>
            )}
            {transports.length === 0 ? (
              <div className="text-center py-8 text-slate-400 border-2 border-dashed rounded-lg">
                <div className="text-3xl mb-2">🚌</div>
                <div>لا توجد وسائل نقل مضافة بعد. أضِف باصاً أو رحلة أعلاه لتبدأ التسكين.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {transports.map(t => {
                  const pct = t.capacity > 0 ? Math.round((t.seats_booked / t.capacity) * 100) : 0
                  const isFull = t.status === 'full'
                  const isClosed = t.status === 'closed'
                  return (
                    <div key={t.id} className={`p-3 rounded-lg border-2 ${isClosed ? 'bg-slate-50 border-slate-300' : isFull ? 'bg-rose-50 border-rose-300' : 'bg-white border-indigo-200'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{t.type === 'flight' ? '✈️' : t.type === 'train' ? '🚂' : t.type === 'car' ? '🚗' : '🚌'}</span>
                          <div>
                            <div className="font-bold text-slate-800">{t.name}</div>
                            <div className="text-[11px] text-slate-500">{t.driver_name || t.flight_no || '—'} • {t.vehicle_plate || (t.type === 'flight' ? 'رحلة' : 'مركبة')}</div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => toggleTransportStatus(t)} className="h-7 px-2 text-xs" title={t.status === 'open' ? 'إغلاق يدوي' : 'إعادة فتح'}>
                            {t.status === 'open' ? '🔒' : '🔓'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => delTransport(t)} className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50" title="حذف"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 bg-slate-200 rounded-full h-3 overflow-hidden">
                          <div className={`h-full transition-all ${isFull ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                        </div>
                        <div className="text-xs font-bold text-slate-700 tabular-nums">{t.seats_booked} / {t.capacity}</div>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="text-slate-500">{pct}% ممتلئ</div>
                        <Badge className={isClosed ? 'bg-slate-500' : isFull ? 'bg-rose-500' : 'bg-emerald-500'}>
                          {isClosed ? '🔒 مغلق' : isFull ? '⛔ مكتمل' : '✅ متاح'}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'bookings' && (
          <div className="space-y-3">
            {/* v3.52 — Pending Meraaj bookings: registrant names visible IMMEDIATELY, approval one click away */}
            {inbound.length > 0 && (
              <div className="border-2 border-amber-300 bg-amber-50/70 rounded-xl p-3 space-y-2">
                <div className="font-black text-sm text-amber-800">🕋 حجوزات واردة من معراج بانتظار الاعتماد ({inbound.reduce((s, x) => s + (Number(x.seats) || 0), 0)} مقعد)</div>
                {inbound.map(ib => (
                  <div key={ib.id} className="bg-white rounded-lg border border-amber-200 p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-slate-800">🏢 {ib.buyer_office_name} <span className="text-xs text-slate-500">— {ib.seats} مقعد • {new Date(ib.created_at).toLocaleDateString('en-GB')}</span></div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {(ib.registrants || []).map((r, i) => (
                            <span key={i} className="text-[11px] bg-slate-100 border rounded-full px-2 py-0.5">
                              👤 {r.name} <span className="text-slate-400">({r.age_category === 'adult' ? 'بالغ' : r.age_category === 'child' ? 'طفل' : 'رضيع'}{r.room_type ? ` • ${r.room_type}` : ''})</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {canApproveMeraaj ? (
                        <Button size="sm" onClick={() => approveInbound(ib)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 h-8 text-xs shrink-0">✅ اعتماد وإظهار المسجلين</Button>
                      ) : (
                        <span className="text-[11px] text-slate-500 bg-slate-100 rounded-md px-2 py-1 shrink-0">بانتظار اعتماد المدير/المالك</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {pkg.status !== 'closed' && (
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Field label="اسم المعتمر/المسافر"><Input value={newBooking.pilgrim_name} onChange={e => setNewBooking({ ...newBooking, pilgrim_name: e.target.value })} /></Field>
                  <Field label="رقم الجواز"><Input value={newBooking.passport_no} onChange={e => setNewBooking({ ...newBooking, passport_no: e.target.value })} /></Field>
                  <Field label="📅 تاريخ الميلاد (اختياري)"><Input type="date" value={newBooking.birth_date} onChange={e => {
                    const bd = e.target.value
                    let auto = { birth_date: bd }
                    if (bd) {
                      const age = (Date.now() - new Date(bd).getTime()) / (365.25 * 24 * 3600 * 1000)
                      if (age < 2) auto = { ...auto, pax_adults: 0, pax_children: 0, pax_infants: 1 }
                      else if (age < 12) auto = { ...auto, pax_adults: 0, pax_children: 1, pax_infants: 0 }
                      else auto = { ...auto, pax_adults: 1, pax_children: 0, pax_infants: 0 }
                    }
                    setNewBooking({ ...newBooking, ...auto })
                  }} /></Field>
                  <div className="flex items-end"><Button onClick={addBooking} className="w-full bg-emerald-600 text-white gap-1"><Plus className="w-4 h-4" /> تسجيل + قيد</Button></div>
                </div>
                {/* v3.9.28 — Age category breakdown (Adult/Child/Infant per IATA) */}
                <div className="bg-white/60 border-2 border-amber-200 rounded-lg p-3">
                  <div className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-2">👥 <span>عدد المسافرين حسب الفئة العمرية (IATA)</span></div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="🧑 بالغ (12+)"><Input type="number" min="0" value={newBooking.pax_adults} onChange={e => setNewBooking({ ...newBooking, pax_adults: Number(e.target.value) || 0 })} className="bg-white" /></Field>
                    <Field label="👦 طفل (2-11)"><Input type="number" min="0" value={newBooking.pax_children} onChange={e => setNewBooking({ ...newBooking, pax_children: Number(e.target.value) || 0 })} className="bg-white" /></Field>
                    <Field label="👶 رضيع (0-2) — بلا مقعد"><Input type="number" min="0" value={newBooking.pax_infants} onChange={e => setNewBooking({ ...newBooking, pax_infants: Number(e.target.value) || 0 })} className="bg-white" /></Field>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    💡 التكلفة تُحسب على <b>البالغين + الأطفال فقط</b> ({(newBooking.pax_adults || 0) + (newBooking.pax_children || 0)} مسافر). الرضيع مجاناً محاسبياً <b>ولا يشغل مقعداً في وسيلة النقل</b>.
                  </div>
                </div>
                {/* v3.15 — Registrants dynamic list + room-type pricing */}
                <div className="bg-white/60 border-2 border-indigo-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-2">🛏️ <span>قائمة المسجلين والتسكين ({(newBooking.registrants || []).length})</span></div>
                    <Button size="sm" variant="outline" onClick={() => setNewBooking({ ...newBooking, registrants: [...(newBooking.registrants || []), { name: '', passport_no: '', age: '', visa_no: '', room_type: (pkg.room_pricing || [])[0]?.type || '' }] })} className="h-7 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"><Plus className="w-3 h-3" /> إضافة فرد</Button>
                  </div>
                  {(newBooking.registrants || []).length === 0 ? (
                    <div className="text-[11px] text-slate-400 text-center py-1">اختياري — أضف بيانات كل فرد (الاسم، الجواز، العمر، التأشيرة، نوع التسكين). الفئات العمرية والسعر سيُحسبان آلياً.</div>
                  ) : (
                    <div className="space-y-2">
                      {(newBooking.registrants || []).map((r, i) => {
                        const upd = (k, v) => {
                          const list = [...newBooking.registrants]; list[i] = { ...list[i], [k]: v }
                          // Auto-derive age categories from the list
                          const adults = list.filter(x => x.age === '' || Number(x.age) >= 12).length
                          const children = list.filter(x => x.age !== '' && Number(x.age) >= 2 && Number(x.age) < 12).length
                          const infants = list.filter(x => x.age !== '' && Number(x.age) < 2).length
                          setNewBooking({ ...newBooking, registrants: list, pax_adults: adults, pax_children: children, pax_infants: infants, pilgrim_name: newBooking.pilgrim_name || list[0]?.name || '', passport_no: newBooking.passport_no || list[0]?.passport_no || '' })
                        }
                        const rm = () => {
                          const list = newBooking.registrants.filter((_, idx) => idx !== i)
                          const adults = list.filter(x => x.age === '' || Number(x.age) >= 12).length
                          const children = list.filter(x => x.age !== '' && Number(x.age) >= 2 && Number(x.age) < 12).length
                          const infants = list.filter(x => x.age !== '' && Number(x.age) < 2).length
                          setNewBooking({ ...newBooking, registrants: list, pax_adults: list.length ? adults : 1, pax_children: children, pax_infants: infants })
                        }
                        return (
                          <div key={i} className="grid grid-cols-2 md:grid-cols-6 gap-1.5 items-center bg-white rounded-lg border p-2">
                            <Input value={r.name} onChange={e => upd('name', e.target.value)} placeholder={`الاسم ${i + 1} *`} className="h-8 text-xs md:col-span-2" />
                            <Input value={r.passport_no} onChange={e => upd('passport_no', e.target.value.toUpperCase())} placeholder="رقم الجواز" className="h-8 text-xs font-mono" />
                            <Input type="number" min="0" max="120" value={r.age} onChange={e => upd('age', e.target.value)} placeholder="العمر" className="h-8 text-xs" />
                            <Input value={r.visa_no} onChange={e => upd('visa_no', e.target.value)} placeholder="رقم التأشيرة" className="h-8 text-xs font-mono" />
                            <div className="flex items-center gap-1">
                              {(pkg.room_pricing || []).length > 0 ? (
                                <Select value={r.room_type || 'none'} onValueChange={v => upd('room_type', v === 'none' ? '' : v)}>
                                  <SelectTrigger className="h-8 text-xs bg-white"><SelectValue placeholder="التسكين" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">— بلا تسكين —</SelectItem>
                                    {(pkg.room_pricing || []).map(rp => <SelectItem key={rp.type} value={rp.type}>🛏️ {rp.type}{(pkg.pricing_mode || 'direct') === 'direct' ? ` — 👨${rp.sale_per_pax}${rp.sale_child !== null && rp.sale_child !== undefined ? ` 🧒${rp.sale_child}` : ''}${rp.sale_infant ? ` 👶${rp.sale_infant}` : ''} ${pkg.currency}` : ''}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input value={r.room_type} onChange={e => upd('room_type', e.target.value)} placeholder="التسكين" className="h-8 text-xs" />
                              )}
                              <Button size="sm" variant="ghost" onClick={rm} className="h-7 w-7 p-0 text-rose-500"><Trash2 className="w-3 h-3" /></Button>
                            </div>
                          </div>
                        )
                      })}
                      {(() => {
                        // v3.20 — Dual pricing live preview
                        const effMode = pkg.pricing_mode || ((pkg.room_pricing || []).length > 0 ? 'direct' : 'components')
                        const regs = (newBooking.registrants || []).filter(r => String(r.name || '').trim())
                        if (regs.length === 0) return null
                        const billed = regs.filter(r => regAgeCat(r.age) !== 'infant').length
                        const roomSale = effMode === 'direct' && (pkg.room_pricing || []).length > 0 ? directRoomSaleFE(pkg.room_pricing, regs) : 0
                        const saleTotal = roomSale > 0 ? roomSale : compSaleFE(comps, regs, billed)
                        if (saleTotal <= 0) return null
                        return (
                          <div className="p-2 rounded bg-indigo-50 border border-indigo-200 text-xs flex items-center gap-2 flex-wrap">
                            💰 <b>{roomSale > 0 ? 'إجمالي البيع حسب الغرفة والعمر (يُعتمد آلياً):' : 'إجمالي البيع من المكوّنات حسب التسعير (يُعتمد آلياً):'}</b>
                            <span className="font-black text-indigo-700 text-sm">{fmt(saleTotal, pkg.currency)}</span>
                            <span className="text-[10px] text-slate-500">({regs.filter(r => regAgeCat(r.age) === 'adult').length} بالغ، {regs.filter(r => regAgeCat(r.age) === 'child').length} طفل، {regs.filter(r => regAgeCat(r.age) === 'infant').length} رضيع)</span>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
                {/* v3.17 — Manual booking discount (B2B flexibility) — v3.50: apply_discount permission only */}
                {(pdUser?.role === 'owner' || pdUser?.permissions?.apply_discount === true) && (
                <div className="bg-white/60 border-2 border-amber-200 rounded-lg p-3">
                  <div className="text-xs font-bold text-slate-800 mb-2">💸 خصم على الحجز (اختياري)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label={`مبلغ الخصم (${pkg.currency})`}>
                      <Input type="number" min="0" value={newBooking.discount} onChange={e => setNewBooking({ ...newBooking, discount: e.target.value })} placeholder="0" className="font-bold bg-white" />
                    </Field>
                    <Field label="سبب الخصم">
                      <Input value={newBooking.discount_reason} onChange={e => setNewBooking({ ...newBooking, discount_reason: e.target.value })} placeholder="خصم طفل بدون سرير / رضيع / مجاملة وكيل..." className="bg-white" />
                    </Field>
                  </div>
                  {(() => {
                    // v3.20 — Dual pricing discount preview
                    const effMode = pkg.pricing_mode || ((pkg.room_pricing || []).length > 0 ? 'direct' : 'components')
                    const regs = (newBooking.registrants || []).filter(r => String(r.name || '').trim())
                    const billed = regs.length > 0 ? regs.filter(r => regAgeCat(r.age) !== 'infant').length : ((Number(newBooking.pax_adults) || 0) + (Number(newBooking.pax_children) || 0))
                    const roomSale = effMode === 'direct' && regs.length > 0 && (pkg.room_pricing || []).length > 0 ? directRoomSaleFE(pkg.room_pricing, regs) : 0
                    const base = roomSale > 0 ? roomSale : compSaleFE(comps, regs, billed)
                    const disc = Number(newBooking.discount) || 0
                    if (disc <= 0 || base <= 0) return null
                    return (
                      <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-300 text-xs flex items-center gap-2 flex-wrap">
                        🧮 <span>الإجمالي: <b>{fmt(base, pkg.currency)}</b></span>
                        <span className="text-rose-600 font-bold">− خصم {fmt(disc, pkg.currency)}</span>
                        <span>= <b className="text-emerald-700 text-sm">السعر النهائي (يُعتمد بالفاتورة والقيد): {fmt(Math.max(0, base - disc), pkg.currency)}</b></span>
                      </div>
                    )
                  })()}
                </div>
                )}
                {/* v3.9.22 — Unified Payment Selector (Package Booking) */}
                <div className="bg-white/60 border-2 border-blue-200 rounded-lg p-3">
                  <div className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-2">💳 <span>طريقة الدفع + جهة الاستلام</span></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="طريقة الدفع" required>
                      <Select value={newBooking.payment_method} onValueChange={v => setNewBooking({ ...newBooking, payment_method: v })}>
                        <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="credit">🕓 آجل (على حساب عميل)</SelectItem>
                          <SelectItem value="cash">💵 نقد (صندوق / بنك)</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {newBooking.payment_method === 'credit' ? (
                      <Field label="حساب القبض / العميل" required>
                        <AccountAutocomplete type="client" value={newBooking.client_id || null} onChange={(sel) => setNewBooking({ ...newBooking, client_id: sel?.id || '' })} placeholder="ابحث عن العميل بالاسم أو الكود..." />
                      </Field>
                    ) : (
                      <Field label="الصندوق / البنك" required>
                        <AccountAutocomplete type="box" value={newBooking.box_id || null} onChange={(sel) => setNewBooking({ ...newBooking, box_id: sel?.id || '' })} placeholder="ابحث عن صندوق أو بنك..." />
                      </Field>
                    )}
                  </div>
                </div>
                {/* v3.9.26 — Transport / bus selector with live capacity */}
                {transports.length > 0 && (
                  <div className="bg-white/60 border-2 border-indigo-200 rounded-lg p-3">
                    <div className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-2">🚌 <span>وسيلة النقل (اختياري)</span></div>
                    <Select value={newBooking.transport_id || '__none__'} onValueChange={v => setNewBooking({ ...newBooking, transport_id: v === '__none__' ? '' : v })}>
                      <SelectTrigger className="bg-white"><SelectValue placeholder="اختر الباص / الرحلة" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— بدون تسكين —</SelectItem>
                        {transports.filter(t => t.status !== 'closed').map(t => {
                          const remaining = Math.max(0, t.capacity - t.seats_booked)
                          const seatsNeeded = (Number(newBooking.pax_adults) || 0) + (Number(newBooking.pax_children) || 0)
                          const emoji = t.type === 'flight' ? '✈️' : t.type === 'train' ? '🚂' : t.type === 'car' ? '🚗' : '🚌'
                          return (
                            <SelectItem key={t.id} value={t.id} disabled={t.status === 'full' || remaining < seatsNeeded}>
                              {emoji} {t.name} — {t.seats_booked}/{t.capacity} {t.status === 'full' ? '⛔' : remaining < seatsNeeded ? `(متبقٍ ${remaining} فقط)` : `(متبقٍ ${remaining})`}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {/* v3.9.20 — Search field for bookings */}
            <div className="flex items-center gap-2 p-2 bg-slate-50 border rounded-lg">
              <Search className="w-4 h-4 text-slate-400" />
              <Input value={bookingSearch} onChange={e => setBookingSearch(e.target.value)} placeholder="🔍 بحث بالاسم أو رقم الجواز أو حساب القبض..." className="border-0 bg-transparent flex-1" />
              {bookingSearch && <Button size="sm" variant="ghost" onClick={() => setBookingSearch('')} className="text-rose-600 h-7">مسح</Button>}
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>المعتمر/المسافر</TableHead><TableHead>حساب القبض</TableHead><TableHead>الجواز</TableHead><TableHead className="text-center">أفراد</TableHead><TableHead>🚌 النقل</TableHead><TableHead>الدفع</TableHead><TableHead className="text-left">تكلفة</TableHead><TableHead className="text-left">بيع</TableHead><TableHead className="text-left text-emerald-600">ربح</TableHead><TableHead className="text-center w-16">⚙️</TableHead></TableRow></TableHeader>
              <TableBody>
                {(bookings || []).filter(b => {
                  if (!bookingSearch) return true
                  const q = bookingSearch.trim().toLowerCase()
                  return (b?.pilgrim_name || '').toLowerCase().includes(q) || (b?.passport_no || '').toLowerCase().includes(q) || (b?.client_name || '').toLowerCase().includes(q) || (b?.transport_name || '').toLowerCase().includes(q)
                }).map(b => (
                  <TableRow key={b?.id}>
                    <TableCell className="text-xs">{fmtDate(b?.created_at)}</TableCell>
                    <TableCell className="font-semibold">{b?.pilgrim_name || '—'}
                      {(b?.registrants || []).length > 0 && (
                        <div className="text-[10px] text-indigo-600 font-normal mt-0.5" title={(b.registrants || []).map(r => `${r.name}${r.room_type ? ` (${r.room_type})` : ''}`).join('، ')}>
                          👥 {b.registrants.length} مسجّل{b.rooms_summary ? ' • ' + Object.entries(b.rooms_summary).map(([k, v]) => `${k}×${v}`).join(' ') : ''}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{b?.client_name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{b?.passport_no || '—'}</TableCell>
                    <TableCell className="text-center">{b?.pax_count || 1}</TableCell>
                    <TableCell className="text-xs">{b?.transport_name ? <span className="inline-flex items-center gap-1"><span>{b.transport_type === 'flight' ? '✈️' : '🚌'}</span>{b.transport_name}</span> : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell>{b?.payment_method === 'cash' ? '💵' : '🕓'}</TableCell>
                    <TableCell className="text-left">{fmt(b?.total_cost, b?.currency)}</TableCell>
                    <TableCell className="text-left">{fmt(b?.total_sale, b?.currency)}
                      {Number(b?.discount) > 0 && <div className="text-[10px] text-amber-600 font-bold" title={b?.discount_reason || ''}>💸 خصم {fmt(b.discount, b?.currency)}{b?.discount_reason ? ` — ${b.discount_reason}` : ''}</div>}
                    </TableCell>
                    <TableCell className="text-left text-emerald-600 font-bold">{fmt(b?.commission, b?.currency)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {(b?.registrants || []).length > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => setMonitorBooking(b)} className="h-7 w-7 p-0 text-indigo-600 hover:bg-indigo-50" title="إرسال المسجلين لمركز مراقبة التأشيرات">🛃</Button>
                        )}
                        {pkg.status !== 'closed' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditingBooking(b)} className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50" title="تعديل بيانات المسافر">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={async () => {
                          if (!(await askConfirm({ title: `حذف تسجيل "${b?.pilgrim_name}"`, desc: 'سيتم عكس القيد المحاسبي وتحديث رصيد العميل تلقائياً.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
                          try { await api(`/packages/${pkg.id}/bookings/${b.id}`, { method: 'DELETE' }); toast.success('✅ تم الحذف'); load(); onChanged && onChanged() }
                          catch (e) { toast.error(e.message) }
                        }} className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50" title="حذف التسجيل"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!bookings || bookings.length === 0) && <TableRow><TableCell colSpan={11} className="text-center text-slate-400 py-6">لا يوجد مسجلون بعد</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>إغلاق</Button></DialogFooter>
      </DialogContent>
      {monitorBooking && <SendToMonitorDialog booking={monitorBooking} pkg={pkg} onClose={() => setMonitorBooking(null)} />}
      {editingBooking && (
        <PackageBookingEditDialog
          pkg={pkg}
          booking={editingBooking}
          clients={clients}
          boxes={boxes}
          transports={transports}
          onClose={() => setEditingBooking(null)}
          onSaved={() => { setEditingBooking(null); load(); onChanged && onChanged() }}
        />
      )}
    </Dialog>
  )
}

// v3.9.21 — Edit an existing package booking (passenger data + optional financial recompute)
function PackageBookingEditDialog({ pkg, booking, clients, boxes, transports = [], onClose, onSaved }) {
  const [form, setForm] = useState({
    pilgrim_name: booking?.pilgrim_name || '',
    passport_no: booking?.passport_no || '',
    pax_count: booking?.pax_count || 1,
    payment_method: booking?.payment_method || 'credit',
    client_id: booking?.client_id || '',
    box_id: booking?.box_id || '',
    transport_id: booking?.transport_id || '',
    notes: booking?.notes || '',
    override_financials: false,
    total_cost: booking?.total_cost || 0,
    total_sale: booking?.total_sale || 0,
    discount: booking?.discount || 0,
    discount_reason: booking?.discount_reason || '',
  })
  const [saving, setSaving] = useState(false)

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const previewProfit = (() => {
    if (form.override_financials) {
      return +((Number(form.total_sale) || 0) - (Number(form.total_cost) || 0)).toFixed(2)
    }
    // recompute from snapshots × pax
    const snaps = booking?.component_snapshots || []
    const pax = Math.max(1, Number(form.pax_count) || 1)
    const cost = snaps.reduce((s, c) => s + ((c.cost_per_pax || 0) * pax), 0)
    const sale = snaps.reduce((s, c) => s + ((c.sale_per_pax || 0) * pax), 0)
    return { cost: +cost.toFixed(2), sale: +sale.toFixed(2), profit: +(sale - cost).toFixed(2) }
  })()

  const save = async () => {
    if (!form.pilgrim_name.trim()) return toast.error('اسم المسافر مطلوب')
    // v3.9.22 — Unified payment: credit → client_id required; cash → box_id required
    if (form.payment_method === 'credit' && !form.client_id) return toast.error('اختر حساب القبض / العميل (للحجز الآجل)')
    if (form.payment_method === 'cash' && !form.box_id) return toast.error('اختر الصندوق / البنك (للنقد)')
    const paxNum = Math.max(1, Number(form.pax_count) || 1)
    const body = {
      pilgrim_name: form.pilgrim_name.trim(),
      passport_no: form.passport_no.trim(),
      notes: form.notes.trim(),
      pax_count: paxNum,
      payment_method: form.payment_method,
      client_id: form.client_id,
      box_id: form.payment_method === 'cash' ? form.box_id : '',
      transport_id: form.transport_id || null,
    }
    if (form.override_financials) {
      body.total_cost = +(Number(form.total_cost) || 0).toFixed(2)
      body.total_sale = +(Number(form.total_sale) || 0).toFixed(2)
    }
    // v3.17 — Manual discount (applied server-side unless total_sale explicitly overridden)
    body.discount = Math.max(0, Number(form.discount) || 0)
    body.discount_reason = String(form.discount_reason || '').trim()
    try {
      setSaving(true)
      const res = await api(`/packages/${pkg.id}/bookings/${booking.id}`, { method: 'PATCH', body })
      if (res?._full_recalc) toast.success('✅ تم تعديل البيانات + إعادة احتساب القيد المحاسبي')
      else toast.success('✅ تم تحديث بيانات المسافر')
      onSaved && onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4 text-blue-600" /> تعديل بيانات المسافر</DialogTitle>
          <DialogDescription>
            الباكج: <b>{pkg.name}</b> • العملة: <b>{pkg.currency}</b>
            <div className="mt-1 text-xs text-slate-500">تعديل الاسم/الجواز/الملاحظات فقط لا يؤثر على القيد المحاسبي. أي تغيير في عدد الأفراد أو طريقة الدفع أو حساب القبض سيؤدي إلى إعادة احتساب تلقائية للقيد وأرصدة العملاء والموردين.</div>
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="اسم المعتمر/المسافر *">
            <Input value={form.pilgrim_name} onChange={e => setF('pilgrim_name', e.target.value)} />
          </Field>
          <Field label="رقم الجواز">
            <Input value={form.passport_no} onChange={e => setF('passport_no', e.target.value)} />
          </Field>
          {/* v3.17 — Manual discount */}
          <Field label={`💸 مبلغ الخصم (${pkg.currency})`}>
            <Input type="number" min="0" value={form.discount} onChange={e => setF('discount', e.target.value)} className="font-bold" />
          </Field>
          <Field label="سبب الخصم">
            <Input value={form.discount_reason} onChange={e => setF('discount_reason', e.target.value)} placeholder="خصم طفل بدون سرير / رضيع / مجاملة وكيل..." />
          </Field>
          <Field label="حساب القبض *">
            <Select value={form.client_id} onValueChange={v => setF('client_id', v)}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>{(clients || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="عدد الأفراد">
            <Input type="number" min="1" value={form.pax_count} onChange={e => setF('pax_count', e.target.value)} />
          </Field>
          <Field label="طريقة الدفع">
            <Select value={form.payment_method} onValueChange={v => setF('payment_method', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">🕓 آجل (على حساب العميل)</SelectItem>
                <SelectItem value="cash">💵 نقد (صندوق)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.payment_method === 'cash' && (
            <Field label="الصندوق *">
              <Select value={form.box_id} onValueChange={v => setF('box_id', v)}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>{(boxes || []).map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {/* v3.9.26 — Transport selector (edit) */}
          {transports.length > 0 && (
            <div className="md:col-span-2">
              <Field label="🚌 وسيلة النقل">
                <Select value={form.transport_id || '__none__'} onValueChange={v => setF('transport_id', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— بدون تسكين —</SelectItem>
                    {transports.map(t => {
                      const emoji = t.type === 'flight' ? '✈️' : t.type === 'train' ? '🚂' : t.type === 'car' ? '🚗' : '🚌'
                      const isCurrent = t.id === booking?.transport_id
                      const remaining = t.capacity - t.seats_booked + (isCurrent ? (booking?.pax_count || 0) : 0)
                      const disabled = !isCurrent && (t.status === 'closed' || t.status === 'full' || remaining < (Number(form.pax_count) || 1))
                      return (
                        <SelectItem key={t.id} value={t.id} disabled={disabled}>
                          {emoji} {t.name} — {t.seats_booked}/{t.capacity} {t.status === 'full' ? '⛔' : `(متبقٍ ${remaining})`}{isCurrent ? ' • الحالي' : ''}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          <div className="md:col-span-2">
            <Field label="ملاحظات">
              <Input value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="أي ملاحظات إضافية..." />
            </Field>
          </div>
        </div>

        {/* Financial preview */}
        <div className="bg-slate-50 border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700">💰 القيم المالية</div>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={form.override_financials} onChange={e => setF('override_financials', e.target.checked)} />
              تعديل يدوي (تجاوز الاحتساب التلقائي)
            </label>
          </div>
          {!form.override_financials ? (
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="bg-white rounded p-2 border">
                <div className="text-[11px] text-slate-500">التكلفة (يُحسب)</div>
                <div className="font-bold text-rose-600">{fmt(previewProfit.cost, pkg.currency)}</div>
              </div>
              <div className="bg-white rounded p-2 border">
                <div className="text-[11px] text-slate-500">البيع (يُحسب)</div>
                <div className="font-bold text-blue-600">{fmt(previewProfit.sale, pkg.currency)}</div>
              </div>
              <div className="bg-white rounded p-2 border">
                <div className="text-[11px] text-slate-500">الربح</div>
                <div className="font-bold text-emerald-600">{fmt(previewProfit.profit, pkg.currency)}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Field label={`إجمالي التكلفة (${pkg.currency})`}>
                <Input type="number" min="0" step="0.01" value={form.total_cost} onChange={e => setF('total_cost', e.target.value)} />
              </Field>
              <Field label={`إجمالي البيع (${pkg.currency})`}>
                <Input type="number" min="0" step="0.01" value={form.total_sale} onChange={e => setF('total_sale', e.target.value)} />
              </Field>
              <div className="flex items-end">
                <div className="w-full bg-white rounded p-2 border">
                  <div className="text-[11px] text-slate-500">الربح</div>
                  <div className="font-bold text-emerald-600">{fmt(+(Number(form.total_sale || 0) - Number(form.total_cost || 0)).toFixed(2), pkg.currency)}</div>
                </div>
              </div>
            </div>
          )}
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            ⚠️ عند تغيير عدد الأفراد أو طريقة الدفع أو حساب القبض أو التعديل اليدوي للمالي، سيتم <b>عكس القيد المحاسبي القديم</b> وإعادة إنشائه بالبيانات الجديدة، مع تحديث أرصدة العميل والمورد. لا تُستهلك حصة إضافية من القيود.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>إلغاء</Button>
          <Button onClick={save} disabled={saving} className="grad-brand text-white gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            حفظ التعديلات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// v3.16 — Send booking registrants to the Visa Monitoring Center (one click, upsert by passport)
function SendToMonitorDialog({ booking, pkg, onClose }) {
  const today = new Date().toISOString().slice(0, 10)
  const [selected, setSelected] = useState(() => (booking.registrants || []).map(r => !!r.passport_no))
  const [f, setF] = useState({ agent_name: booking.client_name || booking.pilgrim_name || '', agent_phone: '', entry_date: today, visa_issue_date: today, allowed_days: 85 })
  const [busy, setBusy] = useState(false)
  const regs = booking.registrants || []
  const chosen = regs.filter((r, i) => selected[i] && r.passport_no)
  const submit = async () => {
    if (chosen.length === 0) return toast.error('اختر فرداً واحداً على الأقل (يجب توفر رقم الجواز)')
    if (!f.agent_name.trim()) return toast.error('اسم الوكيل مطلوب')
    if (!f.agent_phone.trim()) return toast.error('رقم واتساب الوكيل مطلوب')
    if (!f.entry_date) return toast.error('تاريخ الدخول مطلوب')
    try {
      setBusy(true)
      const rows = chosen.map(r => ({
        traveler_name: r.name,
        passport_no: r.passport_no,
        visa_no: r.visa_no || `PKG-${(pkg.name || '').slice(0, 12)}`,
        visa_issue_date: f.visa_issue_date,
        agent_name: f.agent_name.trim(),
        agent_phone: f.agent_phone.trim(),
        entry_date: f.entry_date,
        allowed_days: Number(f.allowed_days) || 85,
        notes: `من باكج: ${pkg.name} — حجز ${booking.pilgrim_name || ''}`,
      }))
      const res = await api('/visa-monitor/import', { method: 'POST', body: { rows } })
      toast.success(`🛃 تم الإرسال للمراقبة: ${res.inserted} جديد، ${res.updated} تحديث${res.skipped ? `، ${res.skipped} متجاهل` : ''}`)
      onClose()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>🛃 إرسال المسجلين لمركز مراقبة التأشيرات</DialogTitle>
          <DialogDescription>حجز: {booking.pilgrim_name} — باكج: {pkg.name} (تحديث تلقائي إن كان الجواز موجوداً مسبقاً)</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            {regs.map((r, i) => (
              <label key={i} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer ${!r.passport_no ? 'opacity-50 bg-slate-50' : selected[i] ? 'bg-indigo-50 border-indigo-300' : 'bg-white'}`}>
                <input type="checkbox" disabled={!r.passport_no} checked={!!selected[i]} onChange={e => setSelected(s => s.map((v, idx) => idx === i ? e.target.checked : v))} />
                <span className="text-sm font-semibold flex-1">{r.name}</span>
                <span className="text-xs font-mono">{r.passport_no || 'بلا جواز — لا يمكن إرساله'}</span>
                {r.visa_no && <span className="text-[10px] text-slate-500">تأشيرة: {r.visa_no}</span>}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="اسم الوكيل / المكتب" required><Input value={f.agent_name} onChange={e => setF({ ...f, agent_name: e.target.value })} /></Field>
            <Field label="واتساب الوكيل" required><Input dir="ltr" value={f.agent_phone} onChange={e => setF({ ...f, agent_phone: e.target.value })} placeholder="9677XXXXXXXX" className="font-mono" /></Field>
            <Field label="تاريخ الدخول" required><Input type="date" value={f.entry_date} onChange={e => setF({ ...f, entry_date: e.target.value })} /></Field>
            <Field label="تاريخ إصدار التأشيرة"><DocDateInput value={f.visa_issue_date} onChange={v => setF({ ...f, visa_issue_date: v })} /></Field>
            <Field label="مدة الإقامة (يوم)"><Input type="number" min="1" value={f.allowed_days} onChange={e => setF({ ...f, allowed_days: e.target.value })} className="font-bold" /></Field>
          </div>
          <div className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded p-2">💡 سيبدأ العدّاد الآلي فوراً (🟢/🟡/🔴/⚫) وتظهر أزرار واتساب الوكيل في مركز المراقبة ولوحة التحكم.</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit} disabled={busy || chosen.length === 0} className="bg-indigo-600 hover:bg-indigo-700 text-white">{busy ? 'جارٍ الإرسال...' : `🛃 إرسال ${chosen.length} للمراقبة`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PackageReportDialog({ pkg, onClose }) {
  const [data, setData] = useState(null)
  useEffect(() => { api(`/packages/${pkg.id}/report`).then(setData).catch(e => toast.error(e.message)) }, [pkg.id])
  if (!data) return <Dialog open={true} onOpenChange={onClose}><DialogContent dir="rtl"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></DialogContent></Dialog>
  const cur = pkg.currency
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>📊 تقرير مالي — {pkg.name}</DialogTitle>
          <DialogDescription>ملخص كامل لأداء الباكج (المبيعات، التكاليف، صافي الربح)</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-3"><div className="text-xs text-slate-500">المسجلون</div><div className="text-2xl font-bold">{data.totals.bookings}</div><div className="text-[10px] text-slate-400">{data.totals.pax} فرد</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-slate-500">الإيرادات</div><div className="text-xl font-bold text-blue-600">{fmt(data.totals.revenue, cur)}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-slate-500">التكاليف للموردين</div><div className="text-xl font-bold text-rose-600">{fmt(data.totals.cost, cur)}</div></CardContent></Card>
          <Card className="grad-brand text-white border-0"><CardContent className="p-3"><div className="text-xs opacity-90">صافي الربح</div><div className="text-2xl font-extrabold">{fmt(data.totals.profit, cur)}</div><div className="text-[10px] opacity-80">هامش {data.margin_pct}%</div></CardContent></Card>
        </div>
        <div>
          <div className="font-bold text-sm mb-2">💰 توزيع التكاليف على الموردين</div>
          <Table><TableHeader><TableRow><TableHead>المورد</TableHead><TableHead className="text-left">إجمالي التكلفة ({cur})</TableHead></TableRow></TableHeader><TableBody>
            {data.supplier_breakdown.map((s, i) => <TableRow key={i}><TableCell>{s.name}</TableCell><TableCell className="text-left font-bold text-rose-600">{fmt(s.cost, cur)}</TableCell></TableRow>)}
            {data.supplier_breakdown.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-slate-400 py-4">لا توجد بيانات</TableCell></TableRow>}
          </TableBody></Table>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إغلاق</Button><Button onClick={() => window.print()} className="grad-brand text-white gap-2"><Printer className="w-4 h-4" /> طباعة</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// v3.9.20 — Data Backup Section (Manual JSON export)
function BackupSection({ tenant }) {
  const [downloading, setDownloading] = useState(false)
  const [lastBackup, setLastBackup] = useState(null)

  const downloadBackup = async () => {
    try {
      setDownloading(true)
      const base = process.env.NEXT_PUBLIC_BASE_URL || ''
      const res = await fetch(`${base}/api/backup/export`, { credentials: 'include' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename="([^"]+)"/)
      a.href = url
      a.download = m ? m[1] : `rahaal-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setLastBackup(new Date())
      toast.success('✅ تم تنزيل النسخة الاحتياطية بنجاح')
    } catch (e) { toast.error('فشل النسخ الاحتياطي: ' + e.message) } finally { setDownloading(false) }
  }

  return (
    <div className="space-y-4">
      <Card className="border-2 border-rose-200 bg-gradient-to-l from-rose-50 via-orange-50 to-amber-50">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="text-5xl">💾</div>
            <div className="flex-1">
              <div className="text-2xl font-black text-rose-800">النسخ الاحتياطي لبيانات المكتب</div>
              <div className="text-sm text-slate-700 mt-2 leading-relaxed">
                حماية أساسية لبياناتك: احفظ نسخة كاملة (تذاكر، تأشيرات، خدمات، عملاء، موردين، صناديق، قيود يومية، باكجات) على جهازك الشخصي بضغطة واحدة.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">📥 التحميل اليدوي</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-slate-700">تنزيل نسخة احتياطية كاملة كملف JSON على جهازك الآن — يتضمن جميع بيانات مكتب <b>{tenant?.name}</b>.</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="bg-slate-50 p-3 rounded border">✔️ 12 مجموعة بيانات</div>
            <div className="bg-slate-50 p-3 rounded border">✔️ صيغة JSON قابلة للاستعادة</div>
            <div className="bg-slate-50 p-3 rounded border">✔️ آمن — تشفير أثناء النقل (HTTPS)</div>
          </div>
          <Button onClick={downloadBackup} disabled={downloading} className="w-full grad-brand text-white gap-2 py-6 text-base font-bold">
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            {downloading ? 'جاري إنشاء النسخة الاحتياطية...' : '💾 تنزيل نسخة احتياطية الآن'}
          </Button>
          {lastBackup && <div className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded border border-emerald-200 text-center">✅ آخر نسخة تم تنزيلها: {lastBackup.toLocaleString('ar-EG')}</div>}
        </CardContent>
      </Card>

      <Card className="border-2 border-amber-300 bg-amber-50">
        <CardHeader><CardTitle className="text-amber-900 flex items-center gap-2">⚠️ إخلاء المسؤولية</CardTitle></CardHeader>
        <CardContent className="text-sm text-amber-900 space-y-2 leading-relaxed">
          <p>🔒 <b>حفظ النسخ الاحتياطية على أجهزتك مسؤوليتك الكاملة كمكتب.</b> يوصى بحفظ نسخة أسبوعية على الأقل في:</p>
          <ul className="list-disc mr-5 space-y-1">
            <li>💻 قرص صلب داخلي أو خارجي</li>
            <li>☁️ حساب سحابي (Google Drive / OneDrive / Dropbox)</li>
            <li>📧 بريد إلكتروني مؤرشف</li>
          </ul>
          <p className="pt-2 border-t border-amber-300">🛡️ <b>Target Media / رحّال</b> يوفر أيضاً نسخاً احتياطية دورية على السيرفر لأغراض الاستعادة الطارئة، لكن **إدارة النسخ المحلية والاستعادة الشخصية تظل مسؤوليتك**.</p>
        </CardContent>
      </Card>

      <Card className="border-2 border-blue-200">
        <CardHeader><CardTitle className="text-blue-900 flex items-center gap-2">🤖 النسخ التلقائي (قيد التطوير)</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-700">
          سيتم قريباً تفعيل **جدولة تلقائية** لأخذ نسخة احتياطية يومية/أسبوعية إلى بريدك الإلكتروني أو حسابك السحابي. حتى ذلك الحين، يرجى استخدام التنزيل اليدوي بانتظام.
        </CardContent>
      </Card>
    </div>
  )
}


function OfficeSettings() {
  const { settings, refreshMe, user, tenant } = useAuth()
  const [f, setF] = useState({
    agency_name: '', logo_base64: '', header: '', footer: '', tax_id: '', commercial_id: '',
    phone: '', address: '', email: '', primary_color: '#1e3a8a', rates: { USD: 1, SAR: 0.267, YER: 0.0038 },
  })
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState([])
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'staff' })
  const [addingUser, setAddingUser] = useState(false)
  const [permTarget, setPermTarget] = useState(null)
  const logoRef = useRef(null)

  useEffect(() => {
    if (settings) setF(prev => ({ ...prev, ...settings }))
    if (user.role === 'owner') api('/tenant/users').then(setUsers).catch(() => {})
  }, [settings])

  const save = async () => {
    try {
      setSaving(true)
      await api('/tenant/settings', { method: 'PUT', body: f })
      toast.success('تم حفظ الإعدادات')
      refreshMe()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const handleLogo = async (file) => {
    if (!file) return
    if (file.size > 700 * 1024) return toast.error('الحد الأقصى للشعار 700KB')
    const reader = new FileReader()
    reader.onload = () => setF({ ...f, logo_base64: reader.result })
    reader.readAsDataURL(file)
  }

  const addUser = async () => {
    // v3.88.4 — S-002: field-specific validation with clear reasons (mirrors backend)
    if (!newUser.name || !newUser.name.trim()) return toast.error('اسم الموظف مطلوب')
    if (!newUser.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email.trim())) return toast.error('البريد الإلكتروني غير صالح — مثال: name@example.com')
    if (!newUser.password || newUser.password.length < 6) return toast.error('كلمة المرور يجب ألا تقل عن 6 أحرف')
    try {
      setAddingUser(true)
      await api('/tenant/users', { method: 'POST', body: newUser })
      const list = await api('/tenant/users'); setUsers(list)
      setNewUser({ name: '', email: '', password: '', role: 'staff' }); toast.success('تمت الإضافة')
    } catch (e) { toast.error(e.message) } finally { setAddingUser(false) }
  }

  const toggleUser = async (u) => {
    try { await api(`/tenant/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); setUsers(await api('/tenant/users')) }
    catch (e) { toast.error(e.message) }
  }
  const deleteUser = async (u) => {
    if (!(await askConfirm({ title: 'حذف الموظف', desc: `حذف الموظف ${u.name} (${u.email})؟`, variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/tenant/users/${u.id}`, { method: 'DELETE' }); setUsers(await api('/tenant/users')); toast.success('تم الحذف') }
    catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-6">
      <TopBar title="إعدادات المكتب" subtitle="خصص هوية مكتبك وإدارة الحسابات" />

      <Tabs defaultValue="brand">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="brand"><ImageIcon className="w-4 h-4 ml-1" /> الهوية والعلامة</TabsTrigger>
          <TabsTrigger value="users"><Users className="w-4 h-4 ml-1" /> المستخدمون</TabsTrigger>
          <TabsTrigger value="rates"><ArrowUpRight className="w-4 h-4 ml-1" /> أسعار الصرف</TabsTrigger>
          <TabsTrigger value="referrals">🎁 نظام الإحالة</TabsTrigger>
          <TabsTrigger value="extension" className="hidden lg:inline-flex">🕋 إضافة المتصفح</TabsTrigger>
          <TabsTrigger value="print"><Printer className="w-4 h-4 ml-1" /> معاينة الطباعة</TabsTrigger>
          <TabsTrigger value="backup" className="text-rose-700 font-bold">💾 النسخ الاحتياطي</TabsTrigger>
        </TabsList>

        <TabsContent value="brand" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader><CardTitle className="text-base">شعار المكتب</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed rounded-xl p-4 text-center bg-slate-50">
                  {f.logo_base64 ? (
                    <img src={f.logo_base64} alt="logo" className="w-32 h-32 object-contain mx-auto rounded-lg bg-white shadow" />
                  ) : (
                    <div className="w-32 h-32 mx-auto rounded-lg bg-slate-200 flex items-center justify-center"><ImageIcon className="w-10 h-10 text-slate-400" /></div>
                  )}
                  <input ref={logoRef} type="file" accept="image/*" hidden onChange={e => handleLogo(e.target.files?.[0])} />
                  <Button onClick={() => logoRef.current?.click()} variant="outline" className="mt-3 gap-2"><Upload className="w-4 h-4" /> اختر صورة</Button>
                  {f.logo_base64 && <Button onClick={() => setF({ ...f, logo_base64: '' })} variant="ghost" className="mt-2 text-rose-600 text-xs">حذف</Button>}
                  <div className="text-[11px] text-slate-400 mt-2">PNG/JPG بحد أقصى 700KB</div>
                </div>
                <Field label="اللون الرئيسي"><div className="flex gap-2 items-center"><input type="color" value={f.primary_color} onChange={e => setF({ ...f, primary_color: e.target.value })} className="w-12 h-10 rounded border cursor-pointer" /><Input value={f.primary_color} onChange={e => setF({ ...f, primary_color: e.target.value })} className="flex-1" dir="ltr" /></div></Field>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">بيانات المكتب</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="اسم المكتب التجاري"><Input value={f.agency_name} onChange={e => setF({ ...f, agency_name: e.target.value })} placeholder={tenant?.name} /></Field>
                <Field label="البريد الإلكتروني"><Input dir="ltr" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
                <Field label="الهاتف"><Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
                <Field label="السجل التجاري"><Input value={f.commercial_id} onChange={e => setF({ ...f, commercial_id: e.target.value })} /></Field>
                <Field label="الرقم الضريبي"><Input value={f.tax_id} onChange={e => setF({ ...f, tax_id: e.target.value })} /></Field>
                <div className="md:col-span-2"><Field label="العنوان"><Input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field></div>
                <div className="md:col-span-2"><Field label="نص رأس الفواتير"><Textarea rows={2} value={f.header} onChange={e => setF({ ...f, header: e.target.value })} placeholder="بسم الله الرحمن الرحيم / شعار / وصف قصير" /></Field></div>
                <div className="md:col-span-2"><Field label="نص تذييل الفواتير"><Textarea rows={2} value={f.footer} onChange={e => setF({ ...f, footer: e.target.value })} placeholder="شكراً لتعاملكم معنا" /></Field></div>
              </CardContent>
            </Card>
          </div>
          {/* v3.77 — Office verification & documents */}
          <OfficeVerificationCard />
          <div className="flex justify-end mt-4"><Button onClick={save} disabled={saving} className="grad-brand text-white gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'حفظ الإعدادات'}</Button></div>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between"><CardTitle>المستخدمون ({users.length}/{tenant?.max_users || 2})</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end mb-4 p-3 bg-slate-50 rounded-lg">
                <Field label="الاسم"><Input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} /></Field>
                <Field label="البريد"><Input dir="ltr" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} /></Field>
                {/* v3.88.4 — S-001: proper password field — masked with autocomplete isolation */}
                <Field label="كلمة المرور"><Input dir="ltr" type="password" autoComplete="new-password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} /></Field>
                <Button onClick={addUser} disabled={addingUser} className="grad-brand text-white gap-2">{addingUser ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} إضافة موظف</Button>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
                <b>ℹ️ تنويه:</b> المالك (Owner) يحصل تلقائياً على كافة الصلاحيات. الموظف الجديد يبدأ بصلاحيات محدودة (عرض وإضافة التذاكر/التأشيرات/الخدمات فقط). اضغط على <b>"تعديل الصلاحيات"</b> بجانب اسم الموظف لضبط ما يستطيع فعله.
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>البريد</TableHead><TableHead>الدور</TableHead><TableHead>الحالة</TableHead><TableHead className="text-center">الصلاحيات</TableHead><TableHead className="text-left">إجراء</TableHead></TableRow></TableHeader>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-semibold">{u.name}</TableCell>
                      <TableCell dir="ltr" className="text-xs">{u.email}</TableCell>
                      <TableCell><Badge variant={u.role === 'owner' ? 'default' : 'outline'}>{u.role === 'owner' ? 'مالك' : 'موظف'}</Badge></TableCell>
                      <TableCell><Badge className={u.active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-rose-100 text-rose-700 hover:bg-rose-100'}>{u.active ? 'نشط' : 'موقوف'}</Badge></TableCell>
                      <TableCell className="text-center">
                        {u.role === 'owner' ? (
                          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">كاملة</Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setPermTarget(u)} className="gap-1 h-7 text-xs">
                            <Key className="w-3 h-3" /> تعديل الصلاحيات
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-left">
                        {u.role !== 'owner' && (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="outline" onClick={() => toggleUser(u)} title={u.active ? 'إيقاف' : 'تفعيل'}><Power className="w-3 h-3" /></Button>
                            <Button size="sm" variant="outline" onClick={() => deleteUser(u)} className="text-rose-600" title="حذف"><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <PermissionsDialog target={permTarget} onClose={() => setPermTarget(null)} onSaved={() => { setPermTarget(null); api('/tenant/users').then(setUsers).catch(() => {}); toast.success('تم حفظ الصلاحيات') }} />
        </TabsContent>

        <TabsContent value="rates" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-fuchsia-600" /> دليل أسعار العملات</CardTitle>
              <CardDescription>العملة الأساسية للنظام هي <b>الريال اليمني (YER)</b>. الأسعار تمثل: 1 وحدة من العملة = كم ريال يمني</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العملة</TableHead>
                    <TableHead>تحويل إلى</TableHead>
                    <TableHead className="text-left">سعر التحويل</TableHead>
                    <TableHead className="text-left">سعر الشراء</TableHead>
                    <TableHead className="text-left">سعر البيع</TableHead>
                    <TableHead className="text-left">الحد الأدنى</TableHead>
                    <TableHead className="text-left">الحد الأعلى</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CURRENCIES.map(c => {
                    const r = f.rates?.[c] || {}
                    const rObj = typeof r === 'object' ? r : { transfer: r, buy: r, sell: r, min: r, max: r, remarks: '' }
                    const upd = (k, v) => setF({ ...f, rates: { ...f.rates, [c]: { ...rObj, [k]: v === '' ? '' : Number(v) } } })
                    return (
                      <TableRow key={c}>
                        <TableCell><Badge className="text-sm font-bold" variant="outline">{c}</Badge> <span className="text-xs text-slate-500">{CUR_NAME[c]}</span></TableCell>
                        <TableCell><Badge variant="secondary">YER</Badge></TableCell>
                        <TableCell><Input type="number" min="0" step="0.0001" value={rObj.transfer || ''} onChange={e => upd('transfer', e.target.value)} className="w-28 text-left font-bold" disabled={c === 'YER'} /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.0001" value={rObj.buy || ''} onChange={e => upd('buy', e.target.value)} className="w-28 text-left" disabled={c === 'YER'} /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.0001" value={rObj.sell || ''} onChange={e => upd('sell', e.target.value)} className="w-28 text-left" disabled={c === 'YER'} /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.0001" value={rObj.min || ''} onChange={e => upd('min', e.target.value)} className="w-28 text-left" disabled={c === 'YER'} /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.0001" value={rObj.max || ''} onChange={e => upd('max', e.target.value)} className="w-28 text-left" disabled={c === 'YER'} /></TableCell>
                        <TableCell><Input value={rObj.remarks || ''} onChange={e => setF({ ...f, rates: { ...f.rates, [c]: { ...rObj, remarks: e.target.value } } })} className="w-40" placeholder="ملاحظة" disabled={c === 'YER'} /></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {/* Direct USD/SAR Cross-Rate */}
              <div className="mt-4 p-3 border-2 border-fuchsia-200 rounded-lg bg-fuchsia-50/50">
                <div className="text-sm font-bold text-fuchsia-800 mb-2 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4" /> سعر التحويل المباشر بين الدولار والريال السعودي (USD ↔ SAR)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Field label="سعر التحويل المباشر">
                    <Input type="number" min="0" step="0.0001" value={f.pair_usd_sar?.transfer ?? 3.75}
                      onChange={e => setF({ ...f, pair_usd_sar: { ...(f.pair_usd_sar || {}), transfer: Number(e.target.value) } })} className="text-lg font-bold" />
                  </Field>
                  <Field label="سعر شراء الدولار (SAR)">
                    <Input type="number" min="0" step="0.0001" value={f.pair_usd_sar?.buy ?? 3.74}
                      onChange={e => setF({ ...f, pair_usd_sar: { ...(f.pair_usd_sar || {}), buy: Number(e.target.value) } })} />
                  </Field>
                  <Field label="سعر بيع الدولار (SAR)">
                    <Input type="number" min="0" step="0.0001" value={f.pair_usd_sar?.sell ?? 3.76}
                      onChange={e => setF({ ...f, pair_usd_sar: { ...(f.pair_usd_sar || {}), sell: Number(e.target.value) } })} />
                  </Field>
                  <Field label="ملاحظات">
                    <Input value={f.pair_usd_sar?.remarks || ''}
                      onChange={e => setF({ ...f, pair_usd_sar: { ...(f.pair_usd_sar || {}), remarks: e.target.value } })} placeholder="سعر السوق اليومي" />
                  </Field>
                </div>
                <div className="text-xs text-slate-500 mt-2">💡 يُستخدم هذا السعر مباشرة عند التحويل بين $/SAR دون المرور بالريال اليمني — مثلاً: 1 USD = 3.75 SAR</div>
              </div>
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-slate-600 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" /> <span>الأسعار الافتراضية: <b>1 USD = 1,554 YER</b> | <b>1 SAR = 410 YER</b> — يمكنك تعديلها لتناسب معدلات السوق اليومية</span>
              </div>
            </CardContent>
            <div className="p-4"><Button onClick={save} disabled={saving} className="grad-brand text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'حفظ أسعار العملات'}</Button></div>
          </Card>
        </TabsContent>

        <TabsContent value="referrals" className="mt-4">
          <ReferralsTab />
        </TabsContent>

        <TabsContent value="extension" className="mt-4">
          <ExtensionTab />
        </TabsContent>

        <TabsContent value="print" className="mt-4">
          <Card>
            <CardHeader><CardTitle>معاينة قالب الطباعة</CardTitle><CardDescription>هكذا ستظهر فواتيرك وسنداتك</CardDescription></CardHeader>
            <CardContent>
              <div className="border rounded-xl p-8 bg-white max-w-3xl mx-auto shadow-sm" style={{ borderTop: `4px solid ${f.primary_color}` }}>
                <div className="flex items-center justify-between mb-4">
                  {f.logo_base64 ? <img src={f.logo_base64} className="h-16 object-contain" alt="logo" /> : <div className="w-16 h-16 bg-slate-100 rounded flex items-center justify-center"><ImageIcon className="w-8 h-8 text-slate-400" /></div>}
                  <div className="text-left">
                    <div className="text-2xl font-extrabold" style={{ color: f.primary_color }}>{f.agency_name || tenant?.name}</div>
                    <div className="text-xs text-slate-500">{f.phone} • {f.email}</div>
                    <div className="text-xs text-slate-500">{f.address}</div>
                    {f.tax_id && <div className="text-xs">الرقم الضريبي: {f.tax_id}</div>}
                  </div>
                </div>
                {f.header && <div className="text-center text-sm my-3 p-2 bg-slate-50 rounded">{f.header}</div>}
                <div className="border-t border-b py-3 my-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-slate-500">رقم السند:</span> <b>PRINT-DEMO-001</b></div>
                    <div><span className="text-slate-500">التاريخ:</span> {fmtDate(new Date())}</div>
                    <div><span className="text-slate-500">العميل:</span> عميل تجريبي</div>
                    <div><span className="text-slate-500">العملة:</span> SAR</div>
                  </div>
                </div>
                <Table>
                  <TableHeader><TableRow style={{ background: f.primary_color + '15' }}><TableHead>الوصف</TableHead><TableHead className="text-left">المبلغ</TableHead></TableRow></TableHeader>
                  <TableBody>
                    <TableRow><TableCell>تذكرة طيران — RUH/CAI</TableCell><TableCell className="text-left font-bold">1,500.00</TableCell></TableRow>
                    <TableRow><TableCell>تأشيرة عمرة</TableCell><TableCell className="text-left font-bold">300.00</TableCell></TableRow>
                    <TableRow style={{ background: f.primary_color + '10' }}><TableCell className="font-bold">الإجمالي</TableCell><TableCell className="text-left font-extrabold" style={{ color: f.primary_color }}>1,800.00 SAR</TableCell></TableRow>
                  </TableBody>
                </Table>
                {f.footer && <div className="text-center text-xs text-slate-500 mt-6 pt-3 border-t">{f.footer}</div>}
              </div>
              <div className="text-center mt-4"><Button onClick={() => window.print()} variant="outline" className="gap-2"><Printer className="w-4 h-4" /> طباعة تجريبية</Button></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* v3.9.20 — Data Backup Tab */}
        <TabsContent value="backup" className="mt-4">
          <BackupSection tenant={tenant} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ================================================================
// TENANT APP
// ================================================================
function TenantApp() {
  const [tab, setTab] = useState('dashboard')
  // v3.86 — real mobile drawer state + edge-swipe to open (right edge, RTL)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // v3.86.1 — lock background page scroll while the drawer is open (drawer itself stays scrollable)
  useEffect(() => {
    if (!mobileNavOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileNavOpen])
  useEffect(() => {
    let start = null
    const onStart = (e) => {
      if (window.innerWidth >= 768) { start = null; return }
      const t = e.touches[0]
      start = (window.innerWidth - t.clientX <= 24) ? { x: t.clientX, y: t.clientY } : null
    }
    const onMove = (e) => {
      if (!start) return
      const t = e.touches[0]
      if (Math.abs(t.clientY - start.y) > 60) { start = null; return }
      if (start.x - t.clientX > 40) { setMobileNavOpen(true); start = null }
    }
    const onEnd = () => { start = null }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [])
  const { user, tenant, logout } = useAuth()
  // v3.46 — Idle session auto-lock: logout via the EXISTING logout mechanism after inactivity,
  // saving the current section so the user resumes exactly where they were after re-login.
  const idleTimerRef = useRef(null)
  const tabRef = useRef(tab)
  useEffect(() => { tabRef.current = tab }, [tab])
  useEffect(() => {
    const arm = () => {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        try { sessionStorage.setItem(IDLE_RESUME_KEY, tabRef.current) } catch {}
        toast.warning(`🔒 تم قفل الجلسة تلقائياً بعد ${IDLE_TIMEOUT_MINUTES} دقيقة من عدم النشاط — سجّل الدخول للمتابعة من نفس الشاشة`, { duration: 10000 })
        logout()
      }, IDLE_TIMEOUT_MINUTES * 60 * 1000)
    }
    let lastMove = 0
    const onActivity = (e) => {
      if (e.type === 'mousemove') { const now = Date.now(); if (now - lastMove < 5000) return; lastMove = now }
      arm()
    }
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove']
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))
    arm()
    return () => { clearTimeout(idleTimerRef.current); events.forEach(ev => window.removeEventListener(ev, onActivity)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // v3.46 — Resume the exact section after an idle-lock re-login (consumed once).
  // Hard refresh is unaffected: this key exists ONLY after an idle logout.
  useEffect(() => {
    try {
      const resume = sessionStorage.getItem(IDLE_RESUME_KEY)
      if (resume) {
        sessionStorage.removeItem(IDLE_RESUME_KEY)
        if (NAV.some(n => n.id === resume) && canModule(user, resume)) setTab(resume)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // v3.45 — RBAC: keep employees inside modules they're allowed to access
  const tabAllowed = canModule(user, tab)
  useEffect(() => {
    if (user && user.role !== 'owner' && !canModule(user, tab)) {
      const first = NAV.find(n => canModule(user, n.id))
      if (first && first.id !== tab) setTab(first.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tab])
  const [announcements, setAnnouncements] = useState([])
  const [popupShown, setPopupShown] = useState(false)
  const [popupAnn, setPopupAnn] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [quotaModalOpen, setQuotaModalOpen] = useState(false)
  // v3.21 — Installment alert (proactive cash-flow reminder)
  const [instAlert, setInstAlert] = useState(null)
  const [instAlertDismissed, setInstAlertDismissed] = useState(false)
  // v3.53 — Meraaj booking notification bell (polls every 60s for users with Meraaj access)
  const [meraajPending, setMeraajPending] = useState(0)
  const meraajPendingRef = useRef(0)
  const [meraajCancReq, setMeraajCancReq] = useState(0) // v3.73 — cancellation requests needing a decision
  const meraajCancReqRef = useRef(0)
  const meraajInitRef = useRef(false)
  const autoRetrySeenRef = useRef(null) // v3.68 — last auto-retry run timestamp already toasted
  useEffect(() => {
    if (!canModule(user, 'meraaj')) return
    let stop = false
    const poll = async () => {
      try {
        const r = await api('/meraaj/inbound-count')
        if (stop) return
        const n = Number(r?.pending) || 0
        const cq = Number(r?.cancellation_requests) || 0 // v3.73
        if (!meraajInitRef.current) {
          // First poll after login: gentle reminder toast if there are pending bookings (no sound)
          if (n > 0) toast.success(`🕋 لديك ${n} حجز معراج بانتظار الاعتماد`, { duration: 8000 })
          if (cq > 0) toast(`📩 لديك ${cq} طلب إلغاء حجز من معراج يحتاج موقف المكتب`, { duration: 8000 }) // v3.73
          // v3.68 — don't toast about auto-retry runs that happened before this session
          autoRetrySeenRef.current = r?.auto_retry_last?.at || null
        } else if (n > meraajPendingRef.current) {
          // A NEW booking arrived while working: toast + short chime (v3.54)
          toast.success(`🕋 حجز جديد من معراج! لديك ${n} حجز بانتظار الاعتماد`, { duration: 10000 })
          playMeraajChime()
        }
        // v3.73 — a NEW cancellation request arrived while working
        if (meraajInitRef.current && cq > meraajCancReqRef.current) {
          toast(`📩 طلب إلغاء حجز جديد من معراج — أرسل موقف المكتب والأدلة`, { duration: 10000 })
          playMeraajChime()
        }
        // v3.68 — background auto-retry success notice (new successful run since last seen)
        if (meraajInitRef.current && r?.auto_retry_last?.at && r.auto_retry_last.at !== autoRetrySeenRef.current && (r.auto_retry_last.succeeded || 0) > 0) {
          toast.success(`🔄 الإعادة التلقائية: أُرسل ${r.auto_retry_last.succeeded} من الأحداث الفاشلة لمعراج بنجاح`, { duration: 8000 })
          autoRetrySeenRef.current = r.auto_retry_last.at
        }
        meraajInitRef.current = true
        meraajPendingRef.current = n
        setMeraajPending(n)
        meraajCancReqRef.current = cq // v3.73
        setMeraajCancReq(cq)
      } catch { /* silent — module may be blocked or offline */ }
    }
    poll()
    const iv = setInterval(poll, 60000)
    return () => { stop = true; clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // v3.58 — Bell quick panel: list pending Meraaj bookings with one-tap approve
  const [bellOpen, setBellOpen] = useState(false)
  const [bellList, setBellList] = useState(null) // null = loading
  const [bellBusy, setBellBusy] = useState(null)
  const refreshBellCount = async () => {
    try {
      const r = await api('/meraaj/inbound-count')
      const n = Number(r?.pending) || 0
      meraajPendingRef.current = n
      setMeraajPending(n)
      const cq = Number(r?.cancellation_requests) || 0 // v3.73
      meraajCancReqRef.current = cq
      setMeraajCancReq(cq)
    } catch { /* silent */ }
  }
  const toggleBellPanel = async () => {
    const next = !bellOpen
    setBellOpen(next)
    if (next) {
      setBellList(null)
      setBellCancList(null) // v3.73
      try {
        const list = await api('/meraaj/inbound-bookings')
        setBellList((list || []).filter(b => b.status === 'new'))
        setBellCancList((list || []).filter(b => b.status === 'approved' && b.cancellation_status === 'requested')) // v3.73
      } catch { setBellList([]); setBellCancList([]) }
    }
  }
  // v3.73 — cancellation-request decisions from the bell (approve directly / reject with reason)
  const [bellCancList, setBellCancList] = useState(null)
  const [bellCancRejectId, setBellCancRejectId] = useState(null)
  const [bellCancRejectReason, setBellCancRejectReason] = useState('')
  const approveCancFromBell = async (id) => {
    setBellBusy(id)
    try {
      const r = await api(`/meraaj/inbound-bookings/${id}/cancellation/approve`, { method: 'POST', body: {} })
      toast.success(`✅ أُلغي الحجز — تحررت ${r.released_seats} مقاعد${r.accounting_reversed ? ' وعُكس القيد' : ''} وأُشعر معراج`)
      setBellCancList(l => (l || []).filter(x => x.id !== id))
      await refreshBellCount()
    } catch (e) { toast.error(e.message) } finally { setBellBusy(null) }
  }
  const rejectCancFromBell = async (id) => {
    const reason = bellCancRejectReason.trim()
    if (!reason) { toast.error('سبب رفض الإلغاء إلزامي'); return }
    setBellBusy(id)
    try {
      await api(`/meraaj/inbound-bookings/${id}/cancellation/reject`, { method: 'POST', body: { reason } })
      toast.success('🛡️ رُفض طلب الإلغاء — الحجز يبقى معتمداً')
      setBellCancList(l => (l || []).filter(x => x.id !== id))
      setBellCancRejectId(null); setBellCancRejectReason('')
      await refreshBellCount()
    } catch (e) { toast.error(e.message) } finally { setBellBusy(null) }
  }
  const approveFromBell = async (id) => {
    setBellBusy(id)
    try {
      await api(`/meraaj/inbound-bookings/${id}/approve`, { method: 'POST' })
      toast.success('✅ تم اعتماد الحجز وتحويله لحجز فعلي بقيد محاسبي')
      setBellList(l => (l || []).filter(x => x.id !== id))
      await refreshBellCount()
    } catch (e) { toast.error(e.message) } finally { setBellBusy(null) }
  }
  // v3.59 — reject from bell panel with a REQUIRED reason (sent back to Meraaj buyer)
  const [bellRejectId, setBellRejectId] = useState(null)
  const [bellRejectReason, setBellRejectReason] = useState('')
  const rejectFromBell = async (id) => {
    const reason = bellRejectReason.trim()
    if (!reason) { toast.error('سبب الرفض إلزامي — سيظهر للمكتب المشتري في معراج'); return }
    setBellBusy(id)
    try {
      await api(`/meraaj/inbound-bookings/${id}/reject`, { method: 'POST', body: { reason } })
      toast.success('⛔ تم رفض الحجز وإشعار معراج بالسبب — أُعيدت المقاعد للسوق')
      setBellList(l => (l || []).filter(x => x.id !== id))
      setBellRejectId(null); setBellRejectReason('')
      await refreshBellCount()
    } catch (e) { toast.error(e.message) } finally { setBellBusy(null) }
  }

  useEffect(() => {
    // Load announcements
    api('/announcements/active').then(list => {
      setAnnouncements(list || [])
      const popup = (list || []).find(a => a.type === 'popup')
      if (popup && !sessionStorage.getItem(`rahaal_popup_${popup.id}_seen`)) {
        setPopupAnn(popup); setPopupShown(true)
      }
    }).catch(() => {})
    // v3.21 — Installment alert (once per session dismissal)
    api('/my/installment-alert').then(res => {
      if (res?.alert && !sessionStorage.getItem(`rahaal_inst_alert_${res.alert.no}_${res.alert.due_date}`)) setInstAlert(res.alert)
    }).catch(() => {})
    // Detect impersonation via /auth/me flag
    api('/auth/me').then(me => { if (me?.impersonation) setIsImpersonating(true) }).catch(() => {})
    // Register global quota-exceeded listener
    window.__rahaalOnQuotaExceeded = () => setQuotaModalOpen(true)
    return () => { delete window.__rahaalOnQuotaExceeded }
  }, [])

  const banner = announcements.find(a => a.type === 'banner')

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* v3.86 — overlay is MOUNTED ONLY while the drawer is open (no invisible layer
          can ever block touches after closing), tapping it closes the drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}
      <Sidebar
        current={tab}
        onChange={(id) => { setTab(id); setMobileNavOpen(false) }}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      {/* v3.86 — floating menu button (mobile only, hidden while drawer is open) */}
      {!mobileNavOpen && (
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="فتح القائمة"
          className="md:hidden fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-[#1e3a8a] to-[#0f1e4d] text-white shadow-xl shadow-blue-900/40 border border-blue-700/50 flex items-center justify-center active:scale-95 transition-transform"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}
      <main className="flex-1 p-3 sm:p-4 md:p-6 lg:p-8 max-w-[1600px] overflow-x-hidden min-w-0">
        {isImpersonating && (
          <div className="mb-3 px-4 py-2 rounded-lg bg-gradient-to-l from-red-600 to-rose-600 text-white flex items-center gap-2 shadow-lg animate-pulse">
            <span className="text-xl">👁️</span>
            <div className="font-bold text-sm">أنت متصفّح كـ Super Admin — جلسة مؤقتة</div>
            <Button size="sm" variant="secondary" className="mr-auto h-7" onClick={logout}>إنهاء الجلسة</Button>
          </div>
        )}
        {banner && (
          <div className="mb-3 px-4 py-2 rounded-lg bg-gradient-to-l from-amber-500 to-orange-500 text-white flex items-center gap-2 shadow-md">
            <span className="text-xl">📢</span>
            <div className="flex-1"><b className="text-sm">{banner.title}:</b> <span className="text-sm">{banner.body}</span></div>
            {banner.link_url && <a href={banner.link_url} target="_blank" rel="noopener" className="text-xs underline">تفاصيل</a>}
          </div>
        )}
        <div className="flex justify-end items-center gap-2 mb-2">
          {/* v3.56 — Meraaj pending bell inline next to logout. v3.58 — click opens a quick panel
              listing each pending booking with one-tap approve (instead of navigating away) */}
          {(meraajPending > 0 || meraajCancReq > 0) && canModule(user, 'meraaj') && (
            <div className="relative">
              <button onClick={toggleBellPanel} title="طلبات معراج تحتاج قرارك"
                className="flex items-center gap-1.5 bg-white border-2 border-amber-400 shadow-md rounded-full px-3 py-1.5 hover:bg-amber-50 transition">
                <span className="animate-pulse">🔔</span>
                <span className="text-xs font-black text-amber-700">{[meraajPending > 0 ? `${meraajPending} حجز جديد` : null, meraajCancReq > 0 ? `${meraajCancReq} طلب إلغاء` : null].filter(Boolean).join(' • ')} — معراج</span>
              </button>
              {bellOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setBellOpen(false)} />
                  <div className="absolute left-0 top-full mt-2 z-50 w-[340px] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 bg-gradient-to-l from-amber-50 to-white border-b flex items-center justify-between">
                      <span className="text-xs font-black text-amber-800">🕋 حجوزات معراج المعلقة</span>
                      <button onClick={() => { setBellOpen(false); setTab('meraaj') }} className="text-[10px] font-bold text-blue-600 hover:underline">فتح متجر معراج ←</button>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
                      {bellList === null ? (
                        <div className="p-5 text-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline ml-1" /> جارٍ التحميل...</div>
                      ) : bellList.length === 0 && (bellCancList || []).length === 0 ? (
                        <div className="p-5 text-center text-xs text-emerald-600 font-bold">✅ لا توجد طلبات معلقة — تم البت في الكل</div>
                      ) : bellList.map(b => (
                        <div key={b.id} className="p-2.5 hover:bg-amber-50/40">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-black text-slate-800 truncate">{b.package_name}</div>
                              <div className="text-[10px] text-slate-500 truncate">{b.buyer_office_name} • {b.seats} مقاعد • {(Number(b.total_price) || 0).toLocaleString('en-US')} {b.currency}</div>
                              <div className="text-[9px] text-slate-400">{new Date(b.created_at).toLocaleString('en-GB')}
                                {/* v3.65 — passport completeness flag in the bell panel */}
                                {(b.registrants || []).filter(r => !String(r?.passport_no || '').trim()).length > 0 && (
                                  <span className="mr-1.5 font-black text-amber-700">🛂 {(b.registrants || []).filter(r => !String(r?.passport_no || '').trim()).length} بلا جواز</span>
                                )}
                              </div>
                            </div>
                            <Button size="sm" onClick={() => approveFromBell(b.id)} disabled={bellBusy === b.id}
                              className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 shrink-0">
                              {bellBusy === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : '✅'} اعتماد
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setBellRejectId(bellRejectId === b.id ? null : b.id); setBellRejectReason('') }} disabled={bellBusy === b.id}
                              className="h-7 text-[10px] px-2 border-rose-300 text-rose-600 hover:bg-rose-50 shrink-0" title="رفض الحجز مع إرسال السبب لمعراج">⛔</Button>
                          </div>
                          {/* v3.59 — inline required-reason input for rejection */}
                          {bellRejectId === b.id && (
                            <div className="mt-2 flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg p-1.5">
                              <Input value={bellRejectReason} onChange={e => setBellRejectReason(e.target.value)}
                                placeholder="سبب الرفض (إلزامي — يظهر للمكتب المشتري)" autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') rejectFromBell(b.id) }}
                                className="h-7 text-[10px] bg-white flex-1" />
                              <Button size="sm" onClick={() => rejectFromBell(b.id)} disabled={bellBusy === b.id || !bellRejectReason.trim()}
                                className="h-7 text-[10px] bg-rose-600 hover:bg-rose-700 shrink-0">
                                {bellBusy === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'تأكيد الرفض'}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                      {/* v3.73 — CANCELLATION REQUESTS group (approved bookings the buyer wants to cancel) */}
                      {(bellCancList || []).length > 0 && (
                        <>
                          <div className="px-3 py-1.5 bg-orange-50 border-y border-orange-200 text-[10px] font-black text-orange-700">📩 طلبات إلغاء حجوزات معتمدة ({bellCancList.length}) — بانتظار موقف المكتب</div>
                          {bellCancList.map(b => (
                            <div key={b.id} className="p-2.5 hover:bg-orange-50/40 bg-orange-50/20">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-black text-slate-800 truncate">{b.package_name}</div>
                                  <div className="text-[10px] text-slate-500 truncate">{b.buyer_office_name} • {b.seats} مقاعد • {(Number(b.total_price) || 0).toLocaleString('en-US')} {b.currency}</div>
                                  {b.cancellation_reason && <div className="text-[9px] text-orange-600 truncate">السبب: {b.cancellation_reason}</div>}
                                  <div className="text-[9px] text-slate-400">{b.cancellation_requested_at ? new Date(b.cancellation_requested_at).toLocaleString('en-GB') : ''} • الحالة: معتمد</div>
                                </div>
                                <Badge className="bg-indigo-100 text-indigo-700 border border-indigo-200 whitespace-nowrap">⚖️ القرار في معراج</Badge>
                              </div>
                              {false && bellCancRejectId === b.id && (
                                <div className="mt-2 flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
                                  <Input value={bellCancRejectReason} onChange={e => setBellCancRejectReason(e.target.value)}
                                    placeholder="سبب رفض الإلغاء (إلزامي — يظهر للمشتري)" autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') rejectCancFromBell(b.id) }}
                                    className="h-7 text-[10px] bg-white flex-1" />
                                  <Button size="sm" onClick={() => rejectCancFromBell(b.id)} disabled={bellBusy === b.id || !bellCancRejectReason.trim()}
                                    className="h-7 text-[10px] bg-slate-700 hover:bg-slate-800 shrink-0">
                                    {bellBusy === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'تأكيد'}
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={logout} className="gap-2 text-slate-500 hover:text-rose-600"><LogOut className="w-4 h-4" /> خروج</Button>
        </div>
        <QuotaBanner quota={tenant?.journal_quota} />
        {/* v3.21 — Installment due/overdue alert */}
        {instAlert && !instAlertDismissed && (
          <div className={`mb-3 px-4 py-2.5 rounded-lg flex items-center gap-3 shadow-md text-white ${instAlert.overdue ? 'bg-gradient-to-l from-rose-600 to-red-600' : 'bg-gradient-to-l from-amber-500 to-yellow-500'}`}>
            <span className="text-xl">{instAlert.overdue ? '🚨' : '⏰'}</span>
            <div className="flex-1 text-sm">
              <b>{instAlert.overdue ? 'قسط متأخر!' : 'تذكير بقسط قادم:'}</b>{' '}
              القسط رقم {instAlert.no} من {instAlert.total_count} بمبلغ <b>{Number(instAlert.amount).toLocaleString('en-US')}</b> —{' '}
              {instAlert.overdue
                ? <>تأخر السداد منذ <b>{Math.abs(instAlert.days_left)}</b> يوم (الاستحقاق: {instAlert.due_date})</>
                : instAlert.days_left === 0
                  ? <>يستحق <b>اليوم</b> ({instAlert.due_date})</>
                  : <>يستحق خلال <b>{instAlert.days_left}</b> يوم ({instAlert.due_date})</>}
              {' '}— يرجى التواصل مع الإدارة للسداد.
            </div>
            <button onClick={() => { setInstAlertDismissed(true); sessionStorage.setItem(`rahaal_inst_alert_${instAlert.no}_${instAlert.due_date}`, '1') }} className="text-white/80 hover:text-white text-lg leading-none px-1" title="إخفاء (لهذه الجلسة)">✕</button>
          </div>
        )}
        {/* v3.53 Meraaj pending bell — v3.56: moved inline into the header row above (no fixed overlay) */}
        {/* v3.45 — RBAC module guard (server also enforces on API level) */}
        {!tabAllowed && (
          <Card className="border-2 border-rose-200 bg-rose-50/40"><CardContent className="p-12 text-center">
            <div className="text-5xl mb-3">🚫</div>
            <div className="text-xl font-black text-rose-700">غير مصرح بالوصول</div>
            <div className="text-sm text-slate-500 mt-2">ليس لديك صلاحية لعرض هذا القسم — تواصل مع مالك المكتب لمنحك الصلاحية.</div>
          </CardContent></Card>
        )}
        {/* v3.99 — Batch 1: platform SA gets the admin home (old admin KPIs, no travel widgets);
            every other office keeps the original travel Dashboard untouched */}
        {tabAllowed && tab === 'dashboard' && <ErrorBoundary tabName="لوحة التحكم">{user?.role === 'super_admin' ? <RahaalAdminHome setTab={setTab} /> : <Dashboard setTab={setTab} />}</ErrorBoundary>}
        {tabAllowed && tab === 'tickets' && <ErrorBoundary tabName="حجز التذاكر"><TicketsScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'visas' && <ErrorBoundary tabName="التأشيرات والخدمات"><VisasScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'services' && <ErrorBoundary tabName="الخدمات"><ServicesScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'packages' && <ErrorBoundary tabName="الباكجات والبرامج"><PackagesScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'meraaj' && <ErrorBoundary tabName="متجر معراج"><MeraajStoreScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'fx' && <ErrorBoundary tabName="صرافة العملات"><FxScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'receipt' && <ErrorBoundary tabName="سند القبض"><VoucherScreen mode="receipt" /></ErrorBoundary>}
        {tabAllowed && tab === 'payment' && <ErrorBoundary tabName="سند الصرف"><VoucherScreen mode="payment" /></ErrorBoundary>}
        {tabAllowed && tab === 'clients' && <ErrorBoundary tabName="العملاء"><PartiesScreen kind="clients" /></ErrorBoundary>}
        {tabAllowed && tab === 'suppliers' && <ErrorBoundary tabName="الموردون"><PartiesScreen kind="suppliers" /></ErrorBoundary>}
        {/* v4.4 — «الصناديق والبنوك»: original financial content UNTOUCHED (first tab, same component);
            the super admin additionally sees the platform payment-methods/financial-entities tabs */}
        {tabAllowed && tab === 'boxes' && <ErrorBoundary tabName="الصناديق والبنوك">{user?.role === 'super_admin' ? <BoxesBanksHub /> : <BoxesScreen />}</ErrorBoundary>}
        {tabAllowed && tab === 'chart' && <ErrorBoundary tabName="الدليل المحاسبي"><ChartScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'journal' && <ErrorBoundary tabName="قيود اليومية"><JournalScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'reports' && <ErrorBoundary tabName="التقارير المالية"><ReportsScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'query' && <ErrorBoundary tabName="مركز الاستعلامات"><QueryCenterScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'visa-monitor' && <ErrorBoundary tabName="مراقبة التأشيرات"><VisaMonitorScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'settings' && user.role === 'owner' && <ErrorBoundary tabName="إعدادات المكتب"><OfficeSettings /></ErrorBoundary>}
        {tabAllowed && tab === 'affiliate' && <ErrorBoundary tabName="التسويق بالعمولة"><AffiliateScreen /></ErrorBoundary>}
        {/* v3.99 — Batch 1: «إدارة رحّال» — the OLD live admin components reused as-is (embedded) */}
        {tabAllowed && tab === 'platform-offices' && <ErrorBoundary tabName="إدارة المكاتب"><PlatformOfficesHub /></ErrorBoundary>}
        {/* v4.0 — Batch 2: the OLD pricing editor (v3.14) + subscriptions/installments (v3.16) reused as screens */}
        {tabAllowed && tab === 'platform-plans' && <ErrorBoundary tabName="الباقات والتسعير"><PricingConfigEditor asScreen /></ErrorBoundary>}
        {tabAllowed && tab === 'platform-subs' && <ErrorBoundary tabName="الاشتراكات والأقساط"><PlatformSubscriptionsScreen /></ErrorBoundary>}
        {/* v4.4 — consolidated hubs: users&perms / system settings / geo (components reused as tabs — zero copies) */}
        {tabAllowed && tab === 'platform-people' && <ErrorBoundary tabName="المستخدمون والصلاحيات"><PlatformPeopleHub /></ErrorBoundary>}
        {tabAllowed && tab === 'platform-system' && <ErrorBoundary tabName="إعدادات النظام"><PlatformSystemHub /></ErrorBoundary>}
        {tabAllowed && tab === 'platform-geo' && <ErrorBoundary tabName="المواقع الجغرافية"><AdminGeoCenter /></ErrorBoundary>}
        {/* v4.2 — program sales replaces the travel-sales aggregation (unsuitable per user directive); commissions gains an operational rules manager */}
        {tabAllowed && tab === 'platform-sales' && <ErrorBoundary tabName="مبيعات برنامج رحّال"><div className="space-y-6"><OrdersScreen salesOnly /><ProgramSalesScreen /></div></ErrorBoundary>}
        {tabAllowed && tab === 'platform-commissions' && <ErrorBoundary tabName="مركز العمولات"><div className="space-y-4"><CommissionRulesManager /><CommissionsLedger /><AdminCommissionsCenter /></div></ErrorBoundary>}
        {/* v4.3 — Group 3: unified orders registry (+ existing specialized requests embedded) and notifications center (moved as-is) */}
        {tabAllowed && tab === 'platform-orders' && <ErrorBoundary tabName="مركز الطلبات"><div className="space-y-6"><OrdersScreen /><div><div className="text-sm font-black text-slate-600 mb-2">📎 الطلبات المتخصصة القائمة (استعادة كلمات المرور / توثيق / سحب عمولات / معراج) — النظام القائم كما هو</div><AdminRequestsCenter /></div></div></ErrorBoundary>}
        {tabAllowed && tab === 'platform-notify' && <ErrorBoundary tabName="مركز التنبيهات"><AdminNotifyCenter /></ErrorBoundary>}
        {tabAllowed && tab === 'platform-ads' && <ErrorBoundary tabName="الإعلانات والعروض"><AnnouncementsManager /></ErrorBoundary>}
        {tabAllowed && tab === 'help' && <ErrorBoundary tabName="دليل الاستخدام"><HelpCenter setTab={setTab} /></ErrorBoundary>}

        {/* v2.8.1 — Global footer with contact + Target Media badge */}
        <div className="mt-8 pt-4 border-t border-slate-200 text-center text-xs text-slate-500 space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span>📍 اليمن - عدن - الشيخ عثمان - بجانب بنك التضامن</span>
            <span className="text-slate-300">·</span>
            <span dir="ltr">📞 +967 781 115 482</span>
            <span className="text-slate-300">·</span>
            <span dir="ltr">📞 +967 781 455 584</span>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <span className="text-[11px]">Powered by</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#1e3a8a" strokeWidth="2.5" />
              <circle cx="12" cy="12" r="5" fill="#f97316" />
              <circle cx="12" cy="12" r="1.5" fill="#fff" />
            </svg>
            <span className="text-xs font-black text-[#1e3a8a]">Target Media</span>
            <span className="text-[10px]">· تارجت ميديا</span>
            <span>© 2025</span>
          </div>
        </div>
      </main>

      {/* Popup Announcement */}
      {popupShown && popupAnn && (
        <Dialog open={popupShown} onOpenChange={(v) => { setPopupShown(v); if (!v) sessionStorage.setItem(`rahaal_popup_${popupAnn.id}_seen`, '1') }}>
          <DialogContent className="max-w-lg" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">📢 {popupAnn.title}</DialogTitle>
            </DialogHeader>
            {popupAnn.image_url && <img src={popupAnn.image_url} alt="" className="w-full rounded-lg" />}
            <div className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{popupAnn.body}</div>
            {popupAnn.link_url && <a href={popupAnn.link_url} target="_blank" rel="noopener" className="text-blue-600 font-bold text-sm">🔗 المزيد</a>}
            <DialogFooter>
              <Button onClick={() => { setPopupShown(false); sessionStorage.setItem(`rahaal_popup_${popupAnn.id}_seen`, '1') }} className="grad-brand text-white">فهمت — إغلاق</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Out-of-Quota Modal */}
      <OutOfQuotaModal open={quotaModalOpen} onOpenChange={setQuotaModalOpen} tenant={tenant} />
    </div>
  )
}

// v3.14 — 6-tier pricing display (silver/gold/enterprise × installments/annual)
// Strike-through original price (gray) + bold black final price, per approved spec.
function PricingPlans({ tenant }) {
  const [cfg, setCfg] = useState(null)
  const [mode, setMode] = useState('annual') // 'annual' | 'installments'
  useEffect(() => { api('/pricing').then(setCfg).catch(() => {}) }, [])
  if (!cfg) return <div className="text-center py-6 text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /> جاري تحميل الباقات...</div>
  const hasDisc = cfg.discount_enabled && cfg.discount_percent > 0
  const PLAN_STYLE = {
    silver: { ring: 'border-slate-300', head: 'bg-gradient-to-l from-slate-100 to-slate-50', badge: 'bg-slate-500' },
    gold: { ring: 'border-amber-400 shadow-lg', head: 'bg-gradient-to-l from-amber-100 to-yellow-50', badge: 'bg-amber-500' },
    enterprise: { ring: 'border-indigo-400', head: 'bg-gradient-to-l from-indigo-100 to-blue-50', badge: 'bg-indigo-600' },
  }
  const contactWA = (p) => {
    const cur = (p.pricing?.currency || 'USD') === 'USD' ? '$' : `${p.pricing?.currency || ''} `
    const modeTxt = mode === 'annual' ? 'سنوي (دفعة واحدة — قيود مفتوحة)' : `أقساط (${cfg.installments_count} أقساط)`
    const price = mode === 'annual' ? `${cur}${p.pricing.annual.final}` : `${cur}${p.pricing.installment.final_per} × ${cfg.installments_count}`
    const msg = `أرغب في الاشتراك بباقة ${p.name_ar} — ${modeTxt} بسعر ${price}\nالمكتب: ${tenant?.name || ''}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }
  return (
    <div className="space-y-4">
      {/* Billing mode switch => 6 total offerings */}
      <div className="flex items-center justify-center gap-2">
        <button onClick={() => setMode('annual')} className={`px-4 py-2 rounded-full text-sm font-bold border transition ${mode === 'annual' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>📅 سنوي — قيود مفتوحة ∞</button>
        <button onClick={() => setMode('installments')} className={`px-4 py-2 rounded-full text-sm font-bold border transition ${mode === 'installments' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>💳 {cfg.installments_count} أقساط — قيود محدودة</button>
      </div>
      {hasDisc && <div className="text-center"><Badge className="bg-rose-600 text-white text-sm px-3 py-1">🔥 خصم {cfg.discount_percent}% لفترة محدودة</Badge></div>}
      <div className="grid md:grid-cols-3 gap-3">
        {cfg.plans.map(p => {
          const st = PLAN_STYLE[p.key] || PLAN_STYLE.silver
          const isCurrent = tenant?.plan_tier === p.key
          const ann = p.pricing.annual, inst = p.pricing.installment
          const cur = (p.pricing?.currency || 'USD') === 'USD' ? '$' : `${p.pricing?.currency || ''} ` // v4.0 — plan currency
          const durTxt = p.duration_days && Number(p.duration_days) !== 365 ? `لكل ${p.duration_days} يوماً — دفعة واحدة` : 'سنوياً — دفعة واحدة' // v4.0 — plan duration
          return (
            <Card key={p.key} className={`${st.ring} border-2 relative overflow-hidden`}>
              {p.key === 'gold' && <div className="absolute top-2 left-2"><Badge className="bg-amber-500 text-white text-[10px]">⭐ الأكثر طلباً</Badge></div>}
              {isCurrent && <div className="absolute top-2 right-2"><Badge className="bg-emerald-600 text-white text-[10px]">باقتك الحالية</Badge></div>}
              <CardHeader className={`${st.head} pb-3`}>
                <CardTitle className="text-center text-lg">{p.icon} {p.name_ar}</CardTitle>
                {p.description && <div className="text-center text-[10.5px] text-slate-500">{p.description}</div>}
                <div className="text-center mt-1">
                  {mode === 'annual' ? (
                    <>
                      {hasDisc && <div className="text-slate-400 line-through text-base font-light">{cur}{ann.original}</div>}
                      <div className="text-3xl font-black text-slate-900">{cur}{hasDisc ? ann.final : ann.original}</div>
                      <div className="text-[11px] text-slate-500">{durTxt}</div>
                      {hasDisc && ann.discount_value > 0 && <div className="text-[10px] font-bold text-rose-600">وفّرت {cur}{ann.discount_value} (خصم {cfg.discount_percent}%)</div>}
                      <div className="text-[11px] font-bold text-emerald-700 mt-1">♾️ قيود محاسبية مفتوحة فوراً</div>
                    </>
                  ) : (
                    <>
                      {hasDisc && <div className="text-slate-400 line-through text-base font-light">{cur}{inst.original_per}</div>}
                      <div className="text-3xl font-black text-slate-900">{cur}{hasDisc ? inst.final_per : inst.original_per}</div>
                      <div className="text-[11px] text-slate-500">× {inst.count} أقساط (الإجمالي {cur}{hasDisc ? inst.total_final : ann.original})</div>
                      {hasDisc && ann.discount_value > 0 && <div className="text-[10px] font-bold text-rose-600">وفّرت {cur}{ann.discount_value} إجمالاً (خصم {cfg.discount_percent}%)</div>}
                      <div className="text-[11px] font-bold text-blue-700 mt-1">🔒 قيود محدودة حتى سداد آخر قسط</div>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                <ul className="space-y-1.5">
                  {(p.features || []).map((ft, i) => (
                    <li key={i} className="text-[11.5px] text-slate-700 flex items-start gap-1.5"><span className="text-emerald-500 mt-0.5">✓</span>{ft}</li>
                  ))}
                </ul>
                <Button onClick={() => contactWA(p)} className={`w-full ${st.badge} hover:opacity-90 text-white font-bold`}>📲 اشترك الآن — تواصل مع الإدارة</Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function OutOfQuotaModal({ open, onOpenChange, tenant }) {
  const [plans, setPlans] = useState([])
  const [refCode, setRefCode] = useState('')
  useEffect(() => {
    if (!open) return
    api('/plans').then(setPlans).catch(() => {})
    api('/referrals').then(r => setRefCode(r.code)).catch(() => {})
  }, [open])
  // v3.9.18 — Official domain only for invite links (WhatsApp + copy)
  const inviteLink = `${publicSiteOrigin()}/signup?ref=${refCode}` // v3.88.4 — DEP-002
  const shareWA = () => {
    const msg = `🎁 انضم إلى منصة رحّال (Rahaal ERP)!\nاحصل على 30 قيد تجريبي مجاناً + أكسب +50 قيد إضافي عبر رابط الإحالة:\n${inviteLink}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }
  const copy = (t) => { navigator.clipboard.writeText(t); toast.success('📋 تم النسخ') }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl text-rose-700">⚠️ انتهت حصّة القيود</DialogTitle>
          <DialogDescription>لقد استنفدت جميع القيود المتاحة في باقتك. اختر باقة اشتراك أو ادعُ مكتباً واحصل على قيود إضافية:</DialogDescription>
        </DialogHeader>
        {/* v3.14 — 6-tier pricing */}
        <PricingPlans tenant={tenant} />
        {/* Referral quick card */}
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-3 flex flex-col md:flex-row items-center gap-3">
            <div className="flex-1">
              <div className="font-bold text-emerald-800 text-sm">🎁 أو ادعُ مكتباً واحصل على +50 قيد فوراً</div>
              <div className="p-2 bg-white rounded border text-xs mt-1" dir="ltr">{inviteLink}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(inviteLink)}>📋 نسخ</Button>
              <Button size="sm" onClick={shareWA} className="bg-emerald-500 hover:bg-emerald-600 text-white">📲 واتساب</Button>
            </div>
          </CardContent>
        </Card>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================
// CURRENCY EXCHANGE SCREEN (Buy / Sell)
// ================================================================
function FxScreen() {
  const { settings, tenant } = useAuth()
  const [txs, setTxs] = useState([])
  const [boxes, setBoxes] = useState([])
  const [openBuy, setOpenBuy] = useState(false)
  const [openSell, setOpenSell] = useState(false)
  const [openSearch, setOpenSearch] = useState(false)
  const [filter, setFilter] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(null)
  const load = async () => {
    try {
      const [t, b] = await Promise.all([api('/fx'), api('/boxes')])
      setTxs(t); setBoxes(b)
    } catch (e) { toast.error(e.message) }
  }
  useEffect(() => { load() }, [])
  const filtered = applyFilter(txs, filter)
  const selected = filtered.find(t => t.id === selectedId)
  const totalGain = filtered.reduce((s, t) => s + (t.fx_gain_usd || t.fx_gain_base || 0), 0)
  const handleEdit = () => {
    if (!selected) return toast.error('اختر عملية أولاً')
    setEditing(selected)
    if (selected.type === 'buy') setOpenBuy(true); else setOpenSell(true)
  }
  const handleDelete = async () => {
    if (!selectedId) return
    if (!(await askConfirm({ title: 'حذف العملية', desc: 'سيتم حذف هذه العملية وعكس القيد المحاسبي المرتبط بها.', variant: 'danger', confirmLabel: 'تأكيد الحذف' }))) return
    try { await api(`/fx/${selectedId}`, { method: 'DELETE' }); toast.success('تم الحذف'); setSelectedId(null); load() }
    catch (e) { toast.error(e.message) }
  }
  const handlePrintVoucher = () => {
    if (!selected) return toast.error('اختر عملية أولاً')
    printVoucher({ kind: 'fx', record: selected, settings, tenant })
  }
  const handlePrintTable = () => {
    const totals = { amount: 0, counter_amount: 0, fx_gain: 0 }
    for (const r of filtered) { totals.amount += r.amount; totals.counter_amount += r.counter_amount; totals.fx_gain += (r.fx_gain_usd || r.fx_gain_base || 0) }
    printTable({
      title: 'كشف عمليات الصرافة', settings, tenant, rows: filtered,
      columns: [
        { key: 'date', label: 'التاريخ', render: r => fmtDate(r.date) },
        { key: 'type', label: 'النوع', render: r => r.type === 'buy' ? 'شراء' : 'بيع' },
        { key: 'currency', label: 'العملة' },
        { key: 'amount', label: 'المبلغ', align: 'left', render: r => fmt(r.amount, r.currency) },
        { key: 'exchange_rate', label: 'السعر', render: r => String(r.exchange_rate) },
        { key: 'counter_currency', label: 'مقابل' },
        { key: 'counter_amount', label: 'القيمة', align: 'left', render: r => fmt(r.counter_amount, r.counter_currency) },
        { key: 'customer_name', label: 'الزبون' },
        { key: 'fx_gain_usd', label: 'فرق الصرف', align: 'left', render: r => fmt(r.fx_gain_usd || r.fx_gain_base || 0, 'YER') },
      ],
      totals: { amount: totals.amount.toFixed(2), counter_amount: totals.counter_amount.toFixed(2), fx_gain_usd: totals.fx_gain.toFixed(2) },
    })
  }
  return (
    <div className="space-y-4">
      <TopBar
        title="صرافة العملات"
        subtitle="شراء وبيع العملات مع حساب فروق الصرف تلقائياً في قائمة الدخل"
        right={
          <div className="flex gap-2">
            <Button onClick={() => { setEditing(null); setOpenBuy(true) }} className="gap-2 grad-green text-white shadow-lg"><ArrowDownLeft className="w-4 h-4" /> شراء عملة</Button>
            <Button onClick={() => { setEditing(null); setOpenSell(true) }} className="gap-2 grad-rose text-white shadow-lg"><ArrowUpRight className="w-4 h-4" /> بيع عملة</Button>
          </div>
        }
      />

      <ActionToolbar
        onRefresh={load} onSearch={() => setOpenSearch(true)}
        onEdit={handleEdit} onDelete={handleDelete} onPrintVoucher={handlePrintVoucher} onPrintTable={handlePrintTable}
        selectedId={selectedId} count={filtered.length}
      />

      {filter && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs">
          <Filter className="w-4 h-4 text-blue-600" /> فلتر: <b>{filter.field}</b> "<b>{filter.term}</b>"
          <Button size="sm" variant="ghost" onClick={() => setFilter(null)} className="mr-auto text-rose-600">مسح</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={ArrowLeftRight} label="إجمالي عمليات الصرافة" value={filtered.length} grad="grad-purple" />
        <StatCard icon={TrendingUp} label={totalGain >= 0 ? 'إجمالي أرباح فروق العملات' : 'إجمالي خسائر فروق العملات'} value={fmt(totalGain, 'YER')} grad={totalGain >= 0 ? 'grad-green' : 'grad-rose'} />
        <StatCard icon={Sparkles} label="آخر عملية" value={filtered[0] ? fmtDate(filtered[0].date) : '—'} grad="grad-brand" />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-fuchsia-600" /> سجل عمليات الصرافة</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>التاريخ</TableHead><TableHead>النوع</TableHead>
                <TableHead>المبلغ</TableHead><TableHead>السعر</TableHead>
                <TableHead>القيمة</TableHead><TableHead>العميل</TableHead>
                <TableHead>الغرض</TableHead>
                <TableHead className="text-left">فرق الصرف</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-slate-400 py-8">لا توجد عمليات صرافة</TableCell></TableRow>}
                {filtered.map(t => {
                  const gain = t.fx_gain_usd || t.fx_gain_base || 0
                  return (
                    <TableRow key={t.id} className={selectedId === t.id ? 'bg-blue-50' : 'cursor-pointer hover:bg-slate-50'} onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}>
                      <TableCell><input type="radio" checked={selectedId === t.id} onChange={() => setSelectedId(t.id)} /></TableCell>
                      <TableCell className="text-xs">{fmtDate(t.date)}</TableCell>
                      <TableCell><Badge className={t.type === 'buy' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-rose-100 text-rose-700 hover:bg-rose-100'}>{t.type === 'buy' ? 'شراء' : 'بيع'}</Badge></TableCell>
                      <TableCell className="font-bold">{fmt(t.amount, t.currency)}</TableCell>
                      <TableCell className="font-mono text-xs">{t.exchange_rate}</TableCell>
                      <TableCell className="font-bold">{fmt(t.counter_amount, t.counter_currency)}</TableCell>
                      <TableCell>{t.customer_name || '—'}</TableCell>
                      <TableCell className="text-xs">{t.purpose || '—'}</TableCell>
                      <TableCell className={`text-left font-bold ${gain >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(gain, 'YER')}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <FxDialog open={openBuy} onOpenChange={(v) => { setOpenBuy(v); if (!v) setEditing(null) }} type="buy" boxes={boxes} record={editing?.type === 'buy' ? editing : null} onSaved={() => { load(); setEditing(null); toast.success(editing ? '✅ تم تعديل العملية وعكس القيد تلقائياً' : 'تم تسجيل عملية الشراء + قيد محاسبي') }} />
      <FxDialog open={openSell} onOpenChange={(v) => { setOpenSell(v); if (!v) setEditing(null) }} type="sell" boxes={boxes} record={editing?.type === 'sell' ? editing : null} onSaved={() => { load(); setEditing(null); toast.success(editing ? '✅ تم تعديل العملية وعكس القيد تلقائياً' : 'تم تسجيل عملية البيع + قيد محاسبي') }} />
      <UniversalSearchModal open={openSearch} onOpenChange={setOpenSearch}
        fields={[
          { key: 'customer_name', label: 'اسم الزبون' }, { key: 'currency', label: 'العملة' },
          { key: 'counter_currency', label: 'العملة المقابلة' }, { key: 'purpose', label: 'الغرض' },
          { key: 'id_number', label: 'رقم الهوية' }, { key: 'amount', label: 'المبلغ' },
        ]}
        onApply={setFilter} onClear={() => setFilter(null)}
      />
    </div>
  )
}

function FxDialog({ open, onOpenChange, type, boxes, onSaved, record }) {
  const isEdit = !!record
  const cfg = type === 'buy'
    ? { title: 'شراء عملات', color: 'grad-green', desc: 'يشتري المكتب عملة من الزبون ويدفع مقابلها بعملة أخرى' }
    : { title: 'بيع عملات', color: 'grad-rose', desc: 'يبيع المكتب عملة للزبون ويستلم مقابلها بعملة أخرى' }
  const emptyForm = {
    date: todayISO(), currency: 'USD', amount: '', exchange_rate: '',
    counter_currency: 'SAR', payment_method: 'cash',
    box_currency_id: '', box_counter_id: '',
    account_currency_id: '', account_counter_id: '',  // For 'account' mode; encoded as `${kind}:${id}`
    customer_name: '', customer_phone: '', id_type: 'هوية وطنية', id_number: '',
    source_of_funds: '', purpose: '', remarks: '',
  }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [allAccounts, setAllAccounts] = useState([])
  useEffect(() => {
    if (!open) return
    if (record) {
      setForm({
        date: record.date ? new Date(record.date).toISOString().slice(0,10) : todayISO(),
        currency: record.currency || 'USD', amount: record.amount ?? '',
        exchange_rate: record.exchange_rate ?? '',
        counter_currency: record.counter_currency || 'SAR',
        payment_method: record.payment_method || 'cash',
        box_currency_id: record.box_currency_id || '',
        box_counter_id: record.box_counter_id || '',
        account_currency_id: record.currency_ref ? `${record.currency_ref.kind}:${record.currency_ref.id}` : '',
        account_counter_id: record.counter_ref ? `${record.counter_ref.kind}:${record.counter_ref.id}` : '',
        customer_name: record.customer_name || '', customer_phone: record.customer_phone || '',
        id_type: record.id_type || 'هوية وطنية', id_number: record.id_number || '',
        source_of_funds: record.source_of_funds || '', purpose: record.purpose || '',
        remarks: record.remarks || '',
      })
    } else {
      setForm(emptyForm)
    }
  }, [open, record])
  useEffect(() => {
    if (boxes.length && !form.box_currency_id) {
      setForm(f => ({ ...f, box_currency_id: boxes[0].id, box_counter_id: boxes[1]?.id || boxes[0].id }))
    }
  }, [boxes])
  // Load full chart of accounts when switching to 'account' mode
  useEffect(() => {
    if (open && form.payment_method === 'account' && allAccounts.length === 0) {
      api('/accounts/all').then(setAllAccounts).catch(() => {})
    }
  }, [open, form.payment_method])
  const counter_amount = (Number(form.amount) || 0) * (Number(form.exchange_rate) || 0)
  const parseRef = (v) => { if (!v) return null; const [kind, id] = v.split(':'); return { kind, id } }
  const submit = async () => {
    if (!form.amount || !form.exchange_rate) return toast.error('أدخل المبلغ وسعر الصرف')
    if (form.currency === form.counter_currency) return toast.error('اختر عملتين مختلفتين')
    const body = { type, ...form }
    if (form.payment_method === 'account') {
      if (!form.account_currency_id || !form.account_counter_id) return toast.error('اختر الحسابين للطرفين')
      body.currency_ref = parseRef(form.account_currency_id)
      body.counter_ref = parseRef(form.account_counter_id)
    } else {
      if (!form.box_currency_id || !form.box_counter_id) return toast.error('اختر الصناديق')
    }
    try {
      setSaving(true)
      if (isEdit) await api(`/fx/${record.id}`, { method: 'PUT', body })
      else await api('/fx', { method: 'POST', body })
      onOpenChange(false); onSaved(); setForm(f => ({ ...f, amount: '', exchange_rate: '', customer_name: '', customer_phone: '', id_number: '', source_of_funds: '', purpose: '', remarks: '' }))
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const isCash = form.payment_method === 'cash'
  // For "cash" mode: only cash boxes and banks (kind='box') from allAccounts, or fallback to boxes prop
  const cashOptions = boxes  // already only boxes
  const accountOptions = allAccounts  // full COA
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className={`w-9 h-9 rounded-lg ${cfg.color} flex items-center justify-center`}><ArrowLeftRight className="w-4 h-4 text-white" /></div>
            {isEdit ? `✏️ تعديل ${cfg.title}` : cfg.title}
          </DialogTitle>
          <DialogDescription>{isEdit ? 'سيتم عكس القيد المحاسبي القديم وإعادة الترحيل بالقيم الجديدة تلقائياً' : cfg.desc}</DialogDescription>
        </DialogHeader>

        {/* Payment method selector */}
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
          <div className="text-xs font-bold text-slate-600 mb-2">طريقة الدفع / التسوية</div>
          <div className="flex gap-2">
            <button onClick={() => setForm({ ...form, payment_method: 'cash' })} className={`px-4 py-2 rounded-lg text-sm font-bold border transition ${isCash ? 'bg-emerald-500 text-white border-emerald-600 shadow' : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'}`}>💵 نقد (صناديق / بنوك)</button>
            <button onClick={() => setForm({ ...form, payment_method: 'account' })} className={`px-4 py-2 rounded-lg text-sm font-bold border transition ${!isCash ? 'bg-blue-500 text-white border-blue-600 shadow' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}>📒 حساب (الدليل المحاسبي كامل)</button>
          </div>
          {!isCash && (
            <div className="text-[11px] text-blue-700 mt-2">✨ يتم تسوية العملية على حسابات من الدليل المحاسبي (عملاء، موردين، مصروفات، إيرادات، أصول، خصوم...) دون تحريك نقدي</div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-2">
          <Field label="التاريخ"><DocDateInput value={form.date} onChange={v => setForm({ ...form, date: v })} /></Field>
          <Field label="العملة" required><Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="المبلغ" required><Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="text-lg font-bold" /></Field>
          <Field label="سعر الصرف" required><Input type="number" min="0" step="0.0001" value={form.exchange_rate} onChange={e => setForm({ ...form, exchange_rate: e.target.value })} className="text-lg font-bold" /></Field>

          <Field label="المقابل بعملة" required><Select value={form.counter_currency} onValueChange={v => setForm({ ...form, counter_currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="القيمة الإجمالية">
            <div className={`px-3 py-2 rounded-md border text-lg font-extrabold bg-blue-50 border-blue-200 text-blue-700`}>
              {fmt(counter_amount, form.counter_currency)}
            </div>
          </Field>
          {isCash ? (
            <>
              <Field label={`صندوق ${form.currency} 🔍`} required>
                <AccountAutocomplete type="box" value={form.box_currency_id || null} onChange={(sel) => setForm({ ...form, box_currency_id: sel?.id || '' })} placeholder={`اختر صندوق ${form.currency}...`} />
              </Field>
              <Field label={`صندوق ${form.counter_currency} 🔍`} required>
                <AccountAutocomplete type="box" value={form.box_counter_id || null} onChange={(sel) => setForm({ ...form, box_counter_id: sel?.id || '' })} placeholder={`اختر صندوق ${form.counter_currency}...`} />
              </Field>
            </>
          ) : (
            <>
              <Field label={`حساب ${form.currency} 🔍`} required>
                <AccountAutocomplete
                  type="all"
                  value={form.account_currency_id ? form.account_currency_id.split(':')[1] : null}
                  onChange={(sel) => setForm({ ...form, account_currency_id: sel ? `${sel.type === 'account' ? 'account' : sel.type}:${sel.type === 'account' ? sel.account_code : sel.id}` : '' })}
                  placeholder={`اختر حساب ${form.currency}...`}
                />
              </Field>
              <Field label={`حساب ${form.counter_currency} 🔍`} required>
                <AccountAutocomplete
                  type="all"
                  value={form.account_counter_id ? form.account_counter_id.split(':')[1] : null}
                  onChange={(sel) => setForm({ ...form, account_counter_id: sel ? `${sel.type === 'account' ? 'account' : sel.type}:${sel.type === 'account' ? sel.account_code : sel.id}` : '' })}
                  placeholder={`اختر حساب ${form.counter_currency}...`}
                />
              </Field>
            </>
          )}
        </div>

        <Separator className="my-2" />
        <div className="text-sm font-bold text-slate-700">بيانات الزبون</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="اسم الزبون"><Input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} /></Field>
          <Field label="هاتف الزبون"><Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} /></Field>
          <Field label="نوع الهوية"><Select value={form.id_type} onValueChange={v => setForm({ ...form, id_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="هوية وطنية">هوية وطنية</SelectItem><SelectItem value="جواز سفر">جواز سفر</SelectItem><SelectItem value="إقامة">إقامة</SelectItem><SelectItem value="أخرى">أخرى</SelectItem></SelectContent></Select></Field>
          <Field label="رقم الهوية"><Input value={form.id_number} onChange={e => setForm({ ...form, id_number: e.target.value })} /></Field>
          <Field label="مصدر الأموال"><Input value={form.source_of_funds} onChange={e => setForm({ ...form, source_of_funds: e.target.value })} placeholder="راتب / تجارة / تحويلات" /></Field>
          <Field label="الغرض من المعاملة"><Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="سياحة / علاج / تحويل" /></Field>
          <div className="md:col-span-3"><Field label="ملاحظات"><Textarea rows={2} value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></Field></div>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> سيتم حساب فرق الصرف (ربح/خسارة) تلقائياً بمقارنة سعر الصرف المُدخل مع أسعار الصرف المرجعية للمكتب، وترحيله للحساب 4104
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className={`${cfg.color} text-white`}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? '💾 حفظ التعديل + عكس القيد' : 'حفظ + إنشاء قيد')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================
// MANUAL JOURNAL VOUCHER DIALOG (Single & Dual)
// ================================================================
function ManualJournalDialog({ open, onOpenChange, onSaved, record }) {
  const isEdit = !!record
  const initialMode = record?.ref_type === 'manual_dual' ? 'dual' : 'single'
  const [mode, setMode] = useState(initialMode)
  const [singleForm, setSingleForm] = useState({
    date: todayISO(), currency: 'USD', description: '',
    lines: [
      { account_code: '', account_name: '', debit: '', credit: '' },
      { account_code: '', account_name: '', debit: '', credit: '' },
    ],
  })
  const [dualForm, setDualForm] = useState({
    date: todayISO(), description: '',
    debit_account_code: '', debit_account_name: '', debit_currency: 'USD', debit_amount: '',
    credit_account_code: '', credit_account_name: '', credit_currency: 'SAR', credit_amount: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (record) {
      const dateStr = record.date ? new Date(record.date).toISOString().slice(0,10) : todayISO()
      if (record.ref_type === 'manual_dual') {
        setMode('dual')
        const debitLine = (record.lines || []).find(l => (l.debit || 0) > 0) || {}
        const creditLine = (record.lines || []).find(l => (l.credit || 0) > 0 && l.account_code !== '4104') || {}
        setDualForm({
          date: dateStr, description: record.description || '',
          debit_account_code: debitLine.account_code || '', debit_account_name: debitLine.account_name || '',
          debit_currency: debitLine.currency || 'USD', debit_amount: debitLine.debit || '',
          credit_account_code: creditLine.account_code || '', credit_account_name: creditLine.account_name || '',
          credit_currency: creditLine.currency || 'SAR', credit_amount: creditLine.credit || '',
        })
      } else {
        setMode('single')
        setSingleForm({
          date: dateStr, currency: record.currency || 'USD', description: record.description || '',
          lines: (record.lines || []).map(l => ({
            account_code: l.account_code || '', account_name: l.account_name || '',
            party_type: l.party_type, party_id: l.party_id, party_name: l.party_name,
            debit: l.debit || '', credit: l.credit || '',
          })),
        })
      }
    }
  }, [open, record])

  const totalD = singleForm.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalC = singleForm.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const balanced = Math.abs(totalD - totalC) < 0.01 && totalD > 0

  const addLine = () => setSingleForm(f => ({ ...f, lines: [...f.lines, { account_code: '', account_name: '', debit: '', credit: '' }] }))
  const removeLine = (i) => setSingleForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))
  const updateLine = (i, k, v) => setSingleForm(f => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, [k]: v } : l) }))

  const submit = async () => {
    try {
      setSaving(true)
      if (mode === 'single') {
        if (!balanced) return toast.error('القيد غير متوازن — يجب أن يتساوى مجموع المدين والدائن')
        // v3.10.0 — strict validation: every line with amount MUST have a selected account
        const badLine = singleForm.lines.findIndex(l => (Number(l.debit) > 0 || Number(l.credit) > 0) && !l.account_code)
        if (badLine >= 0) return toast.error(`عذراً، يجب اختيار حساب معتمد من دليل الحسابات (السطر ${badLine + 1})`)
        const negLine = singleForm.lines.findIndex(l => Number(l.debit) < 0 || Number(l.credit) < 0)
        if (negLine >= 0) return toast.error(`لا يُسمح بقيم سالبة (السطر ${negLine + 1})`)
        if (isEdit) await api(`/journal-entries/${record.id}`, { method: 'PUT', body: singleForm })
        else await api('/journal-entries', { method: 'POST', body: singleForm })
      } else {
        if (!dualForm.debit_amount || !dualForm.credit_amount) return toast.error('أدخل المبالغ')
        // v3.10.0 — strict: both sides must have selected account
        if (!dualForm.debit_account_code) return toast.error('عذراً، يجب اختيار حساب معتمد للطرف المدين')
        if (!dualForm.credit_account_code) return toast.error('عذراً، يجب اختيار حساب معتمد للطرف الدائن')
        if (Number(dualForm.debit_amount) < 0 || Number(dualForm.credit_amount) < 0) return toast.error('لا يُسمح بقيم سالبة في المبالغ')
        if (isEdit) await api(`/journal-entries/${record.id}`, { method: 'PUT', body: { dual: true, ...dualForm } })
        else await api('/journal-entries', { method: 'POST', body: { dual: true, ...dualForm } })
      }
      toast.success(isEdit ? '✅ تم تعديل القيد اليدوي وعكس الأثر السابق تلقائياً' : 'تم حفظ القيد اليدوي')
      onOpenChange(false); onSaved()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-5xl lg:max-w-6xl max-h-[95vh] overflow-y-auto overflow-x-visible" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className="w-9 h-9 rounded-lg grad-slate flex items-center justify-center"><ReceiptText className="w-4 h-4 text-white" /></div>
            {isEdit ? '✏️ تعديل قيد يومي (يدوي)' : 'سند قيد يومي (يدوي)'}
          </DialogTitle>
          <DialogDescription>{isEdit ? 'سيتم عكس الأثر المحاسبي للقيد السابق تلقائياً' : 'لتسجيل التسويات المحاسبية أو القيود بين حسابات بعملات مختلفة'}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-2">
          <button onClick={() => setMode('single')} disabled={isEdit} className={`px-4 py-2 rounded-lg text-sm font-bold border ${mode === 'single' ? 'bg-blue-500 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}>قيد عادي (عملة واحدة)</button>
          <button onClick={() => setMode('dual')} disabled={isEdit} className={`px-4 py-2 rounded-lg text-sm font-bold border ${mode === 'dual' ? 'bg-fuchsia-500 text-white border-fuchsia-600' : 'bg-white text-slate-600 border-slate-300'} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}>قيد ثنائي (عملتين مختلفتين)</button>
        </div>

        {mode === 'single' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="التاريخ"><DocDateInput value={singleForm.date} onChange={v => setSingleForm({ ...singleForm, date: v })} /></Field>
              <Field label="العملة"><Select value={singleForm.currency} onValueChange={v => setSingleForm({ ...singleForm, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="البيان"><Input value={singleForm.description} onChange={e => setSingleForm({ ...singleForm, description: e.target.value })} placeholder="سبب القيد" /></Field>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>الحساب (بحث ذكي 🔍)</TableHead><TableHead>الوصف / الطرف</TableHead><TableHead className="text-left">مدين</TableHead><TableHead className="text-left">دائن</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {singleForm.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="min-w-[260px]">
                      <AccountAutocomplete
                        type="all"
                        value={l.party_id || null}
                        onChange={(sel) => {
                          if (!sel) { updateLine(i, 'account_code', ''); updateLine(i, 'account_name', ''); updateLine(i, 'party_type', undefined); updateLine(i, 'party_id', undefined); updateLine(i, 'party_name', undefined); return }
                          setSingleForm(f => ({ ...f, lines: f.lines.map((ll, idx) => idx === i ? { ...ll, account_code: sel.account_code, account_name: sel.name, party_type: sel.type === 'account' ? 'manual' : sel.type, party_id: sel.type === 'account' ? null : sel.id, party_name: sel.name } : ll) }))
                        }}
                        placeholder="اختر حساب/عميل/مورد/صندوق..."
                      />
                      {l.account_code && !l.party_id && <div className="mt-1 text-[10px] font-mono text-purple-600">📒 {l.account_code}</div>}
                    </TableCell>
                    <TableCell><Input value={l.account_name || ''} onChange={e => updateLine(i, 'account_name', e.target.value)} placeholder="بيان السطر (اختياري)" className="text-xs" /></TableCell>
                    <TableCell><Input type="number" step="0.01" min="0" value={l.debit} onChange={e => updateLine(i, 'debit', e.target.value)} className="text-left w-32" /></TableCell>
                    <TableCell><Input type="number" step="0.01" min="0" value={l.credit} onChange={e => updateLine(i, 'credit', e.target.value)} className="text-left w-32" /></TableCell>
                    <TableCell>{singleForm.lines.length > 2 && <Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-3 h-3 text-rose-500" /></Button>}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-slate-50"><TableCell colSpan={2} className="text-left">الإجمالي</TableCell><TableCell className="text-left text-blue-700">{fmt(totalD, singleForm.currency)}</TableCell><TableCell className="text-left text-rose-700">{fmt(totalC, singleForm.currency)}</TableCell><TableCell>{balanced ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <XCircle className="w-5 h-5 text-amber-500" />}</TableCell></TableRow>
              </TableBody>
            </Table>
            <Button variant="outline" onClick={addLine} className="gap-2"><Plus className="w-4 h-4" /> إضافة سطر</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="التاريخ"><DocDateInput value={dualForm.date} onChange={v => setDualForm({ ...dualForm, date: v })} /></Field>
              <Field label="البيان"><Input value={dualForm.description} onChange={e => setDualForm({ ...dualForm, description: e.target.value })} placeholder="مصارفة / تسوية" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="border-2 border-blue-200 rounded-lg p-4 bg-blue-50/40">
                <div className="text-sm font-bold text-blue-700 mb-3">الطرف المدين (Debit)</div>
                <div className="space-y-3">
                  <Field label="الحساب (بحث ذكي 🔍)">
                    <AccountAutocomplete
                      type="all"
                      value={null}
                      onChange={(sel) => {
                        if (!sel) return setDualForm({ ...dualForm, debit_account_code: '', debit_account_name: '', debit_party_type: undefined, debit_party_id: undefined, debit_party_name: undefined })
                        setDualForm({ ...dualForm, debit_account_code: sel.account_code, debit_account_name: sel.name, debit_party_type: sel.type === 'account' ? 'manual' : sel.type, debit_party_id: sel.type === 'account' ? null : sel.id, debit_party_name: sel.name })
                      }}
                      placeholder="اختر الحساب المدين..."
                    />
                  </Field>
                  {dualForm.debit_account_code && (
                    <div className="text-[11px] font-mono px-2 py-1 rounded bg-white border border-blue-200">
                      📒 {dualForm.debit_account_code} — {dualForm.debit_account_name}
                    </div>
                  )}
                  <Field label="العملة"><Select value={dualForm.debit_currency} onValueChange={v => setDualForm({ ...dualForm, debit_currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="المبلغ" required><Input type="number" step="0.01" min="0" value={dualForm.debit_amount} onChange={e => setDualForm({ ...dualForm, debit_amount: e.target.value })} className="text-lg font-bold text-blue-700" /></Field>
                </div>
              </div>
              <div className="border-2 border-rose-200 rounded-lg p-4 bg-rose-50/40">
                <div className="text-sm font-bold text-rose-700 mb-3">الطرف الدائن (Credit)</div>
                <div className="space-y-3">
                  <Field label="الحساب (بحث ذكي 🔍)">
                    <AccountAutocomplete
                      type="all"
                      value={null}
                      onChange={(sel) => {
                        if (!sel) return setDualForm({ ...dualForm, credit_account_code: '', credit_account_name: '', credit_party_type: undefined, credit_party_id: undefined, credit_party_name: undefined })
                        setDualForm({ ...dualForm, credit_account_code: sel.account_code, credit_account_name: sel.name, credit_party_type: sel.type === 'account' ? 'manual' : sel.type, credit_party_id: sel.type === 'account' ? null : sel.id, credit_party_name: sel.name })
                      }}
                      placeholder="اختر الحساب الدائن..."
                    />
                  </Field>
                  {dualForm.credit_account_code && (
                    <div className="text-[11px] font-mono px-2 py-1 rounded bg-white border border-rose-200">
                      📒 {dualForm.credit_account_code} — {dualForm.credit_account_name}
                    </div>
                  )}
                  <Field label="العملة"><Select value={dualForm.credit_currency} onValueChange={v => setDualForm({ ...dualForm, credit_currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="المبلغ" required><Input type="number" step="0.01" min="0" value={dualForm.credit_amount} onChange={e => setDualForm({ ...dualForm, credit_amount: e.target.value })} className="text-lg font-bold text-rose-700" /></Field>
                </div>
              </div>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> سيتم موازنة القيد تلقائياً بإضافة سطر فرق العملة (حساب 4104) بالفرق بين مقابلَي المبلغين بمعادل الدولار
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={saving} className="grad-slate text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? '💾 حفظ التعديل + عكس القيد' : 'حفظ القيد')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================
// v3.9 — TARGET MEDIA / RAHAAL PUBLIC LANDING PAGE
// ================================================================
function LandingPage({ onLoginClick, onSignupClick }) {
  const [openMobile, setOpenMobile] = useState(false)
  const features = [
    { icon: '💱', title: 'محاسبة متعدّدة العملات', desc: 'قيد مزدوج آلي بـ USD / SAR / YER مع أسعار صرف يومية وتقارير موحّدة.', color: 'from-blue-500 to-cyan-500' },
    { icon: '✈️', title: 'إدارة التذاكر والحجوزات', desc: 'إصدار تذاكر جوي وبري، طباعة احترافية، ومطابقة مع الموردين لحظياً.', color: 'from-orange-500 to-red-500' },
    { icon: '🛂', title: 'تأشيرات وموافقات', desc: 'إدارة تأشيرات العمرة والزيارة والعمل والموافقات الأمنية مع تنبيهات الصلاحية.', color: 'from-emerald-500 to-teal-500' },
    { icon: '🕋', title: 'الباكجات والبرامج السياحية', desc: 'إنشاء باكجات كاملة مع تكاليف المكونات وتقارير ربحية لحظية عند إغلاق الباكج.', color: 'from-fuchsia-500 to-pink-500' },
    { icon: '📊', title: 'تقارير مالية ذكية', desc: 'ميزانية عمومية، أرباح وخسائر، كشف حساب تفاعلي، ومقارنة ربحية الباكجات.', color: 'from-indigo-500 to-blue-500' },
    { icon: '📱', title: 'تكامل واتساب ذكي', desc: 'إرسال كشوف الحسابات والتذاكر عبر واتساب بقالب ديناميكي حسب نوع الرحلة.', color: 'from-green-500 to-emerald-500' },
    { icon: '💸', title: 'الإحالة والإحصائيات', desc: 'نظام إحالة يمنحك 50 قيد مجاني مكافأة عن كل مكتب مشترك يدفع فعلياً.', color: 'from-amber-500 to-orange-500' },
    { icon: '👥', title: 'صلاحيات ومستخدمون', desc: 'دور المالك والموظفين مع صلاحيات دقيقة على كل شاشة وعملية.', color: 'from-slate-500 to-slate-700' },
  ]
  const pricing = [
    {
      tier: 'Silver', old_price: '500$', price: '250$', period: 'سنوياً', tag: 'للبدء', color: 'from-slate-400 to-slate-600',
      bullets: ['فرع واحد + مستخدم واحد', 'جميع الوحدات الأساسية', 'محاسبة + تذاكر + تأشيرات + باكجات', 'بدون إضافة المتصفح', 'دعم عبر واتساب'],
    },
    {
      tier: 'Gold', old_price: '1,000$', price: '500$', period: 'سنوياً', tag: 'الأكثر مبيعاً 🔥', color: 'from-amber-500 to-orange-600', highlight: true,
      bullets: ['فرع واحد + 8 مستخدمين', 'قيود غير محدودة', 'كل مزايا الفضية', 'إضافة المتصفح باشتراك مستقل', 'دعم فوري متقدم'],
    },
    {
      tier: 'Enterprise', old_price: '2,000$', price: '1,000$', period: 'سنوياً', tag: '💎 الأفضل قيمة', color: 'from-purple-500 to-fuchsia-600',
      bullets: ['فروع لا محدودة + مستخدمين بلا حدود', 'قيود غير محدودة', '🕋 إضافة المتصفح مجاناً وبلا حدود', 'أولوية الميزات الجديدة', 'دعم VIP على مدار 24/7'],
    },
  ]
  // v3.9.1 — WhatsApp CTA (single source of truth)
  const WA_LINK = 'https://wa.me/967781115482?text=' + encodeURIComponent('أهلاً بكم، أرغب في الاستفسار عن اشتراك منظومة رحّال')
  const heroImg = 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80'
  const extImg = 'https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?w=1200&q=80'
  const dashImg = 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80'

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans" dir="rtl">
      {/* ===== NAVBAR ===== */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grad-brand flex items-center justify-center text-white text-xl font-black shadow">ر</div>
            <div>
              <div className="font-extrabold text-slate-900">Rahaal <span className="text-blue-700">رحّال</span></div>
              <div className="text-[10px] text-slate-500 -mt-0.5">by Target Media</div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-700">
            <a href="#features" className="hover:text-blue-700">المزايا</a>
            <a href="#extension" className="hover:text-blue-700">إضافة المتصفح</a>
            <a href="#pricing" className="hover:text-blue-700">الأسعار</a>
            <a href="#contact" className="hover:text-blue-700">تواصل</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={onLoginClick} className="hidden sm:inline-flex px-4 py-2 rounded-lg font-semibold text-blue-700 hover:bg-blue-50 text-sm">تسجيل الدخول</button>
            <button onClick={onSignupClick} className="grad-brand text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md hover:shadow-lg transition">اشترك الآن</button>
            <button className="md:hidden p-2 rounded hover:bg-slate-100" onClick={() => setOpenMobile(!openMobile)}>☰</button>
          </div>
        </div>
        {openMobile && (
          <div className="md:hidden bg-white border-t border-slate-200 px-4 py-3 space-y-2 text-sm">
            <a href="#features" onClick={() => setOpenMobile(false)} className="block py-2 border-b">المزايا</a>
            <a href="#extension" onClick={() => setOpenMobile(false)} className="block py-2 border-b">إضافة المتصفح</a>
            <a href="#pricing" onClick={() => setOpenMobile(false)} className="block py-2 border-b">الأسعار</a>
            <a href="#contact" onClick={() => setOpenMobile(false)} className="block py-2">تواصل</a>
            <button onClick={onLoginClick} className="block w-full text-right py-2 text-blue-700 font-semibold">تسجيل الدخول</button>
          </div>
        )}
      </header>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-orange-50 pt-16 pb-24">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(30,64,175,0.15) 0, transparent 50%), radial-gradient(circle at 80% 70%, rgba(249,115,22,0.15) 0, transparent 50%)' }} />
        <div className="relative max-w-7xl mx-auto px-4 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-white border border-blue-200 text-blue-700 px-3 py-1 rounded-full text-xs font-bold mb-4 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> v3.8 مُتاح الآن مع إضافة المتصفح
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black leading-tight text-slate-900">
              نظام <span className="bg-gradient-to-l from-blue-700 to-orange-500 bg-clip-text text-transparent">رحّال</span> ERP<br />
              <span className="text-slate-700 text-3xl md:text-4xl lg:text-5xl">للمكاتب السياحية الحديثة</span>
            </h1>
            <p className="mt-5 text-lg text-slate-600 leading-8 max-w-xl">
              منظومة محاسبية متكاملة للمكاتب السياحية بعملات متعدّدة — تذاكر وتأشيرات وباكجات وتقارير مالية ذكية،
              مع <b>إضافة كروم</b> تسحب بيانات التذاكر تلقائياً بضغطة زر.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={onSignupClick} className="grad-brand text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:shadow-xl transition text-base flex items-center gap-2">
                🚀 ابدأ تجربتك المجانية
              </button>
              <button onClick={onLoginClick} className="bg-white text-slate-800 border-2 border-slate-200 px-6 py-3 rounded-xl font-bold hover:border-blue-500 hover:text-blue-700 transition">
                تسجيل الدخول
              </button>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-4 max-w-md">
              <div><div className="text-2xl font-black text-blue-700">3+</div><div className="text-xs text-slate-500">عملات</div></div>
              <div><div className="text-2xl font-black text-orange-600">9</div><div className="text-xs text-slate-500">Parsers</div></div>
              <div><div className="text-2xl font-black text-emerald-600">24/7</div><div className="text-xs text-slate-500">دعم</div></div>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-l from-blue-600/20 to-orange-500/20 rounded-3xl blur-3xl" />
            <img src={heroImg} alt="Rahaal Dashboard" className="relative rounded-2xl shadow-2xl border-4 border-white w-full" />
            <div className="absolute -bottom-6 -left-6 bg-white rounded-xl shadow-xl border p-4 flex items-center gap-3 hidden sm:flex">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-xl">✅</div>
              <div>
                <div className="text-xs font-bold text-slate-900">قيد محاسبي جديد</div>
                <div className="text-[10px] text-slate-500">تذكرة IY123 · تم القيد تلقائياً</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="text-sm font-bold text-blue-700 uppercase tracking-wider mb-2">المزايا الأساسية</div>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900">كل ما يحتاجه مكتبك السياحي — في نظام واحد</h2>
            <p className="mt-3 text-slate-600 text-lg">من إصدار التذكرة، إلى القيد المحاسبي، إلى تقرير الأرباح — كل شيء يعمل بسلاسة.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-xl hover:border-blue-300 hover:-translate-y-1 transition-all group">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition`}>{f.icon}</div>
                <h3 className="font-bold text-slate-900 mb-1">{f.title}</h3>
                <p className="text-sm text-slate-600 leading-6">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CHROME EXTENSION SHOWCASE ===== */}
      <section id="extension" className="py-24 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(249,115,22,0.3), transparent 40%), radial-gradient(circle at 70% 80%, rgba(30,64,175,0.4), transparent 40%)' }} />
        <div className="relative max-w-7xl mx-auto px-4 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-orange-500/20 text-orange-300 border border-orange-500/40 px-3 py-1 rounded-full text-xs font-bold mb-4">🆕 جديد v3.8</div>
            <h2 className="text-4xl md:text-5xl font-black mb-5 leading-tight">
              🕋 <span className="bg-gradient-to-l from-orange-400 to-red-400 bg-clip-text text-transparent">قارئ رحّال الآلي</span><br />
              للمتصفح
            </h2>
            <p className="text-lg text-slate-300 leading-8 mb-6">
              إضافة كروم ذكية تسحب بيانات التذاكر والتأشيرات تلقائياً من صفحات <b className="text-white">اليمنية، Fly Aden، KSA e-Visa، البركة للنقل، والموافقات الأمنية</b> — وتُنشئ القيد المحاسبي وسند القبض بضغطة زر واحدة.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-sm">
              {['9 نماذج مستندات مدعومة', 'سحب آمن عبر PAT شخصي', 'يعمل مع بوابات الطيران والتأشيرات', 'قيد محاسبي فوري + سند قبض'].map((x, i) => (
                <div key={i} className="flex items-center gap-2 text-slate-200"><span className="text-emerald-400">✓</span> {x}</div>
              ))}
            </div>
            <button onClick={onSignupClick} className="bg-white text-blue-950 px-6 py-3 rounded-xl font-black hover:bg-orange-100 transition shadow-lg">
              اشترك واستفد من الإضافة →
            </button>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 bg-gradient-to-l from-orange-500/30 to-blue-500/30 rounded-3xl blur-3xl" />
            <img src={extImg} alt="Chrome Extension" className="relative rounded-2xl shadow-2xl border-4 border-white/10 w-full" />
          </div>
        </div>
      </section>

      {/* ===== SCREENSHOTS STRIP ===== */}
      <section className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-slate-900">لوحات وشاشات مدروسة</h2>
            <p className="text-slate-600 mt-2">تجربة استخدام سلسة بواجهة عربية RTL كاملة</p>
          </div>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border-8 border-white bg-white">
            <img src={dashImg} alt="Dashboard preview" className="w-full" />
          </div>
        </div>
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="text-sm font-bold text-orange-600 uppercase tracking-wider mb-2">خطط الاشتراك</div>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900">خطط تناسب مكتبك — ابدأ مجاناً</h2>
            <p className="mt-3 text-slate-600 text-lg">جرّب النظام مجاناً لمدة 30 قيد محاسبي، ثم اختر خطة تناسبك.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {pricing.map((p, i) => (
              <div key={i} className={`relative rounded-2xl p-6 border-2 ${p.highlight ? 'border-orange-500 bg-gradient-to-br from-orange-50 to-white shadow-2xl scale-105' : 'border-slate-200 bg-white hover:shadow-xl'} transition`}>
                {p.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-l from-orange-500 to-red-500 text-white text-xs font-black px-3 py-1 rounded-full shadow">{p.tag}</div>}
                <div className="flex items-center justify-between mb-3">
                  <div className={`inline-block bg-gradient-to-br ${p.color} text-white px-3 py-1 rounded-lg text-xs font-bold`}>{p.tier}</div>
                  <div className="bg-rose-100 text-rose-700 text-[10px] font-black px-2 py-0.5 rounded-full">خصم 50% لفترة محدودة</div>
                </div>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-4xl font-black text-slate-900">{p.price}</span>
                  {p.old_price && <span className="text-lg text-slate-400 line-through font-semibold">{p.old_price}</span>}
                </div>
                <div className="text-sm text-slate-500 mb-5">{p.period}</div>
                <ul className="space-y-2 mb-6 text-sm">
                  {p.bullets.map((b, j) => (<li key={j} className="flex items-start gap-2"><span className="text-emerald-500 font-bold">✓</span><span className="text-slate-700">{b}</span></li>))}
                </ul>
                <button onClick={onSignupClick} className={`w-full py-3 rounded-xl font-bold transition ${p.highlight ? 'grad-brand text-white shadow-md hover:shadow-lg' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
                  اختر هذه الخطة
                </button>
              </div>
            ))}
          </div>
          <div className="text-center mt-8 text-sm text-slate-500">🎁 نظام إحالة: احصل على 50 قيد مجاني عن كل مكتب تدعوه ويشترك فعلياً</div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section id="contact" className="py-24 bg-gradient-to-l from-blue-700 via-blue-600 to-orange-500 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, white, transparent 60%)' }} />
        <div className="relative max-w-4xl mx-auto px-4 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-black mb-4">جاهز لتحويل مكتبك رقمياً؟</h2>
          <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
            انضم إلى المكاتب السياحية التي تدير أعمالها اليومية بذكاء عبر رحّال — بضغطة زر واحدة.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={onSignupClick} className="bg-white text-blue-900 px-8 py-4 rounded-xl font-black text-lg shadow-2xl hover:scale-105 transition">
              🚀 اشترك الآن — مجاناً
            </button>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-4 rounded-xl font-black text-lg shadow-2xl hover:scale-105 transition flex items-center gap-2">
              💬 تواصل عبر واتساب
            </a>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="bg-slate-950 text-slate-400 py-12">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
          <div className="col-span-2">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl grad-brand flex items-center justify-center text-white font-black">ر</div>
              <div>
                <div className="text-white font-extrabold">Rahaal ERP</div>
                <div className="text-xs">by Target Media</div>
              </div>
            </div>
            <p className="text-sm leading-7">
              منظومة محاسبية متكاملة للمكاتب السياحية — تذاكر، تأشيرات، باكجات، تقارير مالية، وإضافة متصفح ذكية.
            </p>
          </div>
          <div>
            <div className="text-white font-bold mb-3">النظام</div>
            <ul className="space-y-2">
              <li><a href="#features" className="hover:text-white">المزايا</a></li>
              <li><a href="#extension" className="hover:text-white">إضافة المتصفح</a></li>
              <li><a href="#pricing" className="hover:text-white">الأسعار</a></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-bold mb-3">تواصل</div>
            <ul className="space-y-2">
              <li><a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="hover:text-white">📱 واتساب: 967781115482</a></li>
              <li><button onClick={onLoginClick} className="hover:text-white">🔐 تسجيل الدخول</button></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 lg:px-8 mt-8 pt-6 border-t border-slate-800 flex flex-wrap justify-between text-xs">
          <div>© {new Date().getFullYear()} Target Media. جميع الحقوق محفوظة.</div>
          <div>Rahaal ERP v3.9 · صُنع بحب للمكاتب السياحية 🕋</div>
        </div>
      </footer>
    </div>
  )
}

// ================================================================
// ROOT APP
// ================================================================
// v3.87.3 — TEST ENVIRONMENT badge: hostname-based (client runtime), renders ONLY when the
// browser host contains 'rahaal-test' (rahaal-test.targetmediagrp.com). Never on Live.
// position:fixed + pointer-events:none → zero layout shift, zero interaction blocking.
function TestEnvBadge() {
  const [isTest, setIsTest] = useState(false)
  useEffect(() => {
    try { setIsTest(window.location.hostname.includes('rahaal-test')) } catch {}
  }, [])
  if (!isTest) return null
  return (
    <div
      dir="rtl"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, pointerEvents: 'none' }}
      className="bg-amber-400/95 text-slate-900 text-[11px] sm:text-xs font-black text-center py-1 tracking-wider shadow-md"
    >
      ⚠️ بيئة اختبار — TEST ENVIRONMENT ⚠️
    </div>
  )
}

function App() {
  const [auth, setAuth] = useState({ loading: true, user: null, tenant: null, settings: null })
  // v3.9 — When not authenticated, show LandingPage by default; user can toggle to LoginPage or Signup
  const [publicView, setPublicView] = useState('landing') // 'landing' | 'login' | 'signup'

  const refreshMe = useCallback(async () => {
    try {
      const r = await api('/auth/me')
      setAuth({ loading: false, user: r.user, tenant: r.tenant, settings: r.settings })
    } catch { setAuth({ loading: false, user: null, tenant: null, settings: null }) }
  }, [])

  useEffect(() => { refreshMe() }, [refreshMe])
  // v4.8 — Phase 2: the platform SA no longer switches to the separate AdminApp view.
  // «إدارة المنصة» is now a pure in-TenantApp navigation shortcut (see Sidebar), so the
  // company-book ⇄ AdminApp switcher state was removed entirely.
  // v3.46 — After an idle auto-lock, land directly on the LOGIN page (not the public landing)
  // so the user can resume quickly. Key is written only by the idle-lock logout.
  useEffect(() => {
    if (!auth.loading && !auth.user) {
      try { if (sessionStorage.getItem('rahaal_idle_resume_tab')) setPublicView('login') } catch {}
    }
  }, [auth.loading, auth.user])

  const onLogin = async (r) => {
    // Re-fetch to get settings
    await refreshMe()
  }
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    setAuth({ loading: false, user: null, tenant: null, settings: null })
    setPublicView('landing')
    toast.success('تم تسجيل الخروج')
  }

  if (auth.loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-slate-500"><Loader2 className="w-6 h-6 animate-spin" /> جارٍ التحميل...</div>
    </div>
  )

  if (!auth.user) {
    if (publicView === 'login' || publicView === 'signup') {
      return <><TestEnvBadge /><LoginPage onLogin={onLogin} initialSignup={publicView === 'signup'} onBack={() => setPublicView('landing')} /></>
    }
    return <><TestEnvBadge /><LandingPage onLoginClick={() => setPublicView('login')} onSignupClick={() => setPublicView('signup')} /></>
  }

  return (
    <AuthCtx.Provider value={{ ...auth, refreshMe, logout }}>
      <TestEnvBadge />
      <ConfirmHost />
      {/* v5 — TenantApp is the ONLY authenticated interface for every role. The old AdminApp
          (app/admin/shell.js) is no longer mounted anywhere: the platform super_admin lands in
          the shared Rahaal company book, a classic super_admin (no tenant) lands on the platform
          home, and admin_staff land in the same shared TenantApp. The «إدارة المنصة» button is
          a pure in-app navigation shortcut to the «إدارة رحّال» group inside TenantApp. */}
      <TenantApp />
    </AuthCtx.Provider>
  )
}

// v3.9.15 — Admin panel relocated to Target Media Holding dashboard.
// SuperAdminPanel remains in codebase but is no longer routed. API endpoints /api/admin/* stay live for the external holding dashboard.
function AdminRelocationNotice({ logout, user }) {
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Target Media Header */}
        <div className="grad-brand p-8 text-center text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
          <div className="relative">
            <div className="inline-flex items-center gap-3 mb-3">
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-3xl shadow-lg">🏢</div>
              <div className="text-right">
                <div className="text-2xl font-extrabold tracking-tight">Target Media</div>
                <div className="text-xs opacity-90">تارجت ميديا للاستثمار والتقنية</div>
              </div>
            </div>
            <div className="text-3xl font-black mt-4">🔗 لوحة الإدارة انتقلت</div>
            <div className="text-sm opacity-95 mt-2">مركز التحكم الرئيسي — Target Media Holding Dashboard</div>
          </div>
        </div>

        {/* Body */}
        <div className="p-8 space-y-5">
          <div className="p-5 rounded-xl bg-gradient-to-l from-blue-50 to-emerald-50 border-r-4 border-blue-600">
            <div className="font-bold text-lg text-slate-800 mb-2">📢 إشعار مهم</div>
            <div className="text-slate-700 leading-relaxed">
              <b>لوحة إدارة المنظومة انتقلت بالكامل</b> إلى <b className="text-blue-700">تارجت ميديا القابضة</b>. يرجى استخدام <b>اللوحة الرئيسية الموحّدة</b> لإدارة:
            </div>
            <ul className="mt-3 space-y-1 mr-4 text-sm text-slate-700 list-disc">
              <li>🏢 <b>المكاتب المشتركة</b> في رحّال</li>
              <li>💳 <b>الاشتراكات والباقات</b> والأرصدة</li>
              <li>📣 <b>الإعلانات والحملات التسويقية</b></li>
              <li>🤝 <b>التسويق بالعمولة والإحالات</b></li>
              <li>⚙️ <b>الإعدادات العامة</b> للمنظومة</li>
            </ul>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
            <div className="font-bold text-slate-800 mb-1">🔧 للفريق التقني:</div>
            جميع الـ API Endpoints تحت <span className="font-mono bg-white px-2 py-0.5 rounded border text-blue-700">/api/admin/*</span> تعمل بشكل كامل وتستقبل الاتصالات من لوحة تارجت ميديا القابضة.
          </div>

          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
            💡 <b>الحساب الحالي:</b> {user?.name || user?.email} · دور: {user?.role === 'super_admin' ? 'سوبر أدمن' : user?.role}
            <br />
            <span className="text-xs">تطبيق رحّال أصبح مخصصاً بالكامل للواجهات التشغيلية (المكاتب، العملاء، الحجوزات). لإدارة المنظومة، الرجاء الدخول من لوحة تارجت ميديا القابضة.</span>
          </div>

          <div className="flex flex-col md:flex-row gap-3 pt-2">
            <button onClick={logout} className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg transition flex items-center justify-center gap-2">
              🚪 تسجيل الخروج
            </button>
            <a href="https://targetmediagrp.com" target="_blank" rel="noopener" className="flex-1 py-3 px-4 grad-brand text-white font-bold rounded-lg transition flex items-center justify-center gap-2 hover:opacity-90">
              🌐 زيارة Target Media
            </a>
          </div>

          <div className="text-center text-xs text-slate-400 pt-2 border-t">
            v3.9.15 · تم توحيد الإدارة تحت تارجت ميديا القابضة
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
