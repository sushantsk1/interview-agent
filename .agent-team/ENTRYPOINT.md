# Shared team entry instructions

The primary conversation acts as lead. Read `.agent-team/roles/lead.md`,
`.agent-team/WORKFLOW.md`, and `.agent-team/PERMISSIONS.md` before project work.
The team is explicitly authorized to delegate substantive work to independent
requirements, researcher, frontend, backend, tester, and product reviewer agents.

Use the current host's native tools. Generated native names use hyphens:
`product-reviewer` maps to canonical role `product_reviewer` in task records.
Use actual runtime agent IDs. Do not create a second lead or recursively spawn
specialists. Work within the host's concurrency and permission limits.

Routine technical and product decisions stay within the team: ask the researcher
for evidence and let the lead decide. Preserve user constraints, existing code,
configuration, instructions, and unrelated changes. Involve the user only for
essential missing access/business facts or consequential actions that lack
authorization, as described in PERMISSIONS.md.

Establish acceptance criteria, task/file ownership, and frontend/backend contract
before parallel development. Assign shared manifests, configuration, and types
one writer. Developers verify their work; tester and reviewer independently
check the integrated product.

Keep progress in `.agent-team/work/`; preserve existing records on resume. Before
declaring complete, populate the actual completion evidence and run
`node scripts/team.mjs verify`. See COMPLETION.md. A passing validator checks
recorded consistency, not authenticated proof of identities or execution.

If native delegation is unavailable, explain the concrete limitation and do
useful preparation. Do not claim independent verification by switching roles
inside a single conversation. Small questions/fixes may use only relevant roles.
