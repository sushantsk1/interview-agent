# Setup and use

Open this template in Codex, Claude Code, or Antigravity and give your project
idea. Ready-made definitions and tool entry files are included; no generation,
package install, custom server, or model request is needed for initial setup.
Node.js22+ runs the utility; the AI environment supplies models and native tools.

For an existing project, run from the template folder:

```powershell
node scripts/team.mjs install --target "C:\path\to\existing-project"
```

Use a normal path for your operating system. All three adapters are copied so
you can switch tools later. If you want to select/check one during installation,
add `--host codex`, `--host claude`, or `--host antigravity`.

Existing settings and instructions are preserved. Differing team-owned files,
customized team blocks, malformed markers, and nested links/junctions cause a
clear conflict before writes. There is no force-overwrite option. A copy of the
older Codex-only team requires explicit migration of its customizations first.
Your package.json and global configuration are never modified by installation.

Without --host, installation reports files installed, not runtime readiness.
Known blockers in an unused tool's settings do not prevent installing the other
adapters. The active host's setup checks its own settings before work begins.

## First task and host selection

The actual tool's entry point asks the lead to run one of:

```powershell
node scripts/team.mjs setup --host codex
node scripts/team.mjs setup --host claude
node scripts/team.mjs setup --host antigravity
```

Run only the applicable command. It checks the selected adapter/configuration,
initializes missing records without resetting progress, and saves the host and
file fingerprint in `.agent-team/local.json`. Repeating setup with unchanged
files reuses the cache and preserves its timestamp. The normal path performs
only local file operations; CLI version checks are reserved for `doctor`.

Selection order is explicit --host, your optional AGENT_TEAM_HOST environment
variable, then the saved preference. The preference is not proof of the current
tool; switching tools uses that tool's explicit entry point and overrides it.
We do not select a host merely because its executable or config folder exists.
If nothing identifies the host, setup explains the single choice needed.

The lead confirms live delegation using a small useful assignment at the start
of the real task. It does not make repeated dummy model calls for setup. A tool
may need a new session to discover newly installed definitions. Follow its
normal project trust flow; setup never bypasses it.

## Commands

| Command | Purpose |
| --- | --- |
| install --target path [--host id] | Add the ready-made adapters to an existing repo |
| setup --host id | Check chosen host, initialize missing state, save preference |
| detect | Report explicit/environment/saved host hint without guessing |
| check [--host id] | Check generated files; inspect settings when a host is selected |
| doctor --host id | Add optional local CLI version diagnostics |
| init | Create missing project records only |
| prompt --idea "..." [--host id] | Print a kickoff prompt without running a model |
| evidence --file relative/path | Print a file's evidence reference |
| verify | Validate the project's completion evidence |
| build | Regenerate native definitions/marked entry sections after role edits |

Commands are `node scripts/team.mjs <command>`. Except install/build, use
`--repo path` to operate on another installed project. Long ideas can use
`prompt --idea-file path/to/brief.txt` instead of --idea.

The shared workflow defines internal messaging or lead relay, routine decisions,
task dependencies, single-writer boundaries, API changes, and test/fix/review
cycles. See [WORKFLOW.md](WORKFLOW.md), [PERMISSIONS.md](PERMISSIONS.md), and
[COMPLETION.md](COMPLETION.md).

Work records and the host cache are local. The installer does not edit the
destination's ignore rules; decide whether to track `.agent-team/work/` and
ignore `.agent-team/local.json`. Never put credentials in these files.

## Updates and recovery

Edit `.agent-team/roles/*.md` once and run build to update all three formats.
Generated files include the canonical/native role mapping. Default models and
real permissions remain with the host. Native definitions do not grant tools
that the host or account lacks.

File updates are staged with backups. Ordinary failures roll applied changes
back; a failed rollback identifies a retained `.agent-team-transaction-*`
directory with recovery.json and backups. Preserve it until restoring files.
This is recovery for ordinary I/O failures, not power-loss atomicity or support
for simultaneous writers during setup/build.

Run `npm test` for template regression checks. Tests use temporary projects and
make no model calls. Test application code, screenshots, or live project records
must stay local and are not part of the published team repository.
