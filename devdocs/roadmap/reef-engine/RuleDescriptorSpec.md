# Reef Rule Descriptor Spec

Status: `Shipped`

`ReefRuleDescriptor` is the public, data-only mirror of a Reef rule or
adapter source. UI clients can render it; only server-side code may run
rule logic.

## Shape

```ts
interface ReefRuleDescriptor {
  id: string;
  version: string;
  source: string;
  sourceNamespace: string;
  type: "problem" | "suggestion" | "overlay";
  severity: "info" | "warning" | "error";
  title: string;
  description: string;
  docs?: { body: string };
  documentationUrl?: string;
  factKinds: string[];
  dependsOnFactKinds?: string[];
  fixable?: boolean;
  tags?: string[];
  enabledByDefault: boolean;
}
```

## Naming

Use stable namespaces:

- `git_precommit_check:*` for staged git guard checks
- `reef_rule:*` for native Reef rules
- `eslint:*` for ESLint adapter findings
- `typescript:*` or `typescript:TS2322` style IDs for TypeScript adapter
  findings
- `biome:*`, `oxlint:*`, and similar names for future external adapters

`sourceNamespace` groups a family, while `id` names the concrete rule.

## Current Descriptors

Reef 1 registers these when `git_precommit_check` runs:

- `git.unprotected_route`
- `git.client_uses_server_only`
- `git.server_uses_client_hook`

## Consumer Rules

- Treat descriptors as documentation and filtering metadata, not
  executable code.
- Use `list_reef_rules` to discover descriptors for a project.
- Use `ProjectFinding.ruleId` to join a finding to its descriptor.
- Missing descriptors are allowed; tools should still render the finding
  source, rule ID, severity, and message.
