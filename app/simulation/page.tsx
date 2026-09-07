'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { API_BASE } from '../lib/config'
import * as yaml from 'js-yaml'
import { Nav } from '../components/Nav'
import { PairingsEditor, newPairingId, summarizePairing, type Pairing } from '../components/PairingsEditor'
import { BlockCustomization, DEFAULT_BLOCKS, type Block } from '../components/BlockCustomization'
import { ActionButton, ResultBox, type ActionState } from '../components/ExperimentActions'
import { useSavedAgents } from '../lib/agents'

const SUBMISSION_FORMS = {
  track1: 'https://docs.google.com/forms/d/e/1FAIpQLSfTt_sYtTiiq_DszbId2VyqSLUr0tsfcRZqiC3uHi0YXh-3ew/viewform?usp=dialog',
  track2: 'https://docs.google.com/forms/d/e/1FAIpQLSdfl4JQUFvxKaIAd2uXZCmMZEPu7NUl4_omg26YgupUqqjvCA/viewform?usp=publish-editor',
} as const

const DEFAULT_SIMULATION = {
  description: '',
  blocks: DEFAULT_BLOCKS,
  max_utterance: 15,
  max_time: 30,
  pairings: [] as Pairing[],
}

// One row of the Simulate Conversation panel: which experiment to run, how many
// times. `experiment` holds a pairing id, so removing a pairing removes exactly
// the rows that referenced it rather than shifting them onto a neighbour.
type SimRun = { experiment: string; repeats: string }

const EMPTY_RUN: SimRun = { experiment: '', repeats: '1' }

// How many times a single experiment may be run.
const MAX_RUNS = 5

// Simulations saved before pairings had ids still need one to be referenceable.
function withPairingIds(content: string): string {
  try {
    const data = JSON.parse(content)
    if (Array.isArray(data.pairings)) {
      data.pairings = data.pairings.map((p: Pairing) => (p?.id ? p : { ...p, id: newPairingId() }))
    }
    return JSON.stringify(data, null, 2)
  } catch {
    return content
  }
}

// Reusable label + hint for the conversation parameter fields.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-neutral-300">{label}</label>
      {children}
    </div>
  )
}

