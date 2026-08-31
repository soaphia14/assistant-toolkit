'use client'

import { useMemo, useState } from 'react'
import {
  StructuredPromptEditor,
  type PromptItem,
} from '../components/StructuredPromptEditor'
import { MediatorSection } from '../components/MediatorSection'

type AgentPrompt = {
  id: string
  name: string
  description: string
  prompt: PromptItem[]
  order: number
  addTo: string | null
}

type SavedPrompt = {
  id: string
  name: string
  description: string
  prompt: PromptItem[]
  order: number
  addTo: string | null
}

function PromptEditorDescription({
  description,
}: {
  description: string
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2.5 text-sm text-neutral-500 space-y-1.5">
      <p className="font-medium text-neutral-300">
        Prompt Purpose
      </p>

      <p>{description}</p>
    </div>
  )
}

function PromptBlockLegend() {
  const legend = (
    color: string,
    title: string,
    text: string
  ) => (
    <>
      <span
        className={`inline-block rounded px-2 py-0.5 font-medium text-neutral-900 ${color}`}
      >
        {title}
      </span>

      <span>{text}</span>
    </>
  )

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2.5 text-sm text-neutral-500">
      <p className="font-medium text-neutral-400 mb-4">
        Available Prompt Blocks
      </p>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">

        <span className="font-medium text-neutral-300">
          Freeform Text
        </span>

        <span>
          Custom instructions written directly by you.
        </span>

        {legend(
          'bg-[#dce1fd]',
          'Conversation Context',
          'The discussion up to the current message.'
        )}

      </div>
    </div>
  )
}

