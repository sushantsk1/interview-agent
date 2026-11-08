import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const WORK = '.agent-team/work/';
const ROLES = ['lead', 'requirements', 'researcher', 'frontend', 'backend', 'tester', 'product_reviewer'];
const REQUIRED_ROLES = ['lead', 'tester', 'product_reviewer'];
const fail = message => { throw new Error(`Completion gate: ${message}`); };

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()
      || /^(?:pending|todo|tbd|not (?:run|started)|unknown|replace(?: me)?|<[^>]*>)$/i.test(value.trim())) {
    fail(`${label} must contain a real value, not an empty field or placeholder.`);
  }
  return value.trim();
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function list(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) fail(`${label} must be ${allowEmpty ? 'an' : 'a nonempty'} array.`);
  return value;
}

function location(root, relative, directory = false) {
  text(relative, 'Evidence path');
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) fail(`Use a repository-relative path: ${relative}`);
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) fail(`Parent traversal is not allowed: ${relative}`);
  if (normalized.split('/').some(part => part.toLowerCase() === '.git')) fail(`Git internals cannot be delivery evidence: ${relative}`);
  const filename = path.resolve(root, normalized);
  const local = path.relative(root, filename);
  if ((!directory && !local) || local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
    fail(`Path escapes the repository: ${relative}`);
  }
  let cursor = root;
  for (const part of local.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) { if (error.code === 'ENOENT') fail(`Missing evidence path: ${relative}`); throw error; }
    if (stat.isSymbolicLink()) fail(`Linked paths are not allowed as evidence: ${relative}`);
  }
  const stat = fs.statSync(filename);
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail(`Expected a ${directory ? 'directory' : 'regular file'}: ${relative}`);
  return { filename, relative: local.split(path.sep).join('/') };
}

function repository(input) {
  const root = fs.realpathSync(input);
  if (!fs.statSync(root).isDirectory()) fail('Repository root must be a directory.');
  return root;
}

/** Produce an evidence reference without running any command or changing files. */
export function createEvidence(input, relative) {
  const root = repository(input);
  const item = location(root, relative);
  if (item.relative.toLowerCase() === `${WORK}completion.json`) fail('completion.json cannot be evidence for itself.');
  return { path: item.relative, sha256: createHash('sha256').update(fs.readFileSync(item.filename)).digest('hex') };
}

