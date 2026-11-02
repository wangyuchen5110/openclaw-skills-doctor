import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openclawSkillDirs, auditOpenClaw } from "../src/index.mjs"

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-skills-doctor-"))
}

function skill(dir, id, description = "test skill") {
  fs.mkdirSync(path.join(dir, id), { recursive: true })
  fs.writeFileSync(
    path.join(dir, id, "SKILL.md"),
    `---\nname: ${id}\ndescription: ${description}\n---\n\n1. Do the thing.\n`,
    "utf8",
  )
}

test("openclawSkillDirs: workspace, .agents and state roots", () => {
  const cwd = tmpdir()
  const stateDir = tmpdir()
  const dirs = openclawSkillDirs({ cwd, stateDir, home: tmpdir() })
  assert.ok(dirs.includes(path.resolve(cwd, "skills")))
  assert.ok(dirs.includes(path.resolve(cwd, ".agents", "skills")))
  assert.ok(dirs.includes(path.resolve(stateDir, "skills")))
})

test("auditOpenClaw: scans workspace and state skills", async () => {
  const cwd = tmpdir()
  const stateDir = tmpdir()
  fs.mkdirSync(path.join(cwd, ".git"))
  skill(path.join(cwd, "skills"), "workspace-skill")
  skill(path.join(stateDir, "skills"), "state-skill")

  const audit = await auditOpenClaw({ cwd, includeGlobal: false, stateDir })
  const ids = audit.skills.map((item) => item.id).sort()
  assert.deepEqual(ids, ["state-skill", "workspace-skill"])
  assert.ok(audit.summary.advertisedTokens > 0)
})