export default function AgentParticipantsPage() {
  const [templateName, setTemplateName] = useState(
    'Agent Participant'
  )

  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([
    {
      id: '1',
      name: 'Debate Agent',
      description:
        'A prompt for generating thoughtful debate responses.',
      prompt: [],
      order: 1,
      addTo: null,
    },
    {
      id: '2',
      name: 'Friendly Assistant',
      description:
        'A prompt for generating friendly and conversational responses.',
      prompt: [],
      order: 1,
      addTo: null,
    },
    {
      id: '3',
      name: 'Political Expert',
      description:
        'A prompt for generating responses from a political expert perspective.',
      prompt: [],
      order: 1,
      addTo: null,
    },
  ])

 const [prompts, setPrompts] = useState<AgentPrompt[]>([
  {
    id: crypto.randomUUID(),
    name: 'Message Creation Prompt',
    description:
      'This prompt determines how the agent generates each message during the discussion.',
    prompt: [],
    order: 1,
    addTo: null,
  },
])

  const [activePromptId, setActivePromptId] = useState(prompts[0].id)

  const [editingPromptId, setEditingPromptId] =
    useState<string | null>(null)

  const activePrompt = useMemo(
    () =>
      prompts.find(
        p => p.id === activePromptId
      ) ?? prompts[0],
    [prompts, activePromptId]
  )

  const [agentConfig, setAgentConfig] = useState({
    wordsPerMinute: 120,
    minMessagesBeforeResponding: 2,
    temperature: 0.7,
    initialMessage:
      'Hello everyone! Looking forward to discussing this topic.',
  })

  function updatePrompt(
    id: string,
    update: Partial<AgentPrompt>
  ) {
    setPrompts(prev =>
      prev.map(prompt =>
        prompt.id === id
          ? {
              ...prompt,
              ...update,
            }
          : prompt
      )
    )
  }

  function updatePromptOrder(
    promptId: string,
    newOrder: number
  ) {
    const order = Math.max(
      1,
      Math.floor(newOrder) || 1
    )

    setPrompts(prev => {
      // First update the selected prompt's order.
      const updated = prev.map(prompt =>
        prompt.id === promptId
          ? {
              ...prompt,
              order,
            }
          : prompt
      )

      // Then remove any Add To relationships that
      // are no longer valid.
      //
      // A prompt can only Add To another prompt
      // whose order is strictly greater.
      return updated.map(prompt => {
        if (!prompt.addTo) {
          return prompt
        }

        const target = updated.find(
          p => p.id === prompt.addTo
        )

        // Target was deleted or now has an order
        // that is not after the current prompt.
        if (
          !target ||
          target.order <= prompt.order
        ) {
          return {
            ...prompt,
            addTo: null,
          }
        }

        return prompt
      })
    })
  }

  function saveCurrentPrompt() {
    if (!activePrompt) return

    const savedPrompt: SavedPrompt = {
      id: crypto.randomUUID(),
      name: activePrompt.name,
      description: activePrompt.description,
      prompt: structuredClone(activePrompt.prompt),
      order: activePrompt.order,
      addTo: activePrompt.addTo,
    }

    setSavedPrompts(prev => [
      ...prev,
      savedPrompt,
    ])
  }

  function deleteSavedPrompt(id: string) {
    setSavedPrompts(prev =>
      prev.filter(prompt => prompt.id !== id)
    )
  }

  function openSavedPrompt(
    savedPrompt: SavedPrompt
  ) {
    // Check whether this prompt is already
    // part of the current agent.
    const existing = prompts.find(
      prompt =>
        prompt.name === savedPrompt.name
    )

    if (existing) {
      setActivePromptId(existing.id)
      return
    }

    const newPrompt: AgentPrompt = {
      id: crypto.randomUUID(),
      name: savedPrompt.name,
      description: savedPrompt.description,
      prompt: structuredClone(savedPrompt.prompt),
      order: savedPrompt.order,
      addTo: null,
    }

    setPrompts(prev => [
      ...prev,
      newPrompt,
    ])

    setActivePromptId(newPrompt.id)
  }

  function addPrompt() {
    const id = crypto.randomUUID()

    const newPrompt: AgentPrompt = {
      id,
      name: 'New Prompt',
      description:
        'Describe what this prompt should be used for.',
      prompt: [],
      order: prompts.length + 1,
      addTo: null,
    }

    setPrompts(prev => [...prev, newPrompt])

    setActivePromptId(id)

    setEditingPromptId(id)
  }

  function deletePrompt(id: string) {
    if (prompts.length === 1) return

    const next = prompts.filter(
      prompt => prompt.id !== id
    )

    setPrompts(next)

    if (activePromptId === id) {
      setActivePromptId(next[0].id)
    }
  }

  function updatePromptItems(
    items: PromptItem[]
  ) {
    updatePrompt(activePrompt.id, {
      prompt: items.map((item, index) => ({
        ...item,
        id: index,
      })),
    })
  }

  return (
    <div className="flex flex-col lg:flex-row lg:h-screen lg:overflow-hidden bg-neutral-950 text-neutral-100">

      {/* LEFT COLUMN */}

      <div className="lg:flex-[3] overflow-y-auto p-8">

        <div className="space-y-5">

          {/* HEADER */}

          <div>

            <h1 className="text-3xl font-semibold tracking-tight">
              Agent Participants Toolkit
            </h1>

            <p className="text-neutral-500 mt-1">
              Create and configure reusable AI
              participants.
            </p>

          </div>

          {/* SAVE BAR */}

          <div className="flex gap-2">

            <input
              value={templateName}
              onChange={e =>
                setTemplateName(
                  e.target.value
                )
              }
              className="flex-1 px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm"
            />

            <button className="px-4 py-2 rounded-md border border-neutral-700 bg-neutral-900 hover:border-neutral-500">
              Save
            </button>

            <button className="px-4 py-2 rounded-md border border-neutral-700 bg-neutral-900 hover:border-neutral-500">
              Load
            </button>

          </div>

          {/* PROMPT EDITORS */}

          <div className="space-y-4">

            <div className="border-b border-neutral-800 pb-3">

              <h2 className="text-lg font-semibold">
                Prompt Editors
              </h2>

            </div>

            <p className="text-sm text-neutral-500">
              Configure the prompts that define
              your agent's behavior. Every agent
              includes one required Message
              Creation Prompt, and you can add
              additional prompts as needed.
            </p>

            {/* PROMPT BAR */}

            <div className="rounded-lg border border-neutral-800 overflow-hidden">

              <div className="flex overflow-x-auto bg-neutral-900/60 border-b border-neutral-800">

                {prompts.map((prompt, index) => {

                  const active =
                    prompt.id ===
                    activePromptId

                  return (
                    <div
                      key={prompt.id}
                      onClick={() =>
                        setActivePromptId(
                          prompt.id
                        )
                      }
                      className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer whitespace-nowrap text-sm font-medium transition-colors border-r border-neutral-800 ${
                        active
                          ? 'bg-neutral-800 text-neutral-100 border-b-2 border-neutral-300'
                          : 'bg-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60'
                      }`}
                    >

                      {editingPromptId ===
                      prompt.id ? (

                        <input
                          autoFocus
                          value={prompt.name}
                          onBlur={() =>
                            setEditingPromptId(
                              null
                            )
                          }
                          onChange={e =>
                            updatePrompt(
                              prompt.id,
                              {
                                name: e
                                  .target
                                  .value,
                              }
                            )
                          }
                          onKeyDown={e => {
                            if (
                              e.key ===
                              'Enter'
                            ) {
                              setEditingPromptId(
                                null
                              )
                            }
                          }}
                          className="bg-transparent outline-none w-48"
                        />

                      ) : (

                        <span
                          onDoubleClick={() =>
                            setEditingPromptId(
                              prompt.id
                            )
                          }
                        >
                          {prompt.name}
                        </span>

                      )}

                      {index !== 0 && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            deletePrompt(
                              prompt.id
                            )
                          }}
                          className="hover:text-red-300"
                        >
                          ×
                        </button>
                      )}

                    </div>
                  )
                })}

            <button
              onClick={addPrompt}
              className="shrink-0 px-4 py-2.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors text-lg"
              title="Add prompt"
            >
              +
            </button>

            </div> {/* flex */}

            </div> {/* rounded-lg */}

            {/* PROMPT CONTENT */}

            {/* PROMPT EXECUTION SETTINGS */}

            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">

              <div className="flex items-center justify-between gap-3">

                <div>
                  <h3 className="text-sm font-medium text-neutral-300">
                    {activePrompt.name}
                  </h3>

                  <p className="text-xs text-neutral-500 mt-1">
                    Save this prompt to your prompt library.
                  </p>
                </div>

                <button
                  onClick={saveCurrentPrompt}
                  className="
                    shrink-0
                    px-3
                    py-1.5
                    rounded-md
                    border
                    border-neutral-700
                    bg-neutral-900
                    text-sm
                    text-neutral-300
                    hover:border-neutral-500
                    hover:text-neutral-100
                    transition-colors
                  "
                >
                  Save Prompt
                </button>

              </div>

              <div className="flex items-center justify-between gap-4 mb-4">

                <div>
                  <h3 className="text-sm font-medium text-neutral-300">
                    Prompt Execution
                  </h3>

                  <p className="text-xs text-neutral-500 mt-1">
                    Prompts with the same order run at the same time.
                  </p>
                </div>

              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* ORDER */}

                <div className="space-y-1.5">

                  <label className="text-sm font-medium text-neutral-300">
                    Order
                  </label>

                  <p className="text-xs text-neutral-500">
                    Determines when this prompt runs.
                  </p>

                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={activePrompt.order}
                    onChange={e => {
                      updatePromptOrder(
                        activePrompt.id,
                        Number(e.target.value)
                      )
                    }}
                    className="
                      w-full
                      px-3
                      py-2
                      rounded-md
                      border
                      border-neutral-700
                      bg-neutral-900
                      text-sm
                      text-neutral-200
                      focus:outline-none
                      focus:border-neutral-500
                    "
                  />

                </div>


                {/* ADD TO */}

                <div className="space-y-1.5">

                  <label className="text-sm font-medium text-neutral-300">
                    Add to
                  </label>

                  <p className="text-xs text-neutral-500">
                    Run this prompt as part of a later prompt.
                  </p>

                  <select
                    value={activePrompt.addTo ?? ''}
                    onChange={e =>
                      updatePrompt(activePrompt.id, {
                        addTo: e.target.value || null,
                      })
                    }
                    className="
                      w-full
                      px-3
                      py-2
                      rounded-md
                      border
                      border-neutral-700
                      bg-neutral-900
                      text-sm
                      text-neutral-200
                      focus:outline-none
                      focus:border-neutral-500
                    "
                  >

                    <option value="">
                      None
                    </option>

                    {prompts
                      .filter(
                        prompt =>
                          prompt.id !== activePrompt.id &&
                          prompt.order > activePrompt.order
                      )
                      .map(prompt => (
                        <option
                          key={prompt.id}
                          value={prompt.id}
                        >
                          {prompt.name} (Order {prompt.order})
                        </option>
                      ))}

                  </select>

                </div>

              </div>

            </div>

            <div className="rounded-lg border border-neutral-800 p-4 space-y-4">

              <PromptEditorDescription
                description={activePrompt.description}
              />

              <PromptBlockLegend />

              <StructuredPromptEditor
                label={activePrompt.name}
                prompt={activePrompt.prompt}
                stageId=""
                onUpdate={updatePromptItems}

                /*
                 * These props assume you expose them in
                 * StructuredPromptEditor.
                 *
                 * If you don't already have these,
                 * I'll show you how to add them later.
                 */
                // allowedBlocks={[
                //   'text',
                //   'context',
                // ]}
              />

            </div>

          </div>

          {/* ========================================= */}

          <div className="border-b border-neutral-800 pb-3 mt-8">

            <h2 className="text-lg font-semibold">
              Agent Parameters
            </h2>

          </div>

          <MediatorSection
            title="Agent Parameters"
            mediatorParsed={{
              chat_settings: {
                words_per_minute:
                  agentConfig.wordsPerMinute,
                initial_message:
                  agentConfig.initialMessage,
              },

              generation: {
                temperature:
                  agentConfig.temperature,
              },

              min_participant_messages_before_responding:
                agentConfig.minMessagesBeforeResponding,
            }}
            onUpdate={(path, value) => {

              if (
                path.join('.') ===
                'chat_settings.words_per_minute'
              ) {
                setAgentConfig(prev => ({
                  ...prev,
                  wordsPerMinute:
                    Number(value),
                }))
              }

              if (
                path.join('.') ===
                'chat_settings.initial_message'
              ) {
                setAgentConfig(prev => ({
                  ...prev,
                  initialMessage:
                    String(value),
                }))
              }

              if (
                path.join('.') ===
                'generation.temperature'
              ) {
                setAgentConfig(prev => ({
                  ...prev,
                  temperature:
                    Number(value),
                }))
              }

              if (
                path.join('.') ===
                'min_participant_messages_before_responding'
              ) {
                setAgentConfig(prev => ({
                  ...prev,
                  minMessagesBeforeResponding:
                    Number(value),
                }))
              }

            }}

            fields={[
              {
                label:
                  'Typing Speed (Words Per Minute)',

                description:
                  'Typing speed. Set to zero for instant responses.',

                path: [
                  'chat_settings',
                  'words_per_minute',
                ],

                type: 'number',

                min: 0,

                max: 2000,

                step: 1,
              },

              {
                label:
                  'Min Messages Before Responding',

                description:
                  'Minimum participant messages before this agent can respond again.',

                path: [
                  'min_participant_messages_before_responding',
                ],

                type: 'number',

                min: 0,

                max: 20,

                step: 1,
              },

              {
                label:
                  'Temperature',

                description:
                  'Controls randomness of responses.',

                path: [
                  'generation',
                  'temperature',
                ],

                type: 'number',

                min: 0,

                max: 2,

                step: 0.1,
              },

              {
                label:
                  'Initial Message',

                description:
                  'Automatically sent when the discussion begins.',

                path: [
                  'chat_settings',
                  'initial_message',
                ],

                type: 'text',

                placeholder:
                  'Hello everyone!',
              },
            ]}
          />

        </div>

      </div>

      {/* ========================================= */}
      {/* RIGHT SIDEBAR */}
      {/* ========================================= */}

      <div className="lg:flex-1 overflow-y-auto border-l border-neutral-800 p-8">

        <div className="space-y-5">

          <div className="border-b border-neutral-800 pb-3">

            <h2 className="text-lg font-semibold">
              Saved Prompts
            </h2>

          </div>

        <div className="space-y-2">

          {savedPrompts.map(prompt => (

            <div
              key={prompt.id}
              className="
                rounded-lg
                border
                border-neutral-800
                bg-neutral-900
                p-4
                hover:border-neutral-700
                transition-colors
              "
            >

              <div className="flex items-start justify-between gap-3">

                <div className="min-w-0">

                  <div className="font-medium text-neutral-200">
                    {prompt.name}
                  </div>

                  <div className="text-xs text-neutral-500 mt-1">
                    Order {prompt.order}
                  </div>

                </div>

                <div className="flex items-center gap-2 shrink-0">

                  <button
                    onClick={() =>
                      openSavedPrompt(prompt)
                    }
                    className="
                      px-3
                      py-1.5
                      rounded-md
                      border
                      border-neutral-700
                      bg-neutral-950
                      text-xs
                      text-neutral-300
                      hover:border-neutral-500
                      hover:text-neutral-100
                      transition-colors
                    "
                  >
                    Open
                  </button>

                  <button
                    onClick={() =>
                      deleteSavedPrompt(prompt.id)
                    }
                    className="
                      px-3
                      py-1.5
                      rounded-md
                      border
                      border-neutral-800
                      bg-neutral-950
                      text-xs
                      text-neutral-500
                      hover:border-red-900
                      hover:text-red-400
                      transition-colors
                    "
                  >
                    Delete
                  </button>

                </div>

              </div>

              {prompt.description && (
                <p className="text-xs text-neutral-500 mt-3 leading-relaxed">
                  {prompt.description}
                </p>
              )}

            </div>

          ))}

        </div>


        </div>

      </div>

    </div>

  )
}