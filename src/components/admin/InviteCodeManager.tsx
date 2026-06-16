import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, type Translations } from '../../i18n/useT'
import { confirmDialog, alertDialog } from '../../lib/confirm'
import { generateCode, expiryToIso, type ExpiryChoice } from '../../lib/invites'
import type { TreeInvite, InviteRedemption } from '../../types'

/**
 * Admin tool — generate and manage `tree_invites` codes.
 *
 * Codes are short (10 char), URL-safe, uppercase. The new-code form lets
 * the admin pick:
 *   - uses-left:  finite count or unlimited (null in DB)
 *   - expires-at: 7/30/90 days from now, or never (null in DB)
 *   - note:       internal label so the admin remembers who it was for
 *
 * Existing codes render in a list with copy + revoke. Demo mode (no
 * Supabase) keeps everything in component state so the UI is still
 * exercisable end-to-end.
 */
const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''
// Code generation + expiry helpers live in src/lib/invites.ts — shared
// with the tree long-press mint flow and decideAccessRequest.

export default function InviteCodeManager() {
  const { t, lang } = useLang()
  const { trees, profile, activeTreeId } = useFamilyStore()
  // Demo mode (no Supabase) seeds one practise invite at init so the
  // admin can exercise the flow; live mode starts empty and loads below.
  const [invites, setInvites] = useState<TreeInvite[]>(() =>
    SUPABASE_CONFIGURED
      ? []
      : [
          {
            id: 'demo-1',
            code: 'ADLER-DEMO1',
            tree_id: null,
            created_at: new Date(Date.now() - 86_400_000 * 2).toISOString(),
            expires_at: new Date(Date.now() + 86_400_000 * 28).toISOString(),
            uses_left: 5,
            note: lang === 'he' ? 'הזמנה לדוגמה' : 'Demo invite',
          },
        ],
  )
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState('')
  const [uses, setUses] = useState<string>('')   // '' = unlimited, else integer
  const [expiry, setExpiry] = useState<ExpiryChoice>('30d')
  // Which tree the code grants access to. Codes used to be minted
  // WITHOUT a tree (the original bug) — joining with them granted
  // nothing. Defaults to the active tree.
  const [treeId, setTreeId] = useState<string>(activeTreeId ?? '')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Initial load (live mode only — demo mode is seeded at init above).
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return
    void (async () => {
      setLoading(true)
      const { data } = await supabase
        .from('tree_invites')
        .select('*')
        .order('created_at', { ascending: false })
      setInvites((data ?? []) as TreeInvite[])
      setLoading(false)
    })()
  }, [])

  const treeNameById = (id: string | null | undefined): string | null =>
    id ? trees.find((tr) => tr.id === id)?.name ?? null : null

  const createInvite = async () => {
    if (SUPABASE_CONFIGURED && !treeId) return
    setCreating(true)
    try {
      const usesParsed = uses.trim() === '' ? null : Math.max(1, parseInt(uses, 10) || 1)
      const expiresIso = expiryToIso(expiry)
      const draft = {
        code: generateCode(),
        tree_id: treeId || null,
        created_by: profile?.id ?? null,
        expires_at: expiresIso,
        uses_left: usesParsed,
        note: note.trim() || null,
      }

      if (!SUPABASE_CONFIGURED) {
        const local: TreeInvite = {
          ...draft,
          id: `local-${Date.now()}`,
          created_at: new Date().toISOString(),
        }
        setInvites((rows) => [local, ...rows])
      } else {
        const { data, error } = await supabase
          .from('tree_invites')
          .insert(draft)
          .select('*')
          .single()
        if (error) {
          // Most common cause: collision on `code` unique. Re-roll once.
          const retry = await supabase
            .from('tree_invites')
            .insert({ ...draft, code: generateCode() })
            .select('*')
            .single()
          if (retry.data) setInvites((rows) => [retry.data as TreeInvite, ...rows])
        } else if (data) {
          setInvites((rows) => [data as TreeInvite, ...rows])
        }
      }
      // Reset form to sensible defaults.
      setNote('')
      setUses('')
      setExpiry('30d')
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    if (!(await confirmDialog({ message: t.adminInvitesRevokeConfirm, danger: true }))) return
    setInvites((rows) => rows.filter((r) => r.id !== id))
    if (SUPABASE_CONFIGURED) {
      await supabase.from('tree_invites').delete().eq('id', id)
    }
  }

  const copy = async (inv: TreeInvite) => {
    try {
      await navigator.clipboard.writeText(inv.code)
      setCopiedId(inv.id)
      setTimeout(() => setCopiedId((curr) => (curr === inv.id ? null : curr)), 1600)
    } catch {
      // Clipboard might be blocked in some sandboxed contexts; fall back
      // to a tiny prompt so the admin can still grab the code manually.
      void alertDialog({ title: t.adminInvitesCopyCode, message: inv.code })
    }
  }

  return (
    <div className="space-y-3">
      {/* Generator card */}
      <div className="glass-strong rounded-3xl p-4 shadow-glass space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#5E5CE6] to-[#BF5AF2] flex items-center justify-center text-white shadow-md">
            <span className="text-lg">🔑</span>
          </div>
          <div className="flex-1">
            <p className="text-sf-subhead font-bold text-[#1C1C1E]">{t.adminInvitesTitle}</p>
            <p className="text-[11px] text-[#8E8E93]">{t.adminInvitesDesc}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-3">
            <label className="text-[10px] font-semibold text-[#8E8E93] uppercase mb-1 block">
              {t.adminInvitesTreeLabel}
            </label>
            <select
              value={treeId}
              onChange={(e) => setTreeId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#5E5CE6]/40"
            >
              <option value="">{t.adminInvitesTreePick}</option>
              {trees.map((tr) => (
                <option key={tr.id} value={tr.id}>{tr.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className="text-[10px] font-semibold text-[#8E8E93] uppercase mb-1 block">
              {t.adminInvitesNoteLabel}
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.adminInvitesNotePlaceholder}
              className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#5E5CE6]/40"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-[#8E8E93] uppercase mb-1 block">
              {t.adminInvitesUsesLabel}
            </label>
            <input
              type="number"
              min={1}
              value={uses}
              onChange={(e) => setUses(e.target.value)}
              placeholder={t.adminInvitesUsesUnlimited}
              className="w-full px-3 py-2 rounded-xl bg-[#F2F2F7] text-sf-body text-[#1C1C1E] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#5E5CE6]/40"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-semibold text-[#8E8E93] uppercase mb-1 block">
              {t.adminInvitesExpiresLabel}
            </label>
            <div className="bg-[#F2F2F7] rounded-xl p-1 grid grid-cols-4 gap-1">
              {([
                ['never', t.adminInvitesExpiresNever],
                ['7d', t.adminInvitesExpires7d],
                ['30d', t.adminInvitesExpires30d],
                ['90d', t.adminInvitesExpires90d],
              ] as const).map(([key, lbl]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setExpiry(key)}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition ${
                    expiry === key
                      ? 'bg-white text-[#1C1C1E] shadow-sm'
                      : 'text-[#636366]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={createInvite}
          disabled={creating || (SUPABASE_CONFIGURED && !treeId)}
          className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#5E5CE6] to-[#BF5AF2] text-white text-sf-subhead font-bold shadow-md disabled:opacity-50 active:scale-[0.98] transition"
        >
          {creating ? '…' : t.adminInvitesGenerate}
        </button>
      </div>

      {/* Active codes list */}
      <div>
        <p className="text-[11px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          {t.adminInvitesActiveTitle}
        </p>
        {loading ? (
          <div className="text-center py-10 text-[#8E8E93]">…</div>
        ) : invites.length === 0 ? (
          <div className="glass-strong rounded-3xl p-8 text-center shadow-glass">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F2F2F7] flex items-center justify-center mb-2 text-2xl">
              🔑
            </div>
            <p className="text-sf-subhead text-[#8E8E93]">{t.adminInvitesEmpty}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {invites.map((inv) => (
                <InviteRow
                  key={inv.id}
                  inv={inv}
                  treeName={treeNameById(inv.tree_id)}
                  copied={copiedId === inv.id}
                  onCopy={() => copy(inv)}
                  onRevoke={() => revoke(inv.id)}
                  t={t}
                  lang={lang}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

function InviteRow({
  inv, treeName, copied, onCopy, onRevoke, t, lang,
}: {
  inv: TreeInvite
  treeName: string | null
  copied: boolean
  onCopy: () => void
  onRevoke: () => void
  t: Translations
  lang: 'he' | 'en'
}) {
  const expired = inv.expires_at != null && new Date(inv.expires_at) < new Date()
  const exhausted = inv.uses_left != null && inv.uses_left <= 0
  const dead = expired || exhausted
  const count = inv.redeem_count ?? 0
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    })

  // Lazy-load the "who joined" list only when expanded (keeps the list
  // light even with thousands of codes — the count is denormalised so it
  // shows without any extra query).
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<InviteRedemption[] | null>(null)
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || people !== null) return
    if (!SUPABASE_CONFIGURED) { setPeople([]); return }
    const { data } = await supabase
      .from('invite_redemptions')
      .select('user_id, redeemed_at')
      .eq('invite_id', inv.id)
      .order('redeemed_at', { ascending: true })
    const rows = (data ?? []) as { user_id: string; redeemed_at: string }[]
    let names: Record<string, string> = {}
    if (rows.length) {
      const { data: profs } = await supabase
        .from('profiles').select('id, full_name').in('id', rows.map((r) => r.user_id))
      names = Object.fromEntries(((profs ?? []) as { id: string; full_name: string | null }[])
        .map((p) => [p.id, p.full_name || '—']))
    }
    setPeople(rows.map((r) => ({ user_id: r.user_id, full_name: names[r.user_id] || '—', redeemed_at: r.redeemed_at })))
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.25 }}
      className={`glass-strong rounded-2xl p-3 shadow-glass-sm ${dead ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sf-headline font-mono font-bold tracking-wider text-[#1C1C1E]" dir="ltr">
              {inv.code}
            </span>
            {treeName && (
              <span className="text-[11px] font-semibold text-[#5E5CE6]">🌳 {treeName}</span>
            )}
            {/* How many joined via this code (denormalised counter). */}
            <span className="text-[11px] font-semibold text-[#34C759] bg-[#34C759]/10 rounded-full px-2 py-0.5">
              👥 {count} {t.adminInvitesJoined}
            </span>
            {inv.note && (
              <span className="text-[11px] text-[#636366]">— {inv.note}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#8E8E93] mt-0.5">
            <span>{t.adminInvitesGenerated}: {inv.created_at ? fmt(inv.created_at) : '—'}</span>
            <span>
              {t.adminInvitesExpiresOn}:{' '}
              {inv.expires_at ? fmt(inv.expires_at) : t.adminInvitesNoExpiry}
            </span>
            <span>
              {inv.uses_left == null
                ? t.adminInvitesUnlimited
                : `${inv.uses_left} ${t.adminInvitesUsesRemaining}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onCopy}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition ${
              copied ? 'bg-[#34C759] text-white' : 'bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20'
            }`}
          >
            {copied ? t.adminInvitesCopied : t.adminInvitesCopyCode}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onRevoke}
            className="px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-[#FF3B30]/10 text-[#FF3B30] hover:bg-[#FF3B30]/20 transition"
          >
            {t.adminInvitesRevoke}
          </motion.button>
        </div>
      </div>

      {/* Who joined — expandable, lazy-loaded */}
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#5E5CE6]"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="leading-none" aria-hidden>›</motion.span>
        {t.adminInvitesWhoJoined}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 space-y-1">
              {people === null ? (
                <p className="text-[11px] text-[#8E8E93] py-1">{t.adminInvitesJoinedLoading}</p>
              ) : people.length === 0 ? (
                <p className="text-[11px] text-[#8E8E93] py-1">{t.adminInvitesNoneJoined}</p>
              ) : (
                people.map((p) => (
                  <div key={p.user_id} className="flex items-center justify-between gap-2 bg-[#F2F2F7] rounded-xl px-2.5 py-1.5">
                    <span className="text-[12px] font-semibold text-[#1C1C1E] truncate">{p.full_name}</span>
                    <span className="text-[10px] text-[#8E8E93] flex-shrink-0">{fmt(p.redeemed_at)}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
