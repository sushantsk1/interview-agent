import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { validateActivation } from './setup.mjs';

const HOSTS = ['codex', 'claude', 'antigravity'];
const BEGIN = '<!-- universal-agent-team:begin -->';
const END = '<!-- universal-agent-team:end -->';
const ROLE_NAMES = ['lead', 'requirements', 'researcher', 'frontend', 'backend', 'tester', 'product-reviewer'];
const SPECIALISTS = ROLE_NAMES.filter(name => name !== 'lead');
const SPEC = {
  codex: { entry: 'AGENTS.md', directory: '.codex/agents', extension: 'toml' },
  claude: { entry: 'CLAUDE.md', directory: '.claude/agents', extension: 'md' },
  antigravity: { entry: 'GEMINI.md', directory: '.agents/agents', extension: 'md' },
};

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exists(filename) {
  try { fs.lstatSync(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function relativePath(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
    throw new Error('Preflight paths must be repository-relative.');
  }
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').some(part => part === '..' || !part)) {
    throw new Error(`Invalid preflight path: ${relative}`);
  }
  return normalized;
}

function safeLocation(root, relative, directory = false) {
  relative = relativePath(relative);
  const filename = path.resolve(root, relative);
  const local = path.relative(root, filename);
  if (!local || local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
    throw new Error(`Preflight path escapes the repository: ${relative}`);
  }
  let cursor = root;
  const parts = local.split(path.sep);
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]);
    if (!exists(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked preflight path: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`Expected a directory in preflight path: ${relative}`);
    if (index === parts.length - 1 && (directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Expected a ${directory ? 'directory' : 'regular file'}: ${relative}`);
    }
  }
  return filename;
}

function plannedFiles(files) {
  if (files === undefined) return new Map();
  if (!(files instanceof Map) && !object(files)) throw new Error('Preflight options.files must be a Map or plain object.');
  const result = new Map();
  for (const [relative, value] of files instanceof Map ? files : Object.entries(files)) {
    const normalized = relativePath(relative);
    if (typeof value !== 'string') throw new Error(`Planned preflight content must be text: ${relative}`);
    result.set(normalized, value);
  }
  return result;
}

function globMatches(pattern, value) {
  const expression = pattern.split('*').map(part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*');
  return new RegExp(`^${expression}$`).test(value);
}

function blockedDelegation(rule) {
  const match = /^([^()]+)(?:\((.*)\))?$/.exec(rule.trim());
  if (!match) return false;
  const [, tool, argument] = match;
  if (!['Agent', 'Task'].some(name => globMatches(tool, name))) return false;
  if (argument === undefined) return true;
  // Parameter-scoped rules such as Agent(model:opus) do not block every call.
  if (argument.includes(':')) return false;
  return SPECIALISTS.some(name => globMatches(argument, name) || globMatches(argument, name.replaceAll('-', '_')));
}

function claudeSettings(text, relative, warnings) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`Invalid JSON in ${relative}. Fix the existing settings; preflight does not replace them.`); }
  if (!object(value)) throw new Error(`${relative} must contain a JSON object.`);
  if (value.permissions !== undefined) {
    if (!object(value.permissions)) throw new Error(`${relative}: permissions must be an object.`);
    for (const name of ['allow', 'ask', 'deny']) {
      const rules = value.permissions[name];
      if (rules !== undefined && (!Array.isArray(rules) || rules.some(rule => typeof rule !== 'string'))) {
        throw new Error(`${relative}: permissions.${name} must be an array of strings.`);
      }
    }
    if ((value.permissions.deny ?? []).some(blockedDelegation)) {
      throw new Error(`${relative} denies delegation to one or more team specialists. Review its Agent/Task deny rules before starting the team.`);
    }
    if (value.permissions.defaultMode === 'plan') warnings.push(`${relative} defaults to plan mode; confirm the active session permits implementation before assigning developers.`);
    if ((value.permissions.deny ?? []).some(rule => /^(?:Agent|Task)\([^)]*:[^)]*\)$/.test(rule))) {
      warnings.push(`${relative} contains parameter-scoped delegation restrictions; verify the selected models and invocation options in the active host.`);
    }
  }
}

/**
 * Read-only checks of observable project activation settings. No host/model
 * process is started, and no result here authenticates live delegation.
 * options.files overlays planned text for transactional installation preflight.
 */
export function inspectHost(inputRoot, host, options = {}) {
  if (!HOSTS.includes(host)) throw new Error(`Unsupported host: ${host}. Choose codex, claude, or antigravity; local-model runners are out of scope.`);
  const root = fs.realpathSync(path.resolve(inputRoot));
  if (!fs.statSync(root).isDirectory()) throw new Error('Preflight root must be an existing directory.');
  const planned = plannedFiles(options.files);
  const seen = new Map();
  const warnings = [];
  const read = relative => {
    relative = relativePath(relative);
    const filename = safeLocation(root, relative);
    const value = planned.has(relative) ? planned.get(relative)
      : exists(filename) ? fs.readFileSync(filename, 'utf8') : null;
    seen.set(relative, value);
    return value;
  };
  const readDirectoryRules = relative => {
    const directory = safeLocation(root, relative, true);
    const names = exists(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.md')) : [];
    for (const key of planned.keys()) {
      if (path.posix.dirname(key) === relative && key.endsWith('.md')) names.push(path.posix.basename(key));
    }
    for (const name of [...new Set(names)].sort()) read(`${relative}/${name}`);
    seen.set(`${relative}/<inventory>`, [...new Set(names)].sort().join('\n'));
  };

  const spec = SPEC[host];
  const entry = read(spec.entry);
  if (!entry?.trim()) throw new Error(`Missing or empty ${spec.entry}; install the ${host} entry point before starting the team.`);
  if (entry.indexOf(BEGIN) < 0 || entry.indexOf(END) < entry.indexOf(BEGIN)) {
    throw new Error(`${spec.entry} does not contain the complete universal team entry point. Install or rebuild the managed instructions before starting the team.`);
  }
  for (const relative of [
    '.agent-team/team.json', '.agent-team/ENTRYPOINT.md', '.agent-team/WORKFLOW.md',
    '.agent-team/PERMISSIONS.md', '.agent-team/COMPLETION.md', '.agent-team/START.md',
    ...ROLE_NAMES.map(name => `.agent-team/roles/${name.replaceAll('-', '_')}.md`),
    ...ROLE_NAMES.map(name => `${spec.directory}/${name}.${spec.extension}`),
  ]) read(relative);

  if (host === 'codex') {
    read('AGENTS.override.md');
    const config = read('.codex/config.toml');
    const result = validateActivation(root, entry, config ?? '', { codexHome: options.codexHome });
    warnings.push(...result.warnings);
    if (config === null) warnings.push('No project Codex config is present; delegation settings are inherited and must be confirmed in the active host.');
    const home = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    // Only instruction documents are fingerprinted. Never read global account,
    // model-provider, permission, or credential configuration files here.
    for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
      const filename = path.join(home, name);
      try {
        if (!exists(filename)) { seen.set(`<codex-home>/${name}`, null); continue; }
        if (fs.lstatSync(filename).isSymbolicLink()) { seen.set(`<codex-home>/${name}`, '<linked>'); continue; }
        seen.set(`<codex-home>/${name}`, fs.readFileSync(filename, 'utf8'));
      } catch { seen.set(`<codex-home>/${name}`, '<unreadable>'); }
    }
  } else if (host === 'claude') {
    for (const relative of ['.claude/settings.json', '.claude/settings.local.json']) {
      const text = read(relative);
      if (text !== null) claudeSettings(text, relative, warnings);
    }
    for (const relative of ['CLAUDE.local.md', '.claude/CLAUDE.md']) read(relative);
    readDirectoryRules('.claude/rules');
    if (Buffer.byteLength(entry, 'utf8') > 32768) {
      warnings.push('CLAUDE.md is large (over 32 KiB). This is an advisory size threshold, not a claimed Claude limit; keep bootstrap instructions small and verify loading.');
    }
    warnings.push('Claude local project settings were checked. Global/managed/session restrictions, instruction exclusions/imports, nested rules, trust, and actual Agent-tool availability remain unverified.');
  } else {
    for (const relative of ['AGENTS.md', '.agents/AGENTS.md', '.agents/GEMINI.md']) read(relative);
    readDirectoryRules('.agents/rules');
    readDirectoryRules('.agent/rules');
    warnings.push('Antigravity workspace entry points and rules were fingerprinted. Global settings, project UI permissions, rule-budget demotion, installed tool names, trust, and live subagent availability remain unverified; no undocumented project settings file was assumed.');
  }
  warnings.push('Static inspection does not verify live delegation. Confirm an independent worker and the required editing/testing tools in the active session before claiming the team is operational.');
  const values = [...seen.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const fingerprint = createHash('sha256').update(JSON.stringify({ version: 1, host, files: values })).digest('hex');
  return { warnings: [...new Set(warnings)], fingerprint, liveVerified: false };
}
