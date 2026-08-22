// 收藏夹：JM 云端收藏（legacy /api/favorites）。
import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Pagination from '@mui/material/Pagination'
import Stack from '@mui/material/Stack'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FolderIcon from '@mui/icons-material/Folder'
import { api } from '../api'
import type { ComicSummary } from '../types'
import { CenterLoading, ComicGrid, EmptyState, ErrorState, SectionTitle, useAsync } from '../components'
import { rawListToSummaries } from './Home'
import { useAuth } from '../auth'

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

  if (!user) {
    return (
      <Stack spacing={2}>
        <SectionTitle>
          <FavoriteIcon sx={{ color: 'primary.main' }} /> 我的收藏
        </SectionTitle>
        <Alert severity="info" sx={{ borderRadius: 3 }}>
          云端收藏需要登录 JM 账号后可见。
        </Alert>
      </Stack>
    )
  }

  return <JmFavoritesPane />
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
      <SectionTitle>
        <FavoriteIcon sx={{ color: 'primary.main' }} /> 我的收藏
      </SectionTitle>
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
