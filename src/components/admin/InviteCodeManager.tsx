import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { useLang, type Translations } from '../../i18n/useT'

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
interface TreeInvite {
  id: string
  code: string
  created_at: string
  expires_at: string | null
  uses_left: number | null
  note: string | null
}

const SUPABASE_CONFIGURED =
  !!import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== ''

// 10-char base32-ish code. We avoid 0/O/1/I to make codes phone-readable.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateCode(len = 10): string {
  let out = ''
  const arr = new Uint32Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length]
  }
  // Stylise: ABCDE-12345 for readability.
  return `${out.slice(0, 5)}-${out.slice(5)}`
}

type ExpiryChoice = 'never' | '7d' | '30d' | '90d'
function expiryToIso(choice: ExpiryChoice): string | null {
  if (choice === 'never') return null
  const days = choice === '7d' ? 7 : choice === '30d' ? 30 : 90
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

export default function InviteCodeManager() {
  const { t, lang } = useLang()
  const [invites, setInvites] = useState<TreeInvite[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState('')
  const [uses, setUses] = useState<string>('')   // '' = unlimited, else integer
  const [expiry, setExpiry] = useState<ExpiryChoice>('30d')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      // Seed with one demo invite so the admin can practise the flow.
      setInvites([
        {
          id: 'demo-1',
          code: 'ADLER-DEMO1',
          created_at: new Date(Date.now() - 86_400_000 * 2).toISOString(),
          expires_at: new Date(Date.now() + 86_400_000 * 28).toISOString(),
          uses_left: 5,
          note: lang === 'he' ? 'הזמנה לדוגמה' : 'Demo invite',
        },
      ])
      return
    }
    void load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('tree_invites')
      .select('id, code, created_at, expires_at, uses_left, note')
      .order('created_at', { ascending: false })
    setInvites((data ?? []) as TreeInvite[])
    setLoading(false)
  }

  const createInvite = async () => {
    setCreating(true)
    try {
      const usesParsed = uses.trim() === '' ? null : Math.max(1, parseInt(uses, 10) || 1)
      const expiresIso = expiryToIso(expiry)
      const draft: Omit<TreeInvite, 'id' | 'created_at'> & { code: string } = {
        code: generateCode(),
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
          .select('id, code, created_at, expires_at, uses_left, note')
          .single()
        if (error) {
          // Most common cause: collision on `code` unique. Re-roll once.
          const retry = await supabase
            .from('tree_invites')
            .insert({ ...draft, code: generateCode() })
            .select('id, code, created_at, expires_at, uses_left, note')
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
    if (!window.confirm(t.adminInvitesRevokeConfirm)) return
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
      window.prompt(t.adminInvitesCopyCode, inv.code)
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
          disabled={creating}
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
  inv, copied, onCopy, onRevoke, t, lang,
}: {
  inv: TreeInvite
  copied: boolean
  onCopy: () => void
  onRevoke: () => void
  t: Translations
  lang: 'he' | 'en'
}) {
  const expired = inv.expires_at != null && new Date(inv.expires_at) < new Date()
  const exhausted = inv.uses_left != null && inv.uses_left <= 0
  const dead = expired || exhausted
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.25 }}
      className={`glass-strong rounded-2xl p-3 shadow-glass-sm flex flex-col sm:flex-row sm:items-center gap-3 ${
        dead ? 'opacity-60' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-sf-headline font-mono font-bold tracking-wider text-[#1C1C1E]"
            dir="ltr"
          >
            {inv.code}
          </span>
          {inv.note && (
            <span className="text-[11px] text-[#636366]">— {inv.note}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#8E8E93] mt-0.5">
          <span>
            {t.adminInvitesGenerated}: {fmt(inv.created_at)}
          </span>
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
            copied
              ? 'bg-[#34C759] text-white'
              : 'bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20'
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
    </motion.div>
  )
}
