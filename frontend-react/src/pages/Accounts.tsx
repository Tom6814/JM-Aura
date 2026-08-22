// JM 账号管理：
// - 列表 GET /api/aura/accounts → {active, accounts:[{username,active,has_password}]}
// - 添加 POST /api/aura/accounts/add {username,password,set_active}（后端经真实 JM Login 校验）
// - 切换 POST /api/aura/accounts/switch {username}
// - 移除 POST /api/aura/accounts/remove {username}
// - 收藏夹同步到 JM：POST /api/aura/sync-to-jm {folder_ids?,create_missing_folders?}
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import Avatar from '@mui/material/Avatar'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import SyncIcon from '@mui/icons-material/Sync'
import { api } from '../api'
import { CenterLoading, EmptyState, ErrorState, SectionTitle, useAsync } from '../components'
import { useAuth } from '../auth'
import { useToast } from '../toast'

interface JmAccount {
  username: string
  active: boolean
  has_password: boolean
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export default function Accounts() {
  const { user } = useAuth()
  if (!user)
    return (
      <EmptyState
        icon={<ManageAccountsIcon />}
        text="登录 Aura 账号后可管理绑定的 JM 账号"
        action={
          <Button component={RouterLink} to="/login" variant="contained">
            去登录
          </Button>
        }
      />
    )
  return (
    <Stack spacing={2}>
      <SectionTitle>
        <ManageAccountsIcon sx={{ color: 'primary.main' }} /> JM 账号管理
      </SectionTitle>
      <AccountList />
      <AddAccountCard />
      <SyncCard />
    </Stack>
  )
}

function AccountList() {
  const { toast } = useToast()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const accounts = useAsync<{ active: string; list: JmAccount[] }>(async () => {
    const d = asRecord(await api.get('/api/aura/accounts'))
    return {
      active: String(d.active ?? ''),
      list: Array.isArray(d.accounts)
        ? (d.accounts as Record<string, unknown>[]).map((a) => ({
            username: String(a.username ?? ''),
            active: Boolean(a.active),
            has_password: Boolean(a.has_password),
          }))
        : [],
    }
  }, [tick])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await fn()
      setTick((t) => t + 1)
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  if (accounts.loading) return <CenterLoading />
  if (accounts.error)
    return <ErrorState message={`账号列表加载失败：${accounts.error}`} onRetry={accounts.reload} />

  const list = accounts.data?.list ?? []
  if (list.length === 0)
    return <EmptyState icon={<ManageAccountsIcon />} text="尚未绑定任何 JM 账号，请在下方添加" />

  return (
    <Stack spacing={1}>
      {list.map((a) => (
        <Card key={a.username} sx={{ borderRadius: 3 }}>
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: '14px !important' }}>
            <ListItemAvatar sx={{ minWidth: 'auto' }}>
              <Avatar sx={{ bgcolor: a.active ? 'primary.main' : 'action.hover', color: a.active ? 'primary.contrastText' : 'text.secondary' }}>
                {(a.username[0] || '?').toUpperCase()}
              </Avatar>
            </ListItemAvatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={600} noWrap>
                {a.username}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {a.has_password ? '已保存密码，可一键切换' : '未保存密码'}
              </Typography>
            </Box>
            {a.active ? <Chip size="small" color="success" label="当前使用" /> : null}
            {!a.active && a.has_password ? (
              <Tooltip title="切换到此账号">
                <span>
                  <IconButton
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`switch-${a.username}`, () =>
                        api.post('/api/aura/accounts/switch', { username: a.username }),
                      )
                    }
                  >
                    <SwapHorizIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip title="移除绑定">
              <span>
                <IconButton
                  disabled={busy !== null}
                  onClick={() => {
                    if (!window.confirm(`确认移除账号「${a.username}」？其云端收藏与浏览数据将不再同步。`)) return
                    void run(`remove-${a.username}`, () =>
                      api.post('/api/aura/accounts/remove', { username: a.username }),
                    )
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </CardContent>
        </Card>
      ))}
    </Stack>
  )
}

function AddAccountCard() {
  const { toast } = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [setActive, setSetActive] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!username.trim() || !password || busy) return
    setBusy(true)
    try {
      await api.post('/api/aura/accounts/add', {
        username: username.trim(),
        password,
        set_active: setActive,
      })
      toast('账号已绑定')
      setUsername('')
      setPassword('')
      window.setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card sx={{ borderRadius: 3 }}>
      <CardContent>
        <SectionTitle>
          <AddIcon /> 绑定新账号
        </SectionTitle>
        <Alert severity="info" sx={{ borderRadius: 3, mb: 2 }}>
          后端将使用 JM 官方登录接口校验账号有效性；校验通过后自动保存在线会话。
        </Alert>
        <Stack spacing={1.5}>
          <TextField size="small" label="JM 用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          <TextField
            size="small"
            type="password"
            label="JM 密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <FormControlLabel
            control={<Checkbox checked={setActive} onChange={(e) => setSetActive(e.target.checked)} />}
            label="设为当前使用的账号"
          />
          <Button variant="contained" startIcon={<AddIcon />} disabled={busy || !username.trim() || !password} onClick={() => void submit()}>
            {busy ? '验证中…' : '绑定'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

function SyncCard() {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const sync = async () => {
    setBusy(true)
    try {
      await api.post('/api/aura/sync-to-jm', { create_missing_folders: true })
      toast('本地收藏夹已同步到 JM 云端')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card sx={{ borderRadius: 3 }}>
      <CardContent>
        <SectionTitle>
          <SyncIcon /> 同步到 JM 云端
        </SectionTitle>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          将所有本地收藏夹推送到当前 JM 账号（缺失的文件夹会自动创建）。
        </Typography>
        <Button variant="outlined" startIcon={<SyncIcon />} disabled={busy} onClick={() => void sync()}>
          {busy ? '同步中…' : '开始同步'}
        </Button>
      </CardContent>
    </Card>
  )
}
