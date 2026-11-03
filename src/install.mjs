import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { MCP_SERVER_NAME, PLUGIN_ID, SKILL_NAME, openclawHome } from "./paths.mjs"
import {
  MCP_ENTRY,
  loadConfig,
  saveConfig,
  setMcpServer,
  removeMcpServer,
  getMcpServer,
  setPluginEnabled,
  removePluginEntry,
  getPluginEntry,
} from "./config.mjs"
import { workspaceDir, openclawSkillDirs, bundledPluginDir } from "./paths.mjs"

const CLI_NAME = "openclaw"
const PLUGIN_FILES = ["package.json", "openclaw.plugin.json", "src", "README.md", "README.zh-CN.md", "CHANGELOG.md", "LICENSE"]

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

/** Repo/package root that ships `openclaw.plugin.json` and `src/openclaw-plugin.mjs`. */
export function packageRoot() {
  return fileURLToPath(new URL("..", import.meta.url))
}

export function bundledSkillSource() {
  return path.join(packageRoot(), "skills", SKILL_NAME)
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

function copyPluginFiles(source, target) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  for (const entry of PLUGIN_FILES) {
    const from = path.join(source, entry)
    if (!fs.existsSync(from)) continue
    fs.cpSync(from, path.join(target, entry), { recursive: true, force: true })
  }
  // The plugin entry imports the core auditor; carry the runtime dependency
  // along because a raw extensions-directory plugin is not npm-managed.
  const core = path.join(source, "node_modules", "opencode-skills-doctor")
  if (fs.existsSync(core)) {
    fs.cpSync(core, path.join(target, "node_modules", "opencode-skills-doctor"), { recursive: true, force: true })
  }
}

function pluginFilesAvailable(source) {
  return fs.existsSync(path.join(source, "openclaw.plugin.json")) && fs.existsSync(path.join(source, "src", "openclaw-plugin.mjs"))
}

