'use client'

import { useState, type ReactNode } from 'react'

export function CopyButton({ getText, label = 'Copy', copiedLabel = 'Copied!', icon, className }: {
  getText: () => string
  label?: string
  copiedLabel?: string
  icon?: ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.warn('Copy failed:', e)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={className ?? 'w-full flex items-center justify-center gap-2 text-md px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-600 transition-all duration-150 cursor-pointer'}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" className="w-4 h-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8l3.5 3.5L13 5" />
        </svg>
      ) : icon}
      {copied ? copiedLabel : label}
    </button>
  )
}
