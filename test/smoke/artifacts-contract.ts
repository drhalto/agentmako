import assert from "node:assert/strict";
import {
  ARTIFACT_CONSUMER_TARGETS,
  ARTIFACT_KINDS,
  ARTIFACT_REFRESH_OUTCOMES,
  ARTIFACT_REPLAY_OUTCOMES,
  ArtifactBasisRefSchema,
  DEFAULT_ARTIFACT_STALE_BEHAVIOR,
  GenericArtifactSchema,
  type ArtifactBase,
  type ArtifactBasisRef,
  type ArtifactKind,
  type ArtifactRefreshResult,
  type ArtifactReplayResult,
} from "../../packages/contracts/src/index.ts";

function buildLocalBasisRef(): ArtifactBasisRef {
  return {
    basisRefId: "basis_local_1",
    kind: "workflow_packet",
    sourceId: "pkt_implementation_brief_abc",
    fingerprint: "fp_abc",
    sourceOrigin: "local",
    label: "implementation brief for foo",
  };
}

function buildReferenceBasisRef(): ArtifactBasisRef {
  return {
    basisRefId: "basis_ref_1",
    kind: "reference_document",
    sourceId: "doc://architecture/authn.md",
    fingerprint: "fp_doc",
    sourceOrigin: "reference",
  };
}

function buildArtifact(kind: ArtifactKind): ArtifactBase<ArtifactKind, unknown> {
  return {
    artifactId: `art_${kind}_1`,
    kind,
    projectId: "proj_1",
    title: `sample ${kind}`,
    generatedAt: "2026-04-21T00:00:00.000Z",
    basis: [buildLocalBasisRef(), buildReferenceBasisRef()],
    freshness: {
      state: "fresh",
      staleBehavior: DEFAULT_ARTIFACT_STALE_BEHAVIOR,
      staleBasisRefIds: [],
      evaluatedAt: "2026-04-21T00:00:00.000Z",
    },
    consumerTargets: ["harness"],
    exportIntent: {
      exportable: false,
      defaultTargets: [],
    },
    payload: { note: `payload for ${kind}` },
    renderings: [
      { format: "json", body: JSON.stringify({ kind }) },
      { format: "markdown", body: `# ${kind}` },
    ],
  };
}

