// Global offline indicator — a thin fixed banner that slides down from the
// top edge while `navigator.onLine` is false. Mounted once into a dedicated
// body-level root by initInstallUx() (src/lib/install.ts), so it covers every
// route without living in the app tree. Local tracking keeps working offline
// (zustand persist); only TMDB browsing and Supabase sync need the network.

import { useEffect, useState } from 'react'
import './offline-banner.css'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(() => !navigator.onLine)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  // Kept mounted so the slide-out transition can play; visibility is toggled
  // in CSS (with a matching delay) so the hidden banner leaves the a11y tree.
  return (
    <div className={`offline-banner${offline ? ' on' : ''}`} role="status" aria-hidden={!offline}>
      <span className="offline-banner-emoji" aria-hidden="true">
        📴
      </span>
      <span>
        <b>Offline</b> — your tracking still works; browsing needs internet
      </span>
    </div>
  )
}
