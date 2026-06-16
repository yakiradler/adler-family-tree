import { useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useLang } from '../i18n/useT'
import { useFamilyStore } from '../store/useFamilyStore'
import TreeSwitchSheet from './TreeSwitchSheet'

/**
 * Instagram-style bottom navigation. Home, the family "network" feed,
 * Birthdays, plus a "My tree" button. Only renders on those main in-app
 * routes (not on landing/auth/tree/gates). Fixed to the bottom, safe-
 * area aware; the host pages carry extra bottom padding so content
 * never hides behind it.
 *
 * The "My tree" button is special: a SHORT tap opens the active tree's
 * view (/tree); a LONG press opens the Instagram-style tree switcher so
 * you can hop between trees without leaving the page. In Hebrew (RTL) it
 * sits on the far right — it's rendered first in DOM order, and `start`
 * is the right edge under `dir=rtl`.
 */
const TABS = [
  { path: '/home', labelHe: 'בית', labelEn: 'Home', icon: 'M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5' },
  { path: '/feed', labelHe: 'משפחה', labelEn: 'Family', icon: 'M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-2.8 2.2-5 5-5s5 2.2 5 5M13 19c0-2.8 2.2-5 5-5s4 2.2 4 5' },
  { path: '/birthdays', labelHe: 'ימי הולדת', labelEn: 'Birthdays', icon: 'M5 21h14v-7H5v7Zm1-7c0-2 1.5-3 6-3s6 1 6 3M12 8V5m0 0a1.2 1.2 0 1 1 1.2-1.2c0 .9-1.2 1.2-1.2 1.2Z' },
] as const

// Routes that show the bar. /tree is intentionally excluded (the tree
// view runs full-bleed with its own floating controls), but the "My
// tree" button still navigates there from the three main tabs.
const BAR_ROUTES = ['/home', '/feed', '/birthdays']

export default function BottomNav({ isAuth }: { isAuth: boolean }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { t, lang } = useLang()
  const { trees, activeTreeId } = useFamilyStore()

  const [sheetOpen, setSheetOpen] = useState(false)
  // Long-press timer for the "My tree" button. iOS Safari doesn't fire a
  // reliable contextmenu on long-press, so a 600ms pointer timer mirrors
  // the desktop right-click. `pressFired` lets the tap handler skip the
  // navigate when the long-press already opened the sheet (same pattern
  // as the dashboard tree cards).
  const pressTimer = useRef<number | null>(null)
  const pressFired = useRef(false)

  if (!(isAuth && BAR_ROUTES.includes(pathname))) return null

  const activeTree = activeTreeId ? trees.find((tt) => tt.id === activeTreeId) : null
  const myTreeColor = activeTree?.color ?? '#007AFF'

  const startPress = () => {
    pressFired.current = false
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true
      setSheetOpen(true)
    }, 600)
  }
  const endPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }
  const tapMyTree = () => {
    if (pressFired.current) return // long-press already handled it
    navigate('/tree')
  }

  return (
    <>
      <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t border-black/5 bg-white/85 backdrop-blur-xl no-print"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-lg mx-auto flex items-stretch justify-around px-2">
          {/* "My tree" — first in DOM so it's on the right in RTL. */}
          <button
            type="button"
            onClick={tapMyTree}
            onPointerDown={startPress}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onContextMenu={(e) => { e.preventDefault(); setSheetOpen(true) }}
            aria-label={t.navMyTree}
            title={t.navMyTreeHint}
            aria-haspopup="menu"
            className="flex-1 flex flex-col items-center gap-0.5 py-2 active:scale-95 transition select-none"
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
              style={{ background: myTreeColor, boxShadow: `0 0 0 1.5px #fff, 0 0 0 3px ${myTreeColor}55` }}
              aria-hidden
            >
              {(activeTree?.name ?? '·').trim().charAt(0) || '·'}
            </span>
            <span className="text-[10.5px] font-semibold text-[#8E8E93]">
              {t.navMyTree}
            </span>
          </button>

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

      <TreeSwitchSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  )
}
