import type {
  ImportsCyclesToolOutput,
  ImportsDepsToolOutput,
  ImportsHotspotsToolOutput,
  ImportsImpactToolOutput,
} from "@mako-ai/contracts";

const HIGH_FAN_OUT_THRESHOLD = 20;

export function importsDepsHints(output: ImportsDepsToolOutput): string[] {
  if (!Array.isArray(output.unresolved) || output.unresolved.length === 0) {
    return [];
  }
  return [
    `${output.unresolved.length} import(s) unresolved — try route_trace or live_text_search to identify the targets.`,
  ];
}

export function importsImpactHints(output: ImportsImpactToolOutput): string[] {
  const count = Array.isArray(output.impactedFiles) ? output.impactedFiles.length : 0;
  if (count === 0) {
    return [
      "No downstream impact — file is safe to refactor without dependent changes.",
    ];
  }
  if (count > HIGH_FAN_OUT_THRESHOLD) {
    return [
      `${count} downstream file(s) affected — call change_plan to bound the edit scope before editing.`,
    ];
  }
  return [];
}

export function importsCyclesHints(output: ImportsCyclesToolOutput): string[] {
  const cycles = Array.isArray(output.cycles) ? output.cycles.length : 0;
  if (cycles === 0) return [];
  return [
    `${cycles} import cycle(s) detected — break before refactoring affected files.`,
  ];
}

export function importsHotspotsHints(output: ImportsHotspotsToolOutput): string[] {
  const hotspots = Array.isArray(output.hotspots) ? output.hotspots : [];
  if (hotspots.length === 0) return [];
  return [
    "Edit hotspot files behind change_plan — they are the project's most-connected modules.",
  ];
}
