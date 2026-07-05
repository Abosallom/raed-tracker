// Lightweight CSS-only confetti burst — same module pattern as toast.tsx:
// call fireConfetti() from anywhere; <ConfettiHost /> (mounted on detail
// pages) renders a ~1.6s burst of falling particles, then unmounts itself.
// Skipped entirely when the user prefers reduced motion.

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

type Listener = (burstId: number) => void

let listener: Listener | null = null
let nextBurstId = 1

/** Fire a confetti burst (no-op if no host is mounted or reduced motion is on). */
export function fireConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  listener?.(nextBurstId++)
}

const COLORS = ['var(--accent)', 'var(--green)', '#f472b6'] // accent / green / pink

const PARTICLE_COUNT = 36
const BURST_MS = 1600

interface Particle {
  left: number // vw-ish percent across the viewport
  size: number // px
  color: string
  delay: number // s
  duration: number // s
  drift: number // px of horizontal wander while falling
  rot: number // total degrees of rotation
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    left: Math.random() * 100,
    size: 6 + Math.random() * 6,
    color: COLORS[i % COLORS.length]!,
    delay: Math.random() * 0.25,
    duration: 1.0 + Math.random() * 0.35, // delay + duration stays within ~1.6s
    drift: (Math.random() - 0.5) * 160,
    rot: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
  }))
}

function Burst({ onDone }: { onDone: () => void }) {
  const particles = useMemo(makeParticles, [])

  useEffect(() => {
    const t = window.setTimeout(onDone, BURST_MS)
    return () => window.clearTimeout(t)
  }, [onDone])

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

/** Mount once per page that wants confetti (ShowDetail / MovieDetail). */
export function ConfettiHost() {
  const [burstId, setBurstId] = useState<number | null>(null)

  useEffect(() => {
    const l: Listener = (id) => setBurstId(id)
    listener = l
    return () => {
      if (listener === l) listener = null
    }
  }, [])

  if (burstId == null) return null
  return <Burst key={burstId} onDone={() => setBurstId(null)} />
}
