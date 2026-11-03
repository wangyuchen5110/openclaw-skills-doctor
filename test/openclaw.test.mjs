import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  MCP_SERVER_NAME,
  SKILL_NAME,
  PLUGIN_ID,
  openclawHome,
  workspaceDir,
  openclawSkillDirs,
  configuredExtraDirs,
  bundledSkillDir,
  bundledPluginDir,
  configFile,
} from "../src/paths.mjs"
import {
  MCP_ENTRY,
  stripJsonc,
  loadConfig,
  saveConfig,
  getMcpServer,
  setMcpServer,
  removeMcpServer,
  getPluginEntry,
} from "../src/config.mjs"
import { installOpenClaw, uninstallOpenClaw, inspectOpenClaw } from "../src/install.mjs"
import { auditOpenClaw } from "../src/index.mjs"
import { TOOL_NAME, COMMAND_NAME, renderCompact, summarizeForTool, runSkillsDoctor } from "../src/tool.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "..")

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-skills-doctor-"))
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function skill(dir, id, description = "test skill") {
  write(path.join(dir, id, "SKILL.md"), `---\nname: ${id}\ndescription: ${description}\n---\n\n1. Do the thing.\n`)
}

function sandbox() {
  const home = tmpdir()
  const stateDir = path.join(home, ".openclaw")
  const workspace = path.join(stateDir, "workspace")
  return { home, stateDir, workspace }
}

// ---------------------------------------------------------------- paths

test("openclawHome: default, profile and OPENCLAW_STATE_DIR", () => {
  const home = tmpdir()
  assert.equal(openclawHome({ home, env: {} }), path.join(home, ".openclaw"))
  assert.equal(openclawHome({ home, env: { OPENCLAW_PROFILE: "work" } }), path.join(home, ".openclaw-work"))
  assert.equal(openclawHome({ home, env: { OPENCLAW_PROFILE: "default" } }), path.join(home, ".openclaw"))
  assert.equal(openclawHome({ home, env: { OPENCLAW_STATE_DIR: path.join(home, "custom") } }), path.join(home, "custom"))
})

test("workspaceDir: OPENCLAW_WORKSPACE_DIR > config > <state>/workspace", () => {
  const home = tmpdir()
  const stateDir = path.join(home, ".openclaw")

  assert.equal(workspaceDir({ home, env: {}, stateDir }), path.join(stateDir, "workspace"))
  assert.equal(
    workspaceDir({ home, env: {}, stateDir, config: { agents: { defaults: { workspace: "~/work" } } } }),
    path.join(home, "work"),
  )
  assert.equal(
    workspaceDir({
      home,
      env: { OPENCLAW_WORKSPACE_DIR: "~/env-ws" },
      stateDir,
      config: { agents: { defaults: { workspace: "~/work" } } },
    }),
    path.join(home, "env-ws"),
  )
  assert.equal(configFile({ stateDir }), path.join(stateDir, "openclaw.json"))
})

