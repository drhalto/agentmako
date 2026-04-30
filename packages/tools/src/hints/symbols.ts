import type {
  ExportsOfToolOutput,
  SymbolsOfToolOutput,
} from "@mako-ai/contracts";

export function symbolsOfHints(output: SymbolsOfToolOutput): string[] {
  const count = Array.isArray(output.symbols) ? output.symbols.length : 0;
  if (count === 0) {
    return [
      "No symbols indexed for this file — verify the path or run project_index_refresh.",
    ];
  }
  return [];
}

export function exportsOfHints(output: ExportsOfToolOutput): string[] {
  const count = Array.isArray(output.exports) ? output.exports.length : 0;
  if (count === 0) {
    return [
      "No exports declared — try symbols_of for all internal symbols, or treat this file as an entrypoint.",
    ];
  }
  return [];
}
