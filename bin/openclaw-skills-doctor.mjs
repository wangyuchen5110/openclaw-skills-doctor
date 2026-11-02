#!/usr/bin/env node
import path from "node:path"
import { main as skillsDoctorMain } from "opencode-skills-doctor/cli"
import { existingSkillDirs } from "../src/index.mjs"

const argv = process.argv.slice(2)
const command = argv[0]

function printInstall() {
  console.log(`OpenClaw integration

Add the MCP server (stdio):

  openclaw mcp add skills-doctor --command npx --arg -y --arg opencode-skills-doctor --arg mcp
  openclaw mcp doctor skills-doctor --probe

Or in ~/.openclaw/openclaw.json:

  {
    "mcp": {
      "servers": {
        "skills-doctor": {
          "command": "npx",
          "args": ["-y", "opencode-skills-doctor", "mcp"]
        }
      }
    }
  }

Tools are namespaced <server>__<tool>, so call skills-doctor__skills_doctor.
Restart the Gateway or run: openclaw mcp reload
`)
}

if (command === "install" || command === "uninstall") {
  printInstall()
  process.exit(0)
}

const extraDirs = existingSkillDirs({ cwd: process.cwd() })
for (const dir of extraDirs) argv.push("--extra-dir", dir)
if (extraDirs.length) {
  console.error(`openclaw-skills-doctor: extra skill roots: ${extraDirs.map((dir) => path.relative(process.cwd(), dir) || ".").join(", ")}`)
}

await skillsDoctorMain(argv)
