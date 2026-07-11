// Library health: detect import-stamped watch dates.
//
// An import whose source rows lacked dates stamps every record with the
// import moment. Those records cluster in one narrow time window ACROSS MANY
// SHOWS — something real viewing never does (mark-season/catch-up bursts stay
// within one show). Shows whose most-recent record sits inside such a burst
// have a meaningless ordering key, which scrambles Keep Watching vs the
// user's real history. The cure is re-importing a dated export (bulkImport
// repairs earlier real dates in place); this detector tells the user to.

import type { TrackedShow } from '../types'

/** A minute-bucket counts as an import burst past these thresholds. */
const MIN_SHOWS_IN_BURST = 5
const MIN_RECORDS_IN_BURST = 25

export interface StampedImportReport {
  /** Shows whose ORDERING KEY (max watchedAt) is an import stamp. */
  affectedShows: number
  /** Total records inside burst buckets. */
  stampedRecords: number
}

export function detectStampedImport(
  shows: Record<number, TrackedShow>,
): StampedImportReport | null {
  // minute-bucket -> { records, showIds }
  const buckets = new Map<string, { records: number; showIds: Set<number> }>()
  for (const s of Object.values(shows)) {
    for (const rec of Object.values(s.watched)) {
      const bucket = rec.watchedAt.slice(0, 16) // YYYY-MM-DDTHH:MM
      let b = buckets.get(bucket)
      if (!b) {
        b = { records: 0, showIds: new Set() }
        buckets.set(bucket, b)
      }
      b.records++
      b.showIds.add(s.snapshot.id)
    }
  }
  const burstBuckets = new Set<string>()
  for (const [key, b] of buckets) {
    if (b.showIds.size >= MIN_SHOWS_IN_BURST && b.records >= MIN_RECORDS_IN_BURST) {
      burstBuckets.add(key)
    }
  }
  if (burstBuckets.size === 0) return null

  let affectedShows = 0
  let stampedRecords = 0
  for (const s of Object.values(shows)) {
    let max = ''
    let maxBucket = ''
    for (const rec of Object.values(s.watched)) {
      if (rec.watchedAt > max) {
        max = rec.watchedAt
        maxBucket = rec.watchedAt.slice(0, 16)
      }
      if (burstBuckets.has(rec.watchedAt.slice(0, 16))) stampedRecords++
    }
    if (max && burstBuckets.has(maxBucket)) affectedShows++
  }
  // A couple of shows tying at an import moment is normal (they were truly
  // watched around import time); a pile of them means broken ordering.
  return affectedShows >= MIN_SHOWS_IN_BURST ? { affectedShows, stampedRecords } : null
}
