'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { API_BASE } from '../lib/config'
import {
  StructuredPromptEditor,
  type PromptItem,
} from '../components/StructuredPromptEditor'
import { ActionButton, ResultBox, type ActionState } from '../components/ExperimentActions'
import { MediatorSection } from '../components/MediatorSection'
import { SaveSection } from '../components/SaveSection'
import { YamlIOSection } from '../components/YamlIOSection'

const idle: ActionState = { status: 'idle', result: null }

// ============================================================
// Data shape
//
// Message-creation prompts live in an order/add_to graph (matching the
// platform's ChatPromptConfig.prompt/order/addTo dicts): prompts sharing an
// `order` run in parallel; before a prompt with a strictly greater order
// runs, any prompt whose `addTo` points at it has its output prepended to
// it. A prompt whose `addTo` is the "message" sentinel is one whose output
// is sent to the chat once it finishes. Thought and Character are separate,
// optional, single block-prompts outside that graph.
// ============================================================

const MESSAGE_SENTINEL = 'message'

type PromptMapEntry = {
  order: number
  addTo: string | null
  prompt: PromptItem[]
}

// There's no separate, distinct "message creation prompt" — whichever
// prompt(s) send to "Message" ARE the ones that produce the chat message,
// and that only makes sense as the final step, so they must always sit at
// the highest order. Rather than leaving raw order numbers to drift and
// accumulate gaps as prompts are added/removed/reordered, every edit
// re-compacts everything to clean, contiguous ranks (1, 2, 3, ...) —
// preserving ties (parallel stages) and relative sequence — with the
// "Message" prompt(s) always landing on the final rank.
function normalizeOrders(map: Record<string, PromptMapEntry> | undefined) {
  if (!map) return
  const names = Object.keys(map)
  if (names.length === 0) return
  let terminalNames = names.filter(n => map[n].addTo === MESSAGE_SENTINEL)

  // Exactly one prompt sends to the chat at all times — it's not a per-prompt
  // choice that can be toggled off or shared. If none currently holds it
  // (its previous holder was just deleted), whichever was already ordered
  // last inherits it. If more than one ended up marked that way (e.g. from
  // an uploaded YAML), keep just the one ordered last and clear the rest.
  if (terminalNames.length === 0) {
    const promoted = names.reduce((a, b) => (map[a].order ?? 1) >= (map[b].order ?? 1) ? a : b)
    map[promoted].addTo = MESSAGE_SENTINEL
    terminalNames = [promoted]
  } else if (terminalNames.length > 1) {
    const keep = terminalNames.reduce((a, b) => (map[a].order ?? 1) >= (map[b].order ?? 1) ? a : b)
    for (const n of terminalNames) {
      if (n !== keep) map[n].addTo = null
    }
    terminalNames = [keep]
  }

  const otherNames = names.filter(n => !terminalNames.includes(n))

  const distinctOrders = Array.from(new Set(otherNames.map(n => map[n].order ?? 1))).sort((a, b) => a - b)
  const rankOf = new Map(distinctOrders.map((value, i) => [value, i + 1]))

  for (const n of otherNames) {
    map[n].order = rankOf.get(map[n].order ?? 1)!
  }

  const lastRank = distinctOrders.length + 1
  for (const n of terminalNames) {
    map[n].order = lastRank
  }
}

type AgentTemplate = {
  persona: { id: string; name: string; avatar: string; pronouns: string; character: string }
  model: { apiType: string; modelName: string }
  generation: { temperature: number; reasoningLevel: string; includeReasoning: boolean }
  chatSettings: {
    canSelfTriggerCalls: boolean
    initialMessage: string
    wordsPerMinute: number
    includeScaffoldingInPrompt: boolean
    numRetries: number
    context: string
    promptMap: Record<string, PromptMapEntry>
    thoughtPrompt: PromptItem[] | null
    characterPrompt: PromptItem[] | null
  }
}

function PromptEditorDescription({ description }: { description: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2.5 text-sm text-neutral-500 space-y-1.5">
      <p className="font-medium text-neutral-300">Prompt Purpose</p>
      <p>{description}</p>
    </div>
  )
}