test("openclawSkillDirs: OpenClaw precedence and dedupe", () => {
  const home = tmpdir()
  const stateDir = path.join(home, ".openclaw")
  const workspace = path.join(stateDir, "workspace")
  const config = { skills: { load: { extraDirs: ["~/shared-skills", "~/shared-skills"] } } }

  const dirs = openclawSkillDirs({ home, stateDir, workspace, config })
  assert.deepEqual(dirs, [
    path.join(workspace, "skills"),
    path.join(workspace, ".agents", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(stateDir, "skills"),
    path.join(home, "shared-skills"),
  ])
  assert.equal(bundledSkillDir({ home, stateDir, workspace }), path.join(workspace, "skills", SKILL_NAME))
  assert.equal(configuredExtraDirs(config, { home, stateDir }).length, 1)
})

test("openclawSkillDirs: personal ~/.agents/skills only for the default state dir", () => {
  const home = tmpdir()
  const custom = path.join(home, "custom-state")
  const dirs = openclawSkillDirs({ home, stateDir: custom, workspace: path.join(custom, "workspace") })
  assert.ok(!dirs.includes(path.join(home, ".agents", "skills")))
})

// ---------------------------------------------------------------- config

test("stripJsonc: comments and trailing commas", () => {
  const text = `{
    // line comment
    "a": 1, /* block */
    "b": "http://example.com", // not a comment
    "c": [1, 2,],
  }`
  assert.deepEqual(JSON.parse(stripJsonc(text)), { a: 1, b: "http://example.com", c: [1, 2] })
})

test("config: set/remove mcp entry, idempotent, keeps other keys", () => {
  const data = { gateway: { bind: "loopback" } }
  assert.equal(setMcpServer(data, MCP_SERVER_NAME), "added")
  assert.deepEqual(getMcpServer(data, MCP_SERVER_NAME), MCP_ENTRY)
  assert.equal(setMcpServer(data, MCP_SERVER_NAME), "unchanged")
  assert.equal(removeMcpServer(data, MCP_SERVER_NAME), "removed")
  assert.equal(removeMcpServer(data, MCP_SERVER_NAME), "absent")
  assert.deepEqual(data, { gateway: { bind: "loopback" } })
})

test("config: parse failure is reported and never overwrites the file", () => {
  const { stateDir } = sandbox()
  fs.mkdirSync(stateDir, { recursive: true })
  const file = configFile({ stateDir })
  write(file, "{ not: json5-without-quotes }")
  const loaded = loadConfig({ stateDir })
  assert.ok(loaded.error)
  assert.equal(loaded.exists, true)

  const result = installOpenClaw({ home: tmpdir(), env: {}, stateDir, cli: null })
  assert.ok(result.errors.length >= 1)
  assert.equal(fs.readFileSync(file, "utf8"), "{ not: json5-without-quotes }")
})

test("saveConfig: backs up the previous file", () => {
  const { stateDir } = sandbox()
  fs.mkdirSync(stateDir, { recursive: true })
  const file = configFile({ stateDir })
  write(file, '{ "gateway": { "bind": "loopback" } }\n')
  const backup = saveConfig({ file, data: { gateway: { bind: "loopback" }, mcp: { servers: {} } } })
  assert.ok(backup && fs.existsSync(backup))
  assert.notEqual(JSON.parse(fs.readFileSync(file, "utf8")).mcp, undefined)
})

// ---------------------------------------------------------------- install

test("install: patches openclaw.json and installs the skill when the CLI is missing", () => {
  const { home, stateDir, workspace } = sandbox()
  const result = installOpenClaw({ home, env: {}, stateDir, workspace, cli: null })

  assert.equal(result.errors.length, 0)
  assert.equal(result.mcp.state, "added")
  assert.equal(result.mcp.method, "config")
  assert.equal(result.skill.state, "installed")
  assert.deepEqual(getMcpServer(loadConfig({ stateDir }).data, MCP_SERVER_NAME), MCP_ENTRY)
  assert.ok(fs.existsSync(path.join(workspace, "skills", SKILL_NAME, "SKILL.md")))
})

test("install: is idempotent", () => {
  const { home, stateDir, workspace } = sandbox()
  installOpenClaw({ home, env: {}, stateDir, workspace, cli: null })
  const again = installOpenClaw({ home, env: {}, stateDir, workspace, cli: null })
  assert.equal(again.mcp.state, "unchanged")
  assert.equal(again.skill.state, "unchanged")
})

test("install: dry run writes nothing", () => {
  const { home, stateDir, workspace } = sandbox()
  const result = installOpenClaw({ home, env: {}, stateDir, workspace, cli: null, dryRun: true })
  assert.equal(result.mcp.state, "would-add")
  assert.equal(fs.existsSync(configFile({ stateDir })), false)
  assert.equal(fs.existsSync(path.join(workspace, "skills", SKILL_NAME)), false)
})

test("install: 已存在的不同条目会被覆盖并备份（不调用外部命令）", () => {
  const { home, stateDir, workspace } = sandbox()
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(
    configFile({ stateDir }),
    JSON.stringify({ mcp: { servers: { [MCP_SERVER_NAME]: { command: "old", args: [] } } } }, null, 2),
  )
  const result = installOpenClaw({ home, env: {}, stateDir, workspace })
  assert.equal(result.mcp.method, "config")
  assert.equal(result.mcp.state, "updated")
  assert.deepEqual(getMcpServer(loadConfig({ stateDir }).data, MCP_SERVER_NAME), MCP_ENTRY)
  const backups = fs.readdirSync(stateDir).filter((name) => name.startsWith("openclaw.json.bak-"))
  assert.equal(backups.length, 1)
})

test("uninstall: removes the MCP entry and the bundled skill", () => {
  const { home, stateDir, workspace } = sandbox()
  installOpenClaw({ home, env: {}, stateDir, workspace, cli: null })
  const result = uninstallOpenClaw({ home, env: {}, stateDir, workspace, cli: null })
  assert.equal(result.mcp.state, "removed")
  assert.equal(result.skill.state, "removed")
  assert.equal(getMcpServer(loadConfig({ stateDir }).data, MCP_SERVER_NAME), null)
  assert.equal(fs.existsSync(path.join(workspace, "skills", SKILL_NAME)), false)
})

test("uninstall: leaves a foreign skill of the same name alone", () => {
  const { home, stateDir, workspace } = sandbox()
  write(
    path.join(workspace, "skills", SKILL_NAME, "SKILL.md"),
    "---\nname: other-skill\ndescription: x\n---\nbody\n",
  )
  const result = uninstallOpenClaw({ home, env: {}, stateDir, workspace, cli: null })
  assert.equal(result.skill.state, "absent")
  assert.ok(result.warnings.some((line) => /does not look like/.test(line)))
  assert.ok(fs.existsSync(path.join(workspace, "skills", SKILL_NAME)))
})

// ---------------------------------------------------------------- audit

test("auditOpenClaw: scans workspace and managed skills with OpenClaw precedence", async () => {
  const { home, stateDir, workspace } = sandbox()
  fs.mkdirSync(stateDir, { recursive: true })
  write(path.join(stateDir, "openclaw.json"), '{ "gateway": { "bind": "loopback" } }')
  skill(path.join(workspace, "skills"), "shared-id", "workspace copy")
  skill(path.join(stateDir, "skills"), "shared-id", "managed copy")
  skill(path.join(stateDir, "skills"), "managed-only", "managed only")

  const audit = await auditOpenClaw({ home, env: {}, stateDir, workspace, includeGlobal: false })
  const dupes = audit.skills.filter((item) => item.id === "shared-id")
  assert.equal(dupes.length, 2)
  const winner = dupes.slice().sort((a, b) => b.order - a.order)[0]
  assert.equal(winner.file, path.join(workspace, "skills", "shared-id", "SKILL.md"))
  assert.ok(audit.skills.some((item) => item.id === "managed-only"))
  assert.deepEqual(audit.openclaw.extraDirs, [path.join(workspace, "skills"), path.join(stateDir, "skills")])
  assert.equal(audit.openclaw.workspace, workspace)
})

test("auditOpenClaw: honors skills.load.extraDirs", async () => {
  const { home, stateDir, workspace } = sandbox()
  const extra = path.join(home, "extra-skills")
  skill(extra, "extra-only")
  write(path.join(stateDir, "openclaw.json"), JSON.stringify({ skills: { load: { extraDirs: [extra] } } }))
  const audit = await auditOpenClaw({ home, env: {}, stateDir, workspace, includeGlobal: false })
  assert.ok(audit.skills.some((item) => item.id === "extra-only"))
})

test("inspectOpenClaw: reports paths, roots and install state", () => {
  const { home, stateDir, workspace } = sandbox()
  installOpenClaw({ home, env: {}, stateDir, workspace, cli: null })
  const facts = inspectOpenClaw({ home, env: {}, stateDir, workspace })
  assert.equal(facts.stateDir, stateDir)
  assert.equal(facts.workspace, workspace)
  assert.equal(facts.skillInstalled, true)
  assert.equal(facts.mcpConfigured, true)
  assert.ok(facts.skillDirs.some((entry) => entry.dir === path.join(workspace, "skills") && entry.exists))
})

// ---------------------------------------------------------------- bundled skill + bin

test("bundled SKILL.md: valid frontmatter and a short description", () => {
  const text = fs.readFileSync(path.join(repo, "skills", SKILL_NAME, "SKILL.md"), "utf8")
  assert.match(text, /^---\r?\n/)
  assert.match(text, new RegExp(`\\nname: ${SKILL_NAME}\\r?\\n`))
  const description = /^description: (.+)$/m.exec(text)?.[1] ?? ""
  assert.ok(description.length >= 40 && description.length <= 240, `description is ${description.length} chars`)
  assert.match(text, /metadata:\s*\n\s+openclaw:/)
})

test("bin: doctor --json runs end to end", () => {
  const { stateDir, workspace } = sandbox()
  const result = spawnSync(
    process.execPath,
    [path.join(repo, "bin", "openclaw-skills-doctor.mjs"), "doctor", "--json", "--state-dir", stateDir, "--workspace", workspace],
    {
      encoding: "utf8",
      cwd: repo,
      env: { ...process.env, OPENCLAW_STATE_DIR: "", OPENCLAW_WORKSPACE_DIR: "", OPENCLAW_PROFILE: "" },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.command, "doctor")
  assert.equal(data.stateDir, stateDir)
  assert.equal(data.workspace, workspace)
  assert.equal(data.skillInstalled, false)
  assert.equal(data.mcpConfigured, false)
  assert.equal(data.pluginInstalled, false)
  assert.equal(data.pluginEnabled, false)
})

// ---------------------------------------------------------------- compact tool output

test("renderCompact: budget line, capped findings and a next hint", () => {
  const findings = Array.from({ length: 8 }, (_, index) => ({
    rule: "long-description",
    severity: "warn",
    message: `finding ${index} ${"detail ".repeat(40)}`,
  }))
  const audit = {
    summary: { total: 3, unique: 3, advertised: 2, hidden: 0, shadowed: 0, advertisedTokens: 2400, bodyTokens: 100 },
    budget: 1200,
    counts: { errors: 1, warnings: 2, infos: 0 },
    findings,
    openclaw: { workspace: "C:/ws", stateDir: "C:/state" },
  }
  const text = renderCompact(audit, { limit: 5 })
  assert.match(text, /3 skills, 2 advertised/)
  assert.match(text, /~2400 description tokens\/step \(budget 1200, over by 1200\)/)
  assert.match(text, /findings: 1 error, 2 warn/)
  assert.equal(text.split("\n").filter((line) => line.startsWith("- [")).length, 5)
  assert.match(text, /…and 3 more/)
  assert.ok(text.split("\n").every((line) => line.length <= 260), "lines must stay bounded")
  assert.match(text, /next: npx -y openclaw-skills-doctor plan/)

  const report = summarizeForTool(audit, { limit: 5 }).report
  assert.equal(report.totalFindings, 8)
  assert.equal(report.findings.length, 5)
  assert.ok(!("status" in report), "reserved keys stay out of details")
})

test("runSkillsDoctor: audits OpenClaw roots and returns compact text", async () => {
  const { home, stateDir, workspace } = sandbox()
  skill(path.join(workspace, "skills"), "alpha", "workspace alpha skill")
  skill(path.join(stateDir, "skills"), "beta", "managed beta skill")
  const { audit, text, details } = await runSkillsDoctor({ home, env: {}, stateDir, workspace, includeGlobal: false })
  assert.equal(audit.skills.length, 2)
  assert.match(text, /2 skills, 2 advertised/)
  assert.equal(details.report.workspace, workspace)
  assert.equal(details.report.skills, 2)
})

// ---------------------------------------------------------------- native plugin

test("plugin manifest, package metadata and entry stay in sync", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, "openclaw.plugin.json"), "utf8"))
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"))
  const entry = fs.readFileSync(path.join(repo, "src", "openclaw-plugin.mjs"), "utf8")

  assert.equal(manifest.id, PLUGIN_ID)
  assert.deepEqual(manifest.contracts.tools, [TOOL_NAME])
  assert.equal(manifest.activation.onStartup, true)
  assert.ok(manifest.configSchema && typeof manifest.configSchema === "object")
  assert.deepEqual(pkg.openclaw.extensions, ["./src/openclaw-plugin.mjs"])
  assert.equal(pkg.openclaw.plugin.id, PLUGIN_ID)

  assert.match(entry, /definePluginEntry\(\{/)
  assert.match(entry, /id: PLUGIN_ID/)
  assert.ok(entry.includes("api.registerTool("), "registers the tool")
  assert.ok(entry.includes("api.registerCommand("), "registers the command")
  assert.ok(entry.includes(TOOL_NAME))
  assert.match(entry, /name: COMMAND_NAME/)
  assert.ok(fs.existsSync(path.join(repo, "src", "openclaw-plugin.mjs")))
})

