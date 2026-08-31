import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

export function EventMap({ lat, lon, label }: { lat: number | null; lon: number | null; label: Array<string | null> }): ReactElement | null {
  const holder = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (lat == null || lon == null || holder.current == null) return
    const map = L.map(holder.current).setView([lat, lon], 16)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    L.marker([lat, lon]).addTo(map)
    return () => { map.remove() }
  }, [lat, lon])

  if (lat == null || lon == null) return null
  const caption = label.filter((s): s is string => s != null && s.length > 0).join(', ')
  return (
    <Box sx={{ mt: 1 }}>
      {caption.length > 0 && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
      <Box ref={holder} sx={{ height: 220, width: '100%', borderRadius: 1, overflow: 'hidden' }} />
    </Box>
  )
}