function PromptBlockLegend() {
  const legend = (color: string, title: string, text: string) => (
    <>
      <span className={`inline-block rounded px-2 py-0.5 font-medium text-neutral-900 ${color}`}>{title}</span>
      <span>{text}</span>
    </>
  )

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2.5 text-sm text-neutral-500">
      <p className="font-medium text-neutral-400 mb-4">Available Prompt Blocks</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
        <span className="font-medium text-neutral-300">Freeform Text</span>
        <span>Custom instructions written directly by you.</span>
        {legend('bg-[#fde8c8]', 'Debate Topic', 'The topic of the debate.')}
        {legend('bg-[#fde8c8]', 'Debate Statement', 'The statement participants take a position on.')}
        {legend('bg-[#dce1fd]', 'Participant Initial Positions', "The participants' pre-conversation survey responses.")}
        {legend('bg-[#dce1fd]', 'Conversation Context', 'The discussion up to the current message.')}
        {legend('bg-[#f9d8f5]', 'Profile Info', "This agent's own profile data.")}
        {legend('bg-[#dce1fd]', 'Participant Info', "The other participant's profile data.")}
        {legend('bg-[#dce1fd]', 'Participant Chat Input', "The other participant's current, unsent chat draft.")}
        {legend('bg-[#d8f9e0]', 'Initialization Result', 'The output of the initialization prompt.')}
        {legend('bg-[#f08673]', 'Target Bias Position', 'The direction of covert influence, if used.')}
      </div>
    </div>
  )
}

function makeDefaultTemplate(userEmail: string | null): AgentTemplate {
  const idBase = userEmail ? userEmail.split('@')[0] : 'toolkit'
  return {
    persona: { id: `${idBase}-agent`, name: 'Agent', avatar: '🤖', pronouns: 'they/them', character: '' },
    model: { apiType: 'GEMINI', modelName: 'gemini-3-flash-preview' },
    generation: { temperature: 0.7, reasoningLevel: 'off', includeReasoning: false },
    chatSettings: {
      canSelfTriggerCalls: false,
      initialMessage: '',
      wordsPerMinute: 0,
      includeScaffoldingInPrompt: true,
      numRetries: 2,
      context: 'all',
      promptMap: {
        'Message Creation Prompt': {
          order: 1,
          addTo: MESSAGE_SENTINEL,
          prompt: [{ type: 'CONTEXT', context: 'current' } as PromptItem],
        },
      },
      thoughtPrompt: null,
      characterPrompt: null,
    },
  }
}

const POLL_INTERVAL_MS = 10000
const MAX_WAIT_TIME_MS = 300000

