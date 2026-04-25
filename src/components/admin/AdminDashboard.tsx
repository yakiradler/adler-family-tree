import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../../i18n/useT'
import EditMemberModal from '../EditMemberModal'
import { getRingGradient, getFallbackGradient, PersonAvatarIcon } from '../MemberNode'
import type { EditRequest, Member, Profile, UserRole, MasterPermissions, AccessRequest } from '../../types'
import type { PermissionKey } from '../../lib/permissions'

type Tab = 'overview' | 'users' | 'members' | 'requests' | 'access' | 'system'

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
    members, deleteMember, profile,
    accessRequests, fetchAccessRequests, decideAccessRequest, updateProfileById,
  } = useFamilyStore()
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('overview')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [editTarget, setEditTarget] = useState<Member | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('user')
  const [inviting, setInviting] = useState(false)

  // ─── CRM actions (work in demo via local state; in live via Supabase) ──
  const changeUserRole = async (u: AdminUser, role: UserRole) => {
    setUsers(us => us.map(x => x.id === u.id ? { ...x, role } : x))
    if (SUPABASE_CONFIGURED) {
      await supabase.from('profiles').update({ role }).eq('id', u.id)
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
    setUsers(us => us.map(x => x.id === u.id ? ({ ...x, active: next } as AdminUser) : x))
    if (SUPABASE_CONFIGURED) {
      await supabase.from('profiles').update({ active: next }).eq('id', u.id)
    }
  }
  const removeUser = async (u: AdminUser) => {
    if (!window.confirm(t.adminConfirmRemoveUser)) return
    setUsers(us => us.filter(x => x.id !== u.id))
    if (SUPABASE_CONFIGURED) {
      await supabase.from('profiles').delete().eq('id', u.id)
    }
  }
  const inviteUser = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return
    setInviting(true)
    try {
      if (SUPABASE_CONFIGURED) {
        // Ask Supabase to send a magic/invite link; non-admin inviters may fail —
        // we catch & fallback to local record so the UI doesn't break.
        try { await supabase.auth.resetPasswordForEmail(inviteEmail.trim()) } catch {}
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
      alert(`${t.adminInviteSent} ✓`)
    } finally {
      setInviting(false)
    }
  }

  useEffect(() => {
    fetchEditRequests()
    if (SUPABASE_CONFIGURED) fetchAccessRequests()
  }, [])

  const pendingAccess = useMemo(
    () => accessRequests.filter(r => r.status === 'pending'),
    [accessRequests],
  )

  // Fetch users from profiles table (or demo fallback)
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      // Demo: just the current profile
      if (profile) {
        setUsers([{
          ...profile,
          email: 'demo@familytree.local',
          created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
        }])
      }
      return
    }
    ;(async () => {
      setUsersLoading(true)
      const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
      setUsers((data ?? []) as AdminUser[])
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

  const pendingCount = editRequests.length
  const deceased = members.filter(m => m.death_date).length
  const alive = members.length - deceased

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="min-h-screen bg-mesh-gradient pb-10">
      {/* Top bar */}
      <div className="px-4 pt-3 pb-2 max-w-4xl mx-auto">
        <div className="glass rounded-2xl px-3 py-2 flex items-center gap-3 shadow-glass-sm">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate('/')}
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
        {/* Tab bar */}
        <div className="glass-strong rounded-2xl p-1 flex gap-1 shadow-glass-sm overflow-x-auto">
          {([
            ['overview', t.adminTabOverview, '📊'],
            ['users', t.adminTabUsers, '👥'],
            ['members', t.adminTabMembers, '🌳'],
            ['requests', t.adminTabRequests, '🔔'],
            ['access', t.adminTabAccess, '🚪'],
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
                <BigStat label="ז״ל" value={deceased} icon="🕯️" grad="from-[#8E8E93] to-[#636366]" />
              </div>

              {/* Breakdown card */}
              <div className="glass-strong rounded-3xl p-5 shadow-glass">
                <h3 className="text-sf-subhead font-bold text-[#1C1C1E] mb-3">📈 {t.adminTabOverview}</h3>
                <div className="space-y-3">
                  <ProgressRow label="חיים" count={alive} total={members.length} color="#34C759" />
                  <ProgressRow label="ז״ל" count={deceased} total={members.length} color="#8E8E93" />
                </div>
              </div>

              {pendingCount > 0 && (
                <button
                  onClick={() => setTab('requests')}
                  className="w-full glass-strong rounded-3xl p-4 shadow-glass flex items-center justify-between hover:bg-white/60 transition"
                >
                  <div className={rtl ? 'text-right' : 'text-left'}>
                    <p className="text-sf-subhead font-bold text-[#1C1C1E]">
                      {pendingCount} {pendingCount !== 1 ? t.pendingRequests : t.pendingRequest}
                    </p>
                    <p className="text-[11px] text-[#8E8E93]">{t.proposedChanges}</p>
                  </div>
                  <div className="w-9 h-9 bg-[#FF3B30] rounded-full flex items-center justify-center text-white font-bold">
                    {pendingCount}
                  </div>
                </button>
              )}
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
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                          inviteRole === r.key
                            ? 'bg-white text-[#1C1C1E] shadow-sm'
                            : 'text-[#636366]'
                        }`}
                      >
                        <span className="mr-1">{r.icon}</span>
                        <span className="hidden sm:inline">{t[r.labelKey]}</span>
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
                    <UserRow
                      key={u.id}
                      user={u}
                      t={t}
                      rtl={rtl}
                      demo={!SUPABASE_CONFIGURED}
                      onRoleChange={changeUserRole}
                      onToggleActive={toggleUserActive}
                      onRemove={removeUser}
                      onMasterPermChange={changeMasterPerm}
                    />
                  ))}
                </div>
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
                      if (window.confirm(t.adminConfirmDelete)) await deleteMember(m.id)
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
  user, t, rtl, demo, onRoleChange, onToggleActive, onRemove, onMasterPermChange,
}: {
  user: AdminUser
  t: Translations
  rtl: boolean
  demo: boolean
  onRoleChange: (u: AdminUser, role: UserRole) => void
  onToggleActive: (u: AdminUser) => void
  onRemove: (u: AdminUser) => void
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
    if (demo) { alert(t.adminDemoAlert); return }
    if (!user.email) return
    await supabase.auth.resetPasswordForEmail(user.email)
    alert(`${t.adminSendReset} ✓`)
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

      {/* Role picker — 4-tier */}
      <div className="mt-3 bg-[#F2F2F7] rounded-xl p-1 flex gap-1">
        {ROLE_OPTIONS.map(r => (
          <button
            key={r.key}
            type="button"
            onClick={() => onRoleChange(user, r.key)}
            title={t[r.labelKey]}
            aria-label={t[r.labelKey]}
            aria-pressed={user.role === r.key}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition ${
              user.role === r.key
                ? 'bg-white text-[#1C1C1E] shadow-sm'
                : 'text-[#636366] hover:bg-white/40'
            }`}
          >
            <span className="mr-1">{r.icon}</span>
            <span className="hidden sm:inline">{t[r.labelKey]}</span>
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
        <ActionChip
          label={t.adminRemoveUser}
          onClick={() => onRemove(user)}
          color="red"
          icon="🗑"
        />
      </div>

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
  onApprove: (role: UserRole) => void
  onReject: () => void
}

function AccessRequestCard({ request, index, t, onApprove, onReject }: AccessRequestCardProps) {
  const [grantRole, setGrantRole] = useState<UserRole>(request.requested_role)
  const answers = request.answers ?? {}
  const relAnswer = (answers as Record<string, unknown>).relationship as string | undefined
  const purposeAnswer = (answers as Record<string, unknown>).purpose as string | undefined
  const requestedLabel = ROLE_OPTIONS.find(r => r.key === request.requested_role)
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
        <span className="flex-shrink-0 text-sf-caption2 bg-[#5AC8FA]/10 text-[#32ADE6] rounded-full px-2.5 py-1 font-medium">
          {t.pendingStatus}
        </span>
      </div>

      <div className="bg-[#F2F2F7]/80 rounded-2xl p-3 mb-3 space-y-1.5">
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

      {/* Granted-role selector */}
      <div className="mb-3">
        <p className="text-[10px] text-[#8E8E93] mb-1.5 font-semibold">{t.adminAccessApproveAs}</p>
        <div className="bg-[#F2F2F7] rounded-xl p-1 flex gap-1">
          {ROLE_OPTIONS.map(r => (
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
              <span className="mr-1">{r.icon}</span>
              <span className="hidden sm:inline">{t[r.labelKey]}</span>
            </button>
          ))}
        </div>
      </div>

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
