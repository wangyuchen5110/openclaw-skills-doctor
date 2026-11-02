# openclaw-skills-doctor

Audit **OpenClaw** skills: the per-step token tax, shadowed duplicates, broken references and budget overruns — then get a concrete plan to fix them.

A thin wrapper around [`opencode-skills-doctor`](https://github.com/wangyuchen5110/opencodeplugginprogram) that adds OpenClaw's skill roots and the OpenClaw MCP setup.

## Quick start

```powershell
npx -y openclaw-skills-doctor check
npx -y openclaw-skills-doctor plan
npx -y openclaw-skills-doctor check --html openclaw-report.html --open
```

It scans, highest precedence first:

- `<workspace>/skills`
- `<workspace>/.agents/skills`
- `~/.agents/skills`
- `$OPENCLAW_STATE_DIR/skills` (default `~/.openclaw/skills`)

All other `skills-doctor` flags work too (`--budget`, `--json`, `--lang`, `--strict`, `--root`).

## Add the MCP tool to OpenClaw

```powershell
npx -y openclaw-skills-doctor install
```

prints the two supported forms; the CLI one is:

```bash
openclaw mcp add skills-doctor --command npx --arg -y --arg opencode-skills-doctor --arg mcp
openclaw mcp doctor skills-doctor --probe
```

OpenClaw namespaces MCP tools as `<server>__<tool>`, so the agent calls `skills-doctor__skills_doctor`.

Or write it directly in `~/.openclaw/openclaw.json`:

```json
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
```

## What you get

| | |
|---|---|
| `check` | token budget, duplicates/shadowing, long descriptions, broken references, invalid frontmatter |
| `plan` | exact savings: trim descriptions and/or hide skills, projected over N steps |
| `fix` | archive shadowed definitions (reversible) or hide low-frequency skills |
| `--html` | self-contained HTML report |

Full rules, configuration and MCP details live in the [core reference](https://github.com/wangyuchen5110/opencodeplugginprogram/blob/main/docs/REFERENCE.md).

## Development

```powershell
npm install
npm test
```

Requires Node ≥ 20. MIT.
