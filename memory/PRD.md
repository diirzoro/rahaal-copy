# Rahaal (رحّال) — Multi-Currency Travel Office ERP & SaaS — PRD Summary

## Core Product
Next.js 15 monolith + MongoDB. Arabic RTL ERP for travel offices: tickets, visas, services, packages, accounting (double-entry), multi-tenant SaaS, Meraaj Network B2B marketplace integration (Contract v2, HMAC webhooks, bidirectional sync).

## Architecture Constraints (USER MANDATED)
- NO refactoring/splitting of `/app/app/page.js` or `/app/app/api/[[...path]]/route.js`
- NO database schema renames, NO hard deletes
- Meraaj payload (`meraajContractPayload`) and HMAC signing are FROZEN — do not touch
- Communicate with user in Arabic

## Completed (latest first)
- v3.41: All 43 browser-native `confirm()`/`prompt()` calls replaced with professional in-app `askConfirm()` promise-based dialog (global `ConfirmHost` mounted in App root; supports danger/primary variants, icons, irreversible warning, input/prompt mode with required+textarea). Verified visually (duplicate + archive dialogs).
- v3.40: Hotel nights + city tracking with duration summary
- v3.39: Unified pricing + SearchPick smart dropdowns with inline client/supplier creation
- v3.29–v3.38: Full Meraaj integration (first share REST, HMAC webhooks, Contract v2 payload, bidirectional reflection, lifecycle ID sync)
- Mini CRM, archive panel, production cleanup

## Pending
- Meraaj E2E 15/15 test (blocked on Meraaj team configuring temp secret)
- Package Comparison feature (deferred by user)

## v3.54 (completed) — Meraaj booking notification chime
- playMeraajChime() module helper (Web Audio API, two-tone 880Hz→1174Hz sine chime, ~0.5s, no external file, cached AudioContext, silent fallback if autoplay blocked).
- Poll logic refined with meraajInitRef: first poll after login → reminder toast only (NO sound); subsequent count INCREASE → toast + chime. Verified: audio API path ok, 0 console errors.
- Deferred by user: activity log, per-age profit report, webhook health panel.

## v3.53 (completed) — Per-age costs/commissions + auto-sync + notifications + auto-approve
- Room pricing rows: cost_adult/cost_child/cost_infant (nullable, sanitized). Form shows a rose costs sub-row per room (owner/show_profit only) with live per-category profit hints.
- Per-age commission: computeMeraajMarketPricing(rows, mode, value, direction, childValue, infantValue) — empty = same as adult; all 4 call sites pass meraaj.buyer_commission_child_value/infant_value; share endpoint accepts+stores them; share dialog has 🧒/👶 inputs with live per-age preview.
- Auto-sync: verified existing — PATCH room_pricing/commission recomputes market_pricing + emits package.updated; components/transports/image also emit. Manual resync button remains as bulk fallback.
- Notification bell: GET /meraaj/inbound-count (mod_meraaj guarded); TenantApp polls 60s, fixed amber bell top-left with pending count → click opens Meraaj tab; toast on new arrivals.
- Auto-approve: approveMeraajInboundBooking() extracted (shared engine); webhook auto-approves when tenant_settings.meraaj_auto_approve (failure → stays pending, webhook still 200, response auto_approved flag). POST /meraaj/settings (owner only) + config.auto_approve + Switch UI in Meraaj screen with confirm dialog.
- Tested 8/8 backend (key: commission.adult=100/child=50/infant=0, fallback child→adult, auto-approve E2E with balanced JE 1700=1700) + UI screenshots.

## v3.52 (completed) — Meraaj booking sync visibility fix
- Root cause of "3 seats booked but 0 registrants": the design requires manual approval (v3.26) and pending inbound bookings were INVISIBLE outside the Meraaj screen's inbound tab. Registrant data itself was always received/stored correctly (verified E2E).
- New: GET /packages returns meraaj_pending_seats/meraaj_pending_count; GET /packages/:id/inbound-bookings (package-scoped, works with mod_packages only); rejected webhooks (bad HMAC) now logged in meraaj_webhook_log {ok:false, reason:'invalid_signature', body_head} for LIVE delivery diagnosis.
- FE: amber pulse badge on package card ("N مقعد من معراج بانتظار الاعتماد"), registrants tab shows pending Meraaj bookings with ALL registrant names/categories/rooms + one-click "اعتماد وإظهار المسجلين" (mod_meraaj/owner; others see waiting note), +N badge on tab title.
- Tested 9/9 E2E: signed webhook → immediate visibility → approve → names in bookings; invalid signature 401 + logged; idempotent duplicates.
- LIVE diagnosis guidance: if bookings still missing on LIVE, check meraaj_webhook_log (secret mismatch) and meraaj_inbound_bookings.

## v3.51 (completed) — Supplier on page 1 + tab rename + RBAC Phase 3
- Package form page 1: supplier SearchPick (f.supplier_id, saved in one shot via POST/PATCH; internal field — NOT in Meraaj payload, verified). Card button renamed "المكونات والتسجيل" → "التسجيل والمواصلات".
- RBAC Phase 3: new perms fin_statements / fin_partner_summary (accountant template both, sales_manager partner only). allowed_box_ids per user (empty = all): GET /boxes filtered for restricted staff (server-enforced), POST /vouchers + cash booking box guard 403, discount>0 requires owner/apply_discount 403. Route guards: /reports/statement + /bulk-statement/generate → fin_statements; /partners/statements → fin_partner_summary. FE: ReportsScreen statement tab hidden, packages كشف الشريك gated by fin_partner_summary, PermissionsDialog boxes multi-select (name_ar labels) + 2 new keys in التقارير group.
- Tested 7/7 backend + UI screenshots (supplier field, renamed buttons 15/0, boxes UI). Box docs use name_ar (not name).

## v3.50 (completed) — Batch Re-sync + RBAC Phase 2
- POST /api/meraaj/resync-all (owner only; endpoint lives in tenant-scoped section — test agent moved it there after a T-scope bug): recomputes meraaj.market_pricing fresh from room_pricing + stored commission for ALL shared non-archived packages, persists + market_pricing_updated_at, emits package.updated each. Returns {total, synced, failed}. FE button "🔄 تحديث كل الباقات في معراج" in MeraajStoreScreen TopBar (owner only, askConfirm + result toast).
- RBAC Phase 2 (hide financials from staff without show_profit): PackageDetailsDialog — components & transports tabs hidden (default tab=bookings), header cost/profit line replaced with sale-only; discount section in booking form gated by apply_discount; PkgCard معراج share button gated; MeraajStoreScreen commission column ("عمولة الوكيل") hidden + approve-confirm net amount text hidden.
- Tested: backend 7/7 (stale 'قديم' pricing replaced, events emitted, staff 403, counts match). UI verified: staff sees only المسجلون tab + sale price, no معراج/تقرير/خصم; owner sees resync button + commission column.

## v3.49 (completed) — NaN/zero-price fix + Hotels details
- Root cause of Meraaj NaN/zeros: (a) contract payload used stored meraaj.market_pricing which could be EMPTY/stale → now meraajContractPayload recomputes live from room_pricing + stored commission when empty (marketRows fallback); (b) meraajPackagePayload sent raw sale_child/sale_infant nulls → now resolved (child→adult, infant→0). Same payload structures — values only.
- hotels field on packages: sanitizeHotels (max 10, name<=80, city<=40, nights 0-60) + POST/PATCH support. Contract hotels[] (string names) merges component hotels + package hotels (deduped).
- FE: form section "🏨 تفاصيل الفنادق والليالي" (quick-add Makkah/Madinah buttons, name/city/nights rows, nights-vs-duration summary), completeness note under room pricing, showcase dialog hotels cards, WhatsApp message hotel lines.
- Tested 5/5 via agent (critical test: empty market_pricing + null child/infant → payload fully numeric, correct commission math, hotels merged). Form UI verified via screenshot.

## v3.48 (completed) — Full responsive audit & fixes
- Central fixes: shared DialogContent now max-h-[92vh] + overflow-y-auto + rounded-lg (all 48 dialogs fit any viewport with internal scroll); TopBar flex-wrap + min-w-0 + responsive title sizes (action buttons wrap on narrow screens).
- Existing foundations kept: sidebar icon-rail w-16 on mobile / w-64 md+, main overflow-x-hidden min-w-0, globals.css v3.9.5 (tables horizontal scroll, tablist scroll, dialog 96vw mobile).
- Audited via emulation: 320x640, 360x800, 1920x1080. ALL 20 sidebar tabs = 0 horizontal overflow at 360px. Login/landing/dashboard/packages/tickets/receipt/boxes/reports/settings/meraaj verified visually. Package form dialog (345x736), voucher dialog, showcase dialog (with image + pricing table) all fit viewport. Desktop 1920 layout intact. RTL/Arabic wrapping correct.
- Note: GitHub push must be done by the user via "Save to GitHub" in the chat UI (agent does not perform git write actions).

## v3.47 (completed) — Automatic image optimization
- POST /api/packages/:id/image now optimizes ONCE at upload via sharp@0.34.5 (pinned in package.json): EXIF auto-rotate, resize fit:'inside' max 1200px longest side (aspect preserved, withoutEnlargement), WebP q82 (constants IMG_MAX_DIM/IMG_WEBP_QUALITY at top of route.js). package_images doc stores content_type='image/webp' + width/height/original_bytes/optimized_bytes. Serve endpoints & Meraaj contract untouched (content_type read from doc; public URL unchanged).
- FE: PkgCard displays the image (when has_image) in aspect-[16/9] + object-cover block above card content, lazy-loaded, hides on error.
- Tested 9/9 via agent: 3000x2000→1200x800 (97.6% smaller), portrait 1500x3000→600x1200, small 400x300 not enlarged, WebP RIFF signature, invalid input 400s, meraaj package.updated images URL intact. UI verified desktop + mobile screenshots.

## v3.46 (completed) — Idle Auto-Lock + Hard Refresh behavior
- IDLE_TIMEOUT_MINUTES=15 (centralized const in page.js near NAV) + IDLE_RESUME_KEY sessionStorage key.
- TenantApp: activity listeners (mousedown/keydown/scroll/touchstart/mousemove throttled 5s) arm a timer; on expiry: save current tab to sessionStorage key, toast, then EXISTING logout() (same as manual). Resume effect on mount consumes the key once and restores the tab (validated via canModule).
- App: if logged out and resume key present → publicView='login' directly (skip landing).
- Hard refresh naturally lands on Dashboard (tab is in-memory useState only; no persistence was ever added) — resume key is written ONLY at idle logout, keeping behaviors strictly separate.
- Tested via browser automation: refresh→dashboard ✓, idle-path logout→login page ✓, re-login→exact section restored + key consumed ✓, normal nav intact ✓. No DB/API/Meraaj changes.

