'use client'

export type ActionState = { status: 'idle' | 'loading' | 'done' | 'error'; result: unknown }

export function ActionButton({ label, loadingLabel, loading, disabled, onClick }: {
  label: string
  loadingLabel: string
  loading: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="w-full px-5 py-2.5 rounded-lg border border-neutral-700 bg-neutral-900 text-base font-medium text-neutral-200 hover:bg-neutral-800 hover:border-neutral-600 active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
    >
      {loading ? loadingLabel : label}
    </button>
  )
}

type ParticipantLink = {url: string; type: string; role?: string}
type CohortLinks = { participant_urls?: ParticipantLink[] }

export function ResultBox({ title, state, links, showMessage, linkPrefix }: {
  title: string
  state: ActionState
  links?: { cohorts?: CohortLinks[]; mode?: string }
  showMessage?: boolean
  // Prepended to each participant link, so results from several experiments
  // shown together stay distinguishable (e.g. "Exp 2 - Participant 1").
  linkPrefix?: string
}) {
  const isError = state.status === 'error'
  const message = showMessage && state.result && typeof state.result === 'object'
    ? (state.result as Record<string, unknown>).message as string | undefined
    : undefined

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-800">
        <span className={`w-1.5 h-1.5 rounded-full ${isError ? 'bg-red-500' : 'bg-emerald-500'}`} />
        <span className="text-sm font-medium text-neutral-400 uppercase tracking-wider">{title} {links?.mode ? `(${links.mode})` : ''}</span>
      </div>
      <div className="p-4 space-y-3">
        {links?.cohorts && links.cohorts.map((cohort, cohortIdx) => (
          <div key={cohortIdx} className="space-y-2">
            {/* Only an all-agent cohort is watch-only. Once a human sits in one
                of the seats their link is meant to be played, so the note would
                be telling them the opposite of what to do. */}
            {(cohort.participant_urls?.length ?? 0) >= 2 && cohort.participant_urls?.every(u => u.type === "agent") && (
              <div className="mb-3">
                <label className="text-sm text-neutral-400">
                  The links below show you the Agent view as they complete the surveys and participate in the debate. You won't be able to interact.
                </label>
              </div>
            )}
            {cohort.participant_urls?.map((item, pIdx) => (
              <a
                key={`${cohortIdx}-${pIdx}`}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block text-sm text-neutral-300 hover:text-white underline underline-offset-2 transition-colors break-all"
              >
                {linkPrefix ? `${linkPrefix} - ` : ''}Participant {pIdx + 1} ({item.type}{item.role ? `, ${item.role}` : ''}) ↗
              </a>
            ))}
          </div>
        ))}
        {message && (
          <p className="text-sm text-neutral-300 whitespace-pre-wrap">{message}</p>
        )}
        <details className="text-sm text-neutral-400">
          <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 transition-colors select-none">Show JSON output</summary>
          <pre className="mt-2 overflow-auto leading-relaxed whitespace-pre-wrap break-words">
            {JSON.stringify(state.result, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  )
}
