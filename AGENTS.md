<!-- universal-agent-team:begin -->
## Universal Agent Team

Host route: Codex (codex). Entry files and installed programs are
hints, not proof of the active environment. Antigravity may also read AGENTS.md. If running Codex use setup --host codex. If the actual tool is Antigravity, follow GEMINI.md and use setup --host antigravity instead; in Claude Code use CLAUDE.md and setup --host claude. Never infer the current host merely from filenames or installed tools.

At first project work, and after host/configuration changes, run:

    node scripts/team.mjs setup --host codex

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
