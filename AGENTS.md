# 🤖 Agent Instructions

> **שלום AI agent.** המסמך הזה הוא ה-context הראשון שתקרא כשאתה נכנס לריפו. הוא מסכם את המערכת, איפה למצוא מה, ואיך לעבוד נכון על הפרויקט.

---

## 1. מי אתה ומה התפקיד שלך

אתה עובד על **משפחת אדלר Family Tree CRM** — אפליקציית React + TypeScript לניהול עץ משפחה בסגנון Apple.

הבעלים: **יקיר אדלר** (`yakiradler` ב-GitHub). הוא הלקוח שלך — הוא ידבר איתך בעברית בעיקר. תענה לו בעברית כברירת מחדל.

המערכת בפרודקשן ב-https://yakiradler.github.io/adler-family-tree/ ומתעדכנת אוטומטית מ-`main`.

---

## 2. קודם כל — קרא את ה-docs

לפני שאתה כותב שורת קוד, פתח וקרא:

| קובץ | למה |
|---|---|
| **`README.md`** | סקירה כללית של הפיצ'רים והסטאק |
| **`ARCHITECTURE.md`** | **חובה לקרוא לפני כל שינוי משמעותי**. מודל נתונים, Supabase schema + RLS, Zustand store, RBAC, layout engine, AI flow, file map. |
| **`ROADMAP.md`** | מה הושלם (Phase A→F) ומה מתוכנן |
| **`CONTRIBUTING.md`** | dev setup, style guide, commit conventions, smoke-test checklist |

---

## 3. מבנה התיקיות (cheat-sheet)

```
src/
├── App.tsx                      ← routes + auth gates
├── pages/
│   ├── Landing.tsx               ← /
│   ├── Auth.tsx                  ← /login (with demo bypass)
│   ├── Dashboard.tsx             ← /home
│   ├── TreePage.tsx              ← /tree (search + tree switcher)
│   └── BirthdayPage.tsx          ← /birthdays
├── components/
│   ├── views/
│   │   ├── TreeView.tsx          ← canvas + zoom + connectors + LAYOUT_THEMES
│   │   ├── treeLayout.ts         ← cluster shapes + placement engine
│   │   ├── AdvancedFilter.tsx    ← lineage/divorces/deceased/search/focus
│   │   └── applyTreeFilters.ts
│   ├── MemberPanel.tsx           ← side panel (right-docked, 360px on md+)
│   ├── EditMemberModal.tsx       ← member edit (with hide + connector_parent_id)
│   ├── RelationshipManager.tsx   ← spouse status pills + add/remove rels
│   ├── TreeSearchModal.tsx       ← name search dialog
│   ├── TreeSwitcher.tsx          ← multi-tree dropdown
│   ├── QuickAccessMenu.tsx       ← landing/dashboard menu
│   ├── ai/AIScanModal.tsx        ← conversational scan flow
│   ├── onboarding/OnboardingWizard.tsx
│   └── admin/
│       ├── AdminDashboard.tsx
│       └── InviteCodeManager.tsx
├── store/useFamilyStore.ts       ← single Zustand store (optimistic CRUD!)
├── lib/
│   ├── supabase.ts
│   ├── permissions.ts            ← RBAC helpers
│   ├── lineage.ts                ← Kohen/Levi resolver (male-line only)
│   └── aiVision.ts               ← scanFiles() + 3-mode fallback
├── hooks/useAuthState.ts
├── i18n/translations.ts          ← keys typed; EN must match HE
├── types/index.ts                ← all TS interfaces
└── data/adlerFamily.ts           ← demo seed (73 members)
```

---

## 4. עקרונות ברזל

### 4.1 Optimistic state
**כל פעולת CRUD** ב-`useFamilyStore` קודם מעדכנת את ה-store, רק אחר כך קוראת ל-Supabase ב-`try/catch`. זה הכרחי כי המערכת רצה ב-demo mode (בלי backend) ואסור שמשתמש יראה שינוי שלא נשמר.

```ts
// ✅ נכון
updateRelationship: async (id, updates) => {
  set((s) => ({ relationships: s.relationships.map(r => r.id === id ? {...r, ...updates} : r) }))
  try { await supabase.from('relationships').update(updates).eq('id', id) } catch { /* offline */ }
}

// ❌ שגוי (זה היה הבאג של "סטטוס זוגי לא נשמר")
updateRelationship: async (id, updates) => {
  await supabase.from('relationships').update(updates).eq('id', id)  // נכשל ב-demo!
  set(...)  // לא מגיע
}
```

### 4.2 RBAC
4 רמות: `guest` < `user` < `master` < `admin`. אל תוסיף routes / mutations בלי לבדוק ב-`canEditMember` / `canManageRelationships` / `isAdmin`.

### 4.3 i18n
**כל מחרוזת UI** עוברת דרך `t.<key>`. אסור hardcoded text. אם הוספת key — הוסף ל-`he` וגם ל-`en`. Type system יזעק אם החסרת.