test("install --plugin: copies the extension and enables it", () => {
  const { home, stateDir, workspace } = sandbox()
  const result = installOpenClaw({ home, env: {}, stateDir, workspace, cli: null, plugin: true })
  assert.equal(result.errors.length, 0)
  assert.equal(result.plugin.state, "installed")

  const target = bundledPluginDir({ stateDir, home })
  assert.ok(fs.existsSync(path.join(target, "openclaw.plugin.json")))
  assert.ok(fs.existsSync(path.join(target, "src", "openclaw-plugin.mjs")))
  assert.ok(fs.existsSync(path.join(target, "package.json")))
  assert.equal(getPluginEntry(loadConfig({ stateDir }).data, PLUGIN_ID).enabled, true)

  const facts = inspectOpenClaw({ home, env: {}, stateDir, workspace })
  assert.equal(facts.pluginInstalled, true)
  assert.equal(facts.pluginEnabled, true)
})

test("uninstall --plugin: removes the extension and the plugin entry", () => {
  const { home, stateDir, workspace } = sandbox()
  installOpenClaw({ home, env: {}, stateDir, workspace, cli: null, plugin: true })
  const result = uninstallOpenClaw({ home, env: {}, stateDir, workspace, cli: null, plugin: true })
  assert.equal(result.plugin.state, "removed")
  assert.equal(fs.existsSync(bundledPluginDir({ stateDir, home })), false)
  assert.equal(getPluginEntry(loadConfig({ stateDir }).data, PLUGIN_ID), null)
})

