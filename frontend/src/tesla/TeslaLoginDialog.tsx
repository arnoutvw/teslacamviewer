import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import LoginIcon from '@mui/icons-material/Login'
import LogoutIcon from '@mui/icons-material/Logout'
import type { TeslaAuthState } from './useTeslaAuth'

export default function TeslaLoginDialog({
  open,
  onClose,
  auth,
}: {
  open: boolean
  onClose: () => void
  /** Caller owns the hook instance (e.g. via useTeslaAuth in EventList) so header state stays in sync. */
  auth: TeslaAuthState
}) {
  const [step, setStep] = useState<'login' | 'paste'>('login')
  const [pastedUrl, setPastedUrl] = useState('')

  useEffect(() => {
    if (open) {
      setStep('login')
      setPastedUrl('')
    }
  }, [open])

  const handleStart = async (): Promise<void> => {
    if (await auth.start()) setStep('paste')
  }

  const handleConfirm = async (): Promise<void> => {
    if (await auth.confirm(pastedUrl)) onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Tesla account</DialogTitle>
      {auth.busy && <LinearProgress />}
      <DialogContent>
        {auth.error != null && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {auth.error}
          </Alert>
        )}
        {auth.loggedIn ? (
          <>
            <DialogContentText>
              You are signed in to Tesla. Encrypted clips can be played.
            </DialogContentText>
            <DialogActions sx={{ px: 0, pt: 2 }}>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={() => {
                  auth.logout()
                  onClose()
                }}
              >
                Log out
              </Button>
            </DialogActions>
          </>
        ) : step === 'login' ? (
          <>
            <DialogContentText>
              Sign in with your Tesla account to retrieve the encryption keys for your
              dashcam clips. A login window will open.
            </DialogContentText>
            <DialogContentText sx={{ mt: 2 }}>
              After signing in, Tesla shows a “page not found” error — this is expected.
              Copy the full URL from the browser address bar and paste it in the next
              step.
            </DialogContentText>
            <Box sx={{ mt: 3 }}>
              <Button
                variant="contained"
                startIcon={<LoginIcon />}
                disabled={auth.busy}
                onClick={() => {
                  void handleStart()
                }}
              >
                Login with Tesla
              </Button>
            </Box>
          </>
        ) : (
          <>
            <DialogContentText>
              Paste the URL from the browser address bar of the login window (it starts
              with https://dashcam.tesla.com/callback?code=…).
            </DialogContentText>
            <TextField
              autoFocus
              fullWidth
              margin="normal"
              label="Callback URL"
              placeholder="https://dashcam.tesla.com/callback?code=…&state=…"
              value={pastedUrl}
              onChange={(e) => setPastedUrl(e.target.value)}
            />
          </>
        )}
      </DialogContent>
      {step === 'paste' && !auth.loggedIn && (
        <DialogActions>
          <Button onClick={() => setStep('login')}>Back</Button>
          <Button
            variant="contained"
            disabled={pastedUrl.trim() === '' || auth.busy}
            onClick={() => {
              void handleConfirm()
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      )}
      {auth.loggedIn && (
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      )}
      {step === 'login' && !auth.loggedIn && (
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
        </DialogActions>
      )}
    </Dialog>
  )
}