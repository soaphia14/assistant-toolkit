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



// The toolkit gives users no way to author the raw JSON-formatting
// instructions the legacy `human_style_prompt` YAML field used to spell out
// by hand (see public/templates/defaults/agent-1.yaml), so `appendToPrompt`
// must be true here — otherwise the model is never told to produce this
// shape at all and every response fails to parse, which is why agents built
// from this page couldn't actually chat.
function _newStructuredOutputConfig(): Record<string, any> {
  return {
    enabled: true,
    type: 'JSON_SCHEMA',
    appendToPrompt: true,
    shouldRespondField: 'shouldRespond',
    messageField: 'response',
    explanationField: 'explanation',
    readyToEndField: 'readyToEndChat',
    schema: {
      type: 'OBJECT',
      properties: [
        { name: 'explanation', schema: { type: 'STRING', description: '1-2 sentences explaining why you are sending this message, or why you are staying silent, based on your persona and the chat context.' } },
        { name: 'shouldRespond', schema: { type: 'BOOLEAN', description: 'Whether you want to send a message right now. Set to false to stay silent this turn; set to true to send the message in the response field.' } },
        { name: 'response', schema: { type: 'STRING', description: 'Your chat message (empty if you prefer to stay silent).' } },
        { name: 'readyToEndChat', schema: { type: 'BOOLEAN', description: 'Whether or not you are ready to end the conversation.' } },
      ],
    },
  }
}

// ── New schema: order/prompt-output prompt graph ────────────────────────────────
//
// The Agent Participant toolkit page authors templates in this shape instead of
// the flat `prompt` + plain-string-prompt legacy shape above. Its `chatSettings`
// carries a `promptMap` of named, independently block-edited prompts, each with
// an `order` (prompts sharing an order run in parallel); a prompt can pull in
// the output of any prompt with a strictly smaller order via a PROMPT_OUTPUT
// block naming it. The prompt keyed "message" is the one sent to chat, and is
// always kept at the final rank. `initializationPrompt`/`thoughtPrompt`/
// `characterPrompt` are separate, optional, single block lists (null when
// disabled) outside that graph, made available to other prompts via
// INITIALIZATION_CONTEXT/CHARACTER_CONTEXT/THOUGHT_HISTORY_CONTEXT blocks.

function _newChatPrompt(tpl: Record<string, any>, stageId: string, stageIdsInOrder: string[]): Record<string, any> {
  const cs = tpl.chatSettings ?? {}
  const promptMap: Record<string, { order?: number; prompt?: any[] }> = cs.promptMap ?? {}

  const prompt: Record<string, any[]> = {}
  const order: Record<number, string[]> = {}

  for (const [name, entry] of Object.entries(promptMap)) {
    prompt[name] = buildPromptItems({ prompt: entry.prompt ?? [], context: cs.context }, stageId, stageIdsInOrder)
    const group = entry.order ?? 1
    ;(order[group] ??= []).push(name)
  }

  const initializationContextPrompt = Array.isArray(cs.initializationPrompt)
    ? buildPromptItems({ prompt: cs.initializationPrompt, context: cs.context }, stageId, stageIdsInOrder)
    : undefined
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
    includeScaffoldingInPrompt: cs.includeScaffoldingInPrompt,
    numRetries: cs.numRetries,
    structuredOutputConfig: _newStructuredOutputConfig(),
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
    initializationContextPrompt,
    thoughtPrompt,
    characterPrompt,
  }
}

// ── Public ────────────────────────────────────────────────────────────────────

export function buildAgent(chat_stage_id: string, pre_survey_stage_id: string, post_survey_stage_id: string, agentTemplate: Record<string, any>, stageIdsInOrder: string[]): AgentParticipantTemplate {
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
      [pre_survey_stage_id]: _pre_survey_stage(tpl, pre_survey_stage_id, stageIdsInOrder),
      [post_survey_stage_id]: _post_survey_stage(tpl, post_survey_stage_id, stageIdsInOrder, [chat_stage_id], [chat_stage_id]),
    },
  }
}
