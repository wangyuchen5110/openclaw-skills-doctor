import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"
import { COMMAND_NAME, TOOL_NAME, runSkillsDoctor } from "./tool.mjs"

export const PLUGIN_ID = "openclaw-skills-doctor"

const TOOL_DESCRIPTION =
  "Audit OpenClaw skills: per-step description token cost, shadowed duplicates and broken references. Returns a compact report."

const PARAMETERS = {
  type: "object",
  properties: {
    directory: {
      type: "string",
      description: "Agent workspace to audit (default: the configured OpenClaw workspace)",
    },
    budget: {
      type: "number",
      description: "Description token budget per model step (default 1200)",
    },
    limit: {
      type: "number",
      description: "Maximum findings to include in the report (default 5)",
    },
  },
  additionalProperties: false,
}

const PROMPT_GUIDANCE =
  "## Skills\nUse `skills_doctor` before adding a skill or when a skill seems missing, shadowed or expensive: it measures the per-step token cost of the OpenClaw skill roots and reports the top findings."

async function report(params = {}) {
  const limit = Number.isFinite(params.limit) && params.limit > 0 ? Math.min(Math.floor(params.limit), 20) : undefined
  return runSkillsDoctor({
    directory: typeof params.directory === "string" ? params.directory : undefined,
    budget: typeof params.budget === "number" && params.budget > 0 ? params.budget : undefined,
    limit,
  })
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "OpenClaw Skills Doctor",
  description:
    "Audit the skills OpenClaw loads: per-step token cost, shadowed duplicates and broken references.",
  register(api) {
    api.registerTool(
      {
        name: TOOL_NAME,
        label: "Skills Doctor",
        description: TOOL_DESCRIPTION,
        parameters: PARAMETERS,
        async execute(_toolCallId, params) {
          try {
            const { text, details } = await report(params)
            return { content: [{ type: "text", text }], details }
          } catch (err) {
            const message = String(err?.message ?? err)
            return {
              content: [{ type: "text", text: `skills-doctor failed: ${message}` }],
              details: { report: { failure: message } },
            }
          }
        },
      },
      { name: TOOL_NAME, promptGuidance: PROMPT_GUIDANCE },
    )

    api.registerCommand({
      name: COMMAND_NAME,
      description: "Audit the skills OpenClaw loads (token cost, shadowing, broken references)",
      acceptsArgs: true,
      async handler() {
        try {
          const { text } = await report({ limit: 10 })
          return { text }
        } catch (err) {
          return { text: `skills-doctor failed: ${String(err?.message ?? err)}` }
        }
      },
    })
  },
})
