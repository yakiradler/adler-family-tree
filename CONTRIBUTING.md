# 🤝 Contributing

מדריך פיתוח, עבודה ב-Issues, ופריסה.

---

## 🛠 Dev setup

```bash
# Clone
git clone https://github.com/yakiradler/adler-family-tree.git
cd adler-family-tree

# Install
npm install

# Run
npm run dev      # vite dev server (HMR) — http://localhost:5173
npm run build    # production bundle (tsc --noEmit + vite build)
npm run preview  # serve dist/ for sanity check
npm run typecheck  # tsc --noEmit only (fast)
```

### Environment

ללא משתני סביבה — המערכת רצה ב-**demo mode** עם משפחת אדלר (73 חברים).

ל-Supabase מלא:
```env
# .env.local
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_AI_VISION_URL=https://your-vision-endpoint.example.com  # optional
VITE_APP_VERSION=0.5.0  # appears in admin → system tab
```

---

## 🎯 Making changes

### Workflow
1. **Open an Issue** describing the bug or feature (use the templates ב-`.github/ISSUE_TEMPLATE/`).
2. **Branch** from `main`: `git checkout -b feat/short-description` או `fix/...`.
3. **Code** — שמור על הסטייל הקיים (ראה למטה).
4. **Verify**:
   - `npm run typecheck` נקי
   - `npm run build` עובר
   - בדיקה ידנית בדפדפן ב-`/tree`, `/home`, ובאחד מנתיבי ה-RBAC המוגנים
5. **Commit**: הודעות בסגנון Conventional Commits (`feat(tree): ...`, `fix(rel-manager): ...`).
6. **Push + PR** ל-`main`. CI יבנה ויפרוס אוטומטית ל-GitHub Pages כשתמזג.

### תבנית הודעת קומיט
```
feat(scope): short summary in present tense

Optional body explaining the why and the user-visible change.
Reference issues with #123 when relevant.

Co-Authored-By: ...
```

---

## 🎨 Style guidelines

### TypeScript
- **No `any`** — אם חייב, השתמש ב-`unknown` ועשה type guard.
- **Named types > inline** — interface ב-`src/types/index.ts` לכל מבנה שמופיע ביותר ממקום אחד.
- **`const` > `let`** איפה שאפשר.

### React
- **Function components** בלבד.
- **Hooks first** — useMemo / useCallback ל-derived state יקר; לא לכל closure.
- **Co-locate styles** — Tailwind classes ב-JSX. CSS-in-JS רק במצבים שלא ניתן להגדיר ב-Tailwind (animations, custom selectors).
- **`motion` props** — easing סטנדרטי `[0.16, 1, 0.3, 1]`, duration 0.18-0.45s לרוב.

### Tailwind
- **Apple design tokens** — הגוונים מוגדרים ב-`tailwind.config.cjs` (`#007AFF`, `#5E5CE6`, `#FF2D92`...).
- **Glass classes** — `glass`, `glass-strong`, `shadow-glass`, `shadow-glass-lg`.
- **RTL safety** — השתמש ב-`ms-`/`me-` (margin-inline-start/end) לרוב, או ב-physical `left-`/`right-` כשרוצים לאלץ צד.
- **Spacing** — gap/space utilities, לא marginים ידניים.

### State
- **Single Zustand store** (`useFamilyStore`) — כל מצב גלובלי שם.
- **Optimistic updates** — קודם `set()`, אחר כך Supabase ב-try/catch.
- **localStorage** רק עבור user preferences (lang, layoutMode, activeTreeId).

---

## 🏷 Issue labels

```
type:
  bug              באג בקוד או UX
  feature          פיצ'ר חדש
  enhancement      שיפור לפיצ'ר קיים
  refactor         שיפור פנימי בלי שינוי התנהגות
  docs             תיעוד
  decision         ADR — החלטה ארכיטקטונית

area:
  tree             עץ + layout + connectors
  ai-scan          AIScanModal + aiVision.ts
  rbac             permissions.ts + Auth + Onboarding
  admin            AdminDashboard + InviteCodeManager
  i18n             תרגומים
  performance      bundle size, render speed

priority:
  P0               חוסם — לתקן עכשיו
  P1               חשוב — בסיבוב הקרוב
  P2               נחמד — לתעדף לפי זמינות
  P3               רעיון — אולי בעתיד
```

