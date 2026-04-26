# 🗺 Roadmap

מסלול הפיתוח של המערכת — מה הושלם, מה בעבודה, ומה מתוכנן.

🔗 כל פיצ'ר פתוח קיים גם כ-**[GitHub Issue](https://github.com/yakiradler/adler-family-tree/issues)**.

---

## ✅ Done (Phase A → F)

### Phase A — בסיס (גרעין)
- [x] Vite + React 19 + TypeScript + Tailwind
- [x] HashRouter + RBAC scaffolding
- [x] Supabase client + auth flow
- [x] Member type + Relationship type
- [x] Tree layout v1 (classic mode)
- [x] Hebrew/English i18n + RTL

### Phase B — בני זוג
- [x] `SpouseStatus = current | ex | deceased`
- [x] רינדור גרושים/נפטרים כצמתים משניים מתחת לחבר
- [x] טוגל "💔 הצג גרושים" בפילטר

### Phase C — Onboarding
- [x] OnboardingWizard 4 שלבים
- [x] טופס פרטים אישיים מלא (כולל שם נעורים, lineage, phone)
- [x] AccessRequest מוגש לאדמין
- [x] באנר "השלם פרופיל" ב-Dashboard (לא חוסם)

### Phase D — RBAC + ניהול
- [x] 4 תפקידים: guest / user / master / admin
- [x] `master_permissions` (granular flags)
- [x] AdminDashboard עם 7 טאבים: סקירה, משתמשים, חברים, בקשות עריכה, בקשות גישה, הזמנות, מערכת
- [x] בקשות עריכה (peer-review queue)
- [x] קודי הזמנה (`tree_invites`) עם expiry + uses_left

### Phase E — Tier 1 (ייחוס הלכתי)
- [x] רק זכרים יורשים כהן/לוי
- [x] בנות = "בת כהן" (תג שונה בכרטיס בלבד)
- [x] כלל אוטומטי: זכר אדלר עם הורה אדלר → "אדלר (כהנא)"

### Phase E — Tier 2 (סינון מתקדם)
- [x] AdvancedFilter popover (lineage / divorces / deceased / search / focus)
- [x] applyTreeFilters pipeline לפני ה-layout
- [x] focusMember (אבות + צאצאים + בני זוג)

### Phase E — Tier 3 (Landing)
- [x] עמוד שיווק עם backdrop SVG מונפש (3 דורות)
- [x] CTA "התחל עכשיו" → `/login?signup=1`
- [x] 6 כרטיסי תכונות
- [x] QuickAccessMenu (👤 אזור אישי / 🌱 הרשמה / 🛠 מנהל)

### Phase E — Tier 4 (Admin Specials)
- [x] InviteCodeManager (alphabet without 0/O/1/I)
- [x] SpecialAdminControls — build version, env, refresh store, hard cache clear

### Phase E — Tier 5 (AI Scan)
- [x] AIScanModal עם 4 phases
- [x] Fallback chain: env URL → Supabase Edge → demo
- [x] **Conversational review** — בועות שיחה + מיקום per candidate (parent/child/spouse/sibling/standalone)
- [x] יצירת member + relationship במכה אחת

### Phase F — Tree UX
- [x] חיפוש שם standalone (TreeSearchModal)
- [x] פילטר ב-popover יותר בולט (top-[72px] מתחת ל-top bar)
- [x] זום ללא הגבלה `[0.05, 8]`
- [x] גוון צבע שונה לכל פריסה (LAYOUT_THEMES)
- [x] חיבור ילדים מהאם בברירת מחדל + override `connector_parent_id`
- [x] הסתרה ידנית של חבר מהעץ (`hidden`)
- [x] viewport נשמר בין renders (treeViewport ב-store)
- [x] Optimistic updates בכל ה-CRUD (סטטוס זוגי נשמר ב-demo mode)
- [x] Toast "נשמר" אחרי כל שינוי קשר

### Phase F — Multi-tree (תשתית)
- [x] `FamilyTree` type + טבלת `family_trees`
- [x] `Member.tree_id` (אופציונלי — null = עץ ראשי)
- [x] TreeSwitcher dropdown ב-TreePage top bar
- [x] עץ פעיל נשמר ב-localStorage

---

## 🚧 In Progress

(אין כרגע — ראה Issues ב-GitHub)

---

## 🌱 Planned (Phase G — Roadmap)

### עץ
- [ ] **Print / Export** PDF + PNG של העץ ([#issue](https://github.com/yakiradler/adler-family-tree/issues))
- [ ] **History timeline** — ציר זמן של אירועים משפחתיים (לידות, נישואין, פטירות, יום זיכרון)
- [ ] **Compare view** — תצוגה צד-בצד של 2 ענפים
- [ ] **Mini-map** בפינה — overview עם viewport indicator
- [ ] **Drag a member** to re-place in the tree (admin only)

### AI
- [ ] **Real Edge Function** ל-Vision (Anthropic / OpenAI / Gemini)
- [ ] **AI Story** — סיכום נרטיבי על אדם או על ענף
- [ ] **AI Suggest relationships** — מציע קשרים חסרים על בסיס שמות + תאריכים

### Multi-tree
- [ ] **Cross-tree marriage** — יצירת קשר spouse בין חברים מ-trees שונים
- [ ] **Tree-level RLS** — משתמש רואה רק עצים שהוא חבר בהם
- [ ] **Trees admin tab** — ניהול עצים (rename / delete / re-color)

### Social
- [ ] **Comments on members** — הערות / זיכרונות
- [ ] **Photo albums** per member (כבר יש photos[] — צריך UI טוב יותר)
- [ ] **Family stories** — אזור blog פנימי

### Mobile
- [ ] **PWA** — installable + offline cache
- [ ] **Push notifications** לימי הולדת + יום זיכרון

### Performance
- [ ] **Code splitting** — הקוד הנוכחי 800kB+ (חתוך לפי route)
- [ ] **React Compiler** — להפעיל באופן selective
- [ ] **Virtual scroll** ברשימות ארוכות (חברים, הזמנות)

---

## 🐛 Known Issues

ראה [open issues](https://github.com/yakiradler/adler-family-tree/issues?q=is%3Aissue+is%3Aopen+label%3Abug).

---

## 📊 Architecture Decisions

מתועד בנפרד ב-[ARCHITECTURE.md](./ARCHITECTURE.md). שינויים מהותיים נרשמים כ-ADR (Architecture Decision Record) ב-Issues עם label `decision`.
