// 下载管理：POST /api/v2/jm/download/tasks {comic_id,include_all} 创建整本下载；
// GET /api/v2/jm/download/tasks/{task_id} 轮询；DELETE 排队期取消；completed 后 download_url 提供 ZIP。
// 后端无"任务列表"端点，已创建任务登记在 localStorage，由前端负责轮询与追踪。
import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddTaskIcon from '@mui/icons-material/AddTask'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DownloadIcon from '@mui/icons-material/Download'
import { api } from '../api'
import { EmptyState, SectionTitle } from '../components'

interface TaskPub {
  task_id: string
  album_title: string
  status: string
  stage: string
  message: string
  total_images: number
  downloaded_images: number
  zipped_files: number
  total_zip_files: number
  percent: number
  download_url: string
}

interface TaskEntry {
  task_id: string
  title: string
}

const LS_KEY = 'aura.dl.tasks'

function loadEntries(): TaskEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr
      .filter((e) => e && typeof e.task_id === 'string')
      .map((e) => ({ task_id: e.task_id as string, title: String(e.title ?? '') }))
  } catch {
    return []
  }
}

function persistEntries(list: TaskEntry[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

function asPub(v: unknown, fallbackTitle: string): TaskPub | null {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  if (!r || typeof r.task_id !== 'string') return null
  return {
    task_id: r.task_id,
    album_title: String(r.album_title ?? fallbackTitle),
    status: String(r.status ?? 'unknown'),
    stage: String(r.stage ?? ''),
    message: String(r.message ?? ''),
    total_images: Number(r.total_images) || 0,
    downloaded_images: Number(r.downloaded_images) || 0,
    zipped_files: Number(r.zipped_files) || 0,
    total_zip_files: Number(r.total_zip_files) || 0,
    percent: Number(r.percent) || 0,
    download_url: String(r.download_url ?? ''),
  }
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  downloading: '下载中',
  zipping: '打包中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function statusColor(status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'cancelled') return 'default'
  if (status === 'queued') return 'warning'
  return 'primary'
}

export default function Downloads() {
  const [entries, setEntries] = useState<TaskEntry[]>(() => loadEntries())
  const [tasks, setTasks] = useState<Record<string, TaskPub>>({})
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const poll = async () => {
      const list = loadEntries()
      await Promise.all(
        list.map(async (en) => {
          try {
            const raw = await api.get(`/api/v2/jm/download/tasks/${encodeURIComponent(en.task_id)}`)
            const pub = asPub(raw, en.title)
            if (alive && pub) setTasks((m) => ({ ...m, [pub.task_id]: pub }))
          } catch {
            /* 单次轮询失败静默跳过，下轮重试 */
          }
        }),
      )
      if (alive) timer = window.setTimeout(() => void poll(), 2500)
    }
    void poll()
    return () => {
      alive = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  const add = async () => {
    const comicId = input.trim()
    if (!comicId || adding) return
    setAdding(true)
    setAddErr(null)
    try {
      const raw = await api.post('/api/v2/jm/download/tasks', { comic_id: comicId, include_all: true })
      const pub = asPub(raw, `作品 ${comicId}`)
      if (!pub) throw new Error('创建任务返回格式异常')
      const next = [{ task_id: pub.task_id, title: pub.album_title }, ...loadEntries()]
      persistEntries(next)
      setEntries(next)
      setTasks((m) => ({ ...m, [pub.task_id]: pub }))
      setInput('')
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const cancelTask = async (en: TaskEntry) => {
    try {
      await api.del(`/api/v2/jm/download/tasks/${encodeURIComponent(en.task_id)}`)
    } catch (e) {
      // 非排队态取消会被后端拒绝，提示但仍然允许移出列表
      window.alert(e instanceof Error ? e.message : String(e))
    }
    removeEntry(en)
  }

  const removeEntry = (en: TaskEntry) => {
    const next = loadEntries().filter((x) => x.task_id !== en.task_id)
    persistEntries(next)
    setEntries(next)
    setTasks((m) => {
      const { [en.task_id]: _drop, ...rest } = m
      return rest
    })
  }

  return (
    <Stack spacing={2}>
      <SectionTitle>
        <DownloadIcon sx={{ color: 'primary.main' }} /> 下载管理
      </SectionTitle>

      <Card sx={{ borderRadius: 3 }}>
        <CardContent>
          <TextField
            fullWidth
            size="small"
            label="输入作品 ID，一键打包下载全话"
            placeholder="例如 447422"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Button variant="contained" size="small" disabled={adding || !input.trim()} onClick={() => void add()} startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddTaskIcon />}>
                      创建任务
                    </Button>
                  </InputAdornment>
                ),
              },
            }}
          />
          {addErr && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
              {addErr}
            </Typography>
          )}
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <EmptyState icon={<DownloadIcon />} text="暂无下载任务" />
      ) : (
        entries.map((en) => {
          const t = tasks[en.task_id]
          return (
            <Card key={en.task_id} sx={{ borderRadius: 3 }}>
              <CardContent>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography fontWeight={600} noWrap>
                    {t?.album_title || en.title || `作品 ${en.task_id}`}
                  </Typography>
                  <Stack direction="row" alignItems="center">
                    {t?.status === 'completed' && t.download_url ? (
                      <Button size="small" variant="contained" startIcon={<DownloadIcon />} href={api.url(t.download_url)}>
                        下载 ZIP
                      </Button>
                    ) : null}
                    {t && ['queued'].includes(t.status) ? (
                      <Tooltip title="取消任务">
                        <IconButton size="small" onClick={() => void cancelTask(en)}>
                          <CancelOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Tooltip title="移出列表">
                      <IconButton size="small" onClick={() => removeEntry(en)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>

                {!t ? (
                  <Typography variant="caption" color="text.secondary">
                    正在获取任务状态…
                  </Typography>
                ) : (
                  <>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                      <Chip size="small" color={statusColor(t.status)} label={STATUS_LABEL[t.status] ?? t.status} />
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {t.message || t.stage}
                      </Typography>
                    </Stack>
                    <Box sx={{ mt: 1.5 }}>
                      <LinearProgress
                        variant={t.percent > 0 ? 'determinate' : 'indeterminate'}
                        value={Math.min(100, t.percent * (t.percent <= 1 ? 100 : 1))}
                      />
                    </Box>
                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75 }}>
                      <Typography variant="caption" color="text.secondary">
                        图片 {t.downloaded_images}/{t.total_images}
                        {t.total_zip_files > 0 ? ` · 打包 ${t.zipped_files}/${t.total_zip_files}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(t.percent * (t.percent <= 1 ? 100 : 1)).toFixed(1)}%
                      </Typography>
                    </Stack>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })
      )}
    </Stack>
  )
}
