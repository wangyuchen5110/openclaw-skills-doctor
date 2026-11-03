## 0.3.3

Security hardening after the ClawHub scan:

- `install` / `uninstall` no longer spawn the `openclaw` CLI (`child_process` is
  gone). The MCP entry is written by patching `openclaw.json` with a timestamped
  backup and an atomic write, so it also works while the Gateway is running.
- `uninstall` removes the bundled skill only when its `SKILL.md` was read
  successfully **and** declares `name: openclaw-skills-doctor`; an unreadable
  directory is left in place with a warning.
- `doctor --json` no longer echoes saved MCP values (they can carry
  credentials); it reports `mcpConfigured: true | false` instead.
- Tests: 28.

# Changelog

## 0.3.2

- ClawHub plugin metadata: openclaw.compat.pluginApi / openclaw.build.openclawVersion (target OpenClaw 2026.10.9) and an optional openclaw peer dependency, so the package can be published to ClawHub.
Bug fixes from a full review:

- JSONC parsing no longer truncates string values containing `,}` or `,]` while
  removing trailing commas.
- `install --plugin` no longer drops the MCP entry the `openclaw` CLI just wrote:
  the config is re-read after a successful CLI write before the plugin entry is
  saved.
- `uninstall --plugin` no longer writes the just-removed MCP entry back into
  `openclaw.json`.
- Tests: 30.

## 0.3.1

- `scripts/validate-plugin.mjs` (+ `npm run plugin:validate`, wired into CI and
  `prepublishOnly`): offline consistency check for the packed plugin metadata -
  manifest id, `contracts.tools`, `activation`, `configSchema`, the
  `openclaw.extensions` entry, and the `api.registerTool` / `api.registerCommand`
  bindings. It runs without an OpenClaw install, so manifest drift fails in CI
  even though the runtime API is experimental.
- Docs: privacy statement in both READMEs - runs 100% locally, no telemetry, does
  not read chats/sessions/credentials, uploads nothing; the wrapper itself makes
  no network calls.
- Docs: landing-page refresh - custom SVG banner, centered hero with `for-the-badge`
  shields (including local-only/no-telemetry/no-user-data), contents list, Mermaid
  pipeline diagram, and a real `doctor` example output; the Chinese page mirrors it.
- Published on npm: `openclaw-skills-doctor@0.3.1` (first release since the 0.1.0
  wrapper), so `npx -y openclaw-skills-doctor@latest <command>` now runs this code.

## 0.3.0

- Native OpenClaw plugin: `openclaw.plugin.json` + `src/openclaw-plugin.mjs`
  register the `skills_doctor` tool and a `/skills-doctor` command. Plain
  JavaScript, no build step, no TypeBox dependency. `install --plugin` copies the
  package into `<state-dir>/extensions/openclaw-skills-doctor` and enables it in
  `plugins.entries`; `uninstall --plugin` reverses both.
- Compact tool output: the plugin (and the new `src/tool.mjs` API) returns the
  budget line plus the top findings instead of the full markdown, so the tool
  result stays cheap. The full report is still available on the CLI.
- Install robustness: a successful `openclaw mcp add/set` is verified against
  `openclaw.json` and falls back to a direct config patch when nothing was
  persisted (wrong profile, refused write while the Gateway owns the state dir).
  An existing but different entry is updated with `openclaw mcp set` instead of
  being re-added.
- Granular installs: `--mcp-only` and `--skill-only`; `doctor` now reports the
  native plugin directory and enablement.
- Tests: 27.

## 0.2.0

- Real OpenClaw integration. `install` now saves `mcp.servers["skills-doctor"]` in
  `openclaw.json` (via `openclaw mcp add` when the CLI is available, otherwise by
  patching the config with a timestamped backup) and installs the bundled
  `openclaw-skills-doctor` skill into `<workspace>/skills`. `uninstall` reverses
  both and refuses to delete a same-named skill it does not own.
- New `doctor` command: reports the detected `openclaw` CLI, state dir, config,
  workspace, every skill root (present/missing) and the install state. `--json`
  for scripting.
- Discovery now matches OpenClaw's documented precedence: `<workspace>/skills`,
  `<workspace>/.agents/skills`, `~/.agents/skills` (default state dir only),
  `<state-dir>/skills`, then `skills.load.extraDirs`. Roots are registered
  lowest-first so the shadowing winner matches the runtime.
- State dir, config path and workspace are resolved the way OpenClaw resolves
  them (`OPENCLAW_STATE_DIR`, `OPENCLAW_PROFILE`, `OPENCLAW_WORKSPACE_DIR`,
  `agents.*.workspace`), with `--state-dir` / `--workspace` / `--home` overrides.
- Bundled `SKILL.md` with `metadata.openclaw` gating (`requires.bins: [npx]`),
  so OpenClaw only offers the skill when npx is available.
- `--include-other-agents` opt-in for auditing the other agents' global roots.
- Tests: 19.

## 0.1.0

- Initial thin wrapper: injected OpenClaw skill roots as `--extra-dir` and printed
  the MCP setup instructions.
