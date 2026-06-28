/**
 * Living-reef view of tool↔file activity — a bioluminescent deep-sea network.
 *
 * Rendered to a canvas on a dark "stage". The layout is deliberately legible
 * rather than a free hairball: tool nodes form a luminous central nucleus and
 * each directory is anchored as its own colored lobe on a ring around it, so
 * the structure reads at a glance. Signals (pulses) travel the connections —
 * cyan inward when a tool reads a file, amber outward when it writes — and a
 * sonar "ping" ripples out of any node the moment it fires, which gives the
 * stage its live, breathing feel.
 *
 * d3-force supplies the physics (charge / links / collision); a custom anchor
 * force pins tools to the centre and files/dirs to their lobe. Everything drawn
 * is hand-rolled canvas with additive glow, drifting plankton dust, a vignette,
 * and a cinematic depth-of-field on focus (the focused circuit stays sharp and
 * bright while everything else eases back into the deep). Positions persist
 * across updates so live activity eases in instead of reshuffling.
 *
 * Interactions: scroll to zoom, drag background to pan, drag a node to move it,
 * hover for a tooltip, click to focus a node's circuit, the corner sonar-scope
 * minimap to jump, the zoom cluster or keyboard (F fit, +/- zoom, Esc clear).
 * Honors `prefers-reduced-motion` by stilling the particles, dust, and pings.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  type Simulation,
  type ForceLink,
  type Force,
} from "d3-force";
import type { FlowGraph, FlowNode, FlowNodeKind } from "../../lib/flow/graph-model";

interface SimNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  title: string;
  runs: number;
  errors: number;
  lastActivityMs: number;
  dir?: string;
  fileCount?: number;
  hue: number; // -1 for tools (special), else a directory hue in degrees
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink {
  id: string;
  source: SimNode | string;
  target: SimNode | string;
  weight: number;
  mutations: number;
  lastActivityMs: number;
}

interface Particle {
  edgeId: string;
  t: number; // 0..1 along the edge
  speed: number; // per second
  write: boolean; // amber out (tool→file) vs cyan in (file→tool)
  fromOrigin: boolean; // a dispatch pulse: agent(origin)→tool, drawn white
}

/** An expanding sonar ring spawned when a node fires. */
interface Ring {
  x: number;
  y: number;
  age: number; // seconds
  life: number; // seconds
  r0: number; // start radius
  color: string;
}

/** Drifting plankton mote in the deep — pure atmosphere. */
interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  tw: number; // twinkle phase
}

interface ToolFileGraphProps {
  graph: FlowGraph;
  selectedId: string | null;
  onSelect: (node: FlowNode | null) => void;
  pulseMs?: number;
}

const DEFAULT_PULSE_MS = 6000;

// Dark neural stage — independent of the app's light/dark theme so the glow
// always reads. Tools are near-white with an indigo halo; directory lobes get
// a curated, harmonious hue ramp.
const STAGE = {
  bgInner: "#0c1226",
  bgOuter: "#04060d",
  toolCore: "#eef2ff",
  toolGlow: "#93a8ff",
  edge: "#9fb4ff",
  read: "#5fd0ff", // cyan, file→tool
  write: "#ffb24d", // amber, tool→file
  danger: "#ff6b6b",
  labelTool: "#e7ecff",
  labelDir: "#aeb9e0",
  labelFile: "#8b97c4",
};

const DIR_HUES = [218, 190, 265, 320, 200, 145, 35, 8, 285, 160, 50, 330, 175, 240];

const MINIMAP = { w: 168, h: 116, pad: 10 };

