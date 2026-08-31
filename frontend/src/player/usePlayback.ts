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

export function usePlayback(detail: EventDetailDto | null): PlaybackState {
  const elements = useRef<Record<string, HTMLVideoElement | null>>({})
  /** Segment URL each element is currently loaded with. */
  const loaded = useRef<Record<string, string | null>>({})
  /** Offset still to seek to once a (re)loaded element's metadata is ready. */
  const pendingOffset = useRef<Record<string, number>>({})
  const position = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState(1)
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
    setPlaying(false)
    setSeeking({})

    const next: Record<string, SegmentAssignment | null> = {}
    for (const cam of CAMERAS) {
      next[cam] = findSegmentAt(cameraSegments.current[cam] ?? [], position.current)
      if (next[cam] != null) {
        // Element mounts with this src; the head is parked on 'loadedmetadata'.
        pendingOffset.current[cam] = next[cam]!.offsetSeconds
      }
    }
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
          for (const cam of CAMERAS) {
            const target = findSegmentAt(cameraSegments.current[cam] ?? [], abs)
            next[cam] = target
            if (target == null) continue
            if (cam === MASTER || loaded.current[cam] !== target.segment.url) {
              apply(cam, target, true) // swaps src when the clock crossed into the next segment
              continue
            }
            const el = elements.current[cam]
            if (el == null || !target.segment.playable || el.readyState < 2) continue
            const expected = (abs - timestampMs(target.segment.start)) / 1000
            if (Math.abs(el.currentTime - expected) > DRIFT_CORRECTION_SECONDS) {
              el.currentTime = Math.max(0, expected)
              setSeeking((s) => (s[cam] ? s : { ...s, [cam]: true }))
            }
          }
          setAssignments(next)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [detail, apply, playing])

  const toggle = useCallback((): void => {
    setPlaying((prev) => {
      const next = !prev
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
      for (const cam of CAMERAS) next[cam] = findSegmentAt(cameraSegments.current[cam] ?? [], clamped)
      setAssignments(next)
      for (const cam of CAMERAS) apply(cam, next[cam], playing) // seek all cameras (spec)
    },
    [apply, playing],
  )

  const skip = useCallback((deltaSeconds: number): void => seekTo(position.current + deltaSeconds * 1000), [seekTo])

  const setSpeed = useCallback((s: number): void => {
    setSpeedState(s)
    for (const cam of CAMERAS) {
      const el = elements.current[cam]
      if (el != null) el.playbackRate = s
    }
  }, [])

  const bindCamera = useCallback((camera: string) => (el: HTMLVideoElement | null): void => {
    elements.current[camera] = el
  }, [])

  // Mounted-element listeners: park the head on load; drop the placeholder on seeked.
  useEffect(() => {
    const onLoadedMetadata = (ev: Event): void => {
      const cam = (ev.target as HTMLElement).dataset.camera
      if (cam == null) return
      const el = elements.current[cam]
      if (el == null) return
      const offset = pendingOffset.current[cam]
      if (offset != null) {
        el.currentTime = Math.max(0, offset)
        setSeeking((s) => (s[cam] ? s : { ...s, [cam]: true }))
        delete pendingOffset.current[cam]
        if (playing) void el.play().catch(() => {})
      }
    }
    const onSeeked = (ev: Event): void => {
      const cam = (ev.target as HTMLElement).dataset.camera
      if (cam == null) return
      setSeeking((s) => (s[cam] ? { ...s, [cam]: false } : s))
    }
    const els = CAMERAS.map((c) => elements.current[c]).filter((x): x is HTMLVideoElement => x != null)
    for (const el of els) {
      el.addEventListener('loadedmetadata', onLoadedMetadata)
      el.addEventListener('seeked', onSeeked)
    }
    return () => {
      for (const el of els) {
        el.removeEventListener('loadedmetadata', onLoadedMetadata)
        el.removeEventListener('seeked', onSeeked)
      }
    }
  }, [assignments, playing])

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