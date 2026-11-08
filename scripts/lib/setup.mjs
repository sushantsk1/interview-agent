import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import TOML from '../vendor/smol-toml.cjs';

const BEGIN = '<!-- universal-agent-team:begin -->';
const END = '<!-- universal-agent-team:end -->';
const DEFAULT_INSTRUCTION_LIMIT = 32768;

function exists(api, filename) {
  try { api.lstatSync(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isTable(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function destination(api, root, relative) {
  if (typeof relative !== 'string' || !relative) throw new Error('An output path is required.');
  const filename = path.resolve(root, relative);
  if (!inside(root, filename)) throw new Error(`Output path escapes the repository: ${relative}`);
  let current = root;
  const parts = path.relative(root, filename).split(path.sep);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    if (!exists(api, current)) continue;
    const stat = api.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked output path: ${current}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`Expected a directory: ${current}`);
    if (index === parts.length - 1 && !stat.isFile()) throw new Error(`Expected a regular output file: ${current}`);
  }
  return filename;
}

function configuration(configText) {
  let config;
  try { config = TOML.parse(configText); }
  catch (error) {
    // The parser's full error may contain a source snippet with credentials.
    const line = Number.isInteger(error.line) ? ` near line ${error.line}` : '';
    throw new Error(`Invalid TOML in .codex/config.toml${line}. Fix the configuration before using the team.`);
  }
  if (config.agents !== undefined) {
    if (!isTable(config.agents)) {
      throw new Error('.codex/config.toml: agents must be a table.');
    }
    if (config.agents.enabled !== undefined && typeof config.agents.enabled !== 'boolean') {
      throw new Error('.codex/config.toml: agents.enabled must be true or false.');
    }
    if (config.agents.enabled === false) {
      throw new Error('.codex/config.toml disables agents (agents.enabled = false). Preserve your settings and explicitly enable delegation before using the team.');
    }
    for (const key of ['max_concurrent_threads_per_session', 'max_threads']) {
      const value = config.agents[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
        throw new Error(`.codex/config.toml: agents.${key} must be a positive integer.`);
      }
    }
  }
  if (config.project_doc_max_bytes !== undefined
      && (!Number.isSafeInteger(config.project_doc_max_bytes) || config.project_doc_max_bytes < 1)) {
    throw new Error('.codex/config.toml: project_doc_max_bytes must be a positive integer.');
  }
  if (config.features !== undefined && !isTable(config.features)) {
    throw new Error('.codex/config.toml: features must be a table.');
  }
  if (config.features?.multi_agent !== undefined) {
    if (typeof config.features.multi_agent !== 'boolean') throw new Error('.codex/config.toml: features.multi_agent must be true or false.');
    if (!config.features.multi_agent) throw new Error('.codex/config.toml disables delegation (features.multi_agent = false). Preserve your settings and explicitly enable delegation before using the team.');
  }
  return config;
}

/** Validate observable local activation blockers without changing user files. */
export function validateActivation(root, agentsText, configText, options = {}) {
  const config = configuration(configText);
  const warnings = [];
  const override = path.join(root, 'AGENTS.override.md');
  if (exists(fs, override)) {
    if (fs.lstatSync(override).isSymbolicLink()) throw new Error('AGENTS.override.md is linked; resolve the active instruction source before installing the team.');
    if (fs.readFileSync(override, 'utf8').trim()) {
      throw new Error('AGENTS.override.md hides AGENTS.md. Preserve your instructions and explicitly consolidate the override before installing or checking the team.');
    }
  }
  const start = agentsText.indexOf(BEGIN);
  const end = agentsText.indexOf(END, start);
  if (start < 0 || end < start) throw new Error('The complete team instruction block is missing from AGENTS.md.');

  // Read instruction documents only. Global/profile configuration may contain
  // credentials; effective host settings are deliberately not inspected here.
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  let globalBytes = 0;
  let foundGlobal = false;
  for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
    const filename = path.join(codexHome, name);
    try {
      if (!exists(fs, filename)) continue;
      if (fs.lstatSync(filename).isSymbolicLink()) {
        warnings.push('Global instruction source is linked; its byte contribution could not be verified.');
        break;
      }
      const text = fs.readFileSync(filename, 'utf8');
      if (!text.trim()) continue;
      globalBytes = Buffer.byteLength(text, 'utf8');
      foundGlobal = true;
      break;
    } catch {
      warnings.push('Global instruction source could not be read; its byte contribution is unknown.');
      break;
    }
  }
  const limit = config.project_doc_max_bytes ?? DEFAULT_INSTRUCTION_LIMIT;
  const required = globalBytes + (foundGlobal ? 2 : 0) + Buffer.byteLength(agentsText.slice(0, end + END.length), 'utf8');
  if (required > limit) {
    throw new Error(`The team instruction block requires ${required} bytes of the known instruction chain, exceeding project_doc_max_bytes (${limit}). Shorten/consolidate the active instructions or explicitly adjust the host limit.`);
  }
  warnings.push('Only observable repository settings and known global instruction bytes were checked. Global/profile/managed overrides, trust, nested instructions, and native execution still require verification in the intended host.');
  return { config, warnings };
}

/**
 * Stage all outputs, then publish with rollback on ordinary write/rename failure.
 * A durable recovery journal is retained if rollback itself fails. This is not a
 * claim of crash-atomic multi-file filesystem transactions; do not run competing
 * writers while building/installing the team.
 */
export function transactionalWrite(inputRoot, items, options = {}) {
  const api = options.fs ?? fs;
  const root = api.realpathSync(path.resolve(inputRoot));
  const seen = new Set();
  const outputs = items.map(item => {
    const filename = destination(api, root, item.relative);
    const key = process.platform === 'win32' ? filename.toLowerCase() : filename;
    if (seen.has(key)) throw new Error(`Repeated output path: ${item.relative}`);
    seen.add(key);
    if (typeof item.text !== 'string') throw new Error(`Expected text for ${item.relative}.`);
    const prior = exists(api, filename) ? api.readFileSync(filename) : null;
    const mode = prior === null ? null : api.statSync(filename).mode;
    // Checking mode explicitly catches Windows' read-only attribute even when
    // access tests under a privileged process would otherwise succeed.
    if (mode !== null && !(mode & 0o222)) throw new Error(`Output is read-only: ${item.relative}. No outputs were changed.`);
    if (prior !== null) api.accessSync(filename, fs.constants.W_OK);
    return { ...item, filename, prior, mode };
  }).filter(item => item.prior === null || !item.prior.equals(Buffer.from(item.text, 'utf8')));
  if (!outputs.length) return { written: 0 };

  // Keep staged files and backups on the same volume as all destination files.
  const stage = api.mkdtempSync(path.join(root, '.agent-team-transaction-'));
  const createdDirectories = [];
  const applied = [];
  let keepRecovery = false;
  const removeStage = () => {
    if (!inside(root, stage) || path.dirname(stage) !== root
        || !path.basename(stage).startsWith('.agent-team-transaction-')
        || api.lstatSync(stage).isSymbolicLink()) {
      throw new Error('Invalid transaction cleanup target.');
    }
    api.rmSync(stage, { recursive: true, force: true });
  };
  try {
    for (let index = 0; index < outputs.length; index++) {
      const output = outputs[index];
      api.writeFileSync(path.join(stage, `${index}.new`), output.text, { encoding: 'utf8', flag: 'wx' });
      if (output.prior !== null) api.writeFileSync(path.join(stage, `${index}.backup`), output.prior, { flag: 'wx' });
    }
    api.writeFileSync(path.join(stage, 'recovery.json'), JSON.stringify({
      version: 1,
      outputs: outputs.map((item, index) => ({ relative: item.relative, backup: item.prior === null ? null : `${index}.backup`, mode: item.mode })),
    }, null, 2));
    for (let index = 0; index < outputs.length; index++) {
      const output = outputs[index];
      destination(api, root, output.relative);
      const missing = [];
      for (let current = path.dirname(output.filename); current !== root && !exists(api, current); current = path.dirname(current)) missing.push(current);
      for (const directory of missing.reverse()) { api.mkdirSync(directory); createdDirectories.push(directory); }
      destination(api, root, output.relative);
      if (output.mode !== null) api.chmodSync(path.join(stage, `${index}.new`), output.mode & 0o777);
      api.renameSync(path.join(stage, `${index}.new`), output.filename);
      applied.push(output);
    }
    return { written: outputs.length };
  } catch (error) {
    const recoveryErrors = [];
    for (const output of applied.reverse()) {
      try {
        destination(api, root, output.relative);
        if (output.prior === null) api.unlinkSync(output.filename);
        else {
          // Restore from the backup buffer; preserve the original mode too.
          api.writeFileSync(output.filename, output.prior);
          api.chmodSync(output.filename, output.mode & 0o777);
        }
      } catch { recoveryErrors.push(output.relative); }
    }
    for (const directory of createdDirectories.reverse()) {
      try { api.rmdirSync(directory); }
      catch (cleanupError) { if (!['ENOTEMPTY', 'ENOENT'].includes(cleanupError.code)) recoveryErrors.push(path.relative(root, directory)); }
    }
    if (recoveryErrors.length) {
      keepRecovery = true;
      throw new Error(`Update failed and rollback could not restore: ${recoveryErrors.join(', ')}. Recovery backups are retained at ${stage}. Original failure: ${error.message}`);
    }
    throw new Error(`Update failed; all applied outputs were rolled back. ${error.message}`);
  } finally {
    if (!keepRecovery) removeStage();
  }
}
