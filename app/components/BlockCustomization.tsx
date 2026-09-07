'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_BLOCKS, type Block } from '../lib/blocks'

// Re-exported so existing importers keep working; both now live in lib/blocks
// so the prompt editors can read them without pulling in this editor.
export { DEFAULT_BLOCKS }
export type { Block }

// `index === null` means the editor is open for a brand-new block.
type Editing = { index: number | null; name: string; description: string }

export function BlockCustomization({ blocks, onUpdate }: {
  blocks: Block[]
  onUpdate: (blocks: Block[]) => void
}) {
  const [editing, setEditing] = useState<Editing | null>(null)

  const openNew = () => setEditing({ index: null, name: '', description: '' })
  const openExisting = (index: number) =>
    setEditing({ index, name: blocks[index].name, description: blocks[index].description })

  const close = () => setEditing(null)

  const save = () => {
    if (!editing) return
    const block = { name: editing.name.trim(), description: editing.description }
    if (!block.name) return
    onUpdate(
      editing.index === null
        ? [...blocks, block]
        : blocks.map((b, i) => (i === editing.index ? block : b)),
    )
    close()
  }

  const remove = () => {
    if (!editing || editing.index === null) return
    onUpdate(blocks.filter((_, i) => i !== editing.index))
    close()
  }

  useEffect(() => {
    if (!editing) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        {blocks.map((block, i) => (
          <button
            key={i}
            onClick={() => openExisting(i)}
            title={block.description}
            className="px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-200 hover:bg-neutral-700 hover:border-neutral-600 transition-colors cursor-pointer"
          >
            {block.name}
          </button>
        ))}
        <button
          onClick={openNew}
          aria-label="Add a block"
          className="px-8 py-1.5 rounded-md border border-dashed border-neutral-700 bg-neutral-900 text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
        >
          +
        </button>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editing.index === null ? 'Add a block' : `Edit ${blocks[editing.index]?.name}`}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-xl rounded-lg border border-neutral-700 bg-neutral-900 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <label className="text-lg font-semibold tracking-tight">Topic Name</label>
              <button
                onClick={close}
                aria-label="Close"
                className="text-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer leading-none text-lg"
              >
                ✕
              </button>
            </div>
            <input
              autoFocus
              type="text"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="Debate Topic"
              className="w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
            />

            <div className="space-y-1">
              <label className="block text-lg font-semibold tracking-tight">Topic Description</label>
              <p className="text-sm text-neutral-500">
                The text that will be injected into the LLM when this block is added.
              </p>
            </div>
            <textarea
              rows={6}
              value={editing.description}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-y"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={remove}
                disabled={editing.index === null}
                className="px-5 py-2 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-300 hover:bg-neutral-700 hover:border-neutral-600 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Remove
              </button>
              <button
                onClick={save}
                disabled={!editing.name.trim()}
                className="px-5 py-2 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-100 hover:bg-neutral-700 hover:border-neutral-600 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
