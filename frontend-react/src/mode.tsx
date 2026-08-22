import { createContext, useContext } from 'react'
import type { ThemeMode } from './theme'

interface ThemeModeContextValue {
  mode: ThemeMode
  toggle: () => void
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: 'dark',
  toggle: () => {},
})

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext)
}
