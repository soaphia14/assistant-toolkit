import fs from 'fs'
import yaml from 'js-yaml'
import { ASSISTANT_DEFAULT } from '../config'
import { replaceDefaults, substituteTokens } from '../utils'
import {
  buildPromptItems,
  buildPersona,
  buildGeneration,
  buildStructuredOutput,
  type PromptItem,
  type StructuredOutputConfig,
  type GenerationConfig,
  type Persona,
} from './common'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatPromptConfig {
  id: string
  type: 'chat'
  prompt: { default: PromptItem[] }
  order: Record<string, unknown>
  addTo: Record<string, unknown>
  structuredOutputConfig: StructuredOutputConfig
  generationConfig: GenerationConfig
  numRetries: number
}

export interface AgentAssistantTemplate {
  persona: Persona
  promptMap: Record<string, ChatPromptConfig>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _chatPrompt(tpl: Record<string, any>, stageId: string, stageIdsInOrder: string[]): ChatPromptConfig {
  return {
    id: stageId,
    type: 'chat',
    prompt: { default: buildPromptItems(tpl, stageId, stageIdsInOrder) },
    order: {},
    addTo: {},
    structuredOutputConfig: buildStructuredOutput(tpl),
    generationConfig: buildGeneration(tpl, 'generation'),
    numRetries: tpl.num_retries,
  }
}

// ── Public ────────────────────────────────────────────────────────────────────

export function loadAssistantTemplate(templatePath: string): Record<string, any> {
  const raw = fs.readFileSync(templatePath, 'utf8')
  return yaml.load(raw) as Record<string, any>
}

export function parseAssistantTemplate(content: string): Record<string, any> {
  return yaml.load(content) as Record<string, any>
}

export function buildAssistant(stageId: string, assistantTemplate: Record<string, any>, stageIdsInOrder: string[], topicInfo: Record<string, any>): AgentAssistantTemplate {
  let tpl = replaceDefaults(assistantTemplate, loadAssistantTemplate(ASSISTANT_DEFAULT))
  tpl = substituteTokens(tpl, { '{topic_name}': `Debate Topic: ${topicInfo.name}`, '{topic_statement}': `Debate Statement: ${topicInfo.statement}` })
  return {
    persona: buildPersona(tpl),
    promptMap: { [stageId]: _chatPrompt(tpl, stageId, stageIdsInOrder) },
  }
}
