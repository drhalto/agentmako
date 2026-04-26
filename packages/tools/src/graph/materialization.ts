import {
  type GraphEdge,
  type GraphEdgeExactness,
  type GraphEdgeKind,
  type GraphNode,
  type GraphNodeKind,
  type SchemaSourceRef,
  type SchemaTable,
  type SchemaTrigger,
} from "@mako-ai/contracts";
import {
  hashJson,
  type FileSummaryRecord,
  type ProjectStore,
  type ResolvedSchemaObjectRecord,
  type SymbolRecord,
} from "@mako-ai/store";

interface GraphNodeSeed {
  kind: GraphNodeKind;
  key: string;
  label: string;
  sourceRef?: string;
  metadata?: GraphNode["metadata"];
}

interface GraphEdgeSeed {
  kind: GraphEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  exactness: GraphEdgeExactness;
  provenance: GraphEdge["provenance"];
  metadata?: GraphEdge["metadata"];
}

export interface GraphEdgeAccumulator {
  edge: GraphEdge;
  evidenceRefs: Set<string>;
}

export function materializeTablePolicyAndTriggerEdges(
  nodesBySemanticKey: Map<string, GraphNode>,
  edgesBySemanticKey: Map<string, GraphEdgeAccumulator>,
  schemaName: string,
  table: SchemaTable,
): void {
  const tableKey = buildTableKey(schemaName, table.name);
  const tableSourceRef = formatSchemaSourceRef(table.sources[0]) ?? `table:${tableKey}`;
  const tableNode = ensureNode(nodesBySemanticKey, {
    kind: "table",
    key: tableKey,
    label: tableKey,
    sourceRef: tableSourceRef,
    metadata: {
      schemaName,
      tableName: table.name,
      ...(table.rls
        ? {
            rlsEnabled: table.rls.rlsEnabled,
            forceRls: table.rls.forceRls,
          }
        : {}),
      ...(Array.isArray(table.triggers) ? { triggerCount: table.triggers.length } : {}),
    },
  });

  for (const policy of table.rls?.policies ?? []) {
    const policyKey = `${tableKey}#policy:${policy.name}`;
    const policyNode = ensureNode(nodesBySemanticKey, {
      kind: "policy",
      key: policyKey,
      label: policy.name,
      sourceRef: `policy:${policyKey}`,
      metadata: {
        schemaName,
        tableName: table.name,
        policyName: policy.name,
        command: policy.command,
        mode: policy.mode,
        roles: policy.roles,
        ...(typeof policy.usingExpression === "string" ? { usingExpression: policy.usingExpression } : {}),
        ...(typeof policy.withCheckExpression === "string"
          ? { withCheckExpression: policy.withCheckExpression }
          : {}),
      },
    });
    addEdge(edgesBySemanticKey, {
      kind: "has_rls_policy",
      fromNodeId: tableNode.nodeId,
      toNodeId: policyNode.nodeId,
      exactness: "exact",
      provenance: {
        source: "project_store.loadSchemaSnapshot",
        sourceObjectId: policyKey,
        evidenceRefs: [tableSourceRef, `policy:${policyKey}`],
      },
      metadata: {
        command: policy.command,
        mode: policy.mode,
        roles: policy.roles,
      },
    });
  }

  for (const trigger of table.triggers ?? []) {
    const triggerKey = `${tableKey}#trigger:${trigger.name}`;
    const triggerNode = ensureTriggerNode(nodesBySemanticKey, schemaName, table.name, trigger);
    addEdge(edgesBySemanticKey, {
      kind: "has_trigger",
      fromNodeId: tableNode.nodeId,
      toNodeId: triggerNode.nodeId,
      exactness: "exact",
      provenance: {
        source: "project_store.loadSchemaSnapshot",
        sourceObjectId: triggerKey,
        evidenceRefs: [tableSourceRef, `trigger:${triggerKey}`],
      },
      metadata: {
        timing: trigger.timing,
        events: trigger.events,
        enabled: trigger.enabled,
        enabledMode: trigger.enabledMode,
      },
    });
  }
}

