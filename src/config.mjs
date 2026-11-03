import fs from "node:fs"
import path from "node:path"
import { configFile } from "./paths.mjs"

export const MCP_ENTRY = { command: "npx", args: ["-y", "opencode-skills-doctor@0.9.4", "mcp"] }

/** Drop `//` and `/* *\/` comments plus trailing commas; string contents are preserved. */
export function stripJsonc(text) {
  return stripTrailingCommas(stripJsonComments(text))
}

/** First pass: remove comments without touching string contents. */
function stripJsonComments(text) {
  let out = ""
  let inString = false
  let escaped = false
  let inLine = false
  let inBlock = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLine) {
      if (ch === "\n") {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      inLine = true
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      i++
      continue
    }
    out += ch
  }

  return out
}

/** Second pass: drop trailing commas character by character, so `a,}` in a string survives. */
function stripTrailingCommas(text) {
  let out = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ",") {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === "}" || text[j] === "]") continue
    }
    out += ch
  }

  return out
}

/**
 * Parse `openclaw.json` (JSON5 in practice). Comments and trailing commas are
 * supported; other JSON5-only syntax (unquoted keys, single quotes) is not.
 * A parse failure never rewrites the file - the caller should fall back to the
 * `openclaw mcp` CLI.
 */
export function parseConfig(text) {
  const cleaned = stripJsonc(String(text).replace(/^\uFEFF/, ""))
  if (!cleaned.trim()) return {}
  return JSON.parse(cleaned)
}

/**
 * Load the OpenClaw config.
 * @returns {{file: string, exists: boolean, data: object, error: string|null}}
 */
export function loadConfig({ stateDir, home, env } = {}) {
  const file = configFile({ stateDir: stateDir ?? undefined })
  if (!fs.existsSync(file)) return { file, exists: false, data: {}, error: null }
  try {
    return { file, exists: true, data: parseConfig(fs.readFileSync(file, "utf8")), error: null }
  } catch (err) {
    return { file, exists: true, data: {}, error: String(err?.message ?? err) }
  }
}

/** Existing permission bits, or null when the file does not exist yet. */
function existingMode(file) {
  try {
    return fs.statSync(file).mode & 0o777
  } catch {
    return null
  }
}

/**
 * Write atomically and keep the file's permissions: `openclaw.json` can hold
 * credentials (0600), and a plain rewrite would inherit the umask (0644).
 */
function atomicWrite(file, text) {
  const previousMode = existingMode(file)
  const tmp = `${file}.skills-doctor-${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 })
  try {
    fs.renameSync(tmp, file)
  } catch {
    fs.writeFileSync(file, text, { encoding: "utf8", mode: 0o600 })
    try {
      fs.rmSync(tmp, { force: true })
    } catch {}
  }
  try {
    fs.chmodSync(file, previousMode ?? 0o600)
  } catch {}
}

/** Back up the current file next to itself, keeping its permissions; returns the backup path. */
export function backupConfig(file, now = new Date()) {
  if (!fs.existsSync(file)) return null
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const backup = `${file}.bak-${stamp}`
  fs.copyFileSync(file, backup)
  try {
    fs.chmodSync(backup, existingMode(file) ?? 0o600)
  } catch {}
  return backup
}

/** Persist the config, backing up the previous content. Returns the backup path. */
export function saveConfig({ file, data, now } = {}) {
  const target = file ?? configFile()
  const backup = backupConfig(target, now)
  atomicWrite(target, `${JSON.stringify(data, null, 2)}\n`)
  return backup
}

export function getMcpServer(data, name) {
  return data?.mcp?.servers?.[name] ?? null
}

/** Insert or replace one `mcp.servers.<name>` entry. Returns "added" | "updated" | "unchanged". */
export function setMcpServer(data, name, definition = MCP_ENTRY) {
  if (!data.mcp || typeof data.mcp !== "object") data.mcp = {}
  if (!data.mcp.servers || typeof data.mcp.servers !== "object") data.mcp.servers = {}
  const current = data.mcp.servers[name]
  if (current && JSON.stringify(current) === JSON.stringify(definition)) return "unchanged"
  data.mcp.servers[name] = definition
  return current ? "updated" : "added"
}

/** Remove one `mcp.servers.<name>` entry and tidy now-empty parents. Returns "removed" | "absent". */
export function removeMcpServer(data, name) {
  const servers = data?.mcp?.servers
  if (!servers || typeof servers !== "object" || !(name in servers)) return "absent"
  delete servers[name]
  if (Object.keys(servers).length === 0) {
    delete data.mcp.servers
    if (Object.keys(data.mcp).length === 0) delete data.mcp
  }
  return "removed"
}

export function getPluginEntry(data, id) {
  return data?.plugins?.entries?.[id] ?? null
}

/** Enable or disable one `plugins.entries.<id>` entry. Returns "added" | "updated" | "unchanged". */
export function setPluginEnabled(data, id, enabled = true) {
  if (!data.plugins || typeof data.plugins !== "object") data.plugins = {}
  if (!data.plugins.entries || typeof data.plugins.entries !== "object") data.plugins.entries = {}
  const current = data.plugins.entries[id]
  if (current && typeof current === "object" && current.enabled === enabled) return "unchanged"
  if (current && typeof current === "object") {
    data.plugins.entries[id] = { ...current, enabled }
    return "updated"
  }
  data.plugins.entries[id] = { enabled }
  return "added"
}

/** Remove one `plugins.entries.<id>` entry and tidy now-empty parents. Returns "removed" | "absent". */
export function removePluginEntry(data, id) {
  const entries = data?.plugins?.entries
  if (!entries || typeof entries !== "object" || !(id in entries)) return "absent"
  delete entries[id]
  if (Object.keys(entries).length === 0) {
    delete data.plugins.entries
    if (Object.keys(data.plugins).length === 0) delete data.plugins
  }
  return "removed"
}
