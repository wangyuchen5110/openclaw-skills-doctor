#!/usr/bin/env node
// Offline consistency check for the packed plugin metadata.
// Everything here runs without an OpenClaw install, so CI can catch manifest
// drift even though the runtime API itself is experimental.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { COMMAND_NAME, TOOL_NAME } from "../src/tool.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const problems = []

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"))
  } catch (err) {
    problems.push(`${file}: cannot read/parse - ${String(err?.message ?? err)}`)
    return null
  }
}

const pkg = readJson("package.json")
const manifest = readJson("openclaw.plugin.json")
const entryFile = path.join(root, "src", "openclaw-plugin.mjs")
const entry = fs.existsSync(entryFile) ? fs.readFileSync(entryFile, "utf8") : ""

if (!entry) problems.push("src/openclaw-plugin.mjs: missing")

if (pkg) {
  const extension = pkg.openclaw?.extensions?.[0]
  if (!extension) problems.push("package.json: openclaw.extensions is missing")
  else if (!fs.existsSync(path.join(root, extension))) problems.push(`package.json: openclaw.extensions points at a missing file (${extension})`)
  if (pkg.openclaw?.plugin?.id && manifest?.id && pkg.openclaw.plugin.id !== manifest.id) {
    problems.push(`package.json: openclaw.plugin.id (${pkg.openclaw.plugin.id}) != manifest id (${manifest.id})`)
  }
  // Required by ClawHub for code plugin packages.
  if (!pkg.openclaw?.compat?.pluginApi) problems.push("package.json: openclaw.compat.pluginApi is required for ClawHub publishing")
  if (!pkg.openclaw?.build?.openclawVersion) problems.push("package.json: openclaw.build.openclawVersion is required for ClawHub publishing")
}

if (manifest) {
  if (manifest.id !== "openclaw-skills-doctor") problems.push(`openclaw.plugin.json: unexpected id (${manifest.id})`)
  const tools = manifest.contracts?.tools
  if (!Array.isArray(tools) || !tools.includes(TOOL_NAME)) {
    problems.push(`openclaw.plugin.json: contracts.tools must include "${TOOL_NAME}"`)
  }
  if (!manifest.configSchema || typeof manifest.configSchema !== "object") {
    problems.push("openclaw.plugin.json: configSchema is required (an empty object schema is valid)")
  }
  if (manifest.activation?.onStartup !== true) {
    problems.push("openclaw.plugin.json: activation.onStartup should be true so the tool is registered at startup")
  }
}

if (entry) {
  if (!entry.includes("api.registerTool(")) problems.push("entry: does not call api.registerTool")
  if (!entry.includes("api.registerCommand(")) problems.push("entry: does not call api.registerCommand")
  if (!entry.includes(`name: TOOL_NAME`)) problems.push("entry: tool name is not bound to TOOL_NAME")
  if (!entry.includes("name: COMMAND_NAME")) problems.push("entry: command name is not bound to COMMAND_NAME")
  if (!entry.includes("definePluginEntry(")) problems.push("entry: should export definePluginEntry(...)")
}

if (!fs.existsSync(path.join(root, "skills", "openclaw-skills-doctor", "SKILL.md"))) {
  problems.push("skills/openclaw-skills-doctor/SKILL.md is missing")
}

if (problems.length) {
  console.error(`plugin validation failed (${problems.length} problem${problems.length === 1 ? "" : "s"})`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `plugin metadata ok: ${manifest.id} (${TOOL_NAME} + /${COMMAND_NAME}), entry ${pkg.openclaw.extensions[0]}`,
)
