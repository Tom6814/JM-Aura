import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link as RouterLink, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import DownloadIcon from '@mui/icons-material/Download'
import ExploreIcon from '@mui/icons-material/Explore'
import FavoriteIcon from '@mui/icons-material/Favorite'
import HistoryIcon from '@mui/icons-material/History'
import HomeIcon from '@mui/icons-material/Home'
import LightModeIcon from '@mui/icons-material/LightMode'
import LogoutIcon from '@mui/icons-material/Logout'
import LoginIcon from '@mui/icons-material/Login'
import MenuIcon from '@mui/icons-material/Menu'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import SearchIcon from '@mui/icons-material/Search'
import SettingsIcon from '@mui/icons-material/Settings'
import ShuffleIcon from '@mui/icons-material/Shuffle'
import StarIcon from '@mui/icons-material/Star'
import SwipeVerticalIcon from '@mui/icons-material/SwipeVertical'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import { useAuth } from './auth'
import { useThemeMode } from './mode'
import { BRAND_GRADIENT } from './theme'
import Home from './pages/Home'
import Search from './pages/Search'
import Categories from './pages/Categories'
import Leaderboard from './pages/Leaderboard'
import Latest from './pages/Latest'
import RandomPage from './pages/RandomPage'
import ComicDetail from './pages/ComicDetail'
import Reader from './pages/Reader'
import Favorites from './pages/Favorites'
import AuraHistory from './pages/AuraHistory'
import Downloads from './pages/Downloads'
import Settings from './pages/Settings'
import Login from './pages/Login'

// Material Design 3 自适应导航：
// compact(<md) 底部 Navigation Bar / medium(md–lg) Navigation Rail /
// expanded(≥lg) Navigation Drawer；导航区容器 = surface container，
// 激活态 = secondaryContainer 胶囊 indicator。
const DRAWER_WIDTH = 260
const RAIL_WIDTH = 88

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const NAV_BROWSE: NavItem[] = [
  { to: '/', label: '首页', icon: <HomeIcon /> },
  { to: '/search', label: '搜索', icon: <SearchIcon /> },
  { to: '/categories', label: '分类', icon: <ExploreIcon /> },
  { to: '/leaderboard', label: '排行榜', icon: <WhatshotIcon /> },
  { to: '/latest', label: '最新', icon: <SwipeVerticalIcon /> },
  { to: '/random', label: '随机', icon: <ShuffleIcon /> },
]

const NAV_MINE: NavItem[] = [
  { to: '/favorites', label: '收藏夹', icon: <FavoriteIcon /> },
  { to: '/history', label: '阅读历史', icon: <HistoryIcon /> },
  { to: '/downloads', label: '下载管理', icon: <DownloadIcon /> },
  { to: '/settings', label: '设置', icon: <SettingsIcon /> },
]

// 底部栏 / 导航栏最多 5 个目的地（M3 规范），其余入口收进「更多」抽屉
const NAV_PRIMARY: NavItem[] = [NAV_BROWSE[0], NAV_BROWSE[1], NAV_BROWSE[2], NAV_MINE[0]]

function isActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname.startsWith(to)
}

function Logo() {
  return (
    <Typography
      variant="h6"
      component={RouterLink}
      to="/"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.5,
        textDecoration: 'none',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        '& span': {
          background: BRAND_GRADIENT,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        },
      }}
    >
      <span>JM</span>
      <span>-Aura</span>
    </Typography>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{
        px: 3,
        pt: 2,
        pb: 0.5,
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: '0.05em',
        color: 'text.secondary',
      }}
    >
      {children}
    </Typography>
  )
}

/** Navigation Bar / Rail 共用的胶囊目的地按钮 */
function NavPill({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      sx={{
        flexDirection: 'column',
        gap: 0.5,
        py: 0.75,
        px: 0.5,
        minWidth: 60,
        borderRadius: 2.5,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <Box
        sx={{
          width: 58,
          height: 32,
          borderRadius: '999px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: active ? 'aura.secondaryContainer' : 'transparent',
          transition: 'background-color .2s ease',
          '& .MuiSvgIcon-root': {
            fontSize: 22,
            color: active ? 'aura.onSecondaryContainer' : 'aura.onSurfaceVariant',
          },
        }}
      >
        {item.icon}
      </Box>
      <Typography
        sx={{
          fontSize: 12,
          lineHeight: 1,
          fontWeight: active ? 600 : 500,
          color: active ? 'text.primary' : 'text.secondary',
        }}
      >
        {item.label}
      </Typography>
    </ButtonBase>
  )
}

function NavListItems({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const location = useLocation()
  return (
    <List disablePadding>
      {items.map((item) => (
        <ListItemButton
          key={item.to}
          component={NavLink}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          selected={isActive(item.to, location.pathname)}
        >
          <ListItemIcon>{item.icon}</ListItemIcon>
          <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14.5 }} />
        </ListItemButton>
      ))}
    </List>
  )
}

/** expanded 抽屉内容：浏览 / 我的 两个分区 */
function DrawerContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar sx={{ px: 2.5 }}>
        <Logo />
      </Toolbar>
      <Box sx={{ flexGrow: 1, overflowY: 'auto', pb: 2 }}>
        <SectionLabel>浏览</SectionLabel>
        <NavListItems items={NAV_BROWSE} onNavigate={onNavigate} />
        <Divider sx={{ mx: 3, mt: 1.5, opacity: 0.7 }} />
        <SectionLabel>我的</SectionLabel>
        <NavListItems items={NAV_MINE} onNavigate={onNavigate} />
      </Box>
      <Box sx={{ px: 3, pb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          JM-Aura · Go 重构版 · 单二进制部署
        </Typography>
      </Box>
    </Box>
  )
}

/** medium 断点：Navigation Rail */
function RailContent({ onMore }: { onMore: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1.5,
        gap: 0.5,
      }}
    >
      <IconButton
        onClick={onMore}
        aria-label="打开全部导航"
        sx={{ mb: 1, color: 'aura.onSurfaceVariant' }}
      >
        <MenuIcon />
      </IconButton>
      {NAV_PRIMARY.map((item) => (
        <NavPill
          key={item.to}
          item={item}
          active={isActive(item.to, location.pathname)}
          onClick={() => navigate(item.to)}
        />
      ))}
      <Box sx={{ flexGrow: 1 }} />
      <NavPill item={{ to: '#', label: '更多', icon: <MoreHorizIcon /> }} active={false} onClick={onMore} />
    </Box>
  )
}

