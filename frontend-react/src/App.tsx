import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link as RouterLink, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
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
import PersonIcon from '@mui/icons-material/Person'
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
import Accounts from './pages/Accounts'
import Login from './pages/Login'

const DRAWER_WIDTH = 232

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '首页', icon: <HomeIcon /> },
  { to: '/search', label: '搜索', icon: <SearchIcon /> },
  { to: '/categories', label: '分类', icon: <ExploreIcon /> },
  { to: '/leaderboard', label: '排行榜', icon: <WhatshotIcon /> },
  { to: '/latest', label: '最新', icon: <SwipeVerticalIcon /> },
  { to: '/random', label: '随机', icon: <ShuffleIcon /> },
  { to: '/favorites', label: '收藏夹', icon: <FavoriteIcon /> },
  { to: '/history', label: '阅读历史', icon: <HistoryIcon /> },
  { to: '/downloads', label: '下载管理', icon: <DownloadIcon /> },
  { to: '/accounts', label: 'JM 账号', icon: <PersonIcon /> },
  { to: '/settings', label: '设置', icon: <SettingsIcon /> },
]

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
        fontWeight: 800,
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

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  return (
    <List sx={{ pt: 1 }}>
      {NAV_ITEMS.map((item) => (
        <ListItemButton
          key={item.to}
          component={NavLink}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          selected={
            item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
          }
        >
          <ListItemIcon sx={{ minWidth: 38 }}>{item.icon}</ListItemIcon>
          <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14.5 }} />
        </ListItemButton>
      ))}
    </List>
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
            <Avatar sx={{ bgcolor: 'primary.main', fontSize: 13 }}>{user.username.slice(0, 1).toUpperCase()}</Avatar>
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
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { mode, toggle } = useThemeMode()

  const drawerContent = useMemo(
    () => (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Toolbar sx={{ px: 2.5 }}>
          <Logo />
        </Toolbar>
        <Divider sx={{ mx: 2 }} />
        <NavList onNavigate={() => setDrawerOpen(false)} />
      </Box>
    ),
    [],
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setDrawerOpen(true)} aria-label="打开导航">
              <MenuIcon />
            </IconButton>
          )}
          {isDesktop && (
            <Box component="nav" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap' }}>
              {NAV_ITEMS.slice(0, 6).map((item) => (
                <Button
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  end={item.to === '/'}
                  size="small"
                  startIcon={item.icon}
                  sx={{
                    color: 'inherit',
                    opacity: 0.78,
                    '&.active': { opacity: 1, bgcolor: 'action.selected' },
                    minWidth: 0,
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
          )}
          <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: isDesktop ? undefined : 'center', ml: isDesktop ? 2 : 0 }}>
            {isDesktop ? null : <Logo />}
          </Box>
          <Tooltip title={mode === 'dark' ? '切换到浅色' : '切换到深色'}>
            <IconButton onClick={toggle} aria-label="切换主题">
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <UserArea />
        </Toolbar>
      </AppBar>

      {isDesktop && (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, position: 'relative', mt: 8 },
          }}
        >
          {drawerContent}
        </Drawer>
      )}
      {!isDesktop && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} slotProps={{ paper: { sx: { width: DRAWER_WIDTH } } }}>
          {drawerContent}
        </Drawer>
      )}

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 1.5, sm: 3 }, maxWidth: 1440, mx: 'auto', minWidth: 0 }}>
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
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Box component="footer" sx={{ py: 5, textAlign: 'center' }}>
          <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
            <StarIcon fontSize="small" sx={{ opacity: 0.4 }} />
            <Typography variant="caption" color="text.secondary">
              JM-Aura · Go 重构版 · 单二进制部署
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}
