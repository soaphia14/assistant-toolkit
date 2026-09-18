'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/simulation', label: 'Simulation' },
  { href: '/mediator', label: 'Mediator' },
  { href: '/agent-participant', label: 'Agent Participant' },
  { href: '/assistant-reddit', label: 'Agent Assistant' },
] as const

export function Nav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {NAV_ITEMS.map(item => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${active
                ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
              }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
