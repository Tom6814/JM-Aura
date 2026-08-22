// 收藏夹：JM 云端收藏（legacy /api/favorites）+ Aura 本地收藏夹（/api/aura/library/folders）。
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Pagination from '@mui/material/Pagination'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FolderIcon from '@mui/icons-material/Folder'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { api } from '../api'
import type { ComicSummary } from '../types'
import { CenterLoading, ComicGrid, EmptyState, ErrorState, SectionTitle, useAsync } from '../components'
import { rawListToSummaries } from './Home'
import { useAuth } from '../auth'

interface AuraFolder {
  id: string
  name: string
  album_ids?: string[]
  count: number
}

interface JmFavorites {
  comics: ComicSummary[]
  folders: { id: string; name: string }[]
  pages: number
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export default function Favorites() {
  const { user } = useAuth()
  const [tab, setTab] = useState(0)

  return (
    <Stack spacing={2}>
      <SectionTitle>
        <FavoriteIcon sx={{ color: 'primary.main' }} /> 我的收藏
      </SectionTitle>
      <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} sx={{ borderRadius: 2 }}>
        <Tab label="JM 云端收藏" />
        <Tab label="本地收藏夹" />
      </Tabs>
      {tab === 0 ? (
        user ? null : (
          <Alert severity="info" sx={{ borderRadius: 3 }}>
            云端收藏需要登录 JM 账号后可见；本地收藏夹随登录账号保存。
          </Alert>
        )
      ) : null}
      {tab === 0 ? <JmFavoritesPane /> : <LocalFoldersPane logged={!!user} />}
    </Stack>
  )
}

function JmFavoritesPane() {
  const [page, setPage] = useState(1)
  const [folderId, setFolderId] = useState('0')

  const favs = useAsync<JmFavorites>(async () => {
    const d = asRecord(await api.get(`/api/favorites${api.qs({ page, folder_id: folderId })}`))
    const rawFolders = Array.isArray(d.folders) ? d.folders : []
    return {
      comics: rawListToSummaries(d.content),
      folders: rawFolders.map((f) => {
        const r = asRecord(f)
        const id = String(r.id ?? r.fid ?? r.folder_id ?? '')
        const name = String(r.name ?? '未命名')
        return { id, name }
      }),
      pages: Number(d.pages) || 1,
    }
  }, [page, folderId])

  if (favs.loading) return <CenterLoading />
  if (favs.error)
    return <ErrorState message={`云端收藏加载失败：${favs.error}`} onRetry={favs.reload} />

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip
          label="全部分类"
          color={folderId === '0' ? 'primary' : 'default'}
          onClick={() => {
            setFolderId('0')
            setPage(1)
          }}
        />
        {favs.data?.folders.map((f) => (
          <Chip
            key={f.id}
            label={f.name}
            icon={<FolderIcon />}
            color={folderId === f.id ? 'primary' : 'default'}
            onClick={() => {
              setFolderId(f.id || '0')
              setPage(1)
            }}
          />
        ))}
      </Stack>
      {favs.data && favs.data.comics.length > 0 ? (
        <ComicGrid items={favs.data.comics} />
      ) : (
        <EmptyState icon={<FavoriteIcon />} text="暂无云端收藏" />
      )}
      {(favs.data?.pages ?? 1) > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pb: 2 }}>
          <Pagination
            count={favs.data!.pages}
            page={page}
            onChange={(_e, v: number) => setPage(v)}
            shape="rounded"
          />
        </Box>
      )}
    </Stack>
  )
}

function LocalFoldersPane({ logged }: { logged: boolean }) {
  const folders = useAsync(async () => {
    const d = await api.get<{ folders?: AuraFolder[] }>('/api/aura/library/folders')
    return Array.isArray(d?.folders) ? d.folders : []
  }, [])
  const [selected, setSelected] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'rename'>('create')
  const [editTarget, setEditTarget] = useState<AuraFolder | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [menu, setMenu] = useState<{ folder: AuraFolder; x: number; y: number } | null>(null)

  if (!logged)
    return (
      <EmptyState
        icon={<FolderIcon />}
        text="登录 JM 账号后可使用本地收藏夹"
        action={
          <Button component={RouterLink} to="/login" variant="contained">
            去登录
          </Button>
        }
      />
    )
  if (folders.loading) return <CenterLoading />
  if (folders.error)
    return <ErrorState message={`收藏夹加载失败：${folders.error}`} onRetry={folders.reload} />

  const list = folders.data ?? []
  const current = list.find((f) => f.id === selected) ?? null

  const openCreate = () => {
    setDialogMode('create')
    setEditTarget(null)
    setNameInput('')
    setDialogOpen(true)
  }
  const openRename = (f: AuraFolder) => {
    setDialogMode('rename')
    setEditTarget(f)
    setNameInput(f.name)
    setDialogOpen(true)
  }
  const submitDialog = async () => {
    const name = nameInput.trim()
    if (!name) return
    try {
      if (dialogMode === 'create') {
        await api.post('/api/aura/library/folders', { name })
      } else if (editTarget) {
        await api.put('/api/aura/library/folders', { folder_id: editTarget.id, name })
      }
      setDialogOpen(false)
      folders.reload()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }
  const removeFolder = async (f: AuraFolder) => {
    if (!window.confirm(`确认删除收藏夹「${f.name}」？`)) return
    try {
      await api.del('/api/aura/library/folders', { folder_id: f.id })
      if (selected === f.id) setSelected(null)
      folders.reload()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Stack spacing={2}>
      <SectionTitle
        action={
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={openCreate}>
            新建收藏夹
          </Button>
        }
      >
        共 {list.length} 个收藏夹
      </SectionTitle>

      {list.length === 0 ? (
        <EmptyState icon={<FolderIcon />} text="还没有收藏夹，点击右上角新建一个吧" />
      ) : (
        <>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {list.map((f) => (
              <Chip
                key={f.id}
                icon={<FolderIcon />}
                label={`${f.name} (${f.count})`}
                color={selected === f.id ? 'primary' : 'default'}
                onClick={() => setSelected(selected === f.id ? null : f.id)}
                onDelete={(e) => setMenu({ folder: f, x: (e.target as HTMLElement).getBoundingClientRect().left, y: (e.target as HTMLElement).getBoundingClientRect().bottom })}
                deleteIcon={<MoreVertIcon />}
              />
            ))}
          </Stack>

          {current &&
            (current.album_ids && current.album_ids.length > 0 ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(4,1fr)' }, gap: 2 }}>
                {current.album_ids.map((aid) => (
                  <Card key={aid}>
                    <CardActionArea component={RouterLink} to={`/comic/${encodeURIComponent(aid)}`} sx={{ p: 2 }}>
                      <Typography variant="body2" fontWeight={600}>
                        📖 作品 {aid}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        点击查看详情
                      </Typography>
                    </CardActionArea>
                  </Card>
                ))}
              </Box>
            ) : (
              <EmptyState icon={<FolderIcon />} text={`「${current.name}」还是空的`} />
            ))}
        </>
      )}

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}>
        <MenuItem
          onClick={() => {
            if (menu) openRename(menu.folder)
            setMenu(null)
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>重命名</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) void removeFolder(menu.folder)
            setMenu(null)
          }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>删除</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{dialogMode === 'create' ? '新建收藏夹' : '重命名收藏夹'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="名称"
            fullWidth
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void submitDialog()}>
            确定
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
