import path from 'path'
import {
  BASE_URL, API_KEY, FRONTEND_BASE,
  STAGE_R1, POST_SURVEY_STAGE_ID, EXPERIMENT_DEFAULT,
  PRE_SURVEY_STAGE_ID,
} from './config'
import { parseMediatorTemplate, buildMediator } from './parsers/mediator'
import { buildAgent } from './parsers/agent'
import type { AgentParticipantTemplate } from './parsers/agent'
import { parseAssistantTemplate, buildAssistant } from './parsers/assistant'
import type { AgentAssistantTemplate } from './parsers/assistant'
import { buildTopic, buildStages, buildExperiment } from './parsers/experiment'
import { parseSimulationTemplate, applySimulationToChatStage } from './parsers/simulation'
import { loadTemplate, replaceDefaults, fillAgentStance, agentConfig, createParticipant, excludeNone, resolveBlockItems } from './utils'
import { url } from 'inspector/promises'

export type Mode = 'human-human' | 'human-agent' | 'agent-agent'
type ParticipantSlot = { slot: string; type: 'human' | 'agent'; template?: string }

const randint = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

// The toolkit picks the mode via the request/button, so we build the participant
// slots from `mode`. The agent template path is data here (mirrors the `participants`
// block generator.py reads from YAML: `template: templates/defaults/agent-N.yaml`),
// resolved like the topic experiment.yaml path below.
const defaultTemplate = (file: string) => path.join(process.cwd(), 'public', 'templates', 'defaults', file)

// Agent templates on disk, cycled through when a run asks for more agents than
// there are templates. The templates differ only by persona, so repeating one
// costs nothing: each slot still draws its own stance.
const AGENT_TEMPLATE_FILES = ['agent-1.yaml', 'agent-2.yaml']

function participantSlotsFor(mode: Mode, numAgents?: number): ParticipantSlot[] {
  if (mode === 'agent-agent') {
    const count = numAgents && numAgents >= 2 ? numAgents : AGENT_TEMPLATE_FILES.length
    return Array.from({ length: count }, (_, i) => ({
      slot: `p${i + 1}`,
      type: 'agent' as const,
      template: defaultTemplate(AGENT_TEMPLATE_FILES[i % AGENT_TEMPLATE_FILES.length]),
    }))
  }
  if (mode === 'human-agent') {
    return [
      { slot: 'p1', type: 'human' },
      { slot: 'p2', type: 'agent', template: defaultTemplate('agent-1.yaml') },
    ]
  }
  return [
    { slot: 'p1', type: 'human' },
    { slot: 'p2', type: 'human' },
  ]
}

// Mediator randomization within each cohort
const BIAS_VARIABLE_CONFIG = {
  id: 'bias-target',
  type: 'random_permutation',
  scope: 'cohort',
  definition: {
    name: 'target_bias_position',
    description: 'Which side the mediator favors (randomized per cohort)',
    schema: { type: 'array', items: { type: 'string' } },
  },
  shuffleConfig: { shuffle: true, seed: 'cohort', customSeed: '' },
  values: [JSON.stringify('supporting the debate statement'), JSON.stringify('opposing the debate statement')],
  expandListToSeparateVariables: false,
  numToSelect: 1,
}

