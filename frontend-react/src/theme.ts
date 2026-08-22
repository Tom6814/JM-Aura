import { createTheme, alpha } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

// Material Design 3 令牌体系：
// - 颜色遵循官方 26 个 color roles（primary/secondary/tertiary/error ×4、
//   surface 家族五级 container、outline×2、inverse×3），container 只做填充、
//   on* 只做内容色，保证对比度配对不被破坏。
// - 形状阶梯：extra-small 4 / small 8 / medium 12 / large 16 / extra-large 28 / full。
// - 字体阶梯映射 MUI variants（display/headline/title/body/label）。
// - 高度：浅色用柔和投影，深色走 tonal elevation（表面提亮 + 发丝线分隔）。

export type ThemeMode = 'dark' | 'light'

export const BRAND_GRADIENT = 'linear-gradient(135deg, #C5C0FF 0%, #A78BFA 50%, #ECAEE5 100%)'

/** 偏阅读设计：标题用衬线字族（墨韵纸感） */
export const HEADING_FONT =
  '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", Georgia, serif'

export interface AuraPalette {
  primary: string
  onPrimary: string
  primaryContainer: string
  onPrimaryContainer: string
  secondary: string
  onSecondary: string
  secondaryContainer: string
  onSecondaryContainer: string
  tertiary: string
  onTertiary: string
  tertiaryContainer: string
  onTertiaryContainer: string
  error: string
  onError: string
  errorContainer: string
  onErrorContainer: string
  surface: string
  onSurface: string
  onSurfaceVariant: string
  surfaceContainerLowest: string
  surfaceContainerLow: string
  surfaceContainer: string
  surfaceContainerHigh: string
  surfaceContainerHighest: string
  outline: string
  outlineVariant: string
  inverseSurface: string
  inverseOnSurface: string
  inversePrimary: string
  scrim: string
}

declare module '@mui/material/styles' {
  interface Palette {
    aura: AuraPalette
  }
  interface PaletteOptions {
    aura?: AuraPalette
  }
}

/** 十六进制颜色线性插值（tonal elevation 用） */
function mixHex(a: string, b: string, t: number): string {
  const pa = a.replace('#', '')
  const pb = b.replace('#', '')
  const ch = (s: string, i: number) => parseInt(s.slice(i * 2, i * 2 + 2), 16)
  const out = [0, 1, 2]
    .map((i) => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t))
    .map((v) => v.toString(16).padStart(2, '0'))
  return `#${out.join('')}`
}

function auraFor(mode: ThemeMode): AuraPalette {
  if (mode === 'dark') {
    return {
      primary: '#C5C0FF',
      onPrimary: '#2C2470',
      primaryContainer: '#423A9C',
      onPrimaryContainer: '#E4DFFF',
      secondary: '#C5C2DD',
      onSecondary: '#302D48',
      secondaryContainer: '#46435F',
      onSecondaryContainer: '#E1DFF3',
      tertiary: '#ECAEE5',
      onTertiary: '#54164D',
      tertiaryContainer: '#6C2A64',
      onTertiaryContainer: '#FFD7F2',
      error: '#F2B8B5',
      onError: '#601410',
      errorContainer: '#8C1D18',
      onErrorContainer: '#F9DEDC',
      surface: '#131119',
      onSurface: '#E5E1F0',
      onSurfaceVariant: '#C8C4D8',
      surfaceContainerLowest: '#0E0D13',
      surfaceContainerLow: '#1B1A23',
      surfaceContainer: '#201F28',
      surfaceContainerHigh: '#2A2933',
      surfaceContainerHighest: '#35343E',
      outline: '#928FA0',
      outlineVariant: '#474457',
      inverseSurface: '#E5E1F0',
      inverseOnSurface: '#302F3C',
      inversePrimary: '#5A50C0',
      scrim: '#000000',
    }
  }
  return {
    primary: '#5A50C0',
    onPrimary: '#FFFFFF',
    primaryContainer: '#E4DFFF',
    onPrimaryContainer: '#160E54',
    secondary: '#5E5B78',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#E1DFF3',
    onSecondaryContainer: '#1B1931',
    tertiary: '#85397B',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#FFD7F2',
    onTertiaryContainer: '#380A34',
    error: '#BA1A1A',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    // 墨韵纸感：浅色表面走暖纸调
    surface: '#FBF9F4',
    onSurface: '#1F1C1A',
    onSurfaceVariant: '#4D463F',
    surfaceContainerLowest: '#FFFFFF',
    surfaceContainerLow: '#F5F1E9',
    surfaceContainer: '#EFE9E0',
    surfaceContainerHigh: '#E9E2D8',
    surfaceContainerHighest: '#E3DBD0',
    outline: '#7E766C',
    outlineVariant: '#D0C8BB',
    inverseSurface: '#34302B',
    inverseOnSurface: '#F6F1E8',
    inversePrimary: '#C5C0FF',
    scrim: '#000000',
  }
}

