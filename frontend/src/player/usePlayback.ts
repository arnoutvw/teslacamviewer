import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventDetailDto, SegmentDto } from '../api/client'
import {
  DRIFT_CORRECTION_SECONDS,
  eventPointMs,
  findSegmentAt,
  startPositionMs,
  timestampMs,
  timelineBoundsMs,
  videoAbsoluteMs,
  type SegmentAssignment,
} from './syncClock'

/** Default order mirrors backend teslacam.camera-order; backend doesn't expose it to clients. */
export const CAMERAS = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'] as const

const MASTER = 'front'
/** On 'ended' (real segment shorter than its estimate) the clock is nudged this far ahead. */
const END_STEP_SECONDS = 1

export interface PlaybackState {
  ready: boolean
  playing: boolean
  positionMs: number
  eventMs: number
  timeline: { startMs: number; endMs: number }
  toggle(): void
  seekTo(absoluteMs: number): void
  skip(deltaSeconds: number): void
  speed: number
  setSpeed(s: number): void
  assignments: Record<string, SegmentAssignment | null>
  seeking: Record<string, boolean>
  bindCamera(camera: string): (el: HTMLVideoElement | null) => void
}

/** Change signature per camera: segment start + rounded offset. */
function assignmentKey(a: SegmentAssignment | null): string {
  return a == null ? 'none' : `${a.segment.start}|${Math.round(a.offsetSeconds)}`
}