## v3.45 (completed) — RBAC Phase 1
- DEFAULT_STAFF_PERMISSIONS extended with 19 mod_* module keys (financial modules default OFF for staff). RBAC_ROLE_TEMPLATES(): registrar/sales/sales_manager/accountant/full_manager. GET /api/rbac/templates (owner-only). Server-side module guard after session check (staff only; shared lookups /clients /suppliers /boxes /accounts intentionally open). role_key on user (PATCH /tenant/users/:id, sanitizeUser, users list).
- FE: MODULE_LABELS + canModule(); Sidebar filtered per employee; TenantApp tab guard + auto-redirect to first allowed module; PermissionsDialog upgraded with role-template picker + modules group; PackagesScreen profit gating via show_profit (top-profit KPI, مقارنة الربحية, كشف الشريك, التقرير button hidden).
- Fixed latent Mongo connect race (cached connect promise) that caused intermittent 500s.
- Tested: backend 9/9 via test agent (staff.rbac@demo.com / Staff@2025 created as registrar, saved in test_credentials.md), UI verified via screenshots (staff sees 4 sidebar items, no profit UI; owner dialog shows templates + modules).
- Phase 2 (upcoming): granular in-page hiding (package tabs costs/components/transports for registrar, Meraaj commission columns, dashboard profit KPIs). Phase 3: per-box financial restrictions, statements/partner summary/auto-journal blocking, smart discount restriction (apply_discount key exists).

## v3.44 (completed)
- GLOBAL modal protection in /app/components/ui/dialog.jsx (single shared DialogContent → covers all 48 dialogs): backdrop/outside click NEVER closes dialogs; typing marks dialog dirty; closing via X or Esc with typed data triggers a professional "إغلاق وتجاهل البيانات؟" confirmation (via globalThis.__rahaalConfirmDiscard installed by ConfirmHost). ConfirmDialog itself opts out via disableDirtyGuard prop. Verified E2E via screenshots (7/7 steps).

## v3.43 (completed)
- Self-service Meraaj store activation: POST /api/meraaj/activate (tenant-authed, idempotent, upserts tenant_settings.meraaj_store {active, activated_at, activated_by}, best-effort 'office.store_activated' outbox event — non-blocking). GET /api/meraaj/config returns store_active + store_activated_at.
- MeraajStoreScreen: prominent "🚀 تفعيل المتجر والاشتراك الآن" button (askConfirm dialog) → green activated banner + "✅ المتجر مفعّل" badge; iframe now gated on store_url AND store_active. Backend-tested 6/6, UI verified via screenshots. Demo tenant is activated.

## v3.42 (completed)
- Fixed LIVE bug: `package.updated` sent `images: []` despite `has_image=true` because NEXT_PUBLIC_BASE_URL was empty at runtime.
- `rahaalPublicBase()` in route.js: RAHAAL_PUBLIC_BASE_URL (new optional env) → NEXT_PUBLIC_BASE_URL → cached live request origin (x-forwarded-host). Loud console.error if unresolvable (never silent).
- Backend-tested: image URL present when has_image=true, [] when not; deactivated/updated events + identity fields intact.

## Test Credentials
See /app/memory/test_credentials.md

## v3.88.2 (completed — awaiting user approval before any push/merge)
- PR Blocker 1: tenant_settings is guaranteed ONE doc per tenant — lib/coa.js upsertTenantSettingsDefaults() (upsert + $setOnInsert id) replaces raw insertOne in seedTenantDefaults. Unique index is now created SAFELY via ensureTenantSettingsUniqueIndex(): read-only duplicate audit first; on duplicates → nothing deleted/merged, index NOT created, loud manual_review warning logged.
- PR Blocker 2 (hardened): Full Reset is DENIED BY DEFAULT for any tenant with transactions, in every environment. The ONLY exception is a positively-proven test env: DB name ends in _test/_tests AND ALLOW_DESTRUCTIVE_COA_RESET=true (both required). No longer depends on DISABLE_AUTO_SEED. /coa/rebuild returns Arabic 403; TEST bootstrap auto-migration wrapped so a guard refusal never crashes startup.
- PR Blocker 3: no git remote in workspace — sync of tenent-updates with GitHub main must be done via PR "Update branch" or Save-to-GitHub (reported to user).
- Tests: coa-tests.js scenarios K (single settings doc), L1/L2/L3 (default-deny guard incl. non-_test DB + no env flags), M (duplicate audit blocks index, nothing deleted) → 30/30 PASS on isolated DBs.

