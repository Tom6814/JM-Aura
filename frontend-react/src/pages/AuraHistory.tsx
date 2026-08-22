// 阅读历史：GET /api/aura/library/history?limit=N
// 记录形状：{album_id, album_title, photo_id, title, page_index, timestamp}
// 笔记：GET /api/aura/library/notes/{aid} → {note?, tags?, album_id}；POST /api/aura/library/notes {album_id,tags?,note?}
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import Avatar from '@mui/material/Avatar'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import HistoryIcon from '@mui/icons-material/History'
import NotesIcon from '@mui/icons-material/Notes'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { api } from '../api'
import { CenterLoading, EmptyState, ErrorState, SectionTitle, useAsync } from '../components'
import { useAuth } from '../auth'

interface HistoryItem {
  album_id: string
  album_title: string
  photo_id: string
  title: string
  page_index: number
  timestamp: number
}

function formatTime(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export default function AuraHistory() {
  const { user } = useAuth()
  const history = useAsync<HistoryItem[]>(async () => {
    const d = await api.get<unknown>(`/api/aura/library/history${api.qs({ limit: 200 })}`)
    return Array.isArray(d) ? (d as HistoryItem[]) : []
  }, [])
  const [noteTarget, setNoteTarget] = useState<HistoryItem | null>(null)

  if (!user)
    return (
      <EmptyState
        icon={<HistoryIcon />}
        text="登录 JM 账号后可同步阅读历史"
        action={
          <Button component={RouterLink} to="/login" variant="contained">
            去登录
          </Button>
        }
      />
    )
  if (history.loading) return <CenterLoading />
  if (history.error)
    return <ErrorState message={`阅读历史加载失败：${history.error}`} onRetry={history.reload} />

  const items = history.data ?? []

  return (
    <Stack spacing={1}>
      <SectionTitle>
        <HistoryIcon sx={{ color: 'primary.main' }} /> 阅读历史
      </SectionTitle>
      {items.length === 0 ? (
        <EmptyState icon={<HistoryIcon />} text="还没有阅读记录，去挑一本吧" />
      ) : (
        <List sx={{ bgcolor: 'background.paper', borderRadius: 3, overflow: 'hidden' }}>
          {items.map((it, i) => {
            const label = it.title || it.album_title || `作品 ${it.album_id}`
            const target = `/reader/${encodeURIComponent(it.photo_id || it.album_id)}`
            return (
              <Box key={it.album_id}>
                {i > 0 && <Divider variant="inset" component="li" />}
                <ListItem
                  secondaryAction={
                    <Stack direction="row" spacing={0.5}>
                      <Button size="small" startIcon={<NotesIcon />} onClick={() => setNoteTarget(it)}>
                        笔记
                      </Button>
                      <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} component={RouterLink} to={target}>
                        继续
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'primary.main', fontSize: 14 }}>{it.page_index > 0 ? `${it.page_index + 1}` : '1'}</Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={label}
                    secondary={
                      <>
                        {it.album_title && it.title && it.album_title !== it.title ? `${it.album_title} · ` : ''}
                        第 {it.page_index + 1} 页 · {formatTime(it.timestamp)}
                      </>
                    }
                    primaryTypographyProps={{ fontWeight: 600, noWrap: true }}
                  />
                </ListItem>
              </Box>
            )
          })}
        </List>
      )}

      <NoteDialog key={noteTarget?.album_id ?? 'none'} item={noteTarget} onClose={() => setNoteTarget(null)} />
    </Stack>
  )
}

function NoteDialog({ item, onClose }: { item: HistoryItem | null; onClose: () => void }) {
  const note = useAsync<{ note?: string; tags?: string[] } | null>(async () => {
    if (!item) return null
    try {
      return await api.get(`/api/aura/library/notes/${encodeURIComponent(item.album_id)}`)
    } catch {
      return {}
    }
  }, [item?.album_id])
  const [text, setText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const value = text ?? note.data?.note ?? ''

  const save = async () => {
    if (!item) return
    setSaving(true)
    try {
      await api.post('/api/aura/library/notes', { album_id: item.album_id, note: value })
      onClose()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!item} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>笔记 · {item?.title || item?.album_title || item?.album_id}</DialogTitle>
      <DialogContent>
        {note.loading ? null : (
          <>
            <TextField
              autoFocus
              multiline
              minRows={5}
              margin="dense"
              placeholder="记录想法、进度或吐槽…"
              fullWidth
              value={value}
              onChange={(e) => setText(e.target.value)}
            />
            {note.data?.tags && note.data.tags.length > 0 ? (
              <Box sx={{ mt: 1.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {note.data.tags.map((t) => (
                  <Chip key={t} label={t} size="small" />
                ))}
              </Box>
            ) : null}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={saving || note.loading} onClick={() => void save()}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