export function materializeRpcUsageEdges(
  projectStore: ProjectStore,
  nodesBySemanticKey: Map<string, GraphNode>,
  edgesBySemanticKey: Map<string, GraphEdgeAccumulator>,
  fileByPath: Map<string, FileSummaryRecord>,
): void {
  const schemaObjects = projectStore.listSchemaObjects().filter((object) => object.objectType === "rpc");
  if (schemaObjects.length === 0) {
    return;
  }

  for (const rpcObject of schemaObjects) {
    const candidateRpcNodes = findRpcNodesForObject(nodesBySemanticKey, rpcObject);
    if (candidateRpcNodes.length === 0) {
      continue;
    }

    for (const usage of projectStore.listSchemaUsages(rpcObject.objectId)) {
      const fileNode = ensureFileNode(nodesBySemanticKey, usage.filePath, fileByPath.get(usage.filePath));
      const evidenceRefs = [
        formatPathLineRef(usage.filePath, usage.line),
        ...candidateRpcNodes.map((node) => node.sourceRef).filter((value): value is string => typeof value === "string"),
      ];

      for (const rpcNode of candidateRpcNodes) {
        addEdge(edgesBySemanticKey, {
          kind: "calls_rpc",
          fromNodeId: fileNode.nodeId,
          toNodeId: rpcNode.nodeId,
          exactness: "heuristic",
          provenance: {
            source: "project_store.listSchemaUsages",
            sourceObjectId: `${rpcObject.objectId}:${usage.filePath}:${usage.line ?? 0}`,
            evidenceRefs,
          },
          metadata: {
            schemaName: rpcObject.schemaName,
            rpcName: rpcObject.objectName,
            usageKind: usage.usageKind,
            ...(typeof usage.line === "number" ? { line: usage.line } : {}),
            ...(typeof usage.excerpt === "string" ? { excerpt: usage.excerpt } : {}),
            ...(candidateRpcNodes.length > 1 ? { overloadCount: candidateRpcNodes.length } : {}),
          },
        });
      }
    }
  }
}

