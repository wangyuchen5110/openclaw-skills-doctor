import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export const CONFIG_NAME = "openclaw.json"
export const MCP_SERVER_NAME = "skills-doctor"
export const SKILL_NAME = "openclaw-skills-doctor"
export const PLUGIN_ID = "openclaw-skills-doctor"

/** Expand a leading `~` the same way OpenClaw does for config paths. */
export function expandHome(value, home = os.homedir()) {
  if (typeof value !== "string") return value
  if (value === "~") return home
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2))
  return value
}

/**
 * OpenClaw state directory.
 *
 * Precedence (see docs.openclaw.ai/concepts/agent-workspace):
 *   1. OPENCLAW_STATE_DIR
 *   2. OPENCLAW_PROFILE -> ~/.openclaw-<profile>   (a "default" profile keeps ~/.openclaw)
 *   3. ~/.openclaw
 */
export function openclawHome({ home = os.homedir(), env = process.env } = {}) {
  if (env.OPENCLAW_STATE_DIR && String(env.OPENCLAW_STATE_DIR).trim()) {
    return path.resolve(expandHome(String(env.OPENCLAW_STATE_DIR).trim(), home))
  }
  const profile = env.OPENCLAW_PROFILE && String(env.OPENCLAW_PROFILE).trim()
  if (profile && profile !== "default") return path.join(home, `.openclaw-${profile}`)
  return path.join(home, ".openclaw")
}

/** `openclaw.json` next to the active state directory. */
export function configFile({ stateDir } = {}) {
  return path.join(stateDir ?? openclawHome(), CONFIG_NAME)
}

function resolveConfiguredWorkspace(config, { home, stateDir }) {
  const entries = config?.agents?.entries
  const mainWorkspace = entries && typeof entries === "object" ? entries.main?.workspace : undefined
  const candidate = mainWorkspace ?? config?.agents?.defaults?.workspace
  if (typeof candidate !== "string" || !candidate.trim()) return null
  const expanded = expandHome(candidate.trim(), home)
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(stateDir, expanded)
}

/**
 * The agent workspace (the host for `<workspace>/skills`).
 *
 * Precedence: explicit option > OPENCLAW_WORKSPACE_DIR > `agents.*.workspace` in
 * config > `<state-dir>/workspace` (which is also what OPENCLAW_PROFILE produces).
 */
export function workspaceDir({ home = os.homedir(), env = process.env, stateDir, config } = {}) {
  const state = stateDir ?? openclawHome({ home, env })
  const explicit = env.OPENCLAW_WORKSPACE_DIR && String(env.OPENCLAW_WORKSPACE_DIR).trim()
  if (explicit) return path.resolve(expandHome(String(env.OPENCLAW_WORKSPACE_DIR).trim(), home))
  const configured = resolveConfiguredWorkspace(config, { home, stateDir: state })
  return configured ?? path.join(state, "workspace")
}

/** Extra shared skill roots from `skills.load.extraDirs` (lowest precedence). */
export function configuredExtraDirs(config, { home = os.homedir(), stateDir } = {}) {
  const list = config?.skills?.load?.extraDirs
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const entry of list) {
    if (typeof entry !== "string" || !entry.trim()) continue
    const expanded = expandHome(entry.trim(), home)
    const abs = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(stateDir, expanded)
    if (seen.has(abs)) continue
    seen.add(abs)
    out.push(abs)
  }
  return out
}

/**
 * OpenClaw file-backed skill roots, highest precedence first:
 *   <workspace>/skills            workspace skills
 *   <workspace>/.agents/skills    project agent skills
 *   ~/.agents/skills              personal agent skills (default state dir only)
 *   <state-dir>/skills            managed / local skills
 *   skills.load.extraDirs         lowest-precedence extra dirs
 *
 * The caller decides which of these become `--extra-dir`: the core auditor
 * already scans `~/.agents/skills` and `<cwd>/.agents/skills` when globals are
 * enabled, and de-duplicates identical roots either way.
 */
export function openclawSkillDirs({ workspace, stateDir, config, home = os.homedir() } = {}) {
  const state = stateDir ?? openclawHome({ home })
  const ws = workspace ?? workspaceDir({ home, stateDir: state, config })
  const candidates = [
    path.join(ws, "skills"),
    path.join(ws, ".agents", "skills"),
    // Personal agent skills are only loaded by OpenClaw for the default state dir.
    ...(path.resolve(state) === path.resolve(path.join(home, ".openclaw")) ? [path.join(home, ".agents", "skills")] : []),
    path.join(state, "skills"),
    ...configuredExtraDirs(config, { home, stateDir: state }),
  ]
  const seen = new Set()
  const dirs = []
  for (const dir of candidates) {
    const abs = path.resolve(dir)
    if (seen.has(abs)) continue
    seen.add(abs)
    dirs.push(abs)
  }
  return dirs
}

export function existingSkillDirs(options) {
  return openclawSkillDirs(options).filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

/** Workspace skill folder for the bundled skill. */
export function bundledSkillDir({ workspace, stateDir, config, home = os.homedir() } = {}) {
  return path.join(workspace ?? workspaceDir({ home, stateDir, config }), "skills", SKILL_NAME)
}

/** Native plugin discovery root (`<state-dir>/extensions`, see docs.openclaw.ai/gateway/config-extensions). */
export function extensionsDir({ stateDir, home = os.homedir() } = {}) {
  return path.join(stateDir ?? openclawHome({ home }), "extensions")
}

/** Install target for the bundled native plugin. */
export function bundledPluginDir({ stateDir, home = os.homedir() } = {}) {
  return path.join(extensionsDir({ stateDir, home }), PLUGIN_ID)
}
