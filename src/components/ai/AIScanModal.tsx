import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../../store/useFamilyStore'
import { useLang, isRTL, type Translations } from '../../i18n/useT'
import { scanFiles, isLiveAIScanConfigured, type AIScanCandidate } from '../../lib/aiVision'
import type { Gender, Member } from '../../types'

/**
 * AI Scan modal — full-screen overlay with four phases:
 *
 *   pick      → drag/drop or click-to-choose images/PDFs
 *   preview   → show selected files as thumbnails, "scan" CTA
 *   analyzing → spinner + status copy
 *   review    → editable candidate list with checkboxes; confirm-add
 *
 * Adding writes Member rows via `useFamilyStore.addMember`. We DO NOT
 * create relationships here — that requires user judgment about
 * who-belongs-where. The added members appear "loose" on the tree and
 * the user can wire them in via the existing relationship editor.
 */
type Phase = 'pick' | 'preview' | 'analyzing' | 'review'

interface PickedFile {
  file: File
  url: string
  id: string
}

interface CandidateRow extends AIScanCandidate {
  /** Local UI flag — selected for adding. */
  selected: boolean
}

export default function AIScanModal({
  open, onClose, onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded?: (count: number) => void
}) {
  const { t, lang } = useLang()
  const rtl = isRTL(lang)
  const { addMember, profile } = useFamilyStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('pick')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  if (!open) return null

  const reset = () => {
    files.forEach((f) => URL.revokeObjectURL(f.url))
    setFiles([])
    setCandidates([])
    setPhase('pick')
    setError(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const acceptFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).slice(0, 8)  // cap
    const next: PickedFile[] = arr.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      id: `${file.name}-${file.size}-${file.lastModified}`,
    }))
    setFiles((existing) => [...existing, ...next])
    if (next.length > 0) setPhase('preview')
  }

  const removeFile = (id: string) => {
    setFiles((rows) => {
      const target = rows.find((r) => r.id === id)
      if (target) URL.revokeObjectURL(target.url)
      const next = rows.filter((r) => r.id !== id)
      if (next.length === 0) setPhase('pick')
      return next
    })
  }

  const startScan = async () => {
    if (files.length === 0) return
    setPhase('analyzing')
    setError(null)
    try {
      const result = await scanFiles(files.map((f) => f.file))
      setCandidates(result.map((c) => ({ ...c, selected: true })))
      setPhase('review')
    } catch (err) {
      console.error(err)
      setError(t.aiScanError)
      setPhase('preview')
    }
  }

  const updateCandidate = (id: string, patch: Partial<CandidateRow>) => {
    setCandidates((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const toggleAll = () => {
    const allSelected = candidates.every((c) => c.selected)
    setCandidates((rows) => rows.map((r) => ({ ...r, selected: !allSelected })))
  }

  const confirmAdd = async () => {
    const picked = candidates.filter((c) => c.selected)
    if (picked.length === 0) return
    setAdding(true)
    try {
      const creatorId = profile?.id ?? 'ai-scan'
      for (const c of picked) {
        const member: Omit<Member, 'id'> = {
          first_name: c.first_name,
          last_name: c.last_name ?? '',
          gender: c.gender,
          birth_date: c.birth_year ? `${c.birth_year}-01-01` : undefined,
          bio: c.notes,
          created_by: creatorId,
        }
        await addMember(member)
      }
      onAdded?.(picked.length)
      handleClose()
    } finally {
      setAdding(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="relative w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-3xl bg-white/95 backdrop-blur-2xl shadow-2xl border border-white/60 flex flex-col"
        dir={rtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b border-black/5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5E5CE6] to-[#BF5AF2] flex items-center justify-center text-white text-xl shadow-md">
            ✨
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sf-title2 font-bold text-[#1C1C1E]">{t.aiScanTitle}</h2>
            <p className="text-[12px] text-[#636366] mt-0.5">{t.aiScanSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] transition flex items-center justify-center"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="#636366" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {!isLiveAIScanConfigured() && phase !== 'analyzing' && (
            <div className="mb-4 rounded-2xl bg-[#FFCC00]/15 border border-[#FFCC00]/30 px-3 py-2 text-[11px] text-[#7E5700] flex items-start gap-2">
              <span aria-hidden>💡</span>
              <span className="leading-relaxed">{t.aiScanDemoNotice}</span>
            </div>
          )}

          <AnimatePresence mode="wait">
            {phase === 'pick' && (
              <motion.div
                key="pick"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="py-2"
              >
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    if (e.dataTransfer.files) acceptFiles(e.dataTransfer.files)
                  }}
                  className={`w-full rounded-3xl border-2 border-dashed transition-all p-10 flex flex-col items-center gap-2 ${
                    dragOver
                      ? 'border-[#5E5CE6] bg-[#5E5CE6]/5'
                      : 'border-[#E5E5EA] bg-[#F9F9FB] hover:bg-[#F2F2F7]'
                  }`}
                >
                  <span className="text-4xl" aria-hidden>📤</span>
                  <p className="text-sf-subhead font-semibold text-[#1C1C1E]">
                    {t.aiScanPickPrompt}
                  </p>
                  <p className="text-[11px] text-[#8E8E93]">{t.aiScanPickHint}</p>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) acceptFiles(e.target.files)
                    e.target.value = ''  // allow re-selecting same files
                  }}
                />
              </motion.div>
            )}

            {phase === 'preview' && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {files.map((f) => (
                    <FileTile key={f.id} file={f} onRemove={() => removeFile(f.id)} t={t} />
                  ))}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="h-28 rounded-2xl border-2 border-dashed border-[#E5E5EA] hover:border-[#5E5CE6] hover:bg-[#5E5CE6]/5 flex items-center justify-center text-[28px] text-[#8E8E93] transition"
                    aria-label={t.aiScanPickPrompt}
                  >
                    +
                  </button>
                </div>
                {error && (
                  <p className="text-[12px] text-[#FF3B30] bg-[#FF3B30]/8 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) acceptFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </motion.div>
            )}

            {phase === 'analyzing' && (
              <motion.div
                key="analyzing"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-12"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
                  className="w-14 h-14 mx-auto mb-5 rounded-full border-[3px] border-[#5E5CE6]/20 border-t-[#5E5CE6]"
                />
                <p className="text-sf-subhead font-semibold text-[#1C1C1E]">{t.aiScanAnalyzing}</p>
                <p className="text-[11px] text-[#8E8E93] mt-1">{t.aiScanAnalyzingHint}</p>
              </motion.div>
            )}

            {phase === 'review' && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3"
              >
                <div className="flex items-baseline justify-between">
                  <p className="text-sf-subhead font-bold text-[#1C1C1E]">{t.aiScanResultsTitle}</p>
                  {candidates.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-[11px] text-[#5E5CE6] font-semibold hover:underline"
                    >
                      {candidates.every((c) => c.selected)
                        ? lang === 'he' ? 'בטל הכל' : 'Deselect all'
                        : lang === 'he' ? 'בחר הכל' : 'Select all'}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[#8E8E93]">{t.aiScanResultsHint}</p>
                {candidates.length === 0 ? (
                  <div className="rounded-3xl bg-[#F2F2F7] p-8 text-center">
                    <p className="text-2xl mb-2">🤷</p>
                    <p className="text-sf-subhead text-[#636366]">{t.aiScanNoResults}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {candidates.map((c) => (
                      <CandidateRowView
                        key={c.id}
                        c={c}
                        onChange={(patch) => updateCandidate(c.id, patch)}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer actions */}
        {(phase === 'preview' || phase === 'review') && (
          <div className="px-5 pb-5 pt-3 border-t border-black/5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (phase === 'review') setPhase('preview')
                else reset()
              }}
              className="flex-1 py-3 rounded-2xl bg-[#F2F2F7] text-[#1C1C1E] text-sf-subhead font-semibold active:scale-[0.98] transition"
            >
              {t.aiScanBackBtn}
            </button>
            {phase === 'preview' ? (
              <button
                type="button"
                onClick={startScan}
                disabled={files.length === 0}
                className="flex-[2] py-3 rounded-2xl bg-gradient-to-r from-[#5E5CE6] to-[#BF5AF2] text-white text-sf-subhead font-bold shadow-md disabled:opacity-50 active:scale-[0.98] transition"
              >
                ✨ {t.aiScanScanBtn}
              </button>
            ) : (
              <button
                type="button"
                onClick={confirmAdd}
                disabled={adding || candidates.filter((c) => c.selected).length === 0}
                className="flex-[2] py-3 rounded-2xl bg-gradient-to-r from-[#34C759] to-[#30D158] text-white text-sf-subhead font-bold shadow-md disabled:opacity-50 active:scale-[0.98] transition"
              >
                {adding ? '…' : t.aiScanAddSelected}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function FileTile({
  file, onRemove, t,
}: {
  file: PickedFile
  onRemove: () => void
  t: Translations
}) {
  const isImage = file.file.type.startsWith('image/')
  return (
    <div className="relative group rounded-2xl overflow-hidden bg-[#F2F2F7] h-28">
      {isImage ? (
        <img src={file.url} alt={file.file.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-[#636366] gap-1">
          <span className="text-3xl">📄</span>
          <span className="text-[10px] truncate max-w-[80%]">{file.file.name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t.aiScanRemoveFile}
        className="absolute top-1.5 end-1.5 w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition opacity-0 group-hover:opacity-100"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 2l6 6M8 2L2 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

function CandidateRowView({
  c, onChange, t,
}: {
  c: CandidateRow
  onChange: (patch: Partial<CandidateRow>) => void
  t: Translations
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-3 border transition ${
        c.selected
          ? 'bg-[#5E5CE6]/8 border-[#5E5CE6]/30'
          : 'bg-[#F9F9FB] border-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onChange({ selected: !c.selected })}
          aria-pressed={c.selected}
          className={`mt-1 w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center text-white text-[11px] font-bold transition ${
            c.selected ? 'bg-[#5E5CE6]' : 'bg-white border border-[#C7C7CC]'
          }`}
        >
          {c.selected ? '✓' : ''}
        </button>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <LabeledField label={t.aiScanFieldFirstName}>
              <input
                type="text"
                value={c.first_name}
                onChange={(e) => onChange({ first_name: e.target.value })}
                className="ai-cand-input"
              />
            </LabeledField>
            <LabeledField label={t.aiScanFieldLastName}>
              <input
                type="text"
                value={c.last_name ?? ''}
                onChange={(e) => onChange({ last_name: e.target.value })}
                className="ai-cand-input"
              />
            </LabeledField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LabeledField label={t.aiScanFieldGender}>
              <select
                value={c.gender ?? ''}
                onChange={(e) =>
                  onChange({
                    gender: (e.target.value || undefined) as Gender | undefined,
                  })
                }
                className="ai-cand-input"
              >
                <option value="">—</option>
                <option value="male">♂</option>
                <option value="female">♀</option>
              </select>
            </LabeledField>
            <LabeledField label={t.aiScanFieldBirthYear}>
              <input
                type="number"
                value={c.birth_year ?? ''}
                onChange={(e) =>
                  onChange({
                    birth_year: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                className="ai-cand-input"
                placeholder="—"
              />
            </LabeledField>
          </div>
          {c.notes && (
            <div className="text-[11px] text-[#636366] flex items-baseline gap-2">
              <span className="text-[#8E8E93] font-semibold">{t.aiScanFieldNotes}:</span>
              <span className="leading-snug">{c.notes}</span>
            </div>
          )}
          {typeof c.confidence === 'number' && (
            <div className="flex items-center gap-2 text-[10px] text-[#8E8E93]">
              <span>{t.aiScanConfidence}</span>
              <div className="flex-1 h-1.5 rounded-full bg-[#E5E5EA] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#5E5CE6] to-[#BF5AF2] rounded-full"
                  style={{ width: `${Math.round(c.confidence * 100)}%` }}
                />
              </div>
              <span dir="ltr" className="font-mono">
                {Math.round(c.confidence * 100)}%
              </span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .ai-cand-input {
          width: 100%;
          padding: 0.4rem 0.7rem;
          border-radius: 0.6rem;
          background: #FFFFFF;
          border: 1px solid #E5E5EA;
          color: #1C1C1E;
          font-size: 12px;
          outline: none;
          transition: box-shadow 0.15s ease, border-color 0.15s ease;
        }
        .ai-cand-input:focus {
          border-color: #5E5CE6;
          box-shadow: 0 0 0 2px rgba(94, 92, 230, 0.25);
        }
      `}</style>
    </motion.div>
  )
}

function LabeledField({
  label, children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-[10px] text-[#8E8E93] font-semibold mb-0.5">{label}</p>
      {children}
    </div>
  )
}
