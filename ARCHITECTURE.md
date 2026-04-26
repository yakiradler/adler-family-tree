# 🏗 Architecture

המסמך הזה מתאר את המבנה הפנימי של המערכת: מודל הנתונים, ניהול ה-state, ה-RBAC, מנוע הפריסה של העץ, וזרימת הסריקה ב-AI.

---

## 1. Data Model

### 1.1 Member
```ts
interface Member {
  id: string
  first_name: string
  last_name: string
  maiden_name?: string          // שם נעורים (לא מוצג בעץ)
  nickname?: string
  birth_date?: string           // ISO yyyy-mm-dd
  death_date?: string
  hebrew_birth_date?: string
  hebrew_death_date?: string
  bio?: string
  photo_url?: string
  photos?: string[]
  gender?: 'male' | 'female'
  birth_order?: number
  lineage?: 'kohen' | 'levi' | 'israel' | null  // ידני; אחרת אוטומטי
  hidden?: boolean              // הסתר מתצוגת העץ (נשאר בכרטיסיות)
  connector_parent_id?: string | null  // איזה הורה לעוגן את הקו
  tree_id?: string | null       // עץ משנה (null = ראשי)
  created_by: string
}
```

### 1.2 Relationship
```ts
interface Relationship {
  id: string
  type: 'parent-child' | 'spouse'
  member_a_id: string
  member_b_id: string           // עבור parent-child: a=הורה, b=ילד
  status?: 'current' | 'ex' | 'deceased'  // רק עבור spouse
}
```

### 1.3 Profile (משתמש מערכת)
```ts
interface Profile {
  id: string
  full_name: string
  avatar_url?: string
  role: 'guest' | 'user' | 'master' | 'admin'
  bio?: string
  onboarded_at?: string | null
  requested_role?: UserRole | null
  master_permissions?: MasterPermissions  // jsonb
}
```

### 1.4 FamilyTree (multi-tree)
```ts
interface FamilyTree {
  id: string
  name: string
  description?: string
  color?: string                // הקסה לסימון
  created_by: string
  created_at?: string
}
```

---

## 2. Supabase Schema (production)

```sql
-- Profiles (משתמשי מערכת)
create table profiles (
  id uuid primary key references auth.users(id),
  full_name text,
  avatar_url text,
  role text check (role in ('guest','user','master','admin')) default 'guest',
  bio text,
  onboarded_at timestamptz,
  requested_role text,
  master_permissions jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Members (חברי המשפחה)
create table members (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  maiden_name text,
  nickname text,
  birth_date date,
  death_date date,
  hebrew_birth_date text,
  hebrew_death_date text,
  bio text,
  photo_url text,
  photos jsonb,
  gender text check (gender in ('male','female')),
  birth_order int,
  lineage text check (lineage in ('kohen','levi','israel')),
  hidden boolean default false,
  connector_parent_id uuid,
  tree_id uuid references family_trees(id),
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Relationships
create table relationships (
  id uuid primary key default gen_random_uuid(),
  type text check (type in ('parent-child','spouse')) not null,
  member_a_id uuid references members(id) on delete cascade,
  member_b_id uuid references members(id) on delete cascade,
  status text check (status in ('current','ex','deceased')),
  created_at timestamptz default now(),
  unique (type, member_a_id, member_b_id)
);

-- Multi-tree
create table family_trees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  color text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Access requests (onboarding queue)
create table access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references profiles(id),
  requested_role text,
  invite_code text,
  answers jsonb,
  status text check (status in ('pending','approved','rejected')) default 'pending',
  decided_at timestamptz,
  created_at timestamptz default now()
);

-- Edit requests (peer-review queue)
create table edit_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id),
  requester_id uuid references profiles(id),
  change_data jsonb,
  status text check (status in ('pending','approved','rejected')) default 'pending',
  created_at timestamptz default now()
);

-- Invite codes
create table tree_invites (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  expires_at timestamptz,
  uses_left int,
  note text
);
```

### RLS (Row-Level Security)

הפעלה לכל הטבלאות. דוגמה ל-`members`:
```sql
alter table members enable row level security;

-- כולם יכולים לקרוא חברים (גם guests)
create policy "members read" on members for select using (true);

-- רק admin יכול למחוק
create policy "members delete admin" on members for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- INSERT: כל user/master/admin
create policy "members insert" on members for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('user','master','admin'))
);

-- UPDATE: ה-canEditMember helper תקף גם ב-DB
create policy "members update" on members for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('master','admin'))
  -- TODO: add nuclear-family edit policy for 'user'
);
```

