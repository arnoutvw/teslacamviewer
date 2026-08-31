import { useState } from 'react'
import Box from '@mui/material/Box'
import EventList from './views/EventList'
import Player from './views/Player'
import type { Category } from './api/client'

export default function App() {
  const [selected, setSelected] = useState<{ category: Category; folder: string } | null>(null)
  return (
    <Box sx={{ minHeight: '100vh' }}>
      {selected == null ? (
        <EventList onOpen={(category, folder) => setSelected({ category, folder })} />
      ) : (
        <Player
          category={selected.category}
          folder={selected.folder}
          onBack={() => setSelected(null)}
        />
      )}
    </Box>
  )
}