import { useState } from 'react'
import Box from '@mui/material/Box'
import EventList from './views/EventList'
import type { Category } from './api/client'

export default function App() {
  const [selected, setSelected] = useState<{ category: Category; folder: string } | null>(null)
  return (
    <Box sx={{ minHeight: '100vh' }}>
      {selected == null ? (
        <EventList onOpen={(category, folder) => setSelected({ category, folder })} />
      ) : (
        // Task 5 replaces this placeholder with the Player.
        <Box sx={{ p: 2 }} data-testid="player-placeholder">
          {selected.category}/{selected.folder}
        </Box>
      )}
    </Box>
  )
}