---

## 3. State Management (Zustand)

קובץ: `src/store/useFamilyStore.ts`

### Slices:
- **profile + session** — `profile`, `setProfile`
- **data** — `members`, `relationships`, `editRequests`, `accessRequests`
- **viewport** — `treeViewport` (tx/ty/scale, נשמר בין renders)
- **multi-tree** — `trees`, `activeTreeId`, `setActiveTreeId`
- **CRUD** — כל הפעולות אופטימיסטיות: קודם `set()` ל-store, אחר כך Supabase ב-`try/catch` (כך demo mode עובד).

### Persistence:
- `activeTreeId` ו-`layoutMode` נשמרים ב-`localStorage`.
- `treeViewport` משותף לכל הקומפוננטות שמשתמשות ב-TreeView (לא נשמר ב-localStorage כדי שכל רענון יחזיר ל-fit).

---

## 4. RBAC (4 רמות)

קובץ: `src/lib/permissions.ts`

| Role | קריאה | עריכת עצמי | עריכת משפחה | עריכת כל אחד | ניהול |
|---|---|---|---|---|---|
| **guest** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **user** | ✅ | ✅ | ✅ (gerעיני) | ❌ | ❌ |
| **master** | ✅ | ✅ | ✅ | ✅ (לפי flag) | ❌ |
| **admin** | ✅ | ✅ | ✅ | ✅ | ✅ |

### `master_permissions` (jsonb)
```ts
interface MasterPermissions {
  edit_anyone?: boolean
  manage_relationships?: boolean
  approve_edit_requests?: boolean
  manage_invites?: boolean
}
```

### Helpers
- `canEditMember(profile, { targetMemberId, nuclearFamilyIds })` — אמת/שקר
- `canManageRelationships(profile)` — admin תמיד; master עם flag; user רק על משפחה גרעינית
- `isAdmin(profile)`, `isOnboarded(profile)`

---

## 5. Tree Layout Engine

קובץ: `src/components/views/treeLayout.ts`

### זרימה:
1. **`buildParentMap`** — child_id → [parent members]
2. **`primaryParentOf`** — לכל ילד בוחר הורה ראשי לקיבוץ:
   `connector_parent_id` (override) → אם → אב → ראשון
3. **`familyChildrenOf`** — מאחד את הילדים של החבר עם ילדי בן/בת הזוג
4. **גנרציה** — חישוב fixpoint: דור = max(הורים) + 1
5. **`layoutRoots`** — שורשים (חברים בלי הורים), מחוברים לבני-זוג
6. **`subtreeWidth`** — רוחב כל תת-עץ לפי `mode` (cluster shape)
7. **placement** — DFS שמניח כל תת-עץ במיקום מוחלט

### Cluster shapes (per layout mode):
- **classic** — שורה אופקית
- **grid** — עד 5 בשורה, נפרס למטה
- **arc** — קשת רכה (sweep ≤ 99°, sag ≤ 0.9·NODE_H)
- **staggered** — לבני (zigzag), gap קטן יותר אופקית

קובץ: `src/components/views/applyTreeFilters.ts`

### Filter pipeline (לפני ה-layout):
1. `passesHidden` — מסנן `hidden=true`
2. `passesLineage` — לפי `kohen`/`levi` (זכרים בלבד)
3. `passesDeceased` — מסנן `death_date` אם פעיל
4. `passesSearch` — חיפוש שם
5. `focusMemberId` — מצמצם לאבות/צאצאים/בני-זוג של חבר ממוקד

### Connectors (`buildConnectors` ב-`TreeView.tsx`):
- כל ילד מקבל קו מהורה ה-anchor (default: אם)
- אורתוגונלי: לרדת → אופקי → לרדת לראש כרטיס הילד

### Per-layout themes (`LAYOUT_THEMES`):
- classic → כחול / סגול / תכלת
- grid → אמרלד / ירוק / טורקיז
- arc → ענבר / כתום / אדום
- staggered → סגול / מגנטה / טורקיז

### Zoom: `[0.05, 8]` (5%—800%)

---

## 6. AI Scan Flow

קובץ: `src/lib/aiVision.ts` + `src/components/ai/AIScanModal.tsx`

### 3 מצבים (fallback chain):
1. **`VITE_AI_VISION_URL`** — POST `{ files: [{name, mime, data: base64}] }` → `{ candidates: [...] }`
2. **Supabase Edge Function** — `parse-family-document` (multipart formdata)
3. **Demo** — `demoCandidates()` מחזיר seeds סינתטיים

