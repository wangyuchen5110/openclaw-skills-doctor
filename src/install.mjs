import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { MCP_SERVER_NAME, SKILL_NAME, openclawHome } from "./paths.mjs"
import {
  MCP_ENTRY,
  loadConfig,
  saveConfig,
  setMcpServer,
  removeMcpServer,
  getMcpServer,
} from "./config.mjs"
import { workspaceDir, openclawSkillDirs } from "./paths.mjs"

const CLI_NAME = "openclaw"

/** Locate an executable on PATH (Windows honours PATHEXT). */
export function findExecutable(name, { env = process.env } = {}) {
  const pathValue = env.PATH ?? env.Path ?? ""
  const dirs = String(pathValue).split(path.delimiter).filter(Boolean)
  const exts = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""]
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {}
    }
  }
  return null
}

/** Run a command and capture output; never throws. */
export function runCommand(exe, args, { cwd } = {}) {
  const result = spawnSync(exe, args, {
    encoding: "utf8",
    cwd,
    shell: process.platform === "win32",
    windowsHide: true,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
    error: result.error ? String(result.error.message ?? result.error) : null,
  }
}

export function detectCli({ env = process.env } = {}) {
  return findExecutable(CLI_NAME, { env })
}

export function bundledSkillSource() {
  return fileURLToPath(new URL("../skills/openclaw-skills-doctor", import.meta.url))
}

function copySkill(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true })
}

function sameSkill(source, target) {
  try {
    return fs.readFileSync(path.join(source, "SKILL.md"), "utf8") === fs.readFileSync(path.join(target, "SKILL.md"), "utf8")
  } catch {
    return false
  }
}

/**
 * Wire skills-doctor into OpenClaw:
 *   1. save `mcp.servers["skills-doctor"]` (via `openclaw mcp add` when the CLI is
 *      available, otherwise by patching openclaw.json with a backup);
 *   2. install the bundled `openclaw-skills-doctor` skill into `<workspace>/skills`.
 *
 * Idempotent; `dryRun` reports the actions without touching anything.
 */
export function installOpenClaw({
  home,
  env = process.env,
  stateDir,
  workspace,
  config: providedConfig,
  cli = undefined,
  dryRun = false,
  force = false,
  now,
  run = runCommand,
} = {}) {
  const actions = []
  const warnings = []
  const errors = []

  const state = stateDir ? path.resolve(stateDir) : openclawHome({ home, env })
  const loaded = loadConfig({ stateDir: state })
  if (loaded.error) {
    errors.push(`cannot parse ${loaded.file}: ${loaded.error} (fall back to \`openclaw mcp add\`)`)
    return { command: "install", dryRun, stateDir: state, configFile: loaded.file, actions, warnings, errors }
  }

  const ws = workspace
    ? path.resolve(workspace)
    : workspaceDir({ home, env, stateDir: state, config: providedConfig ?? loaded.data })
  const cliPath = cli === undefined ? detectCli({ env }) : cli
  const result = {
    command: "install",
    dryRun,
    cli: cliPath,
    stateDir: state,
    workspace: ws,
    configFile: loaded.file,
    actions,
    warnings,
    errors,
    mcp: { server: MCP_SERVER_NAME, method: null, state: "failed" },
    skill: { dir: path.join(ws, "skills", SKILL_NAME), state: "failed" },
  }

  // 1) MCP server entry
  const existing = getMcpServer(loaded.data, MCP_SERVER_NAME)
  if (existing && JSON.stringify(existing) === JSON.stringify(MCP_ENTRY)) {
    result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "unchanged" }
    actions.push(`mcp: "${MCP_SERVER_NAME}" already saved`)
  } else if (cliPath) {
    const args = [
      "mcp",
      "add",
      MCP_SERVER_NAME,
      "--command",
      MCP_ENTRY.command,
      ...MCP_ENTRY.args.flatMap((arg) => ["--arg", arg]),
      "--no-probe",
    ]
    if (dryRun) {
      result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: "would-add" }
      actions.push(`would run: ${CLI_NAME} ${args.join(" ")}`)
    } else {
      const out = run(cliPath, args)
      result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: "added" }
      actions.push(`mcp: ${CLI_NAME} mcp add ${MCP_SERVER_NAME}`)
      if (!out.ok) {
        warnings.push(
          `openclaw mcp add failed${out.stderr ? `: ${out.stderr.split("\n")[0]}` : ""} - patching ${path.basename(loaded.file)} instead (stop the Gateway to use the CLI path)`,
        )
        result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "failed" }
      }
    }
  }

  // Fall back to a direct config patch when the CLI is missing or refused
  // (e.g. the Gateway owns the state directory).
  if (result.mcp.state === "failed" && !errors.length) {
    const change = dryRun ? (existing ? "would-update" : "would-add") : setMcpServer(loaded.data, MCP_SERVER_NAME)
    if (dryRun) {
      result.mcp = { server: MCP_SERVER_NAME, method: "config", state: change }
      actions.push(`would write mcp.servers.${MCP_SERVER_NAME} to ${path.basename(loaded.file)}`)
    } else {
      try {
        const backup = saveConfig({ file: loaded.file, data: loaded.data, now })
        result.mcp = { server: MCP_SERVER_NAME, method: "config", state: change }
        actions.push(`mcp: wrote mcp.servers.${MCP_SERVER_NAME} to ${loaded.file}`)
        if (backup) actions.push(`backup: ${path.basename(backup)}`)
        warnings.push("comments and JSON5-only formatting in openclaw.json were normalized - the previous file is backed up")
      } catch (err) {
        errors.push(`cannot write ${loaded.file}: ${String(err?.message ?? err)}`)
      }
    }
  }

  // 2) Bundled skill
  const source = bundledSkillSource()
  const target = path.join(ws, "skills", SKILL_NAME)
  try {
    if (!fs.existsSync(path.join(source, "SKILL.md"))) {
      errors.push(`bundled skill missing at ${source}`)
    } else if (fs.existsSync(target) && sameSkill(source, target)) {
      result.skill.state = "unchanged"
      actions.push(`skill: ${target} already up to date`)
    } else if (dryRun) {
      result.skill.state = "would-install"
      actions.push(`would install skill to ${target}`)
    } else if (fs.existsSync(target) && !force) {
      result.skill.state = "updated"
      copySkill(source, target)
      actions.push(`skill: updated ${target}`)
    } else {
      result.skill.state = "installed"
      copySkill(source, target)
      actions.push(`skill: installed ${target}`)
    }
  } catch (err) {
    errors.push(`cannot install skill into ${target}: ${String(err?.message ?? err)}`)
  }

  if (cliPath) actions.push(`verify: ${CLI_NAME} mcp doctor ${MCP_SERVER_NAME} --probe`)
  return result
}

