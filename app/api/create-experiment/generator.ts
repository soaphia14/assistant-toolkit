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
import { loadTemplate, replaceDefaults, fillAgentStance, agentConfig, createParticipant, excludeNone } from './utils'
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
// resolved like the topic experiment.yaml path below. Reddit-toolkit requests use the
// reddit-specific agent templates instead, which reference {post_title}/{post_description}.
const agentTemplate = (file: string, templateSet?: 'reddit' | 'wikipedia') =>
  path.join(process.cwd(), 'public', 'templates', templateSet === 'reddit' || templateSet === 'wikipedia' ? templateSet : 'defaults', file)

function participantSlotsFor(mode: Mode, templateSet?: 'reddit' | 'wikipedia'): ParticipantSlot[] {
  if (mode === 'agent-agent') {
    return [
      { slot: 'p1', type: 'agent', template: agentTemplate('agent-1.yaml', templateSet) },
      { slot: 'p2', type: 'agent', template: agentTemplate('agent-2.yaml', templateSet) },
    ]
  }
  if (mode === 'human-agent') {
    return [
      { slot: 'p1', type: 'human' },
      { slot: 'p2', type: 'agent', template: agentTemplate('agent-1.yaml', templateSet) },
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

export async function generate(p1: string, p2: string, experimentTemplatePath: string, mediatorTemplateContent: string | undefined,
                          mode: Mode, numCohorts?: number, numUtterances?: number, action?: 'create' | 'simulate',
                          assistantTemplateContent?: string, postTitle?: string, postDescription?: string,
                          agentAssignment?: 'participant-1' | 'participant-2' | 'both', templateSet?: 'reddit' | 'wikipedia',
                          opParticipant?: 'participant-1' | 'participant-2') {
  
  console.log("API KEY", API_KEY)
  const experimentTemplate = replaceDefaults(
    loadTemplate(experimentTemplatePath),
    loadTemplate(EXPERIMENT_DEFAULT),
  )
  const topicInfo = buildTopic(experimentTemplate.topic)

  const stages = buildStages(experimentTemplate, topicInfo, postTitle, postDescription)
  const stageIdsInOrder = stages.map((s) => s.id)

  // one mediator + one chat supported for now
  const chatStageId = stages.find((s) => s.kind === 'chat')?.id ?? STAGE_R1
  const preSurveyStageId = stages.find((s) => s.kind === 'survey' && s.id === PRE_SURVEY_STAGE_ID)?.id ?? PRE_SURVEY_STAGE_ID
  const postSurveyStageId = [...stages].reverse().find((s) => s.kind === 'survey')?.id ?? POST_SURVEY_STAGE_ID

  const mediatorR1 = mediatorTemplateContent
    ? buildMediator(chatStageId, parseMediatorTemplate(mediatorTemplateContent), stageIdsInOrder, topicInfo)
    : undefined

  const roleFor = (slot: string): 'OP' | 'Challenger' | undefined =>
    opParticipant ? ((slot === 'p1' && opParticipant === 'participant-1') || (slot === 'p2' && opParticipant === 'participant-2') ? 'OP' : 'Challenger') : undefined

  // one shared assistant normally; but when both participants get the assistant and we know
  // who's OP, build two role-specific assistants (one can't correctly serve both roles at once).
  const assistants: AgentAssistantTemplate[] = []
  const assistantIdForSlot: Record<string, string> = {}
  if (assistantTemplateContent) {
    const parsedAssistant = parseAssistantTemplate(assistantTemplateContent)
    if (agentAssignment === 'both' && opParticipant) {
      const opSlot = opParticipant === 'participant-1' ? 'p1' : 'p2'
      const challengerSlot = opSlot === 'p1' ? 'p2' : 'p1'
      const opAssistant = buildAssistant(chatStageId, parsedAssistant, stageIdsInOrder, topicInfo, postTitle, postDescription, 'OP')
      opAssistant.persona.id = `${opAssistant.persona.id}-op`
      const challengerAssistant = buildAssistant(chatStageId, parsedAssistant, stageIdsInOrder, topicInfo, postTitle, postDescription, 'Challenger')
      challengerAssistant.persona.id = `${challengerAssistant.persona.id}-challenger`
      assistants.push(opAssistant, challengerAssistant)
      assistantIdForSlot[opSlot] = opAssistant.persona.id
      assistantIdForSlot[challengerSlot] = challengerAssistant.persona.id
    } else {
      const singleSlot = agentAssignment === 'participant-1' ? 'p1' : agentAssignment === 'participant-2' ? 'p2' : undefined
      const assistant = buildAssistant(chatStageId, parsedAssistant, stageIdsInOrder, topicInfo, postTitle, postDescription, singleSlot ? roleFor(singleSlot) : undefined)
      assistants.push(assistant)
      if (singleSlot) {
        assistantIdForSlot[singleSlot] = assistant.persona.id
      } else {
        assistantIdForSlot.p1 = assistant.persona.id
        assistantIdForSlot.p2 = assistant.persona.id
      }
    }
  }

  const exp = experimentTemplate.experiment ?? {}
  const participantSlots = participantSlotsFor(mode, templateSet)
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

    if (assistants.length > 0 && chatStage.progress) {
      const isHumanSlot = (slot: string) => participantSlots.find((s) => s.slot === slot)?.type === 'human'
      const mapping: Record<string, string> = {}
      if ((agentAssignment === 'participant-1' || agentAssignment === 'both') && isHumanSlot('p1') && assistantIdForSlot.p1) mapping[p1] = assistantIdForSlot.p1
      if ((agentAssignment === 'participant-2' || agentAssignment === 'both') && isHumanSlot('p2') && assistantIdForSlot.p2) mapping[p2] = assistantIdForSlot.p2
      chatStage.progress.pIdToAssistantId = mapping
    }
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
    const ratings = isSim
      ? shuffle([randint(5, 7), randint(1, 3)])
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
        if (isSim) tpl.persona.id = `${tpl.persona.id}-c${ci}`

        const wantsAssistant = agentAssignment === 'both'
          || (agentAssignment === 'participant-1' && slot === 'p1')
          || (agentAssignment === 'participant-2' && slot === 'p2')
        if (wantsAssistant && assistantIdForSlot[slot]) {
          tpl.persona.assistant_id = assistantIdForSlot[slot]
        }

        const redditRole = roleFor(slot)

        const s = stance[slot]
        const [filled, finalStance] = fillAgentStance(tpl, topicInfo, s.rating, s.rating, postTitle, postDescription, redditRole)
        stance[slot] = { side: finalStance.side, strength: finalStance.strength } // removing rating and concession info

        configs.push(filled.agent_config ?? '')
        const built = buildAgent(chatStageId, preSurveyStageId, postSurveyStageId, filled, stageIdsInOrder)
        pair.push(built)

      } else {
        humanSlots[slot] = slotToPid[slot] ?? slot
      }
    }
    cohortAgents.push(pair)
    agentStances.push(stance)
    cohortAgentConfigs.push(configs)
  }

  const agents = cohortAgents.flat() 

  const [template, cohortAlias] = buildExperiment(experimentTemplate, topicInfo, stages, stageIdsInOrder, mediatorR1, agents, mode, isSim, assistants, postTitle, postDescription)
  template.experiment.variableConfigs = [BIAS_VARIABLE_CONFIG]
  
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
            minParticipantsPerCohort: cfg.minParticipantsPerCohort ?? 2,
            maxParticipantsPerCohort: cfg.maxParticipantsPerCohort ?? 2,
            includeAllParticipantsInCohortCount: cfg.includeAllParticipantsInCohortCount ?? true,
            botProtection: cfg.botProtection ?? false,
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
    const vm = cohortBias[i]
    if (!vm) return null
    const parse = (s?: string) => { try { return s != null ? JSON.parse(s) : null } catch { return s ?? null } }
    return { side: parse(vm.target_bias_position)[0], }
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
        const role = roleFor(slot)
        participant_urls.push({ url: url, type: 'human', ...(role ? { role } : {}) })
      }
      return { cohort_id: cid, participant_urls: participant_urls, mediator_bias: biasFor(i) }
    }
    else if (mode === 'human-agent') {
      const participant_urls: Record<string, string>[] = []
      for (const [slot, url] of Object.entries(humanUrls)) {
        const human_url = `${url}`
        const role = roleFor(slot)
        participant_urls.push({ url: human_url, type: 'human', ...(role ? { role } : {}) })
      }
      return { cohort_id: cid, participant_urls: participant_urls, agent_stances: agentStances[i].p2, mediator_bias: biasFor(i) }
    }
    else if (mode === 'agent-agent' && action === 'create') {
      const participant_urls: Record<string, string>[] = []
      for (const [slot, url] of Object.entries(agentUrls[i])) {
        const role = roleFor(slot)
        participant_urls.push({ url: url, type: 'agent', ...(role ? { role } : {}) })
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
