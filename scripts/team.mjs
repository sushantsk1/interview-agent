#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { HOSTS, HOST_SPECS, generateAdapters, entryBlock } from './lib/adapters.mjs';
import { inspectHost } from './lib/preflight.mjs';
import { transactionalWrite } from './lib/setup.mjs';
import { createEvidence, validateCompletion } from './lib/completion.mjs';

const HOME_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '<!-- universal-agent-team:begin -->';
const END = '<!-- universal-agent-team:end -->';
const ROLES = ['lead', 'requirements', 'researcher', 'frontend', 'backend', 'tester', 'product_reviewer'];
const RECORDS = ['BRIEF', 'PLAN', 'CONTRACT', 'DECISIONS', 'VERIFICATION', 'REVIEW', 'HANDOFF'];
const LOCAL = '.agent-team/local.json';
const CODEX_DEFAULT = '# Permissions and models inherit from the host.\n[agents]\nenabled = true\nmax_concurrent_threads_per_session = 3\n';
const SHARED = [
  '.agent-team/team.json', '.agent-team/ENTRYPOINT.md', '.agent-team/README.md',
  '.agent-team/WORKFLOW.md', '.agent-team/PERMISSIONS.md', '.agent-team/START.md',
  '.agent-team/COMPLETION.md', '.agent-team/ADAPTERS.md',
  ...ROLES.map(role => `.agent-team/roles/${role}.md`),
  ...RECORDS.map(name => `.agent-team/templates/${name}.md`), '.agent-team/templates/completion.json',
  'scripts/team.mjs', 'scripts/lib/adapters.mjs', 'scripts/lib/preflight.mjs',
  'scripts/lib/setup.mjs', 'scripts/lib/completion.mjs',
  'scripts/vendor/smol-toml.cjs', 'scripts/vendor/LICENSE-smol-toml', 'scripts/vendor/smol-toml.PROVENANCE.md',
];

