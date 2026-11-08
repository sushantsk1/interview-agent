<!-- universal-agent-team:begin -->
## Universal Agent Team

Host route: Claude Code (claude). Entry files and installed programs are
hints, not proof of the active environment. Use this route only in an actual Claude Code session. Other tools must follow their own entry point: Codex uses AGENTS.md, Claude Code uses CLAUDE.md, and Antigravity uses GEMINI.md.

At first project work, and after host/configuration changes, run:

    node scripts/team.mjs setup --host claude

Setup performs lightweight local checks and remembers the choice; it does not
start a model, sign in, download a runtime, or grant tool permissions. Reuse its
result during the same unchanged session instead of repeating setup per task.

Read .agent-team/ENTRYPOINT.md, .agent-team/WORKFLOW.md, and
.agent-team/PERMISSIONS.md. The primary session acts as lead and follows
.agent-team/roles/lead.md; do not spawn a second lead. Shared role definitions
govern work; native agent names use hyphens (product-reviewer maps to the canonical
product_reviewer role). Confirm real delegation with a useful bounded assignment
before claiming an independent team is active. If the host has no delegation,
report that limitation and never present role switching as independent review.

Use actual host tools for messages, assignments, and results. Pass each worker
its task, relevant context, canonical role, and owned files. Resolve routine
decisions inside the team and preserve existing repository instructions. Before
declaring complete, collect actual evidence and run node scripts/team.mjs verify.
<!-- universal-agent-team:end -->