### 4 phases ב-UI:
1. **pick** — drag/drop קבצים (עד 8)
2. **preview** — thumbnails + כפתור "סרוק"
3. **analyzing** — spinner + טקסט "בוחן..."
4. **review** — **שיחה**: בועת AI אינטרו → לכל מועמד בועה עם זיהוי + כרטיס עריכה + בוחר מיקום (5 אופציות + member dropdown)

### `confirmAdd`:
- יוצר Member
- אם בחרו מיקום ≠ standalone → יוצר Relationship מתאים (parent/child/spouse/sibling — sibling מעתיק את ההורים של בחר האח)

---

## 7. Onboarding (Phase C)

קובץ: `src/components/onboarding/OnboardingWizard.tsx`

### 4 שלבים + סיום:
1. **שיוך** — קוד הזמנה / יצירת עץ חדש
2. **פרטים אישיים** — first/last/maidenName/email/birthDate/gender/phone/lineage
3. **קרבה** — היחס שלי לעץ (אבא/אמא/אח...)
4. **הרשאה מבוקשת** — guest/user/master/admin

ב-submit:
- `completeOnboarding(profilePatch)` — קובע `onboarded_at`, `full_name`, `bio`, `requested_role`
- `submitAccessRequest({ ..., answers: { personal: {...} } })` — admin מאשר ונותן לו תפקיד

ב-Dashboard מופיע **באנר רך** למי שלא השלים, מוביל ל-`/onboarding`. ה-Wizard לא חוסם — אפשר לדפדף בעץ בלי להשלים.

---

## 8. i18n

קובץ: `src/i18n/translations.ts` + `src/i18n/useT.ts`

- מבנה: `{ he: { key: 'ערך' }, en: { key: 'value' } }`
- `useT` קורא את `lang` מ-`useFamilyStore` (נשמר ב-localStorage)
- `Translations` type: `typeof translations.he` — מבטיח ש-en כוללת כל מפתח
- כיווניות: `isRTL(lang)` — `dir="rtl"` מוחל ב-`App.tsx` ובכל מודל ראשי

---

## 9. Build + Deploy

- **GitHub Pages** — `main` נבנה ע"י Vite ונדחף ל-`gh-pages` ע"י CI
- **`vite.config.ts`** — `base: '/adler-family-tree/'` כדי שהנכסים יטענו נכון תחת ה-subpath
- **HashRouter** — מנתב לפי `#/` כי GitHub Pages לא תומך ב-SPA history mode

---

## 10. Critical files map

```
src/
├── App.tsx                      ← routes + auth gates
├── pages/
│   ├── Landing.tsx              ← marketing
│   ├── Auth.tsx                 ← login/signup (with demo bypass)
│   ├── Dashboard.tsx            ← /home
│   ├── TreePage.tsx             ← /tree (search + switcher)
│   └── BirthdayPage.tsx
├── components/
│   ├── views/
│   │   ├── TreeView.tsx         ← canvas + zoom + connectors + themes
│   │   ├── treeLayout.ts        ← cluster shapes + placement engine
│   │   ├── AdvancedFilter.tsx
│   │   └── applyTreeFilters.ts
│   ├── MemberPanel.tsx          ← side panel (the right-docked one)
│   ├── EditMemberModal.tsx      ← member edit form (with hide + connector)
│   ├── RelationshipManager.tsx  ← spouse status pills + add/remove rels
│   ├── TreeSearchModal.tsx      ← name search dialog
│   ├── TreeSwitcher.tsx         ← multi-tree dropdown
│   ├── QuickAccessMenu.tsx      ← landing/dashboard menu
│   ├── ai/AIScanModal.tsx       ← conversational scan flow
│   ├── onboarding/OnboardingWizard.tsx
│   └── admin/
│       ├── AdminDashboard.tsx
│       └── InviteCodeManager.tsx
├── store/
│   └── useFamilyStore.ts        ← single Zustand store
├── lib/
│   ├── supabase.ts
│   ├── permissions.ts           ← RBAC helpers
│   ├── lineage.ts               ← Kohen/Levi resolver
│   └── aiVision.ts              ← scanFiles() + fallback chain
├── hooks/
│   └── useAuthState.ts          ← lightweight auth state for Landing/QuickAccess
├── i18n/
│   ├── translations.ts
│   └── useT.ts
├── types/index.ts               ← all TS interfaces
└── data/adlerFamily.ts          ← demo seed data (73 members)
```