const normalize = value => value.replace(/\r\n/g, '\n');
function exists(filename) {
  try { fs.lstatSync(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function repository(input) {
  const root = fs.realpathSync(path.resolve(input));
  if (!fs.statSync(root).isDirectory()) throw new Error(`Not a project directory: ${input}`);
  return root;
}
function safePath(root, relative) {
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error('Use a project-relative path.');
  const filename = path.resolve(root, relative), local = path.relative(root, filename);
  if (!local || local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) throw new Error(`Path escapes the project: ${relative}`);
  let current = root;
  const parts = local.split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    if (!exists(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked project path: ${relative}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Expected a directory: ${current}`);
    if (i === parts.length - 1 && !stat.isFile()) throw new Error(`Expected a regular file: ${current}`);
  }
  return filename;
}
function read(root, relative) { return normalize(fs.readFileSync(safePath(root, relative), 'utf8')); }
function readIf(root, relative) { return exists(safePath(root, relative)) ? read(root, relative) : ''; }
function host(value) {
  if (!HOSTS.includes(value)) throw new Error(`Unsupported host: ${value}. Choose ${HOSTS.join(', ')}. Local-model runners are out of scope.`);
  return value;
}
function preference(root) {
  if (!exists(safePath(root, LOCAL))) return null;
  let value;
  try { value = JSON.parse(read(root, LOCAL)); }
  catch { console.warn('Setup note: invalid local cache ignored; select the host to rebuild this generated cache.'); return null; }
  if (!value || value.version !== 1 || !HOSTS.includes(value.host)) {
    console.warn('Setup note: incompatible local cache ignored; select the host to rebuild it.');
    return null;
  }
  return value;
}
function selection(root, explicit) {
  if (explicit) return { host: host(explicit), reason: 'explicit host selection' };
  if (process.env.AGENT_TEAM_HOST) return { host: host(process.env.AGENT_TEAM_HOST), reason: 'AGENT_TEAM_HOST selection' };
  const saved = preference(root);
  if (saved) return { host: saved.host, reason: 'saved preference; not proof of the current running tool' };
  return null;
}
function mergeEntry(existing, desired, label) {
  existing = normalize(existing); desired = normalize(desired).trim();
  const starts = existing.split(BEGIN).length - 1, ends = existing.split(END).length - 1;
  if (starts !== ends || starts > 1 || (starts && existing.indexOf(END) < existing.indexOf(BEGIN))) throw new Error(`${label}: malformed or repeated team markers.`);
  if (!starts) return `${existing}${existing.trim() ? '\n\n' : ''}${desired}\n`;
  return existing.slice(0, existing.indexOf(BEGIN)) + desired + existing.slice(existing.indexOf(END) + END.length);
}
function checkFiles(root, selected) {
  for (const relative of SHARED) read(root, relative);
  for (const item of generateAdapters(root).filter(item => !selected || item.host === selected)) {
    if (read(root, item.relative) !== item.text) throw new Error(`Stale generated adapter: ${item.relative}. Run build after editing shared roles.`);
  }
  for (const id of selected ? [selected] : HOSTS) {
    const relative = HOST_SPECS[id].entry, current = read(root, relative);
    if (!current.includes(BEGIN) || mergeEntry(current, entryBlock(root, id), relative) !== current) throw new Error(`${relative}: missing or stale team entry. Run build.`);
  }
}
function inspect(root, selected) {
  checkFiles(root, selected);
  const result = inspectHost(root, selected);
  for (const warning of result.warnings) console.warn(`Setup note: ${warning}`);
  return result;
}
function build(root) {
  const items = generateAdapters(root);
  for (const id of HOSTS) {
    const relative = HOST_SPECS[id].entry;
    items.push({ relative, text: mergeEntry(readIf(root, relative), entryBlock(root, id), relative) });
  }
  if (!exists(safePath(root, '.codex/config.toml'))) items.push({ relative: '.codex/config.toml', text: CODEX_DEFAULT });
  transactionalWrite(root, items);
  console.log('Built 21 native definitions and three tool entry points from seven shared roles.');
}
function install(source, target, selected) {
  checkFiles(source);
  if (source === target) throw new Error('Choose a different existing project as the installation target.');
  const items = SHARED.map(relative => ({ relative, text: read(source, relative) })).concat(generateAdapters(source));
  const pending = [], conflicts = [];
  for (const item of items) {
    if (!exists(safePath(target, item.relative))) pending.push(item);
    else if (read(target, item.relative) !== item.text) conflicts.push(item.relative);
  }
  for (const id of HOSTS) {
    const relative = HOST_SPECS[id].entry, before = readIf(target, relative);
    if (before.includes('<!-- agent-team:begin -->')) throw new Error(`${relative}: an older Codex team is already installed. Migrate its customized files explicitly; nothing was written.`);
    const after = mergeEntry(before, entryBlock(source, id), relative);
    if (before.includes(BEGIN) && before !== after) conflicts.push(`${relative} (customized team section)`);
    else if (before !== after) pending.push({ relative, text: after });
  }
  if (!exists(safePath(target, '.codex/config.toml'))) pending.push({ relative: '.codex/config.toml', text: CODEX_DEFAULT });
  if (conflicts.length) throw new Error(`Installation conflicts; nothing was written:\n${conflicts.map(value => `  ${value}`).join('\n')}\nPreserve your customizations and resolve these differences manually.`);
  if (selected) {
    const checked = inspectHost(target, selected, { files: new Map(pending.map(item => [item.relative, item.text])) });
    for (const warning of checked.warnings) console.warn(`Setup note: ${warning}`);
    pending.push({ relative: LOCAL, text: JSON.stringify({ version: 1, host: selected, fingerprint: null, liveVerified: false }, null, 2) + '\n' });
  }
  // Every destination (including optional preferences) is validated before writes.
  for (const item of pending) safePath(target, item.relative);
  transactionalWrite(target, pending);
  console.log(`Installed ready-made adapters for Codex, Claude Code, and Antigravity into ${target}.`);
  console.log(`Wrote ${pending.length} files. Existing settings and unrelated instructions were preserved.`);
  console.log('Open this project in your chosen tool and give the lead your idea. Its entry point selects the host.');
  console.log('Installation makes no model requests and does not claim live delegation is verified.');
}
function initialize(root) {
  const items = [...RECORDS.map(name => ({ relative: `.agent-team/work/${name}.md`, template: `.agent-team/templates/${name}.md` })),
    { relative: '.agent-team/work/completion.json', template: '.agent-team/templates/completion.json' }];
  const missing = items.filter(item => !exists(safePath(root, item.relative)))
    .map(item => ({ relative: item.relative, text: read(root, item.template) }));
  safePath(root, '.agent-team/work/reports/.ownership-check');
  transactionalWrite(root, missing);
  fs.mkdirSync(path.join(root, '.agent-team/work/reports'), { recursive: true });
  return missing.length;
}
function setup(root, selected) {
  const checked = inspect(root, selected), saved = preference(root);
  if (saved?.host === selected && saved.fingerprint === checked.fingerprint) {
    // Still initialize missing records on resume without resetting existing work.
    const added = initialize(root);
    console.log(`Setup current for ${selected}; reused saved selection. ${added} missing records created.`);
    console.log('Static checks only. Use the actual host tools to confirm independent delegation on the first useful task.');
    return;
  }
  const added = initialize(root);
  transactionalWrite(root, [{ relative: LOCAL, text: JSON.stringify({ version: 1, host: selected, fingerprint: checked.fingerprint, liveVerified: false }, null, 2) + '\n' }]);
  console.log(`Setup ready for ${selected}: ${added} missing records created; selection saved locally.`);
  console.log('No model requests, package installs, or global configuration changes. Confirm live delegation with a useful assignment.');
}
function doctor(root, selected) {
  inspect(root, selected);
  console.log(`Static checks passed for ${selected}. Live agent loading/delegation: NOT VERIFIED.`);
  const command = HOST_SPECS[selected].command;
  try {
    const version = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${command} --version`], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : execFileSync(command, ['--version'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`Local CLI: ${version.trim()}`);
    const legacy = version.match(/\b0\.(\d+)\./);
    if (selected === 'codex' && legacy && Number(legacy[1]) <= 25) {
      console.error('This legacy Codex CLI cannot run the current native-agent configuration. Use a current agent-capable host.');
      process.exitCode = 1;
    }
  } catch { console.log(`No usable ${command} CLI detected. An app may still work; validate inside the intended host.`); }
}
function parse(args) {
  const command = args.shift() ?? 'help';
  const allowed = {
    help: [], build: ['repo'], install: ['target', 'host'], setup: ['repo', 'host'],
    check: ['repo', 'host'], detect: ['repo', 'host'], doctor: ['repo', 'host'],
    init: ['repo'], verify: ['repo'], evidence: ['repo', 'file'], prompt: ['repo', 'host', 'idea', 'idea-file'],
  };
  if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown command: ${command}`);
  const options = {};
  while (args.length) {
    const flag = args.shift(), key = flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed[command].includes(key) || Object.hasOwn(options, key)) throw new Error(`Invalid or repeated option: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[key] = value;
  }
  if (options.host) host(options.host);
  return { command, options };
}
function main() {
  const { command, options } = parse(process.argv.slice(2)), root = repository(options.repo ?? HOME_REPO);
  const selected = ['setup', 'doctor', 'detect', 'prompt', 'check'].includes(command) ? selection(root, options.host) : null;
  switch (command) {
    case 'build': build(root); break;
    case 'install':
      if (!options.target) throw new Error('Provide --target with an existing project directory.');
      install(root, repository(options.target), options.host); break;
    case 'setup': case 'doctor':
      if (!selected) throw new Error('No active tool identified. Open the project in your tool or select once with --host codex|claude|antigravity. Installed files do not identify a running tool.');
      command === 'setup' ? setup(root, selected.host) : doctor(root, selected.host); break;
    case 'check':
      if (selected) { inspect(root, selected.host); console.log(`Adapter and local static checks passed for ${selected.host}.`); }
      else { checkFiles(root); console.log('All 21 adapter definitions and three entry points match the shared roles. No running host selected or verified.'); }
      break;
    case 'detect':
      console.log(JSON.stringify({ ...selected, supported: HOSTS, liveVerified: false,
        note: selected ? 'Selection is a hint. The actual host must verify delegation.' : 'No active tool identified. Native entry points supply --host; available files/installed tools are not runtime evidence.' }, null, 2));
      break;
    case 'init': console.log(`Created ${initialize(root)} missing project records; existing work preserved.`); break;
    case 'verify': console.log(validateCompletion(root)); break;
    case 'evidence':
      if (!options.file) throw new Error('Provide --file with a project-relative evidence path.');
      console.log(JSON.stringify(createEvidence(root, options.file), null, 2)); break;
    case 'prompt': {
      if (Boolean(options.idea) === Boolean(options['idea-file'])) throw new Error('Provide exactly one of --idea or --idea-file.');
      const idea = options.idea ?? fs.readFileSync(path.resolve(options['idea-file']), 'utf8');
      if (!idea.trim()) throw new Error('The project idea is empty.');
      console.log(`${selected ? `Use the ${selected.host} adapter; run node scripts/team.mjs setup --host ${selected.host}.\n\n` : ''}${read(root, '.agent-team/START.md').trim()}\n\nProject idea:\n\n${idea.trim()}\n`); break;
    }
    default: console.log(`Universal Agent Team (Node.js22+, no package installation)

New project: open this repository in Codex, Claude Code, or Antigravity and give your idea.
Existing project: node scripts/team.mjs install --target <existing-project> [--host <tool>]
Setup: node scripts/team.mjs setup --host codex|claude|antigravity [--repo <project>]
Inspect: node scripts/team.mjs detect|check|doctor [--host <tool>] [--repo <project>]
Project records: node scripts/team.mjs init|verify [--repo <project>]
Evidence: node scripts/team.mjs evidence --file <relative-file> [--repo <project>]
Kickoff: node scripts/team.mjs prompt --idea <idea> [--host <tool>]
Rebuild generated files: node scripts/team.mjs build

Native hosts execute the team. This tool performs local setup and validation only.
Ollama/local-model runners are not included.`);
  }
}
try { main(); }
catch (error) { console.error(`Team setup: ${error.message}`); process.exitCode = 1; }
