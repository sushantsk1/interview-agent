import fs from 'node:fs';
import path from 'node:path';

export const HOSTS = Object.freeze(['codex', 'claude', 'antigravity']);
export const HOST_SPECS = Object.freeze({
  codex: Object.freeze({ entry: 'AGENTS.md', agentDirectory: '.codex/agents', command: 'codex' }),
  claude: Object.freeze({ entry: 'CLAUDE.md', agentDirectory: '.claude/agents', command: 'claude' }),
  antigravity: Object.freeze({ entry: 'GEMINI.md', agentDirectory: '.agents/agents', command: 'agy' }),
});

const ROLES = ['lead', 'requirements', 'researcher', 'frontend', 'backend', 'tester', 'product_reviewer'];
const LABELS = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' };
const BEGIN = '<!-- universal-agent-team:begin -->';
const END = '<!-- universal-agent-team:end -->';

function hostSpec(host) {
  if (!HOSTS.includes(host)) throw new Error(`Unsupported host: ${host}. Choose codex, claude, or antigravity.`);
  return HOST_SPECS[host];
}

function safeRead(root, relative) {
  const candidate = path.resolve(root, relative);
  const local = path.relative(root, candidate);
  if (!local || local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
    throw new Error(`Adapter source escapes the project: ${relative}`);
  }
  let cursor = root;
  for (const part of local.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing linked adapter source: ${relative}`);
  }
  if (!fs.statSync(candidate).isFile()) throw new Error(`Expected an adapter source file: ${relative}`);
  return fs.readFileSync(candidate, 'utf8').replace(/\r\n/g, '\n');
}

function sources(input) {
  const root = fs.realpathSync(path.resolve(input));
  if (!fs.statSync(root).isDirectory()) throw new Error('The adapter source must be a project directory.');
  const manifest = JSON.parse(safeRead(root, '.agent-team/team.json'));
  if (manifest.version !== 1 || !Array.isArray(manifest.roles) || manifest.roles.length !== ROLES.length) {
    throw new Error('Expected a version 1 team manifest with exactly seven roles.');
  }
  const names = manifest.roles.map(role => role?.name);
  if (new Set(names).size !== ROLES.length || ROLES.some(name => !names.includes(name))) {
    throw new Error('The team manifest must contain the seven canonical roles exactly once.');
  }
  // Stable canonical order prevents array order from changing generated output.
  return ROLES.map(name => {
    const role = manifest.roles.find(item => item.name === name);
    if (typeof role.description !== 'string' || !role.description.trim()) {
      throw new Error(`Missing description for team role ${name}.`);
    }
    const instructions = safeRead(root, `.agent-team/roles/${name}.md`).trim();
    if (!instructions) throw new Error(`Team role ${name} has no instructions.`);
    if (instructions.includes("'''")) throw new Error(`Team role ${name} contains the reserved TOML literal delimiter (three apostrophes).`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(instructions)) {
      throw new Error(`Team role ${name} contains an unsupported control character.`);
    }
    return { name, nativeName: name.replaceAll('_', '-'), description: role.description.trim(), instructions };
  });
}

function body(role, host) {
  return `Canonical team role: ${role.name}. Native agent name: ${role.nativeName}.
Use the canonical role key in shared task and completion records. Runtime agent
IDs come from ${LABELS[host]}; never substitute a role name for an actual agent ID.
Read .agent-team/WORKFLOW.md and .agent-team/PERMISSIONS.md before the assignment.
Use only tools and permissions actually provided by the current host. Route
teammate questions through the lead when direct peer messages are unavailable.

${role.instructions}`;
}

/** Generate native files from the shared roles; never calls a host or a model. */
export function generateAdapters(root) {
  const roles = sources(root);
  return HOSTS.flatMap(host => roles.map(role => {
    const directory = HOST_SPECS[host].agentDirectory;
    const instructions = body(role, host);
    if (host === 'codex') {
      return {
        relative: `${directory}/${role.nativeName}.toml`, host,
        text: `# Generated from .agent-team/roles/${role.name}.md; edit the shared role, then build.\n`
          + `name = ${JSON.stringify(role.nativeName)}\n`
          + `description = ${JSON.stringify(role.description)}\n`
          + `developer_instructions = '''\n${instructions}\n'''\n`,
      };
    }
    const metadata = [
      '---', `name: ${JSON.stringify(role.nativeName)}`, `description: ${JSON.stringify(role.description)}`,
      'model: inherit',
    ];
    if (host === 'antigravity') {
      metadata.push(`mainAgent: ${role.name === 'lead'}`, 'subagent: true', 'commandExecutionPolicy: sandbox', 'tools:');
      for (const tool of ['view_file', 'grep_search', 'replace_file_content', 'run_command']) metadata.push(`  - ${tool}`);
      if (role.name === 'lead') metadata.push('  - invoke_subagent');
    }
    metadata.push('---');
    return {
      relative: `${directory}/${role.nativeName}.md`, host,
      text: `${metadata.join('\n')}\n\n<!-- Generated from .agent-team/roles/${role.name}.md; edit the shared role, then build. -->\n\n${instructions}\n`,
    };
  }));
}

/** A short host-aware bootstrap; filenames alone never establish runtime identity. */
export function entryBlock(root, host) {
  hostSpec(host);
  // Requiring the shared entry source avoids a bootstrap pointing to a missing core.
  const project = fs.realpathSync(path.resolve(root));
  if (!safeRead(project, '.agent-team/ENTRYPOINT.md').trim()) throw new Error('Shared ENTRYPOINT.md is empty.');
  const route = host === 'codex'
    ? 'Antigravity may also read AGENTS.md. If running Codex use setup --host codex. If the actual tool is Antigravity, follow GEMINI.md and use setup --host antigravity instead; in Claude Code use CLAUDE.md and setup --host claude. Never infer the current host merely from filenames or installed tools.'
    : `Use this route only in an actual ${LABELS[host]} session. Other tools must follow their own entry point: Codex uses AGENTS.md, Claude Code uses CLAUDE.md, and Antigravity uses GEMINI.md.`;
  return `${BEGIN}
## Universal Agent Team

Host route: ${LABELS[host]} (${host}). Entry files and installed programs are
hints, not proof of the active environment. ${route}

At first project work, and after host/configuration changes, run:

    node scripts/team.mjs setup --host ${host}

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
${END}`;
}
