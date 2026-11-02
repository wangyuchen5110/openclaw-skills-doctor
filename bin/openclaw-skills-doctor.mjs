#!/usr/bin/env node
import path from "node:path"
import { main as coreMain } from "opencode-skills-doctor/cli"
import {
  loadConfig,
  openclawHome,
  workspaceDir,
  existingSkillDirs,
  installOpenClaw,
  uninstallOpenClaw,
  inspectOpenClaw,
} from "../src/index.mjs"

const OWN_COMMANDS = new Set(["install", "uninstall", "doctor"])
const OWNED_FLAGS = new Set(["--workspace", "--state-dir", "--home"])

const argv = process.argv.slice(2)
const command = argv[0]

const HELP = `openclaw-skills-doctor - audit the skills OpenClaw loads

Usage:
  openclaw-skills-doctor check [options]      audit OpenClaw skill roots (default)
  openclaw-skills-doctor plan [options]       how many tokens/step can be saved
  openclaw-skills-doctor scan [options]       every skill with source and cost
  openclaw-skills-doctor fix [options]        archive shadowed duplicates / hide skills
  openclaw-skills-doctor install [options]    wire the MCP server + bundled skill
  openclaw-skills-doctor uninstall [options]  remove the MCP server + bundled skill
  openclaw-skills-doctor doctor [options]     show CLIs, paths, roots and install state
  openclaw-skills-doctor mcp                  run the MCP server on stdio

Wrapper options (all commands):
  --state-dir <dir>        OpenClaw state dir (default: $OPENCLAW_STATE_DIR or ~/.openclaw)
  --workspace <dir>        agent workspace (default: resolved like OpenClaw)
  --home <dir>             home directory override (default: the real home)
  --include-other-agents   also audit Claude/OpenCode/Grok/Kimi/Hermes global roots
  --no-global              (core flag) skip global roots

Install options:
  --dry-run                report the actions without writing anything
  --force                  replace an existing bundled skill instead of updating it
  --json                   machine-readable result

Everything else is forwarded to skills-doctor, e.g.
  openclaw-skills-doctor check --budget 1200 --json
  openclaw-skills-doctor check --html openclaw-report.html --open
`

function parseOwnArgs(args) {
  const options = { dryRun: false, json: false, force: false, home: undefined, stateDir: undefined, workspace: undefined }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--dry-run":
        options.dryRun = true
        break
      case "--json":
        options.json = true
        break
      case "--force":
        options.force = true
        break
      case "--home":
        options.home = path.resolve(args[++i] ?? ".")
        break
      case "--state-dir":
        options.stateDir = path.resolve(args[++i] ?? ".")
        break
      case "--workspace":
        options.workspace = path.resolve(args[++i] ?? ".")
        break
      case "-h":
      case "--help":
        console.log(HELP)
        process.exit(0)
        break
      default:
        console.error(`openclaw-skills-doctor: unknown option for ${command}: ${arg}`)
        process.exit(2)
    }
  }
  return options
}

function printResult(result) {
  if (result.json) {
    console.log(JSON.stringify(result.data, null, 2))
    return
  }
  const data = result.data
  console.log(`openclaw-skills-doctor ${data.command}${data.dryRun ? " (dry run)" : ""}`)
  console.log(`  cli:        ${data.cli ?? "openclaw not found on PATH - config is patched directly"}`)
  console.log(`  state dir:  ${data.stateDir}`)
  console.log(`  workspace:  ${data.workspace}`)
  if (data.configFile) console.log(`  config:     ${data.configFile}`)
  if (data.configError) console.error(`  config:     cannot parse - ${data.configError}`)
  console.log("")
  if (Array.isArray(data.skillDirs)) {
    console.log("  skill roots:")
    for (const entry of data.skillDirs) console.log(`    ${entry.exists ? "+" : "-"} ${entry.dir}`)
    console.log("")
    console.log(`  mcp entry:  ${data.mcpEntry ? "saved" : "missing"}`)
    console.log(`  bundled skill: ${data.skillInstalled ? "installed" : "missing"}`)
    return
  }
  for (const action of data.actions ?? []) console.log(`  · ${action}`)
  for (const warning of data.warnings ?? []) console.log(`  ! ${warning}`)
  for (const error of data.errors ?? []) console.log(`  x ${error}`)
  if (!(data.actions ?? []).length && !(data.errors ?? []).length) console.log("  nothing to do")
  if (data.command === "install") {
    console.log("")
    console.log("Restart the Gateway (or run `openclaw mcp reload`) so the MCP tool shows up.")
  }
}

/** Wrapper-level flags that may prefix a delegated command. */
function takeWrapperArgs(args) {
  const forwarded = [args[0]]
  const options = { home: undefined, stateDir: undefined, workspace: undefined, includeOtherAgents: false }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--include-other-agents") {
      options.includeOtherAgents = true
      continue
    }
    if (OWNED_FLAGS.has(arg)) {
      const value = path.resolve(args[++i] ?? ".")
      if (arg === "--home") options.home = value
      else if (arg === "--state-dir") options.stateDir = value
      else options.workspace = value
      continue
    }
    forwarded.push(arg)
  }
  return { forwarded, options }
}

function resolveEnvironment(options) {
  const home = options.home
  const stateDir = options.stateDir ?? openclawHome({ home })
  const loaded = loadConfig({ stateDir })
  const workspace = options.workspace ?? workspaceDir({ home, stateDir, config: loaded.data })
  return { home, stateDir, workspace, config: loaded.data, configFile: loaded.file, configError: loaded.error }
}

async function main() {
  if (!command || command === "help" || command === "-h" || command === "--help") {
    console.log(HELP)
    return
  }

  if (OWN_COMMANDS.has(command)) {
    const options = parseOwnArgs(argv)
    if (command === "doctor") {
      const data = inspectOpenClaw({ home: options.home, stateDir: options.stateDir, workspace: options.workspace })
      printResult({ json: options.json, data })
      return
    }
    const fn = command === "install" ? installOpenClaw : uninstallOpenClaw
    const result = fn({
      home: options.home,
      stateDir: options.stateDir,
      workspace: options.workspace,
      dryRun: options.dryRun,
      force: options.force,
    })
    printResult({ json: options.json, data: result })
    if (result.errors.length) process.exitCode = 1
    return
  }

  const { forwarded, options } = takeWrapperArgs(argv)
  const env = resolveEnvironment(options)
  const extraDirs = existingSkillDirs({ workspace: env.workspace, stateDir: env.stateDir, config: env.config, home: options.home })
  if (!extraDirs.length) {
    console.error(`openclaw-skills-doctor: no OpenClaw skill roots found under ${env.workspace} / ${env.stateDir}`)
  }
  // extra dirs are registered lowest-precedence-first: reverse the OpenClaw
  // order (highest first) so the winning definition matches OpenClaw at runtime.
  const roots = [...extraDirs].reverse()
  for (const dir of roots) forwarded.push("--extra-dir", dir)
  // Audit from a neutral project root so core does not register a second,
  // lower-precedence copy of `<workspace>/.agents/skills`.
  if (!forwarded.includes("--root")) forwarded.push("--root", env.stateDir)
  if (!options.includeOtherAgents && !forwarded.includes("--no-global")) forwarded.push("--no-global")
  if (!forwarded.includes("--json")) console.log(`openclaw-skills-doctor: workspace ${env.workspace}`)
  await coreMain(forwarded)
}

await main()
