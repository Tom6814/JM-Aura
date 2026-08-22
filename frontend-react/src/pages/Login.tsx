import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import HowToRegIcon from '@mui/icons-material/HowToReg'
import LockIcon from '@mui/icons-material/Lock'
import PersonIcon from '@mui/icons-material/Person'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'

export default function Login() {
  const navigate = useNavigate()
  const { user, loading, refresh } = useAuth()
  const [hasUsers, setHasUsers] = useState<boolean | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<{ has_users: boolean }>('/api/site/status')
      .then((d) => setHasUsers(d.has_users))
      .catch(() => setHasUsers(true))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    if (hasUsers === false && password !== password2) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      if (hasUsers === false) {
        await api.post('/api/site/register', { username: username.trim(), password })
      } else {
        await api.post('/api/site/login', { username: username.trim(), password })
      }
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  if (loading || hasUsers === null) {
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

  const isRegister = hasUsers === false

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto', mt: { xs: 4, md: 8 }, borderRadius: 5 }}>
      <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <AccountCircleIcon color="primary" sx={{ fontSize: 48 }} />
          <Typography variant="h5" fontWeight={800} mt={1}>
            {isRegister ? '初始化站长账号' : '登录 Aura'}
          </Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            {isRegister
              ? '首次使用：创建的账号即站点管理员（同时校验 JM 凭据）'
              : '使用 JM 账号密码登录本站'}
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
            label="用户名"
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
            autoComplete={isRegister ? 'new-password' : 'current-password'}
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
          {isRegister && (
            <TextField
              fullWidth
              margin="normal"
              label="确认密码"
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
            />
          )}
          <Button
            fullWidth
            size="large"
            type="submit"
            variant="contained"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <HowToRegIcon />}
            sx={{ mt: 2.5 }}
          >
            {isRegister ? '注册并进入' : '登录'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
