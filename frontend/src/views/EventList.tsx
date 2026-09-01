import { useEffect, useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import Avatar from '@mui/material/Avatar'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import BrokenImageIcon from '@mui/icons-material/BrokenImage'
import VideocamIcon from '@mui/icons-material/Videocam'
import LoginIcon from '@mui/icons-material/Login'
import KeyIcon from '@mui/icons-material/Key'
import LockIcon from '@mui/icons-material/Lock'
import LogoutIcon from '@mui/icons-material/Logout'
import { CATEGORIES, listEvents, type Category, type EventSummaryDto } from '../api/client'
import { humanizeReason } from '../reason'
import { useTeslaAuth } from '../tesla/useTeslaAuth'
import TeslaLoginDialog from '../tesla/TeslaLoginDialog'

const TAB_LABELS: Record<Category, string> = {
  RecentClips: 'Recent',
  SavedClips: 'Saved',
  SentryClips: 'Sentry',
}

const POLL_MS = 30_000

export function formatTimestamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19)
}

function Thumb({ event }: { event: EventSummaryDto }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <Avatar variant="rounded" sx={{ width: 96, height: 64 }}>
        <BrokenImageIcon />
      </Avatar>
    )
  }
  return (
    <Avatar
      variant="rounded"
      src={`/media/${event.category}/${event.folder}/thumb.png`}
      onError={() => setFailed(true)}
      sx={{ width: 96, height: 64, '& .MuiAvatar-img': { objectFit: 'cover' } }}
    />
  )
}

export default function EventList({ onOpen }: { onOpen: (category: Category, folder: string) => void }) {
  const [tab, setTab] = useState<Category>('RecentClips')
  const [refreshTick, setRefreshTick] = useState(0)
  const [events, setEvents] = useState<EventSummaryDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const auth = useTeslaAuth()
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      listEvents(tab)
        .then((list) => {
          if (!cancelled) {
            setEvents(list)
            setError(null)
          }
        })
        .catch((err) => {
          if (!cancelled) setError(String(err))
        })
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [tab, refreshTick])

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" noWrap sx={{ mr: 3 }}>TeslaCamViewer</Typography>
          <Tabs value={tab} onChange={(_e, v: Category) => setTab(v)} textColor="inherit" indicatorColor="secondary">
            {CATEGORIES.map((c) => (
              <Tab key={c} value={c} label={TAB_LABELS[c]} />
            ))}
          </Tabs>
          <Box sx={{ ml: 'auto' }}>
            {auth.loggedIn ? (
              <Chip
                color="secondary"
                icon={<KeyIcon />}
                label="Tesla"
                deleteIcon={<LogoutIcon />}
                onDelete={auth.logout}
                onClick={() => setLoginOpen(true)}
              />
            ) : (
              <Button color="inherit" startIcon={<LoginIcon />} onClick={() => setLoginOpen(true)}>
                Tesla
              </Button>
            )}
          </Box>
        </Toolbar>
      </AppBar>
      <TeslaLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} auth={auth} />
      <List>
        {events?.map((e) => (
          <ListItemButton
            key={e.folder}
            component="button"
            disabled={!e.playable}
            onClick={() => onOpen(tab, e.folder)}
          >
            <ListItemAvatar>
              <Thumb event={e} />
            </ListItemAvatar>
            <ListItemText
              primary={formatTimestamp(e.timestamp)}
              secondary={
                e.street != null || e.city != null ? [e.street, e.city].filter(Boolean).join(', ') : null
              }
            />
            {humanizeReason(e.reason) != null && <Chip size="small" label={humanizeReason(e.reason)} />}
            {e.camera != null && <Chip size="small" icon={<VideocamIcon />} label={e.camera} />}
            {e.encrypted && <Chip size="small" icon={<LockIcon />} label="encrypted" />}
          </ListItemButton>
        ))}
        {events != null && events.length === 0 && (
          <Typography sx={{ p: 3 }}>No events yet.</Typography>
        )}
        {error != null && (
          <Typography color="error" sx={{ p: 3 }}>
            Failed to load events: {error}
          </Typography>
        )}
        {events == null && error == null && <Typography sx={{ p: 3 }}>Loading…</Typography>}
      </List>
      {error != null && (
        <Box sx={{ px: 3 }}>
          <Button onClick={() => setRefreshTick((t) => t + 1)}>Retry</Button>
        </Box>
      )}
    </Box>
  )
}
