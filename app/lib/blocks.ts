'use client'

import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import { API_BASE } from './config'

// One named chunk of the conversation description, authored in the Simulation
// Toolkit's Block Customization panel. Mirrors `SimulationBlock` in
// api/create-experiment/parsers/simulation.ts.
//
// A block holds one or more alternative descriptions: whenever an experiment is
// created, one of them is drawn at random and used everywhere that block
// appears in that experiment (see `pickBlockDescription` in
// api/create-experiment/utils.ts).
export type Block = { name: string; descriptions: string[] }

// Blocks every new simulation starts with. They behave exactly like custom
// blocks — clicking one opens the same editor, and it can be edited or removed.
export const DEFAULT_BLOCKS: Block[] = [
  { name: 'Debate Topic', descriptions: ['The topic of the debate.'] },
]

/**
 * Reads the options off anything block-shaped.
 *
 * Simulations and prompt items saved before a block could hold several options
 * carry a single `description` string, so that shape is folded into a one-entry
 * list rather than migrated on disk. Always returns at least one entry so the
 * editor has a textbox to render.
 */
export function blockDescriptions(raw: unknown): string[] {
  const b = raw as { descriptions?: unknown; description?: unknown } | null
  const list = Array.isArray(b?.descriptions)
    ? b!.descriptions
    : b?.description != null ? [b.description] : []
  const out = list.map((d: unknown) => String(d ?? ''))
  return out.length > 0 ? out : ['']
}

export function normalizeBlock(raw: unknown): Block {
  return { name: String((raw as Block)?.name ?? '').trim(), descriptions: blockDescriptions(raw) }
}

// One-line-per-option summary, used wherever a block is only hinted at (chip
// tooltips, the "Add item" menu) so the alternatives are visible without
// opening the editor.
export function describeBlock(block: Block): string {
  const options = blockDescriptions(block).filter(d => d.trim() !== '')
  if (options.length <= 1) return options[0] ?? ''
  return options.map((d, i) => `Option ${i + 1}: ${d}`).join('\n\n')
}

export type SimulationSummary = { id: string; name: string }

function parseBlocks(content: string): Block[] {
  try {
    const data = JSON.parse(content)
    if (!Array.isArray(data?.blocks)) return []
    return data.blocks
      .map(normalizeBlock)
      .filter((b: Block) => b.name !== '')
  } catch {
    return []
  }
}

/**
 * Reads the blocks of one saved simulation so the mediator and agent-participant
 * prompt editors can offer them under "Add item".
 *
 * Blocks live inside the simulation document rather than in a library of their
 * own, so this goes through the existing simulation endpoints: list them, then
 * load whichever one is selected (the most recently updated by default). A
 * simulation only becomes visible here once it has been saved, so the list is
 * refreshed whenever the tab regains focus — that is how edits made in another
 * tab show up without a reload.
 */
export function useSimulationBlocks() {
  const [simulations, setSimulations] = useState<SimulationSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [signedIn, setSignedIn] = useState(false)

  const refresh = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/simulations`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      const list: SimulationSummary[] = data.templates ?? []
      setSimulations(list)
      // Fall back to the newest simulation when nothing is selected yet, or when
      // the selected one has since been deleted.
      setSelectedId(prev => (prev && list.some(s => s.id === prev) ? prev : list[0]?.id ?? null))
    } catch (e) {
      console.warn('useSimulationBlocks: listing simulations failed:', e)
    }
  }, [])

  useEffect(() => onAuthStateChanged(auth, user => {
    setSignedIn(!!user)
    if (user) refresh()
    else { setSimulations([]); setSelectedId(null); setBlocks([]) }
  }), [refresh])

  useEffect(() => {
    if (!signedIn) return
    const handler = () => refresh()
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [signedIn, refresh])

  useEffect(() => {
    if (!selectedId) { setBlocks([]); return }
    let cancelled = false
    ;(async () => {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      try {
        const res = await fetch(`${API_BASE}/api/simulations/load?id=${encodeURIComponent(selectedId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setBlocks(parseBlocks(data.content))
      } catch (e) {
        console.warn('useSimulationBlocks: loading simulation failed:', e)
      }
    })()
    return () => { cancelled = true }
  }, [selectedId, simulations])

  return { blocks, simulations, selectedId, setSelectedId, refresh }
}