### 4.4 RTL
המערכת בעיקר עברית. השתמש ב-`ms-`/`me-` (logical) במקום `ml-`/`mr-`. השתמש ב-`left-`/`right-` (physical) רק כשאתה רוצה לאלץ מיקום יציב בלי קשר ל-direction (כמו ה-header עם לוגו שמאל / תפריט ימין).

### 4.5 Apple aesthetics
- Easing: `[0.16, 1, 0.3, 1]` (Framer Motion)
- Glass: `glass`, `glass-strong`, `shadow-glass`
- Colors: `#007AFF` (blue), `#5E5CE6` (indigo), `#34C759` (green), `#FF3B30` (red), `#FF9F0A` (amber)
- Avoid emojis in code unless the user asked for them

---

## 5. Workflow לכל שינוי

1. **הבן את הצורך** — קרא את ה-Issue או שאל את המשתמש.
2. **קרא את הקבצים הרלוונטיים** — אל תעבוד "מהזיכרון". הקוד הנוכחי הוא האמת היחידה.
3. **כתב את השינוי** עם הערות `//` ב-טון ה-codebase (אנגלית, מסבירות *למה* לא רק *מה*).
4. **`npm run typecheck`** חייב להיות נקי.
5. **`npm run build`** חייב להצליח.
6. **smoke-test ידני** — וודא בדפדפן (Preview MCP אם זמין):
   - `/` (Landing) נטען
   - `/tree` עם פילטר "כהנים" → 16 תוצאות
   - לחיצה על חבר → MemberPanel נפתח, X סוגר ולא משנה את הזום
   - ניהול קשרים → סטטוס נשמר עם toast "נשמר"
7. **commit** בסגנון Conventional: `feat(scope): ...` / `fix(scope): ...` / `docs: ...`. גוף ההודעה מסביר *למה*. תמיד עם `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` בסוף.
8. **push ל-`main`** — GitHub Pages יפרוס אוטומטית.

---

## 6. דברים שכבר תוקנו (אל תעשה אותם שוב)

הבאים נסיון מכאיב להוסיף — הקוד כבר מטפל בהם:

- ✅ Auto-fit אחרי סינון: `lastShapeRef` ב-TreeView
- ✅ Viewport נשמר בין renders: `treeViewport` ב-store
- ✅ Optimistic CRUD: כל פעולה ב-`useFamilyStore`
- ✅ MemberPanel גובה: `min(640px, 100vh-120px)`, רוחב 360px
- ✅ ילדים מתחברים מהאם: `primaryParentOf` עם עדיפות לאם
- ✅ Per-member hide: `hidden` boolean
- ✅ Per-member connector parent: `connector_parent_id`
- ✅ Multi-tree: `tree_id` + `TreeSwitcher`
- ✅ Toast "נשמר" אחרי שינוי קשר
- ✅ Landing תמיד ב-`/` (לא רק כשאין session)

---

## 7. אם אתה מתבלבל

- **לא יודע איפה משהו?** — הרץ `Grep "כותרת"` לחיפוש string-ים בעברית. הם המפתח לקובץ הרלוונטי.
- **לא בטוח אם פיצ'ר קיים?** — הסתכל ב-`ROADMAP.md` קודם.
- **שינוי גדול בארכיטקטורה?** — פתח Issue עם label `type: decision` ושאל את המשתמש לפני שמתחילים.
- **שכחת תרגום?** — `Grep "key:" src/i18n/translations.ts` — שני בלוקים מקבילים `he` ו-`en`.

---

## 8. אסור (red flags)

- ❌ אל תוסיף `any` — תמיד אופציה לטיפוס מדויק יותר.
- ❌ אל תכתוב text בעברית בקוד — תמיד דרך i18n.
- ❌ אל תעקוף את ה-RBAC ("אני יודע מה אני עושה" — לא כאן).
- ❌ אל תוסיף תלויות חדשות בלי לשאול. הסטאק נשמר רזה.
- ❌ אל תעשה `git push --force` ל-main.
- ❌ אל תעשה `git commit --amend` על קומיט שכבר נדחף.
- ❌ אל תיצור קבצי markdown חדשים אלא אם המשתמש ביקש או שזה issue/PR template.
- ❌ אל תוסיף emoji-ים לקוד אלא אם המשתמש ביקש.

---

## 9. קישורים שימושיים

- **Repo:** https://github.com/yakiradler/adler-family-tree
- **Live:** https://yakiradler.github.io/adler-family-tree/
- **Issues:** https://github.com/yakiradler/adler-family-tree/issues
- **Roadmap:** [./ROADMAP.md](./ROADMAP.md)
- **Architecture:** [./ARCHITECTURE.md](./ARCHITECTURE.md)

---

עכשיו, אחרי שקראת את המסמך הזה, פתח את `ARCHITECTURE.md` (וגם `ROADMAP.md` אם המשימה היא פיצ'ר חדש) לפני שאתה ניגש למשימה. בהצלחה 🍀
