# SARIF Output

mako emits trust reasons, alignment diagnostics, and ranking penalties as
[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/) so results flow
into any tool that understands the format — GitHub Code Scanning, VS Code
Problems panel, GitLab Code Quality, Sourcegraph Code Insights, JetBrains
inspections, and every other consumer in the ecosystem — without bespoke
ingest code per downstream.

## Why SARIF

mako's `AnswerSurfaceIssue` contract already carries every field SARIF needs:
`severity`, `code`, `path`, `line`, `message`, `evidenceRefs`, and the
cross-run dedup triple (`matchBasedId` / `codeHash` / `patternHash`). SARIF
is the standard wire format; wiring it in lets mako findings ride every
downstream's native surfaces instead of asking users to look at mako's CLI.

## API

```ts
import {
  formatAnswerResultAsSarif,
  formatSurfaceIssuesAsSarif,
} from "@mako-ai/tools";
```

### `formatAnswerResultAsSarif(result, options?) → SarifLog`

Consumes an `AnswerResult` and emits a complete SARIF log. Walks the
canonical surfaces — `trust.issues`, `diagnostics`, `ranking.reasons` —
deduping by `matchBasedId` so an issue that appears on multiple surfaces
shows up once.

Attaches `queryKind`, `queryId`, `projectId`, `trustState`,
`trustScopeRelation`, `rankingOrderKey`, and `rankingDeEmphasized` as
result-level `properties` so SARIF consumers that honor custom properties can
filter on trust dimensions without parsing message text.

```ts
const result = await toolService.callTool("trace_file", {
  projectId,
  file: "lib/dashboard.ts",
});

const sarif = formatAnswerResultAsSarif(result.result, {
  toolVersion: "0.1.0",
});

await fs.writeFile("mako-results.sarif", JSON.stringify(sarif, null, 2));
```

### `formatSurfaceIssuesAsSarif(issues, options?) → SarifLog`

Lower-level entry point. Accepts any flat list of `AnswerSurfaceIssue` and
emits a SARIF log. Use this when you've already materialized issues from any
source (maybe a merged result from multiple tool calls). Repeated
`matchBasedId` values are deduped before emission so the low-level formatter
follows the same identity semantics as `formatAnswerResultAsSarif(...)`.

### Options

| Option | Default | Notes |
|---|---|---|
| `toolName` | `"mako-ai"` | `runs[0].tool.driver.name` |
| `toolVersion` | omitted | `runs[0].tool.driver.version` |
| `informationUri` | `https://github.com/makoai/mako-ai` | `runs[0].tool.driver.informationUri` |
| `resultProperties` | — | Extra `properties` merged onto every result object |

## Severity mapping

| mako severity | SARIF level |
|---|---|
| `critical` | `error` |
| `high` | `error` |
| `medium` | `warning` |
| `low` | `note` |

SARIF's fourth level (`none`) is intentionally not emitted — if something is
`none`-worthy, mako doesn't emit an issue for it in the first place.

## Identity & dedup

Every SARIF result carries `partialFingerprints`:

```json
{
  "matchBasedId": "...",   // rule identity + metavariable bindings
  "codeHash": "...",       // matched code fingerprint
  "patternHash": "..."     // rule version
}
```

SARIF consumers (notably GitHub Code Scanning) use `partialFingerprints` to
suppress duplicate findings across runs. mako's three-hash identity — the
same one `collectAnswerDiagnostics` uses internally — maps 1:1.

The practical consequence: a finding that survives across two scans without
a code change keeps its identity on the GitHub side. A user who dismisses a
finding in the Security tab stays dismissed on the next scan unless the
code actually changed.

## Locations

- Primary location: the issue's `path` + `line` as a SARIF
  `physicalLocation`. Omitted when the issue has no path (e.g., pure trust
  reasons that apply to the run as a whole).
- Related locations: `producerPath` and `consumerPath` when different from
  the primary, each tagged with `producer` / `consumer` message text.
- Evidence refs in the `path:Lnn` format become additional related
  locations tagged with `evidence`.

## GitHub Code Scanning integration

```yaml
# .github/workflows/mako-scan.yml
name: mako trust scan
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: node scripts/mako-scan.mjs > mako-results.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: mako-results.sarif
```

```js
// scripts/mako-scan.mjs
import { createToolService, formatAnswerResultAsSarif } from "@mako-ai/tools";

const svc = createToolService();
try {
  const out = await svc.callTool("trace_file", {
    projectId: process.env.MAKO_PROJECT_ID,
    file: process.argv[2] ?? "app/page.tsx",
  });
  process.stdout.write(JSON.stringify(formatAnswerResultAsSarif(out.result)));
} finally {
  svc.close();
}
```

Findings render in the repo's Security tab + inline on pull requests, with
cross-run dedup handled by the fingerprints.

## Round-trip stability

Every field in the emitted log survives `JSON.parse(JSON.stringify(log))`
unchanged — the SARIF module only emits JSON-safe values (strings, numbers,
booleans, arrays, plain objects). There are no function references, regex
objects, or typed-array payloads.

## Smoke coverage

`test/smoke/sarif-output.ts` end-to-end seeds a project with a drift case,
runs `trace_file`, pipes the result through `formatAnswerResultAsSarif`, and
asserts: top-level SARIF 2.1.0 shape, rule dedup by id, rule-index integrity
on every result, `partialFingerprints` population, location presence, level
mapping, property propagation, standalone-formatter dedup, and full JSON
round-trip.

Run it:

```
node --import tsx test/smoke/sarif-output.ts
```