/**
 * Wire skills-doctor into OpenClaw:
 *   1. save `mcp.servers["skills-doctor"]` - via `openclaw mcp add/set` when the
 *      CLI is available, otherwise by patching openclaw.json (with a backup);
 *   2. install the bundled `openclaw-skills-doctor` skill into `<workspace>/skills`;
 *   3. optionally install the native plugin into `<state-dir>/extensions` and
 *      enable it in `plugins.entries` (opt-in via `plugin: true`).
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
  plugin = false,
  mcp = true,
  skill = true,
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
    mcp: { server: MCP_SERVER_NAME, method: null, state: "skipped" },
    skill: { dir: path.join(ws, "skills", SKILL_NAME), state: "skipped" },
    plugin: { dir: bundledPluginDir({ stateDir: state, home }), state: "skipped" },
  }

  // --- 1) MCP server entry -------------------------------------------------
  let configChanged = false
  const existing = getMcpServer(loaded.data, MCP_SERVER_NAME)
  const entryJson = JSON.stringify(MCP_ENTRY)
  if (!mcp) {
    actions.push("mcp: skipped (--skill-only)")
  } else if (existing && JSON.stringify(existing) === entryJson) {
    result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "unchanged" }
    actions.push(`mcp: "${MCP_SERVER_NAME}" already saved`)
  } else if (cliPath) {
    const args = existing
      ? ["mcp", "set", MCP_SERVER_NAME, entryJson]
      : ["mcp", "add", MCP_SERVER_NAME, "--command", MCP_ENTRY.command, ...MCP_ENTRY.args.flatMap((a) => ["--arg", a]), "--no-probe"]
    if (dryRun) {
      result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: existing ? "would-update" : "would-add" }
      actions.push(`would run: ${CLI_NAME} ${args.join(" ")}`)
    } else {
      const out = run(cliPath, args)
      // Trust but verify: a CLI that writes a different state dir (profile) or
      // a rejected write must not be reported as success.
      const after = loadConfig({ stateDir: state })
      const written = !after.error && JSON.stringify(getMcpServer(after.data, MCP_SERVER_NAME)) === entryJson
      if (out.ok && written) {
        result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: existing ? "updated" : "added" }
        actions.push(`mcp: ${CLI_NAME} mcp ${existing ? "set" : "add"} ${MCP_SERVER_NAME}`)
        // Re-read: the CLI wrote the file, so our in-memory copy is stale. Saving
        // it later (e.g. for --plugin) would drop the entry the CLI just added.
        const fresh = loadConfig({ stateDir: state })
        if (!fresh.error) loaded.data = fresh.data
      } else {
        result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "failed" }
        warnings.push(
          `openclaw mcp ${existing ? "set" : "add"} did not persist the entry${out.stderr ? `: ${out.stderr.split("\n")[0]}` : ""} - patching ${path.basename(loaded.file)} instead (stop the Gateway to use the CLI path)`,
        )
      }
    }
  } else {
    // No CLI on PATH: write the entry ourselves.
    configChanged = true
  }

  // Fall back to a direct config patch when the CLI is missing or refused.
  const patchConfig = result.mcp.state === "failed"
  let pluginEntryChanged = null
  if (patchConfig) configChanged = true
  if (configChanged && !dryRun && mcp) setMcpServer(loaded.data, MCP_SERVER_NAME)

  // --- 2) Bundled skill ----------------------------------------------------
  const source = bundledSkillSource()
  const target = path.join(ws, "skills", SKILL_NAME)
  try {
    if (!skill) {
      actions.push("skill: skipped (--mcp-only)")
    } else if (!fs.existsSync(path.join(source, "SKILL.md"))) {
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

  // --- 3) Native plugin (opt-in) ------------------------------------------
  const pluginTarget = bundledPluginDir({ stateDir: state, home })
  const root = packageRoot()
  if (!plugin) {
    // report but do not act
  } else if (!pluginFilesAvailable(root)) {
    errors.push(`bundled plugin missing at ${root} (openclaw.plugin.json + src/openclaw-plugin.mjs)`)
  } else if (dryRun) {
    pluginEntryChanged = setPluginEnabled(loaded.data, PLUGIN_ID, true)
    result.plugin.state = "would-install"
    actions.push(`would copy plugin to ${pluginTarget}`)
    actions.push(`would set plugins.entries.${PLUGIN_ID}.enabled = true`)
  } else {
    try {
      pluginEntryChanged = setPluginEnabled(loaded.data, PLUGIN_ID, true)
      copyPluginFiles(root, pluginTarget)
      result.plugin.state = "installed"
      actions.push(`plugin: copied to ${pluginTarget}`)
      actions.push(`plugin: plugins.entries.${PLUGIN_ID}.enabled = true`)
      warnings.push("native plugin directories are loaded from <state-dir>/extensions; for a managed install prefer `openclaw plugins install`")
    } catch (err) {
      errors.push(`cannot install plugin into ${pluginTarget}: ${String(err?.message ?? err)}`)
    }
  }

  // --- 4) Persist config once ---------------------------------------------
  const needsWrite = !dryRun && (configChanged || (pluginEntryChanged && pluginEntryChanged !== "unchanged"))
  if (needsWrite && !errors.length) {
    try {
      const backup = saveConfig({ file: loaded.file, data: loaded.data, now })
      if (configChanged) {
        result.mcp = { server: MCP_SERVER_NAME, method: "config", state: existing ? "updated" : "added" }
        actions.push(`mcp: wrote mcp.servers.${MCP_SERVER_NAME} to ${loaded.file}`)
      }
      if (backup) actions.push(`backup: ${path.basename(backup)}`)
      warnings.push("comments and JSON5-only formatting in openclaw.json were normalized - the previous file is backed up")
    } catch (err) {
      errors.push(`cannot write ${loaded.file}: ${String(err?.message ?? err)}`)
    }
  } else if (dryRun && configChanged) {
    result.mcp = { server: MCP_SERVER_NAME, method: "config", state: existing ? "would-update" : "would-add" }
    actions.push(`would write mcp.servers.${MCP_SERVER_NAME} to ${path.basename(loaded.file)}`)
  }

  if (cliPath) actions.push(`verify: ${CLI_NAME} mcp doctor ${MCP_SERVER_NAME} --probe`)
  return result
}

/** Reverse {@link installOpenClaw}: MCP entry, bundled skill and native plugin. */
export function uninstallOpenClaw({
  home,
  env = process.env,
  stateDir,
  workspace,
  cli = undefined,
  dryRun = false,
  plugin = false,
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
    plugin: { dir: bundledPluginDir({ stateDir: state, home }), state: "absent" },
  }

  // --- MCP entry -----------------------------------------------------------
  let configChanged = false
  if (!getMcpServer(loaded.data, MCP_SERVER_NAME)) {
    actions.push(`mcp: "${MCP_SERVER_NAME}" is not configured`)
  } else if (cliPath) {
    if (dryRun) {
      actions.push(`would run: ${CLI_NAME} mcp unset ${MCP_SERVER_NAME}`)
      result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: "would-remove" }
    } else {
      const out = run(cliPath, ["mcp", "unset", MCP_SERVER_NAME])
      const after = loadConfig({ stateDir: state })
      const gone = !after.error && !getMcpServer(after.data, MCP_SERVER_NAME)
      if (out.ok && gone) {
        result.mcp = { server: MCP_SERVER_NAME, method: "cli", state: "removed" }
        actions.push(`mcp: ${CLI_NAME} mcp unset ${MCP_SERVER_NAME}`)
        // Fresh read: a later save for --plugin must not resurrect the entry.
        if (!after.error) loaded.data = after.data
      } else {
        configChanged = true
        result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "removed" }
        warnings.push(`openclaw mcp unset did not remove the entry - patching ${path.basename(loaded.file)} instead`)
      }
    }
  } else {
    configChanged = true
    result.mcp = { server: MCP_SERVER_NAME, method: "config", state: "removed" }
    if (dryRun) actions.push(`would remove mcp.servers.${MCP_SERVER_NAME} from ${path.basename(loaded.file)}`)
    else actions.push(`mcp: mcp.servers.${MCP_SERVER_NAME} removed from ${path.basename(loaded.file)}`)
  }

  // --- Native plugin -------------------------------------------------------
  const pluginTarget = bundledPluginDir({ stateDir: state, home })
  if (plugin) {
    if (getPluginEntry(loaded.data, PLUGIN_ID)) {
      configChanged = true
      if (!dryRun) actions.push(`plugin: plugins.entries.${PLUGIN_ID} removed`)
      else actions.push(`would remove plugins.entries.${PLUGIN_ID}`)
    }
    if (fs.existsSync(pluginTarget)) {
      if (dryRun) {
        result.plugin.state = "would-remove"
        actions.push(`would remove ${pluginTarget}`)
      } else {
        try {
          fs.rmSync(pluginTarget, { recursive: true, force: true })
          result.plugin.state = "removed"
          actions.push(`plugin: removed ${pluginTarget}`)
        } catch (err) {
          errors.push(`cannot remove ${pluginTarget}: ${String(err?.message ?? err)}`)
        }
      }
    }
  }

  // --- Skill ---------------------------------------------------------------
  const skillTarget = path.join(ws, "skills", SKILL_NAME)
  if (!fs.existsSync(skillTarget)) {
    actions.push(`skill: ${skillTarget} is not installed`)
  } else if (dryRun) {
    result.skill.state = "would-remove"
    actions.push(`would remove ${skillTarget}`)
  } else {
    let foreign = false
    try {
      foreign = !/\bname:\s*openclaw-skills-doctor\b/.test(fs.readFileSync(path.join(skillTarget, "SKILL.md"), "utf8"))
    } catch {}
    if (foreign) {
      warnings.push(`left ${skillTarget} in place: it does not look like the bundled skill`)
    } else {
      fs.rmSync(skillTarget, { recursive: true, force: true })
      result.skill.state = "removed"
      actions.push(`skill: removed ${skillTarget}`)
    }
  }

  // --- Persist -------------------------------------------------------------
  if (!dryRun && configChanged && !errors.length) {
    try {
      if (getMcpServer(loaded.data, MCP_SERVER_NAME)) removeMcpServer(loaded.data, MCP_SERVER_NAME)
      if (getPluginEntry(loaded.data, PLUGIN_ID)) removePluginEntry(loaded.data, PLUGIN_ID)
      const backup = saveConfig({ file: loaded.file, data: loaded.data })
      actions.push(`config: updated ${loaded.file}`)
      if (backup) actions.push(`backup: ${path.basename(backup)}`)
    } catch (err) {
      errors.push(`cannot write ${loaded.file}: ${String(err?.message ?? err)}`)
    }
  } else if (dryRun && configChanged) {
    actions.push(`would write ${loaded.file}`)
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
  const pluginDir = bundledPluginDir({ stateDir: state, home })
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
    pluginDir,
    pluginInstalled: fs.existsSync(path.join(pluginDir, "openclaw.plugin.json")),
    pluginEnabled: Boolean(getPluginEntry(loaded.data, PLUGIN_ID)?.enabled),
  }
}
