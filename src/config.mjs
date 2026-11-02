import fs from "node:fs"
import path from "node:path"
import { configFile } from "./paths.mjs"

export const MCP_ENTRY = { command: "npx", args: ["-y", "opencode-skills-doctor", "mcp"] }

/** Drop `//` and `/* *\/` comments plus trailing commas; string contents are preserved. */
export function stripJsonc(text) {
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

  return out.replace(/,(\s*[}\]])/g, "$1")
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

function atomicWrite(file, text) {
  const tmp = `${file}.skills-doctor-${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, text, "utf8")
  try {
    fs.renameSync(tmp, file)
  } catch {
    fs.writeFileSync(file, text, "utf8")
    try {
      fs.rmSync(tmp, { force: true })
    } catch {}
  }
}

/** Back up the current file next to itself; returns the backup path. */
export function backupConfig(file, now = new Date()) {
  if (!fs.existsSync(file)) return null
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const backup = `${file}.bak-${stamp}`
  fs.copyFileSync(file, backup)
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
