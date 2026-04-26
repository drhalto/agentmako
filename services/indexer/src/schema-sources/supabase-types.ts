import type {
  SchemaColumn,
  SchemaIR,
  SchemaNamespace,
  SchemaSourceRef,
} from "@mako-ai/contracts";
import ts from "typescript";
import type { SchemaInventoryEntry } from "./inventory.js";

function emptyNamespace(): SchemaNamespace {
  return { tables: [], views: [], enums: [], rpcs: [] };
}

function ensureNamespace(ir: SchemaIR, schemaName: string): SchemaNamespace {
  let namespace = ir.schemas[schemaName];
  if (!namespace) {
    namespace = emptyNamespace();
    ir.schemas[schemaName] = namespace;
  }
  return namespace;
}

function makeSourceRef(
  entry: SchemaInventoryEntry,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): SchemaSourceRef {
  return {
    kind: entry.kind,
    path: entry.relativePath,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  };
}

function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (name == null) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function typeMembers(node: ts.Node | undefined): ts.NodeArray<ts.TypeElement> | undefined {
  if (node == null) {
    return undefined;
  }
  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    return node.members;
  }
  if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
    return node.type.members;
  }
  return undefined;
}

function propertyType(member: ts.TypeElement | undefined): ts.TypeNode | undefined {
  if (member != null && ts.isPropertySignature(member)) {
    return member.type;
  }
  return undefined;
}

function propertyMembers(member: ts.TypeElement | undefined): ts.NodeArray<ts.TypeElement> | undefined {
  const type = propertyType(member);
  return type && ts.isTypeLiteralNode(type) ? type.members : undefined;
}

function findProperty(
  members: readonly ts.TypeElement[] | undefined,
  name: string,
): ts.PropertySignature | undefined {
  return members?.find((member): member is ts.PropertySignature => {
    return ts.isPropertySignature(member) && propertyNameText(member.name) === name;
  });
}

function isNullType(node: ts.TypeNode): boolean {
  return (
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword)
  );
}

function parseColumnType(
  sourceFile: ts.SourceFile,
  typeNode: ts.TypeNode | undefined,
): { dataType: string; nullable: boolean } {
  if (typeNode == null) {
    return { dataType: "unknown", nullable: false };
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const nonNullTypes = typeNode.types.filter((part) => !isNullType(part));
    const nullable = nonNullTypes.length !== typeNode.types.length;
    const dataType = nonNullTypes.map((part) => part.getText(sourceFile)).join(" | ").trim();
    return {
      dataType: dataType === "" ? "unknown" : dataType,
      nullable,
    };
  }

  const dataType = typeNode.getText(sourceFile).trim();
  return { dataType: dataType === "" ? "unknown" : dataType, nullable: false };
}

function extractRowColumns(
  sourceFile: ts.SourceFile,
  rowMember: ts.TypeElement | undefined,
  entry: SchemaInventoryEntry,
): SchemaColumn[] {
  const rowMembers = propertyMembers(rowMember);
  if (!rowMembers) {
    return [];
  }

  const columns: SchemaColumn[] = [];
  for (const member of rowMembers) {
    if (!ts.isPropertySignature(member)) {
      continue;
    }
    const columnName = propertyNameText(member.name);
    if (!columnName) {
      continue;
    }
    const parsedType = parseColumnType(sourceFile, member.type);
    columns.push({
      name: columnName,
      dataType: parsedType.dataType,
      nullable: parsedType.nullable || Boolean(member.questionToken),
      sources: [makeSourceRef(entry, sourceFile, member.name)],
    });
  }
  return columns;
}

function extractEnumValues(sourceFile: ts.SourceFile, typeNode: ts.TypeNode | undefined): string[] {
  if (typeNode == null) {
    return [];
  }
  const nodes = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
  return nodes.flatMap((node) => {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      return [node.literal.text];
    }
    return [];
  });
}

function findDatabaseDeclaration(sourceFile: ts.SourceFile): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
  return sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration | ts.TypeAliasDeclaration => {
    return (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name.text === "Database"
    );
  });
}

export function parseSupabaseTypesSchemaSource(entry: SchemaInventoryEntry): SchemaIR {
  const ir: SchemaIR = { version: "1.0.0", schemas: {} };
  const sourceFile = ts.createSourceFile(
    entry.relativePath,
    entry.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const database = findDatabaseDeclaration(sourceFile);
  const schemaMembers = typeMembers(database);
  if (!schemaMembers) {
    return ir;
  }

  for (const schemaMember of schemaMembers) {
    if (!ts.isPropertySignature(schemaMember)) {
      continue;
    }
    const schemaName = propertyNameText(schemaMember.name);
    const schemaBody = propertyMembers(schemaMember);
    if (!schemaName || !schemaBody) {
      continue;
    }

    const namespace = ensureNamespace(ir, schemaName);
    const tables = propertyMembers(findProperty(schemaBody, "Tables"));
    const views = propertyMembers(findProperty(schemaBody, "Views"));
    const enums = propertyMembers(findProperty(schemaBody, "Enums"));
    const functions = propertyMembers(findProperty(schemaBody, "Functions"));

    for (const tableMember of tables ?? []) {
      if (!ts.isPropertySignature(tableMember)) {
        continue;
      }
      const tableName = propertyNameText(tableMember.name);
      const tableBody = propertyMembers(tableMember);
      if (!tableName || !tableBody) {
        continue;
      }
      namespace.tables.push({
        name: tableName,
        schema: schemaName,
        columns: extractRowColumns(sourceFile, findProperty(tableBody, "Row"), entry),
        sources: [makeSourceRef(entry, sourceFile, tableMember.name)],
      });
    }

    for (const viewMember of views ?? []) {
      if (!ts.isPropertySignature(viewMember)) {
        continue;
      }
      const viewName = propertyNameText(viewMember.name);
      if (!viewName) {
        continue;
      }
      namespace.views.push({
        name: viewName,
        schema: schemaName,
        sources: [makeSourceRef(entry, sourceFile, viewMember.name)],
      });
    }

    for (const enumMember of enums ?? []) {
      if (!ts.isPropertySignature(enumMember)) {
        continue;
      }
      const enumName = propertyNameText(enumMember.name);
      if (!enumName) {
        continue;
      }
      namespace.enums.push({
        name: enumName,
        schema: schemaName,
        values: extractEnumValues(sourceFile, enumMember.type),
        sources: [makeSourceRef(entry, sourceFile, enumMember.name)],
      });
    }

    for (const functionMember of functions ?? []) {
      if (!ts.isPropertySignature(functionMember)) {
        continue;
      }
      const functionName = propertyNameText(functionMember.name);
      if (!functionName) {
        continue;
      }
      namespace.rpcs.push({
        name: functionName,
        schema: schemaName,
        sources: [makeSourceRef(entry, sourceFile, functionMember.name)],
      });
    }
  }

  return ir;
}
