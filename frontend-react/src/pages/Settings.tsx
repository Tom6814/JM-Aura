// 设置页：
// - 外观模式（本地主题上下文）
// - JM 连接状态 GET /api/config（legacy 裸响应）+ 会话重登 POST /api/session/relogin
// - 已存凭证 GET/DELETE /api/credentials
// - 下载缓存清理 POST /api/v2/cache/cleanup?keep_days=N
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import CloudSyncIcon from '@mui/icons-material/CloudSync'
import PaletteIcon from '@mui/icons-material/Palette'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import { api } from '../api'
import { CenterLoading, EmptyState, ErrorState, SectionTitle, useAsync } from '../components'
import { useAuth } from '../auth'
import { useThemeMode } from '../mode'
import { useToast } from '../toast'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export default function Settings() {
  const { user } = useAuth()
  if (!user)
    return (
      <EmptyState
        icon={<PersonOutlineIcon />}
        text="登录 JM 账号后可管理设置"
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
        <PersonOutlineIcon sx={{ color: 'primary.main' }} /> 设置
      </SectionTitle>
      <AppearanceCard />
      <JmConnectionCard />
      <MaintenanceCard />
    </Stack>
  )
}

function AppearanceCard() {
  const { mode, toggle } = useThemeMode()
  return (
    <Card sx={{ borderRadius: 3 }}>
      <CardContent>
        <SectionTitle>
          <PaletteIcon /> 外观
        </SectionTitle>
        <FormControlLabel
          control={<Switch checked={mode === 'dark'} onChange={toggle} />}
          label={mode === 'dark' ? '深色模式' : '浅色模式'}
        />
      </CardContent>
    </Card>
  )
}

function JmConnectionCard() {
  const { toast } = useToast()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const cfg = useAsync(
    async () =>
      asRecord(await api.get('/api/config')) as { username?: string; is_logged_in?: boolean },
    [tick],
  )

  const relogin = async () => {
    setBusy(true)
    try {
      await api.post('/api/session/relogin', {})
      toast('JM 会话已刷新')
      setTick((t) => t + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card sx={{ borderRadius: 3 }}>
      <CardContent>
        <SectionTitle
          action={
            <Chip
              size="small"
              color={cfg.data?.is_logged_in ? 'success' : 'default'}
              label={cfg.data?.is_logged_in ? '已连接' : '未连接'}
            />
          }
        >
          <CloudSyncIcon /> JM 连接
        </SectionTitle>
        {cfg.loading ? (
          <CenterLoading label="检测中…" />
        ) : cfg.error ? (
          <ErrorState message={`状态获取失败：${cfg.error}`} onRetry={cfg.reload} />
        ) : (
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Typography variant="body2">
              账号：
              {cfg.data?.username || '未登录'}
            </Typography>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void relogin()}>
              刷新会话
            </Button>
          </Stack>
        )}
        <Divider sx={{ my: 1.5 }} />
        <CredentialsRow onChanged={() => setTick((t) => t + 1)} />
      </CardContent>
    </Card>
  )
}

function CredentialsRow({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast()
  const cred = useAsync(
    async () => asRecord(await api.get('/api/credentials')) as { has_saved?: boolean; username?: string },
    [],
  )

  const clear = async () => {
    if (!window.confirm('确认清除已保存的 JM 账号密码？')) return
    try {
      await api.del('/api/credentials')
      toast('凭证已清除')
      cred.reload()
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
      <Typography variant="body2">
        <VpnKeyIcon fontSize="inherit" sx={{ verticalAlign: '-0.15em', mr: 0.5 }} />
        {cred.loading
          ? '凭证读取中…'
          : cred.data?.has_saved
            ? `已保存凭据：${cred.data.username || ''}`
            : '未保存 JM 密码'}
      </Typography>
      {cred.data?.has_saved ? (
        <Button size="small" color="error" onClick={() => void clear()}>
          清除凭证
        </Button>
      ) : null}
    </Stack>
  )
}

function MaintenanceCard() {
  const { toast } = useToast()
  const [keepDays, setKeepDays] = useState('7')
  const [busy, setBusy] = useState(false)

  const cleanup = async () => {
    setBusy(true)
    try {
      const d = asRecord(
        await api.post(`/api/v2/cache/cleanup${api.qs({ keep_days: Number(keepDays) || 7 })}`, {}),
      )
      toast(`已清理 ${Number(d.removed_dirs) || 0} 个缓存目录`)
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
          <CleaningServicesIcon /> 缓存维护
        </SectionTitle>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <TextField
            size="small"
            type="number"
            label="保留最近天数"
            value={keepDays}
            onChange={(e) => setKeepDays(e.target.value)}
            sx={{ width: 160 }}
          />
          <Button variant="contained" disabled={busy} onClick={() => void cleanup()}>
            清理下载缓存
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          仅清理超过保留期的已完成下载缓存，不影响任务记录。
        </Typography>
      </CardContent>
    </Card>
  )
}