async function main(): Promise<void> {
  // Disambiguation authority: the 4 R7 artifact kinds must match the 7.0 table.
  assert.deepEqual(
    [...ARTIFACT_KINDS].sort(),
    [
      "implementation_handoff",
      "review_bundle",
      "task_preflight",
      "verification_bundle",
    ],
    "ARTIFACT_KINDS must match the 7.0 disambiguation table",
  );

  // Default stale behavior is warn_and_keep until a family proves auto_refresh.
  assert.equal(DEFAULT_ARTIFACT_STALE_BEHAVIOR, "warn_and_keep");

  // Consumer target coverage must include harness / cli / external_agent / wrappers.
  for (const target of ["harness", "cli", "external_agent", "file_export", "editor", "ci", "hook"] as const) {
    assert.ok(
      (ARTIFACT_CONSUMER_TARGETS as readonly string[]).includes(target),
      `missing consumer target: ${target}`,
    );
  }

  // Local and reference basis refs both parse.
  assert.doesNotThrow(() => ArtifactBasisRefSchema.parse(buildLocalBasisRef()));
  assert.doesNotThrow(() => ArtifactBasisRefSchema.parse(buildReferenceBasisRef()));

  // Every kind constructs a schema-valid artifact.
  for (const kind of ARTIFACT_KINDS) {
    const artifact = buildArtifact(kind);
    const parsed = GenericArtifactSchema.parse(artifact);
    assert.equal(parsed.kind, kind);
    assert.equal(parsed.basis.length, 2);
    assert.equal(parsed.freshness.staleBehavior, "warn_and_keep");
    assert.ok(parsed.renderings.some((r) => r.format === "json"), "JSON rendering must be present");
  }

  // Stale artifact survives schema check (warn-and-keep is the default behavior).
  const stale = buildArtifact("task_preflight");
  stale.freshness = {
    state: "stale",
    staleBehavior: "warn_and_keep",
    staleBasisRefIds: ["basis_local_1"],
    evaluatedAt: "2026-04-22T00:00:00.000Z",
  };
  assert.doesNotThrow(() => GenericArtifactSchema.parse(stale));

  // Refresh and replay outcome enums. Trimmed to outcomes the code actually
  // produces — generators throw on failure rather than returning a failed
  // outcome, so the enum stays aligned with real execution paths.
  assert.deepEqual([...ARTIFACT_REFRESH_OUTCOMES].sort(), ["refreshed", "unchanged"]);
  assert.deepEqual([...ARTIFACT_REPLAY_OUTCOMES].sort(), ["replayed"]);

  // Refresh result shape typechecks and carries a supersedes id on success.
  const refresh: ArtifactRefreshResult<ArtifactBase<ArtifactKind, unknown>> = {
    outcome: "refreshed",
    artifact: buildArtifact("review_bundle"),
    supersedesArtifactId: "art_review_bundle_0",
    changedBasisRefIds: ["basis_local_1"],
  };
  assert.equal(refresh.outcome, "refreshed");
  assert.equal(refresh.supersedesArtifactId, "art_review_bundle_0");

  // Replay result shape typechecks.
  const replay: ArtifactReplayResult<ArtifactBase<ArtifactKind, unknown>> = {
    outcome: "replayed",
    artifact: buildArtifact("verification_bundle"),
  };
  assert.equal(replay.outcome, "replayed");

  // A missing basis ref is a schema error — the contract requires fingerprint.
  assert.throws(() =>
    ArtifactBasisRefSchema.parse({
      basisRefId: "b1",
      kind: "workflow_packet",
      sourceId: "src",
      sourceOrigin: "local",
    }),
  );

  // --- Structural invariants enforced by the 7.0 contract ---

  // Empty basis is rejected: artifacts are basis-driven by definition.
  const noBasis = buildArtifact("task_preflight");
  noBasis.basis = [];
  assert.ok(!GenericArtifactSchema.safeParse(noBasis).success, "empty basis must be rejected");

  // Empty consumer targets is rejected: every artifact declares where it is consumed.
  const noTargets = buildArtifact("task_preflight");
  noTargets.consumerTargets = [];
  assert.ok(
    !GenericArtifactSchema.safeParse(noTargets).success,
    "empty consumerTargets must be rejected",
  );

  // Empty renderings is rejected.
  const noRenderings = buildArtifact("task_preflight");
  noRenderings.renderings = [];
  assert.ok(
    !GenericArtifactSchema.safeParse(noRenderings).success,
    "empty renderings must be rejected",
  );

  // Missing the canonical JSON projection is rejected even when other renderings exist.
  const noJsonRendering = buildArtifact("task_preflight");
  noJsonRendering.renderings = [{ format: "markdown", body: "# only markdown" }];
  assert.ok(
    !GenericArtifactSchema.safeParse(noJsonRendering).success,
    "artifact without a json rendering must be rejected",
  );

  // A json rendering whose body is not valid JSON is rejected.
  const badJsonRendering = buildArtifact("task_preflight");
  badJsonRendering.renderings = [{ format: "json", body: "not actually json" }];
  assert.ok(
    !GenericArtifactSchema.safeParse(badJsonRendering).success,
    "json rendering with unparseable body must be rejected",
  );

  // Freshness state must be consistent with staleBasisRefIds.
  const freshWithGhost = buildArtifact("task_preflight");
  freshWithGhost.freshness = {
    state: "fresh",
    staleBehavior: "warn_and_keep",
    staleBasisRefIds: ["basis_local_1"],
    evaluatedAt: "2026-04-21T00:00:00.000Z",
  };
  assert.ok(
    !GenericArtifactSchema.safeParse(freshWithGhost).success,
    "fresh state with non-empty staleBasisRefIds must be rejected",
  );

  const staleWithoutRefs = buildArtifact("task_preflight");
  staleWithoutRefs.freshness = {
    state: "stale",
    staleBehavior: "warn_and_keep",
    staleBasisRefIds: [],
    evaluatedAt: "2026-04-21T00:00:00.000Z",
  };
  assert.ok(
    !GenericArtifactSchema.safeParse(staleWithoutRefs).success,
    "stale state with empty staleBasisRefIds must be rejected",
  );

  // stale basis refs that do not appear in basis are rejected.
  const staleGhostRef = buildArtifact("task_preflight");
  staleGhostRef.freshness = {
    state: "stale",
    staleBehavior: "warn_and_keep",
    staleBasisRefIds: ["ghost"],
    evaluatedAt: "2026-04-21T00:00:00.000Z",
  };
  assert.ok(
    !GenericArtifactSchema.safeParse(staleGhostRef).success,
    "staleBasisRefIds pointing outside basis must be rejected",
  );

  // metadata must be true JSON — functions and undefined fail the recursive check.
  const metadataFn = buildArtifact("task_preflight");
  metadataFn.metadata = { bad: (() => 1) as unknown as never };
  assert.ok(
    !GenericArtifactSchema.safeParse(metadataFn).success,
    "metadata with non-JSON values must be rejected",
  );

  const metadataOk = buildArtifact("task_preflight");
  metadataOk.metadata = { ok: { nested: [1, "two", null] } };
  assert.ok(
    GenericArtifactSchema.safeParse(metadataOk).success,
    "metadata with real JSON values must be accepted",
  );

  // Non-exportable artifacts cannot declare default export targets.
  const nonExportableWithTargets = buildArtifact("task_preflight");
  nonExportableWithTargets.exportIntent = {
    exportable: false,
    defaultTargets: ["file_export"],
  };
  assert.ok(
    !GenericArtifactSchema.safeParse(nonExportableWithTargets).success,
    "non-exportable artifacts with non-empty defaultTargets must be rejected",
  );

  // Export targets must also appear in consumerTargets — otherwise the
  // artifact claims a delivery surface it has not opted in to.
  const exportTargetOutsideConsumers = buildArtifact("task_preflight");
  exportTargetOutsideConsumers.consumerTargets = ["harness"];
  exportTargetOutsideConsumers.exportIntent = {
    exportable: true,
    defaultTargets: ["file_export"],
  };
  assert.ok(
    !GenericArtifactSchema.safeParse(exportTargetOutsideConsumers).success,
    "export targets outside consumerTargets must be rejected",
  );

  // Exportable artifacts whose defaultTargets are a subset of consumerTargets pass.
  const exportableAlignedTargets = buildArtifact("task_preflight");
  exportableAlignedTargets.consumerTargets = ["harness", "file_export"];
  exportableAlignedTargets.exportIntent = {
    exportable: true,
    defaultTargets: ["file_export"],
  };
  assert.ok(
    GenericArtifactSchema.safeParse(exportableAlignedTargets).success,
    "exportable artifacts with aligned defaultTargets must be accepted",
  );

  console.log("artifacts-contract: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
