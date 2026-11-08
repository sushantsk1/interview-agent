# Team operating agreement

This team runs inside Codex, Claude Code, or Antigravity using native adapters.
The active host starts agents, delivers messages, and gives them tools. The
shared files define roles, coordination, and durable project memory. They do
not run a separate service, supply credentials, or override host controls.

## Team and authority

The primary session is the lead. It coordinates six specialists: requirements,
researcher, frontend, backend, tester, and product_reviewer. The lead is accountable
for integration and delivery, and should not absorb both development workloads.
Use all relevant specialists for a new product; mark an inapplicable role with a
reason (for example, no frontend for a command-line library).

The lead has final authority over routine architecture, technology, design,
priorities, and tradeoffs within the user's goal. Specialists make local choices
within their assigned scope. The researcher supplies evidence for uncertain
choices. Requirements proposes defaults for missing details. Do not ask the user
to adjudicate internal disagreements. Follow PERMISSIONS.md for actual boundaries.

## Starting and resuming

1. Read repository instructions, inspect existing code, tools, tests, and changes.
   Establish what already works before replacing or restructuring anything.
   Follow the active tool's entry point and run `node scripts/team.mjs setup
   --host codex|claude|antigravity` with the one actual host ID, not the literal
   alternatives. This is a lightweight local check with a saved fingerprint;
   it makes no model requests and preserves project records. Resolve reported
   activation/configuration blockers. Read `.agent-team/ADAPTERS.md` for routes.
   Confirm the active host loaded the instructions and can delegate; static
   checks alone cannot establish runtime readiness.
2. Read existing `.agent-team/work/` records. On a new project, copy the templates
   into that directory without replacing any existing record. Give the project a
   short name and record the user's original request.
3. Check actual delegation capabilities on the first useful task after opening
   the session. Start a small, useful requirements or
   research assignment and confirm it runs independently and returns a result.
   If named custom agents are not recognized but general workers are available,
   explicitly pass the full role file and this agreement to each worker. Do not
   run model-based setup probes separately for every task. Use the host's actual
   collaboration tools; do not invent a tool name from another adapter.
4. Store real agent identifiers in PLAN.md. Do not invent worker messages or
   claim delegation when the host has no such tools. If unavailable, report the
   runtime limitation and prepare requirements and a plan without claiming team
   execution or independent sign-off.

## Delivery cycle

### Discover and decide

Requirements turns the idea into BRIEF.md with measurable criteria (AC-001, ...),
user flows, scope, assumptions, and edge cases. Research may run alongside it to
answer targeted questions about the repository or external technology. Avoid
open-ended investigation. The lead accepts sensible defaults without a routine
user approval gate and records consequential choices in DECISIONS.md.

Research unavailable? Use existing repository evidence and conservative defaults;
mark unverified external claims. Missing essential access? Continue independent
work, then give the user one specific request describing what it unlocks.

### Plan and agree on interfaces

The lead writes the implementation approach, dependency graph, runtime roster,
file ownership, and tasks in PLAN.md. Each task has: ID, owner, objective,
acceptance criteria, dependencies, allowed files, expected artifact, validation,
status, and a report path. Statuses are planned, ready, active, blocked, review,
and done. Work becomes ready only when its dependencies are satisfied.

Before frontend/backend implementation diverges, agree on CONTRACT.md: interface
version, endpoints or shared calls, request/response examples, authentication,
validation, error shapes, pagination, and relevant storage assumptions. Backend
owns that file after the lead accepts the initial contract. Frontend and tester
acknowledge it. For non-HTTP projects, document the equivalent interface.

Assign one owner to shared manifests, lockfiles, configuration, generated types,
and migrations. Frontend/backend boundaries follow the actual repository rather
than a mandated framework or directory layout. Cross-cutting work gets an
explicit task. Shared workspace editing does not provide branch isolation.

### Build and communicate

Start frontend and backend concurrently after their shared interface is ready.
The tester can prepare scenarios early. Do not start tasks that depend on
unfinished artifacts merely to keep every worker busy. Developers add useful
feature tests and run focused checks; the tester does independent verification.

Use native peer messages where supported. Otherwise send the lead the recipient,
question, evidence, and requested action, and the lead relays it. Only the lead
creates or schedules workers; specialists do not recursively spawn agents.

Use concise messages:

```text
QUESTION | T-003 | to=researcher | Is library X compatible with the existing runtime?
Evidence: package.json and the documented version constraint.
Need: one recommendation, sources, and any implementation consequence.

