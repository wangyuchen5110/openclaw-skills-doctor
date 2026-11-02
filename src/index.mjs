import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export const STATE_DIR = (env = process.env) => env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw")

/**
 * OpenClaw skill roots, highest precedence first (see docs.openclaw.ai/tools/skills):
 *   <workspace>/skills, <workspace>/.agents/skills, ~/.agents/skills, <state-dir>/skills
 * `.agents/skills` is already scanned by the core; this returns only the extra roots.
 */
export function openclawSkillDirs({ cwd = process.cwd(), home = os.homedir(), stateDir = STATE_DIR() } = {}) {
  const candidates = [
    path.join(cwd, "skills"),
    path.join(cwd, ".agents", "skills"),
    path.join(stateDir, "skills"),
    path.join(home, ".agents", "skills"),
  ]
  return [...new Set(candidates.map((dir) => path.resolve(dir)))]
}

export function existingSkillDirs(options) {
  return openclawSkillDirs(options).filter((dir) => fs.existsSync(dir))
}

/** Audit the current OpenClaw workspace, state skills and shared agent skills. */
export async function auditOpenClaw({
  cwd = process.cwd(),
  includeGlobal = true,
  lang = null,
  budget = null,
  stateDir = STATE_DIR(),
} = {}) {
  const { auditSkills } = await import("opencode-skills-doctor/audit")
  return auditSkills({ cwd, includeGlobal, lang, budget, extraDirs: existingSkillDirs({ cwd, stateDir }) })
}
