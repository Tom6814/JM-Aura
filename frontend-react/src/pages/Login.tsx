import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import LockIcon from '@mui/icons-material/Lock'
import LoginIcon from '@mui/icons-material/Login'
import PersonIcon from '@mui/icons-material/Person'
import { BRAND_GRADIENT } from '../theme'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'

const HEADING_FONT = '"Noto Serif SC", "Songti SC", "SimSun", serif'

export default function Login() {
  const navigate = useNavigate()
  const { user, loading, refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('请输入 JM 用户名和密码')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/site/login', { username: username.trim(), password })
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (user) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography>已登录为 {user.username}</Typography>
        <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </Box>
    )
  }

  return (
    <Card
      sx={{
        maxWidth: 420,
        mx: 'auto',
        mt: { xs: 4, md: 8 },
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ height: 4, background: BRAND_GRADIENT }} />
      <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography
            variant="h5"
            sx={{ fontFamily: HEADING_FONT, fontWeight: 600, letterSpacing: '0.02em' }}
          >
            禁漫天堂
          </Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            使用 JM 官方账号登录，与官网同源同体验
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={submit} noValidate>
          <TextField
            fullWidth
            margin="normal"
            label="用户名 / 邮箱"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            fullWidth
            margin="normal"
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <LockIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Button
            fullWidth
            size="large"
            type="submit"
            variant="contained"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <LoginIcon />}
            sx={{ mt: 2.5, borderRadius: 3 }}
          >
            登录
          </Button>
        </Box>

        <Divider sx={{ my: 3 }}>
          <Typography variant="caption" color="text.secondary">
            没有账号？
          </Typography>
        </Divider>
        <Typography variant="body2" color="text.secondary" textAlign="center" lineHeight={1.8}>
          请前往 JM 官方网站注册；
          <br />
          登录后收藏、评论、历史与本站完全同步。
        </Typography>
      </CardContent>
    </Card>
  )
}
