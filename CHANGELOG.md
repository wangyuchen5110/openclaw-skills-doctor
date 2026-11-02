# Changelog

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
