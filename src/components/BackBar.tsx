// Back-navigation bar for sub-pages: ‹ chevron + optional title.

import { useNavigate } from 'react-router-dom'

export function BackBar({ title }: { title?: string }) {
  const navigate = useNavigate()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
        minHeight: 34,
      }}
    >
      <button
        aria-label="Go back"
        onClick={() => {
          if (window.history.length > 1) navigate(-1)
          else navigate('/shows')
        }}
        style={{
          fontSize: 22,
          lineHeight: 1,
          padding: '4px 10px',
          borderRadius: 8,
          color: 'var(--text)',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
        }}
      >
        ‹
      </button>
      {title && (
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-dim)' }}>{title}</span>
      )}
    </div>
  )
}
