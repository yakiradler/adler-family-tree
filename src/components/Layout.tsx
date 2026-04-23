import { motion } from 'framer-motion'
import Navigation from './Navigation'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen w-full relative overflow-hidden">
      {/* Layered mesh gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40" />
      <div className="fixed inset-0 bg-mesh-gradient opacity-70" />

      {/* Floating orbs */}
      <div className="fixed top-[-10%] right-[-5%] w-[40vw] h-[40vw] bg-blue-200/20 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-[-10%] left-[-5%] w-[35vw] h-[35vw] bg-purple-200/15 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed top-[40%] left-[30%] w-[25vw] h-[25vw] bg-teal-100/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main content */}
      <motion.main
        className="relative z-10 min-h-screen pb-28"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        {children}
      </motion.main>

      {/* Bottom navigation */}
      <Navigation />
    </div>
  )
}
