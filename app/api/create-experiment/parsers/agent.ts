import {
  buildPromptItems,
  buildPersona,
  buildGeneration,
  buildChatSettings,
  buildStructuredOutput,
  type PromptItem,
  type StructuredOutputConfig,
  type GenerationConfig,
  type ChatSettings,
  type Persona,
} from './common'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatPromptConfig {
  id: string
  type: 'chat'
  includeScaffoldingInPrompt: boolean
  concedeStrength: number
  shouldConcedePrompt: PromptItem[]
  thoughtPrompt: PromptItem[]
  prompt: PromptItem[]
  shouldRespondPrompt: PromptItem[] | null
  minParticipantMessagesBeforeResponding: number
  structuredOutputConfig: StructuredOutputConfig
  generationConfig: GenerationConfig
  chatSettings: ChatSettings
  numRetries: number
  includePersona: string[] | null
  includeThoughtHistory: string[] | null
}

type GenericPromptConfig = {
  id: string
  type: 'survey'
  includeScaffoldingInPrompt: boolean
  includeConcessionInPrompt: boolean
  prompt: PromptItem[]
  generationConfig: GenerationConfig
  numRetries: number
  includePersona: string[] | null
  includeThoughtHistory: string[] | null
}

export interface AgentParticipantTemplate {
  persona: Persona
  promptMap: Record<string, ChatPromptConfig | GenericPromptConfig>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _shouldConcedePrompt(tpl: Record<string, any>, stage_id: string): PromptItem[] {
  return [
    {type: 'TEXT', text: tpl.should_concede_prompt },
    {
      type: 'STAGE_CONTEXT',
      stageId: stage_id,
      includePrimaryText: false,
      includeInfoText: false,
      includeHelpText: false,
      includeStageDisplay: true,
      includeParticipantAnswers: false,
    },
  ]
}

function _thoughtPrompt(tpl: Record<string, any>, stage_id: string): PromptItem[] {
  return [
    { type: 'TEXT', text: tpl.thought_prompt },
    {
      type: 'STAGE_CONTEXT',
      stageId: stage_id,
      includePrimaryText: false,
      includeInfoText: false,
      includeHelpText: false,
      includeStageDisplay: true,
      includeParticipantAnswers: false,
    },
  ]
}

function _human_style_prompt(tpl: Record<string, any>): PromptItem[] {
  return [{ type: 'TEXT', text: tpl.human_style_prompt }]
}

function _pre_survey_prompt(tpl: Record<string, any>): PromptItem[] {
  return [{ type: 'TEXT', text: tpl.pre_survey_prompt ?? '' }]
}

function _post_survey_prompt(tpl: Record<string, any>): PromptItem[] {
  return [{ type: 'TEXT', text: tpl.post_survey_prompt ?? '' }]
}


function _chatPrompt(tpl: Record<string, any>, stageId: string, stageIdsInOrder: string[]): ChatPromptConfig {
  return {
    id: stageId,
    type: 'chat',
    includeScaffoldingInPrompt: tpl.include_scaffolding_in_prompt,
    concedeStrength: tpl.concede_strength,
    shouldConcedePrompt: _shouldConcedePrompt(tpl, stageId),
    thoughtPrompt: _thoughtPrompt(tpl, stageId),
    prompt: buildPromptItems(tpl, stageId, stageIdsInOrder, _human_style_prompt(tpl)),
    shouldRespondPrompt: null,
    minParticipantMessagesBeforeResponding: tpl.min_participant_messages_before_responding,
    structuredOutputConfig: buildStructuredOutput(tpl),
    generationConfig: buildGeneration(tpl, "chat_generation"),
    chatSettings: buildChatSettings(tpl),
    numRetries: tpl.num_retries,
    includePersona: [stageId],
    includeThoughtHistory: [stageId],
  }
}

function _pre_survey_stage(tpl: Record<string, any>, stageId: string, stageIdsInOrder: string[]): GenericPromptConfig {
  return {
    id: stageId,
    type: 'survey',
    includeScaffoldingInPrompt: true,
    includeConcessionInPrompt: true,
    prompt: buildPromptItems(tpl, stageId, stageIdsInOrder, _pre_survey_prompt(tpl)),
    generationConfig: buildGeneration(tpl, "pre_survey_generation"),
    numRetries: tpl.num_retries,
    includePersona: null,
    includeThoughtHistory: null,
  }
}

function _post_survey_stage(tpl: Record<string, any>, stageId: string, stageIdsInOrder: string[], personaStages: string[], thoughtHistoryStages: string[]): GenericPromptConfig {
  return {
    id: stageId,
    type: 'survey',
    includeScaffoldingInPrompt: true,
    includeConcessionInPrompt: true,
    prompt: buildPromptItems(tpl, stageId, stageIdsInOrder, _post_survey_prompt(tpl)),
    generationConfig: buildGeneration(tpl, "post_survey_generation"),
    numRetries: tpl.num_retries,
    includePersona: personaStages,
    includeThoughtHistory: thoughtHistoryStages,
  }
}



// ── New schema: order/addTo prompt graph ───────────────────────────────────────
//
// The Agent Participant toolkit page authors templates in this shape instead of
// the flat `prompt` + plain-string-prompt legacy shape above. Its `chatSettings`
// carries a `promptMap` of named, independently block-edited prompts, each with
// an `order` (prompts sharing an order run in parallel) and an `addTo` (either
// another prompt name with a strictly greater order, whose prompt this one's
// output is prepended to, or the sentinel "message" once the chain is meant to
// be sent to chat). `thoughtPrompt`/`characterPrompt` are separate, optional,
// single block lists (null when disabled) outside that graph.

function _newChatPrompt(tpl: Record<string, any>, stageId: string, stageIdsInOrder: string[]): Record<string, any> {
  const cs = tpl.chatSettings ?? {}
  const promptMap: Record<string, { order?: number; addTo?: string | null; prompt?: any[] }> = cs.promptMap ?? {}

  const prompt: Record<string, any[]> = {}
  const order: Record<number, string[]> = {}
  const addTo: Record<string, string[]> = {}

  // addTo is keyed by the RECEIVING prompt, with the list holding the names
  // of the prompts whose output gets appended to it — i.e. addTo[target]
  // includes every prompt that sends its output to target. That's the
  // inverse of how each entry stores its own single `addTo` target, so it
  // has to be inverted here.
  for (const [name, entry] of Object.entries(promptMap)) {
    prompt[name] = buildPromptItems({ prompt: entry.prompt ?? [], context: cs.context }, stageId, stageIdsInOrder)
    const group = entry.order ?? 1
    ;(order[group] ??= []).push(name)
    if (entry.addTo) {
      (addTo[entry.addTo] ??= []).push(name)
    }
  }

  const thoughtPrompt = Array.isArray(cs.thoughtPrompt)
    ? buildPromptItems({ prompt: cs.thoughtPrompt, context: cs.context }, stageId, stageIdsInOrder)
    : undefined
  const characterPrompt = Array.isArray(cs.characterPrompt)
    ? buildPromptItems({ prompt: cs.characterPrompt, context: cs.context }, stageId, stageIdsInOrder)
    : undefined

  return {
    id: stageId,
    type: 'chat',
    prompt,
    order,
    addTo,
    includeScaffoldingInPrompt: cs.includeScaffoldingInPrompt,
    numRetries: cs.numRetries,
    generationConfig: tpl.generation ? {
      temperature: tpl.generation.temperature,
      reasoningLevel: tpl.generation.reasoningLevel,
      includeReasoning: tpl.generation.includeReasoning,
    } : undefined,
    chatSettings: {
      // Not exposed in the toolkit UI for agent participants; the platform
      // requires a value, so this is a fixed, sensible default.
      minMessagesBeforeResponding: 0,
      canSelfTriggerCalls: cs.canSelfTriggerCalls,
      initialMessage: cs.initialMessage,
      wordsPerMinute: cs.wordsPerMinute,
    },
    thoughtPrompt,
    characterPrompt,
    includePersona: [stageId],
    includeThoughtHistory: [stageId],
  }
}

// ── Public ────────────────────────────────────────────────────────────────────

export function buildAgent(chat_stage_id: string, pre_survey_stage_id: string | null, post_survey_stage_id: string | null, agentTemplate: Record<string, any>, stageIdsInOrder: string[]): AgentParticipantTemplate {
  const tpl = agentTemplate

  if (tpl.chatSettings?.promptMap) {
    return {
      persona: buildPersona(tpl),
      promptMap: {
        [chat_stage_id]: _newChatPrompt(tpl, chat_stage_id, stageIdsInOrder),
      } as unknown as AgentParticipantTemplate['promptMap'],
    }
  }

  return {
    persona: buildPersona(tpl),
    promptMap: {
      [chat_stage_id]: _chatPrompt(tpl, chat_stage_id, stageIdsInOrder),
      // Runs without the surveys around the chat get no prompts for them.
      ...(pre_survey_stage_id
        ? { [pre_survey_stage_id]: _pre_survey_stage(tpl, pre_survey_stage_id, stageIdsInOrder) }
        : {}),
      ...(post_survey_stage_id
        ? { [post_survey_stage_id]: _post_survey_stage(tpl, post_survey_stage_id, stageIdsInOrder, [chat_stage_id], [chat_stage_id]) }
        : {}),
    },
  }
}
