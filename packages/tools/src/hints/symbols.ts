import type {
  ExportsOfToolOutput,
  SymbolsOfToolOutput,
} from "@mako-ai/contracts";

export function symbolsOfHints(output: SymbolsOfToolOutput): string[] {
  const count = Array.isArray(output.symbols) ? output.symbols.length : 0;
  if (count === 0) {
    // Barrel re-exports, config/JSON/CSS, and type-only files legitimately
    // index zero symbols — don't imply the index is broken.
    return [
      "No symbols indexed for this file — normal for barrels, config, or non-code files; if you expected symbols, verify the path or run project_index_refresh.",
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
