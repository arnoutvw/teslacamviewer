import { useEffect, useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
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
  const [zoomed, setZoomed] = useState<string | null>(null)
  const pb = usePlayback(detail)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    getEventDetail(category, folder).then((d) => { if (!cancelled) setDetail(d) })
    return () => { cancelled = true }
  }, [category, folder])

  if (detail == null) return <Typography sx={{ p: 3 }}>Loading…</Typography>

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