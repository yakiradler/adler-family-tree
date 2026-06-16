import { useNavigate, useLocation } from 'react-router-dom'
import { useLang } from '../i18n/useT'

/**
 * Instagram-style bottom navigation. Three tabs: Home, the family
 * "network" feed, and Birthdays. Only renders on those main in-app
 * routes (not on landing/auth/tree/gates). Fixed to the bottom, safe-
 * area aware; the host pages carry extra bottom padding so content
 * never hides behind it.
 */
const TABS = [
  { path: '/home', labelHe: 'בית', labelEn: 'Home', icon: 'M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5', fill: false },
  { path: '/feed', labelHe: 'משפחה', labelEn: 'Family', icon: 'M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-2.8 2.2-5 5-5s5 2.2 5 5M13 19c0-2.8 2.2-5 5-5s4 2.2 4 5', fill: false },
  { path: '/birthdays', labelHe: 'ימי הולדת', labelEn: 'Birthdays', icon: 'M5 21h14v-7H5v7Zm1-7c0-2 1.5-3 6-3s6 1 6 3M12 8V5m0 0a1.2 1.2 0 1 1 1.2-1.2c0 .9-1.2 1.2-1.2 1.2Z', fill: false },
] as const

export default function BottomNav({ isAuth }: { isAuth: boolean }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { lang } = useLang()

  // Only the three main tabs get the bar.
  const shown = isAuth && TABS.some((tt) => tt.path === pathname)
  if (!shown) return null

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-black/5 bg-white/85 backdrop-blur-xl no-print"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-lg mx-auto flex items-stretch justify-around px-2">
        {TABS.map((tab) => {
          const active = pathname === tab.path
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              aria-current={active ? 'page' : undefined}
              className="flex-1 flex flex-col items-center gap-0.5 py-2 active:scale-95 transition"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke={active ? '#007AFF' : '#8E8E93'} strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round">
                <path d={tab.icon} />
              </svg>
              <span className={`text-[10.5px] font-semibold ${active ? 'text-[#007AFF]' : 'text-[#8E8E93]'}`}>
                {lang === 'he' ? tab.labelHe : tab.labelEn}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
