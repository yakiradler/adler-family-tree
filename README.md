<div align="right" dir="rtl">

# 🌳 משפחת אדלר — Family Tree CRM

מערכת ניהול עץ משפחה בסגנון Apple, מותאמת לעברית, עם RBAC מלא, ייחוס הלכתי (כהן/לוי), סריקת מסמכים ב-AI, ותצוגה אינטראקטיבית.

[**🌐 Live Demo**](https://yakiradler.github.io/adler-family-tree/) · [**📋 Roadmap**](./ROADMAP.md) · [**🏗 Architecture**](./ARCHITECTURE.md) · [**🤝 Contributing**](./CONTRIBUTING.md) · [**🐛 Issues**](https://github.com/yakiradler/adler-family-tree/issues)

</div>

---

## ✨ מה יש כאן (Features)

<table>
<tr><td width="50%" valign="top">

### 🌲 עץ משפחה אינטראקטיבי
- 4 פריסות: קלאסי / גריד / קשת / מדורג
- כל פריסה עם **גוון צבע משלה**
- זום ללא הגבלה (5%—800%)
- pan + pinch + wheel
- רקע mesh-gradient דינמי

### 🔍 חיפוש וסינון
- **חיפוש שם** במודל ייעודי (שם פרטי / משפחה / נעורים)
- **סינון מתקדם:** שושלת (כהן/לוי), הצג גרושים, הסתר ז״ל, מיקוד באדם
- מספר תוצאות חי

### 👑 ייחוס הלכתי
- ירושה רק בקו זכרים (זכר עם אב כהן/לוי = כהן/לוי)
- בנות = "בת כהן" (לא מקבלות תג)
- כלל אוטומטי: זכר אדלר עם הורה אדלר → כהן ("אדלר (כהנא)")

</td><td width="50%" valign="top">

### 🔐 4 רמות הרשאה (RBAC)
- **Guest:** קריאה בלבד
- **User:** עורך את עצמו ומשפחתו הגרעינית
- **Master:** הרשאות granular לפי flag
- **Admin:** שולט בכל

### ✨ AI Scan שיחתי
- העלאת תמונות / מסמכים / PDF
- בועות שיחה שמרנטות זיהויים
- בחירת מיקום לכל מועמד (הורה/ילד/בן זוג/אח/בנפרד)
- יצירת חבר + קשר במכה אחת

### 🌳 מולטי-עצים
- TreeSwitcher dropdown (כמו Slack)
- כל עץ עם צבע משלו
- עץ ראשי + עצי משנה (משפחת אם / אב / בן זוג)

### 🎨 Apple Design System
- Glass morphism + mesh gradients
- Framer Motion ב-easing `[0.16, 1, 0.3, 1]`
- RTL מלא

</td></tr></table>

---

## 🚀 Quick Start

```bash
git clone https://github.com/yakiradler/adler-family-tree.git
cd adler-family-tree
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle
npm run preview      # serve the production bundle
```

> **Demo mode:** ללא משתני סביבה המערכת רצה במצב הדגמה עם משפחת אדלר טעונה מראש (73 חברים).

---

## 🔧 Configuration

הוסף `.env.local` (אופציונלי — בלעדיו רצה ב-demo):

```env
# Supabase (login + sync)
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# AI Scan endpoint (optional — falls back to Supabase Edge → demo)
VITE_AI_VISION_URL=https://your-vision-endpoint.example.com
```

---

## 📦 Stack

| Layer | Tech |
|---|---|
| Framework | React 19 + Vite 8 + TypeScript 6 |
| Styling | TailwindCSS + custom Apple design tokens |
| Animation | Framer Motion |
| Routing | react-router-dom (HashRouter for GitHub Pages) |
| State | Zustand |
| Auth + DB | Supabase (Postgres + RLS + Edge Functions) |
| Deploy | GitHub Pages (CI auto-deploys `main` to `gh-pages`) |

---

## 🗺 Routing model

| Route | Renders | Guard |
|---|---|---|
| `/` | Marketing Landing | תמיד |
| `/login` | Auth (login + signup) | מועבר ל-`/home` אם כבר מחובר |
| `/onboarding` | OnboardingWizard (4 שלבים + סיום) | דורש auth, לא חוסם — נגיש דרך באנר |
| `/home` | Dashboard | דורש auth |
| `/tree` | TreeView + סינון + חיפוש | דורש auth |
| `/birthdays` | רשימת ימי הולדת קרובים | דורש auth |
| `/admin` | פאנל ניהול (משתמשים, בקשות, הזמנות, מערכת) | דורש auth (ה-component מטפל ב-RBAC) |

---

## 📚 Docs

- [**ARCHITECTURE.md**](./ARCHITECTURE.md) — מודל הנתונים, ה-store, ה-RBAC, מנוע הפריסה
- [**ROADMAP.md**](./ROADMAP.md) — מה הושלם, מה בעבודה, מה מתוכנן
- [**CONTRIBUTING.md**](./CONTRIBUTING.md) — איך לפתח, להוסיף פיצ'ר, לפרוס

---

## 📄 License

MIT © 2026 משפחת אדלר