const FONT_FAMILY =
  "'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

/** 标题 variants 统一衬线（阅读优先） */
function headingStyles() {
  return { fontFamily: HEADING_FONT, letterSpacing: '0.01em' }
}

export function buildTheme(mode: ThemeMode): Theme {
  const dark = mode === 'dark'
  const aura = auraFor(mode)

  return createTheme({
    palette: {
      mode,
      aura,
      primary: { main: aura.primary, contrastText: aura.onPrimary },
      secondary: { main: aura.secondary, contrastText: aura.onSecondary },
      success: { main: dark ? '#6EE7B7' : '#059669' },
      warning: { main: dark ? '#FCD34D' : '#D97706' },
      info: { main: dark ? '#93C5FD' : '#2563EB' },
      error: { main: aura.error, contrastText: aura.onError },
      background: { default: aura.surface, paper: aura.surfaceContainerLow },
      text: {
        primary: aura.onSurface,
        secondary: aura.onSurfaceVariant,
        disabled: alpha(aura.onSurface, 0.38),
      },
      divider: aura.outlineVariant,
      action: {
        hover: alpha(aura.onSurface, dark ? 0.08 : 0.05),
        selected: alpha(aura.primary, dark ? 0.14 : 0.1),
        focus: alpha(aura.onSurface, dark ? 0.12 : 0.08),
        disabledOpacity: 0.38,
      },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_FAMILY,
      // M3 type scale → MUI variants（标题族用衬线）
      h1: { fontSize: '3.5625rem', lineHeight: 1.123, fontWeight: 400, ...headingStyles(), letterSpacing: '-0.25px' },
      h2: { fontSize: '2.8125rem', lineHeight: 1.156, fontWeight: 400, ...headingStyles() },
      h3: { fontSize: '2rem', lineHeight: 1.25, fontWeight: 400, ...headingStyles() },
      h4: { fontSize: '1.75rem', lineHeight: 1.286, fontWeight: 400, ...headingStyles() },
      h5: { fontSize: '1.5rem', lineHeight: 1.333, fontWeight: 400, ...headingStyles() },
      h6: { fontSize: '1.375rem', lineHeight: 1.273, fontWeight: 400, ...headingStyles() },
      subtitle1: { fontSize: '1rem', lineHeight: 1.5, fontWeight: 500, letterSpacing: '0.15px' },
      subtitle2: { fontSize: '0.875rem', lineHeight: 1.43, fontWeight: 500, letterSpacing: '0.1px' },
      body1: { fontSize: '1rem', lineHeight: 1.5, letterSpacing: '0.5px' },
      body2: { fontSize: '0.875rem', lineHeight: 1.43, letterSpacing: '0.25px' },
      caption: { fontSize: '0.75rem', lineHeight: 1.333, letterSpacing: '0.4px' },
      overline: { fontSize: '0.6875rem', lineHeight: 1.455, fontWeight: 500, letterSpacing: '0.5px' },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: '0.1px', lineHeight: 1.43 },
    },
    shadows: dark
      ? (Array.from({ length: 25 }, () => 'none') as unknown as Theme['shadows'])
      : [
          'none',
          '0 1px 2px rgba(27,20,60,.14), 0 1px 3px 1px rgba(27,20,60,.07)',
          '0 1px 2px rgba(27,20,60,.16), 0 2px 6px 2px rgba(27,20,60,.08)',
          '0 1px 3px rgba(27,20,60,.18), 0 4px 8px 3px rgba(27,20,60,.09)',
          '0 2px 3px rgba(27,20,60,.18), 0 6px 10px 4px rgba(27,20,60,.10)',
          '0 4px 4px rgba(27,20,60,.18), 0 8px 12px 6px rgba(27,20,60,.11)',
          ...Array.from({ length: 19 }, () => '0 4px 4px rgba(27,20,60,.18), 0 8px 12px 6px rgba(27,20,60,.11)'),
        ] as unknown as Theme['shadows'],
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: aura.surface,
            backgroundImage: dark
              ? `radial-gradient(1100px 520px at 88% -8%, ${alpha(aura.primary, 0.07)}, transparent 62%), radial-gradient(900px 480px at -8% 32%, ${alpha(aura.tertiary, 0.05)}, transparent 58%)`
              : `radial-gradient(1100px 520px at 88% -8%, ${alpha(aura.primary, 0.10)}, transparent 62%), radial-gradient(900px 480px at -8% 32%, ${alpha(aura.tertiary, 0.07)}, transparent 58%)`,
            backgroundAttachment: 'fixed',
            scrollbarWidth: 'thin',
            scrollbarColor: `${alpha(aura.outline, 0.55)} transparent`,
          },
          '::selection': {
            backgroundColor: alpha(aura.primary, 0.32),
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${dark ? aura.outlineVariant : alpha(aura.outlineVariant, 0.8)}`,
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            backgroundColor: alpha(aura.surface, dark ? 0.72 : 0.78),
            borderBottom: `1px solid ${dark ? alpha(aura.outlineVariant, 0.6) : aura.outlineVariant}`,
            color: aura.onSurface,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderRight: `1px solid ${dark ? alpha(aura.outlineVariant, 0.6) : aura.outlineVariant}`,
          },
        },
      },
      // M3 导航激活态：胶囊形 active indicator，填充 secondaryContainer
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            marginInline: 8,
            paddingInline: 14,
            minHeight: 52,
            '& .MuiListItemIcon-root': {
              minWidth: 40,
              color: aura.onSurfaceVariant,
            },
            '&:hover': {
              backgroundColor: alpha(aura.onSurface, dark ? 0.08 : 0.05),
            },
            '&.Mui-selected': {
              backgroundColor: aura.secondaryContainer,
              color: aura.onSecondaryContainer,
              '&:hover': {
                backgroundColor: mixHex(
                  aura.secondaryContainer,
                  dark ? '#FFFFFF' : '#000000',
                  0.06,
                ),
              },
              '& .MuiListItemIcon-root': {
                color: aura.onSecondaryContainer,
              },
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 999, paddingLeft: 20, paddingRight: 20 },
          contained: {
            boxShadow: 'none',
            '&:hover': { boxShadow: (dark ? 'none' : '0 1px 2px rgba(27,20,60,.14), 0 1px 3px 1px rgba(27,20,60,.07)') },
          },
          outlined: {
            borderColor: aura.outline,
            '&:hover': { borderColor: aura.outline, backgroundColor: alpha(aura.primary, dark ? 0.09 : 0.07) },
          },
        },
      },
      MuiFab: {
        styleOverrides: { root: { borderRadius: 16 } },
      },
      // M3 文本框 = extra-small 4dp 圆角
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 4 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 500 },
        },
      },
      // M3 对话框 = extra-large 28dp，容器 surfaceContainerHigh
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 28,
            backgroundColor: aura.surfaceContainerHigh,
            backgroundImage: 'none',
          },
        },
      },
      // M3 菜单 = extra-small 4dp，容器 surfaceContainer
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 4,
            backgroundColor: aura.surfaceContainer,
            backgroundImage: 'none',
          },
          list: { py: 0.5 },
        },
      },
      // M3 Snackbar = extra-small 4dp，inverse 配色
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            backgroundColor: aura.inverseSurface,
            color: aura.inverseOnSurface,
          },
          action: { color: aura.inversePrimary },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 4,
            fontSize: 12,
            backgroundColor: aura.inverseSurface,
            color: aura.inverseOnSurface,
            paddingInline: 10,
            paddingBlock: 6,
          },
          arrow: { color: aura.inverseSurface },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 999 },
          bar: { borderRadius: 999 },
        },
      },
      MuiListItem: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
    },
  })
}