function dirHue(dir: string | undefined, index: number): number {
  if (!dir) return 220;
  return DIR_HUES[index % DIR_HUES.length]!;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function nodeRadius(n: { kind: FlowNodeKind; runs: number }): number {
  if (n.kind === "origin") return Math.min(34, 15 + Math.sqrt(n.runs) * 1.25);
  if (n.kind === "tool") return Math.min(24, 9 + Math.sqrt(n.runs) * 2.4);
  if (n.kind === "dir") return Math.min(26, 6.5 + Math.sqrt(n.runs) * 1.5);
  return Math.min(13, 3.5 + Math.sqrt(n.runs) * 1.05);
}

function asNode(ref: SimNode | string, map: Map<string, SimNode>): SimNode | undefined {
  return typeof ref === "string" ? map.get(ref) : ref;
}

/** Quadratic-bezier point + a stable perpendicular control offset per edge. */
function edgeGeometry(s: SimNode, d: SimNode, bow: number): { cx: number; cy: number } {
  const mx = (s.x + d.x) / 2;
  const my = (s.y + d.y) / 2;
  const dx = d.x - s.x;
  const dy = d.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off = len * 0.16 * bow;
  return { cx: mx + nx * off, cy: my + ny * off };
}

function quad(p0: number, c: number, p1: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * c + t * t * p1;
}

/** Deterministic ±1 from an id so arcs bow consistently but not all one way. */
function bowSign(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h % 2 === 0 ? 1 : -1;
}

/** Frame-rate-independent easing toward a target. */
function ease(current: number, target: number, dtSec: number, rate: number): number {
  const k = 1 - Math.exp(-rate * dtSec);
  return current + (target - current) * k;
}

export function ToolFileGraph({ graph, selectedId, onSelect, pulseMs = DEFAULT_PULSE_MS }: ToolFileGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const nodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const linksRef = useRef<SimLink[]>([]);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const sizeRef = useRef<{ width: number; height: number; dpr: number }>({ width: 0, height: 0, dpr: 1 });

  const dirAngleRef = useRef<Map<string, number>>(new Map());
  const ringRadiusRef = useRef(260);
  const maxWeightRef = useRef(1);
  const labelIdsRef = useRef<Set<string>>(new Set());
  const particlesRef = useRef<Particle[]>([]);
  const emitAccRef = useRef<Map<string, number>>(new Map());
  const lastTimeRef = useRef(0);
  const fittedCountRef = useRef(-1);

  // Premium-feel animation state.
  const focusAlphaRef = useRef<Map<string, number>>(new Map()); // eased depth-of-field per node
  const hoverScaleRef = useRef<Map<string, number>>(new Map()); // eased hover/selection lift
  const ringsRef = useRef<Ring[]>([]); // sonar pings
  const seenActivityRef = useRef<Map<string, number>>(new Map()); // last fire we rippled
  const motesRef = useRef<Mote[]>([]); // plankton dust
  const reducedMotionRef = useRef(false);
  const selectPulseRef = useRef(0); // time accumulator for the selection ring

  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  selectedRef.current = selectedId;

  const dragRef = useRef<{ id: string; pointerId: number; moved: boolean } | null>(null);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number; pointerId: number; moved: boolean } | null>(null);

  const [hoverTip, setHoverTip] = useState<{ node: FlowNode; sx: number; sy: number } | null>(null);

  const neighboursOf = useCallback((focusId: string): Set<string> => {
    const set = new Set<string>([focusId]);
    for (const link of linksRef.current) {
      const s = typeof link.source === "string" ? link.source : link.source.id;
      const t = typeof link.target === "string" ? link.target : link.target.id;
      if (s === focusId) set.add(t);
      else if (t === focusId) set.add(s);
    }
    return set;
  }, []);

  const anchorFor = useCallback(
    (n: SimNode): { x: number; y: number; strength: number } => {
      // The origin is pinned hard at dead centre — it is the root everything
      // radiates from.
      if (n.kind === "origin") return { x: 0, y: 0, strength: 0.28 };
      // Weak centre pull for tools so the link force can drift each toward the
      // lobe it actually uses, instead of piling them all in the middle.
      if (n.kind === "tool") return { x: 0, y: 0, strength: 0.013 };
      const ring = ringRadiusRef.current;
      const angle = n.dir ? dirAngleRef.current.get(n.dir) : undefined;
      if (angle === undefined) return { x: 0, y: 0, strength: 0.02 }; // root files near core
      return {
        x: Math.cos(angle) * ring,
        y: Math.sin(angle) * ring,
        strength: n.kind === "dir" ? 0.09 : 0.06,
      };
    },
    [],
  );

  /** World-space bounding box of all nodes (with their radii). */
  const worldBounds = useCallback(() => {
    const nodes = [...nodeMapRef.current.values()];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const r = nodeRadius(n);
      minX = Math.min(minX, n.x - r);
      minY = Math.min(minY, n.y - r);
      maxX = Math.max(maxX, n.x + r);
      maxY = Math.max(maxY, n.y + r);
    }
    return { minX, minY, maxX, maxY, ok: Number.isFinite(minX) };
  }, []);

  const fitView = useCallback(() => {
    const { width, height } = sizeRef.current;
    const b = worldBounds();
    if (!width || !height || !b.ok) return;
    const pad = 90;
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    const k = Math.min(3, Math.max(0.18, Math.min((width - pad) / w, (height - pad) / h)));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    transformRef.current = { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
  }, [worldBounds]);

  /** Zoom about the canvas centre by a multiplicative factor. */
  const zoomBy = useCallback((factor: number) => {
    const { width, height } = sizeRef.current;
    const tr = transformRef.current;
    const k = Math.min(6, Math.max(0.15, tr.k * factor));
    const cx = width / 2;
    const cy = height / 2;
    const gx = (cx - tr.x) / tr.k;
    const gy = (cy - tr.y) / tr.k;
    transformRef.current = { k, x: cx - gx * k, y: cy - gy * k };
  }, []);

  // --- reconcile graph → simulation, preserving positions -------------------
  useEffect(() => {
    const map = nodeMapRef.current;

    const dirIndex = new Map<string, number>();
    graph.meta.dirs.forEach((d, i) => dirIndex.set(d, i));
    const dirAngle = new Map<string, number>();
    const n = Math.max(1, graph.meta.dirs.length);
    graph.meta.dirs.forEach((d, i) => dirAngle.set(d, (i / n) * Math.PI * 2 - Math.PI / 2));
    dirAngleRef.current = dirAngle;
    const { width, height } = sizeRef.current;
    ringRadiusRef.current = Math.max(180, Math.min(width || 700, height || 500) * 0.52);

    const nextIds = new Set(graph.nodes.map((gn) => gn.id));
    for (const id of [...map.keys()]) {
      if (!nextIds.has(id)) map.delete(id);
    }
    for (const gn of graph.nodes) {
      const hue = gn.kind === "tool" || gn.kind === "origin" ? -1 : dirHue(gn.dir, gn.dir ? dirIndex.get(gn.dir) ?? 0 : 0);
      const existing = map.get(gn.id);
      if (existing) {
        existing.kind = gn.kind;
        existing.label = gn.label;
        existing.title = gn.title;
        existing.runs = gn.runs;
        existing.errors = gn.errors;
        existing.lastActivityMs = gn.lastActivityMs;
        existing.dir = gn.dir;
        existing.fileCount = gn.fileCount;
        existing.hue = hue;
        // Keep the origin pinned at dead centre — it is the fixed root.
        if (gn.kind === "origin") {
          existing.fx = 0;
          existing.fy = 0;
        }
      } else {
        // Seed near the node's eventual anchor so it eases in, not flies in.
        const ring = ringRadiusRef.current;
        const angle = gn.dir ? dirAngle.get(gn.dir) : undefined;
        const baseX = gn.kind === "tool" || angle === undefined ? 0 : Math.cos(angle) * ring;
        const baseY = gn.kind === "tool" || angle === undefined ? 0 : Math.sin(angle) * ring;
        map.set(gn.id, {
          id: gn.id,
          kind: gn.kind,
          label: gn.label,
          title: gn.title,
          runs: gn.runs,
          errors: gn.errors,
          lastActivityMs: gn.lastActivityMs,
          dir: gn.dir,
          fileCount: gn.fileCount,
          hue,
          x: gn.kind === "origin" ? 0 : baseX + (Math.random() - 0.5) * 60,
          y: gn.kind === "origin" ? 0 : baseY + (Math.random() - 0.5) * 60,
          vx: 0,
          vy: 0,
          fx: gn.kind === "origin" ? 0 : null,
          fy: gn.kind === "origin" ? 0 : null,
        });
      }
    }

    const nodes = [...map.values()];
    const links: SimLink[] = graph.edges
      .filter((e) => map.has(e.source) && map.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        weight: e.weight,
        mutations: e.mutations,
        lastActivityMs: e.lastActivityMs,
      }));
    linksRef.current = links;
    maxWeightRef.current = links.reduce((m, l) => Math.max(m, l.weight), 1);

    // Label budget: only the most active tools/folders carry a persistent
    // label so the stage stays legible; everything else labels on hover/zoom.
    const labelIds = new Set<string>();
    const byRuns = (a: SimNode, b: SimNode) => b.runs - a.runs;
    nodes.filter((n) => n.kind === "origin").forEach((n) => labelIds.add(n.id));
    nodes.filter((n) => n.kind === "tool").sort(byRuns).slice(0, 14).forEach((n) => labelIds.add(n.id));
    nodes.filter((n) => n.kind === "dir").sort(byRuns).slice(0, 12).forEach((n) => labelIds.add(n.id));
    labelIdsRef.current = labelIds;

    // prune emission accumulators for edges that vanished
    const liveEdgeIds = new Set(links.map((l) => l.id));
    for (const id of [...emitAccRef.current.keys()]) {
      if (!liveEdgeIds.has(id)) emitAccRef.current.delete(id);
    }
    particlesRef.current = particlesRef.current.filter((p) => liveEdgeIds.has(p.edgeId));

    // Seed activity bookkeeping so we don't ripple the whole historical seed at
    // once on first load — only genuinely *new* fires after this point ping.
    for (const node of nodes) {
      if (!seenActivityRef.current.has(node.id)) {
        seenActivityRef.current.set(node.id, node.lastActivityMs);
      }
    }
    for (const id of [...seenActivityRef.current.keys()]) {
      if (!map.has(id)) seenActivityRef.current.delete(id);
    }

    if (!simRef.current) {
      const anchor = makeAnchorForce(anchorFor);
      simRef.current = forceSimulation<SimNode>(nodes)
        .force("charge", forceManyBody<SimNode>().strength(-260).distanceMax(680))
        .force(
          "link",
          forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance((l) => {
              const s = l.source as SimNode | string;
              // Origin → tool: hold tools on an inner ring around the core.
              if (typeof s === "object" && s.kind === "origin") return ringRadiusRef.current * 0.34;
              return 60 + 16 * Math.log2((l.weight ?? 1) + 1);
            })
            .strength((l) => {
              const s = l.source as SimNode | string;
              // Gentle origin links guide the ring; tool→file links (0.22) still
              // win the tug-of-war so tools drift toward the lobes they use.
              if (typeof s === "object" && s.kind === "origin") return 0.07;
              return 0.22;
            }),
        )
        .force("collide", forceCollide<SimNode>().radius((d) => nodeRadius(d) + 4).iterations(2))
        .force("anchor", anchor)
        .alpha(1)
        .alphaDecay(0.02)
        .stop();
    } else {
      const sim = simRef.current;
      sim.nodes(nodes);
      const link = sim.force("link") as ForceLink<SimNode, SimLink> | undefined;
      link?.links(links);
      sim.alpha(Math.max(sim.alpha(), 0.5)).restart().stop();
    }

    // Refit when the node population changes a lot (e.g. group toggle, first load).
    const count = nodes.length;
    if (fittedCountRef.current < 0 || Math.abs(count - fittedCountRef.current) > Math.max(6, fittedCountRef.current * 0.25)) {
      fittedCountRef.current = -2; // signal: refit once cooled
    }
  }, [graph, anchorFor]);

  // --- size / DPR -----------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const first = sizeRef.current.width === 0;
      sizeRef.current = { width, height, dpr };
      ringRadiusRef.current = Math.max(180, Math.min(width, height) * 0.52);
      seedMotes(motesRef.current, width, height);
      if (first) transformRef.current = { k: 1, x: width / 2, y: height / 2 };
    };

    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // --- reduced-motion preference -------------------------------------------
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedMotionRef.current = mq.matches;
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // --- keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") {
        fitView();
      } else if (e.key === "+" || e.key === "=") {
        zoomBy(1.2);
      } else if (e.key === "-" || e.key === "_") {
        zoomBy(1 / 1.2);
      } else if (e.key === "Escape") {
        onSelect(null);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitView, zoomBy, onSelect]);

  // --- render + animation loop ---------------------------------------------
  useEffect(() => {
    let raf = 0;

    const emitParticles = (dtSec: number, focusId: string | null, focus: Set<string> | null) => {
      const links = linksRef.current;
      const particles = particlesRef.current;
      const acc = emitAccRef.current;
      const maxW = maxWeightRef.current;
      const now = Date.now();
      const cap = links.length > 260 ? 340 : 440;
      // Global emission rate scales down as the graph grows so it never floods.
      const ambient = links.length > 0 ? Math.min(1.5, 48 / links.length) : 0;

      for (const link of links) {
        if (particles.length >= cap) break;
        const sNode = asNode(link.source, nodeMapRef.current);
        const fromOrigin = sNode?.kind === "origin";
        const norm = 0.25 + 0.75 * (link.weight / maxW);
        const hot = link.lastActivityMs > 0 && now - link.lastActivityMs < pulseMs ? 4 : 1;
        // Origin→tool links carry the total call weight, so dampen them hard or
        // they flood the core; they read as an occasional "dispatch" pulse.
        let emphasis = ambient * norm * hot * (fromOrigin ? 0.3 : 1);
        if (focus) {
          const touches =
            (typeof link.source === "string" ? link.source : link.source.id) === focusId ||
            (typeof link.target === "string" ? link.target : link.target.id) === focusId;
          emphasis = touches ? emphasis * 7 : 0;
        }
        if (emphasis <= 0) continue;
        const prev = acc.get(link.id) ?? Math.random();
        let next = prev + dtSec * emphasis;
        while (next >= 1 && particles.length < cap) {
          next -= 1;
          particles.push({
            edgeId: link.id,
            t: 0,
            speed: 0.55 + Math.random() * 0.5,
            write: link.mutations > 0,
            fromOrigin,
          });
        }
        acc.set(link.id, next);
      }
    };

    // Spawn a sonar ring when a node's most-recent activity advances and is
    // still within the pulse window — i.e. it just fired.
    const spawnRings = () => {
      if (reducedMotionRef.current) return;
      const now = Date.now();
      const seen = seenActivityRef.current;
      const rings = ringsRef.current;
      for (const node of nodeMapRef.current.values()) {
        const last = node.lastActivityMs;
        const prev = seen.get(node.id) ?? last;
        if (last > prev && now - last < pulseMs && rings.length < 60) {
          const r = nodeRadius(node);
          const color = node.errors > 0 ? STAGE.danger : node.kind === "tool" ? STAGE.toolGlow : hsl(node.hue, 80, 68);
          rings.push({ x: node.x, y: node.y, age: 0, life: 1.5, r0: r, color });
        }
        seen.set(node.id, last);
      }
    };

    const draw = (dtSec: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { width, height, dpr } = sizeRef.current;
      const t = transformRef.current;
      const map = nodeMapRef.current;
      const links = linksRef.current;
      const now = Date.now();
      const reduced = reducedMotionRef.current;
      const focusId = hoverRef.current ?? selectedRef.current;
      const focus = focusId ? neighboursOf(focusId) : null;
      selectPulseRef.current += dtSec;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ---- abyssal stage background ----
      const grad = ctx.createRadialGradient(
        width / 2,
        height * 0.46,
        Math.min(width, height) * 0.04,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.78,
      );
      grad.addColorStop(0, STAGE.bgInner);
      grad.addColorStop(1, STAGE.bgOuter);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // ---- drifting plankton dust (screen space, behind the network) ----
      drawMotes(ctx, motesRef.current, width, height, dtSec, reduced, now);

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);
      ctx.lineCap = "round";

      // ---- per-node eased depth-of-field alpha ----
      const fa = focusAlphaRef.current;
      const easeRate = reduced ? 1e6 : 9;
      for (const node of map.values()) {
        const target = focus ? (focus.has(node.id) ? 1 : 0.1) : 1;
        const cur = fa.get(node.id) ?? target;
        fa.set(node.id, ease(cur, target, dtSec, easeRate));
      }
      const alphaOf = (id: string): number => fa.get(id) ?? (focus ? (focus.has(id) ? 1 : 0.1) : 1);

      // ---- edges (additive faint glow, curved) ----
      ctx.globalCompositeOperation = "lighter";
      for (const link of links) {
        const s = asNode(link.source, map);
        const d = asNode(link.target, map);
        if (!s || !d) continue;
        const onFocus = !focus || (focus.has(s.id) && (s.id === focusId || d.id === focusId));
        const vis = Math.min(alphaOf(s.id), alphaOf(d.id));
        const { cx, cy } = edgeGeometry(s, d, bowSign(link.id));
        const hue = d.hue >= 0 ? d.hue : s.hue >= 0 ? s.hue : 220;
        const baseA = focus ? (onFocus ? 0.5 : 0.04) : 0.16;
        if (focus && onFocus) {
          // Focused edges get a gradient from tool-glow to the lobe hue.
          const g = ctx.createLinearGradient(s.x, s.y, d.x, d.y);
          g.addColorStop(0, hsl(hue, 80, 72, 0.15));
          g.addColorStop(0.5, hsl(hue, 85, 72, 0.6 * vis));
          g.addColorStop(1, hsl(hue, 85, 72, 0.18));
          ctx.strokeStyle = g;
        } else {
          ctx.strokeStyle = hsl(hue, 70, 70, baseA * vis);
        }
        ctx.lineWidth = (0.5 + Math.log2(link.weight + 1) * 0.5) / t.k + 0.3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(cx, cy, d.x, d.y);
        ctx.stroke();
      }

      // ---- sonar rings (the live "ping") ----
      const rings = ringsRef.current;
      const keptRings: Ring[] = [];
      for (const ring of rings) {
        ring.age += dtSec;
        if (ring.age >= ring.life) continue;
        keptRings.push(ring);
        const p = ring.age / ring.life;
        const r = ring.r0 + p * 64;
        const a = (1 - p) * 0.5;
        ctx.strokeStyle = withAlpha(ring.color, a);
        ctx.lineWidth = (1 - p) * 2.4 / t.k + 0.3;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ringsRef.current = keptRings;

      // ---- particles (the firing signals, with a short comet tail) ----
      const particles = particlesRef.current;
      const keep: Particle[] = [];
      for (const p of particles) {
        p.t += dtSec * p.speed;
        if (p.t >= 1) continue;
        const link = links.find((l) => l.id === p.edgeId);
        if (!link) continue;
        const s = asNode(link.source, map);
        const d = asNode(link.target, map);
        if (!s || !d) continue;
        keep.push(p);
        const touches = focus ? focus.has(s.id) && (s.id === focusId || d.id === focusId) : true;
        if (focus && !touches) continue;
        const { cx, cy } = edgeGeometry(s, d, bowSign(link.id));
        // dispatch (origin→tool) + write (tool→file) travel source→target;
        // read (file→tool) travels in reverse.
        const outward = p.write || p.fromOrigin;
        const tt = outward ? p.t : 1 - p.t;
        const px = quad(s.x, cx, d.x, tt);
        const py = quad(s.y, cy, d.y, tt);
        const fade = Math.sin(p.t * Math.PI); // fade in/out at the ends
        const color = p.fromOrigin ? STAGE.toolGlow : p.write ? STAGE.write : STAGE.read;
        const r = (p.fromOrigin ? 2.6 : p.write ? 3.1 : 2.7) / t.k + 0.7;

        // comet tail — a few samples behind along the curve (in travel order)
        if (!reduced) {
          for (let i = 1; i <= 3; i += 1) {
            const tp = p.t - i * 0.05 * p.speed;
            if (tp <= 0 || tp >= 1) continue;
            const ttp = outward ? tp : 1 - tp;
            const tx = quad(s.x, cx, d.x, ttp);
            const ty = quad(s.y, cy, d.y, ttp);
            ctx.globalAlpha = 0.16 * fade * (1 - i / 4);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(tx, ty, r * (1.2 - i * 0.2), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // wide soft glow + colored mid + bright white core
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.7 * fade;
        ctx.beginPath();
        ctx.arc(px, py, r * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = fade;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      particlesRef.current = keep;
      ctx.globalAlpha = 1;

      // ---- hover/selection lift (eased per node) ----
      const hs = hoverScaleRef.current;
      const liftId = hoverRef.current;
      for (const node of map.values()) {
        const target = node.id === liftId ? 1.16 : node.id === selectedRef.current ? 1.08 : 1;
        const cur = hs.get(node.id) ?? 1;
        hs.set(node.id, ease(cur, target, dtSec, reduced ? 1e6 : 12));
      }
      const scaleOf = (id: string): number => hs.get(id) ?? 1;

      // ---- node halos (additive) for tools + hot/focused nodes ----
      for (const node of map.values()) {
        const r = nodeRadius(node) * scaleOf(node.id);
        const isOrigin = node.kind === "origin";
        const hot = node.lastActivityMs > 0 && now - node.lastActivityMs < pulseMs;
        const vis = alphaOf(node.id);
        const wantHalo = isOrigin || node.kind === "tool" || hot || (focus ? focus.has(node.id) : false);
        if (!wantHalo) continue;
        const haloR = r * (isOrigin ? 4 : hot ? 3.6 : 2.7);
        const baseColor = node.errors > 0 ? STAGE.danger : node.kind === "tool" || isOrigin ? STAGE.toolGlow : hsl(node.hue, 78, 66);
        const peak = isOrigin ? 0.5 : hot ? 0.55 : 0.32;
        const g = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, haloR);
        g.addColorStop(0, withAlpha(baseColor, peak * vis));
        g.addColorStop(0.55, withAlpha(baseColor, (isOrigin ? 0.16 : hot ? 0.18 : 0.1) * vis));
        g.addColorStop(1, withAlpha(baseColor, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- node cores (normal compositing, glossy) ----
      ctx.globalCompositeOperation = "source-over";
      for (const node of map.values()) {
        const r = nodeRadius(node) * scaleOf(node.id);
        const vis = alphaOf(node.id);
        ctx.globalAlpha = vis;

        const isOrigin = node.kind === "origin";
        const isTool = node.kind === "tool";
        const isDir = node.kind === "dir";
        const fillL = isTool ? 0 : isDir ? 58 : 50;
        const fillS = isTool ? 0 : isDir ? 55 : 45;
        const rimColor = node.errors > 0 ? STAGE.danger : isTool || isOrigin ? STAGE.toolGlow : hsl(node.hue, isDir ? 70 : 60, isDir ? 78 : 70);

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        if (isOrigin) {
          // Luminous reef core: white centre easing to indigo at the rim.
          const cg = ctx.createRadialGradient(node.x - r * 0.22, node.y - r * 0.26, r * 0.1, node.x, node.y, r);
          cg.addColorStop(0, "#ffffff");
          cg.addColorStop(0.55, "#dfe6ff");
          cg.addColorStop(1, "#9fb0ff");
          ctx.fillStyle = cg;
        } else if (isTool) {
          ctx.fillStyle = STAGE.toolCore;
        } else {
          ctx.fillStyle = hsl(node.hue, fillS, fillL);
        }
        ctx.fill();

        // glossy inner highlight on tools/dirs/focused — a small offset sheen.
        const wantGloss = isOrigin || isTool || isDir || (focus ? focus.has(node.id) : false) || node.id === liftId;
        if (wantGloss) {
          const gg = ctx.createRadialGradient(
            node.x - r * 0.35,
            node.y - r * 0.4,
            r * 0.1,
            node.x,
            node.y,
            r,
          );
          gg.addColorStop(0, withAlpha("#ffffff", 0.55 * vis));
          gg.addColorStop(0.5, withAlpha("#ffffff", 0.06 * vis));
          gg.addColorStop(1, withAlpha("#ffffff", 0));
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.lineWidth = isOrigin ? 1.8 : isTool ? 1.4 : isDir ? 1.3 : 1;
        ctx.strokeStyle = rimColor;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.stroke();

        // origin gets an extra concentric ring — the "everything radiates from
        // here" cue.
        if (isOrigin) {
          ctx.strokeStyle = withAlpha(STAGE.toolGlow, 0.35 * vis);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // animated selection ring — a gentle breathing double-ring.
        if (node.id === selectedRef.current) {
          ctx.globalAlpha = 1;
          const breathe = 0.5 + 0.5 * Math.sin(selectPulseRef.current * 3);
          ctx.strokeStyle = withAlpha(STAGE.toolCore, 0.9);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = withAlpha(STAGE.toolGlow, 0.25 + 0.45 * breathe);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 8 + breathe * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // ---- labels (screen space, constant size, de-overlapped) ----
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textBaseline = "middle";
      const showAllFileLabels = t.k > 1.8;
      const labelIds = labelIdsRef.current;

      // Gather candidates, then place them by priority (focused → tools → dirs →
      // files, each by activity) skipping any that would collide with one
      // already drawn. Keeps the busy core readable instead of a wall of text.
      const candidates: SimNode[] = [];
      for (const node of map.values()) {
        const focused = focusId != null && focus?.has(node.id);
        if (focus && !focus.has(node.id) && !showAllFileLabels) continue;
        if (focused || showAllFileLabels || labelIds.has(node.id)) candidates.push(node);
      }
      const rank = (n: SimNode) =>
        (focus?.has(n.id) ? 3 : 0) + (n.kind === "origin" ? 3 : n.kind === "tool" ? 2 : n.kind === "dir" ? 1 : 0);
      candidates.sort((a, b) => rank(b) - rank(a) || b.runs - a.runs);

      const drawnRects: Array<{ x: number; y: number; w: number; h: number }> = [];
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 4;
      for (const node of candidates) {
        const sx = t.x + node.x * t.k;
        const sy = t.y + node.y * t.k;
        if (sx < -60 || sx > width + 60 || sy < -20 || sy > height + 20) continue;
        const isTool = node.kind === "tool";
        const isDir = node.kind === "dir";
        const r = nodeRadius(node) * t.k;
        const label = isDir && node.fileCount ? `${node.label} ${node.fileCount}` : node.label;
        const lx = sx + r + 5;
        const w = ctx.measureText(label).width;
        const rect = { x: lx - 1, y: sy - 7, w: w + 2, h: 14 };
        const focused = focusId != null && focus?.has(node.id);
        const collides = drawnRects.some(
          (d) => !(rect.x > d.x + d.w || rect.x + rect.w < d.x || rect.y > d.y + d.h || rect.y + rect.h < d.y),
        );
        if (collides && !focused) continue;
        drawnRects.push(rect);
        const isOrigin = node.kind === "origin";
        ctx.globalAlpha = focus ? (focus.has(node.id) ? 1 : 0.1) : isOrigin || isTool ? 1 : isDir ? 0.85 : 0.7;
        ctx.fillStyle = isOrigin || isTool ? STAGE.labelTool : isDir ? STAGE.labelDir : STAGE.labelFile;
        ctx.fillText(label, lx, sy);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // ---- vignette (deepens the edges so the core glows) ----
      const vg = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.35,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72,
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);

      // ---- sonar-scope minimap ----
      drawMinimap(ctx, width, height, map, t, worldBounds());
    };

    const loop = (ts: number) => {
      const last = lastTimeRef.current || ts;
      const dtSec = Math.min(0.05, (ts - last) / 1000); // clamp after tab-away
      lastTimeRef.current = ts;

      const sim = simRef.current;
      if (sim && sim.alpha() > sim.alphaMin()) sim.tick();

      // refit once the layout has cooled after a big population change
      if (fittedCountRef.current === -2 && sim && sim.alpha() < 0.2) {
        fitView();
        fittedCountRef.current = nodeMapRef.current.size;
      }

      const focusId = hoverRef.current ?? selectedRef.current;
      const focus = focusId ? neighboursOf(focusId) : null;
      spawnRings();
      if (!reducedMotionRef.current) emitParticles(dtSec, focusId, focus);
      draw(dtSec);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [neighboursOf, pulseMs, fitView, worldBounds]);

  // --- wheel zoom -----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const tr = transformRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const k = Math.min(6, Math.max(0.15, tr.k * factor));
      const gx = (sx - tr.x) / tr.k;
      const gy = (sy - tr.y) / tr.k;
      transformRef.current = { k, x: sx - gx * k, y: sy - gy * k };
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // --- pointer hit-test + drag/pan -----------------------------------------
  const hitTest = useCallback((sx: number, sy: number): SimNode | null => {
    const tr = transformRef.current;
    const gx = (sx - tr.x) / tr.k;
    const gy = (sy - tr.y) / tr.k;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const node of nodeMapRef.current.values()) {
      const r = nodeRadius(node) + 3;
      const dx = node.x - gx;
      const dy = node.y - gy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 < bestD) {
        best = node;
        bestD = d2;
      }
    }
    return best;
  }, []);

  /** If the point falls inside the minimap, recentre the view there. */
  const minimapJump = useCallback((sx: number, sy: number): boolean => {
    const { width, height } = sizeRef.current;
    const x0 = width - MINIMAP.w - MINIMAP.pad;
    const y0 = height - MINIMAP.h - MINIMAP.pad;
    if (sx < x0 || sx > x0 + MINIMAP.w || sy < y0 || sy > y0 + MINIMAP.h) return false;
    const b = worldBounds();
    if (!b.ok) return true;
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    const inset = 8;
    const scale = Math.min((MINIMAP.w - inset * 2) / w, (MINIMAP.h - inset * 2) / h);
    const ox = x0 + (MINIMAP.w - w * scale) / 2;
    const oy = y0 + (MINIMAP.h - h * scale) / 2;
    const worldX = (sx - ox) / scale + b.minX;
    const worldY = (sy - oy) / scale + b.minY;
    const tr = transformRef.current;
    transformRef.current = { k: tr.k, x: width / 2 - worldX * tr.k, y: height / 2 - worldY * tr.k };
    return true;
  }, [worldBounds]);

  const localPoint = (e: React.PointerEvent): { sx: number; sy: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { sx, sy } = localPoint(e);
    if (minimapJump(sx, sy)) {
      canvasRef.current?.setPointerCapture(e.pointerId);
      panRef.current = { x: sx, y: sy, ox: transformRef.current.x, oy: transformRef.current.y, pointerId: e.pointerId, moved: true };
      return;
    }
    const hit = hitTest(sx, sy);
    canvasRef.current?.setPointerCapture(e.pointerId);
    if (hit) {
      dragRef.current = { id: hit.id, pointerId: e.pointerId, moved: false };
      hit.fx = hit.x;
      hit.fy = hit.y;
      const sim = simRef.current;
      sim?.alpha(Math.max(sim.alpha(), 0.3)).restart().stop();
    } else {
      const tr = transformRef.current;
      panRef.current = { x: sx, y: sy, ox: tr.x, oy: tr.y, pointerId: e.pointerId, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy } = localPoint(e);
    const drag = dragRef.current;
    const pan = panRef.current;
    if (drag) {
      const node = nodeMapRef.current.get(drag.id);
      if (node) {
        const tr = transformRef.current;
        node.fx = (sx - tr.x) / tr.k;
        node.fy = (sy - tr.y) / tr.k;
        drag.moved = true;
        const sim = simRef.current;
        sim?.alpha(Math.max(sim.alpha(), 0.2)).restart().stop();
      }
      return;
    }
    if (pan) {
      const dx = sx - pan.x;
      const dy = sy - pan.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
      transformRef.current = { ...transformRef.current, x: pan.ox + dx, y: pan.oy + dy };
      return;
    }
    const hit = hitTest(sx, sy);
    hoverRef.current = hit?.id ?? null;
    if (hit) {
      setHoverTip({ node: toPlainNode(hit), sx, sy });
      if (canvasRef.current) canvasRef.current.style.cursor = "pointer";
    } else {
      setHoverTip(null);
      if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const pan = panRef.current;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (drag) {
      const node = nodeMapRef.current.get(drag.id);
      if (node) {
        // The origin re-pins to centre on release; everything else floats free.
        const repin = node.kind === "origin";
        node.fx = repin ? 0 : null;
        node.fy = repin ? 0 : null;
        if (!drag.moved) onSelect(toPlainNode(node));
      }
      dragRef.current = null;
      return;
    }
    if (pan) {
      if (!pan.moved) onSelect(null);
      panRef.current = null;
    }
  };

  const onPointerLeave = () => {
    hoverRef.current = null;
    setHoverTip(null);
    if (canvasRef.current) canvasRef.current.style.cursor = "default";
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden" style={{ background: STAGE.bgOuter }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      {/* zoom + fit cluster */}
      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0a1024]/70 backdrop-blur-md shadow-[0_4px_24px_-8px_rgba(0,0,0,0.7)]">
        <ScopeButton label="Zoom in" onClick={() => zoomBy(1.2)}>
          <PlusIcon />
        </ScopeButton>
        <span className="h-px w-full bg-white/10" />
        <ScopeButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <MinusIcon />
        </ScopeButton>
        <span className="h-px w-full bg-white/10" />
        <ScopeButton label="Fit to view" onClick={() => fitView()}>
          <FitIcon />
        </ScopeButton>
      </div>

      {hoverTip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[280px] rounded-lg border border-white/12 bg-[#0a1024]/95 px-2.5 py-1.5 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.8)] backdrop-blur-md"
          style={{ left: Math.min(hoverTip.sx + 12, (sizeRef.current.width || 0) - 220), top: hoverTip.sy + 12 }}
        >
          <div className="break-all font-mono text-[11px] text-white">{hoverTip.node.title}</div>
          <div className="mt-0.5 text-[10.5px] text-white/55">
            {hoverTip.node.kind === "tool"
              ? "tool"
              : hoverTip.node.kind === "dir"
                ? `folder · ${hoverTip.node.fileCount ?? 0} files`
                : "file"}
            {" · "}
            {hoverTip.node.runs} {hoverTip.node.kind === "tool" ? "calls" : "touches"}
            {hoverTip.node.errors > 0 ? ` · ${hoverTip.node.errors} failed` : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Atmosphere + minimap helpers (pure canvas)
// =============================================================================

function seedMotes(motes: Mote[], width: number, height: number): void {
  const target = Math.round((width * height) / 14000);
  if (motes.length === target) return;
  motes.length = 0;
  for (let i = 0; i < target; i += 1) {
    motes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.5 + Math.random() * 1.4,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5 - 3, // drift gently upward like marine snow
      tw: Math.random() * Math.PI * 2,
    });
  }
}

function drawMotes(
  ctx: CanvasRenderingContext2D,
  motes: Mote[],
  width: number,
  height: number,
  dtSec: number,
  reduced: boolean,
  now: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const m of motes) {
    if (!reduced) {
      m.x += m.vx * dtSec;
      m.y += m.vy * dtSec;
      if (m.x < -4) m.x = width + 4;
      if (m.x > width + 4) m.x = -4;
      if (m.y < -4) m.y = height + 4;
      if (m.y > height + 4) m.y = -4;
    }
    const tw = reduced ? 0.5 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 0.001 + m.tw));
    ctx.fillStyle = `rgba(150, 180, 255, ${0.05 * tw})`;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  map: Map<string, SimNode>,
  t: { k: number; x: number; y: number },
  b: { minX: number; minY: number; maxX: number; maxY: number; ok: boolean },
): void {
  if (!b.ok || map.size < 6) return;
  const x0 = width - MINIMAP.w - MINIMAP.pad;
  const y0 = height - MINIMAP.h - MINIMAP.pad;
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const inset = 8;
  const scale = Math.min((MINIMAP.w - inset * 2) / w, (MINIMAP.h - inset * 2) / h);
  const ox = x0 + (MINIMAP.w - w * scale) / 2;
  const oy = y0 + (MINIMAP.h - h * scale) / 2;

  // frosted panel
  ctx.save();
  roundRect(ctx, x0, y0, MINIMAP.w, MINIMAP.h, 8);
  ctx.fillStyle = "rgba(8, 13, 30, 0.62)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();

  // nodes
  for (const node of map.values()) {
    const px = ox + (node.x - b.minX) * scale;
    const py = oy + (node.y - b.minY) * scale;
    ctx.fillStyle =
      node.kind === "origin"
        ? "rgba(255, 255, 255, 0.95)"
        : node.kind === "tool"
          ? "rgba(231, 236, 255, 0.9)"
          : node.errors > 0
            ? "rgba(255, 107, 107, 0.85)"
            : hsl(node.hue, 70, 66, 0.75);
    ctx.beginPath();
    ctx.arc(px, py, node.kind === "origin" ? 2.4 : node.kind === "tool" ? 1.8 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // current viewport rectangle (world rect currently on screen)
  const vMinX = (0 - t.x) / t.k;
  const vMinY = (0 - t.y) / t.k;
  const vMaxX = (width - t.x) / t.k;
  const vMaxY = (height - t.y) / t.k;
  const rx = ox + (vMinX - b.minX) * scale;
  const ry = oy + (vMinY - b.minY) * scale;
  const rw = (vMaxX - vMinX) * scale;
  const rh = (vMaxY - vMinY) * scale;
  ctx.strokeStyle = "rgba(147, 168, 255, 0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.fillStyle = "rgba(147, 168, 255, 0.08)";
  ctx.fillRect(rx, ry, rw, rh);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// =============================================================================
// Small UI atoms
// =============================================================================

function ScopeButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M2 6.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M2 4.5V2.5h2M11 4.5V2.5H9M2 8.5v2h2M11 8.5v2H9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A d3 custom force that eases each node toward its lobe/centre anchor. */
function makeAnchorForce(
  anchorFor: (n: SimNode) => { x: number; y: number; strength: number },
): Force<SimNode, SimLink> {
  let nodes: SimNode[] = [];
  const force: Force<SimNode, SimLink> = (alpha: number) => {
    for (const n of nodes) {
      if (n.fx != null || n.fy != null) continue;
      const a = anchorFor(n);
      n.vx += (a.x - n.x) * a.strength * alpha;
      n.vy += (a.y - n.y) * a.strength * alpha;
    }
  };
  force.initialize = (n: SimNode[]) => {
    nodes = n;
  };
  return force;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("hsl")) {
    return color.replace(/hsla?\(([^)]+)\)/, (_m, inner: string) => {
      const parts = inner.split(",").slice(0, 3).map((s) => s.trim());
      return `hsla(${parts.join(", ")}, ${alpha})`;
    });
  }
  // hex → rgba
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function toPlainNode(n: SimNode): FlowNode {
  return {
    id: n.id,
    kind: n.kind,
    label: n.label,
    title: n.title,
    runs: n.runs,
    errors: n.errors,
    lastActivityMs: n.lastActivityMs,
    dir: n.dir,
    fileCount: n.fileCount,
  };
}
