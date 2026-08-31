import { useEffect, useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { getEventDetail, type Category, type EventDetailDto } from '../api/client'
import CameraGrid from '../player/CameraGrid'
import { Controls } from '../player/Controls'
import { usePlayback } from '../player/usePlayback'
import { humanizeReason } from '../reason'
import { EventMap } from '../views/EventMap'

export default function Player({ category, folder, onBack }: { category: Category; folder: string; onBack: () => void }) {
  const [detail, setDetail] = useState<EventDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const pb = usePlayback(detail)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setLoading(true)
    setError(null)
    getEventDetail(category, folder)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((err) => { if (!cancelled) setError(String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [category, folder, retryTick])

  if (error != null) {
    return (
      <Box sx={{ p: 3 }}>
        <IconButton aria-label="back to list" edge="start" onClick={onBack}><ArrowBackIcon /></IconButton>
        <Typography color="error" sx={{ mt: 2 }}>Failed to load event: {error}</Typography>
        <Button variant="outlined" sx={{ mt: 1 }} onClick={() => setRetryTick((t) => t + 1)}>Retry</Button>
      </Box>
    )
  }
  if (loading) return <Typography sx={{ p: 3 }}>Loading…</Typography>
  if (detail == null) {
    // getEventDetail resolved null → 404; the folder is gone from disk.
    return (
      <Box sx={{ p: 3 }}>
        <IconButton aria-label="back to list" edge="start" onClick={onBack}><ArrowBackIcon /></IconButton>
        <Typography color="error" sx={{ mt: 2 }}>This event is no longer available.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      <AppBar position="static">
        <Toolbar>
          <IconButton aria-label="back to list" edge="start" onClick={onBack}><ArrowBackIcon /></IconButton>
          <Typography variant="h6" noWrap>
            {detail.summary.timestamp.replace('T', ' ').slice(0, 19)}
            {humanizeReason(detail.summary.reason) != null && ` · ${humanizeReason(detail.summary.reason)}`}
          </Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <CameraGrid
          assignments={pb.assignments}
          seeking={pb.seeking}
          eventCamera={detail.summary.camera}
          zoomed={zoomed}
          onToggleZoom={(cam) => setZoomed((z) => (z === cam ? null : cam))}
          bindCamera={pb.bindCamera}
        />
      </Box>
      <Controls
        playing={pb.playing}
        speed={pb.speed}
        positionMs={pb.positionMs}
        eventMs={pb.eventMs}
        timeline={pb.timeline}
        onToggle={pb.toggle}
        onSkip={pb.skip}
        onSpeed={pb.setSpeed}
        onScrub={pb.seekTo}
      />
      <Stack sx={{ px: 2, pb: 2 }}>
        <EventMap lat={detail.summary.lat} lon={detail.summary.lon} label={[detail.summary.street, detail.summary.city]} />
      </Stack>
    </Box>
  )
}