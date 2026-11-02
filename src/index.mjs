import os from "node:os"
import path from "node:path"

import { openclawHome, workspaceDir, openclawSkillDirs, existingSkillDirs, expandHome } from "./paths.mjs"
import { loadConfig } from "./config.mjs"

export { openclawHome, workspaceDir, openclawSkillDirs, existingSkillDirs, expandHome }
export { MCP_SERVER_NAME, SKILL_NAME, configFile, bundledSkillDir, configuredExtraDirs } from "./paths.mjs"
export {
  MCP_ENTRY,
  stripJsonc,
  parseConfig,
  loadConfig,
  saveConfig,
  backupConfig,
  getMcpServer,
  setMcpServer,
  removeMcpServer,
} from "./config.mjs"
export {
  findExecutable,
  detectCli,
  runCommand,
  bundledSkillSource,
  installOpenClaw,
  uninstallOpenClaw,
  inspectOpenClaw,
} from "./install.mjs"

/**
 * Audit every skill root OpenClaw reads, with OpenClaw's precedence.
 *
 * The core auditor already scans `~/.agents/skills` (global) and
 * `<cwd>/.agents/skills` (project). This adds the OpenClaw-specific roots:
 * the workspace `skills/`, the managed `<state-dir>/skills`, and any
 * `skills.load.extraDirs` from `openclaw.json`.
 *
 * @param {object} [options]
 * @param {string} [options.workspace] agent workspace (default: resolved like OpenClaw)
 * @param {string} [options.stateDir]  OpenClaw state dir (default: OPENCLAW_STATE_DIR or ~/.openclaw)
 * @param {string} [options.cwd]       project root for the core scan (default: the workspace)
 * @param {object} [options.config]    pre-loaded openclaw.json data (avoids a second read)
 * @param {object} [options.env]       environment (default: process.env)
 */
export async function auditOpenClaw({
  workspace,
  stateDir,
  cwd,
  home = os.homedir(),
  env = process.env,
  config,
  includeGlobal = true,
  lang = null,
  budget = null,
} = {}) {
  const state = stateDir ? path.resolve(stateDir) : openclawHome({ home, env })
  const loaded = config ? { data: config } : loadConfig({ stateDir: state })
  const ws = workspace ? path.resolve(workspace) : workspaceDir({ home, env, stateDir: state, config: loaded.data })
  const extraDirs = existingSkillDirs({ workspace: ws, stateDir: state, config: loaded.data, home })
  // The core registers extra dirs in array order (later = higher precedence),
  // so hand them over lowest-first to match OpenClaw's actual precedence.
  const ordered = [...extraDirs].reverse()

  const { auditSkills } = await import("opencode-skills-doctor/audit")
  const audit = auditSkills({
    cwd: cwd ? path.resolve(cwd) : ws,
    includeGlobal,
    lang,
    budget,
    extraDirs: ordered,
  })
  return { ...audit, openclaw: { stateDir: state, workspace: ws, configFile: loaded.file, extraDirs } }
}
