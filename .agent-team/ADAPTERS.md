# Native tool adapters

One shared role set generates 21 native files. The primary session is lead;
the other six roles run as independent native workers when the host permits.
Canonical product_reviewer is named product-reviewer in native definitions.

| Host ID | Entry | Native definitions | Coordination |
| --- | --- | --- | --- |
| codex | AGENTS.md | .codex/agents/*.toml | Host delegation/messaging tools |
| claude | CLAUDE.md | .claude/agents/*.md | Native Agent calls; lead relays peer questions where necessary |
| antigravity | GEMINI.md | .agents/agents/*.md | Native subagents and available messaging; otherwise lead relay |

Antigravity also reads AGENTS.md. The Codex entry explicitly routes Antigravity
to GEMINI.md; the actual environment takes precedence over a filename or saved
preference. The generated lead is selectable but should not be spawned as a
second lead from the primary session.

## Permissions and capabilities

Codex and Claude definitions inherit the host model and normal tool permissions.
Claude specifies model: inherit and does not enable bypass permission modes.
Antigravity definitions use model: inherit and commandExecutionPolicy: sandbox.
Its explicit worker tool list uses documented view_file, grep_search,
replace_file_content, and run_command; the selectable lead also gets documented
invoke_subagent. The command tool can create assigned files within host scopes.
This list is not a separate operating-system security boundary.

We do not invent browser, web-search, or messaging tool names for a host. Research
and browser verification depend on the available tools/network and installed
project tooling. Report missing capabilities honestly; a prompt cannot grant
them. Never claim a file-based role switch is an independent worker.

Preflight checks known local blockers and uses content fingerprints. Codex checks
TOML, disabled delegation, root overrides, and known instruction bytes. Claude
checks documented project JSON settings and Agent/Task denial rules affecting
the team. Antigravity inspects its native definitions and workspace rule files;
it does not pretend to read an undocumented project settings format. Global,
managed, profile, trust, account, and actual tool capabilities remain host checks.

## Verification labels

Generated formats, role mapping, installation safety, host selection, and local
preflight have automated tests. A green static check means those checks passed;
it does not mean any provider loaded or executed the agents. Each live host
requires a real task/communication/test/review trial before claiming live support.
The current app can use explicit shared role instructions with native workers.
External Claude Code and Antigravity sessions require their own available login
and host; their live status must not be inferred from schema tests.

No local-model runner, Ollama integration, provider API service, daemon, or
automatic package/model download is included. Adding another native tool means
adding its registry/specification, generator, entry route, local preflight, and
regression tests, then verifying in that actual host.

## Primary references

- [Codex custom subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code project settings](https://code.claude.com/docs/en/settings)
- [Antigravity custom subagents](https://antigravity.google/docs/subagents/)
- [Antigravity workspace rules](https://antigravity.google/docs/rules/)

Documentation checked November 3, 2026. Native formats may evolve; live host
verification and version diagnostics remain separate from local file validation.
