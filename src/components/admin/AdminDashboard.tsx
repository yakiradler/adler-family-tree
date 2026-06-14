import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../../i18n/useT'
import { confirmDialog, alertDialog } from '../../lib/confirm'
import EditMemberModal from '../EditMemberModal'
import InviteCodeManager from './InviteCodeManager'
import TreeManagePanel from '../tree/TreeManagePanel'
import { PersonAvatarIcon } from '../MemberNode'
import { getRingGradient, getFallbackGradient } from '../memberVisuals'
import type { EditRequest, Member, Profile, UserRole, TreeRole, MasterPermissions, AccessRequest, UserPlan, PlanId } from '../../types'
import type { PermissionKey } from '../../lib/permissions'
import { adminInboxCounts } from '../../lib/notifications'

type Tab = 'overview' | 'users' | 'members' | 'trees' | 'requests' | 'access' | 'reports' | 'invites' | 'system'

const ROLE_OPTIONS: { key: UserRole; icon: string; labelKey: 'adminRoleGuest' | 'adminRoleUser' | 'adminRoleMaster' | 'adminRoleAdmin' }[] = [
  { key: 'guest',  icon: '👤', labelKey: 'adminRoleGuest' },
  { key: 'user',   icon: '👨‍👩‍👧', labelKey: 'adminRoleUser' },
  { key: 'master', icon: '⭐', labelKey: 'adminRoleMaster' },
  { key: 'admin',  icon: '👑', labelKey: 'adminRoleAdmin' },
]

const PERM_KEYS: PermissionKey[] = [
  'canEditAnyMember',
  'canDeleteMembers',
  'canManageRelationships',
  'canApproveEditRequests',
  'canManageInvites',
]

const PERM_LABEL: Record<PermissionKey, 'permEditAnyMember' | 'permDeleteMembers' | 'permManageRelationships' | 'permApproveEditRequests' | 'permManageInvites'> = {
  canEditAnyMember: 'permEditAnyMember',
  canDeleteMembers: 'permDeleteMembers',
  canManageRelationships: 'permManageRelationships',
  canApproveEditRequests: 'permApproveEditRequests',
  canManageInvites: 'permManageInvites',
}

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'admin':  return 'bg-[#007AFF]/15 text-[#007AFF]'
    case 'master': return 'bg-[#FF9F0A]/15 text-[#FF9F0A]'
    case 'user':   return 'bg-[#5AC8FA]/15 text-[#32ADE6]'
    case 'guest':  return 'bg-[#8E8E93]/15 text-[#636366]'
  }
}

interface AdminUser extends Profile {
  email?: string
  created_at?: string
  last_sign_in_at?: string
}

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''

