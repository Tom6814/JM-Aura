import { createTheme, alpha } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

// Aura 视觉方向：深色优先的 Material You 风格，
// 紫罗兰主色呼应 "Aura" 品牌意象，大圆角 + 柔和层次。
// 浅色模式保持同构色相，保证日夜切换观感一致。

export type ThemeMode = 'dark' | 'light'

export const BRAND_GRADIENT = 'linear-gradient(135deg, #A78BFA 0%, #818CF8 50%, #E879F9 100%)'

function paletteFor(mode: ThemeMode) {
  if (mode === 'dark') {
    return {
      mode,
      primary: { main: '#A78BFA', contrastText: '#1B1426' },
      secondary: { main: '#F0ABFC', contrastText: '#26102A' },
      background: { default: '#131118', paper: '#1B1821' },
      divider: 'rgba(167,139,250,0.14)',
    }
  }
  return {
    mode,
    primary: { main: '#6D5BD0', contrastText: '#FFFFFF' },
    secondary: { main: '#C026D3', contrastText: '#FFFFFF' },
    background: { default: '#F7F4FB', paper: '#FFFFFF' },
    divider: 'rgba(109,91,208,0.18)',
  }
}

export function buildTheme(mode: ThemeMode): Theme {
  const dark = mode === 'dark'
  return createTheme({
    palette: {
      ...paletteFor(mode),
      success: { main: dark ? '#6EE7B7' : '#059669' },
      warning: { main: dark ? '#FCD34D' : '#D97706' },
      error: { main: dark ? '#FB7185' : '#E11D48' },
      text: dark
        ? { primary: '#ECEAF2', secondary: 'rgba(236,234,242,0.64)' }
        : { primary: '#211D2E', secondary: 'rgba(33,29,46,0.62)' },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily:
        "'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
      h4: { fontWeight: 800, letterSpacing: '-0.01em' },
      h5: { fontWeight: 700, letterSpacing: '-0.01em' },
      h6: { fontWeight: 700 },
      subtitle1: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundImage: dark
              ? 'radial-gradient(1200px 600px at 85% -10%, rgba(167,139,250,0.10), transparent 60%), radial-gradient(900px 500px at -10% 30%, rgba(129,140,248,0.07), transparent 55%)'
              : 'radial-gradient(1200px 600px at 85% -10%, rgba(167,139,250,0.16), transparent 60%), radial-gradient(900px 500px at -10% 30%, rgba(129,140,248,0.10), transparent 55%)',
            backgroundAttachment: 'fixed',
          },
          '::selection': {
            backgroundColor: alpha(dark ? '#A78BFA' : '#6D5BD0', 0.32),
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 999, paddingLeft: 18, paddingRight: 18 },
          containedPrimary: {
            boxShadow: dark ? '0 6px 20px rgba(167,139,250,0.25)' : '0 6px 20px rgba(109,91,208,0.28)',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${dark ? 'rgba(167,139,250,0.12)' : 'rgba(109,91,208,0.12)'}`,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 500 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 8, fontSize: 12.5 },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            backgroundColor: dark ? 'rgba(19,17,24,0.72)' : 'rgba(247,244,251,0.78)',
            borderBottom: `1px solid ${dark ? 'rgba(167,139,250,0.10)' : 'rgba(109,91,208,0.10)'}`,
            color: dark ? '#ECEAF2' : '#211D2E',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { borderRight: 'none' },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            marginInline: 8,
            paddingInline: 12,
            '&.Mui-selected': {
              backgroundColor: alpha(dark ? '#A78BFA' : '#6D5BD0', dark ? 0.16 : 0.12),
              '&:hover': {
                backgroundColor: alpha(dark ? '#A78BFA' : '#6D5BD0', dark ? 0.22 : 0.16),
              },
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 999, height: 8 },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 20 },
        },
      },
    },
  })
}