export default function SimulationPage() {
  const router = useRouter()
  const [authReady, setAuthReady] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  // Agents come from the Agent Participants toolkit, so saving one there makes
  // it selectable in the Pairings below.
  const { agents } = useSavedAgents()
  const agentOptions = useMemo(
    () => agents.map(a => ({ value: a.id, label: a.name })),
    [agents],
  )

  // saving
  const [savedTemplates, setSavedTemplates] = useState<{ id: string; name: string }[]>([])
  const [templateName, setTemplateName] = useState('Simulation Export 1')
  const [lastSavedContent, setLastSavedContent] = useState<string | null>(null)
  const [lastSavedName, setLastSavedName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSaveAlert, setShowSaveAlert] = useState(false)

  const [simulationData, setSimulationData] = useState<string | null>(null)
  const [showAsYaml, setShowAsYaml] = useState(false)
  const [runs, setRuns] = useState<SimRun[]>([{ experiment: '', repeats: '1' }])
  const [notice, setNotice] = useState<string | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  // One entry per pairing that was built, in pairing order.
  const [createResults, setCreateResults] = useState<{ label: string; prefix: string; state: ActionState }[]>([])
  // One entry per run row that was submitted, in the order they were listed.
  const [simResults, setSimResults] = useState<{ label: string; state: ActionState }[]>([])

  const isDirty = simulationData !== null && (simulationData !== lastSavedContent || templateName !== lastSavedName)

  const simulationParsed = useMemo(() => {
    try { return JSON.parse(simulationData ?? '') } catch { return null }
  }, [simulationData])

  const pairings: Pairing[] = useMemo(() => simulationParsed?.pairings ?? [], [simulationParsed])
  const blocks: Block[] = useMemo(() => simulationParsed?.blocks ?? [], [simulationParsed])

  async function fetchSavedTemplates() {
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`${API_BASE}/api/simulations`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setSavedTemplates(data.templates)
      if (data.count > 0) {
        const first = data.templates[0]
        const loadRes = await fetch(`${API_BASE}/api/simulations/load?id=${encodeURIComponent(first.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (loadRes.ok) {
          const loaded = await loadRes.json()
          const content = withPairingIds(loaded.content)
          setSimulationData(content)
          setTemplateName(loaded.name)
          setLastSavedContent(content)
          setLastSavedName(loaded.name)
          setRuns([EMPTY_RUN])
        }
      } else {
        setTemplateName('Simulation Export 1')
      }
    } catch (e) {
      console.warn('fetchSavedTemplates failed:', e)
    }
  }

  async function handleSave() {
    if (!templateName.trim()) return
    const token = await auth.currentUser?.getIdToken()
    if (!token) return

    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/simulations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: templateName.trim(), content: simulationData }),
      })
      if (res.ok) {
        setLastSavedContent(simulationData)
        setLastSavedName(templateName.trim())
        await fetchSavedTemplates()
        setShowSaveAlert(true)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleLoad(id: string) {
    if (isDirty) {
      const ok = window.confirm('You have unsaved changes. Load a different simulation and discard them?')
      if (!ok) return
    }
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(`${API_BASE}/api/simulations/load?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    const content = withPairingIds(data.content)
    setSimulationData(content)
    setTemplateName(data.name)
    setLastSavedContent(content)
    setLastSavedName(data.name)
    setRuns([EMPTY_RUN])
  }

  function newSimulation() {
    setSimulationData(JSON.stringify(DEFAULT_SIMULATION, null, 2))
    setTemplateName('Simulation Export 1')
    setLastSavedContent(null)
    setLastSavedName(null)
    setRuns([EMPTY_RUN])
  }

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace('/')
      } else {
        setAuthReady(true)
        setUserEmail(user.email)
        setSimulationData(JSON.stringify(DEFAULT_SIMULATION, null, 2))
        fetchSavedTemplates()
      }
    })
  }, [router])

  useEffect(() => {
    if (isDirty) setShowSaveAlert(false)
  }, [isDirty])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const updateRun = (index: number, patch: Partial<SimRun>) =>
    setRuns(runs.map((run, i) => (i === index ? { ...run, ...patch } : run)))

  // Deleting an experiment also deletes the Simulate Conversation rows that ran it.
  const updatePairings = (next: Pairing[]) => {
    updateSimulationField('pairings', next)
    const ids = new Set(next.map(p => p.id))
    setRuns(prev => prev.filter(run => run.experiment === '' || ids.has(run.experiment)))
  }

  const updateSimulationField = (key: string, value: string | number | Pairing[] | Block[]) => {
    setSimulationData(prev => {
      try {
        const data = JSON.parse(prev ?? '')
        data[key] = value
        return JSON.stringify(data, null, 2)
      } catch { return prev }
    })
  }

  function simulationYaml(): string {
    try { return yaml.dump(JSON.parse(simulationData ?? '')) } catch { return simulationData ?? '' }
  }

  // Each selected row becomes its own experiment: the pairing decides how many
  // agents talk and whether a mediator joins, and "Runs" becomes the cohort
  // count, so one row repeated N times is N cohorts of the same setup.
  async function handleSimulate() {
    const queued = runs
      .map(run => ({ run, pairingIndex: pairings.findIndex(p => p.id === run.experiment) }))
      .filter(({ pairingIndex }) => pairingIndex >= 0)

    if (queued.length === 0) {
      setNotice('Pick an experiment to run first.')
      return
    }

    // A conversation needs at least two agents; the backend has no one to pair
    // the lone agent with otherwise.
    const short = queued.find(({ pairingIndex }) => summarizePairing(pairings[pairingIndex]).agentCount < 2)
    if (short) {
      setNotice(`Experiment ${short.pairingIndex + 1} needs at least 2 agents to simulate.`)
      return
    }

    const idToken = await auth.currentUser?.getIdToken()
    if (!idToken) return

    const simulationTemplate = simulationYaml()
    setNotice(null)
    setSimResults([])
    setSimulating(true)
    try {
      for (const { run, pairingIndex } of queued) {
        const { agentCount, hasMediator } = summarizePairing(pairings[pairingIndex])
        const label = `Experiment ${pairingIndex + 1}`
        try {
          const res = await fetch(`${API_BASE}/api/create-experiment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              simulationTemplate,
              mediator: hasMediator ? 'preset' : 'none',
              numAgents: agentCount,
              mode: 'agent-agent',
              action: 'simulate',
              numCohorts: run.repeats || '1',
              idToken,
            }),
          })
          const data = await res.json()
          setSimResults(prev => [...prev, { label, state: { status: res.ok ? 'done' : 'error', result: data } }])
        } catch (e) {
          setSimResults(prev => [...prev, { label, state: { status: 'error', result: String(e) } }])
        }
      }
    } finally {
      setSimulating(false)
    }
  }

  // Builds one cohort of agents per pairing and hands back links to watch them,
  // rather than running a batch. Unlike Simulate it needs no sign-in and spends
  // no quota, so it is the cheap way to eyeball every setup at once.
  async function handleCreateAgentAgent() {
    const eligible = pairings
      .map((pairing, index) => ({ index, ...summarizePairing(pairing) }))
      .filter(p => p.agentCount >= 2)

    if (eligible.length === 0) {
      setNotice(
        pairings.length === 0
          ? 'Add an experiment under Pairings first.'
          : 'Create (agent-agent) needs an experiment with at least 2 agents.',
      )
      return
    }

    // Pairings too small to hold a conversation are skipped rather than
    // blocking the ones that can run.
    const skipped = pairings.length - eligible.length
    setNotice(skipped > 0
      ? `Skipping ${skipped} experiment${skipped === 1 ? '' : 's'} with fewer than 2 agents.`
      : null)

    const simulationTemplate = simulationYaml()
    setCreateResults([])
    setCreating('agent-agent')
    try {
      for (const { index, agentCount, hasMediator } of eligible) {
        const label = `Create · Experiment ${index + 1}`
        const prefix = `Exp ${index + 1}`
        try {
          const res = await fetch(`${API_BASE}/api/create-experiment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              simulationTemplate,
              mediator: hasMediator ? 'preset' : 'none',
              numAgents: agentCount,
              mode: 'agent-agent',
              action: 'create',
            }),
          })
          const data = await res.json()
          setCreateResults(prev => [...prev, { label, prefix, state: { status: res.ok ? 'done' : 'error', result: data } }])
        } catch (e) {
          setCreateResults(prev => [...prev, { label, prefix, state: { status: 'error', result: String(e) } }])
        }
      }
    } finally {
      setCreating(null)
    }
  }

  function downloadSimulation() {
    let text: string
    try { text = yaml.dump(JSON.parse(simulationData ?? '')) } catch { text = simulationData ?? '' }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'simulation.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  function loadSimulationFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setSimulationData(withPairingIds(JSON.stringify(yaml.load(String(reader.result)), null, 2)))
        setRuns([EMPTY_RUN])
      } catch { /* ignore invalid yaml */ }
    }
    reader.readAsText(file)
  }

  if (!authReady) return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500 text-sm">
      Loading...
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row lg:h-screen lg:overflow-hidden bg-neutral-950 text-neutral-100">

      {/* Left column — configuration */}
      <div className="lg:flex-3 lg:overflow-y-auto p-8">
        <div className="w-full space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Simulation Toolkit</h1>
              <p className="text-base text-neutral-500 mt-1">Run Simulations</p>
            </div>

            <div className="flex items-center gap-3 mt-1">
              {userEmail && <span className="text-sm text-neutral-400">{userEmail}</span>}
              <button
                onClick={() => {
                  if (isDirty && !window.confirm('You have unsaved changes. Sign out anyway?')) return
                  signOut(auth).then(() => router.replace('/'))
                }}
                className="text-sm px-3 py-1.5 rounded-md border border-neutral-600 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
              >
                Sign out
              </button>
            </div>
          </div>

          <Nav />

          {/* Save / Load */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="Simulation name"
              className="flex-1 px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-3 py-1.5 rounded-md border text-sm transition-colors cursor-pointer disabled:opacity-50 ${saving
                  ? 'border-neutral-700 bg-neutral-900 text-neutral-400'
                  : isDirty
                    ? 'border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300'
                    : 'border-neutral-700 bg-neutral-900 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300'
                }`}
            >
              {saving ? 'Saving…' : isDirty ? 'Save *' : 'Saved'}
            </button>
            <select
              defaultValue=""
              onChange={e => {
                const formUrl = SUBMISSION_FORMS[e.target.value as keyof typeof SUBMISSION_FORMS]
                if (formUrl) window.open(formUrl, '_blank', 'noopener,noreferrer')
                e.target.value = ''
              }}
              className="px-3 py-1.5 rounded-md border border-blue-400/50 bg-blue-500/10 text-sm text-blue-300 hover:border-blue-300 hover:text-blue-200 transition-colors cursor-pointer"
            >
              <option value="" disabled>Submit…</option>
              <option value="track1">Track 1</option>
              <option value="track2">Track 2</option>
            </select>
            <button
              onClick={() => {
                if (window.confirm('Start a new simulation? Any unsaved changes will be lost.')) {
                  newSimulation()
                }
              }}
              className="px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              New Simulation
            </button>
            {savedTemplates.length > 0 && (
              <select
                defaultValue=""
                onChange={e => {
                  const t = savedTemplates.find(t => t.id === e.target.value)
                  if (t) handleLoad(t.id)
                  e.target.value = ''
                }}
                className="px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-300 hover:border-neutral-500 transition-colors cursor-pointer"
              >
                <option value="" disabled>Load saved…</option>
                {savedTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {showSaveAlert && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
              <p>Simulation saved!</p>
              <button
                onClick={() => setShowSaveAlert(false)}
                className="text-emerald-400 hover:text-emerald-200 cursor-pointer leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {/* Conversation parameters */}
          <div className="space-y-4">
            <div className="border-b border-neutral-800 pb-3">
              <h2 className="text-lg font-semibold tracking-tight">Conversation Parameters</h2>
            </div>

            <Field label="Description of Conversation">
              <textarea
                rows={4}
                value={simulationParsed?.description ?? ''}
                onChange={e => updateSimulationField('description', e.target.value)}
                placeholder="Describe the conversation the agents should have…"
                className="w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-y"
              />
            </Field>

            <Field label="Block Customization">
              <BlockCustomization
                blocks={blocks}
                onUpdate={next => updateSimulationField('blocks', next)}
              />
            </Field>

            <Field label="Max Utterance">
              <input
                type="number"
                min={1}
                value={simulationParsed?.max_utterance ?? ''}
                onChange={e => updateSimulationField('max_utterance', e.target.value === '' ? '' : Number(e.target.value))}
                className="w-40 px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500"
              />
            </Field>

            <Field label="Max Time">
              <input
                type="number"
                min={1}
                value={simulationParsed?.max_time ?? ''}
                onChange={e => updateSimulationField('max_time', e.target.value === '' ? '' : Number(e.target.value))}
                className="w-40 px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500"
              />
            </Field>

            <Field label="Pairings (combination of agents and mediators)">
              <PairingsEditor pairings={pairings} onUpdate={updatePairings} agentOptions={agentOptions} />
            </Field>
          </div>

        </div>
      </div>

      {/* Right column — export & actions */}
      <div className="lg:flex-1 lg:overflow-y-auto p-8 space-y-6 border-t border-neutral-800 lg:border-t-0 lg:border-l">
        {/* YAML preview */}
        <div className="space-y-1">
          <div className="border-b border-neutral-800 pb-3 mb-3">
            <h2 className="text-lg font-semibold tracking-tight">Export Simulation</h2>
          </div>
          <div className="space-y-2 gap-2">
            <button
              onClick={downloadSimulation}
              className="w-full flex items-center justify-center gap-2 text-md px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-600 transition-all duration-150 cursor-pointer"
            >
              Download Simulation .yaml File
            </button>
            <label className="w-full flex items-center justify-center gap-2 text-md px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-600 transition-all duration-150 cursor-pointer">
              Upload Simulation .yaml File
              <input
                type="file"
                accept=".yaml,.yml"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) loadSimulationFile(f); e.target.value = '' }}
              />
            </label>
          </div>
          <button
            onClick={() => setShowAsYaml(v => !v)}
            className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {showAsYaml ? '▾ Hide YAML' : '▸ Show YAML'}
          </button>
          {showAsYaml && (
            <textarea
              disabled
              value={(() => { try { return yaml.dump(JSON.parse(simulationData ?? '')) } catch { return simulationData ?? '' } })()}
              className="w-full h-96 p-2 rounded-lg border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 resize-y font-mono"
            />
          )}
        </div>

        {/* Simulation testing */}
        <div className="space-y-3">
          <div className="border-b border-neutral-800 pb-3 mb-3">
            <h2 className="text-lg font-semibold tracking-tight">Simulation Testing</h2>
          </div>
          <div className="space-y-3">
            {(['human-agent', 'human-human', 'agent-agent'] as const).map(mode => (
              <ActionButton
                key={mode}
                label={`Create (${mode})`}
                loadingLabel="Creating…"
                loading={creating === mode}
                onClick={mode === 'agent-agent'
                  ? handleCreateAgentAgent
                  : () => setNotice(`Create (${mode}) is not wired to the backend yet.`)}
              />
            ))}
            {createResults.map(({ label, prefix, state }, i) => (
              <ResultBox
                key={i}
                title={label}
                state={state}
                linkPrefix={prefix}
                links={state.status === 'done'
                  ? (state.result as { cohorts?: { participant_urls?: { url: string; type: string }[] }[] })
                  : undefined}
              />
            ))}
          </div>
        </div>

        {/* Simulate conversation */}
        <div className="space-y-3">
          <div className="border-b border-neutral-800 pb-3 mb-3">
            <h2 className="text-lg font-semibold tracking-tight">Simulate Conversation</h2>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <span className="flex-1">Experiment</span>
              <span className="w-20">Runs</span>
              <span className="w-4" />
            </div>
            {runs.map((run, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={run.experiment}
                  onChange={e => updateRun(i, { experiment: e.target.value })}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-sm text-neutral-300 hover:border-neutral-500 transition-colors cursor-pointer"
                >
                  <option value="" disabled>Experiment #</option>
                  {pairings.map((pairing, p) => (
                    <option key={pairing.id} value={pairing.id}>Experiment {p + 1}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={MAX_RUNS}
                  value={run.repeats}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '') return updateRun(i, { repeats: '' })
                    const n = Math.floor(Number(v))
                    if (Number.isFinite(n)) updateRun(i, { repeats: String(Math.min(MAX_RUNS, Math.max(1, n))) })
                  }}
                  className="w-20 px-3 py-2 rounded-lg border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500"
                />
                <button
                  onClick={() => setRuns(runs.filter((_, j) => j !== i))}
                  aria-label="Remove this run"
                  className="w-4 text-neutral-600 hover:text-neutral-300 transition-colors cursor-pointer leading-none"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => setRuns([...runs, EMPTY_RUN])}
              disabled={runs.length >= pairings.length}
              aria-label="Add an experiment to run"
              title={pairings.length === 0
                ? 'Add an experiment under Pairings first'
                : runs.length >= pairings.length
                  ? `You can add at most ${pairings.length} row${pairings.length === 1 ? '' : 's'} — one per experiment`
                  : undefined}
              className="w-full py-2 rounded-lg border border-dashed border-neutral-700 bg-neutral-900 text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-neutral-700 disabled:hover:text-neutral-400"
            >
              +
            </button>
          </div>
          <ActionButton
            label="Simulate"
            loadingLabel="Simulating…"
            loading={simulating}
            onClick={handleSimulate}
          />
          {simResults.map(({ label, state }, i) => (
            <ResultBox key={i} title={label} state={state} showMessage />
          ))}
        </div>

        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-400">
            <p>{notice}</p>
            <button
              onClick={() => setNotice(null)}
              className="text-neutral-500 hover:text-neutral-300 cursor-pointer leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