export default function AgentParticipantsPage() {
  const router = useRouter()
  const [authReady, setAuthReady] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [simQuota, setSimQuota] = useState<{ used: number; limit: number; simMaxWaitTimeMs: number } | null>(null)

  // Seeded synchronously so the prompt editor always has something to show
  // and edit immediately, instead of waiting on the save system's network
  // round trip (which the editor should not depend on to be usable).
  const [agentData, setAgentData] = useState<string | null>(() => JSON.stringify(makeDefaultTemplate(null), null, 2))
  const [dirty, setDirty] = useState(false)

  const [activePromptType, setActivePromptType] = useState<'message' | 'character' | 'thought'>('message')
  const [activeMessageName, setActiveMessageName] = useState<string | null>(
    () => Object.keys(makeDefaultTemplate(null).chatSettings.promptMap)[0] ?? null,
  )
  const [editingName, setEditingName] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const getDefaultContent = useCallback(async () => {
    return JSON.stringify(makeDefaultTemplate(userEmail), null, 2)
  }, [userEmail])

  async function fetchQuota() {
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`${API_BASE}/api/quota`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setSimQuota({ used: data.used, limit: data.limit, simMaxWaitTimeMs: data.simMaxWaitTimeMs ?? MAX_WAIT_TIME_MS })
    } catch (e) {
      console.warn('fetchQuota failed:', e)
    }
  }

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace('/')
      } else {
        setAuthReady(true)
        setUserEmail(user.email)
        fetchQuota()
      }
    })
  }, [router])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const agentParsed = useMemo<AgentTemplate | null>(() => {
    try { return JSON.parse(agentData ?? '') } catch { return null }
  }, [agentData])

  const promptMap = agentParsed?.chatSettings?.promptMap ?? {}
  const promptNames = useMemo(
    () => Object.keys(promptMap).sort((a, b) => (promptMap[a]?.order ?? 1) - (promptMap[b]?.order ?? 1)),
    [promptMap],
  )

  // A loaded template must always have at least one message-creation prompt
  // to edit — self-heal if one is somehow missing rather than showing a
  // blank, unusable editor.
  useEffect(() => {
    if (!agentParsed || !agentParsed.chatSettings) return
    if (Object.keys(agentParsed.chatSettings.promptMap ?? {}).length > 0) return
    updateAgentData(data => {
      data.chatSettings.promptMap = {
        'Message Creation Prompt': {
          order: 1,
          addTo: MESSAGE_SENTINEL,
          prompt: [{ type: 'CONTEXT', context: 'current' } as PromptItem],
        },
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentParsed])

  // Keep a valid active tab as the template loads/changes underneath us.
  useEffect(() => {
    if (activeMessageName && promptMap[activeMessageName]) return
    if (promptNames.length > 0) setActiveMessageName(promptNames[0])
  }, [promptNames, activeMessageName, promptMap])

  const activeEntry = activeMessageName ? promptMap[activeMessageName] : undefined

  function updateAgentData(mutate: (data: AgentTemplate) => void) {
    setAgentData(prev => {
      try {
        const data = JSON.parse(prev ?? '')
        mutate(data)
        normalizeOrders(data.chatSettings?.promptMap)
        return JSON.stringify(data, null, 2)
      } catch { return prev }
    })
  }

  function updateAgentField(path: string[], value: string | boolean | number) {
    updateAgentData(data => {
      let obj: any = data
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]]
      obj[path[path.length - 1]] = value
    })
  }

  function addPrompt() {
    const names = Object.keys(promptMap)
    let n = names.length + 1
    let name = `New Prompt ${n}`
    while (promptMap[name]) { n++; name = `New Prompt ${n}` }
    // Land it right before whichever prompt sends to the chat — order gets
    // fully re-compacted right after anyway, so this just needs to sit after
    // every other non-message prompt.
    const otherMax = names
      .filter(k => promptMap[k].addTo !== MESSAGE_SENTINEL)
      .reduce((m, k) => Math.max(m, promptMap[k]?.order ?? 1), 0)
    updateAgentData(data => {
      data.chatSettings.promptMap[name] = { order: otherMax + 1, addTo: null, prompt: [] }
    })
    setActiveMessageName(name)
    setEditingName(name)
    setDraftName(name)
  }

  function deletePrompt(name: string) {
    if (Object.keys(promptMap).length <= 1) return
    updateAgentData(data => {
      delete data.chatSettings.promptMap[name]
      for (const entry of Object.values(data.chatSettings.promptMap)) {
        if ((entry as PromptMapEntry).addTo === name) (entry as PromptMapEntry).addTo = null
      }
    })
    if (activeMessageName === name) {
      const remaining = promptNames.filter(n => n !== name)
      setActiveMessageName(remaining[0] ?? null)
    }
  }

  function commitRename(oldName: string) {
    const trimmed = draftName.trim()
    setEditingName(null)
    if (!trimmed || trimmed === oldName || promptMap[trimmed]) return
    updateAgentData(data => {
      const map = data.chatSettings.promptMap
      const entry = map[oldName]
      delete map[oldName]
      map[trimmed] = entry
      for (const e of Object.values(map)) {
        if ((e as PromptMapEntry).addTo === oldName) (e as PromptMapEntry).addTo = trimmed
      }
    })
    setActiveMessageName(trimmed)
  }

  function updatePromptOrder(name: string, newOrder: number) {
    const order = Math.max(1, Math.floor(newOrder) || 1)
    updateAgentData(data => {
      const map = data.chatSettings.promptMap
      if (!map[name]) return
      map[name].order = order

      // Drop add_to links that no longer point strictly forward — a prompt
      // can only feed a prompt with a later order (or the "message" sentinel,
      // which has no order and is always valid).
      for (const entry of Object.values(map)) {
        const e = entry as PromptMapEntry
        if (!e.addTo || e.addTo === MESSAGE_SENTINEL) continue
        const target = map[e.addTo]
        if (!target || target.order <= e.order) e.addTo = null
      }
    })
  }

  function setPromptAddTo(name: string, addTo: string) {
    updateAgentData(data => {
      const map = data.chatSettings.promptMap
      if (addTo === MESSAGE_SENTINEL) {
        // Only one prompt can send to the chat at a time — claiming it here
        // takes it away from whichever prompt held it before.
        for (const key of Object.keys(map)) {
          if (key !== name && map[key].addTo === MESSAGE_SENTINEL) map[key].addTo = null
        }
      }
      map[name].addTo = addTo || null
    })
  }

  function updatePromptBlocks(name: string, items: PromptItem[]) {
    updateAgentData(data => {
      data.chatSettings.promptMap[name].prompt = items
    })
  }

  const characterEnabled = Array.isArray(agentParsed?.chatSettings?.characterPrompt)
  const thoughtEnabled = Array.isArray(agentParsed?.chatSettings?.thoughtPrompt)

  function setCharacterEnabled(enabled: boolean) {
    updateAgentData(data => {
      data.chatSettings.characterPrompt = enabled ? (data.chatSettings.characterPrompt ?? []) : null
    })
  }

  function setThoughtEnabled(enabled: boolean) {
    updateAgentData(data => {
      data.chatSettings.thoughtPrompt = enabled ? (data.chatSettings.thoughtPrompt ?? []) : null
    })
  }

  function updateCharacterBlocks(items: PromptItem[]) {
    updateAgentData(data => { data.chatSettings.characterPrompt = items })
  }

  function updateThoughtBlocks(items: PromptItem[]) {
    updateAgentData(data => { data.chatSettings.thoughtPrompt = items })
  }

  // ── Testing / simulation ────────────────────────────────────────────────

  const [experimentId, setExperimentId] = useState<string | null>('')
  const [createState, setCreateState] = useState<ActionState>(idle)
  const [simState, setSimState] = useState<ActionState>(idle)
  const [simStartTime, setSimStartTime] = useState<number | null>(null)
  const [simElapsed, setSimElapsed] = useState(0)
  const [createAction, setCreateAction] = useState<'create' | 'simulate' | null>(null)
  const [simExport, setSimExport] = useState<unknown>(null)
  const simPollRef = useRef<((countPolls: number) => Promise<void>) | null>(null)
  const [convokitLoading, setConvokitLoading] = useState(false)
  const [creating, setCreating] = useState<'human-agent' | 'agent-agent' | null>(null)
  const [numCohorts, setNumCohorts] = useState('5')
  const [numUtterances, setNumUtterances] = useState('15')

  useEffect(() => {
    if (simState.status !== 'loading' || simStartTime === null) return
    const lastPollCount = { current: 0 }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - simStartTime) / 1000)
      setSimElapsed(elapsed)
      const pollCount = Math.floor(elapsed / (POLL_INTERVAL_MS / 1000))
      if (pollCount > lastPollCount.current) {
        lastPollCount.current = pollCount
        simPollRef.current?.(pollCount)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [simState.status, simStartTime])

  const busy = creating !== null || simState.status === 'loading'

  async function downloadConvokit() {
    if (simExport === null) return
    setConvokitLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/convokit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simExport),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`ConvoKit conversion failed: ${err.error ?? res.statusText}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `convokit-${(simExport as { experiment?: { id?: string } })?.experiment?.id ?? 'export'}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`ConvoKit conversion error: ${String(e)}`)
    } finally {
      setConvokitLoading(false)
    }
  }

  async function handleCreate(mode: 'human-agent' | 'agent-agent', action: 'create' | 'simulate' = 'create') {
    setSimState(idle)
    setCreating(mode)
    setCreateAction(action)
    try {
      let idToken: string | undefined
      if (action === 'simulate') {
        idToken = await auth.currentUser?.getIdToken()
      }
      const res = await fetch(`${API_BASE}/api/create-experiment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentTemplate: agentData, mode, numCohorts, numUtterances, action, idToken }),
      })
      const data = await res.json()
      setCreateState({ status: res.ok ? 'done' : 'error', result: data })
      if (res.ok && action === 'simulate') fetchQuota()
      return res.ok ? data : null
    } catch (e) {
      setCreateState({ status: 'error', result: String(e) })
      return null
    } finally {
      setCreating(null)
      setCreateAction(null)
    }
  }

  async function handleSimPoll(countPolls: number) {
    if (!experimentId) return
    let lastExport = null
    let completedCohorts: string[] = []
    let totalSim = 0
    const maxPolls = Math.floor((simQuota?.simMaxWaitTimeMs ?? MAX_WAIT_TIME_MS) / POLL_INTERVAL_MS)

    try {
      const res = await fetch(`${API_BASE}/api/simulation-status?experimentId=${encodeURIComponent(experimentId)}`)
      const status = await res.json()
      if (!res.ok) { setSimState({ status: 'error', result: status }); return }

      lastExport = status.export

      completedCohorts = Object.entries(status.statuses ?? {})
        .filter(([, ss]) => (ss as string[]).length > 0 && (ss as string[]).every((s) => s === 'SUCCESS'))
        .map(([cid]) => cid)

      totalSim = Object.keys(status.statuses ?? {}).length

      if (status.completed) {
        setSimExport(status.export)
        setSimState({ status: 'done', result: { message: `Simulation complete (experiment_id: ${experimentId})` } })
        return
      }
      setSimState({ status: 'loading', result: { message: `Simulation running: ${completedCohorts.length}/${totalSim} discussions finished` } })
    } catch (e) {
      setSimState({ status: 'error', result: String(e) }); return
    }

    if (countPolls < maxPolls) {
      return
    }

    if (lastExport && completedCohorts.length > 0) {
      const done = new Set(completedCohorts)
      const exp = lastExport as {
        cohortMap?: Record<string, unknown>
        participantMap?: Record<string, { profile?: { currentCohortId?: string; agentConfig?: { agentId?: string } } }>
        agentParticipantMap?: Record<string, unknown>
      }

      const participantMap = Object.fromEntries(
        Object.entries(exp.participantMap ?? {}).filter(([, p]) => done.has(p?.profile?.currentCohortId ?? '')),
      )
      const usedAgentIds = new Set(
        Object.values(participantMap).map((p) => p?.profile?.agentConfig?.agentId).filter(Boolean),
      )

      setSimExport({
        ...exp,
        cohortMap: Object.fromEntries(
          Object.entries(exp.cohortMap ?? {}).filter(([cid]) => done.has(cid)),
        ),
        participantMap,
        agentParticipantMap: Object.fromEntries(
          Object.entries(exp.agentParticipantMap ?? {}).filter(([aid]) => usedAgentIds.has(aid)),
        ),
      })

      setSimState({ status: 'done', result: { message: `Timed out: ${completedCohorts.length}/${totalSim} discussions finished — export contains completed discussions only (experiment_id: ${experimentId})` } })
      return
    }

    setSimState({ status: 'error', result: 'Timed out waiting for the simulation to complete.' })
  }
  simPollRef.current = handleSimPoll

  async function handleCreateSim() {
    const data = await handleCreate('agent-agent', 'simulate')
    const experimentId: string | undefined = data?.experiment_id
    if (!experimentId) return
    setExperimentId(experimentId)

    setSimExport(null)
    setSimState({ status: 'loading', result: { message: 'Simulation running — waiting for agents to finish' } })

    setSimStartTime(Date.now())
    setSimElapsed(0)
  }

  if (!authReady) return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500 text-sm">
      Loading...
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row lg:h-screen lg:overflow-hidden bg-neutral-950 text-neutral-100">

      {/* LEFT COLUMN */}

      <div className="lg:flex-[3] overflow-y-auto p-8">

        <div className="space-y-5">

          {/* HEADER */}

          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Agent Participants Toolkit</h1>
              <p className="text-neutral-500 mt-1">Create and configure reusable AI participants.</p>
            </div>

            <div className="flex items-center gap-3 mt-1">
              {userEmail && <span className="text-sm text-neutral-400">{userEmail}</span>}
              <button
                onClick={() => {
                  if (dirty && !window.confirm('You have unsaved changes. Sign out anyway?')) return
                  signOut(auth).then(() => router.replace('/'))
                }}
                className="text-sm px-3 py-1.5 rounded-md border border-neutral-600 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
              >
                Sign out
              </button>
            </div>
          </div>

          {/* SAVE / LOAD — same system as the mediator toolkit */}

          <SaveSection
            collection="agents"
            content={agentData}
            onContentChange={setAgentData}
            getDefaultContent={getDefaultContent}
            onDirtyChange={setDirty}
            enabled={authReady}
          />

          {/* PROMPT EDITORS */}

          <div className="space-y-4">

            <div className="border-b border-neutral-800 pb-3">
              <h2 className="text-lg font-semibold">Prompt Editors</h2>
            </div>

            <p className="text-sm text-neutral-500">
              Configure the prompts that define your agent's behavior. There's no separate "message creation" prompt — whichever prompt's <span className="text-neutral-400">add to</span> is set to <span className="text-neutral-400">Message</span> is the one that produces the chat message, and it's automatically kept last in the order no matter how many other prompts you add before it. Prompts that share the same <span className="text-neutral-400">order</span> run in parallel; any other <span className="text-neutral-400">add to</span> choice prepends a prompt's output to a later one.
            </p>

            {/* PROMPT TYPE TABS — boxed container, matching the assistant toolkit */}

            <div className="rounded-lg border border-neutral-800">

              <div className="flex border-b border-neutral-800 bg-neutral-900/60">

                <button
                  onClick={() => setActivePromptType('message')}
                  className={`px-4 py-2.5 text-sm font-medium transition-colors ${activePromptType === 'message' ? 'text-neutral-100 border-b-2 border-neutral-400 -mb-px' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  Message Creation
                </button>

                <div className={`flex items-center ${activePromptType === 'character' ? 'border-b-2 border-neutral-400 -mb-px' : ''}`}>
                  <button
                    onClick={() => setActivePromptType('character')}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors ${activePromptType === 'character' ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >
                    Character
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={characterEnabled}
                    onClick={() => setCharacterEnabled(!characterEnabled)}
                    title={characterEnabled ? 'Disable character prompt' : 'Enable character prompt'}
                    className={`mr-3 relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${characterEnabled ? 'bg-neutral-200' : 'bg-neutral-700'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-neutral-950 transition-transform ${characterEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div className={`flex items-center ${activePromptType === 'thought' ? 'border-b-2 border-neutral-400 -mb-px' : ''}`}>
                  <button
                    onClick={() => setActivePromptType('thought')}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors ${activePromptType === 'thought' ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >
                    Thought
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={thoughtEnabled}
                    onClick={() => setThoughtEnabled(!thoughtEnabled)}
                    title={thoughtEnabled ? 'Disable thought prompt' : 'Enable thought prompt'}
                    className={`mr-3 relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${thoughtEnabled ? 'bg-neutral-200' : 'bg-neutral-700'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-neutral-950 transition-transform ${thoughtEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>

              </div>

              <div className="p-4 space-y-4">

                {activePromptType === 'message' && (
                  <div className="space-y-4">

                    {/* Named message-creation prompts */}
                    <div className="rounded-lg border border-neutral-800 overflow-hidden">
                      <div className="flex overflow-x-auto bg-neutral-900/60 border-b border-neutral-800">
                        {promptNames.map(name => {
                          const active = name === activeMessageName
                          return (
                            <div
                              key={name}
                              onClick={() => setActiveMessageName(name)}
                              className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer whitespace-nowrap text-sm font-medium transition-colors border-r border-neutral-800 ${active
                                ? 'bg-neutral-800 text-neutral-100 border-b-2 border-neutral-300'
                                : 'bg-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60'
                                }`}
                            >
                              {editingName === name ? (
                                <input
                                  autoFocus
                                  value={draftName}
                                  onBlur={() => commitRename(name)}
                                  onChange={e => setDraftName(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') commitRename(name) }}
                                  onClick={e => e.stopPropagation()}
                                  className="bg-transparent outline-none w-48"
                                />
                              ) : (
                                <span onDoubleClick={() => { setEditingName(name); setDraftName(name) }}>
                                  {name}
                                </span>
                              )}

                              {promptNames.length > 1 && (
                                <button
                                  onClick={e => { e.stopPropagation(); deletePrompt(name) }}
                                  className="hover:text-red-300 cursor-pointer"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          )
                        })}

                        <button
                          onClick={addPrompt}
                          className="shrink-0 px-4 py-2.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors text-lg cursor-pointer"
                          title="Add prompt"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {activeEntry && activeMessageName && (
                      <>
                        {/* Order / add to */}
                        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">

                          <div className="mb-4">
                            <h3 className="text-sm font-medium text-neutral-300">Prompt Execution</h3>
                            <p className="text-xs text-neutral-500 mt-1">Prompts with the same order run at the same time.</p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-neutral-300">Order</label>
                              <p className="text-xs text-neutral-500">
                                {activeEntry.addTo === MESSAGE_SENTINEL
                                  ? "Kept last automatically — this prompt sends to the chat, so it always runs after everything else."
                                  : 'Determines when this prompt runs.'}
                              </p>
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={activeEntry.order}
                                disabled={activeEntry.addTo === MESSAGE_SENTINEL}
                                onChange={e => updatePromptOrder(activeMessageName, Number(e.target.value))}
                                className="w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-neutral-300">Add to</label>
                              <p className="text-xs text-neutral-500">
                                {activeEntry.addTo === MESSAGE_SENTINEL
                                  ? "Locked — this is the prompt that sends to the chat. Delete it to let another prompt take over that role."
                                  : "Prepend this prompt's output to a later prompt."}
                              </p>
                              <select
                                value={activeEntry.addTo ?? ''}
                                disabled={activeEntry.addTo === MESSAGE_SENTINEL}
                                onChange={e => setPromptAddTo(activeMessageName, e.target.value)}
                                className="w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {activeEntry.addTo === MESSAGE_SENTINEL ? (
                                  <option value={MESSAGE_SENTINEL}>Message (send to chat)</option>
                                ) : (
                                  <>
                                    <option value="">None</option>
                                    {promptNames
                                      .filter(n => n !== activeMessageName && promptMap[n].order > activeEntry.order)
                                      .map(n => (
                                        <option key={n} value={n}>{n} (Order {promptMap[n].order})</option>
                                      ))}
                                  </>
                                )}
                              </select>
                            </div>

                          </div>
                        </div>

                        {/* Block editor */}
                        <PromptEditorDescription
                          description={
                            activeEntry.addTo === MESSAGE_SENTINEL
                              ? "This prompt produces the agent's chat message — it runs last, after any prompts that feed into it."
                              : "This prompt's output is prepended to the prompt it's added to, rather than being sent to the chat directly."
                          }
                        />
                        <PromptBlockLegend />
                        <StructuredPromptEditor
                          label={activeMessageName}
                          prompt={activeEntry.prompt}
                          stageId=""
                          onUpdate={items => updatePromptBlocks(activeMessageName, items)}
                        />
                      </>
                    )}
                  </div>
                )}

                {activePromptType === 'character' && (
                  <div className="space-y-4">
                    <PromptEditorDescription description="Define the character the agent should portray during the discussion. Toggle it on above to enable it." />
                    {characterEnabled ? (
                      <>
                        <PromptBlockLegend />
                        <StructuredPromptEditor
                          label="Character Prompt"
                          prompt={agentParsed?.chatSettings?.characterPrompt ?? []}
                          stageId=""
                          onUpdate={updateCharacterBlocks}
                        />
                      </>
                    ) : (
                      <p className="text-sm text-neutral-500">Disabled — toggle it on above to write a character prompt.</p>
                    )}
                  </div>
                )}

                {activePromptType === 'thought' && (
                  <div className="space-y-4">
                    <PromptEditorDescription description="Define the agent's thought history. Toggle it on above to enable it." />
                    {thoughtEnabled ? (
                      <>
                        <PromptBlockLegend />
                        <StructuredPromptEditor
                          label="Thought Prompt"
                          prompt={agentParsed?.chatSettings?.thoughtPrompt ?? []}
                          stageId=""
                          onUpdate={updateThoughtBlocks}
                        />
                      </>
                    ) : (
                      <p className="text-sm text-neutral-500">Disabled — toggle it on above to write a thought prompt.</p>
                    )}
                  </div>
                )}

              </div>
            </div>

          </div>

          {/* ========================================= */}

          <div className="border-b border-neutral-800 pb-3 mt-8">
            <h2 className="text-lg font-semibold">Agent Configuration</h2>
          </div>

          <MediatorSection
            title="Agent Persona"
            mediatorParsed={agentParsed}
            onUpdate={updateAgentField}
            fields={[
              { label: 'Name', description: 'Displayed name of the agent.', path: ['persona', 'name'], type: 'text' },
              { label: 'Avatar', description: "Emoji shown as this agent's avatar.", path: ['persona', 'avatar'], type: 'emoji' },
              { label: 'Pronouns', description: "This agent's pronouns.", path: ['persona', 'pronouns'], type: 'text', placeholder: 'they/them' },
            ]}
          />

          <MediatorSection
            title="Agent Parameters"
            mediatorParsed={agentParsed}
            onUpdate={updateAgentField}
            fields={[
              {
                label: 'Character',
                description: 'Optional character name or description for this agent.',
                path: ['persona', 'character'],
                type: 'text',
                placeholder: 'e.g. A skeptical journalist',
              },
              {
                label: 'Typing Speed (Words Per Minute)',
                description: 'Typing speed. Set to zero for instant responses.',
                path: ['chatSettings', 'wordsPerMinute'],
                type: 'number',
                min: 0,
                max: 2000,
                step: 1,
              },
              {
                label: 'Temperature',
                description: 'Controls randomness of responses.',
                path: ['generation', 'temperature'],
                type: 'number',
                min: 0,
                max: 2,
                step: 0.1,
              },
              {
                label: 'Initial Message',
                description: 'Automatically sent when the discussion begins.',
                path: ['chatSettings', 'initialMessage'],
                type: 'text',
                placeholder: 'Hello everyone!',
              },
            ]}
          />

        </div>
      </div>

      {/* ========================================= */}
      {/* RIGHT SIDEBAR */}
      {/* ========================================= */}

      <div className="lg:flex-1 overflow-y-auto border-l border-neutral-800 p-8 space-y-6">

        <YamlIOSection label="Agent" filename="agent.yaml" data={agentData} setData={setAgentData} />

        <div className="space-y-3">
          <div className="border-b border-neutral-800 pb-3 mb-3">
            <h2 className="text-lg font-semibold tracking-tight">Agent Testing</h2>
          </div>
          <p className="text-xs text-neutral-500">
            "Human-agent" pairs a human tester with this agent. "Agent-agent" pairs this agent against a clone of itself.
          </p>
          <div className="space-y-3">
            <ActionButton
              label="Create (human-agent)"
              loadingLabel="Creating…"
              loading={creating === 'human-agent'}
              disabled={busy}
              onClick={() => handleCreate('human-agent')}
            />
            <ActionButton
              label="Create (agent-agent)"
              loadingLabel="Creating…"
              loading={creating === 'agent-agent' && createAction === 'create'}
              disabled={busy}
              onClick={() => handleCreate('agent-agent', 'create')}
            />
          </div>

          {createState.result !== null && (
            <ResultBox
              title="Create"
              state={createState}
              links={
                createState.status === 'done' && typeof createState.result === 'object' && createState.result !== null
                  ? createState.result
                  : undefined
              }
            />
          )}
        </div>

        <div className="space-y-3">
          <div className="border-b border-neutral-800 pb-3 mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Agent Simulation</h2>
          </div>
          {simQuota && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${simQuota.used >= simQuota.limit ? 'bg-red-500' : 'bg-neutral-500'}`}
                  style={{ width: `${Math.min(100, (simQuota.used / simQuota.limit) * 100)}%` }}
                />
              </div>
              <span className={`text-xs tabular-nums ${simQuota.used >= simQuota.limit ? 'text-red-400' : 'text-neutral-500'}`}>
                {simQuota.used}/{simQuota.limit} today
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <input
                type="text"
                min={1}
                max={30}
                value={numCohorts}
                onChange={e => {
                  const v = e.target.value
                  if (v === '') return setNumCohorts('')
                  const n = Math.floor(Number(v))
                  if (Number.isFinite(n)) setNumCohorts(String(Math.min(30, Math.max(1, n))))
                }}
                disabled={busy}
                className="w-16 p-2 rounded-lg border border-neutral-700 bg-neutral-900 text-sm text-neutral-200"
              /> <label className="text-sm text-neutral-400">Discussions (1-30)</label>
            </div>
            <div>
              <input
                type="number"
                min={1}
                max={20}
                value={numUtterances}
                onChange={e => {
                  const v = e.target.value
                  if (v === '') return setNumUtterances('')
                  const n = Math.floor(Number(v))
                  if (Number.isFinite(n)) setNumUtterances(String(Math.min(20, Math.max(1, n))))
                }}
                disabled={busy}
                className="w-16 p-2 rounded-lg border border-neutral-700 bg-neutral-900 text-sm text-neutral-200"
              /> <label className="text-sm text-neutral-400">Messages (1-20)</label>
            </div>
            <div className="flex flex-col">
              <label className="text-sm text-neutral-400">Max wait time: {(() => { const s = Math.round((simQuota?.simMaxWaitTimeMs ?? MAX_WAIT_TIME_MS) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` })()} minutes</label>
              {simStartTime !== null && (
                <label className="text-sm text-neutral-400">
                  {simState.status === 'loading' ? 'Elapsed' : 'Completed in'}: {Math.floor(simElapsed / 60)}:{String(simElapsed % 60).padStart(2, '0')} minutes
                </label>
              )}
            </div>
            <ActionButton
              label="Simulate"
              loadingLabel="Simulating…"
              loading={(creating === 'agent-agent' && createAction === 'simulate') || simState.status === 'loading'}
              disabled={busy || (simQuota !== null && simQuota.used >= simQuota.limit)}
              onClick={handleCreateSim}
            />
          </div>
        </div>

        {simState.result !== null && (
          <ResultBox title="Simulation" state={simState} showMessage />
        )}

        {simState.status === 'done' && simExport !== null && (
          <div className="flex flex-wrap gap-3">
            <ActionButton
              label="Download ConvoKit corpus (zip)"
              loadingLabel="Converting…"
              loading={convokitLoading}
              onClick={downloadConvokit}
            />
          </div>
        )}

      </div>

    </div>
  )
}