export function usePlayback(detail: EventDetailDto | null): PlaybackState {
  const elements = useRef<Record<string, HTMLVideoElement | null>>({})
  /** Segment URL each element is currently loaded with. */
  const loaded = useRef<Record<string, string | null>>({})
  /** Offset still to seek to once a (re)loaded element's metadata is ready. */
  const pendingOffset = useRef<Record<string, number>>({})
  const position = useRef(0)
  /** Mirror of `playing` for callbacks registered before the latest render. */
  const playingRef = useRef(false)
  /** Last assignment key per camera; guards the per-frame rAF state updates. */
  const lastKeys = useRef<Record<string, string>>({})
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState(1)
  /** Mirror of `speed` for ref callbacks and media-event handlers. */
  const speedRef = useRef(1)
  const [positionMs, setPositionMs] = useState(0)
  const [assignments, setAssignments] = useState<Record<string, SegmentAssignment | null>>({})
  const [seeking, setSeeking] = useState<Record<string, boolean>>({})

  const cameraSegments = useRef<Record<string, SegmentDto[]>>({})
  const bounds = useRef({ startMs: 0, endMs: 0 })

  // (Re)initialize when a new detail arrives.
  useEffect(() => {
    if (detail == null) return
    bounds.current = timelineBoundsMs(detail.timeline)
    cameraSegments.current = Object.fromEntries(
      Object.entries(detail.segmentsByCamera).map(([cam, list]) => [
        cam,
        [...list].sort((a, b) => timestampMs(a.start) - timestampMs(b.start)),
      ]),
    )
    position.current = startPositionMs(detail.summary.timestamp, bounds.current)
    setPositionMs(position.current)
    loaded.current = {}
    pendingOffset.current = {}
    playingRef.current = false
    setPlaying(false)
    setSeeking({})

    const next: Record<string, SegmentAssignment | null> = {}
    const nextKeys: Record<string, string> = {}
    for (const cam of CAMERAS) {
      next[cam] = findSegmentAt(cameraSegments.current[cam] ?? [], position.current)
      nextKeys[cam] = assignmentKey(next[cam])
      if (next[cam] != null) {
        // Element mounts with this src; the head is parked on 'loadedmetadata'.
        pendingOffset.current[cam] = next[cam]!.offsetSeconds
        // The initial src comes from JSX, not from apply() — record it so the
        // master-clock rAF branch can engage on a fresh event.
        loaded.current[cam] = next[cam]!.segment.url
      }
    }
    lastKeys.current = nextKeys
    setAssignments(next)
  }, [detail])

  const eventMs = detail == null ? 0 : eventPointMs(detail.summary.timestamp, bounds.current)

  /** Force one camera onto its target: src swap, or in-segment seek when already loaded. */
  const apply = useCallback((camera: string, target: SegmentAssignment | null, playingNow: boolean): void => {
    const el = elements.current[camera]
    if (el == null || target == null || !target.segment.playable) return
    if (loaded.current[camera] !== target.segment.url) {
      pendingOffset.current[camera] = target.offsetSeconds
      loaded.current[camera] = target.segment.url
      el.src = target.segment.url
      setSeeking((s) => (s[camera] ? s : { ...s, [camera]: true }))
      return
    }
    if (el.readyState >= 2) {
      if (Math.abs(el.currentTime - target.offsetSeconds) > 0.001) {
        el.currentTime = Math.max(0, target.offsetSeconds)
        setSeeking((s) => (s[camera] ? s : { ...s, [camera]: true }))
      }
      // A src swap restarts the media load algorithm, which resets the rate.
      el.playbackRate = speedRef.current
      if (playingNow) void el.play().catch(() => {})
      else el.pause()
    }
  }, [])

  // rAF loop: the front video is the master clock; slaves correct beyond 150 ms.
  useEffect(() => {
    if (detail == null) return
    let raf = 0
    const tick = (): void => {
      const masterEl = elements.current[MASTER]
      const masterUrl = loaded.current[MASTER]
      if (playing && masterEl != null && masterEl.readyState >= 1 && masterUrl != null) {
        const masterSeg = cameraSegments.current[MASTER]?.find((s) => s.url === masterUrl) ?? null
        if (masterSeg != null) {
          // Master's real duration may differ from the estimate; crossing the
          // estimated boundary (or 'ended') moves the clock into the next segment.
          const abs = videoAbsoluteMs(masterEl.currentTime, masterSeg)
          if (Math.abs(abs - position.current) > 5) {
            position.current = abs
            setPositionMs(abs)
          }
          const next: Record<string, SegmentAssignment | null> = {}
          const nextKeys: Record<string, string> = {}
          let changed = false
          for (const cam of CAMERAS) {
            const target = findSegmentAt(cameraSegments.current[cam] ?? [], abs)
            next[cam] = target
            nextKeys[cam] = assignmentKey(target)
            if (nextKeys[cam] !== lastKeys.current[cam]) changed = true
            if (target == null) continue
            if (cam === MASTER || loaded.current[cam] !== target.segment.url) {
              apply(cam, target, true) // swaps src when the clock crossed into the next segment
              continue
            }
            const el = elements.current[cam]
            // A slave that ended early must not be dragged beyond its true
            // duration every frame; it stays parked until the next segment.
            if (el == null || !target.segment.playable || el.readyState < 2 || el.ended) continue
            const expected = (abs - timestampMs(target.segment.start)) / 1000
            if (Math.abs(el.currentTime - expected) > DRIFT_CORRECTION_SECONDS) {
              el.currentTime = Math.max(0, expected)
              setSeeking((s) => (s[cam] ? s : { ...s, [cam]: true }))
            }
          }
          if (changed) {
            // Skip setState when no camera moved to another segment/offset —
            // a fresh object every frame would re-render ~60×/s for nothing.
            lastKeys.current = nextKeys
            setAssignments(next)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [detail, apply, playing])

  const handleLoadedMetadata = useCallback((ev: Event): void => {
    const cam = (ev.target as HTMLElement).dataset.camera
    if (cam == null) return
    const el = elements.current[cam]
    if (el == null) return
    const offset = pendingOffset.current[cam]
    if (offset != null) {
      el.currentTime = Math.max(0, offset)
      el.playbackRate = speedRef.current // fresh media load → rate was reset
      setSeeking((s) => (s[cam] ? s : { ...s, [cam]: true }))
      delete pendingOffset.current[cam]
      if (playingRef.current) void el.play().catch(() => {})
    }
  }, [])

  const handleSeeked = useCallback((ev: Event): void => {
    const cam = (ev.target as HTMLElement).dataset.camera
    if (cam == null) return
    setSeeking((s) => (s[cam] ? { ...s, [cam]: false } : s))
  }, [])

  const toggle = useCallback((): void => {
    setPlaying((prev) => {
      const next = !prev
      playingRef.current = next
      for (const cam of CAMERAS) {
        const el = elements.current[cam]
        if (el == null) continue
        if (next) void el.play().catch(() => {})
        else el.pause()
      }
      return next
    })
  }, [])

  const seekTo = useCallback(
    (absMs: number): void => {
      const clamped = Math.min(Math.max(absMs, bounds.current.startMs), bounds.current.endMs)
      position.current = clamped
      setPositionMs(clamped)
      const next: Record<string, SegmentAssignment | null> = {}
      const nextKeys: Record<string, string> = {}
      for (const cam of CAMERAS) {
        next[cam] = findSegmentAt(cameraSegments.current[cam] ?? [], clamped)
        nextKeys[cam] = assignmentKey(next[cam])
      }
      lastKeys.current = nextKeys
      setAssignments(next)
      for (const cam of CAMERAS) apply(cam, next[cam], playingRef.current) // seek all cameras (spec)
    },
    [apply],
  )

  const skip = useCallback((deltaSeconds: number): void => seekTo(position.current + deltaSeconds * 1000), [seekTo])

  /** A real segment shorter than its estimate fires 'ended' while the frozen
   * clock is still below the estimated boundary; force the clock forward. */
  const handleEnded = useCallback((ev: Event): void => {
    const cam = (ev.target as HTMLElement).dataset.camera
    if (cam == null || cam !== MASTER) return
    seekTo(position.current + END_STEP_SECONDS * 1000)
  }, [seekTo])

  const setSpeed = useCallback((s: number): void => {
    setSpeedState(s)
    speedRef.current = s
    for (const cam of CAMERAS) {
      const el = elements.current[cam]
      if (el != null) el.playbackRate = s
    }
  }, [])

  // Ref callback: listeners attach the moment an element registers and detach
  // when it goes away — independent of effect re-runs.
  const bindCamera = useCallback((camera: string) => (el: HTMLVideoElement | null): void => {
    const prev = elements.current[camera]
    if (prev != null) {
      prev.removeEventListener('loadedmetadata', handleLoadedMetadata)
      prev.removeEventListener('seeked', handleSeeked)
      prev.removeEventListener('ended', handleEnded)
    }
    elements.current[camera] = el
    if (el != null) {
      el.addEventListener('loadedmetadata', handleLoadedMetadata)
      el.addEventListener('seeked', handleSeeked)
      el.addEventListener('ended', handleEnded)
    }
  }, [handleLoadedMetadata, handleSeeked, handleEnded])

  return {
    ready: detail != null,
    playing, positionMs, eventMs,
    timeline: bounds.current,
    toggle, seekTo, skip,
    speed, setSpeed,
    assignments, seeking,
    bindCamera,
  }
}