/** compact 断点：底部 Navigation Bar */
function BottomBar({ onMore }: { onMore: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <Paper
      square
      elevation={0}
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: (t) => t.zIndex.appBar,
        bgcolor: 'aura.surfaceContainer',
        borderTop: '1px solid',
        borderColor: 'divider',
        pb: 'env(safe-area-inset-bottom)',
        display: { xs: 'block', md: 'none' },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', pt: 0.5 }}>
        {NAV_PRIMARY.map((item) => (
          <NavPill
            key={item.to}
            item={item}
            active={isActive(item.to, location.pathname)}
            onClick={() => navigate(item.to)}
          />
        ))}
        <NavPill item={{ to: '#', label: '更多', icon: <MoreHorizIcon /> }} active={false} onClick={onMore} />
      </Box>
    </Paper>
  )
}

function UserArea() {
  const { user, loading, logout } = useAuth()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  if (loading) {
    return <Chip size="small" label="…" sx={{ opacity: 0.5 }} />
  }
  if (!user) {
    return (
      <Button component={RouterLink} to="/login" size="small" variant="contained" startIcon={<LoginIcon />}>
        登录
      </Button>
    )
  }
  return (
    <>
      <Tooltip title={user.username}>
        <Chip
          clickable
          avatar={
            <Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 13 }}>
              {user.username.slice(0, 1).toUpperCase()}
            </Avatar>
          }
          label={user.username}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ maxWidth: 160 }}
        />
      </Tooltip>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            setAnchorEl(null)
            void logout()
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          退出登录
        </MenuItem>
      </Menu>
    </>
  )
}

export default function App() {
  const theme = useTheme()
  const isRail = useMediaQuery(theme.breakpoints.up('md'))
  const isExpanded = useMediaQuery(theme.breakpoints.up('lg'))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { mode, toggle } = useThemeMode()

  const drawerPaper = useMemo(
    () => ({ width: DRAWER_WIDTH, bgcolor: 'aura.surfaceContainerLow' }),
    [],
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1 }}>
          <Logo />
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title={mode === 'dark' ? '切换到浅色' : '切换到深色'}>
            <IconButton onClick={toggle} aria-label="切换主题">
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <UserArea />
        </Toolbar>
      </AppBar>

      {isExpanded && (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { ...drawerPaper, position: 'relative', mt: '64px' },
          }}
        >
          <DrawerContent />
        </Drawer>
      )}

      {!isExpanded && isRail && (
        <Drawer
          variant="permanent"
          sx={{
            width: RAIL_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: RAIL_WIDTH,
              position: 'relative',
              mt: '64px',
              bgcolor: 'aura.surfaceContainer',
              boxSizing: 'border-box',
            },
          }}
        >
          <RailContent onMore={() => setDrawerOpen(true)} />
        </Drawer>
      )}

      {!isRail && <BottomBar onMore={() => setDrawerOpen(true)} />}

      {!isExpanded && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} slotProps={{ paper: { sx: drawerPaper } }}>
          <DrawerContent onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: { xs: 2, sm: 3 },
          pb: { xs: 'calc(92px + env(safe-area-inset-bottom))', md: 3 },
          maxWidth: 1400,
          mx: 'auto',
        }}
      >
        <Toolbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/latest" element={<Latest />} />
          <Route path="/random" element={<RandomPage />} />
          <Route path="/comic/:comicId" element={<ComicDetail />} />
          <Route path="/reader/:chapterId" element={<Reader />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/history" element={<AuraHistory />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Box component="footer" sx={{ py: 5, textAlign: 'center' }}>
          <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
            <StarIcon fontSize="small" sx={{ opacity: 0.4 }} />
            <Typography variant="caption" color="text.secondary">
              由 Material Design 3 与 Go 驱动
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}
