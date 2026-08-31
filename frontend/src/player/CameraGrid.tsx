import type { ReactElement } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { CAMERAS } from './usePlayback'
import type { SegmentAssignment } from './syncClock'

export interface CameraGridProps {
  assignments: Record<string, SegmentAssignment | null>
  seeking: Record<string, boolean>
  eventCamera: string | null
  zoomed: string | null
  onToggleZoom(camera: string): void
  bindCamera(camera: string): (el: HTMLVideoElement | null) => void
}

/** front is the large top-left block; the other 5 fill the ring (spec). */
const AREAS = [
  "'front front back'",
  "'front front left_repeater'",
  "'right_pillar left_pillar right_repeater'",
].join(' ')

export default function CameraGrid(p: CameraGridProps): ReactElement {
  const cameras = p.zoomed != null ? [p.zoomed] : CAMERAS
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gridTemplateAreas: p.zoomed != null ? "'zoom'" : AREAS,
        gap: 0.5,
        height: '100%',
        minHeight: 420,
      }}
    >
      {cameras.map((cam) => {
        const target = p.assignments[cam] ?? null
        const usable = target != null && target.segment.playable
        return (
          <Box
            key={cam}
            data-testid={`tile-${cam}`}
            onClick={() => p.onToggleZoom(cam)}
            sx={{
              gridArea: p.zoomed != null ? 'zoom' : cam,
              position: 'relative',
              overflow: 'hidden',
              bgcolor: '#000',
              borderRadius: 1,
              outline: p.eventCamera === cam ? '3px solid #ff1744' : 'none',
              cursor: 'pointer',
            }}
          >
            {usable ? (
              <>
                {/* The video must stay mounted across seeks — only the placeholder swaps. */}
                <video
                  data-testid={`video-${cam}`}
                  data-camera={cam}
                  ref={p.bindCamera(cam)}
                  src={target.segment.url}
                  muted
                  playsInline
                  preload="auto"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                {p.seeking[cam] && (
                  <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: '#262626' }}>
                    <Typography variant="caption" color="text.secondary">seeking…</Typography>
                  </Box>
                )}
              </>
            ) : (
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: '#262626' }}>
                <Typography variant="caption" color="text.secondary">
                  no footage
                </Typography>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
