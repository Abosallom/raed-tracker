// Back-navigation bar for sub-pages: a single ≥44x44 tap target wrapping the
// ‹ chevron and a "Back" label. The visible text is always "Back" — labeling
// the chip with the current page's name read as a destination ("‹ Import" on
// the import page). `title` still enriches the accessible name.

import { useNavigate } from 'react-router-dom'

export function BackBar({ title }: { title?: string }) {
  const navigate = useNavigate()
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        aria-label={title ? `Go back — leave ${title}` : 'Go back'}
        onClick={() => {
          if (window.history.length > 1) navigate(-1)
          else navigate('/shows')
        }}
        style={{
          // Grow the hit area to ≥44px tall (padding), keep the glyph small.
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          padding: '6px 14px 6px 10px',
          borderRadius: 10,
          color: 'var(--text)',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          maxWidth: '100%',
        }}
      >
        <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
          ‹
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: 15,
            color: 'var(--text-dim)',
            whiteSpace: 'nowrap',
          }}
        >
          Back
        </span>
      </button>
    </div>
  )
}
