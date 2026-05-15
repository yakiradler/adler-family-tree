# מדריך השקה לפיילוט – עץ משפחה אדלר

## דרישות מוקדמות
- חשבון Supabase (חינמי): https://supabase.com
- חשבון Vercel (חינמי): https://vercel.com
- Git + Node 20+

---

## שלב 1 – יצירת פרויקט Supabase

1. היכנס ל-[supabase.com](https://supabase.com) → **New project**
2. בחר שם (למשל `adler-family-tree`) ועיר קרובה (Frankfurt / Stockholm)
3. שמור את הסיסמה במקום בטוח
4. המתן כ-2 דקות עד שהפרויקט יהיה מוכן

---

## שלב 2 – הרצת הסכמה (SQL)

ב-Supabase Dashboard: **SQL Editor** → **New query**

הרץ את הקבצים הבאים **בסדר הזה** (העתק → הדבק → Run):

1. [`schema.sql`](./schema.sql) — טבלאות בסיס
2. [`migrations/001_member_extensions.sql`](./migrations/001_member_extensions.sql)
3. [`migrations/002_relationship_status.sql`](./migrations/002_relationship_status.sql)
4. [`migrations/003_onboarding_rbac.sql`](./migrations/003_onboarding_rbac.sql)
5. [`migrations/004_member_full_schema.sql`](./migrations/004_member_full_schema.sql)

---

## שלב 3 – הגדרת Authentication

בדשבורד Supabase → **Authentication** → **Providers**:
- ✅ Email (פועל כברירת מחדל)
- כבה **Confirm email** בשלב הפיילוט אם רוצה הרשמה מיידית ללא אישור מייל

**Site URL** (ב-Authentication → URL Configuration):
```
https://your-vercel-domain.vercel.app
```

---

## שלב 4 – המפתחות שלך

בדשבורד Supabase → **Settings** → **API**, העתק:
- `Project URL` → זה `VITE_SUPABASE_URL`
- `anon / public key` → זה `VITE_SUPABASE_ANON_KEY`

---

## שלב 5 – Deploy ל-Vercel

### אפשרות א׳ – דרך GitHub (מומלץ)
1. Push את הקוד ל-GitHub (repository חדש)
2. ב-Vercel: **Add New Project** → ייבא מ-GitHub
3. Framework Preset: **Vite**
4. **Environment Variables** – הוסף:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGc...
   ```
5. לחץ **Deploy**

### אפשרות ב׳ – Vercel CLI
```bash
npm i -g vercel
vercel
# עקוב אחרי ההוראות, הוסף env vars
```

---

## שלב 6 – הכנסת עצמך כ-Admin

לאחר ה-deploy, **הירשם ראשון** דרך האפליקציה.

אז ב-Supabase SQL Editor:
```sql
-- החלף את המייל שלך
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'your@email.com'
);
```

---

## שלב 7 – יצירת קוד הזמנה למשפחה

לאחר שאתה Admin, היכנס לאפליקציה:
1. **ניהול** → לשונית **הזמנות**
2. לחץ **צור קוד חדש**
3. קבע: כמות שימושים (למשל 50), תאריך תפוגה (אופציונלי), ותווית

**שתף את הקוד עם המשפחה** — הם ישתמשו בו בהרשמה.

---

## שלב 8 – העלאת נתוני המשפחה

**אפשרות א׳ – ידנית:** הוסף חברים דרך ממשק האפליקציה

**אפשרות ב׳ – SQL seed:** העתק את נתוני `ADLER_MEMBERS` ו-`ADLER_RELATIONSHIPS`  
מ-`src/data/adlerFamily.ts` והכנס ל-Supabase דרך SQL Editor

---

## רשימת בדיקה לפני השקה

- [ ] הסכמה רצה ללא שגיאות (שלבים 1-2)
- [ ] אתה מחובר כ-Admin ורואה את לשונית **ניהול**
- [ ] קוד הזמנה נוצר ועובד (נסה להירשם ממכשיר שני)
- [ ] חבר משפחה נוסף הצליח להירשם, רואה את העץ
- [ ] הרשמה → אשף הצטרפות → ביקשת role → הסתיים
- [ ] Admin ראה את הבקשה, אישר אותה, ה-role של המשתמש עודכן
- [ ] נתוני חבר נשמרים ולא נמחקים ברענון

---

## דומיין מותאם אישית (אופציונלי)

ב-Vercel → **Settings** → **Domains** → הוסף את הדומיין שלך.  
עדכן גם את **Site URL** ב-Supabase Authentication.

---

## פתרון בעיות נפוצות

| בעיה | פתרון |
|------|-------|
| לוגין לא עובד | בדוק שה-`VITE_SUPABASE_URL` נכון ואין רווחים |
| "Supabase not configured" | בדוק שמשתני הסביבה הוגדרו ב-Vercel ועשית re-deploy |
| משתמש חדש לא רואה עץ | ייתכן ש-RLS חוסם — הרץ מחדש את migration 003 |
| תמונות לא נשמרות | הפעל Supabase Storage bucket בשם `avatars` עם policy public |
