// Lightweight CSS-only confetti burst — same module pattern as toast.tsx:
// call fireConfetti() from anywhere; <ConfettiHost /> (mounted once at the app
// root) renders a burst of falling particles, then unmounts itself.
// Skipped entirely when the user prefers reduced motion.

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

export type ConfettiIntensity = 'full' | 'micro' | 'sparkle'

interface BurstSpec {
  id: number
  intensity: ConfettiIntensity
}

type Listener = (spec: BurstSpec) => void

let listener: Listener | null = null
let nextBurstId = 1
// Guard against rapid-fire calls (e.g. a fast series of check-offs): while a
// burst is on screen we ignore new requests rather than stacking overlapping
// hosts. `busyUntil` is a wall-clock deadline so the guard self-clears even if
// the host unmounts without notifying us.
let busyUntil = 0

/**
 * Fire a confetti burst (no-op if no host is mounted or reduced motion is on).
 * `intensity: 'micro'` is a smaller, faster celebration (~900ms) for the many
 * everyday check-off moments (premieres, finales, every-10th milestone);
 * `'sparkle'` is a tiny 12-particle twinkle (~700ms) for lightweight feedback;
 * the default 'full' burst stays reserved for big completions.
 *
 * Safe to call rapidly: while a burst is already playing, extra calls are
 * ignored (rather than stacking) until the active burst finishes.
 */
export function fireConfetti(opts?: { intensity?: ConfettiIntensity }) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const now = Date.now()
  if (now < busyUntil) return // a burst is already on screen — ignore
  const intensity = opts?.intensity ?? 'full'
  busyUntil = now + BURST_MS[intensity]
  listener?.({ id: nextBurstId++, intensity })
}

const COLORS = ['var(--accent)', 'var(--green)', '#f472b6'] // accent / green / pink

const PARTICLE_COUNT: Record<ConfettiIntensity, number> = {
  full: 36,
  micro: 16,
  sparkle: 12,
}

const BURST_MS: Record<ConfettiIntensity, number> = {
  full: 1600,
  micro: 900,
  sparkle: 700,
}

interface Particle {
  left: number // vw-ish percent across the viewport
  size: number // px
  color: string
  delay: number // s
  duration: number // s
  drift: number // px of horizontal wander while falling
  rot: number // total degrees of rotation
}

function makeParticles(intensity: ConfettiIntensity): Particle[] {
  const count = PARTICLE_COUNT[intensity]
  const small = intensity !== 'full'
  const sparkle = intensity === 'sparkle'
  return Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    size: sparkle ? 4 + Math.random() * 4 : 6 + Math.random() * 6,
    color: COLORS[i % COLORS.length]!,
    delay: Math.random() * (sparkle ? 0.08 : small ? 0.12 : 0.25),
    // delay + duration stays within the burst window for each intensity.
    duration: sparkle
      ? 0.45 + Math.random() * 0.18
      : small
        ? 0.6 + Math.random() * 0.2
        : 1.0 + Math.random() * 0.35,
    drift: (Math.random() - 0.5) * (sparkle ? 80 : small ? 110 : 160),
    rot: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
  }))
}

function Burst({ intensity, onDone }: { intensity: ConfettiIntensity; onDone: () => void }) {
  const particles = useMemo(() => makeParticles(intensity), [intensity])

  useEffect(() => {
    const t = window.setTimeout(onDone, BURST_MS[intensity])
    return () => window.clearTimeout(t)
  }, [onDone, intensity])

  return (
    <div className="rt-confetti" aria-hidden="true">
      <style>{`
        .rt-confetti {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 200;
        }
        .rt-confetti-piece {
          position: absolute;
          top: -16px;
          border-radius: 2px;
          opacity: 0;
          animation: rt-confetti-fall linear both;
          will-change: transform, opacity;
        }
        @keyframes rt-confetti-fall {
          0% {
            transform: translate3d(0, -3vh, 0) rotate(0deg);
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            transform: translate3d(var(--rt-drift), 104vh, 0) rotate(var(--rt-rot));
            opacity: 0.6;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .rt-confetti {
            display: none;
          }
        }
      `}</style>
      {particles.map((p, i) => (
        <span
          key={i}
          className="rt-confetti-piece"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              '--rt-drift': `${p.drift}px`,
              '--rt-rot': `${p.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** Mounted once at the app root (App.tsx) so every check-off path is covered. */
export function ConfettiHost() {
  const [burst, setBurst] = useState<BurstSpec | null>(null)

  useEffect(() => {
    const l: Listener = (spec) => setBurst(spec)
    listener = l
    return () => {
      if (listener === l) listener = null
    }
  }, [])

  if (burst == null) return null
  return (
    <Burst
      key={burst.id}
      intensity={burst.intensity}
      onDone={() => {
        // Clear the busy guard so a subsequent celebration can fire immediately.
        busyUntil = 0
        setBurst(null)
      }}
    />
  )
}
