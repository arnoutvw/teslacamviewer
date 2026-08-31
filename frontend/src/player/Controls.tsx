import type { ReactElement } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Replay10Icon from '@mui/icons-material/Replay10'
import Forward10Icon from '@mui/icons-material/Forward10'

export interface ControlsProps {
  playing: boolean
  speed: number
  positionMs: number
  eventMs: number
  timeline: { startMs: number; endMs: number }
  onToggle(): void
  onSkip(deltaSeconds: number): void
  onSpeed(speed: number): void
  onScrub(absoluteMs: number): void
}

const SPEEDS = [0.5, 1, 2, 4]

export function Controls(p: ControlsProps): ReactElement {
  const span = Math.max(1, p.timeline.endMs - p.timeline.startMs)
  const pct = ((p.eventMs - p.timeline.startMs) / span) * 100
  return (
    <Box sx={{ position: 'relative', px: 2, py: 1 }}>
      <Box sx={{ position: 'relative' }}>
        <Slider
          min={p.timeline.startMs}
          max={p.timeline.endMs}
          step={500}
          value={p.positionMs}
          onChange={(_e, v) => p.onScrub(v as number)}
        />
        {/* Red event dot (spec). Anchored to the slider's own vertical center so it
            sits exactly on the rail; white ring separates it from the red track.
            Hidden when no event stamp: eventMs = startMs. */}
        {p.eventMs > p.timeline.startMs && (
          <Box
            data-testid="event-dot"
            style={{ left: `${pct}%` }}
            sx={{
              position: 'absolute', top: '50%',
              width: 14, height: 14, borderRadius: '50%',
              bgcolor: 'error.main', border: '2px solid #fff',
              boxShadow: '0 0 4px rgba(0,0,0,0.6)',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <IconButton aria-label="back 10 s" onClick={() => p.onSkip(-10)}><Replay10Icon /></IconButton>
        <IconButton aria-label={p.playing ? 'pause' : 'play'} onClick={p.onToggle}>
          {p.playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <IconButton aria-label="forward 10 s" onClick={() => p.onSkip(10)}><Forward10Icon /></IconButton>
        {SPEEDS.map((s) => (
          <IconButton key={s} aria-label={`${s}×`} onClick={() => p.onSpeed(s)}>
            <Typography variant="caption" color={p.speed === s ? 'primary' : 'text.secondary'}>{s}×</Typography>
          </IconButton>
        ))}
      </Stack>
    </Box>
  )
}