test("install: --mcp-only and --skill-only are independent", () => {
  const home = tmpdir()
  const stateDir = path.join(home, "state")
  const workspace = path.join(stateDir, "workspace")

  const mcpOnly = installOpenClaw({ home, env: {}, stateDir, workspace, cli: null, mcp: true, skill: false })
  assert.equal(mcpOnly.skill.state, "skipped")
  assert.equal(getMcpServer(loadConfig({ stateDir }).data, MCP_SERVER_NAME).command, "npx")
  assert.equal(fs.existsSync(path.join(workspace, "skills", SKILL_NAME)), false)

  const other = path.join(home, "state2")
  const otherWs = path.join(other, "workspace")
  const skillOnly = installOpenClaw({ home, env: {}, stateDir: other, workspace: otherWs, cli: null, mcp: false, skill: true })
  assert.equal(skillOnly.mcp.state, "skipped")
  assert.ok(fs.existsSync(path.join(otherWs, "skills", SKILL_NAME, "SKILL.md")))
  assert.equal(fs.existsSync(configFile({ stateDir: other })), false)
})

// ---------------------------------------------------------------- bug fixes

test("stripJsonc: 字符串里的 ,} / ,] 不被截断", () => {
  const text = '{"note": "a,}", "list": [1, 2,], "x": "keep,]"}'
  assert.deepEqual(JSON.parse(stripJsonc(text)), { note: "a,}", list: [1, 2], x: "keep,]" })
})

test("install --plugin: 一份配置同时写入 MCP 条目与 plugin 开关", () => {
  const { home, stateDir, workspace } = sandbox()
  const result = installOpenClaw({ home, env: {}, stateDir, workspace, plugin: true })
  assert.equal(result.mcp.method, "config")
  assert.equal(result.mcp.state, "added")
  const data = loadConfig({ stateDir }).data
  assert.deepEqual(getMcpServer(data, MCP_SERVER_NAME), MCP_ENTRY)
  assert.equal(getPluginEntry(data, PLUGIN_ID).enabled, true)
})

test("uninstall --plugin: 同时移除 MCP 条目与 plugin 开关", () => {
  const { home, stateDir, workspace } = sandbox()
  installOpenClaw({ home, env: {}, stateDir, workspace, plugin: true })
  const result = uninstallOpenClaw({ home, env: {}, stateDir, workspace, plugin: true })
  assert.equal(result.mcp.state, "removed")
  assert.equal(getMcpServer(loadConfig({ stateDir }).data, MCP_SERVER_NAME), null)
  assert.equal(getPluginEntry(loadConfig({ stateDir }).data, PLUGIN_ID), null)
})