/** Stable fingerprint to record on checks and review after capturing delivered sources. */
export function snapshotDigest(refs) {
  list(refs, 'sourceSnapshot');
  const normalized = refs.map((ref, i) => {
    object(ref, `sourceSnapshot[${i}]`);
    const relative = text(ref.path, `sourceSnapshot[${i}].path`).replaceAll('\\', '/');
    if (!/^[a-f\d]{64}$/.test(ref.sha256)) fail(`sourceSnapshot[${i}].sha256 must be a lowercase SHA-256 digest.`);
    return { path: relative, sha256: ref.sha256 };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(normalized.map(ref => ref.path)).size !== normalized.length) fail('sourceSnapshot contains duplicate paths.');
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function evidence(root, ref, label, canonical) {
  object(ref, label);
  const actual = createEvidence(root, ref.path);
  if (canonical && actual.path !== canonical) fail(`${label} must reference ${canonical}.`);
  if (!/^[a-f\d]{64}$/.test(ref.sha256)) fail(`${label}.sha256 must contain the recorded SHA-256 digest.`);
  if (actual.sha256 !== ref.sha256) fail(`${label} is stale: ${actual.path} changed. Rerun affected checks or review, then refresh evidence.`);
  if (fs.statSync(location(root, actual.path).filename).size === 0) fail(`${label} points to an empty file: ${actual.path}`);
  return actual;
}

function evidenceList(root, refs, label) {
  return list(refs, label).map((ref, i) => evidence(root, ref, `${label}[${i}]`));
}

function indexed(items, label, expression) {
  const values = new Map();
  for (const item of list(items, label)) {
    object(item, `${label} item`);
    if (typeof item.id !== 'string' || !expression.test(item.id)) fail(`${label} has an invalid ID: ${item.id}`);
    if (values.has(item.id)) fail(`${label} contains duplicate ID ${item.id}.`);
    values.set(item.id, item);
  }
  return values;
}

/** Validate recorded delivery evidence. Agent IDs and execution outcomes remain attestations. */
export function validateCompletion(input) {
  const root = repository(input);
  const manifestPath = location(root, `${WORK}completion.json`);
  let delivery;
  try { delivery = JSON.parse(fs.readFileSync(manifestPath.filename, 'utf8')); }
  catch { fail('completion.json is not valid JSON.'); }
  object(delivery, 'completion.json');
  if (delivery.version !== 1) fail('completion.json must use version 1.');

  object(delivery.originalRequest, 'originalRequest');
  const originalRequest = text(delivery.originalRequest.text, 'originalRequest.text');
  evidence(root, delivery.originalRequest.evidence, 'originalRequest.evidence', `${WORK}BRIEF.md`);
  const brief = fs.readFileSync(location(root, `${WORK}BRIEF.md`).filename, 'utf8');
  if (!brief.replaceAll('\r\n', '\n').includes(originalRequest.replaceAll('\r\n', '\n'))) {
    fail('BRIEF.md must include the recorded original request.');
  }
  const briefIds = new Set(brief.match(/\bAC-\d{3,}\b/g) ?? []);
  if (!briefIds.size) fail('BRIEF.md must define at least one AC-001-style acceptance criterion.');

  object(delivery.roster, 'roster');
  const ids = new Set();
  for (const role of ROLES) {
    const worker = object(delivery.roster[role], `roster.${role}`);
    if (Object.hasOwn(worker, 'omittedReason')) {
      if (REQUIRED_ROLES.includes(role)) fail(`The ${role} role cannot be omitted.`);
      text(worker.omittedReason, `roster.${role}.omittedReason`);
      if (worker.agentId) fail(`roster.${role} cannot be both active and omitted.`);
    } else {
      const id = text(worker.agentId, `roster.${role}.agentId`);
      if (ROLES.includes(id)) fail(`roster.${role}.agentId must be a runtime identifier, not a role name.`);
      if (ids.has(id)) fail(`Agent ${id} is assigned multiple roles; independent roles need distinct runtime identifiers.`);
      ids.add(id);
    }
  }
  if (!delivery.roster.frontend.agentId && !delivery.roster.backend.agentId) fail('At least one frontend or backend implementation role is required.');

  const sourceRefs = evidenceList(root, delivery.sourceSnapshot, 'sourceSnapshot');
  if (sourceRefs.some(ref => ref.path.toLowerCase().startsWith(WORK))) fail('sourceSnapshot must describe delivered files, not mutable project reports.');
  const fingerprint = snapshotDigest(sourceRefs);
  const criteria = indexed(delivery.criteria, 'criteria', /^AC-\d{3,}$/);
  const missing = [...briefIds].filter(id => !criteria.has(id));
  const unexpected = [...criteria.keys()].filter(id => !briefIds.has(id));
  if (missing.length || unexpected.length) fail(`Acceptance coverage must match BRIEF.md. Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`);

  const checks = indexed(delivery.checks, 'checks', /^CHK-\d{3,}$/);
  for (const [id, check] of checks) {
    if (check.status !== 'passed') fail(`${id} has not passed (status: ${check.status}).`);
    if (check.sourceSnapshotSha256 !== fingerprint) fail(`${id} does not attest to the current source snapshot. Rerun the check.`);
    if (!ids.has(check.performedBy)) fail(`${id}.performedBy must identify an active roster agent.`);
    if (check.kind === 'command') text(check.command, `${id}.command`);
    else if (check.kind === 'manual') text(check.steps, `${id}.steps`);
    else fail(`${id}.kind must be command or manual.`);
    location(root, text(check.workingDirectory, `${id}.workingDirectory`), true);
    text(check.observedResult, `${id}.observedResult`);
    evidenceList(root, check.evidence, `${id}.evidence`);
  }
  for (const [id, criterion] of criteria) {
    if (criterion.status !== 'passed') fail(`${id} has not passed (status: ${criterion.status}).`);
    const relevant = list(criterion.checkIds, `${id}.checkIds`).map(checkId => {
      if (!checks.has(checkId)) fail(`${id} refers to unknown check ${checkId}.`);
      return checks.get(checkId);
    });
    if (!relevant.some(check => check.performedBy === delivery.roster.tester.agentId)) {
      fail(`${id} needs at least one independently performed tester check.`);
    }
  }

  const tasks = indexed(delivery.tasks, 'tasks', /^T-\d{3,}$/);
  const taskCriteria = new Set();
  let hasImplementation = false;
  for (const [id, task] of tasks) {
    if (task.status !== 'done') fail(`${id} is not done (status: ${task.status}).`);
    if (!ROLES.includes(task.owner) || !delivery.roster[task.owner].agentId) fail(`${id}.owner must be an active roster role.`);
    if (['frontend', 'backend'].includes(task.owner)) hasImplementation = true;
    evidence(root, task.report, `${id}.report`, `${WORK}reports/${id}.md`);
    for (const acceptanceId of list(task.acceptanceIds, `${id}.acceptanceIds`)) {
      if (!criteria.has(acceptanceId)) fail(`${id} refers to unknown criterion ${acceptanceId}.`);
      taskCriteria.add(acceptanceId);
    }
  }
  if (!hasImplementation) fail('At least one completed frontend or backend task is required.');
  for (const id of criteria.keys()) if (!taskCriteria.has(id)) fail(`${id} has no completed task coverage.`);

  const defectIds = new Set();
  for (const defect of list(delivery.defects, 'defects', true)) {
    object(defect, 'defect');
    const id = text(defect.id, 'defect.id');
    if (defectIds.has(id)) fail(`Duplicate defect ID ${id}.`);
    defectIds.add(id);
    if (typeof defect.blocking !== 'boolean') fail(`${id}.blocking must be true or false.`);
    if (defect.blocking && defect.status !== 'resolved') fail(`Blocking defect ${id} remains unresolved.`);
    if (defect.status === 'resolved') evidenceList(root, defect.resolutionEvidence, `${id}.resolutionEvidence`);
    else if (defect.status === 'open' && !defect.blocking) text(defect.disposition, `${id}.disposition`);
    else fail(`${id}.status must be resolved, or open with a nonblocking disposition.`);
  }

  object(delivery.review, 'review');
  if (delivery.review.decision !== 'accept') fail('Product review must have an accept decision.');
  if (delivery.review.reviewedBy !== delivery.roster.product_reviewer.agentId) fail('review.reviewedBy must identify the independent product reviewer.');
  if (delivery.review.sourceSnapshotSha256 !== fingerprint) fail('Product review does not attest to the current source snapshot. Repeat affected review.');
  const reviewRefs = evidenceList(root, delivery.review.evidence, 'review.evidence');
  if (!reviewRefs.some(ref => ref.path === `${WORK}REVIEW.md`)) fail('review.evidence must include .agent-team/work/REVIEW.md.');

  object(delivery.handoff, 'handoff');
  const instructions = text(delivery.handoff.runInstructions, 'handoff.runInstructions');
  evidence(root, delivery.handoff.evidence, 'handoff.evidence', `${WORK}HANDOFF.md`);
  const handoff = fs.readFileSync(location(root, `${WORK}HANDOFF.md`).filename, 'utf8');
  if (!handoff.replaceAll('\r\n', '\n').includes(instructions.replaceAll('\r\n', '\n'))) fail('HANDOFF.md must include the recorded run instructions.');

  return `Completion checks passed: ${criteria.size} acceptance criteria, ${checks.size} checks, independent tester and reviewer, and current evidence snapshots. Agent identities and execution outcomes remain attestations.`;
}
