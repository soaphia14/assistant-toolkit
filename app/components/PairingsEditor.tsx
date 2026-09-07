'use client'

// `id` is stable for the life of the pairing so that other panels (e.g. Simulate
// Conversation) can reference an experiment without breaking when one is removed
// and the remaining ones shift position.
export type Pairing = { id: string; members: string[] }

export const newPairingId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `pairing-${Math.random().toString(36).slice(2)}`

export type MemberOption = { value: string; label: string }

// TODO: replace with the saved mediators once that toolkit is wired up. Agents
// already come from the Agent Participants toolkit via `agentOptions`.
export const MEDIATOR_OPTIONS = [
  { value: 'no_mediator', label: 'No mediator' },
  { value: 'mediator1', label: 'Mediator1' },
  { value: 'mediator2', label: 'Mediator2' },
  { value: 'mediator3', label: 'Mediator3' },
] as const

const MEDIATOR_VALUES = new Set<string>(
  MEDIATOR_OPTIONS.filter(o => o.value !== 'no_mediator').map(o => o.value),
)

// What a pairing means to a run: how many agents sit in the conversation, and
// whether a mediator joins them. Which specific agent/mediator was picked is
// ignored for now — agents are generated with random stances and the mediator
// comes from the stock preset.
//
// Agents are identified by exclusion rather than by a fixed list, because the
// list is now the user's own saved agents: a simulation saved against an agent
// that has since been renamed still counts toward the agent total.
export function summarizePairing(pairing: Pairing) {
  const selected = pairing.members.filter(m => m && m !== 'no_mediator')
  return {
    agentCount: selected.filter(m => !MEDIATOR_VALUES.has(m)).length,
    hasMediator: selected.some(m => MEDIATOR_VALUES.has(m)),
  }
}

function ordinal(n: number) {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

export function PairingsEditor({ pairings, onUpdate, agentOptions = [] }: {
  pairings: Pairing[]
  onUpdate: (pairings: Pairing[]) => void
  /** Agents saved in the Agent Participants toolkit. */
  agentOptions?: MemberOption[]
}) {
  const agentValues = new Set(agentOptions.map(o => o.value))
  const addExperiment = () => onUpdate([...pairings, { id: newPairingId(), members: [] }])

  const removeExperiment = (idx: number) => onUpdate(pairings.filter((_, i) => i !== idx))

  const addMember = (idx: number) =>
    onUpdate(pairings.map((p, i) => (i === idx ? { ...p, members: [...p.members, ''] } : p)))

  const setMember = (idx: number, memberIdx: number, value: string) =>
    onUpdate(pairings.map((p, i) =>
      i === idx ? { ...p, members: p.members.map((m, j) => (j === memberIdx ? value : m)) } : p,
    ))

  const removeMember = (idx: number, memberIdx: number) =>
    onUpdate(pairings.map((p, i) =>
      i === idx ? { ...p, members: p.members.filter((_, j) => j !== memberIdx) } : p,
    ))

  return (
    <div className="flex flex-wrap gap-4">
      {pairings.map((pairing, idx) => (
        <div
          key={pairing.id}
          className="w-64 min-h-64 flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-300">{ordinal(idx + 1)} experiment</span>
            <button
              onClick={() => removeExperiment(idx)}
              aria-label={`Remove ${ordinal(idx + 1)} experiment`}
              className="text-neutral-600 hover:text-neutral-300 transition-colors cursor-pointer leading-none px-1"
            >
              ×
            </button>
          </div>

          {pairing.members.map((member, memberIdx) => (
            <div key={memberIdx} className="flex items-center gap-1.5">
              <select
                value={member}
                onChange={e => setMember(idx, memberIdx, e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500 transition-colors cursor-pointer"
              >
                <option value="" disabled>Select…</option>
                <optgroup label="Mediators">
                  {MEDIATOR_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Agents">
                  {agentOptions.length === 0 && (
                    <option value="" disabled>Save an agent in the Agent Participants toolkit</option>
                  )}
                  {agentOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
                {/* An agent the simulation was saved against but that no longer
                    exists still needs an option, or the select would silently
                    blank the choice out. */}
                {member && !agentValues.has(member) && !MEDIATOR_VALUES.has(member) && member !== 'no_mediator' && (
                  <option value={member}>{member} (no longer saved)</option>
                )}
              </select>
              <button
                onClick={() => removeMember(idx, memberIdx)}
                aria-label="Remove selection"
                className="text-neutral-600 hover:text-neutral-300 transition-colors cursor-pointer leading-none px-1"
              >
                ×
              </button>
            </div>
          ))}

          <button
            onClick={() => addMember(idx)}
            aria-label={`Add an agent or mediator to the ${ordinal(idx + 1)} experiment`}
            className="w-full py-1.5 rounded-md border border-neutral-700 bg-neutral-800 text-sm text-neutral-300 hover:bg-neutral-700 hover:border-neutral-600 transition-colors cursor-pointer"
          >
            +
          </button>
        </div>
      ))}

      <button
        onClick={addExperiment}
        aria-label="Add an experiment"
        className="w-64 min-h-64 flex items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-900/40 text-3xl text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 hover:bg-neutral-900 transition-colors cursor-pointer"
      >
        +
      </button>
    </div>
  )
}
