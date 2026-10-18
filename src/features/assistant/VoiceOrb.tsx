import { useEffect, useRef } from "react";

export type OrbMode = "connecting" | "listening" | "thinking" | "speaking" | "muted";

/**
 * A living orb drawn on canvas.
 * Listening follows the microphone level, thinking swirls, speaking pulses like a voice.
 */
export function VoiceOrb({ mode, level, size = 220 }: { mode: OrbMode; level: number; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, level });
  live.current = { mode, level };

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    node.width = size * dpr;
    node.height = size * dpr;
    ctx.scale(dpr, dpr);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frame = 0;
    let smooth = 0;
    let energy = 0;
    let spin = 0;
    const start = performance.now();

    const palette: Record<OrbMode, [string, string, string]> = {
      connecting: ["#c7d2fe", "#818cf8", "#4338ca"],
      listening: ["#e0f2fe", "#38bdf8", "#4f46e5"],
      thinking: ["#f5d0fe", "#a78bfa", "#4f46e5"],
      speaking: ["#ecfeff", "#22d3ee", "#6366f1"],
      muted: ["#e2e8f0", "#94a3b8", "#475569"],
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const { mode: m, level: raw } = live.current;
      // Speaking has no output level from the SDK, so synthesize a voice-like envelope.
      const synthetic = m === "speaking" ? 0.35 + 0.3 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1)) : 0;
      const target = m === "muted" || m === "connecting" ? 0.04 : m === "thinking" ? 0.12 : Math.max(Math.min(raw * 2.2, 1), synthetic);
      smooth += (target - smooth) * 0.18;
      energy += (smooth - energy) * 0.05;
      spin += m === "thinking" ? 0.035 : 0.008;

      const c = size / 2;
      const base = size * 0.27;
      ctx.clearRect(0, 0, size, size);
      const [light, mid, deep] = palette[m];

      // Soft halo.
      const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, Math.min(size * 0.49, base * (1.6 + energy * 0.5)));
      halo.addColorStop(0, hexA(mid, 0.35 + energy * 0.25));
      halo.addColorStop(1, hexA(mid, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // Ripple rings while the user talks.
      if (m === "listening" && !reduced) {
        for (let i = 0; i < 3; i++) {
          const p = (t * 0.6 + i / 3) % 1;
          ctx.beginPath();
          ctx.arc(c, c, Math.min(size * 0.48, base * (1.05 + p * (0.55 + smooth * 0.5))), 0, Math.PI * 2);
          ctx.strokeStyle = hexA(light, (1 - p) * (0.15 + smooth * 0.5));
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Three blended lobes make the surface feel alive.
      ctx.globalCompositeOperation = "lighter";
      for (let layer = 0; layer < 3; layer++) {
        const points = 96;
        const phase = spin * (layer + 1) * (layer % 2 ? -1 : 1) + layer * 2.1;
        const amp = base * (0.035 + smooth * 0.15) * (1 - layer * 0.2);
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const a = (i / points) * Math.PI * 2;
          const wobble = reduced
            ? 0
            : Math.sin(a * 3 + phase + t * 1.3) * amp + Math.sin(a * 5 - phase * 1.4 + t * 2.1) * amp * 0.5 + Math.sin(a * 2 + t * 0.7 + layer) * base * 0.03;
          const r = base * (0.92 + layer * 0.04) + wobble;
          const x = c + Math.cos(a) * r;
          const y = c + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const g = ctx.createRadialGradient(c - base * 0.35, c - base * 0.4, base * 0.05, c, c, base * 1.25);
        g.addColorStop(0, hexA(light, 0.42));
        g.addColorStop(0.5, hexA(mid, 0.32));
        g.addColorStop(1, hexA(deep, 0.38));
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Specular highlight.
      const shine = ctx.createRadialGradient(c - base * 0.35, c - base * 0.45, 0, c - base * 0.35, c - base * 0.45, base * 0.6);
      shine.addColorStop(0, "rgba(255,255,255,0.35)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(c, c, base * 0.95, 0, Math.PI * 2);
      ctx.fill();

      // Thinking: an orbiting spark.
      if (m === "thinking" || m === "connecting") {
        for (let i = 0; i < 3; i++) {
          const a = spin * 3 + (i * Math.PI * 2) / 3;
          const r = base * 1.28;
          ctx.beginPath();
          ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 2.6 - i * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = hexA(light, 0.9 - i * 0.2);
          ctx.fill();
        }
      }

      if (!reduced || m === "thinking") frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return <canvas ref={canvas} style={{ width: size, height: size }} aria-hidden="true" />;
}

function hexA(hex: string, alpha: number) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${Math.max(0, Math.min(1, alpha))})`;
}

/** Thin live bars under the captions. */
export function VoiceBars({ mode, level }: { mode: OrbMode; level: number }) {
  const bars = 28;
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ mode, level });
  live.current = { mode, level };
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const { mode: m, level: l } = live.current;
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        const center = 1 - Math.abs(i - bars / 2) / (bars / 2);
        let h = 0.08;
        if (m === "listening") h = 0.08 + Math.min(l * 2.4, 1) * center * (0.55 + 0.45 * Math.sin(t * 9 + i * 0.9));
        if (m === "speaking") h = 0.12 + center * (0.35 + 0.35 * Math.abs(Math.sin(t * 6.5 + i * 0.55) * Math.sin(t * 2.3 + i)));
        if (m === "thinking") h = 0.08 + 0.18 * Math.max(0, Math.sin(t * 4 - i * 0.45));
        (children[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.06, Math.min(1, h))})`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div ref={ref} className="flex h-7 items-center justify-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} className="h-full w-[3px] origin-center scale-y-[0.08] rounded-full bg-gradient-to-t from-indigo-400 to-cyan-300 transition-transform duration-75" />
      ))}
    </div>
  );
}
