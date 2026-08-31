import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'

export default function App() {
  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" noWrap>TeslaCamViewer</Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: 2 }} data-testid="app-body" />
    </Box>
  )
}