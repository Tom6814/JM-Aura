import { StrictMode, useCallback, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import App from './App'
import { AuthProvider } from './auth'
import { ThemeModeContext } from './mode'
import { buildTheme } from './theme'
import type { ThemeMode } from './theme'

const THEME_KEY = 'aura.theme'

function detectInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* localStorage 可能被禁用 */
  }
  return 'dark'
}

function Root() {
  const [mode, setMode] = useState<ThemeMode>(detectInitialMode)
  const toggle = useCallback(() => {
    setMode((m) => {
      const next: ThemeMode = m === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        /* ignore */
      }
      document.documentElement.style.colorScheme = next
      return next
    })
  }, [])
  const theme = useMemo(() => buildTheme(mode), [mode])
  const modeValue = useMemo(() => ({ mode, toggle }), [mode, toggle])

  return (
    <ThemeModeContext.Provider value={modeValue}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ThemeModeContext.Provider>
  )
}

document.documentElement.style.colorScheme = detectInitialMode()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
