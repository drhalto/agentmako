/**
 * ProviderIcon — render the brand SVG for a known provider.
 *
 * Icons live under `apps/web/public/ai-providers/` and are referenced
 * by absolute web paths (Vite serves `public/` from `/`). When a
 * provider doesn't have a brand asset we fall back to a small initial
 * chip so the rendering stays predictable.
 *
 * Two render modes by filename convention:
 *
 *   - `*-color.svg`  — multi-color brand assets, kept as `<img>` so the
 *                      original colors render in both themes.
 *   - everything else — monochrome assets that already use
 *                      `fill="currentColor"`. Rendered via CSS
 *                      `mask-image` with `background-color: currentColor`
 *                      so the glyph inherits the parent text color and
 *                      flips naturally between light and dark themes.
 */

import { useMemo, useState } from "react";

interface ProviderIconProps {
  providerId: string;
  size?: number;
  className?: string;
}

/**
 * Provider id → asset filename. Multiple ids can map to the same icon
 * (e.g. ollama-cloud reuses the ollama mark, openai-compatible reuses
 * the OpenAI mark) since the underlying brand is the same.
 */
const PROVIDER_ICON_MAP: Record<string, string> = {
  anthropic: "claude-color.svg",
  "claude": "claude-color.svg",
  "claude-code": "claudecode-color.svg",
  cursor: "cursor.svg",
  deepseek: "deepseek-color.svg",
  gemini: "gemini-color.svg",
  google: "gemini-color.svg",
  github: "github.svg",
  huggingface: "huggingface-color.svg",
  hf: "huggingface-color.svg",
  kimi: "kimi-color.svg",
  moonshot: "moonshot.svg",
  ollama: "ollama.svg",
  "ollama-cloud": "ollama.svg",
  openai: "openai.svg",
  "openai-compatible": "openai.svg",
  lmstudio: "lmstudio.svg",
};

export function ProviderIcon({ providerId, size = 18, className }: ProviderIconProps) {
  const [broken, setBroken] = useState(false);
  const filename = useMemo(() => resolveIconFile(providerId), [providerId]);
  const initial = useMemo(() => deriveInitial(providerId), [providerId]);

  if (filename && !broken) {
    const url = `/ai-providers/${filename}`;
    const isColor = filename.includes("-color");

    if (isColor) {
      return (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className={["shrink-0 select-none", className].filter(Boolean).join(" ")}
          style={{ display: "inline-block" }}
          aria-hidden
        />
      );
    }

    // Monochrome glyph — render via CSS mask so the icon takes the
    // parent's text color. Light mode → near-black, dark mode → light.
    const maskValue = `url("${url}") no-repeat center / contain`;
    return (
      <span
        className={["inline-block shrink-0", className].filter(Boolean).join(" ")}
        style={{
          width: size,
          height: size,
          backgroundColor: "currentColor",
          WebkitMask: maskValue,
          mask: maskValue,
        }}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={["inline-flex shrink-0 items-center justify-center select-none", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(3, Math.round(size / 5)),
        background: "var(--color-mk-ridge)",
        color: "var(--color-mk-surface)",
        fontSize: Math.max(9, Math.round(size * 0.55)),
        fontWeight: 600,
        lineHeight: 1,
      }}
      aria-hidden
      title={providerId}
    >
      {initial}
    </span>
  );
}

function resolveIconFile(providerId: string): string | null {
  const exact = PROVIDER_ICON_MAP[providerId.toLowerCase()];
  if (exact) return exact;

  // Fuzzy: id starts with a known brand (e.g. "openai-compatible-foo").
  const lowered = providerId.toLowerCase();
  for (const [key, file] of Object.entries(PROVIDER_ICON_MAP)) {
    if (lowered.startsWith(key)) return file;
  }
  return null;
}

function deriveInitial(providerId: string): string {
  const trimmed = providerId.trim();
  if (trimmed.length === 0) return "?";
  return trimmed[0]!.toUpperCase();
}
