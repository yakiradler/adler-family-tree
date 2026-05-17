# 🛠 חיבור Supabase לאפליקציה — מדריך מהיר (עברית)

המסמך הזה מסביר איך מחברים את Supabase **בצורה מלאה** כך שכל מערך הניהול
יעבוד: בקשות גישה, בקשות עריכה, מחיקת משתמשים, הזמנות, זיכרונות, ועצים
מרובים.

זמן ביצוע: ~10 דקות, ברובן העתקה והדבקה.

---

## 1. ⚙️ הגדרות בפרויקט Supabase

1. גש ל-[supabase.com/dashboard](https://supabase.com/dashboard) ובחר את
   הפרויקט שלך.
2. תפריט שמאלי → **SQL Editor** → **New query**.
3. העתק את **כל התוכן** של הקובץ [`schema.sql`](./schema.sql) מהריפו.
4. הדבק בעורך וב-**Run**.
   - אין בעיה להריץ שוב על פרויקט קיים — כל ההגדרות מוגנות עם
     `IF NOT EXISTS` / `DROP POLICY IF EXISTS`.

✅ אחרי שזה רץ הצלחה — יש לך:
- כל הטבלאות (`profiles`, `members`, `relationships`, `edit_requests`,
  `access_requests`, `tree_invites`, `family_trees`, `member_notes`).
- כל ה-RLS policies הנכונות (כולל **מחיקת משתמשים על-ידי אדמין** —
  זה מה שלא עבד קודם).
- 4 רמות role (`guest` / `user` / `master` / `admin`).
- Trigger שמייצר אוטומטית `profile` לכל משתמש חדש שנרשם.

---

## 2. 👑 הפיכת המשתמש שלך לאדמין

אחרי שה-schema רץ, צריך לסמן את החשבון שלך כ-admin אחרת מערכת
הניהול תהיה חסומה.

1. **Authentication → Users** — חפש את האימייל שלך, העתק את ה-`UUID`.
2. חזרה ל-**SQL Editor** והרץ:
   ```sql
   update public.profiles
   set role = 'admin'
   where id = '<הדבק כאן את ה-UUID>';
   ```

עכשיו, אחרי התחברות מחדש, ה-tab "ניהול" בסרגל התחתון פעיל וגם בקשות
עריכה + בקשות גישה יגיעו אליך.

---

## 3. ✉️ הזמנת משתמש חדש דרך magic-link

כדי שכפתור **"הזמן משתמש"** במסך הניהול ישלח קישור הצטרפות
(ולא קישור איפוס סיסמה), צריך שתי הגדרות:

1. **Authentication → URL Configuration**
   - **Site URL:** `https://yakiradler.github.io/adler-family-tree/`
     (החלף לדומיין שלך אם שונה)
   - **Redirect URLs:** הוסף את אותו URL גם שם.

2. **Authentication → Providers → Email**
   - וודא ש-**Email** מופעל.
   - מומלץ: **Disable email confirmation** — כך משתמשים שהוזמנו
     יתחברו אוטומטית כשהם לוחצים על הקישור, בלי שלב נוסף של
     אישור מייל.

   _אם תרצה לשמור על אישור מייל — זה גם עובד; הקישור פשוט יראה
   "אשר את המייל" לפני שיכנס למערכת._

---

## 4. 🔐 משתני סביבה ב-Vercel/Netlify/GitHub Pages

האפליקציה צריכה לדעת איך לדבר עם Supabase. בקובץ `.env.local`
(local) או ב-secrets של ה-CI (production), שני המשתנים האלה
חייבים להיות מוגדרים:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

שניהם מופיעים ב-Supabase תחת **Project Settings → API**.

ב-GitHub Pages (כמו כרגע) — צריך להוסיף אותם כ-**Repository
secrets**: `Settings → Secrets and variables → Actions → New
repository secret`.

---

## 5. 🧪 בדיקת שהכל עובד

אחרי כל זה — רענן את האתר וודא:

| בדיקה | מה אמור לעבוד |
|---|---|
| הרשמה חדשה | ה-magic link מגיע למייל ומתחבר אוטומטית |
| Tab "ניהול" → "משתמשים" | המשתמש שלך מופיע ברשימה כ-admin 👑 |
| לחיצה על "🗑 הסר" משתמש | השורה נעלמת ו**לא חוזרת** אחרי refresh |
| משתמש חדש שעובר באשף | מופיע ב-"בקשות גישה" אצלך |
| משתמש שערך פרטים של אדם אחר | מופיע ב-"בקשות עריכה" |

---

## 6. 🐛 פתרון בעיות נפוצות

**הזמנה נכשלת עם "Email rate limit exceeded"**
> Supabase חסם את האימייל שלך כי הזמנת יותר מדי בזמן קצר. חכה ~5 דקות
> ונסה שוב, או הגדר שירות SMTP מותאם תחת
> **Authentication → Settings → SMTP**.

**"Couldn't delete user: permission denied for table profiles"**
> ה-RLS policy "profiles_delete_admin" לא נוצרה. הרץ את `schema.sql`
> שוב. אם זה חוזר — וודא שהמשתמש שלך באמת `role = 'admin'`
> בטבלת `profiles`.

**בקשות גישה לא מופיעות באדמין**
> משתמש שיצר את הבקשה — האם ב-`role = 'admin'` בטבלת profiles?
> רק admins יכולים לקרוא את הטבלה.

**"Could not find table 'access_requests'"**
> ה-schema לא רץ מלא. חזור על שלב 1.

---

## 7. 📞 צריך עזרה?

פתח issue ב-[github.com/yakiradler/adler-family-tree/issues](https://github.com/yakiradler/adler-family-tree/issues)
ותצרף את הודעת השגיאה המלאה. אם זו שגיאת RLS, צרף גם את הפלט של:

```sql
select id, full_name, role, active
from public.profiles
where id = auth.uid();
```
