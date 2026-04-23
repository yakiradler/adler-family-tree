import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang, isRTL } from '../i18n/useT'
import TreeView from '../components/views/TreeView'
import MemberPanel from '../components/MemberPanel'
import AddMemberModal from '../components/AddMemberModal'
import { useState } from 'react'

interface Props { demoMode: boolean }

export default function TreePage({ demoMode }: Props) {
  const { selectedMemberId, setSelectedMemberId, profile, members } = useFamilyStore()
  const { t, lang } = useLang()
  const dir = isRTL(lang) ? 'rtl' : 'ltr'
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div dir={dir} className="min-h-screen bg-[#F2F2F7]">
      {demoMode && (
        <div className="bg-gradient-to-r from-[#007AFF] to-[#32ADE6] px-4 py-1 text-center">
          <span className="text-[11px] font-semibold text-white">{t.demoBanner}</span>
        </div>
      )}

      {/* Floating top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-3" style={{ top: demoMode ? 20 : 0 }}>
        <div className="glass rounded-2xl px-3 py-2 flex items-center gap-3 shadow-glass-sm max-w-[600px] mx-auto">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => navigate('/')}
            className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center border border-white/60">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d={isRTL(lang) ? 'M5 3l4 4-4 4' : 'M9 3L5 7l4 4'} stroke="#636366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sf-headline font-bold text-[#1C1C1E] leading-none flex items-center gap-2">
              <span>🌳</span> {t.viewTree}
            </h1>
            <p className="text-[11px] text-[#8E8E93] mt-0.5 truncate">
              {profile?.full_name} · {members.length} {t.dashMembers}
            </p>
          </div>
          <motion.button whileTap={{ scale: 0.93 }} onClick={() => setAddOpen(true)}
            className="w-8 h-8 bg-gradient-to-br from-[#007AFF] to-[#32ADE6] rounded-xl flex items-center justify-center shadow-md">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </motion.button>
        </div>
      </div>

      {/* Tree canvas + side panel */}
      <div className="relative">
        <TreeView />

        <AnimatePresence>
          {selectedMemberId && (
            <motion.div
              key="panel-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedMemberId(null)}
              className="fixed inset-0 bg-black/15 backdrop-blur-[2px] z-40 md:bg-transparent md:backdrop-blur-0"
            />
          )}
          {selectedMemberId && (
            <motion.div
              key="panel"
              initial={{ opacity: 0, x: isRTL(lang) ? -40 : 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL(lang) ? -40 : 40 }}
              transition={{ type: 'spring', stiffness: 350, damping: 32 }}
              className={`fixed bottom-4 z-50 w-[calc(100vw-32px)] max-w-sm md:max-w-[400px] ${
                isRTL(lang) ? 'left-4' : 'right-4'
              } md:top-20`}
              style={{ maxHeight: 'calc(100vh - 120px)' }}
            >
              <MemberPanel onClose={() => setSelectedMemberId(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AddMemberModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