---

## 🚢 Deploy

### Production (GitHub Pages)
מתבצע אוטומטית: כל push ל-`main` מפעיל `Deploy` workflow ב-`.github/workflows/`. הסניף `gh-pages` מכיל את ה-build.

```bash
# Deploy ידני (לא נדרש בדרך כלל)
npm run build
npx gh-pages -d dist
```

URL: https://yakiradler.github.io/adler-family-tree/

### Preview branch (אם יש PR)
PR נפתח לעצמו preview ב-`https://yakiradler.github.io/adler-family-tree/<branch>/` כשהworkflow מאופשר.

---

## 🧪 Testing

(אין כרגע test runner — תכנון להוסיף Vitest. עד אז:)

### Manual smoke test לפני merge:
- [ ] `/` (Landing) נטען
- [ ] לחיצה על "תפריט" → 3 פריטי QuickAccess
- [ ] Demo mode → `/home` → Dashboard עם 73 חברים
- [ ] `/tree` → קלאסי / סינון "כהנים" → 16 תוצאות
- [ ] לחיצה על חבר → MemberPanel נפתח, X סוגר ולא משנה זום
- [ ] ניהול קשרים → סטטוס נשמר עם toast
- [ ] AI Scan → demo seeds → review chat → confirmAdd

---

## 📚 Resources

- [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/) — לרוח העיצוב
- [Framer Motion docs](https://www.framer.com/motion/) — animations
- [Zustand docs](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [Supabase docs](https://supabase.com/docs)

---

## 💬 Help

- 🐛 באג? — [פתח issue](https://github.com/yakiradler/adler-family-tree/issues/new?template=bug_report.md)
- 💡 רעיון? — [פתח issue](https://github.com/yakiradler/adler-family-tree/issues/new?template=feature_request.md)
- ❓ שאלה? — [פתח discussion](https://github.com/yakiradler/adler-family-tree/discussions)

---

## 🤖 Working with AI agents (Claude / GPT / Gemini)

הריפו מכין את עצמו ל-AI agents:

- **`AGENTS.md`** בשורש — briefing מלא בעברית (תפקיד, עקרונות, workflow, red flags). זו ההפניה הראשונה.
- **`.claude/CLAUDE.md`** — auto-loaded ע"י Claude Code, מפנה ל-`AGENTS.md`.
- **`ARCHITECTURE.md`** — מודל הנתונים, ה-store, ה-RBAC, מנוע הפריסה. חובה לפני שינוי משמעותי.
- **`ROADMAP.md`** — חובה לפני פיצ'ר חדש.

### תבנית פתיחה לשיחה חדשה

```
אני עובד על פרויקט adler-family-tree.

📁 נתיב מקומי: C:\Users\yakir\קלוד קוד\family-tree
🔗 ריפו: https://github.com/yakiradler/adler-family-tree
🌐 production: https://yakiradler.github.io/adler-family-tree/

לפני שאתה מתחיל, קרא:
1. AGENTS.md (briefing מלא)
2. ARCHITECTURE.md (אם השינוי לא טריוויאלי)
3. ROADMAP.md (אם זה פיצ'ר חדש)

המשימה שלי:
[תאר כאן באג / פיצ'ר / שאלה]
```

### עקרונות חיוניים (העתק את זה אם תרצה)

1. **Optimistic CRUD ב-`useFamilyStore`** — קודם `set()`, אחר כך Supabase ב-`try/catch`. אחרת demo mode נשבר.
2. **i18n** — כל מחרוזת UI דרך `t.<key>`. אם הוספת key — ל-`he` וגם ל-`en`.
3. **RBAC** — בדוק `canEditMember` / `canManageRelationships` / `isAdmin` לכל פעולה רגישה.
4. **smoke test** — `/`, `/tree` עם פילטר "כהנים", MemberPanel + X, סטטוס זוגי + toast.
5. **commit message** — Conventional Commits, גוף מסביר *למה*, סיום עם `Co-Authored-By: Claude ...`.