## v3.88.3 (completed)
- Equity (حقوق الملكية) added as a selectable account type in the add-account dialog. FE: type option + display maps (byType/typeLabel/typeGrad/typeColor) + equity parents restricted to equity GROUP accounts only (other types' parent filtering unchanged). BE: 5-type whitelist on POST /accounts (equity first-class); parent-type match & hierarchical coding were already generic. No migration/backfill; existing accounts and COA v2 structure untouched. API tests 12/12 + UI screenshots verified.

## v3.88.4 (FIX-ONLY audit round — completed, NOT TESTED per user instruction)
- Accounting integrity: leaf-account posting everywhere (no group postings), refund engine rewritten (kept original JE + linked reversal, no zero-value refunds, cash double-hit fixed), real restore-on-error on edits, partner-share reversal fixed, negative service costs rejected.
- Reports: statement opening/closing balances + unified account matching + business-TZ date filters (string/Date safe); income statement journal-based; profits exclude refunded; year-close per-currency into 3102 with preflight (no 3900, no auto-create).
- Guards: rate bounds (min≤buy≤transfer≤sell≤max), FX deviation ±10% + no negative box, credit_limit≥0, expense voucher requires real COA account, package end≥start.
- Env isolation: publicSiteOrigin() — Test emits Test URLs only (referral/invite/extension), BE referral link host-aware.
- UI: ref-type Arabic labels, dynamic © year, version 3.88.4, chart tree refresh after save/del, no silent account-code rewriting, password field masked + field-specific employee validation.
- NOT executed (approval needed): F-021 platform-fee independent revenue JE (accounting design), P-001 phone E.164 unification, E-001/B-001 server env & mongodump (infra), any migration/backfill/historical reconciliation.
- v3.88.5 (PR#15 review): atomic restore-on-edit (no swallowed errors, replaceOne upsert, loud 500 on restore failure), strict leaf-account resolution before first write (no silent Group fallback — legacy parties get clear re-link error), refund math verified (20k-case simulation, 0 unbalanced), emergent.yml timestamp excluded from working tree.

## Session v3.89 — FIX ONLY (7 نقاط تشغيلية ومحاسبية) — NOT TESTED (بطلب المستخدم)
1. GET /api/accounts/next-code (معاينة كود فرعي، قراءة فقط) + التوليد النهائي الذري عند POST /accounts (code فارغ).
2. زر ➕ داخل شجرة COA (العرضين) يفتح نموذج إضافة حساب فرعي مع تعبئة الأب/النوع/الكود تلقائياً (prefill + autoCode في page.js).
3. منع التكلفة > سعر البيع: roomPricingCostError() في packages POST/PATCH + تحقق tiers في components POST + مرآة FE في save() للباقة. القاعدة: أي فئة سعر بيعها > 0 يجب أن تكون تكلفتها <= البيع (فئات البيع=0 تُتجاهل: رضيع مجاني/وضع direct).
4. createService: beneficiary_name + beneficiary_phone إلزاميان (إنشاء + تعديل) + FE. ملاحظة: تعديل خدمات قديمة بلا اسم/هاتف مستفيد سيطلب تعبئتهما.
5. نجوم (*) للحقول الإلزامية مطابقة للتحقق الفعلي: تذاكر (اسم/تاريخ سفر/هاتف)، تأشيرات (اسم/هاتف)، خدمات (مستفيد/هاتف)، باقات (النوع)، الحجوزات كانت موسومة مسبقاً. + جسر توافق تأشيرات: FE يرسل beneficiary_* بجانب passenger_* (الخادم يتحقق من beneficiary_*).
6. شبكة معراج: حساب عميل موحد "شبكة معراج" (is_meraaj_network=true، leaf تحت 1103 العملاء) يُنشأ lazily عند أول اعتماد (upsert ذري، بدون migration). القيد المالي عند الاعتماد فقط (كان كذلك). Idempotency مزدوج: package_bookings.meraaj_booking_ref + journal_entries.meraaj_booking_ref (عبر opts.extra في createJournalEntry). العملاء القدامى "معراج — مكتب X" لم يُمسّوا.
7. COA v2 محمي: لا تعديل على lib/coa.js أو القوالب؛ next-code قراءة فقط؛ حظر الترحيل على Group Accounts قائم كما هو.
الملفات: app/api/[[...path]]/route.js + app/page.js فقط.

## v3.89.1 — إصلاح 3 Blockers من مراجعة PR #16 (NOT TESTED بطلب المستخدم)
- B1: قيود اعتماد معراج تستخدم الحسابات النهائية cli.account_code وsupplier.account_code (لا 1103/2101 المجمّعة) مع party_id الصحيح؛ حلّ الأكواد قبل أي كتابة مالية.
- B2: زر + يظهر فقط عند node.is_group===true (العرضان) + حارس خادم في POST /accounts وnext-code يرفض أباً غير Group + eligibleParents مجموعات فقط.
- B3: Idempotency متزامنة عبر Claim ذري (findOneAndUpdate على financial_posted بالطلب الوارد — فائز واحد فقط) + Atomicity: balances→JE→booking داخل try/catch بتعويض عكسي كامل (حذف القيد، عكس الأرصدة، تحرير الـClaim) — لا Partial Financial Operation.

## v3.89.2 — تصليب Blocker 3 (مراجعة PR #16 جولة 2) — NOT TESTED بطلب المستخدم
- appliedBalances[]: تتبع كل Balance write منفرداً وعكس ما نجح فقط (لا Boolean واحد).
- تعويض journal_quota.used بـ$inc:-1 (بشرط >0) + حذف القيد بـref_id (يغطي orphan JE).
- Mutex على هوية الطلب meraaj_booking_ref عبر op_locks (_id uniqueness مدمجة — لا Index جديد) + فحوصات التكرار داخل الـMutex + الـClaim على inbound doc باقٍ كحزام. Stale TTL 120s.
- إنشاء حساب "شبكة معراج" داخل Mutex (meraaj_net_client:tenant) + قراءة حتمية sort(created_at:1) + انتظار محدود للخاسر. اقتراح مؤجل بالتقرير: partial unique index على {tenant_id, is_meraaj_network}.
- helpers جديدة: acquireOpLock/releaseOpLock. مجموعة op_locks تُنشأ تلقائياً عند أول استخدام.

## v3.89.3 — Owner Token للأقفال (آخر Blocker بمراجعة PR #16) — NOT TESTED بطلب المستخدم
- acquireOpLock يولّد owner_token (uuid) ويعيده كـhandle (أو null) بدل boolean.
- releaseOpLock يحذف فقط {_id + owner_token} — لا حذف أعمى بالـ_id (يمنع حذف A لقفل B بعد stale-takeover).
- stale cleanup يحذف فقط النسخة المقروءة بالضبط (created_at + owner_token إن وجد) — قفل أحدث لا يُمس.
- طُبق على meraaj_post:* (اكتساب + تحريران) وmeraaj_net_client:* (اكتساب + finally).

## v3.89.4 — F-PR16-001 (QA) — NOT TESTED بطلب المستخدم
- الجذر: تحقق هاتف المستفيد في createService كان يقبل beneficiary_whatsapp كبديل، والواجهة تنسخ أول إدخال هاتف للواتساب — مسح الهاتف يُبقي الواتساب → حفظ بلا هاتف مع أثر مالي.
- الإصلاح: تحقق صارم لـbeneficiary_phone وحده (خادم createService سطر ~8259 + مرآة واجهة). الرفض قبل أي Balance/Journal. يغطي Create وEdit (كل المسارات تمر بـcreateService — insertOne وحيد).
- F-PR16-002: pilgrim_name ليس Required في الخادم (POST /packages/:id/bookings) ولا في addBooking — لا نجمة ولا تغيير حسب التعليمات.

## v3.90 — Super Admin المرحلة 1 (Shell + Dashboard) — NOT TESTED بطلب المستخدم
- قرار AUDIT-002 (بأفضل تقدير بعد تخطي السؤال): اللوحة الجديدة داخل رحّال، تستوعب SuperAdminPanel القديم تدريجياً، وكل /api/admin/* أعيد استخدامها كما هي. اللوحة القديمة متاحة من عنصر "اللوحة الكلاسيكية" (تمرر كـprop legacyPanel) — صفر فقد وظيفي.
- ملفات جديدة معيارية: app/admin/shell.js (Sidebar 13 قسماً + Header + Placeholders بمراحلها) و app/admin/dashboard.js (KPIs قراءة فقط من: /admin/tenants + password-reset-requests + installments-overview + office-verifications — بدون أي API جديد).
- قسم "العروض والإعلانات" يعرض AnnouncementsManager القائم كما هو (prop) — التوسعة بالمرحلة 6.
- تعديل page.js: سطرا استيراد وتوجيه فقط. لا تغيير في route.js إطلاقاً.
- حوكمة: شارة "قراءة فقط مالياً" بالهيدر والشريط الجانبي؛ آلية audit_logs الفعلية تُفعّل مع أول عمليات كتابة (مرحلة 2+).
- المتبقي: المراحل 2–8 حسب خطة المستخدم. AUDIT-001 (3900/3102) مؤجل للتحقق قبل أي تغيير محاسبي.

## v3.91 — Super Admin المرحلة 2 (المكاتب + Office 360°) — NOT TESTED بطلب المستخدم
- API جديد وحيد (مبرر: كل مسارات المكتب تشتق T من الجلسة وsuper_admin بلا جلسة مكتب): GET /admin/tenants/:id/office360?tab= — قراءة فقط، منطقه في lib/admin360.js وسطر تفويض واحد في route.js. أرصدة مخزنة كما هي، لا إعادة حساب.
- توسعة GET /admin/tenants: إرفاق owner {name,email,phone} من استعلام users القائم أصلاً (صفر استعلام إضافي).
- واجهة: app/admin/offices.js (قائمة + بحث + Office360 بـ10 تبويبات lazy-cache) مربوطة في shell.js. Impersonation يعاد استخدامه كما هو. تبويب الاشتراك يعيد استخدام /admin/installments-overview بفلترة أمامية.
- AUDIT-001 (فحص ثابت، بلا إصلاح): الخادم يرحل الإقفال إلى 3102 (RETAINED_EARNINGS ثابت في route.js:67 وlib/coa.js:28؛ تعليق 6939 يؤكد أن 3900 القديم لا وجود له بالشجرة وأُصلح). التضارب نص UI فقط: page.js:5902 و5921 يذكران "3900 الأرباح المدورة" بينما 5979 صحيح (3102). التوصية: توحيد النصين إلى 3102 لاحقاً بموافقة.
- Data Gaps: لا last_login (النشاط مشتق من created_at)؛ الأرباح null (لا endpoint إداري موثوق)؛ القائمة لا تعرض عدد العمليات/COA/معراج (متاحة داخل 360)؛ الفروع = الحد max_branches لا العدد الفعلي؛ backup/export يعتمد جلسة مكتب.
- عمليات تحتاج Audit لاحقاً: tenants POST/PATCH/toggle-status/topup/reset-password/impersonate/confirm-payment، pricing-config PUT، plans PUT، password-reset PATCH، office-verifications PATCH، announcements POST/PUT/DELETE، backup/export، (اختيارياً: قراءات office360).

## v3.92 — ربط حسابات الدليل بالسجلات التشغيلية — NOT TESTED بطلب المستخدم
- الهوية = account_code حصراً (لا الاسم). helper: opLinkMapFor + ensureOperationalLink في route.js.
- POST /accounts تحت 1101/1102/1103/2101 (غير مجموعة): فحص مسبق لتكرار الاسم → إنشاء الحساب → إنشاء السجل التشغيلي (صندوق cash/bank، عميل، مورد) — وعند التعارض تراجع نظيف (حذف الحساب) بلا يتيم.
- PUT /accounts/:id: إعادة التسمية تحافظ على الهوية — مزامنة اسم السجل بالكود + رفض الاسم المكرر. مزامنة عكسية من PUT clients/suppliers إلى accounts.name_ar بالكود.
- DELETE /accounts/:id: حظر حذف حساب مرتبط بسجل تشغيلي.
- /accounts/tree: منع ازدواج العقدة — السجل الذي كوده موجود كمستند accounts يُدمج كـlinked_entity على العقدة (شارة 🔗 بالواجهة).
- الاستيراد (تذاكر+تأشيرات، معاينة+تنفيذ): رفض صريح للأسماء المكررة (عميل/مورد/صندوق) — findStrict limit(2)، لا إنشاء تلقائي لأي طرف.
- اليتامى: GET /accounts/link-audit (قراءة) + POST /accounts/link-repair (مالك فقط، Idempotent، تعارضات الأسماء تُتخطى وتُعرض) + زر "🔗 فحص الربط التشغيلي" وحوار في صفحة الدليل.
- السندات لم تُمس: كانت أصلاً ترحل على الحساب النهائي (partyLeafCode + boxLeafV F-007) — المشكلة كانت غياب السجل التشغيلي فقط.

## v3.92.1 — الحذف الآمن لحساب الدليل — NOT TESTED بطلب المستخدم
- accountUsageCheck(): الاستخدام = تاريخ فعلي (journal_entries بالكود، vouchers.coa_account_code، وللسجل المرتبط: journals بالـparty_id + vouchers + tickets/visas/services + package_bookings + package_components + currency_exchanges بالـrecord id) + حزام رصيد غير صفري. "رصيد=0" لا يسمح بالحذف أبداً.
- DELETE /accounts/:id: نظامي ممنوع؛ مجموعة بأبناء (حسابات أو سجلات تشغيلية تابعة) ممنوعة؛ مستخدم → رسالة "لا يمكن حذف الحساب لأنه مرتبط بعمليات أو قيود مالية. يمكنك إيقاف استخدامه أو تغيير اسمه بدلاً من حذفه."؛ غير مستخدم + مرتبط → حذف متسلسل آمن (السجل + الحساب) بعملية واحدة؛ لا إعادة ترقيم (next_child_seq لا يُمس).
- FE: نص التأكيد "هل أنت متأكد من حذف الحساب؟ لا يمكن التراجع بعد الحذف." + toast يوضح الحذف المتسلسل.

## v3.93 — Super Admin Phase 3 (مبيعات وسندات + محاسبة ورقابة + مركز الصلاحيات) — NOT TESTED بطلب المستخدم
- الباك إند: lib/adminCenter.js (GET فقط — /admin/center/sales, /sales-detail, /vouchers, /accounting/*) وlib/adminPerms.js (/admin/perms/users, /user-preview, /roles CRUD مخصص فقط, /audit) مربوطة بـroute.js تحت حارس super_admin.
- الواجهة: app/admin/sales.js (تبويبا مبيعات/سندات، فلاتر مكتب/نوع/حالة/عملة/دفع/تاريخ، تفاصيل قراءة فقط)، app/admin/accounting.js، app/admin/perms.js (أدوار: مدمج غير قابل للتعديل + مخصص بسبب إلزامي مسجل في audit_logs، مستخدمون قراءة فقط مع معاينة الصلاحيات الفعّالة والمصدر، سجل تدقيق).
- shell.js: تفعيل تبويبات sales/vouchers/accounting/permissions (ready) مع key لإجبار remount بين المبيعات والسندات (initialTab).
- الحوكمة: كل الشاشات المالية قراءة فقط صارمة — لا أزرار إنشاء/تعديل سندات أو قيود. القوالب المخصصة المفعّلة تندمج تلقائياً في /api/rbac/templates (محرك واحد). تعديل قالب لا يسري على المستخدمين الحاليين إلا بإعادة الإسناد.
- Data gap موثق: last_login غير متتبع بالنظام — يظهر null.

## v3.94 — Super Admin Batch 2 (مركز العمولات + مركز الطلبات + العروض والإعلانات) — NOT TESTED بطلب المستخدم
- lib/adminCommissions.js (GET فقط — /admin/commissions/overview,list,detail,rules): يقرأ عمولات الشركاء المخزنة (commission_share_* على tickets/visas/services/package_bookings)، عمولات معراج (agent_commission_total على meraaj_inbound_bookings)، والأفلييت (tenants.affiliate + cashout_requests). لا محرك ثانٍ، لا إعادة احتساب، القاعدة Snapshot على العملية. عمولات الموظفين غير موجودة بالنظام (فجوة موثقة). الثوابت تمرر من route (AFFILIATE_*).
- lib/adminRequests.js (GET فقط — /admin/requests/overview,list,detail): نافذة موحدة على meraaj_inbound_bookings (+cancellation_status)، password_reset_requests، cashout_requests، refunds، tenant_settings.office_verification. حالة موحدة للعرض فقط + needs_action + متأخر >48h. كل إجراءات الكتابة بقيت بمساراتها القائمة (نقاط قرار موثقة: اعتماد معراج، معالجة السحب غير المنفذة أصلاً، قرارات التوثيق واستعادة كلمات المرور في اللوحة الكلاسيكية).
- lib/adminAds.js: وسّع /admin/announcements في نفس المجموعة والمسارات — أنواع (popup/banner/offer/maintenance/notice)، status (draft/active/paused/cancelled) + display_status محسوب (live/scheduled/expired)، priority، placement، cta_text، audience (all/tenants/plan/sub_status) مطبق من الخادم في /announcements/active (activeAnnouncementsFor — legacy docs بلا audience تظهر للجميع)، published_at، منع حذف المنشور (إلغاء فقط)، نسخ كمسودة، سبب إلزامي للإلغاء وللتعديل بعد النشر، audit_logs category 'announcements'. توافق خلفي: GET يعيد Array للمدير القديم (extended=1 يعيد {rows,counts})، وPUT {active} من المدير القديم يحوَّل active/paused.
- الواجهات: app/admin/commissions.js، app/admin/requests.js، app/admin/ads.js — مربوطة في shell.js (قسما commissions/requests جديدان بأيقونتي BadgePercent/Inbox، وقسم ads يعرض AdminAdsCenter بدل المدير القديم المدمج — المدير القديم باقٍ في اللوحة الكلاسيكية).
- حقول جديدة على announcements فقط: status, placement, priority, audience, cta_text, maintenance, published_at, updated_by (defaults تحفظ التوافق — لا migration). لا Collections جديدة (إعادة استخدام audit_logs). لا Indexes جديدة.
- استهداف الدولة غير متاح (لا حقل دولة على المكاتب) — موثق. واجهة المكاتب تعرض popup/banner فقط حالياً؛ الأنواع الجديدة تُسلَّم عبر نفس API (عرضها بواجهة المكاتب مرحلة لاحقة).

## v3.95 — Super Admin Batch 3 (نسخ احتياطي وإدارة نظام + تدقيق/صحة + إشعارات) — NOT TESTED بطلب المستخدم
- lib/adminSystem.js (/admin/system/*): سجل نسخ admin_backups + محتوى admin_backup_blobs (≤8MB) — الأنواع الفعلية: tenant_export (نفس قائمة مجموعات /backup/export الـ13 + tenant_settings) وsystem_settings؛ Full/DB Backup غير متاحين (نقاط قرار معروضة بصدق). إنشاء بسبب إلزامي + منع تكرار (running خلال 3 دقائق) + تنزيل مسجل بالـAudit. Retention في platform_settings (backup_retention) عرض فقط — التنظيف التلقائي غير مفعّل. مسار استعادة admin_restore_requests: validate→preview (أثر لكل مجموعة: بالنسخة/بالقاعدة)→approve (تأكيد كتابي «أؤكد الاستعادة» + Maker-Checker إذا وُجد أدمن آخر)→reject؛ execute معطّل صلبياً (423) بالتصميم. منع استعادة نسخة مكتب لمكتب آخر من الخادم. status/environment/integrations (مفاتيح كوجود فقط، بيئة من NEXT_PUBLIC_BASE_URL: rahaal-test→Test/emergent→Preview/غيره Live، إصدارات الكود غير المتطابقة 3.88.4/3.9.28/3.9.20 تُعرض كما هي). Maintenance config في platform_settings (maintenance_mode) — الإنفاذ غير موصول عمداً (نقطة قرار)، تأكيد كتابي «تفعيل الصيانة» + Maker-Checker على Live.
- lib/adminAudit.js (/admin/audit/* — GET فقط، 405 لغيره): دمج audit_logs + je_audit + document_audit بصف موحد + فلاتر + تفاصيل بإخفاء تلقائي للحقول الحساسة (pass/secret/token/hash/key) + فجوات موثقة (لا IP/UA/success/correlation، عمليات tenants التاريخية غير مسجلة). systemHealth: db ping/dbStats/backup/معراج (أخطاء 24س)/jobs غير معروف/تطابق الإصدارات (تحذير حقيقي لعدم التطابق) — «غير معروف» بدل نجاح وهمي.
- lib/adminNotify.js (/admin/notify/*): أول نظام إشعارات — admin_notifications (مخزنة، تُطلق فقط من تدفقات Batch 3: backup done/failed، restore_request، maintenance_change، settings_change) بمفتاح dedupe_key + read_by/archived_by لكل مستخدم + handled. Feed مشتق لحظي من adminRequestsHandler overview + أخطاء معراج (لا تخزين). إعدادات admin_notification_settings لكل نوع (كتالوج NOTIFICATION_TYPES بوسم wired: true/derived/false بصدق) — تعديل بسبب + Audit. القناة In-App فقط؛ SMS/Push/Email غير منفذة. فشل الإشعار لا يكسر العملية الأصلية أبداً.
- الواجهات: app/admin/backup.js, system.js, audit.js, health.js, notifications.js — مربوطة في shell.js (5 تبويبات ready). route.js: 3 استيرادات + كتلة تفويض واحدة (/admin/system|audit|notify) مع ctx حقيقي.
- Collections جديدة: admin_backups, admin_backup_blobs, admin_restore_requests, admin_notifications, admin_notification_settings + مستندا platform_settings (backup_retention, maintenance_mode). لا Indexes، لا Migration، لا مساس بالبيانات القائمة.

## v3.96 — Super Admin Batch 4 (مركز التقارير + مركز النزاعات + العملات وأسعار الصرف) — NOT TESTED بطلب المستخدم
- lib/adminReports.js (/admin/reports/catalog + /run — GET فقط، 405 لغيره): كتالوج موحد (مبيعات/سندات/مالية/عمولات/مكاتب/طلبات/نزاعات/نظام) — كل تقرير يعلن مصدره. إعادة استخدام معادلات المكاتب حرفياً (trial_balance/income_statement F-012/profits F-013 v3.88.4) ومعالجات Batch 1–3 (adminCenter/adminCommissions/adminRequests/adminAudit/adminSystem). لا عملات مدموجة، لا إعادة تسعير تاريخية (snapshots)، حدود اليوم UTC+3. التقارير غير المتاحة تُعرض بسبب صريح (balance_sheet, cash_flow) بدل أصفار مضللة. تصدير CSV (UTF-8 BOM) + طباعة من الواجهة. تقارير PDF المجدولة مؤجلة.
- lib/adminDisputes.js (/admin/disputes*): محرك جديد (لم يوجد سابقاً) — collections: disputes, dispute_attachments + مستند admin_dispute_config (قوائم مدارة: أنواع/أسباب/أسباب رفض/أولويات+SLA — المستخدم منها لا يُحذف). آلة حالات مفروضة من الخادم (open→in_review→…→closed/reopened) مع رفض الانتقالات غير المسموحة. أمان مالي مطلق: لا مساس بالأرصدة — القرار المالي يسجل pending_execution ويمر بالمسار المالي القياسي (نقطة قرار). مرفقات PNG/JPG/PDF ≤2MB محمية بعد القرار النهائي. سبب إلزامي + audit_logs (category: disputes) + إشعارات admin_notifications. ربط اختياري بمرجع فعلي (REF_COLL: tickets/visas/services/package_bookings/meraaj/vouchers/refunds/clients/suppliers/tenants).
- lib/adminCurrency.js (/admin/currency/*): لا مصدر موازٍ — العملات التشغيلية = ثابت CURRENCIES بالكود (USD/SAR/YER، الأساس YER)، والأسعار الحية = tenant_settings.rates لكل مكتب (نفس المصدر الذي تستهلكه التطبيق). التعديل بنفس فحص حدود المكتب (min≤buy≤transfer≤sell≤max F-003) + سبب إلزامي + تأكيد كتابي + سجل نسخي fx_rate_history (effective_from/to، superseded تسلسلياً — لا سعرين فعالين متداخلين) + audit (category: currency). لا أثر رجعي (العمليات تثبّت exchange_rate). سجل عملات إداري (بيانات وصفية فقط) — الإضافة لا تجعل العملة تشغيلية (نقطة قرار معلنة)، لا حذف عملات.
- الواجهات: app/admin/reports.js, disputes.js, currency.js — مربوطة في shell.js (3 تبويبات ready: مركز التقارير/مركز النزاعات/العملات وأسعار الصرف بأيقونات BarChart3/Scale/Coins). route.js: 3 استيرادات + كتلة تفويض واحدة تحت حارس super_admin مع ctx من الثوابت الحقيقية.
- Collections جديدة: disputes, dispute_attachments, fx_rate_history + مستند admin_dispute_config. لا Indexes، لا Migration، لا بيانات وهمية، لا مساس بالبيانات القائمة.

## v3.97 — Super Admin Batch 5 (المواقع الجغرافية + طرق الدفع والجهات المالية + القوائم المرجعية + RBAC الإداري الكامل) — NOT TESTED بطلب المستخدم
- lib/adminStaff.js (/admin/staff/*): نطاق الإدارة العليا — isMainSA (super_admin بلا tenant_id) + admin_staff (admin_realm=true, tenant_id=null). كتالوج ADMIN_SECTIONS (21 قسماً × إجراءات view/create/edit/approve/reject/activate/disable/export/download/manage/move). adminGate: البوابة الموحدة لكل /api/admin/* (realm ثم قسم/إجراء — GET=view، الكتابة=إجراء كتابي). 7 قوالب أدوار مدمجة (مدير مكاتب/مالي/عمليات/نزاعات/تقارير/نظام/محتوى) + أدوار مخصصة admin_staff_roles. مستخدمو الإدارة: إضافة (bcrypt)/إسناد دور/Overrides (منح-منع لكل قسم.إجراء)/معاينة فعالة/تفعيل-تعطيل (التعطيل ينهي الجلسات deleteMany sessions). سبب إلزامي + audit (category: admin_staff). لا مستخدم يُنشأ تلقائياً.
- route.js: استبدال حارس /admin/ النصي بـadminGate + تحصين كل فحوصات super_admin النصية خارج الكتلة بـisMainSA (مستخدم مكتب يحمل super_admin بالخطأ يُرفض). /admin/tenants GET lookup مفتوح لنطاق الإدارة. office-verifications تسمح لموظف إدارة مخوّل (offices). page.js: admin_staff يركّب AdminApp. shell.js: فلترة الأقسام حسب /admin/staff/me (all للرئيسي).
- lib/adminGeo.js (/admin/geo/*): geo_locations موحدة (5 مستويات: country→governorate→district→neighborhood→street) — parent إلزامي لكل مستوى، منع تكرار الاسم داخل نفس الأب (مسموح تحت أب مختلف)، ancestors denormalized (تحديث الاسم عند rename — ids ثابتة)، تعطيل بدل حذف (يعطل التوابع)، نقل بسبب+صلاحية Move+تحديث سلسلة التوابع (رفض كسر التسلسل/الاسم المكرر/الأب المعطل)، usage best-effort (tenants/clients/suppliers/users/financial_entities/announcements عبر حقول geo.*_id المستقبلية)، الدمج معطل (Migration — نقطة قرار)، العناوين القديمة نصية بلا ربط (فجوة، لا Backfill). audit category: geo.
- lib/adminPayFin.js (/admin/payfin/*): payment_methods (7 أنواع، أعلام proof/ref/review/partial/refundable، رسوم fixed/percent + متحملها، نسخ clone معطلة، تعطيل بدل حذف). financial_entities (5 أنواع، ربط geo بالمعرفات+أسماء snapshot، فروع/هواتف/عملات/تعليمات/رسوم، approval_status: طلب إضافة أثناء العمل بدون Create → pending ثم Approve). receiving_accounts (مقنعة إلا بـpayments.manage — آخر 4 أرقام؛ افتراضي واحد لكل جهة+عملة). payment_orders: ref تسلسلي PMT-xxxxx (platform_settings.payment_order_seq $inc)، fx snapshot من tenant_settings.rates وقت الإنشاء، آلة حالات مفروضة (draft→awaiting_transfer→proof_uploaded→under_review→confirmed/rejected/cancelled→partially_refunded/refunded)، إثباتات payment_order_proofs (PNG/JPG/PDF ≤2MB + حوالة/مرجع/مرسل/مبلغ/تاريخ) — الرفع لا يؤكد، التأكيد Approve + Maker–Checker (المنشئ≠المؤكد عند وجود آخر) ويسجل financial_execution=pending_execution (صفر مساس بالأرصدة — مسار السند/القيد القائم نقطة قرار)، الاسترداد تعليم حالة فقط، الجزئي/الزائد نقطة قرار، حقول البطاقات/CVV/كلمات المرور مرفوضة regex من الخادم، رسوم منفصلة عن الأصل. فلاتر التقارير: طريقة/جهة/مكتب/حالة/عملة/فترة/مستخدم/إثبات/تنتظر مراجعة + overview لكل عملة. audit category: payments.
- lib/adminRefData.js (/admin/refdata/*): سجل ثلاثي — managed (admin_ref_lists مجموعة واحدة، مستند لكل قائمة: cancellation_reasons/refund_reasons/rejection_reasons/service_categories — إضافة/تعديل/تفعيل-تعطيل/بحث/ترتيب، لا حذف)، external (10 قوائم مربوطة بمراكزها: عملات/أسعار/طرق دفع/جهات/مواقع/قوائم نزاعات/إشعارات/قوالب مكاتب/أدوار إدارة/service_types لكل مكتب — لا تكرار)، locked (7 ثوابت كود بسبب معلن: عملات تشغيلية/أنواع سندات/قيود/حالات عمليات/آلتا حالات النزاعات وأوامر الدفع/كتالوج RBAC). Validation خادمي + صلاحيات refdata.*. audit category: refdata.
- الواجهات: app/admin/geo.js (5 تبويبات متسلسلة+breadcrumb+نقل+استخدام), payfin.js (4 تبويبات: طرق/جهات+حسابات/أوامر+إثباتات/نظرة), refdata.js (سجل+محرر قوائم+روابط فتح المراكز), staff.js (مديرون/أدوار/تدقيق+مصفوفة صلاحيات+Overrides+معاينة). أزرار الإضافة تظهر للمخول فقط (والخادم يفرض دائماً).
- Collections جديدة: geo_locations, payment_methods, financial_entities, receiving_accounts, payment_orders, payment_order_proofs, admin_ref_lists, admin_staff_roles + مستند platform_settings (payment_order_seq) + حقول users الجديدة لموظفي الإدارة فقط (admin_realm, admin_role_key, admin_overrides, admin_created_by/updated_by). لا Indexes، لا Migration، لا Seed، لا بيانات وهمية، لا مساس بالمستخدمين أو البيانات القائمة.

## v3.98 — Phase 1: دفتر شركة رحّال = الداشبورد المشترك نفسه (NOT TESTED بطلب المستخدم — تحقق API واحد فقط)
- إلغاء نهج Impersonation نهائياً بطلب المستخدم. حساب المشرف الرئيسي نفسه (admin@targetmedia.com) رُبط بـTenant «شركة رحّال» (id: dcae1c67، slug: rahaal-hq-154a، paid، quota 1M، is_platform_org: true) مع بقاء دوره super_admin (user.platform_org: true).
- «أقل تعديل مطلوب»: POST /admin/tenants يدعم link_owner_user_id (يربط SA قائماً بدل إجبار Owner جديد) — التحقق: super_admin فقط وغير مرتبط مسبقاً. الشجرة (COA v2 — 28 حساباً) والصناديق وservice_types بُذرت بآلية seedTenantDefaults القائمة نفسها.
- isMainSA/isMainAdmin: super_admin && (!tenant_id || platform_org===true) — الربط لا يفقده /admin/* ومستخدم مكتب بدور خاطئ يظل مرفوضاً. تحديث استعلامي adminStaff users وpayfin Maker-Checker.
- sanitizeUser: SA = ownerPermissions() أساساً + overrides صريحة — أعلام السفر السبعة false على وثيقة المستخدم (mod_tickets/visas/visa_monitor/services/packages/meraaj/query) تخفيها واجهةً (canModule القائمة). حواجز «للمالك فقط» القياسية وسّعت بـ!isMainSA (داخل نطاق دفتره فقط). canModule: settings متاحة للSA.
- page.js: platform SA يفتح TenantApp نفسه افتراضياً (لا نسخة) بعنوان شركة رحّال؛ زر «🛡️ إدارة المنصة» أسفل Sidebar يبدّل إلى AdminApp القائم (محفوظ كما هو كمرجع)، وزر «📒 العودة إلى حسابات شركة رحّال» في shell.js يعيد. تبديل عرض React فقط — جلسة واحدة، لا كوكيز ولا جلسات مؤقتة.
- لم يُربط أي شيء من الداشبورد الإداري الجديد بالدفتر (احتياط ومرجع). الملفات: route.js, lib/adminStaff.js, lib/adminPayFin.js, page.js, admin/shell.js. البيانات: tenant واحد جديد + تحديث وثيقة الأدمن (tenant_id, platform_org, permissions) — صفر Migration.

## v3.99 — الدفعة 1 من دمج Super Admin القديم داخل TenantApp (NOT TESTED بطلب المستخدم — تحقق ترجمة فقط)
- RahaalAdminHome (page.js، قبل SuperAdminPanel): محتوى تبويب «لوحة التحكم» للمشرف فقط — صفر عناصر سفر، مؤشرات من APIs القديمة الحية (/admin/tenants + password-reset-requests + installments-overview): إجمالي/نشطة/موقوفة/تجريبية/مدفوعة/تنتهي≤30ي/منتهية/مستخدمو المنصة (users_count مجموع)/آخر 5 مكاتب/تنبيهات إدارية (استعادة/أقساط متأخرة/موقوفة) + اختصارات. استبعاد is_platform_org من العد. مكاتب أخرى: Dashboard الأصلي بلا تغيير (فرع شرطي في سويتش TenantApp).
- SuperAdminPanel({embedded}): وضع مضمّن يخفي الرأس/بطاقات الإحصاء/صندوق الاستعادة (د2)/الأقساط (د4)/زر التسعير (د4)/AnnouncementsManager السفلي، ويخفي الأزرار الممنوعة: 🎭 دخول كـ، 💳 تأكيد دفع، + رصيد (top-up)، Power (PATCH status مكرر)، 🗑️ حذف — الأكواد باقية بلا حذف. أُبقي: تفعيل/تعليق (toggle-status)، تعديل (Settings→EditTenantDialog)، إنشاء مكتب. أُضيف بحث client-side (tq) وفلترة is_platform_org في embedded فقط.
- NAV: مجموعة «إدارة رحّال» (group header ذهبي في Sidebar عبر مصفوفة [groupHeader, button]) بعنصرين: platform-offices (SuperAdminPanel embedded) وplatform-ads (AnnouncementsManager كما هو — popup/banner/عنوان/نص/صورة/رابط/تفعيل/حذف). canModule: platform-* للمشرف فقط (فحص قبل اختصار المالك).
- فجوة موثقة: «العروض» ليست وظيفة مستقلة قديماً (الإعلانات popup/banner فقط) — لم يُنشأ نظام عروض. لوحة v3.91–97 لم تُمس ولم يُنقل منها شيء؛ زر «إدارة المنصة» باقٍ مؤقتاً.
- ملف واحد تغير: app/page.js. صفر تغيير بيانات/Collections/APIs. المتبقي للدفعات: د2 استعادة كلمات المرور+reset-password (+قرار Impersonate)، د3 —، د4 تأكيد الدفع/الأقساط/التسعير/plans/إصلاح top-up، د5 قرارات v3.91–97.

## v4.0 — الدفعة 2: استعادة الباقات والتسعير والاشتراكات داخل TenantApp (NOT TESTED بطلب المستخدم — تحقق ترجمة/HTTP 200 فقط)
- NAV «إدارة رحّال» أصبح 4 عناصر: إدارة المكاتب | الباقات والتسعير (platform-plans → PricingConfigEditor asScreen) | الاشتراكات والأقساط (platform-subs → PlatformSubscriptionsScreen) | الإعلانات والعروض.
- PricingConfigDialog القديم (v3.14) استُخرج إلى PricingConfigEditor واحد (يعمل حواراً وشاشة — صفر ازدواجية). حقول جديدة لكل باقة: description, currency (افتراضي USD), duration_days (365), quota_limit (0=يدوي), unlimited_journals, active, sort_order + على مستوى الإعدادات: offer_start_at/offer_end_at (نافذة العرض), default_trial_plan_key (حدودها تسري على التسجيلات الجديدة). معاينة حية بالتفصيل الكامل: أساسي/نسبة/قيمة الخصم/نهائي. القيم القديمة (500/1000/2000، خصم 50%) بقيت افتراضيات قابلة للتعديل — لا تثبيت في الكود.
- سجل تدقيق: كل PUT /admin/pricing-config يكتب diff حقلاً-بحقل (المنفذ/الوقت/من→إلى) في وثيقة pricing_config_history داخل platform_settings نفسها ($slice -100) — لا Collection جديدة. GET /admin/pricing-config/history. عرضه في شاشة الباقات.
- GET /pricing (المشتركون): فلترة active!==false + ترتيب sort_order + نافذة العرض تعطل الخصم خارجها + currency وdiscount_value في الرد. PricingPlans تعرض العملة/الوصف/المدة/«وفّرت X».
- PATCH /admin/tenants/:id: حارس خفض الحدود (409 إذا max_users الجديد < عدد المستخدمين الفعلي، و409 إذا quota_limit الجديد < used) — لا حذف تلقائياً؛ إسناد plan_key يطبق أيضاً quota_limit وunlimited_journals من الباقة؛ top_up_amount مرفوض نهائياً (مسار واحد).
- POST /topup = «زيادة حصة القيود» الموحد: سبب إلزامي، سجل واحد في journal_quota.top_ups (أُلغي wallet.topups)، رد تفصيلي prev/new/used/remaining. QuotaIncreaseDialog جديد (الحصة/المستخدم/المتبقي/المقدار/السبب) يستخدمه SuperAdminPanel (بدل زر «رصيد» القديم) وشاشة الاشتراكات.
- شاشة الاشتراكات والأقساط: Demo→Paid (confirm-payment القديم)، InstallmentsDialog القديم نفسه، فتح/إغلاق القيود، زيادة الحصة، EditTenantDialog (Override لكل مكتب). بطاقات: مكاتب/تجريبي/مدفوع/أقساط متأخرة.
- التسجيل العام يطبق default_trial_plan_key إن وُجد (وإلا 2/1/30 القديمة). التغييرات غير رجعية على الاشتراكات القائمة.
- الاستثناءان: DELETE النهائي وImpersonate باقيان مخفيين (أكوادهما لم تُمس). فجوة موثقة: max_branches بلا كيان تشغيلي للفرض (لا collection فروع). الملفات: route.js + page.js فقط. صفر Migration/Backfill.

## v4.0.1 + v4.1 — إقفال مراجعة v4.0 + نقل 4 أقسام من اللوحة الجديدة (NOT TESTED بطلب المستخدم — ترجمة/HTTP 200 فقط)
### v4.0.1 إقفال:
- isUnlimitedTenant: أُزيل شرط billing_mode==='annual' القديم (كان يفتح القيود فور الاختيار قبل أي دفع). الفتح الآن حصراً: unlimited_journals يدوي || subscription='paid' || activation_confirmed. PATCH لم يعد يفتح/يغلق القيود تلقائياً مع billing_mode. إسناد الباقة لم يعد يمنح unlimited — امتياز الباقة يُمنح داخل confirm-payment فقط. confirm-payment: 409 عند التكرار (idempotent).
- POST /tenant/users: أُزيلت بوابة Gold-only (v2.8) — الإنشاء الذاتي لكل الباقات، والحارس الوحيد max_users من الخادم (يشمل المالك في العد، 9999=∞، القيمة من الأدمن).
- topup: op_id idempotency (إعادة الإرسال ترجع duplicate:true بلا زيادة ثانية) + السجل يدون prev_limit/new_limit/amount/by/note/date. الواجهة ترسل op_id لكل جلسة حوار.
- وسم «⚠️ غير مفعل تشغيلياً» بجانب حد الفروع في محرر الباقات وحواري إنشاء/تعديل المكتب. لا كيان فروع — فجوة مستقبلية.
- Snapshot تاريخي للبيع: غير موجود (موثق بصدق) — الحقول الناقصة: اسم الباقة وقت البيع/الأساسي/العملة/نسبة وقيمة الخصم/النهائي/عدد الأقساط/البداية والنهاية/الحدود المطبقة. الحماية الحالية: القيم تُنسخ (لا تُعاد قراءتها من pricing_config) فالتعديل غير رجعي فعلياً، لكن لا توثيق تعاقدي.
- Super Control بصدق: تعديل الباقات الثلاث الثابتة فقط (silver/gold/enterprise) — لا إضافة باقة جديدة (فلتر PUT يمنع مفاتيح أخرى). لا حذف نهائي للباقة — تعطيل فقط. ليس CRUD كاملاً.
### v4.1 نقل (Move-only):
- 4 أقسام نُقلت كما هي من admin shell إلى «إدارة رحّال»: platform-users (AdminStaffCenter v3.97 — مديرو إدارة رحّال)، platform-roles (AdminPermsCenter v3.93)، platform-sales (AdminSalesCenter v3.93 initialTab=sales)، platform-commissions (AdminCommissionsCenter v3.94). استيراد مباشر في page.js + NAV + tab render + أيقونة Percent. صفر مكونات/APIs/Collections جديدة. canModule يقصر platform-* على super_admin، وadminGate يفرض في الخادم. الأقسام تحتفظ بطبيعتها الأصلية (sales/commissions شبه Read-Only حسب حوكمة v3.93/94) — تشغيلها الكامل CRUD دفعة قادمة بموافقة. أمثلة TEST- لم تُنشأ (التعليمة النهائية: نقل فقط). الشل خلف «إدارة المنصة» بقي كما هو.

## v4.2 — إقفال الأقسام الأربعة وظيفياً (أمثلة تشغيلية حقيقية على Preview — لا Browser QA بطلب المستخدم)
- adminStaff.js: أُضيفت edit_profile (اسم/هاتف/مسمى/قسم) + reset_password (توليد 10 أحرف + إنهاء الجلسات) + terminate_sessions + حارس آخر Super Admin نشط (409). كلها بسبب إلزامي وAudit (audit_logs/admin_staff). واجهة staff.js: 3 أزرار جديدة 📝🔑🚪.
- adminPerms.js: PATCH /admin/perms/users/:id أصبح تشغيلياً — assign_role (يجسد صلاحيات القالب في user.permissions/role_key = فرض فعلي في كل APIs المكاتب) + override (منح/منع/إزالة مفتاح واحد). حراس: لا owner/SA/admin_realm، لا Self-Lockout (target==self مرفوض)، سبب إلزامي، Audit (permissions). واجهة perms.js: شارة «تشغيلي v4.2» + زرا 🎭 إسناد و⚙️ Override.
- route.js: /admin/commission-rules GET/PUT — تخزين في platform_settings (id=commission_rules، ليست Collection جديدة)، منع تداخل قاعدتين نشطتين (409 مُثبت عملياً)، Audit (commissions) بسبب إلزامي.
- page.js: platform-sales لم يعد AdminSalesCenter السفري (غير مناسب بقرار المستخدم) → ProgramSalesScreen: مبيعات برنامج رحّال فوق البيانات القائمة فقط (tenants+pricing+installments): حالات مشتقة (بانتظار الدفع/دفع جزئي/مدفوع-مفعل/تجريبي)، تسعير مرجعي بالخصم، مدفوع/متبقٍ من الأقساط، فلاتر+CSV، مسودة/تعديل=EditTenantDialog، اعتماد البيع=confirm-payment، الأقساط=InstallmentsDialog. platform-commissions = CommissionRulesManager (تشغيلي) + AdminCommissionsCenter (عرض المصادر السفرية كما هو).
- أمثلة TEST- مُنشأة عبر API الطبيعي (منفذة وموثقة): مدير TEST (id 484004ac) عُدل ثم أُعيد تعيين كلمته ثم عُطل، دور TEST-دور تجريبي (custom_eea85b7b)، مكتب TEST-مكتب تجريبي للبيع (58fc343f) بمسودة بيع Silver: 500→خصم50%→سعر مسجل 250$ سنوي «بانتظار الدفع» (لم يُعتمد عمداً — لا ربط سندات بعد)، قاعدة TEST-عمولة مسوق 10% على silver، وإثبات رفض التداخل 409 وIdempotency للزيادة (TEST-OP-1 duplicate:true).
- معلق بانتظار موافقة صريحة (Collections جديدة): platform_sales (مسودات بيع بجدول حالات كامل+Timeline)، platform_commissions (سجل عمولات مالي: استحقاق/اعتماد/دفع/عكس — عمولة 25$ التجريبية محجوبة بهذا)، marketers (حسابات مسوقين). الإلغاء/الاسترداد المالي للبيع غير متاح (لا ربط voucher بالاعتماد — فجوة موثقة). كلمة مرور TEST staff الحالية: ThzmQJbGDX (معطل).

## v4.3 — القرار المعماري + المجموعة الثالثة (مُثبت بأمثلة API حقيقية — لا Browser QA بطلب المستخدم)
### القرار المعماري المنفذ:
- لا platform_sales: المبيعات أنواع طلبات داخل platform_orders الموحدة الجديدة (لا يوجد أي Collection طلبات موحد قائم — فُحص: payment_orders دفعات فقط، adminRequests تجميع قراءة للمتخصصة). «مبيعات رحّال» تعرض category=sales من المصدر نفسه (OrdersScreen salesOnly) بلا نسخة ثانية.
- platform_commissions أُنشئت (الشرط تحقق: لا مصدر قائم لعمولات البرنامج): مرتبطة إلزامياً بطلب platform_orders + Snapshot كامل (الطلب/المكتب/المستفيد/القاعدة/النوع/القيمة/الأساس/المبلغ/العملة/الحالة/المنفذ/التواريخ/voucher_id وje فارغان حتى الربط) + Unique Index {order_id, rule_id, beneficiary_key}.
- لا marketers: المستفيد = مستخدم/موظف/مكتب قائم (beneficiary_key). مثال 25$ رُبط بـtest-staff@rahaal.test.
### الملفات: /app/lib/adminOrders.js (جديد — orders + ledger handlers)، adminNotify.js (أنواع order_new/order_event/manual_admin + POST /create يدوي + action assign)، route.js (تركيبان + إصلاح سطر شرط commissions حُذف سهواً وأُعيد)، page.js (OrdersScreen+OrderCreateDialog+CommissionsLedger + NAV: platform-orders/platform-notify + إعادة تسمية platform-users إلى «مديرو رحّال» + دمج salesOnly في تبويب المبيعات + AdminNotifyCenter/AdminRequestsCenter منقولان كما هما).
### دورة الطلب: new→under_review/needs_info/awaiting_payment/awaiting_approval→approved→executed→completed | rejected/cancelled→reopen | أرشفة للمغلقة فقط. مرجع موحد ORD-YYYY-#### (عداد في platform_settings). Idempotency بop_id (unique sparse). Maker–Checker: منشئ الطلب المالي لا يعتمده (استثناء وحيد: السوبر أدمن الرئيسي). لا DELETE إطلاقاً. Timeline أحداث مضمنة + Audit (category orders).
### دورة العمولة: pending→due→approved→(pay محجوب 409 حتى ربط سند الصرف)→reversed | hold/reject/cancel. المعتمد/المدفوع لا يُعدل — عكس موثق فقط.
### أمثلة v4.3 المنفذة (Preview): ORD-2026-0001 بيع سيلفر 250$ للمكتب TEST (58fc343f) — duplicate:true على TEST-SALE-1 — اعتُمد؛ عمولة f62c9b8e = 25$ من قاعدة 10% (أساس 250) — التكرار مُنع بالفهرس — دورة hold→approve→pay(409)→reversed كاملة؛ ORD-2026-0002 طلب ترقية جولد high؛ تنبيه TEST-اشتراك قريب الانتهاء (dedupe TEST-EXP-1 أثبت duplicate) + تنبيهات تلقائية (order_new/order_event/commission_event) + assign/read/handled نجحت.
### فجوات معلقة: دفع العمولة وربط سند الصرف/القيد (بانتظار اعتماد الربط المالي)، 2FA غير موجود بالنظام (موثق)، last_login غير متتبع، الطلبات المتخصصة القديمة تبقى بدوراتها الأصلية (معروضة موحدة تحت مركز الطلبات).

## v4.4 — تصحيح النطاق: توحيد المداخل الإدارية فقط (لا مساس بالمالية/المكتمل) — Preview فقط، لا Browser QA
- HubTabs مكوّن تغليف بسيط (تبويبات) يعيد استخدام المكونات القائمة كما هي — صفر نسخ/محركات.
- «إدارة المكاتب» (platform-offices) = PlatformOfficesHub: 🏢 المكاتب (SuperAdminPanel embedded كما هو) | ✅ توثيق المكاتب (OfficeVerificationsPanel جديد فوق API القائم — أصلحنا معه سقوط 404 التاريخي: مسارات /admin/office-verifications كانت كوداً ميتاً منذ v3.97 لأن كتلة الأدمن ترجع 404 قبلها؛ الحل: استثناء fall-through) | 🔍 Office 360° (OfficesSection من الشل). التوثيق لم يعد مدخلاً مستقلاً.
- «المستخدمون والصلاحيات» (platform-people الجديد يستبدل platform-users + platform-roles): 👑 مديرو رحّال (AdminStaffCenter) | 🛡️ الأدوار والصلاحيات ومستخدمو المنصة (AdminPermsCenter) | 🔑 طلبات استعادة كلمة المرور (ResetRequestsPanel جديد يعيد استخدام API القائم + AdminResetPasswordDialog القائم — البطاقة القديمة كانت مخفية في embedded أصلاً). 2FA غير موجود بالنظام (موثق).
- «إعدادات النظام» (platform-system جديد) = PlatformSystemHub: ⚙️ عام وصيانة وبيئة (AdminSystemCenter) | 💾 النسخ الاحتياطي (AdminBackupCenter) | 🕵️ Audit & Security (AdminAuditCenter) | ❤️ System Health (AdminHealthCenter) | 💱 العملات وأسعار الصرف (AdminCurrencyCenter). التنبيهات بقيت قسماً مستقلاً كما أُمر.
- «المواقع الجغرافية» (platform-geo جديد) = AdminGeoCenter كما هو: دولة←محافظة←مديرية←حي←شارع (GEO_LEVELS في lib/adminGeo) بعرض/بحث/إضافة/تعديل/تفعيل-تعطيل/أب/منع تكرار/Audit — الحذف تعطيل.
- «الصناديق والبنوك» (tab boxes): للسوبر أدمن فقط BoxesBanksHub = تبويب أول «الصناديق والحسابات» بالمكوّن الأصلي BoxesScreen حرفياً دون أي تعديل + تبويب «طرق الدفع والجهات المالية وحسابات الاستلام» (AdminPayFinCenter القائم: methods/entities/orders/overview فوق payment_methods/financial_entities). مستخدمو المكاتب يرون BoxesScreen مباشرة كما كان — صفر تغيير عليهم.
- Sidebar: أُزيل مدخلا «مديرو رحّال» و«الأدوار والصلاحيات» (صارا تبويبات داخل المستخدمين والصلاحيات) — لا شيء آخر أُزيل. المالية والتشغيلية (مبيعات/طلبات/عمولات/تنبيهات/إعلانات/باقات/اشتراكات) بلا أي مساس. التقارير لم تُمس.
- ملفات: page.js فقط + route.js (سطر fall-through واحد). صفر حذف Components/APIs/بيانات. مسار قرار التوثيق: POST /admin/office-verifications/:tenantId/decision {decision: verified|rejected, reason} — الرفض بسبب إلزامي.

## v4.4.1 — تصحيح نهائي: نقل «العملات وأسعار الصرف»
- AdminCurrencyCenter انتقل من PlatformSystemHub (إعدادات النظام) إلى BoxesBanksHub («الصناديق والبنوك») كتبويب مستقل بالترتيب: الصناديق والحسابات البنكية (BoxesScreen الأصلي) ← العملات وأسعار الصرف ← طرق الدفع والجهات المالية وحسابات الاستلام. لم يعد يظهر في إعدادات النظام. «حركة العملات» (المصارفة الفعلية) لم تُمس. نفس المكوّن/APIs/Collections — لا مصدر ثانٍ. ملف واحد: page.js.

## v4.5 — Accounting Core Hardening (Backend فقط — route.js وحده، +230/−25، صفر Frontend/Tests/Migration/بيانات)
- بوابة مركزية: enforceJournalInvariants داخل createJournalEntry — أسطر صالحة، لا سالب، حسابات موجودة Tenant-scoped، لا ترحيل على مجموعة (إعادة استخدام validateJournalLines)، لا ترحيل على حساب غير نشط (توافق inactive/is_active/active/archived — توحيد التخزين يحتاج Migration مؤجل)، حارس السنة/الفترة المقفلة مركزياً (assertOpenPeriod)، توازن بالعملة الأساس (يحفظ منطق FX/manual_dual — tolerance متدرج max(0.05, lines×0.01)).
- Idempotency عام: opts.idempotencyKey في البوابة (فحص Code-level؛ Unique Index مؤجل يحتاج فحص Duplicates بالإنتاج). Actor/Source: opts.actor/source للقيود الجديدة (يدوي/تعديل/FX مربوطة sess.user.email) — التاريخي بلا Backfill.
- أولوية 13: assertJournalQuota + assertOpenPeriod يُنفذان مبكراً في createManualJournal وcreateFx قبل أي أثر على الأرصدة (fail-fast).
- أولوية 6: PUT /journal-entries/:id — حارس فترة على تاريخ الأصل والجديد قبل أي تدمير، وعند فشل إعادة الإنشاء: استرجاع كامل للأصل وأرصدته (applyManualJournalEffects الجديدة = عكس reverseManualJournalEffects) + je_audit (edit / edit_failed_restored) + deleteOne صار Tenant-scoped (كان بلا tenant_id).
- أولوية 7/13: DELETE JE — حارس سنة/فترة مقفلة + إصلاح عطل مؤكد: عكس أرصدة manual_dual كان يضرب عملة 'MULTI' الوهمية بدل عملة السطر (l.currency || je.currency).
- أولوية 2: مسارا التجاوز المباشران (opening insertOne + opening-equity-close) صار فيهما assertOpenPeriod (كانا بلا فحص closed_years).
- أولويات 3+4: PUT/DELETE الحسابات — ENGINE_ACCOUNT_CODES (كل قيم COA) محمية هيكلياً وحذفاً حتى بلا is_system وقبل أول استخدام؛ الحساب المستخدم في journal_entries يُمنع تغيير type/parent/is_group له (الاسم والملاحظات مسموحة)؛ تحقق الأب الجديد (موجود+مجموعة+ليس نفسه) وenum النوع؛ منع group→leaf مع وجود أبناء.
- بلا تغيير: generateSubAccountCode (سليم)، partyLeafCode (صارم أصلاً)، COA migration functions (لم تُلمس)، Decimal128 (DEFERRED — REQUIRES DATA MIGRATION)، Immutable Journal+Reversal architecture (DEFERRED ARCHITECTURAL HARDENING).
- مخاطر متبقية موثقة: مسارات تعديل المعاملات (تذاكر/سندات) تعكس الآثار قبل البوابة — رمي مركزي متأخر نظرياً ممكن (الاحتمال شبه معدوم لأن أسطر المحرك مبنية صحيحة)؛ فروقات أرصدة تاريخية محتملة من عطل MULTI القديم (تحتاج Reconciliation بموافقة).

## v4.6 — RAH-ACC Final Audit & Fixes (Backend فقط — route.js وحده، +127/−81، صفر Frontend/Tests/Migration/بيانات/GitHub)
- CRITICAL: createVisa كان يستخدم partnerLeaf غير معرّف (ReferenceError) — أي تأشيرة بعمولة شريك كانت تنهار بعد كتابة الوثيقة والأرصدة (حالة جزئية بلا قيد). أُصلح بتعريف partnerLeaf قبل أول كتابة (F-007 STRICT).
- CRITICAL: تعديل حجز الباكج (PATCH full-recalc) كان يعكس الأرصدة ويحذف القيد القديم قبل التحققات (transport/client/box/leaf) — أي early-return كان يترك حالة جزئية دائمة. أُعيدت الهيكلة: كل التحققات + بناء القيد الجديد + Dry-Run عبر enforceJournalInvariants أولاً، ثم الخطوات التدميرية مجمعة في النهاية (date=jeDatePB).
- حُرّاس السنة/الفترة المقفلة أُضيفوا للمسارات الالتفافية: DELETE الموحد (tickets/visas/services/vouchers/fx)، bulk-delete (لكل صف)، PUT الموحد (الجهة الأصلية)، bulk-edit (لكل صف)، حذف حجز الباكج، وتعديله — نفس قاعدة v4.5 للقيود اليدوية.
- استبدال فحص الفترة المحلي المعيب (مقارنة نصية تفوّت اليوم الحدّي مع تاريخ+وقت) في createTicket/createVisa/createService بالحارس المركزي assertOpenPeriod + إضافة الحارس لأول مرة إلى createVoucher (كان بلا أي فحص فترة قبل الكتابة) + preflight للحصة assertJournalQuota في الأربعة (لا حالة جزئية عند 402).
- updateBalance: حارس مانع تلف — رفض NaN/Infinity ورفض عملة مفقودة (كان $inc NaN يفسد الرصيد نهائياً) + تخطي delta=0.
- إقفال السنة: idempotencyKey لكل سنة+عملة (year_close:YYYY:CCY) — إعادة المحاولة بعد فشل جزئي متعدد العملات لا تكرر قيود الإقفال؛ reopen يحذف القيود فيبدأ الإقفال التالي نظيفاً. + توحيد فحص النشاط isInactiveAccount في Preflight.
- القيد الافتتاحي: منع الرصيد الافتتاحي الجديد على حساب معطل (نفس قاعدة البوابة).
- Tenant-scoping: 6 مواضع deleteOne للقيود صارت مقيدة بـ tenant_id + عدّاد journal_quota.used لا ينزل تحت الصفر (3 مواضع).
- BLOCKED (يحتاج موافقة/Migration): توحيد تخزين أعلام inactive/is_active، Unique Index للـ idempotency_key بالقاعدة. DEFERRED (معماري): Decimal128، Immutable/Append-only Ledger، معاملات Mongo الذرية.

## v4.8 — PR#18 Blockers (Backend فقط: route.js + lib/adminOrders.js + lib/adminStaff.js — صفر UI/بيانات/Indexes منفذة/GitHub)
- PR#18-1: createManualJournal (الوضعان single/dual) — Dry-Run كامل للبوابة المركزية enforceJournalInvariants على الأسطر النهائية قبل أي updateBalance (رفض الحساب غير النشط لم يعد يترك رصيداً بلا قيد) + تتبع كل أثر رصيد للمحاولة (applyTracked) وتعويض عكسي مرة واحدة فقط عند فشل متبقٍ (سباق حقيقي) بلا Double Reversal + رسالة صريحة عند تعذر اكتمال التعويض. مسار PUT /journal-entries/:id: الاسترجاع (إعادة القيد القديم + أثره) داخل try/catch — فشل الاسترجاع لا يُبلغ أبداً كنجاح (500 + je_audit: edit_failed_restore_failed).
- PR#18-2: /admin/orders و /admin/commissions-ledger كانتا تسقطان في fallback قسم offices (موظف مدير المكاتب كان يستطيع الكتابة). رُبطتا بقسمي requests وcommissions في ROUTE_SECTIONS + توسيع كتالوج الإجراءات (requests: view/create/edit/approve/manage، commissions: +create/approve/manage) + فرض خادمي لكل إجراء داخل المعالجات عبر adminCan (orders: update_draft/assign/add_note/set_status=edit، approve/reject=approve، cancel/execute/complete/reopen/archive=manage؛ commissions: approve=approve والبقية=manage). Maker–Checker وصلاحيات الـ SA الكاملة بلا تغيير، ولا تعديل تلقائي لأدوار أو بيانات مستخدمين (offices_manager يبقى requests:view فقط).
- PR#18-3: ensureIndexes في lib/adminOrders.js لم يعد يبتلع الفشل كـ"race" — يعيد {ok,error} ويسجل خطأً صريحاً؛ POST (إدراج) في الطلبات والعمولات يُرفض 503 إذا لم تثبت حماية Unique Index، والقراءة وPATCH متاحة (لا تعتمد على التفرد). لا إنشاء/تعديل فهارس نُفذ خلال المهمة (لم يُستدع أي معالج). معالجة تكرارات قائمة إن وجدت: BLOCKED — REQUIRES APPROVAL.
- v4.7 (تجميع سايدبار SA): موجودة في مساحة العمل (page.js سطر 2482) — لم تُعد ولم تُحفظ إلى GitHub.
- الدمج إلى main موقوف بانتظار مراجعة المستخدم وموافقته الصريحة.

## v4.8.1 — PR#18 النقطتان المتبقيتان (route.js فقط، +65/−4، NOT TESTED — الفحص ممنوع بأمر المستخدم)
- (1) createJournalEntry بمراحل كتابة صريحة: Phase A (حفظ القيد) — فشل insert يُتحقق منه من المجموعة: غير محفوظ=pre_commit (يجوز التعويض)، تعذر التحقق=commit_uncertain (يُمنع التعويض)، محفوظ رغم الخطأ=يُكمل كملتزَم. Phase B (عدّاد الحصة) — فشل العدّاد بعد الحفظ لا يُعامل كفشل إدراج أبداً (لا throw) ولا يُخفى: console.error + je_audit(quota_increment_failed) + علم quota_counter_failed على القيد المعاد.
- (2) createManualJournal يعيد حالة صريحة للمستدعي: unsafe_state='uncertain' (لا تعويض إطلاقاً) أو 'partial' (فشل اكتمال التعويض) + no_retry. مسار PUT /journal-entries/:id يعالجها صراحةً: لا edit_failed_restored ولا إعلان استعادة؛ في partial يعاد إدراج مستند القيد الأصلي فقط (بلا إعادة تطبيق أرصدته — لتفادي العد المزدوج) وفي uncertain لا إدراج (القيد الجديد قد يكون محفوظاً بنفس الـid)؛ تدقيق je_audit(edit_failed_unsafe_state مع balances_need_manual_review) + إرجاع 500 وتحذير صريح بعدم إعادة المحاولة.
- الدمج إلى main يبقى موقوفاً بانتظار المراجعة والموافقة الصريحة. لا GitHub/Deploy.

## v4.8.2 — PR#18 النقطة الأخيرة (route.js فقط، +18/−1، NOT TESTED)
- POST /journal-entries: عند result.unsafe_state لم يعد bad() يُسقط الحالة — استجابة HTTP 500 عبر cors(NextResponse.json) تتضمن unsafe_state وno_retry:true وتحذيراً صريحاً (لا إعادة محاولة؛ فحص يدوي للقيد والأرصدة) + تسجيل je_audit(create_failed_unsafe_state) بالـ tenant والمنفذ ونوع الحالة وتفاصيل الخطأ. الأخطاء العادية قبل الكتابة بقيت bad(400) كما هي. لا تعويض إضافي، لا إعادة محاولة تلقائية، مسار PUT لم يُمس.
- الحفظ إلى فرع PR#18 يتم حصراً عبر زر «Save to GitHub» من المستخدم (الوكيل لا ينفذ أي عملية git كتابية). لا Merge/Deploy.

## v4.9 — TenantApp هو الداشبورد المعتمد الوحيد + إزالة AdminApp المنفصل (NOT TESTED)
- السبب الجذري لظهور AdminApp على Test: fallback في App root كان يوجه super_admin بلا tenant_id (وadmin_staff دائماً) إلى AdminApp المنفصل + زر «إدارة المنصة» وswitcher platformView.
- أُزيل: import shell، زر إدارة المنصة، platformView state، prop onOpenPlatform (Sidebar+TenantApp)، وكتلة fallback بالكامل. حُذف app/admin/shell.js (مستورد من page.js فقط — تم فحص الاعتمادات).
- أُبقي: كل مكونات app/admin المستخدمة في تبويبات TenantApp (staff/perms/sales/commissions/notifications/requests/offices/system/audit/backup/health/currency/geo/payfin) + SuperAdminPanel (embedded في platform-offices) + AnnouncementsManager (platform-ads) + جميع /api/admin/* والصلاحيات. ملفات يتيمة أُبقيت عمداً كوظائف قابلة للربط لاحقاً (لا تدخل الحزمة): dashboard/accounting/ads/reports/disputes/refdata.
- الجديد: حساب منصة (super_admin/admin_staff) بلا tenant_id يرى شاشة إيقاف صريحة AdminBindingRequiredNotice — لا لوحة بديلة، لا إنشاء/ربط تلقائي؛ الربط اليدوي (tenant_id على وثيقة المستخدم) يتطلب موافقة. canModule: platform-* صارت تشمل admin_staff (UI فقط، الخادم يفرض adminGate/adminCan).
- Git: لا وصول للريموت من البيئة (git ls-remote فشل) — التحقق من دمج PR#18 وأحدث main تعذر من هنا؛ الحفظ لفرع جديد يتم حصراً عبر زر Save to GitHub من المستخدم. لا Merge/Deploy.

## v5.0 — فروع باقة Enterprise (إضافي وIdempotent — Test فقط، Gold/Silver بلا مساس)
- Collection جديدة `branches` (id, tenant_id, name, code, phone, address, notes, status active|suspended, created/updated at/by) + فهرسان idempotent: فريد {tenant_id,name} و{tenant_id,status} (فشل الفهرس لا يُبتلع — POST يُرفض 503).
- حقل اختياري جديد users.branch_id (null = المركز الرئيسي) — لا تعديل تلقائي لأي مستخدم قائم.
- APIs جديدة خلف adminGate (قسم offices): GET/POST /admin/tenants/:id/branches، PUT/PATCH(activate|suspend) /admin/tenants/:id/branches/:bid، PATCH /admin/tenants/:id/users/:uid/branch — الإنشاء enterprise-only، الربط tenant-scoped (يستحيل ربط عابر للمكاتب)، الفرع الموقوف لا يقبل ربطاً جديداً.
- دلالة غير محدود: null/undefined/0 القديمة = غير محدود (لا صفر ولا حد ثابت)؛ تعيين الباقات لم يعد يحول 0→9999 بل null (سطرا التعيين + بوابة /tenant/users). Gold/Silver (2/1 و8/3) كما هي حرفياً. لا تعديل على وثائق plans/tenants القائمة.
- UI: تبويب «الفروع» في Office 360 (offices.js) بزر «➕ إضافة فرع» + تعديل + تفعيل/إيقاف + ربط المستخدمين بالفروع؛ لغير الإنتربرايز تظهر رسالة توضيحية فقط. عرض ∞ للحدود غير المحدودة.
- لا منطق محاسبي/توحيد فروع في هذه المهمة (بأمر صريح — يُختبر لاحقاً). Compile ✓ (1459 modules). لا Deploy/Live.

## v5.2 — Subscription Accounting Integration (9-point plan COMPLETE)
- Backend: subscription-activate = THE ONLY Trial→Paid gate (office client account under 1103 in Rahaal book by office_id, sale journal Dr office/Cr 4106 «مبيعات اشتراكات رحّال» at final discounted price, referral bonus moved here once-only, activation_confirmed stamped). Legacy confirm-payment RETIRED (410). PATCH guard blocks manual subscription='paid'. isPaidTenant (features) split from isUnlimitedTenant (journal quota — installments offices are quota-based until last installment). GET /admin/tenants/:id/office-statement reuses reportStatement.
- Frontend: ActivateSubscriptionDialog (SSOT pricing display, editable account name, parent 1103 read-only, op_id idempotency) replaced ALL 3 confirm-payment buttons. InstallmentsDialog quota-based + box/bank required. Office 360: statement tab + owner WhatsApp/Call buttons. TenantApp Settings: owner branches tab (/tenant/branches, backend-driven limits).
- Old installment offices left untouched (no bulk quota raise, no auto-unlimited). No migrations/backfills.
- NEXT: user QA; then separate extended Enterprise branch-accounting QA (user-led; no design assumptions).
