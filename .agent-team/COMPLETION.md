# Completion evidence

Before announcing a complete delivery, the lead must run:

```powershell
node scripts/team.mjs verify
```

`init` creates `.agent-team/work/completion.json` in an incomplete state. The lead
owns it and collects the specialists' actual evidence. Do not convert failed or
unavailable checks to passed to satisfy the validator.

## Record fields

The record uses `version: 1`:

| Field | Required content |
| --- | --- |
| originalRequest | Original request text and hashed BRIEF.md evidence |
| roster | Every role's distinct real agentId, or an explicit omittedReason for an inapplicable specialist |
| sourceSnapshot | Every delivered source/config/test file with SHA-256 hashes |
| tasks | Done tasks with id, owner role, acceptanceIds, and hashed report |
| criteria | Every AC ID in BRIEF.md, status passed, and supporting checkIds |
| checks | Passed checks, exact command or manual steps, workingDirectory, observedResult, performedBy, evidence, sourceSnapshotSha256 |
| defects | Blocking findings must be resolved with resolutionEvidence |
| review | Accept decision, reviewedBy, current sourceSnapshotSha256, hashed REVIEW.md evidence |
| handoff | Actual runInstructions and hashed HANDOFF.md evidence |

Lead, tester, and product_reviewer must always be present. At least one developer
is required. Tester and reviewer must be distinct from authors and each other.
Each acceptance criterion needs a passed check performed by the tester.

Evidence references are `{ "path": "src/server.js", "sha256": "<64 hex digits>" }`.
Generate one with `node scripts/team.mjs evidence --file src/server.js`. Paths
are relative to the project root. External, linked, missing, empty, changed, and
stale evidence is rejected. Never include credentials as evidence.

## Entry shapes

Replace these examples with actual results:

```json
{
  "task": {
    "id": "T-003", "owner": "backend", "status": "done",
    "acceptanceIds": ["AC-001"],
    "report": { "path": ".agent-team/work/reports/T-003.md", "sha256": "..." }
  },
  "check": {
    "id": "CHK-001", "status": "passed", "kind": "command",
    "command": "node --test", "workingDirectory": ".",
    "observedResult": "Actual test counts and outcomes",
    "performedBy": "actual-tester-agent-id",
    "sourceSnapshotSha256": "...",
    "evidence": [{ "path": "validation/test-output.txt", "sha256": "..." }]
  },
  "criterion": { "id": "AC-001", "status": "passed", "checkIds": ["CHK-001"] },
  "review": {
    "decision": "accept", "reviewedBy": "actual-reviewer-agent-id",
    "sourceSnapshotSha256": "...",
    "evidence": [{ "path": ".agent-team/work/REVIEW.md", "sha256": "..." }]
  }
}
```

For a manual check use `kind: "manual"` and nonempty `steps` instead of `command`.
Each task report must use `.agent-team/work/reports/<T-ID>.md`. A blocking defect
uses `blocking: true`, `status: "resolved"`, and nonempty `resolutionEvidence`.

Capture delivered files and their shared fingerprint when testing:

```javascript
import { createEvidence, snapshotDigest } from './scripts/lib/completion.mjs';
const sourceSnapshot = ['src/server.js', 'public/index.html']
  .map(file => createEvidence(process.cwd(), file));
const sourceSnapshotSha256 = snapshotDigest(sourceSnapshot);
```

Checks and review must record the same source fingerprint. After code changes,
take a new snapshot, rerun affected checks, and recheck affected review findings.
Do not refresh old hashes as a substitute for retesting. On resume, inspect the
record and actual code, preserving existing results and identifying stale ones.

## Boundary

`verify` checks fields, coverage, file hashes, snapshot consistency, declared role
separation, findings, and approval. It never executes commands from the JSON.
Agent identities and reported outcomes remain attestations. It cannot discover
an omitted requirement/source file, authenticate execution, certify correctness,
prevent a false assertion, or enforce the host's final chat response.

`check` validates setup; `verify` validates delivery evidence. Neither replaces
actual tests or independent product review.