export async function generate(p1: string, p2: string, experimentTemplatePath: string, mediatorTemplateContent: string | null,
                          mode: Mode, numCohorts?: number, numUtterances?: number, action?: 'create' | 'simulate',
                          simulationTemplateContent?: string, numAgents?: number, assistantTemplateContent?: string) {
  // Optional: when the simulation toolkit supplies a template, it owns the chat
  // stage description (and the conversation limits) instead of the topic YAML.
  const simulation = simulationTemplateContent
    ? parseSimulationTemplate(simulationTemplateContent)
    : null

  const experimentTemplate = replaceDefaults(
    loadTemplate(experimentTemplatePath),
    loadTemplate(EXPERIMENT_DEFAULT),
  )
  const topicInfo = buildTopic(experimentTemplate.topic)

  // Simulations are just the conversation, so the surveys around it are dropped
  // and the run goes profile -> debate. Mediator-toolkit runs keep them.
  const SIM_SKIPPED_STAGES = [PRE_SURVEY_STAGE_ID, POST_SURVEY_STAGE_ID]
  const stages = buildStages(experimentTemplate, topicInfo)
    .filter((s) => !(simulation && SIM_SKIPPED_STAGES.includes(s.id)))
  const stageIdsInOrder = stages.map((s) => s.id)

  // one mediator + one chat supported for now
  const chatStageId = stages.find((s) => s.kind === 'chat')?.id ?? STAGE_R1
  const preSurveyStageId = stages.find((s) => s.kind === 'survey' && s.id === PRE_SURVEY_STAGE_ID)?.id ?? PRE_SURVEY_STAGE_ID
  // Null when the run has no survey stage, so no prompt is built for one.
  const postSurveyStageId = [...stages].reverse().find((s) => s.kind === 'survey')?.id
    ?? (simulation ? null : POST_SURVEY_STAGE_ID)

  // A run may deliberately have no mediator, in which case the experiment is
  // created with an empty `agentMediators` list.
  const mediatorR1 = mediatorTemplateContent
    ? buildMediator(chatStageId, parseMediatorTemplate(mediatorTemplateContent), stageIdsInOrder, topicInfo, simulation?.blocks ?? [])
    : null

  const assistants: AgentAssistantTemplate[] = assistantTemplateContent
    ? [buildAssistant(chatStageId, parseAssistantTemplate(assistantTemplateContent), stageIdsInOrder, topicInfo)]
    : []

  const exp = experimentTemplate.experiment ?? {}
  const participantSlots = participantSlotsFor(mode, numAgents)
  const slotToPid: Record<string, string> = { p1, p2 }

  const agentSlots = participantSlots.filter((s) => s.type === 'agent').map((s) => s.slot)

  const isSim = mode === 'agent-agent'

  const chatStage = stages.find((s) => s.kind === 'chat')
  if (chatStage) {
    if (isSim) {
      // currently not removing the timer limit, in case simulation gets stuck in some cohorts, they can still finish within this time.
      chatStage.timeLimitInMinutes = 9
      chatStage.requireFullTime = false
      if (numUtterances != null) chatStage.numUtterances = numUtterances  // else keep template default
    } else {
      chatStage.numUtterances = null
    }
    // The chat cannot start until every slot in the run has arrived.
    if (chatStage.progress) chatStage.progress.minParticipants = participantSlots.length
    // Applied last so the simulation template wins over the defaults above.
    if (simulation) applySimulationToChatStage(chatStage, simulation)
  }

  const numCohortsResolved = (mode === 'agent-agent' && action === 'simulate')
    ? (numCohorts && numCohorts >= 1 ? numCohorts : (Number(exp.num_cohorts) || 1))
    : 1

  // each cohort gets a randomized pair
  const cohortAgents: AgentParticipantTemplate[][] = []
  const agentStances: Record<string, any>[] = []
  const humanSlots: Record<string, string> = {}
  const cohortAgentConfigs: string[][] = []

  for (let ci = 0; ci < numCohortsResolved; ci++) {
    // Simulations want a real disagreement, so stances alternate strong-for /
    // strong-against before being shuffled across the slots.
    const ratings = isSim
      ? shuffle(agentSlots.map((_, i) => (i % 2 === 0 ? randint(5, 7) : randint(1, 3))))
      : agentSlots.map(() => randint(1, 7))
    const stance: Record<string, any> = {}
    agentSlots.forEach((slot, i) => {
      stance[slot] = { rating: ratings[i], }
    })

    const pair: AgentParticipantTemplate[] = []
    const configs: string[] = []

    for (const pSlot of participantSlots) {
      const slot = pSlot.slot
      if (pSlot.type === 'agent') {
        const tpl = loadTemplate(pSlot.template!)
        // Slot is part of the id because agent templates repeat once a run asks
        // for more agents than there are templates.
        if (isSim) tpl.persona.id = `${tpl.persona.id}-${slot}-c${ci}`
        const s = stance[slot]
        const [filled, finalStance] = fillAgentStance(tpl, topicInfo, s.rating, s.rating)
        stance[slot] = { side: finalStance.side, strength: finalStance.strength } // removing rating and concession info

        // Agent prompts can reference simulation blocks too, so they go through
        // the same resolution as the mediator's.
        const resolved = resolveBlockItems(filled, simulation?.blocks ?? [])

        configs.push(resolved.agent_config ?? '')
        pair.push(buildAgent(chatStageId, preSurveyStageId, postSurveyStageId, resolved, stageIdsInOrder))
      } else {
        humanSlots[slot] = slotToPid[slot] ?? slot
      }
    }
    cohortAgents.push(pair)
    agentStances.push(stance)
    cohortAgentConfigs.push(configs)
  }

  const agents = cohortAgents.flat() 

  const [template, cohortAlias] = buildExperiment(experimentTemplate, topicInfo, stages, stageIdsInOrder, mediatorR1, agents, mode, isSim, assistants)
  // Nothing to randomize a bias for when the run has no mediator.
  template.experiment.variableConfigs = mediatorR1 ? [BIAS_VARIABLE_CONFIG] : []

  // A cohort holds exactly the run's participants, however many that is.
  template.experiment.defaultCohortConfig.minParticipantsPerCohort = participantSlots.length
  template.experiment.defaultCohortConfig.maxParticipantsPerCohort = participantSlots.length

  // The description also labels the experiment in ConvoArena's list (it leads
  // the chat stage description separately, see applySimulationToChatStage).
  if (simulation?.description) {
    template.experiment.metadata.description = simulation.description
  }

  const authHeaders = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  }

  let expId: string
  let cohortIds: string[]
  let cohortBias: (Record<string, string> | null)[] = []

  if (isSim) {
    const cfg = exp.defaultCohortConfig ?? {}
    const expRes = await fetch(`${BASE_URL}/experiments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ template: excludeNone(template) }),
    })
    if (!expRes.ok) throw new Error(`create_simulation failed: ${await expRes.text()}`)
    const expJson = await expRes.json()
    expId = expJson.experiment.id

    const cohortRes = await fetch(`${BASE_URL}/experiments/${expId}/cohorts/batch`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        cohorts: Array.from({ length: numCohortsResolved }, (_, i) => ({
          name: `[toolkit-sim] ${topicInfo.name} #${i + 1}`,
          description: `Simulation for ${topicInfo.name}.`,
          participantConfig: {
            minParticipantsPerCohort: participantSlots.length,
            maxParticipantsPerCohort: participantSlots.length,
            includeAllParticipantsInCohortCount: cfg.includeAllParticipantsInCohortCount ?? true,
            botProtection: cfg.botProtection ?? true,
          },
        })),
      }),
    })
    if (!cohortRes.ok) throw new Error(`create_simulation failed: ${await cohortRes.text()}`)
    const cohortJson = await cohortRes.json()
    cohortIds = cohortJson.cohorts.map((c: any) => (c.cohort ?? c).id)
    cohortBias = cohortJson.cohorts.map((c: any) => (c.cohort ?? c).variableMap ?? null)
  } else {
    const expRes = await fetch(`${BASE_URL}/experiments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ template: excludeNone(template) }),
    })

    if (!expRes.ok) throw new Error(`create_experiment failed: ${await expRes.text()}`)
    const result = await expRes.json()
    expId = result.experiment.id

    const exportRes = await fetch(`${BASE_URL}/experiments/${expId}/export`, { method: 'GET', headers: authHeaders })
    if (!exportRes.ok) throw new Error(`export_experiment failed: ${await exportRes.text()}`)
    const expData = await exportRes.json()
    const generated: Record<string, string> = {}
    for (const c of expData.experiment.cohortDefinitions) generated[c.alias] = c.generatedCohortId
    cohortIds = [generated[cohortAlias]]

    const cohortRes = await fetch(`${BASE_URL}/experiments/${expId}/cohorts/${cohortIds[0]}`, { method: 'GET', headers: authHeaders })
    if (cohortRes.ok) {
      const cohortJson = await cohortRes.json()
      cohortBias = [(cohortJson.cohort ?? cohortJson)?.variableMap ?? null]
    }
  }

  const agentUrls: Record<string, string>[] = []

  for (let i = 0; i < cohortIds.length; i++) {
    const urls: Record<string, string> = {}
    for (let k = 0; k < cohortAgents[i].length; k++) {
      const created = await createParticipant(expId, cohortIds[i], agentConfig(cohortAgents[i][k], cohortAgentConfigs[i][k]))
      urls[agentSlots[k]] = `${FRONTEND_BASE}/#/e/${expId}/p/${created.id}`
    }
    agentUrls.push(urls)
  }

  const experimentUrl = `${FRONTEND_BASE}/#/e/${expId}`

  const biasFor = (i: number) => {
    // Absent whenever the run has no mediator to be biased in the first place.
    const raw = cohortBias[i]?.target_bias_position
    if (!raw) return null
    const parse = (s: string) => { try { return JSON.parse(s) } catch { return s } }
    const parsed = parse(raw)
    return { side: Array.isArray(parsed) ? parsed[0] : parsed }
  }

  const cohorts = cohortIds.map((cid, i) => {
    const url = `${FRONTEND_BASE}/#/e/${expId}/c/${cid}`

    const humanUrls: Record<string, string> = {}
    for (const [slot, pid] of Object.entries(humanSlots)) {
      humanUrls[slot] = `${url}?PROLIFIC_PID=${pid}`
    }

    if (mode === 'human-human') {
      const participant_urls: Record<string, string>[] = []
      for (const [slot, url] of Object.entries(humanUrls)) {
        participant_urls.push({ url: url, type: 'human', })
      }
      return { cohort_id: cid, participant_urls: participant_urls, mediator_bias: biasFor(i) }
    } 
    else if (mode === 'human-agent') {
      const participant_urls: Record<string, string>[] = []
      for (const [slot, url] of Object.entries(humanUrls)) {
        const human_url = `${url}`
        participant_urls.push({ url: human_url, type: 'human', })
      }
      return { cohort_id: cid, participant_urls: participant_urls, agent_stances: agentStances[i].p2, mediator_bias: biasFor(i) }
    }
    else if (mode === 'agent-agent' && action === 'create') {
      const participant_urls: Record<string, string>[] = []
      for (const [slot, url] of Object.entries(agentUrls[i])) {
        participant_urls.push({ url: url, type: 'agent', })
      }
      return { participant_urls: participant_urls, agent_stances: agentStances[i], mediator_bias: biasFor(i) }
    }
    // simplify the return of simulations, hiding links, only show stances
    return { agent_stances: agentStances[i], mediator_bias: biasFor(i) }
  })

  return {
    mode,
    topic: topicInfo.name,
    experiment_id: expId,
    // experiment_url: experimentUrl,
    cohorts,
    // is_sim: (mode === 'agent-agent' && action === 'simulate'),
  }
}
