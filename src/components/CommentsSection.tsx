// Comment thread for a show, episode, or movie. Community comments are
// seeded locally in demo fashion; the user's own comments persist in the store.

import { useMemo, useState } from 'react'
import type { Comment } from '../types'
import { useLibrary } from '../store/library'
import { mockComments } from '../api/mockData'
import { timeAgo } from './shared'

export function CommentsSection({ mediaKey, title }: { mediaKey: string; title?: string }) {
  const comments = useLibrary((s) => s.comments)
  const addComment = useLibrary((s) => s.addComment)
  const deleteComment = useLibrary((s) => s.deleteComment)
  const toggleLike = useLibrary((s) => s.toggleLike)
  const profile = useLibrary((s) => s.profile)
  const [text, setText] = useState('')
  const [seedLikes, setSeedLikes] = useState<Record<string, boolean>>({})

  const seeded: Comment[] = useMemo(
    () =>
      mockComments(mediaKey).map((c, i) => ({
        id: `seed_${mediaKey}_${i}`,
        mediaKey,
        author: c.author,
        avatar: c.avatar,
        text: c.text,
        createdAt: new Date(Date.now() - c.daysAgo * 86400_000).toISOString(),
        likes: c.likes,
        likedByMe: false,
        isMine: false,
      })),
    [mediaKey],
  )

  const mine = comments.filter((c) => c.mediaKey === mediaKey)
  const all = [...mine, ...seeded]

  return (
    <div>
      <div className="section-title">{title ?? `Comments (${all.length})`}</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 26 }}>{profile.avatar}</div>
        <input
          style={{ flex: 1 }}
          placeholder="Share your thoughts… (no spoilers!)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              addComment(mediaKey, text.trim())
              setText('')
            }
          }}
        />
        <button
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => {
            if (text.trim()) {
              addComment(mediaKey, text.trim())
              setText('')
            }
          }}
        >
          Post
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {all.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 10 }}>
            <div style={{ fontSize: 24 }}>{c.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5 }}>
                <b>{c.author}</b>{' '}
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                  · {timeAgo(c.createdAt)}
                </span>
              </div>
              <div style={{ margin: '2px 0 4px' }}>{c.text}</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--text-dim)' }}>
                <button
                  onClick={() =>
                    c.id.startsWith('seed_')
                      ? setSeedLikes((p) => ({ ...p, [c.id]: !p[c.id] }))
                      : toggleLike(c.id)
                  }
                  style={{
                    color:
                      c.likedByMe || seedLikes[c.id] ? 'var(--accent-hover)' : 'inherit',
                  }}
                >
                  ♥ {c.likes + (seedLikes[c.id] ? 1 : 0)}
                </button>
                {c.isMine && (
                  <button onClick={() => deleteComment(c.id)} style={{ color: 'var(--text-faint)' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {all.length === 0 && (
          <div style={{ color: 'var(--text-dim)' }}>Be the first to comment.</div>
        )}
      </div>
    </div>
  )
}
