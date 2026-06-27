/**
 * Neural-network view of tool↔file activity.
 *
 * Rendered to a canvas on a dark "stage". The layout is deliberately legible
 * rather than a free hairball: tool nodes form a luminous central nucleus and
 * each directory is anchored as its own colored lobe on a ring around it, so
 * the structure reads at a glance. Signals (pulses) travel the connections —
 * cyan inward when a tool reads a file, amber outward when it writes — which is
 * what gives it the "neurons firing across a network" feel.
 *
 * d3-force supplies the physics (charge / links / collision); a custom anchor
 * force pins tools to the centre and files/dirs to their lobe. Everything drawn
 * is hand-rolled canvas with additive glow. Positions persist across updates so
 * live activity eases in instead of reshuffling.
 *
 * Interactions: scroll to zoom, drag background to pan, drag a node to move it,
 * hover for a tooltip, click to focus a node's circuit (its edges light up and
 * fire harder while the rest dims), Fit to recentre.
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
  bgOuter: "#05070f",
  toolCore: "#eef2ff",
  toolGlow: "#8aa6ff",
  edge: "#9fb4ff",
  read: "#7fe7ff", // cyan, file→tool
  write: "#ffc16b", // amber, tool→file
  danger: "#ff6b6b",
  labelTool: "#e7ecff",
  labelDir: "#aeb9e0",
  labelFile: "#8b97c4",
};

const DIR_HUES = [218, 190, 265, 320, 200, 145, 35, 8, 285, 160, 50, 330, 175, 240];

function dirHue(dir: string | undefined, index: number): number {
  if (!dir) return 220;
  return DIR_HUES[index % DIR_HUES.length]!;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function nodeRadius(n: { kind: FlowNodeKind; runs: number }): number {
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

  const fitView = useCallback(() => {
    const { width, height } = sizeRef.current;
    const nodes = [...nodeMapRef.current.values()];
    if (!width || !height || nodes.length === 0) return;
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
    const pad = 90;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const k = Math.min(3, Math.max(0.18, Math.min((width - pad) / w, (height - pad) / h)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    transformRef.current = { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
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
      const hue = gn.kind === "tool" ? -1 : dirHue(gn.dir, gn.dir ? dirIndex.get(gn.dir) ?? 0 : 0);
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
          x: baseX + (Math.random() - 0.5) * 60,
          y: baseY + (Math.random() - 0.5) * 60,
          vx: 0,
          vy: 0,
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
    nodes.filter((n) => n.kind === "tool").sort(byRuns).slice(0, 14).forEach((n) => labelIds.add(n.id));
    nodes.filter((n) => n.kind === "dir").sort(byRuns).slice(0, 12).forEach((n) => labelIds.add(n.id));
    labelIdsRef.current = labelIds;

    // prune emission accumulators for edges that vanished
    const liveEdgeIds = new Set(links.map((l) => l.id));
    for (const id of [...emitAccRef.current.keys()]) {
      if (!liveEdgeIds.has(id)) emitAccRef.current.delete(id);
    }
    particlesRef.current = particlesRef.current.filter((p) => liveEdgeIds.has(p.edgeId));

    if (!simRef.current) {
      const anchor = makeAnchorForce(anchorFor);
      simRef.current = forceSimulation<SimNode>(nodes)
        .force("charge", forceManyBody<SimNode>().strength(-260).distanceMax(680))
        .force(
          "link",
          forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance((l) => 60 + 16 * Math.log2((l.weight ?? 1) + 1))
            .strength(0.22),
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
      if (first) transformRef.current = { k: 1, x: width / 2, y: height / 2 };
    };

    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

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
        const norm = 0.25 + 0.75 * (link.weight / maxW);
        const hot = link.lastActivityMs > 0 && now - link.lastActivityMs < pulseMs ? 4 : 1;
        let emphasis = ambient * norm * hot;
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
          });
        }
        acc.set(link.id, next);
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
      const focusId = hoverRef.current ?? selectedRef.current;
      const focus = focusId ? neighboursOf(focusId) : null;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ---- dark stage background ----
      const grad = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.05,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.75,
      );
      grad.addColorStop(0, STAGE.bgInner);
      grad.addColorStop(1, STAGE.bgOuter);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);
      ctx.lineCap = "round";

      // ---- edges (additive faint glow, curved) ----
      ctx.globalCompositeOperation = "lighter";
      for (const link of links) {
        const s = asNode(link.source, map);
        const d = asNode(link.target, map);
        if (!s || !d) continue;
        const active = !focus || focus.has(s.id) && (s.id === focusId || d.id === focusId);
        const { cx, cy } = edgeGeometry(s, d, bowSign(link.id));
        const hue = d.hue >= 0 ? d.hue : s.hue >= 0 ? s.hue : 220;
        ctx.strokeStyle = hsl(hue, 70, 70, focus ? (active ? 0.5 : 0.04) : 0.16);
        ctx.lineWidth = (0.5 + Math.log2(link.weight + 1) * 0.5) / t.k + 0.3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(cx, cy, d.x, d.y);
        ctx.stroke();
      }

      // ---- particles (the firing signals) ----
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
        // write: tool(source)→file(target); read: file→tool (reverse travel)
        const tt = p.write ? p.t : 1 - p.t;
        const px = quad(s.x, cx, d.x, tt);
        const py = quad(s.y, cy, d.y, tt);
        const fade = Math.sin(p.t * Math.PI); // fade in/out at the ends
        const color = p.write ? STAGE.write : STAGE.read;
        const r = (p.write ? 3.1 : 2.7) / t.k + 0.7;
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

      // ---- node halos (additive) for tools + hot/focused nodes ----
      for (const node of map.values()) {
        const r = nodeRadius(node);
        const hot = node.lastActivityMs > 0 && now - node.lastActivityMs < pulseMs;
        const focused = !focus || focus.has(node.id);
        const wantHalo = node.kind === "tool" || hot || (focus ? focus.has(node.id) : false);
        if (!wantHalo) continue;
        const haloR = r * (hot ? 3.4 : 2.6);
        const baseColor = node.errors > 0 ? STAGE.danger : node.kind === "tool" ? STAGE.toolGlow : hsl(node.hue, 75, 65);
        const g = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, haloR);
        g.addColorStop(0, withAlpha(baseColor, focused ? (hot ? 0.55 : 0.32) : 0.05));
        g.addColorStop(1, withAlpha(baseColor, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloR, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- node cores (normal compositing) ----
      ctx.globalCompositeOperation = "source-over";
      for (const node of map.values()) {
        const r = nodeRadius(node);
        const focused = !focus || focus.has(node.id);
        ctx.globalAlpha = focused ? 1 : 0.18;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        if (node.kind === "tool") {
          ctx.fillStyle = STAGE.toolCore;
          ctx.fill();
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = node.errors > 0 ? STAGE.danger : STAGE.toolGlow;
          ctx.stroke();
        } else if (node.kind === "dir") {
          ctx.fillStyle = hsl(node.hue, 55, 58);
          ctx.fill();
          ctx.lineWidth = 1.3;
          ctx.strokeStyle = node.errors > 0 ? STAGE.danger : hsl(node.hue, 70, 78);
          ctx.stroke();
        } else {
          ctx.fillStyle = hsl(node.hue, 45, 50);
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = node.errors > 0 ? STAGE.danger : hsl(node.hue, 60, 70, 0.8);
          ctx.stroke();
        }

        if (node.id === selectedRef.current) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = STAGE.toolCore;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
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
      const rank = (n: SimNode) => (focus?.has(n.id) ? 3 : 0) + (n.kind === "tool" ? 2 : n.kind === "dir" ? 1 : 0);
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
        ctx.globalAlpha = focus ? (focus.has(node.id) ? 1 : 0.12) : isTool ? 1 : isDir ? 0.85 : 0.7;
        ctx.fillStyle = isTool ? STAGE.labelTool : isDir ? STAGE.labelDir : STAGE.labelFile;
        ctx.fillText(label, lx, sy);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
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
      emitParticles(dtSec, focusId, focus);
      draw(dtSec);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [neighboursOf, pulseMs, fitView]);

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

  const localPoint = (e: React.PointerEvent): { sx: number; sy: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { sx, sy } = localPoint(e);
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
        node.fx = null;
        node.fy = null;
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
      <button
        type="button"
        onClick={() => fitView()}
        className="absolute right-3 top-3 z-10 h-7 rounded-md border border-white/15 bg-white/5 px-2.5 text-[11px] text-white/80 backdrop-blur transition-colors hover:bg-white/10 hover:text-white"
      >
        Fit
      </button>
      {hoverTip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[280px] rounded-md border border-white/15 bg-[#0c1226]/95 px-2.5 py-1.5 shadow-lg"
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
