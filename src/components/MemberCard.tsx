import { motion } from 'framer-motion'
import { useFamilyStore } from '../store/useFamilyStore'
import { useLang } from '../i18n/useT'
import { PersonAvatarIcon } from './MemberNode'
import type { Member } from '../types'

interface MemberCardProps {
  member: Member
  compact?: boolean
  highlighted?: boolean
  onClick?: () => void
}

function getAvatarGradient(member: Member) {
  if (member.gender === 'male') return 'from-blue-400 to-indigo-500'
  if (member.gender === 'female') return 'from-pink-400 to-rose-500'
  return 'from-teal-400 to-cyan-500'
}

export default function MemberCard({ member, compact = false, highlighted = false, onClick }: MemberCardProps) {
  const setSelectedMemberId = useFamilyStore((s) => s.setSelectedMemberId)
  const { t } = useLang()

  const handleClick = () => {
    setSelectedMemberId(member.id)
    onClick?.()
  }

  const age = member.birth_date
    ? new Date().getFullYear() - new Date(member.birth_date).getFullYear()
    : null
  const isDeceased = !!member.death_date

  if (compact) {
    return (
      <motion.button
        onClick={handleClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        className={`flex items-center gap-3 w-full p-3 rounded-2xl transition-all duration-200 text-left ${
          highlighted
            ? 'bg-[#007AFF]/10 border border-[#007AFF]/30'
            : 'bg-white/50 hover:bg-white/80 border border-black/5'
        }`}
      >
        <Avatar member={member} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sf-subhead font-semibold text-[#1C1C1E] truncate">
            {member.first_name} {member.last_name}
          </p>
          {member.birth_date && (
            <p className="text-sf-caption text-[#8E8E93]">
              {new Date(member.birth_date).getFullYear()}
              {member.death_date ? ` – ${new Date(member.death_date).getFullYear()}` : ''}
            </p>
          )}
        </div>
        {isDeceased && (
          <span className="text-[10px] text-[#8E8E93] bg-[#8E8E93]/10 rounded-full px-2 py-0.5">{t.deceased}</span>
        )}
      </motion.button>
    )
  }

  return (
    <motion.button
      onClick={handleClick}
      layout
      whileHover={{ y: -2, boxShadow: '0 12px 32px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.05)' }}
      whileTap={{ scale: 0.97 }}
      className={`glass-strong rounded-3xl p-4 flex flex-col items-center gap-3 w-36 transition-all duration-300 cursor-pointer text-left ${
        highlighted ? 'ring-2 ring-[#007AFF] ring-offset-2 ring-offset-transparent' : ''
      } ${isDeceased ? 'opacity-80' : ''}`}
    >
      <Avatar member={member} size="lg" />
      <div className="w-full text-center min-w-0">
        <p className="text-sf-subhead font-semibold text-[#1C1C1E] leading-tight truncate">{member.first_name}</p>
        <p className="text-sf-subhead font-semibold text-[#1C1C1E] leading-tight truncate">{member.last_name}</p>
        {age !== null && (
          <p className="text-sf-caption2 text-[#8E8E93] mt-1">
            {isDeceased
              ? `${new Date(member.birth_date!).getFullYear()} – ${new Date(member.death_date!).getFullYear()}`
              : `${t.age} ${age}`}
          </p>
        )}
      </div>
      {isDeceased && <span className="text-sf-caption2 text-[#8E8E93]">{t.deceased}</span>}
    </motion.button>
  )
}

interface AvatarProps {
  member: Member
  size: 'sm' | 'md' | 'lg'
}

export function Avatar({ member, size }: AvatarProps) {
  const sizeClasses = { sm: 'w-9 h-9', md: 'w-12 h-12', lg: 'w-16 h-16' }
  const pxSizes = { sm: 36, md: 48, lg: 64 }
  return (
    <div className={`${sizeClasses[size]} rounded-full overflow-hidden flex-shrink-0`}>
      {member.photo_url ? (
        <img src={member.photo_url} alt={`${member.first_name} ${member.last_name}`} className="w-full h-full object-cover" />
      ) : (
        <div className={`w-full h-full bg-gradient-to-br ${getAvatarGradient(member)} flex items-center justify-center`}>
          <PersonAvatarIcon gender={member.gender} size={pxSizes[size]} />
        </div>
      )}
    </div>
  )
}