export default function AdminDashboard() {
  const {
    editRequests, fetchEditRequests, approveEditRequest, rejectEditRequest,
    members, deleteMember, profile, trees,
    accessRequests, fetchAccessRequests, decideAccessRequest, updateProfileById,
    feedback, fetchFeedback, updateFeedback, deleteFeedback,
  } = useFamilyStore()
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('overview')
  const [manageTree, setManageTree] = useState<{ id: string; name: string } | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  // Lightweight backend health surface — if any of the admin queries
  // fail (most commonly because `schema.sql` hasn't been run on the
  // Supabase project), show a banner pointing the admin to the setup
  // doc rather than letting them think the app is broken.
  const [backendError, setBackendError] = useState<string | null>(null)
  // Tracks whether the CURRENT user is genuinely admin in the DB
  // (not just admin in the local store). When `false`, every
  // mutation will be silently RLS-blocked even though the UI looks
  // ready — surfacing this lets us tell the user what to fix instead
  // of leaving them confused after their action snaps back. `email`
  // is captured so we can pre-fill the diagnostic SQL exactly.
  const [dbAdminStatus, setDbAdminStatus] = useState<{
    ok: boolean
    role: string | null
    active: boolean | null
    email: string | null
  } | null>(null)
  const [editTarget, setEditTarget] = useState<Member | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('user')
  const [inviting, setInviting] = useState(false)
  // Subscription Phase A: per-user plan + leaf balance, editable here
  // because there's no payment provider yet — the admin IS the
  // billing system.
  const [userPlans, setUserPlans] = useState<Record<string, UserPlan>>({})

  // ─── CRM actions (work in demo via local state; in live via Supabase) ──
  //
  // Important: Supabase RLS is annoying with mutations. When a policy
  // blocks an UPDATE or DELETE, the request often comes back with
  // `error == null` BUT 0 rows affected — there's just nothing the
  // current user is allowed to touch. Without `.select()`, our code
  // can't tell "no rows because nothing matched" from "no rows because
  // RLS rejected it". Every mutation below therefore selects back the
  // changed rows; an empty array is treated as a silent block and
  // surfaced as a "did not persist — likely RLS" error so the user
  // doesn't refresh and find their action undone.
  const reportRlsBlock = (verb: 'update' | 'delete') => {
    void alertDialog({
      message: lang === 'he'
        ? `הפעולה לא נשמרה בשרת — ייתכן שאין לך הרשאת admin ב-Supabase.\nרוץ ב-SQL Editor:\nupdate public.profiles set role='admin' where email='<your-email>';`
        : `Action did not persist — you likely lack admin rights in Supabase.\nRun in SQL Editor:\nupdate public.profiles set role='admin' where email='<your-email>';`,
    })
    void verb
  }

  const changeUserRole = async (u: AdminUser, role: UserRole) => {
    const prev = users
    setUsers(us => us.map(x => x.id === u.id ? { ...x, role } : x))
    if (!SUPABASE_CONFIGURED) return
    const { data, error } = await supabase.from('profiles').update({ role }).eq('id', u.id).select()
    if (error || !data || data.length === 0) {
      setUsers(prev)
      reportRlsBlock('update')
    }
  }
  const changeMasterPerm = async (u: AdminUser, key: PermissionKey, value: boolean) => {
    const next: MasterPermissions = { ...(u.master_permissions ?? {}), [key]: value }
    setUsers(us => us.map(x => x.id === u.id ? { ...x, master_permissions: next } : x))
    await updateProfileById(u.id, { master_permissions: next })
  }
  const toggleUserActive = async (u: AdminUser) => {
    const cur = (u as unknown as { active?: boolean }).active !== false
    const next = !cur
    const prev = users
    setUsers(us => us.map(x => x.id === u.id ? ({ ...x, active: next } as AdminUser) : x))
    if (!SUPABASE_CONFIGURED) return
    const { data, error } = await supabase.from('profiles').update({ active: next }).eq('id', u.id).select()
    if (error || !data || data.length === 0) {
      setUsers(prev)
      reportRlsBlock('update')
    }
  }
  const removeUser = async (u: AdminUser) => {
    // Soft-delete with 30-day restore window. We don't touch
    // auth.users (that needs the service-role key) — instead we
    // mark profile.deleted_at = now(). The auth gate in App.tsx
    // refuses the session for any user with a deleted_at in the
    // past 30 days, AND the handle_new_user trigger preserves the
    // deleted_at on re-login (migration 006). So the user is
    // effectively locked out until the admin restores them via
    // the "שחזר" button OR 30 days elapse.
    const confirmMsg = lang === 'he'
      ? `${t.adminConfirmRemoveUser}\n\nהמשתמש יושעה למשך 30 יום. תוכל לשחזר אותו בכל רגע על ידי לחיצה על "שחזר".`
      : `${t.adminConfirmRemoveUser}\n\nThe user will be suspended for 30 days. You can restore them at any time using the "Restore" button.`
    if (!(await confirmDialog({ message: confirmMsg, danger: true }))) return
    const nowIso = new Date().toISOString()
    // Optimistic local update so the row updates immediately.
    const prev = users
    setUsers(us => us.map(x => x.id === u.id ? { ...x, deleted_at: nowIso } : x))
    if (!SUPABASE_CONFIGURED) {
      try {
        const raw = window.localStorage.getItem('ft-admin-removed-users') ?? '[]'
        const list = JSON.parse(raw) as string[]
        if (!list.includes(u.id)) list.push(u.id)
        window.localStorage.setItem('ft-admin-removed-users', JSON.stringify(list))
      } catch { /* quota — accept the loss, demo is single-session anyway */ }
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .update({ deleted_at: nowIso })
      .eq('id', u.id)
      .select()
    if (error) {
      setUsers(prev)
      void alertDialog({
        message: lang === 'he'
          ? `לא ניתן להשעות את המשתמש: ${error.message}`
          : `Couldn't suspend user: ${error.message}`,
      })
      return
    }
    if (!data || data.length === 0) {
      setUsers(prev)
      reportRlsBlock('update')
    }
  }

  // Restore a soft-deleted user. Clears deleted_at; the next session
  // for that user will load normally instead of being kicked.
  const restoreUser = async (u: AdminUser) => {
    const prev = users
    setUsers(us => us.map(x => x.id === u.id ? { ...x, deleted_at: null } : x))
    if (!SUPABASE_CONFIGURED) return
    const { data, error } = await supabase
      .from('profiles')
      .update({ deleted_at: null })
      .eq('id', u.id)
      .select()
    if (error || !data || data.length === 0) {
      setUsers(prev)
      reportRlsBlock('update')
    }
  }
  const inviteUser = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return
    setInviting(true)
    try {
      let inviteOutcome: 'magic-link' | 'manual' = 'manual'
      if (SUPABASE_CONFIGURED) {
        // Proper signup-invite flow: send a magic LINK that will
        // CREATE the user on first click. This was previously calling
        // `resetPasswordForEmail`, which sent the wrong email and
        // only worked for users who already existed. With
        // `signInWithOtp(shouldCreateUser: true)` the link doubles as
        // both signup AND first-time login.
        const { error } = await supabase.auth.signInWithOtp({
          email: inviteEmail.trim(),
          options: {
            shouldCreateUser: true,
            data: { full_name: inviteName.trim(), invited_role: inviteRole },
            // Pin the magic-link target to this origin so the invite
            // works regardless of what Site URL the Supabase dashboard
            // is currently holding. Without this the magic link points
            // to whatever Site URL was configured (often still
            // localhost on fresh projects), so invites would land on a
            // broken redirect.
            emailRedirectTo: `${window.location.origin}/`,
          },
        })
        if (!error) inviteOutcome = 'magic-link'
      }
      const newUser: AdminUser = {
        id: `invited-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        full_name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
        created_at: new Date().toISOString(),
      }
      setUsers(us => [newUser, ...us])
      setInviteEmail(''); setInviteName('')
      setInviteRole('user')
      // Friendlier than the previous "Invite sent" — explain what the
      // user will actually receive in their inbox.
      const msg = inviteOutcome === 'magic-link'
        ? (lang === 'he'
            ? `קישור הצטרפות נשלח ל-${inviteEmail.trim()}.\nהמשתמש ילחץ עליו ויתחבר ישירות לחשבון חדש.`
            : `Signup link sent to ${inviteEmail.trim()}.\nThey'll click it to create their account.`)
        : (lang === 'he'
            ? `המשתמש נוסף למערכת. שלח לו את הקישור באופן ידני: ${window.location.origin}/`
            : `User added. Share this link with them: ${window.location.origin}/`)
      void alertDialog({ message: msg })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      void alertDialog({ message: lang === 'he' ? `שגיאה בשליחת ההזמנה: ${msg}` : `Invite failed: ${msg}` })
    } finally {
      setInviting(false)
    }
  }

  // Store actions are stable zustand references — listing them keeps
  // exhaustive-deps honest without changing the run-once behaviour.
  useEffect(() => {
    fetchEditRequests()
    if (SUPABASE_CONFIGURED) {
      fetchAccessRequests()
      fetchFeedback()
      // Plan rows for the users tab (admin RLS sees all).
      ;(async () => {
        const { data } = await supabase.from('user_plans').select('*')
        if (Array.isArray(data)) {
          const map: Record<string, UserPlan> = {}
          for (const row of data as UserPlan[]) map[row.user_id] = row
          setUserPlans(map)
        }
      })()
    }
  }, [fetchEditRequests, fetchAccessRequests, fetchFeedback])

  // Admin-applied tier change (Phase A "billing"): upsert only the
  // plan column so the leaf balance is untouched.
  const setUserPlanTier = async (userId: string, plan: PlanId) => {
    const prev = userPlans
    setUserPlans((m) => ({
      ...m,
      [userId]: { ...(m[userId] ?? { user_id: userId, leaves: 0 }), plan, trial_ends_at: null },
    }))
    const { error } = await supabase
      .from('user_plans')
      .upsert({ user_id: userId, plan, trial_ends_at: null, updated_at: new Date().toISOString() })
    if (error) {
      setUserPlans(prev)
      reportRlsBlock('update')
    }
  }

  const grantLeaves = async (userId: string, amount: number) => {
    if (!userPlans[userId]) {
      // No row yet (user never opened the app since the feature
      // shipped) — create their free row first.
      await setUserPlanTier(userId, 'free')
    }
    const base = userPlans[userId]?.leaves ?? 0
    setUserPlans((m) => ({
      ...m,
      [userId]: { ...(m[userId] ?? { user_id: userId, plan: 'free' as PlanId }), leaves: base + amount },
    }))
    const { error } = await supabase
      .from('user_plans')
      .update({ leaves: base + amount, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    if (error) {
      reportRlsBlock('update')
      return
    }
    await supabase.from('leaf_transactions').insert({ user_id: userId, amount, reason: 'admin-grant' })
  }

  const pendingAccess = useMemo(
    () => accessRequests.filter(r => r.status === 'pending'),
    [accessRequests],
  )

  // Fetch users from profiles table (or demo fallback). The whole body
  // lives in the async IIFE so no setState runs synchronously inside the
  // effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    ;(async () => {
      if (!SUPABASE_CONFIGURED) {
        // Demo: just the current profile, filtered against any
        // previously-deleted user ids stored in localStorage so the
        // delete action actually persists across reloads.
        if (profile) {
          let removed: string[] = []
          try {
            const raw = window.localStorage.getItem('ft-admin-removed-users')
            if (raw) removed = JSON.parse(raw) as string[]
          } catch { /* fall through with empty list */ }
          if (removed.includes(profile.id)) {
            setUsers([])
          } else {
            setUsers([{
              ...profile,
              email: 'demo@familytree.local',
              created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
            }])
          }
        }
        return
      }
      setUsersLoading(true)
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
      if (error) {
        // Surface the underlying failure (RLS blocks, missing table)
        // so admins can act on it instead of staring at an empty list.
        console.warn('[admin] profiles fetch failed:', error.message)
        setBackendError(error.message)
      } else {
        setBackendError(null)
      }
      const rows = (data ?? []) as AdminUser[]
      setUsers(rows)

      // Verify the current user's DB-side admin status against the
      // policy: is_admin(uid) requires role='admin' AND active=true.
      // Without this check the local store can say "admin" while the
      // DB row says otherwise (e.g. promote-SQL was never run), and
      // every mutation will silently fail RLS until the user fixes
      // the drift. We also grab their email so the banner below can
      // hand them ready-to-paste diagnostic SQL.
      if (profile) {
        const meRow = rows.find(u => u.id === profile.id)
        const { data: authData } = await supabase.auth.getUser()
        const email = authData.user?.email ?? null
        if (!meRow) {
          setDbAdminStatus({ ok: false, role: null, active: null, email })
        } else {
          const role = (meRow as unknown as { role?: string }).role ?? null
          const active = (meRow as unknown as { active?: boolean }).active
          const activeBool = active === undefined ? true : !!active
          setDbAdminStatus({
            ok: role === 'admin' && activeBool,
            role,
            active: activeBool,
            email,
          })
        }
      }
      setUsersLoading(false)
    })()
  }, [profile])

  const filteredMembers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return members
    return members.filter(m =>
      `${m.first_name} ${m.last_name} ${m.nickname ?? ''}`.toLowerCase().includes(q),
    )
  }, [members, searchTerm])

  // Unified inbox — every queue that can hold pending admin work, in
  // one place. The header badge, tab pills and the overview card all
  // read from this so the numbers can never disagree.
  const inbox = useMemo(
    () => adminInboxCounts(editRequests, accessRequests, feedback),
    [editRequests, accessRequests, feedback],
  )
  const pendingCount = inbox.total
  const deceased = members.filter(m => m.death_date).length
  const alive = members.length - deceased
  const tabBadges: Partial<Record<Tab, number>> = {
    requests: inbox.edits,
    access: inbox.access + inbox.shareCodes,
    reports: inbox.reports,
  }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="min-h-screen bg-mesh-gradient pb-10">
      {/* Top bar */}
      <div className="px-4 pt-3 pb-2 max-w-4xl mx-auto">
        <div className="glass rounded-2xl px-3 py-2 flex items-center gap-3 shadow-glass-sm">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate('/home')}
            className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center border border-white/60"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d={rtl ? 'M5 3l4 4-4 4' : 'M9 3L5 7l4 4'} stroke="#636366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
          <div className="flex-1">
            <h1 className="text-sf-headline font-bold text-[#1C1C1E] leading-none flex items-center gap-2">
              <span>🛠️</span> {t.adminTitle}
            </h1>
            <p className="text-[11px] text-[#8E8E93] mt-0.5">{t.adminSubtitle}</p>
          </div>
          {pendingCount > 0 && (
            <motion.div
              initial={{ scale: 0.7 }} animate={{ scale: 1 }}
              className="w-7 h-7 bg-[#FF3B30] rounded-full flex items-center justify-center"
            >
              <span className="text-white text-[11px] font-bold">{pendingCount}</span>
            </motion.div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 space-y-4">
        {/* Backend setup nudge. Surfaces when ANY of the admin
            queries failed — almost always means `schema.sql` hasn't
            been applied to the Supabase project yet (missing tables
            or RLS policies). Better to point the admin at the fix
            than let them stare at empty lists. */}
        {backendError && SUPABASE_CONFIGURED && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-[#FF9F0A]/40 bg-[#FF9F0A]/10 p-3 flex items-start gap-2"
          >
            <span className="text-lg leading-none">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sf-subhead font-bold text-[#1C1C1E]">
                {lang === 'he' ? 'הגדרות הבקאנד חסרות' : 'Backend setup incomplete'}
              </p>
              <p className="text-[11px] text-[#3A3A3C] leading-snug mt-0.5">
                {lang === 'he'
                  ? `Supabase מחזיר שגיאה: ${backendError}. כנראה ש-schema.sql לא רץ. ראה הוראות הרצה ב-SUPABASE_SETUP_HE.md בריפו.`
                  : `Supabase returned: ${backendError}. Likely schema.sql hasn't been applied. See SUPABASE_SETUP_HE.md in the repo.`}
              </p>
              <a
                href="https://github.com/yakiradler/adler-family-tree/blob/main/SUPABASE_SETUP_HE.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1.5 text-[11px] font-bold text-[#FF9F0A] underline"
              >
                {lang === 'he' ? '← פתח את מדריך החיבור' : 'Open the setup guide →'}
              </a>
            </div>
          </motion.div>
        )}

        {/*
          Admin-drift banner. Fires when the LOCAL store says the
          user is admin but the DB-side row says otherwise (wrong
          role, or active=false) — which is what triggers the silent
          RLS block we saw on "remove user". The banner gives the
          user the exact SQL to fix it with their email pre-filled,
          and a one-click jump to the project's SQL Editor.
        */}
        {SUPABASE_CONFIGURED && dbAdminStatus && !dbAdminStatus.ok && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 p-3"
          >
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none">🚫</span>
              <div className="flex-1 min-w-0">
                <p className="text-sf-subhead font-bold text-[#1C1C1E]">
                  {lang === 'he'
                    ? 'אינך admin בפועל ב-Supabase'
                    : "You're not actually admin in Supabase"}
                </p>
                <p className="text-[11px] text-[#3A3A3C] leading-snug mt-0.5">
                  {lang === 'he'
                    ? `המערכת המקומית מציגה אותך כ-admin, אבל ב-DB: role='${dbAdminStatus.role ?? 'לא קיים'}', active=${dbAdminStatus.active ?? 'לא קיים'}. RLS חוסם את כל הפעולות עד שתתקן את זה.`
                    : `The local store shows you as admin but the DB row reads role='${dbAdminStatus.role ?? 'missing'}', active=${dbAdminStatus.active ?? 'missing'}. RLS will block every mutation until you fix this.`}
                </p>
                {/* Pre-filled SQL — one-shot fix. */}
                <pre className="mt-2 bg-[#1C1C1E] text-[#34C759] text-[11px] leading-snug rounded-xl p-2.5 overflow-x-auto font-mono">
{`update public.profiles
set role = 'admin', active = true
where email = '${dbAdminStatus.email ?? '<האימייל-שלך>'}';`}
                </pre>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const sql = `update public.profiles\nset role = 'admin', active = true\nwhere email = '${dbAdminStatus.email ?? ''}';`
                      navigator.clipboard?.writeText(sql).catch(() => {})
                    }}
                    className="text-[11px] font-bold bg-white/80 border border-[#FF3B30]/30 text-[#FF3B30] rounded-lg px-2.5 py-1 hover:bg-white"
                  >
                    {lang === 'he' ? '📋 העתק SQL' : '📋 Copy SQL'}
                  </button>
                  <a
                    href="https://supabase.com/dashboard/project/_/sql/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-[#FF3B30] underline"
                  >
                    {lang === 'he' ? '← פתח SQL Editor' : 'Open SQL Editor →'}
                  </a>
                  <span className="text-[10px] text-[#8E8E93]">
                    {lang === 'he'
                      ? 'אחרי שתריץ — התנתק והתחבר מחדש'
                      : 'After running — sign out and back in'}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tab bar */}
        <div className="glass-strong rounded-2xl p-1 flex gap-1 shadow-glass-sm overflow-x-auto">
          {([
            ['overview', t.adminTabOverview, '📊'],
            ['trees', t.adminTabTrees, '🌲'],
            ['users', t.adminTabUsers, '👥'],
            ['requests', t.adminTabRequests, '🔔'],
            ['access', t.adminTabAccess, '🚪'],
            ['reports', t.adminTabReports, '🐞'],
            ['invites', t.adminTabInvites, '🔑'],
            ['system', t.adminTabSystem, '⚙️'],
          ] as const).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${
                tab === key ? 'bg-[#007AFF] text-white shadow-sm' : 'text-[#636366]'
              }`}
            >
              <span>{icon}</span>
              {label}
              {/* Pending-work pill — keeps the queue sizes visible
                  without opening each tab. */}
              {(tabBadges[key] ?? 0) > 0 && (
                <span
                  className={`min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    tab === key ? 'bg-white text-[#007AFF]' : 'bg-[#FF3B30] text-white'
                  }`}
                >
                  {tabBadges[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          {tab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* Big stat grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <BigStat label={t.membersCount} value={members.length} icon="👨‍👩‍👧" grad="from-[#007AFF] to-[#32ADE6]" />
                <BigStat label={t.adminTabUsers} value={users.length} icon="👤" grad="from-[#32ADE6] to-[#5AC8FA]" />
                <BigStat label={t.adminTabRequests} value={pendingCount} icon="🔔" grad="from-[#5AC8FA] to-[#64D2FF]" />
                <BigStat label={t.statDeceased} value={deceased} icon="🕯️" grad="from-[#8E8E93] to-[#636366]" />
              </div>

              {/* Breakdown card */}
              <div className="glass-strong rounded-3xl p-5 shadow-glass">
                <h3 className="text-sf-subhead font-bold text-[#1C1C1E] mb-3">📈 {t.adminTabOverview}</h3>
                <div className="space-y-3">
                  <ProgressRow label={t.statAlive} count={alive} total={members.length} color="#34C759" />
                  <ProgressRow label={t.statDeceased} count={deceased} total={members.length} color="#8E8E93" />
                </div>
              </div>

              {/* Unified inbox — one card, four queues, each a direct
                  jump to its tab. Answers "כמה בקשות מחכות לי" at a
                  glance instead of forcing a tab-by-tab hunt. */}
              <div className="glass-strong rounded-3xl p-5 shadow-glass">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">📥 {t.adminInboxTitle}</h3>
                  {pendingCount > 0 && (
                    <span className="w-7 h-7 bg-[#FF3B30] rounded-full flex items-center justify-center text-white text-[11px] font-bold">
                      {pendingCount}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    ['requests', t.adminInboxEdits, '✏️', inbox.edits],
                    ['access', t.adminInboxAccess, '🚪', inbox.access],
                    ['access', t.adminInboxShareCodes, '🔑', inbox.shareCodes],
                    ['reports', t.adminInboxReports, '🐞', inbox.reports],
                  ] as const).map(([targetTab, label, icon, count], i) => (
                    <button
                      key={`${targetTab}-${i}`}
                      onClick={() => setTab(targetTab)}
                      className="rounded-2xl bg-white/70 border border-white/60 px-3 py-2.5 flex flex-col items-center gap-1 hover:bg-white transition"
                    >
                      <span className="text-lg" aria-hidden>{icon}</span>
                      <span className={`text-[18px] font-extrabold leading-none ${count > 0 ? 'text-[#FF3B30]' : 'text-[#1C1C1E]'}`}>
                        {count}
                      </span>
                      <span className="text-[10px] text-[#636366] font-semibold text-center leading-tight">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {tab === 'users' && (
            <motion.div
              key="users"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <SectionHeader title={t.adminUsersTitle} desc={t.adminUsersDesc} />

              {/* Invite new user — full CRM flow */}
              <div className="glass-strong rounded-3xl p-4 shadow-glass space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#007AFF] to-[#32ADE6] flex items-center justify-center text-white shadow-md">
                    <span className="text-lg">➕</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sf-subhead font-bold text-[#1C1C1E]">{t.adminInviteTitle}</p>
                    <p className="text-[11px] text-[#8E8E93]">{t.adminInviteDesc}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={inviteName}
                    onChange={e => setInviteName(e.target.value)}
                    placeholder={t.adminInviteName}
                    className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/50"
                  />
                  <input
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    type="email"
                    placeholder={t.adminInviteEmail}
                    className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#007AFF]/50"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-[200px] bg-[#F2F2F7] rounded-xl p-1 flex gap-1">
                    {ROLE_OPTIONS.map(r => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setInviteRole(r.key)}
                        aria-label={t[r.labelKey]}
                        title={t[r.labelKey]}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition flex flex-col items-center gap-0.5 ${
                          inviteRole === r.key
                            ? 'bg-white text-[#1C1C1E] shadow-sm'
                            : 'text-[#636366]'
                        }`}
                      >
                        {/* Label ALWAYS visible (mobile + desktop) —
                            the previous hidden-on-small-screens setup
                            left users guessing what each emoji meant. */}
                        <span className="text-[14px] leading-none">{r.icon}</span>
                        <span className="text-[9.5px] font-bold whitespace-nowrap">{t[r.labelKey]}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={inviteUser}
                    disabled={!inviteEmail.trim() || !inviteName.trim() || inviting}
                    className="py-2 px-4 rounded-xl bg-gradient-to-r from-[#007AFF] to-[#32ADE6] text-white text-sf-subhead font-bold shadow-md disabled:opacity-40"
                  >
                    {inviting ? '…' : t.adminInviteSend}
                  </button>
                </div>
              </div>

              <div className="glass-strong rounded-2xl p-3 shadow-glass-sm flex items-start gap-2">
                <span className="text-lg">🔒</span>
                <p className="text-[11px] text-[#636366] leading-relaxed">{t.adminPasswordNote}</p>
              </div>

              {usersLoading ? (
                <div className="text-center py-10 text-[#8E8E93]">...</div>
              ) : users.length === 0 ? (
                <EmptyBlock icon="👤" text={t.adminNoUsers} />
              ) : (
                <div className="space-y-2">
                  {users.map(u => (
                    <div key={u.id} className="space-y-1">
                      <UserRow
                        user={u}
                        t={t}
                        rtl={rtl}
                        demo={!SUPABASE_CONFIGURED}
                        lang={lang}
                        onRoleChange={changeUserRole}
                        onToggleActive={toggleUserActive}
                        onRemove={removeUser}
                        onRestore={restoreUser}
                        onMasterPermChange={changeMasterPerm}
                      />
                      {/* Subscription controls — the manual "billing
                          desk" of Phase A. */}
                      {SUPABASE_CONFIGURED && (
                        <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 rounded-2xl bg-white/50 border border-white/60">
                          <span className="text-[10.5px] font-bold text-[#8E8E93]">{t.adminPlanLabel}:</span>
                          {(['free', 'family', 'premium'] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setUserPlanTier(u.id, p)}
                              className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition ${
                                (userPlans[u.id]?.plan ?? 'free') === p
                                  ? 'bg-[#007AFF] text-white'
                                  : 'bg-[#F2F2F7] text-[#636366]'
                              }`}
                            >
                              {p === 'free' ? t.planFree : p === 'family' ? t.planFamily : t.planPremium}
                            </button>
                          ))}
                          <span className="ms-auto text-[10.5px] font-bold text-[#34C759]">
                            🍃 {userPlans[u.id]?.leaves ?? 0} {t.planLeaves}
                          </span>
                          <button
                            type="button"
                            onClick={() => grantLeaves(u.id, 50)}
                            className="px-2 py-0.5 rounded-lg text-[10.5px] font-bold bg-[#34C759]/12 text-[#34C759]"
                          >
                            {t.adminGrantLeaves}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'trees' && (
            <motion.div
              key="trees"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-2"
            >
              {trees.length === 0 ? (
                <p className="text-center text-sf-subhead text-[#8E8E93] py-8">—</p>
              ) : (
                trees.map((tr) => {
                  const count = members.filter((m) => m.tree_id === tr.id).length
                  return (
                    <div key={tr.id} className="flex items-center gap-3 bg-[#F2F2F7] rounded-2xl p-3">
                      <span className="text-xl" aria-hidden>🌳</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">{tr.name}</p>
                        <p className="text-[11px] text-[#8E8E93]">{count} {t.adminTreesMembers}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setManageTree({ id: tr.id, name: tr.name })}
                        className="px-3 py-1.5 rounded-xl bg-[#007AFF] text-white text-[12px] font-bold"
                      >
                        {t.adminTreesManage}
                      </button>
                    </div>
                  )
                })
              )}
            </motion.div>
          )}

          {tab === 'members' && (
            <motion.div
              key="members"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <SectionHeader title={t.adminMembersTitle} desc={t.adminMembersDesc} />

              {/* Search */}
              <div className="relative">
                <input
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder={t.adminSearchMember}
                  className="w-full bg-white/70 border border-white/60 rounded-2xl pl-10 pr-3 py-2.5 text-sf-subhead text-[#1C1C1E] placeholder:text-[#8E8E93] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 backdrop-blur"
                  style={{ paddingInlineStart: '2.5rem' }}
                />
                <svg
                  className="absolute top-1/2 -translate-y-1/2 text-[#8E8E93]"
                  style={{ [rtl ? 'right' : 'left']: 12 } as React.CSSProperties}
                  width="16" height="16" viewBox="0 0 16 16" fill="none"
                >
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>

              <div className="grid sm:grid-cols-2 gap-2">
                {filteredMembers.map(m => (
                  <MemberAdminRow
                    key={m.id}
                    member={m}
                    t={t}
                    onEdit={() => setEditTarget(m)}
                    onDelete={async () => {
                      if (await confirmDialog({ message: t.adminConfirmDelete, danger: true })) await deleteMember(m.id)
                    }}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {tab === 'requests' && (
            <motion.div
              key="requests"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <SectionHeader title={t.notificationCenter} desc={t.pendingRequests} />
              {editRequests.length === 0 ? (
                <EmptyBlock icon="✅" text={t.noPending} />
              ) : (
                <div className="space-y-3">
                  {editRequests.map((req, i) => (
                    <RequestCard key={req.id} request={req} index={i} t={t} lang={lang}
                      onApprove={() => approveEditRequest(req.id)}
                      onReject={() => rejectEditRequest(req.id)} />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'access' && (
            <motion.div
              key="access"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <SectionHeader title={t.adminAccessTitle} desc={t.adminAccessDesc} />
              {pendingAccess.length === 0 ? (
                <EmptyBlock icon="✅" text={t.adminAccessNoPending} />
              ) : (
                <div className="space-y-3">
                  {pendingAccess.map((req, i) => (
                    <AccessRequestCard
                      key={req.id}
                      request={req}
                      index={i}
                      t={t}
                      onApprove={(role) => decideAccessRequest(req.id, 'approved', role)}
                      onReject={() => decideAccessRequest(req.id, 'rejected')}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'reports' && (
            <motion.div
              key="reports"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <SectionHeader title={t.adminReportsTitle} desc={t.adminReportsDesc} />
              {feedback.length === 0 ? (
                <EmptyBlock icon="📭" text={t.adminReportsEmpty} />
              ) : (
                <div className="space-y-2">
                  {feedback.map((f) => (
                    <div
                      key={f.id}
                      className={`glass-strong rounded-3xl p-4 shadow-glass space-y-2 ${
                        f.status === 'resolved' ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                          f.category === 'bug'
                            ? 'bg-[#FF3B30]/12 text-[#FF3B30]'
                            : 'bg-[#5E5CE6]/12 text-[#5E5CE6]'
                        }`}>
                          {f.category === 'bug' ? t.feedbackCategoryBug : t.feedbackCategoryQuestion}
                        </span>
                        <span className="text-[11.5px] font-semibold text-[#1C1C1E]">{f.author_name}</span>
                        <span className="text-[10.5px] text-[#8E8E93]" dir="ltr">
                          {new Date(f.created_at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </span>
                        {f.status === 'resolved' && (
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-[#34C759]/12 text-[#34C759]">
                            {t.feedbackStatusResolved}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-[#3C3C43] leading-relaxed whitespace-pre-line">{f.body}</p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => updateFeedback(f.id, {
                            status: f.status === 'resolved' ? 'open' : 'resolved',
                          })}
                          className={`px-3 py-1.5 rounded-xl text-[11.5px] font-bold transition ${
                            f.status === 'resolved'
                              ? 'bg-[#F2F2F7] text-[#636366]'
                              : 'bg-[#34C759] text-white'
                          }`}
                        >
                          {f.status === 'resolved' ? t.feedbackReopen : t.feedbackMarkResolved}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (await confirmDialog({ message: t.feedbackDeleteConfirm, danger: true })) deleteFeedback(f.id)
                          }}
                          className="px-3 py-1.5 rounded-xl text-[11.5px] font-bold text-[#FF3B30] hover:bg-[#FF3B30]/8 transition"
                        >
                          {t.feedbackDelete}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'invites' && (
            <motion.div
              key="invites"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <SectionHeader title={t.adminInvitesTitle} desc={t.adminInvitesDesc} />
              <InviteCodeManager />
            </motion.div>
          )}

          {tab === 'system' && (
            <motion.div
              key="system"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <SectionHeader title={t.adminSystemTitle} desc={t.adminSubtitle} />

              <div className="glass-strong rounded-3xl p-5 shadow-glass space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sf-subhead font-medium text-[#1C1C1E]">{t.adminSystemMode}</span>
                  <span className={`text-[11px] font-bold rounded-full px-3 py-1 ${
                    SUPABASE_CONFIGURED
                      ? 'bg-[#34C759]/15 text-[#34C759]'
                      : 'bg-[#32ADE6]/15 text-[#32ADE6]'
                  }`}>
                    {SUPABASE_CONFIGURED ? t.adminLiveMode : t.adminDemoMode}
                  </span>
                </div>
                <div className="h-px bg-[#E5E5EA]" />
                <button
                  onClick={() => exportData(members)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-2xl bg-[#F2F2F7] hover:bg-[#E5E5EA] transition"
                >
                  <span className="text-sf-subhead font-medium text-[#1C1C1E] flex items-center gap-2">
                    <span>📥</span> {t.adminExportData}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d={rtl ? 'M7 3L3 6l4 3' : 'M5 3l4 3-4 3'} stroke="#8E8E93" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <SpecialAdminControls
                t={t}
                membersCount={members.length}
                onRefresh={() => {
                  const s = useFamilyStore.getState()
                  s.fetchMembers(); s.fetchRelationships(); s.fetchEditRequests()
                  if (SUPABASE_CONFIGURED) s.fetchAccessRequests()
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {editTarget && (
        <EditMemberModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          member={editTarget}
        />
      )}
      {manageTree && (
        <TreeManagePanel
          open
          onClose={() => setManageTree(null)}
          treeId={manageTree.id}
          treeName={manageTree.name}
        />
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BigStat({ label, value, icon, grad }: { label: string; value: number; icon: string; grad: string }) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`relative overflow-hidden rounded-2xl p-3 shadow-glass-sm text-white bg-gradient-to-br ${grad}`}
    >
      <div className="absolute -top-4 -right-4 w-14 h-14 bg-white/15 rounded-full blur-xl" />
      <div className="relative flex flex-col items-start gap-0.5">
        <span className="text-lg leading-none">{icon}</span>
        <p className="text-2xl font-bold leading-none mt-1.5">{value}</p>
        <p className="text-[10px] font-medium opacity-90 leading-none">{label}</p>
      </div>
    </motion.div>
  )
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="px-1">
      <h2 className="text-sf-headline font-bold text-[#1C1C1E]">{title}</h2>
      <p className="text-[11px] text-[#8E8E93] mt-0.5">{desc}</p>
    </div>
  )
}

function ProgressRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total === 0 ? 0 : (count / total) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sf-caption font-medium text-[#636366]">{label}</span>
        <span className="text-sf-caption font-bold text-[#1C1C1E]" dir="ltr">{count} / {total}</span>
      </div>
      <div className="h-2 bg-[#F2F2F7] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ background: color }}
          className="h-full rounded-full"
        />
      </div>
    </div>
  )
}

function UserRow({
  user, t, rtl, demo, lang, onRoleChange, onToggleActive, onRemove, onRestore, onMasterPermChange,
}: {
  user: AdminUser
  t: Translations
  rtl: boolean
  demo: boolean
  lang: 'he' | 'en'
  onRoleChange: (u: AdminUser, role: UserRole) => void
  onToggleActive: (u: AdminUser) => void
  onRemove: (u: AdminUser) => void
  onRestore: (u: AdminUser) => void
  onMasterPermChange: (u: AdminUser, key: PermissionKey, value: boolean) => void
}) {
  const [showPerms, setShowPerms] = useState(false)
  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString(rtl ? 'he-IL' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—'
  const isActive = (user as unknown as { active?: boolean }).active !== false
  const roleLabel = ROLE_OPTIONS.find(r => r.key === user.role)
  const perms = user.master_permissions ?? {}

  const handleReset = async () => {
    if (demo) { void alertDialog({ message: t.adminDemoAlert }); return }
    if (!user.email) return
    await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/`,
    })
    await alertDialog({ message: `${t.adminSendReset} ✓` })
  }

  return (
    <div className="glass-strong rounded-2xl p-3 shadow-glass-sm">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#007AFF] to-[#32ADE6] flex items-center justify-center text-white font-bold">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span>{(user.full_name ?? '?').charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">{user.full_name}</p>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${roleBadgeClass(user.role)}`}>
              {roleLabel?.icon} {roleLabel ? t[roleLabel.labelKey] : user.role}
            </span>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
              isActive ? 'bg-[#34C759]/15 text-[#34C759]' : 'bg-[#8E8E93]/15 text-[#636366]'
            }`}>
              {isActive ? t.adminUserActive : t.adminUserInactive}
            </span>
          </div>
          {user.email && <p className="text-[11px] text-[#8E8E93] truncate">{user.email}</p>}
          <p className="text-[10px] text-[#C7C7CC]">{t.adminJoinedOn} {joined}</p>
        </div>
      </div>

      {/* Role picker — 4-tier. Labels ALWAYS visible (mobile too)
          per a user complaint that the bare emojis were ambiguous. */}
      <div className="mt-3 bg-[#F2F2F7] rounded-xl p-1 flex gap-1">
        {ROLE_OPTIONS.map(r => (
          <button
            key={r.key}
            type="button"
            onClick={() => onRoleChange(user, r.key)}
            title={t[r.labelKey]}
            aria-label={t[r.labelKey]}
            aria-pressed={user.role === r.key}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition flex flex-col items-center gap-0.5 ${
              user.role === r.key
                ? 'bg-white text-[#1C1C1E] shadow-sm'
                : 'text-[#636366] hover:bg-white/40'
            }`}
          >
            <span className="text-[14px] leading-none">{r.icon}</span>
            <span className="text-[9.5px] font-bold whitespace-nowrap">{t[r.labelKey]}</span>
          </button>
        ))}
      </div>

      {/* Action strip — labeled buttons */}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <ActionChip
          label={isActive ? t.adminDeactivate : t.adminActivate}
          onClick={() => onToggleActive(user)}
          color={isActive ? 'gray' : 'cyan'}
          icon={isActive ? '⏸' : '▶'}
        />
        <ActionChip
          label={t.adminSendReset}
          onClick={handleReset}
          color="cyan"
          icon="🔑"
        />
        <ActionChip
          label={showPerms ? t.adminPermsHidden : t.adminTogglePerms}
          onClick={() => setShowPerms(v => !v)}
          color="blue"
          icon="🛡"
        />
        {user.deleted_at ? (
          <ActionChip
            label={lang === 'he' ? 'שחזר' : 'Restore'}
            onClick={() => onRestore(user)}
            color="cyan"
            icon="♻"
          />
        ) : (
          <ActionChip
            label={t.adminRemoveUser}
            onClick={() => onRemove(user)}
            color="red"
            icon="🗑"
          />
        )}
      </div>

      {user.deleted_at && (
        <div className="mt-2 rounded-2xl bg-[#FFD60A]/15 px-3 py-2 text-[11px] text-[#A06E00] font-medium">
          {lang === 'he'
            ? `מושעה מאז ${new Date(user.deleted_at).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' })} — יוסר אוטומטית אחרי 30 יום`
            : `Suspended since ${new Date(user.deleted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} — auto-removed after 30 days`}
        </div>
      )}

      {/* Master permissions panel — only meaningful for masters,
          but admins implicitly have everything; shown if user toggles. */}
      <AnimatePresence initial={false}>
        {showPerms && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl bg-[#F2F2F7]/60 p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sf-caption font-bold text-[#1C1C1E]">{t.adminMasterPerms}</p>
                <p className="text-[10px] text-[#8E8E93]">{t.adminMasterPermsDesc}</p>
              </div>
              {user.role === 'admin' ? (
                <p className="text-[11px] text-[#34C759] font-medium">
                  👑 admin — {Object.values(PERM_LABEL).map(k => t[k]).join(' · ')}
                </p>
              ) : user.role === 'guest' ? (
                <p className="text-[11px] text-[#8E8E93] font-medium">
                  👤 {t.adminRoleGuest} — read-only
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {PERM_KEYS.map(k => (
                    <PermToggle
                      key={k}
                      label={t[PERM_LABEL[k]]}
                      checked={user.role === 'master' ? Boolean(perms[k]) : false}
                      disabled={user.role !== 'master'}
                      onChange={(v) => onMasterPermChange(user, k, v)}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PermToggle({
  label, checked, onChange, disabled,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[11px] font-semibold transition ${
        disabled
          ? 'bg-white/30 text-[#C7C7CC] cursor-not-allowed'
          : checked
            ? 'bg-[#34C759]/15 text-[#34C759]'
            : 'bg-white text-[#636366] hover:bg-white/80'
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        aria-hidden
        className={`w-8 h-5 rounded-full relative transition ${
          checked ? 'bg-[#34C759]' : 'bg-[#C7C7CC]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

function ActionChip({
  label, onClick, color, icon,
}: {
  label: string
  onClick: () => void
  color: 'blue' | 'cyan' | 'red' | 'gray'
  icon: string
}) {
  const styles = {
    blue: 'bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20',
    cyan: 'bg-[#32ADE6]/10 text-[#32ADE6] hover:bg-[#32ADE6]/20',
    red:  'bg-[#FF3B30]/10 text-[#FF3B30] hover:bg-[#FF3B30]/20',
    gray: 'bg-[#8E8E93]/10 text-[#636366] hover:bg-[#8E8E93]/20',
  }[color]
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold transition ${styles}`}
    >
      <span aria-hidden>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function MemberAdminRow({
  member, t, onEdit, onDelete,
}: { member: Member; t: Translations; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="glass-strong rounded-2xl p-2.5 shadow-glass-sm flex items-center gap-2.5">
      <div className="rounded-full flex-shrink-0" style={{ padding: 1.5, background: getRingGradient(member) }}>
        <div className="rounded-full bg-white p-[1px]">
          <div className="w-9 h-9 rounded-full overflow-hidden">
            {member.photo_url ? (
              <img src={member.photo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${getFallbackGradient(member)} flex items-center justify-center`}>
                <PersonAvatarIcon gender={member.gender} size={36} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sf-footnote font-semibold text-[#1C1C1E] truncate">
          {member.first_name} {member.last_name}
        </p>
        <p className="text-[10px] text-[#8E8E93] truncate">
          {member.birth_date ? new Date(member.birth_date).getFullYear() : ''}
          {member.death_date ? ` – ${new Date(member.death_date).getFullYear()}` : ''}
          {member.gender && ` · ${member.gender === 'male' ? '♂' : '♀'}`}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onEdit}
          title={t.adminEdit}
          className="w-7 h-7 rounded-lg bg-[#007AFF]/10 flex items-center justify-center hover:bg-[#007AFF]/20 transition"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 9V10h1L9.5 3.5 8.5 2.5 2 9z" fill="#007AFF" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          title={t.adminDelete}
          className="w-7 h-7 rounded-lg bg-[#FF3B30]/10 flex items-center justify-center hover:bg-[#FF3B30]/20 transition"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function EmptyBlock({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="glass-strong rounded-3xl p-10 text-center shadow-glass">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F2F2F7] flex items-center justify-center mb-2">
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-sf-subhead text-[#8E8E93]">{text}</p>
    </div>
  )
}

/**
 * Special-controls panel — maintenance actions surfaced only to admins.
 * Kept simple on purpose: refresh store, clear cache, show build/env info.
 * Anything destructive asks via the in-app confirm dialog before executing.
 */
function SpecialAdminControls({
  t, membersCount, onRefresh,
}: {
  t: Translations
  membersCount: number
  onRefresh: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const buildVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev'

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.resolve(onRefresh())
    } finally {
      setTimeout(() => setRefreshing(false), 500)
    }
  }

  const clearCache = async () => {
    if (!(await confirmDialog({ message: t.adminClearCacheConfirm, danger: true }))) return
    try {
      // Best-effort: remove our app's localStorage keys, sign out of Supabase,
      // then hard-reload so the app re-initialises clean.
      localStorage.clear()
      sessionStorage.clear()
      if (SUPABASE_CONFIGURED) {
        try { await supabase.auth.signOut() } catch { /* best-effort — reload follows anyway */ }
      }
    } finally {
      window.location.reload()
    }
  }

  return (
    <div className="glass-strong rounded-3xl p-5 shadow-glass space-y-3">
      <div>
        <h3 className="text-sf-subhead font-bold text-[#1C1C1E]">⚡ {t.adminSpecialTitle}</h3>
        <p className="text-[11px] text-[#8E8E93] mt-0.5">{t.adminSpecialDesc}</p>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-3 gap-2">
        <InfoTile label={t.adminBuildVersion} value={buildVersion} />
        <InfoTile
          label={t.adminBuildEnv}
          value={SUPABASE_CONFIGURED ? t.adminEnvLive : t.adminEnvDemo}
          tone={SUPABASE_CONFIGURED ? 'green' : 'cyan'}
        />
        <InfoTile label={t.adminTotalRecords} value={String(membersCount)} />
      </div>

      <div className="h-px bg-[#E5E5EA]" />

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={doRefresh}
          disabled={refreshing}
          className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-[#007AFF]/10 text-[#007AFF] text-[12px] font-semibold hover:bg-[#007AFF]/20 disabled:opacity-50 transition"
        >
          <motion.span
            animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
            transition={refreshing ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
            aria-hidden
          >
            🔄
          </motion.span>
          {t.adminRefreshData}
        </button>
        <button
          type="button"
          onClick={clearCache}
          className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-[#FF3B30]/10 text-[#FF3B30] text-[12px] font-semibold hover:bg-[#FF3B30]/20 transition"
        >
          <span aria-hidden>🧹</span>
          {t.adminClearCache}
        </button>
      </div>
    </div>
  )
}

function InfoTile({
  label, value, tone = 'gray',
}: {
  label: string
  value: string
  tone?: 'gray' | 'green' | 'cyan'
}) {
  const toneClass = {
    gray:  'bg-[#F2F2F7] text-[#1C1C1E]',
    green: 'bg-[#34C759]/15 text-[#34C759]',
    cyan:  'bg-[#32ADE6]/15 text-[#32ADE6]',
  }[tone]
  return (
    <div className={`rounded-2xl p-2.5 ${toneClass}`}>
      <p className="text-[10px] font-semibold opacity-70 uppercase tracking-wider">{label}</p>
      <p className="text-sf-subhead font-bold mt-0.5 truncate" dir="ltr">{value}</p>
    </div>
  )
}

function exportData(members: Member[]) {
  const blob = new Blob([JSON.stringify(members, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `family-tree-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Existing RequestCard (kept from previous design) ────────────────────────

interface RequestCardProps {
  request: EditRequest
  index: number
  t: Translations
  lang: string
  onApprove: () => void
  onReject: () => void
}

function RequestCard({ request, index, t, lang, onApprove, onReject }: RequestCardProps) {
  const changes = Object.entries(request.change_data)
  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="glass-strong rounded-3xl p-4 shadow-glass">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sf-subhead font-semibold text-[#1C1C1E]">
            {t.editRequestFor} <span className="text-[#007AFF]">{request.target_member_name}</span>
          </p>
          <p className="text-sf-caption text-[#8E8E93] mt-0.5">
            {t.from} {request.requester_name} · {formatRelativeTime(request.created_at, t, lang)}
          </p>
        </div>
        <span className="flex-shrink-0 text-sf-caption2 bg-[#5AC8FA]/10 text-[#32ADE6] rounded-full px-2.5 py-1 font-medium">
          {t.pendingStatus}
        </span>
      </div>

      <div className="bg-[#F2F2F7]/80 rounded-2xl p-3 mb-4 space-y-2">
        <p className="text-sf-caption font-semibold text-[#8E8E93] uppercase tracking-wider">{t.proposedChanges}</p>
        {changes.map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-sf-caption text-[#636366] capitalize">{key.replace('_', ' ')}:</span>
            <span className="text-sf-caption font-medium text-[#1C1C1E] truncate">{String(value)}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <motion.button whileTap={{ scale: 0.94 }} onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#34C759] text-white rounded-2xl text-sf-subhead font-semibold shadow-sm hover:bg-[#2DB34A] transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7l4 4 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t.approve}
        </motion.button>
        <motion.button whileTap={{ scale: 0.94 }} onClick={onReject}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#FF3B30]/10 text-[#FF3B30] rounded-2xl text-sf-subhead font-semibold border border-[#FF3B30]/20 hover:bg-[#FF3B30]/20 transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t.reject}
        </motion.button>
      </div>
    </motion.div>
  )
}

// ─── Access request card (Phase D) ───────────────────────────────────────────

interface AccessRequestCardProps {
  request: AccessRequest
  index: number
  t: Translations
  onApprove: (role: TreeRole) => void
  onReject: () => void
}

// Per-tree roles the approver can grant (two-axis model). Default editor.
const TREE_ROLE_OPTIONS: { key: TreeRole; labelKey: 'treeRoleViewer' | 'treeRoleEditor' | 'treeRoleOwner' }[] = [
  { key: 'viewer', labelKey: 'treeRoleViewer' },
  { key: 'editor', labelKey: 'treeRoleEditor' },
  { key: 'owner', labelKey: 'treeRoleOwner' },
]

function AccessRequestCard({ request, index, t, onApprove, onReject }: AccessRequestCardProps) {
  // Grant a per-tree role on approval (default editor — a normal
  // contributing family member). Owners/admins can pick viewer/owner.
  const [grantRole, setGrantRole] = useState<TreeRole>('editor')
  const answers = request.answers ?? {}
  const a = answers as Record<string, unknown>
  const relAnswer = a.relationship as string | undefined
  const purposeAnswer = a.purpose as string | undefined
  const requestedLabel = ROLE_OPTIONS.find(r => r.key === request.requested_role)
  // Tree-access requests are filed by JumpToFamilyTreeButton when a
  // non-admin tries to open a tree they don't have access to. We
  // surface them with a distinct purple chip so an admin scanning the
  // queue can tell them apart from onboarding requests at a glance.
  const isTreeAccess = a.kind === 'tree-access'
  const treeAccessTarget = isTreeAccess ? (a.target_tree_name as string | undefined) : undefined
  const treeAccessNote = isTreeAccess ? (a.note as string | undefined) : undefined
  const viaMember =
    isTreeAccess && a.via_member && typeof a.via_member === 'object'
      ? (a.via_member as { name?: string }).name
      : undefined
  // Long-press → "request share code" flow from the Dashboard tree
  // card lands here too.  We surface it with a distinct 🔑 chip so the
  // admin knows to mint an invite code in the InviteCodeManager tab
  // (rather than approving as a role grant, which has nothing to do
  // with codes).
  const isShareCodeRequest = a.intent === 'request_share_code'
  const shareCodeTargetTree = isShareCodeRequest
    ? (a.target_tree_name as string | undefined)
    : undefined
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="glass-strong rounded-3xl p-4 shadow-glass"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">
            {request.requester_name ?? request.requester_id.slice(0, 8)}
          </p>
          <p className="text-sf-caption text-[#8E8E93] mt-0.5">
            {t.adminAccessRequestedRole}:{' '}
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${roleBadgeClass(request.requested_role)}`}>
              {requestedLabel?.icon} {requestedLabel ? t[requestedLabel.labelKey] : request.requested_role}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-sf-caption2 bg-[#5AC8FA]/10 text-[#32ADE6] rounded-full px-2.5 py-1 font-medium">
            {t.pendingStatus}
          </span>
          {isTreeAccess && (
            <span className="text-[10px] bg-[#5E5CE6]/12 text-[#5E5CE6] rounded-full px-2 py-0.5 font-bold">
              🌲 {t.adminAccessTreeKind}
            </span>
          )}
          {isShareCodeRequest && (
            <span className="text-[10px] bg-[#FF9F0A]/15 text-[#B25F00] rounded-full px-2 py-0.5 font-bold">
              🔑 {t.adminAccessShareCodeKind}
            </span>
          )}
        </div>
      </div>

      <div className="bg-[#F2F2F7]/80 rounded-2xl p-3 mb-3 space-y-1.5">
        {isShareCodeRequest && shareCodeTargetTree && (
          <div className="flex items-baseline gap-2">
            <span className="text-sf-caption text-[#8E8E93]">{t.adminAccessShareCodeTarget}:</span>
            <span className="text-sf-caption font-bold text-[#B25F00]">{shareCodeTargetTree}</span>
          </div>
        )}
        {isShareCodeRequest && (
          <p className="text-[11px] text-[#636366] leading-snug">
            {t.adminAccessShareCodeHint}
          </p>
        )}
        {isTreeAccess && treeAccessTarget && (
          <div className="flex items-baseline gap-2">
            <span className="text-sf-caption text-[#8E8E93]">{t.adminAccessTreeTarget}:</span>
            <span className="text-sf-caption font-bold text-[#5E5CE6]">{treeAccessTarget}</span>
          </div>
        )}
        {isTreeAccess && viaMember && (
          <div className="flex items-baseline gap-2">
            <span className="text-sf-caption text-[#8E8E93]">{t.adminAccessTreeVia}:</span>
            <span className="text-sf-caption font-medium text-[#1C1C1E]">{viaMember}</span>
          </div>
        )}
        {isTreeAccess && treeAccessNote && (
          <div className="flex items-baseline gap-2">
            <span className="text-sf-caption text-[#8E8E93]">📝</span>
            <span className="text-sf-caption text-[#1C1C1E] leading-snug">{treeAccessNote}</span>
          </div>
        )}
        {relAnswer && (
          <div className="flex items-baseline gap-2">
            <span className="text-sf-caption text-[#8E8E93]">{t.adminAccessAnswer_relationship}:</span>
            <span className="text-sf-caption font-medium text-[#1C1C1E]">{relAnswer}</span>
          </div>
        )}
        {purposeAnswer && (
          <div className="flex items-baseline gap-2">
            <span className="text-sf-caption text-[#8E8E93]">{t.adminAccessAnswer_purpose}:</span>
            <span className="text-sf-caption font-medium text-[#1C1C1E]">{purposeAnswer}</span>
          </div>
        )}
        {request.invite_code && (
          <div className="flex items-baseline gap-2">
            <span className="text-sf-caption text-[#8E8E93]">{t.adminAccessInviteCode}:</span>
            <span className="text-sf-caption font-mono font-medium text-[#1C1C1E]" dir="ltr">
              {request.invite_code}
            </span>
          </div>
        )}
      </div>

      {/* Granted-role selector — not relevant when the request is for a
          share code, since granting a code is done in the Invites tab.
          We hide the selector in that case so the admin isn't tempted
          to use it as a substitute. */}
      {!isShareCodeRequest && (
        <div className="mb-3">
          <p className="text-[10px] text-[#8E8E93] mb-1.5 font-semibold">{t.adminAccessApproveAs}</p>
          <div className="bg-[#F2F2F7] rounded-xl p-1 flex gap-1">
            {TREE_ROLE_OPTIONS.map(r => (
              <button
                key={r.key}
                type="button"
                onClick={() => setGrantRole(r.key)}
                aria-pressed={grantRole === r.key}
                aria-label={t[r.labelKey]}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                  grantRole === r.key
                    ? 'bg-white text-[#1C1C1E] shadow-sm'
                    : 'text-[#636366]'
                }`}
              >
                {t[r.labelKey]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => onApprove(grantRole)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#34C759] text-white rounded-2xl text-sf-subhead font-semibold shadow-sm hover:bg-[#2DB34A] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7l4 4 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t.adminAccessApprove}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={onReject}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#FF3B30]/10 text-[#FF3B30] rounded-2xl text-sf-subhead font-semibold border border-[#FF3B30]/20 hover:bg-[#FF3B30]/20 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t.adminAccessReject}
        </motion.button>
      </div>
    </motion.div>
  )
}

function formatRelativeTime(iso: string, t: Translations, lang: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t.justNow
  if (mins < 60) return lang === 'he' ? `לפני ${mins} דקות` : `${mins}${t.minutesAgo}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return lang === 'he' ? `לפני ${hours} שעות` : `${hours}${t.hoursAgo}`
  return lang === 'he' ? `לפני ${Math.floor(hours / 24)} ימים` : `${Math.floor(hours / 24)}${t.daysAgo}`
}
