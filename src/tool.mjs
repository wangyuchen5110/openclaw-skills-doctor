import path from "node:path"
import { auditOpenClaw } from "./index.mjs"

export const TOOL_NAME = "skills_doctor"
export const COMMAND_NAME = "skills-doctor"

const DEFAULT_LIMIT = 5
const MAX_MESSAGE = 180

function clip(text, limit = MAX_MESSAGE) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim()
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

/**
 * Compact, token-conscious report for the plugin tool.
 *
 * The full markdown report (core `formatMarkdown`) is fine on a terminal but
 * expensive inside a model turn: the tool result is paid once, the follow-up
 * explanation again. Five findings plus the budget line are enough to act on.
 */
export function renderCompact(audit, { limit = DEFAULT_LIMIT } = {}) {
  const { summary, counts } = audit
  const tokens = summary.advertisedTokens
  const budget = audit.budget
  const lines = []

  const over = tokens > budget ? `, over by ${tokens - budget}` : ", within budget"
  lines.push(
    `skills-doctor — ${summary.total} skill${summary.total === 1 ? "" : "s"}, ` +
      `${summary.advertised} advertised · ~${tokens} description tokens/step (budget ${budget}${over})`,
  )
  if (audit.openclaw?.workspace) lines.push(`workspace: ${audit.openclaw.workspace}`)
  if (audit.openclaw?.stateDir) lines.push(`state dir: ${audit.openclaw.stateDir}`)

  if (!audit.findings.length) {
    lines.push("no findings")
    return lines.join("\n")
  }

  lines.push(`findings: ${counts.errors} error, ${counts.warnings} warn, ${counts.infos} info`)
  for (const finding of audit.findings.slice(0, limit)) {
    lines.push(`- [${finding.severity}] ${finding.rule}: ${clip(finding.message)}`)
  }
  if (audit.findings.length > limit) lines.push(`- …and ${audit.findings.length - limit} more`)
  lines.push("next: npx -y openclaw-skills-doctor plan  (exact trim/hide savings)")
  return lines.join("\n")
}

/** Structured payload stored in `details` (kept out of model-visible text). */
export function summarizeForTool(audit, { limit = DEFAULT_LIMIT } = {}) {
  return {
    report: {
      workspace: audit.openclaw?.workspace ?? null,
      stateDir: audit.openclaw?.stateDir ?? null,
      skills: audit.summary.total,
      advertised: audit.summary.advertised,
      advertisedTokens: audit.summary.advertisedTokens,
      bodyTokens: audit.summary.bodyTokens,
      budget: audit.budget,
      errors: audit.counts.errors,
      warnings: audit.counts.warnings,
      infos: audit.counts.infos,
      findings: audit.findings.slice(0, limit).map((finding) => ({
        rule: finding.rule,
        severity: finding.severity,
        message: clip(finding.message),
      })),
      totalFindings: audit.findings.length,
    },
  }
}

/**
 * Audit OpenClaw skill roots and return both the compact text and details.
 * Shared by the plugin tool, the plugin command and tests.
 */
export async function runSkillsDoctor({
  directory,
  workspace,
  stateDir,
  home,
  env = process.env,
  budget = null,
  lang = null,
  limit = DEFAULT_LIMIT,
  includeGlobal = false,
} = {}) {
  const target = directory && String(directory).trim() ? path.resolve(String(directory).trim()) : undefined
  const audit = await auditOpenClaw({
    cwd: target,
    workspace: target ?? workspace,
    stateDir,
    home,
    env,
    budget,
    lang,
    includeGlobal,
  })
  return { audit, text: renderCompact(audit, { limit }), details: summarizeForTool(audit, { limit }) }
}
