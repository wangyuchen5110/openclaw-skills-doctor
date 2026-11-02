# openclaw-skills-doctor

Audit the skills **OpenClaw** loads: the per-step token tax, shadowed duplicates,
broken references and budget overruns - then get a measured plan to fix them.

OpenClaw injects every eligible skill into the system prompt as a compact XML
block: roughly **97 characters plus name, description and location per skill,
paid on every model step**. This tool measures that cost, tells you which
definition actually wins, and can trim or hide the expensive ones.

Three ways to use it: **CLI**, **MCP server**, or the **native OpenClaw plugin**
(a `skills_doctor` tool + `/skills-doctor` command). All of them share the same
audit core, so the numbers always match.

A thin, focused wrapper around [`opencode-skills-doctor`](https://github.com/wangyuchen5110/opencodeplugginprogram)
that knows OpenClaw's skill roots, precedence, `openclaw.json`, its MCP registry
and its plugin API.

## Quick start

```powershell
npx -y openclaw-skills-doctor check          # findings + per-step token cost
npx -y openclaw-skills-doctor plan           # exact savings: trim and/or hide
npx -y openclaw-skills-doctor doctor         # paths, roots, install state
npx -y openclaw-skills-doctor check --html openclaw-report.html --open
```

Nothing to configure: the wrapper resolves the state dir and workspace the same
way OpenClaw does.

## What it audits

OpenClaw file-backed skill roots, highest precedence first:

| Priority | Source | Path |
| --- | --- | --- |
| 1 | Workspace skills | `<workspace>/skills` |
| 2 | Project agent skills | `<workspace>/.agents/skills` |
| 3 | Personal agent skills | `~/.agents/skills` (default state dir only) |
| 4 | Managed / local skills | `<state-dir>/skills` |
| 5+ | Extra dirs | `skills.load.extraDirs` in `openclaw.json` |

The wrapper hands those roots to the core auditor in exactly this order, so the
winning definition in a shadowing report matches what OpenClaw actually loads.
Other agents' global roots (Claude, OpenCode, Grok, Cursor, Kimi, Hermes) are
skipped by default; pass `--include-other-agents` to audit them too.

## Install the integration

```powershell
npx -y openclaw-skills-doctor install
```

That does two things and is idempotent:

1. saves the MCP server definition `mcp.servers.skills-doctor` in
   `~/.openclaw/openclaw.json` - through `openclaw mcp add` (or `mcp set` when
   the saved entry differs) when the CLI is installed, otherwise by patching the
   config directly (the previous file is backed up as
   `openclaw.json.bak-<timestamp>`). A CLI write is verified against the config
   and falls back to the patch if nothing was persisted;
2. installs the bundled `openclaw-skills-doctor` skill into
   `<workspace>/skills/openclaw-skills-doctor`.

```powershell
npx -y openclaw-skills-doctor install --mcp-only     # just the MCP entry
npx -y openclaw-skills-doctor install --skill-only   # just the bundled skill
npx -y openclaw-skills-doctor install --plugin       # also the native plugin
npx -y openclaw-skills-doctor install --dry-run      # show what would change
npx -y openclaw-skills-doctor uninstall              # remove what install added
openclaw mcp doctor skills-doctor --probe            # verify the server connects
```

Restart the Gateway (or run `openclaw mcp reload`) so the tool appears. MCP tools
are namespaced per server, so the agent calls `skills-doctor__skills_doctor`.

## Native plugin (optional)

`install --plugin` copies the package into `<state-dir>/extensions/openclaw-skills-doctor`
and sets `plugins.entries["openclaw-skills-doctor"].enabled = true`. The plugin
adds:

- a `skills_doctor` tool that returns a **compact** report (top findings, budget
  line, next step) instead of the full markdown - tool results are paid in the
  model context too;
- a `/skills-doctor` command that prints the same report directly.

```powershell
openclaw plugins inspect openclaw-skills-doctor --runtime --json  # verify the load
```

Prefer a managed install for anything beyond local experiments:

```bash
openclaw plugins install ./openclaw-skills-doctor   # local package
```

The plugin API is **experimental**; pin your OpenClaw version and re-run
`openclaw plugins inspect ... --runtime` after upgrades. This repository ships
plain JavaScript with no build step (no TypeScript, no TypeBox), so the plugin
entry is the same code the tests exercise.

### Manual MCP setup

If you prefer to wire the MCP server yourself:

```bash
openclaw mcp add skills-doctor \
  --command npx \
  --arg -y \
  --arg opencode-skills-doctor \
  --arg mcp
```

or in `~/.openclaw/openclaw.json`:

```json5
{
  mcp: {
    servers: {
      "skills-doctor": {
        command: "npx",
        args: ["-y", "opencode-skills-doctor", "mcp"],
      },
    },
  },
}
```

## Paths it resolves

| What | Resolution order |
| --- | --- |
| State dir | `OPENCLAW_STATE_DIR` > `OPENCLAW_PROFILE` (`~/.openclaw-<profile>`) > `~/.openclaw` |
| Config | `<state-dir>/openclaw.json` |
| Workspace | `OPENCLAW_WORKSPACE_DIR` > `agents.entries.main.workspace` > `agents.defaults.workspace` > `<state-dir>/workspace` |

Override any of them with `--state-dir <dir>`, `--workspace <dir>`, `--home <dir>`.

## Commands

| Command | What it does |
| --- | --- |
| `check` | audit sources, shadowing, token budget and broken references (default) |
| `plan` | exact savings: which descriptions to trim, which skills to hide |
| `scan` | every skill with its source, precedence and cost |
| `fix` | archive shadowed duplicates (reversible) or hide low-frequency skills |
| `install` / `uninstall` | MCP entry + bundled skill (+ optional native plugin), idempotent |
| `doctor` | CLI, state dir, config, workspace, roots, MCP/skill/plugin install state |
| `mcp` | run the MCP server on stdio |

Core flags work as usual: `--json`, `--budget`, `--lang en|zh`, `--dry-run`,
`--strict`, `--html [file]`, `--no-global`.

## Fixing what it finds

```powershell
npx -y openclaw-skills-doctor plan             # measure first
npx -y openclaw-skills-doctor fix --dry-run    # see what would be archived
npx -y openclaw-skills-doctor fix              # archive shadowed duplicates (reversible)
npx -y openclaw-skills-doctor fix --hide legacy-skill
```

`fix` only archives definitions that never load, moving them to
`.skills-doctor-archive/<timestamp>/` inside the same skill root. `--hide` adds
`metadata.opencode/autoinvoke: false`, which keeps the skill loadable through an
explicit `@id` reference while removing it from the model-facing list.

## Safety

- `check`, `plan`, `scan` and `doctor` are read-only and offline (no network, no LLM).
- `install`/`uninstall` back up `openclaw.json` before rewriting it; the CLI path
  leaves the file alone entirely.
- `uninstall` only removes a bundled skill whose `SKILL.md` still declares
  `name: openclaw-skills-doctor`, and a plugin directory it recognizes.
- Config parsing understands JSON with comments and trailing commas. A file that
  uses other JSON5-only syntax (unquoted keys, single quotes) is reported, never
  rewritten - use `openclaw mcp add/set/unset` there instead.
- It is not a sandbox: it audits configuration and files, it does not constrain
  what the agent can do.

## Development

```powershell
npm install
npm test                  # 27 tests
npm run plugin:validate   # offline manifest/entry/metadata consistency
```

Requires Node >= 20. MIT.

[Changelog](CHANGELOG.md) · [中文说明](README.zh-CN.md) · [Core reference](https://github.com/wangyuchen5110/opencodeplugginprogram/blob/main/docs/REFERENCE.md)