function findRpcNodesForObject(
  nodesBySemanticKey: Map<string, GraphNode>,
  rpcObject: ResolvedSchemaObjectRecord,
): GraphNode[] {
  const prefix = `${rpcObject.schemaName}.${rpcObject.objectName}(`;
  return [...nodesBySemanticKey.values()]
    .filter((node) => node.kind === "rpc" && node.key.startsWith(prefix))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function ensureTriggerNode(
  nodesBySemanticKey: Map<string, GraphNode>,
  schemaName: string,
  tableName: string,
  trigger: SchemaTrigger,
): GraphNode {
  const triggerKey = `${buildTableKey(schemaName, tableName)}#trigger:${trigger.name}`;
  return ensureNode(nodesBySemanticKey, {
    kind: "trigger",
    key: triggerKey,
    label: trigger.name,
    sourceRef: `trigger:${triggerKey}`,
    metadata: {
      schemaName,
      tableName,
      triggerName: trigger.name,
      enabled: trigger.enabled,
      enabledMode: trigger.enabledMode,
      timing: trigger.timing,
      events: trigger.events,
      ...(typeof trigger.bodyText === "string" ? { bodyText: trigger.bodyText } : {}),
    },
  });
}

export function ensureFileNode(
  nodesBySemanticKey: Map<string, GraphNode>,
  filePath: string,
  file?: FileSummaryRecord,
): GraphNode {
  return ensureNode(nodesBySemanticKey, {
    kind: "file",
    key: filePath,
    label: filePath,
    sourceRef: filePath,
    metadata: file
      ? {
          path: file.path,
          language: file.language,
          sizeBytes: file.sizeBytes,
          lineCount: file.lineCount,
          isGenerated: file.isGenerated,
          ...(typeof file.sha256 === "string" ? { sha256: file.sha256 } : {}),
        }
      : { path: filePath },
  });
}

export function ensureSymbolNode(
  nodesBySemanticKey: Map<string, GraphNode>,
  filePath: string,
  symbol: SymbolRecord,
): GraphNode {
  return ensureNode(nodesBySemanticKey, {
    kind: "symbol",
    key: buildSymbolKey(filePath, symbol),
    label: symbol.exportName ?? symbol.name,
    sourceRef: formatPathLineRef(filePath, symbol.lineStart),
    metadata: {
      filePath,
      symbolName: symbol.name,
      symbolKind: symbol.kind,
      ...(typeof symbol.exportName === "string" ? { exportName: symbol.exportName } : {}),
      ...(typeof symbol.lineStart === "number" ? { lineStart: symbol.lineStart } : {}),
      ...(typeof symbol.lineEnd === "number" ? { lineEnd: symbol.lineEnd } : {}),
      ...(typeof symbol.signatureText === "string" ? { signatureText: symbol.signatureText } : {}),
    },
  });
}

export function ensureNode(
  nodesBySemanticKey: Map<string, GraphNode>,
  seed: GraphNodeSeed,
): GraphNode {
  const semanticKey = `${seed.kind}:${seed.key}`;
  const existing = nodesBySemanticKey.get(semanticKey);
  if (existing) {
    if (!existing.sourceRef && seed.sourceRef) {
      existing.sourceRef = seed.sourceRef;
    }
    if (seed.metadata) {
      existing.metadata = {
        ...(existing.metadata ?? {}),
        ...seed.metadata,
      };
    }
    return existing;
  }

  const node: GraphNode = {
    nodeId: `graph_node_${hashJson({ kind: seed.kind, key: seed.key })}`,
    kind: seed.kind,
    key: seed.key,
    label: seed.label,
    ...(seed.sourceRef ? { sourceRef: seed.sourceRef } : {}),
    ...(seed.metadata ? { metadata: seed.metadata } : {}),
  };
  nodesBySemanticKey.set(semanticKey, node);
  return node;
}

export function addEdge(
  edgesBySemanticKey: Map<string, GraphEdgeAccumulator>,
  seed: GraphEdgeSeed,
): void {
  const semanticKey = hashJson({
    kind: seed.kind,
    fromNodeId: seed.fromNodeId,
    toNodeId: seed.toNodeId,
    exactness: seed.exactness,
    source: seed.provenance.source,
    sourceObjectId: seed.provenance.sourceObjectId ?? null,
  });
  const existing = edgesBySemanticKey.get(semanticKey);
  if (existing) {
    for (const ref of seed.provenance.evidenceRefs) {
      if (ref.length > 0) {
        existing.evidenceRefs.add(ref);
      }
    }
    if (seed.metadata) {
      existing.edge.metadata = {
        ...(existing.edge.metadata ?? {}),
        ...seed.metadata,
      };
    }
    return;
  }

  const evidenceRefs = new Set(seed.provenance.evidenceRefs.filter((ref) => ref.length > 0));
  edgesBySemanticKey.set(semanticKey, {
    edge: {
      edgeId: `graph_edge_${semanticKey}`,
      kind: seed.kind,
      fromNodeId: seed.fromNodeId,
      toNodeId: seed.toNodeId,
      exactness: seed.exactness,
      provenance: {
        source: seed.provenance.source,
        ...(typeof seed.provenance.sourceObjectId === "string"
          ? { sourceObjectId: seed.provenance.sourceObjectId }
          : {}),
        evidenceRefs: [...evidenceRefs].sort((left, right) => left.localeCompare(right)),
      },
      ...(seed.metadata ? { metadata: seed.metadata } : {}),
    },
    evidenceRefs,
  });
}

function buildSymbolKey(filePath: string, symbol: SymbolRecord): string {
  return `${filePath}:${symbol.name}:${symbol.lineStart ?? 0}:${symbol.exportName ?? ""}`;
}

export function buildRpcKey(schemaName: string, rpcName: string, argTypes: string[] = []): string {
  return `${schemaName}.${rpcName}(${argTypes.join(",")})`;
}

export function buildRpcLabel(schemaName: string, rpcName: string, argTypes: string[] = []): string {
  const signature = argTypes.length > 0 ? `(${argTypes.join(", ")})` : "()";
  return `${schemaName}.${rpcName}${signature}`;
}

export function buildRpcNodeKey(schemaName: string, rpcName: string, argTypes: string[] = []): string {
  return buildRpcKey(schemaName, rpcName, argTypes);
}

export function buildTableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

export function routeLabel(method: string | undefined, pattern: string, routeKey: string): string {
  const prefix = typeof method === "string" && method.length > 0 ? `${method} ${pattern}` : pattern;
  return prefix.length > 0 ? prefix : routeKey;
}

export function formatPathLineRef(path: string, line?: number): string {
  return typeof line === "number" ? `${path}:${line}` : path;
}

export function formatSchemaSourceRef(source: SchemaSourceRef | undefined): string | undefined {
  if (!source) {
    return undefined;
  }
  return typeof source.line === "number" ? `${source.path}:${source.line}` : source.path;
}