/** Reverse {@link installOpenClaw}: remove the MCP entry and the bundled skill. */
export function uninstallOpenClaw({
  home,
  env = process.env,
  stateDir,
  workspace,
  cli = undefined,
  dryRun = false,
  run = runCommand,
} = {}) {
  const actions = []
  const warnings = []
  const errors = []

  const state = stateDir ? path.resolve(stateDir) : openclawHome({ home, env })
  const loaded = loadConfig({ stateDir: state })
  if (loaded.error) errors.push(`cannot parse ${loaded.file}: ${loaded.error}`)
  const ws = workspace ? path.resolve(workspace) : workspaceDir({ home, env, stateDir: state, config: loaded.data })
  const cliPath = cli === undefined ? detectCli({ env }) : cli

  const result = {
    command: "uninstall",
    dryRun,
    cli: cliPath,
    stateDir: state,
    workspace: ws,
    configFile: loaded.file,
    actions,
    warnings,
    errors,
    mcp: { server: MCP_SERVER_NAME, method: null, state: "absent" },
    skill: { dir: path.join(ws, "skills", SKILL_NAME), state: "absent" },
  }

  if (!getMcpServer(loaded.data, MCP_SERVER_NAME)) {
    actions.push(`mcp: "${MCP_SERVER_NAME}" is not configured`)
  } else if (cliPath) {
    if (dryRun) {
      actions.push(`would run: ${CLI_NAME} mcp unset ${MCP_SERVER_NAME}`)
      result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: "would-remove" }
    } else {
      const out = run(cliPath, ["mcp", "unset", MCP_SERVER_NAME])
      if (out.ok) {
        result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: "removed" }
        actions.push(`mcp: ${CLI_NAME} mcp unset ${MCP_SERVER_NAME}`)
      } else {
        warnings.push(`openclaw mcp unset failed${out.stderr ? `: ${out.stderr.split("\n")[0]}` : ""} - patching ${path.basename(loaded.file)} instead`)
        result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "failed" }
      }
    }
  } else {
    result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "failed" }
  }

  if (result.mcp.state === "failed" && !errors.length) {
    if (dryRun) {
      actions.push(`would remove mcp.servers.${MCP_SERVER_NAME}`)
      result.mcp.state = "would-remove"
    } else {
      removeMcpServer(loaded.data, MCP_SERVER_NAME)
      try {
        const backup = saveConfig({ file: loaded.file, data: loaded.data })
        result.mcp.state = "removed"
        actions.push(`mcp: removed mcp.servers.${MCP_SERVER_NAME} from ${loaded.file}`)
        if (backup) actions.push(`backup: ${path.basename(backup)}`)
      } catch (err) {
        errors.push(`cannot write ${loaded.file}: ${String(err?.message ?? err)}`)
      }
    }
  }

  const target = path.join(ws, "skills", SKILL_NAME)
  if (!fs.existsSync(target)) {
    actions.push(`skill: ${target} is not installed`)
  } else if (dryRun) {
    result.skill.state = "would-remove"
    actions.push(`would remove ${target}`)
  } else {
    let foreign = false
    try {
      foreign = !/\bname:\s*openclaw-skills-doctor\b/.test(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"))
    } catch {}
    if (foreign) {
      warnings.push(`left ${target} in place: it does not look like the bundled skill`)
    } else {
      fs.rmSync(target, { recursive: true, force: true })
      result.skill.state = "removed"
      actions.push(`skill: removed ${target}`)
    }
  }

  return result
}

/** Facts an operator (or `doctor`) needs about the local OpenClaw install. */
export function inspectOpenClaw({ home, env = process.env, stateDir, workspace } = {}) {
  const state = stateDir ? path.resolve(stateDir) : openclawHome({ home, env })
  const loaded = loadConfig({ stateDir: state })
  const ws = workspace ? path.resolve(workspace) : workspaceDir({ home, env, stateDir: state, config: loaded.data })
  const cli = detectCli({ env })
  const roots = openclawSkillDirs({ stateDir: state, workspace: ws, config: loaded.data, home })
  return {
    command: "doctor",
    cli,
    stateDir: state,
    configFile: loaded.file,
    configExists: loaded.exists,
    configError: loaded.error,
    workspace: ws,
    skillDirs: roots.map((dir) => ({ dir, exists: fs.existsSync(dir) })),
    mcpEntry: getMcpServer(loaded.data, MCP_SERVER_NAME),
    skillDir: path.join(ws, "skills", SKILL_NAME),
    skillInstalled: fs.existsSync(path.join(ws, "skills", SKILL_NAME, "SKILL.md")),
  }
}