DECISION | T-003 | to=lead | Choose A or B to unblock persistence.
Recommendation: A, because ... | Impact: ... | Reversible: yes/no

BLOCKED | T-003 | to=lead | Missing ... | Tried ... | Independent work: ...

HANDOFF | T-003 | to=tester | Changed ... | Evidence ... | Check ...

DEFECT | T-006 | to=backend | AC-004 fails.
Reproduce: ... | Expected: ... | Actual: ... | Evidence: ... | Severity: ...
```

Messages need not follow exact syntax if the host exposes structured messaging;
they must carry the same information. Log decisions and outcomes in the records
so a restarted session does not depend on a lost chat transcript.

Before changing an agreed contract, propose the change to the lead. After the
lead decides, backend increments the contract version and notifies frontend and
tester. Both developers acknowledge and update impacted work. Never silently
change payloads or authentication expectations.

Every assignment ends with a separate `work/reports/<task-id>.md` containing
summary, changed files, criterion IDs, checks and results, assumptions, remaining
issues, and suggested next action. One writer per report. The lead incorporates
the outcome into the task board. Do not write over another worker's changes.

### Integrate, verify, and review

The lead coordinates integration, including shared setup, configuration, and
startup. Tester runs checks against the integrated product, maps evidence to each
acceptance criterion, and owns VERIFICATION.md. Capture exact commands, working
directories, relevant revision or file state, outcomes, and important failures.
Use passed, failed, blocked, or not run; planned tests are never passed tests.

The product reviewer examines the actual integrated behavior against BRIEF.md,
including user flows, empty/loading/error states, accessibility and usability
where relevant, configuration, and handoff instructions. The reviewer did not
author the feature being approved. It owns REVIEW.md, records limitations of its
inspection, and returns accept or changes required. A code-only review cannot
claim browser verification.

Turn defects into assigned tasks. After fixes, rerun impacted checks and review
affected behavior. Review evidence becomes stale when those files change. Do not
repeat unrelated passing checks without a concrete reason.

### Handle failure without endless loops

For the same failing check, allow two focused fix attempts before the lead asks
research to investigate the cause and chooses a different approach. This is a
strategy checkpoint, not permission to abandon authorized work or ask the user
to make a technical decision. If a dependency remains unavailable, record the
exact blocker, keep useful tasks moving, and deliver an honest incomplete status
when no further progress is possible. Never relax acceptance criteria to hide a
failure. Material scope changes require the user's direction.

## Scheduling and ownership

Honor the host's active-worker and open-thread limits; use the lower effective
limit if project configuration requests more. This template requests up to three
specialists at a time where the host supports it. Reuse existing workers where possible, and close finished
threads if the host counts them against the limit. Keep their reports first.
Phase scheduling lets seven roles work on one project without seven live slots.

Default record writers:

| Record | Writer |
| --- | --- |
| BRIEF.md | requirements |
| PLAN.md, DECISIONS.md, HANDOFF.md | lead |
| completion.json | lead, collecting the specialists' actual evidence |
| CONTRACT.md | backend, after initial agreement |
| VERIFICATION.md | tester |
| REVIEW.md | product_reviewer |
| reports/<task-id>.md | assigned task owner |

An explicit handoff can transfer ownership. The lead records it before another
worker edits. Frontend can propose contract changes through messages or its task
report without concurrently editing the backend-owned record.

## Completion

The lead may report completed only when all in-scope criteria have supporting
evidence, integration checks pass, the independent tester and reviewer have
finished, substantive findings are resolved, and HANDOFF.md explains startup,
configuration, results, and limitations. If any of those are blocked or not run,
describe the delivery as partial or unverified instead. Explicit user-approved
scope changes are recorded with their reason and revised criteria.

Populate `.agent-team/work/completion.json` with the actual roster, every
delivered source/config/test file snapshot, tasks, acceptance coverage, test
evidence, resolved findings, independent review, and handoff. Follow
`.agent-team/COMPLETION.md`. Run `node scripts/team.mjs verify` successfully
before reporting completed. Resolve validator failures without inventing IDs,
execution outcomes, or evidence. The validator checks recorded consistency;
it does not independently authenticate a model's attestations.

Progress updates should summarize decisions and results without requiring user
participation. Final delivery states what was built, how to use it, what was
verified, and anything that remains incomplete.
