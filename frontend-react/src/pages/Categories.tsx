import { useState } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import ExploreIcon from '@mui/icons-material/Explore'
import { api } from '../api'
import { ComicGrid, CenterLoading, EmptyState, ErrorState, useAsync } from '../components'
import type { ComicSummary } from '../types'

interface RawCategory {
  id?: unknown
  category_id?: unknown
  title?: unknown
  name?: unknown
  category?: unknown
}

export default function Categories() {
  const [selected, setSelected] = useState('0')

  const cats = useAsync(async () => {
    try {
      return await api.get<RawCategory[]>('/api/v2/jm/categories')
    } catch {
      return [] as RawCategory[]
    }
  }, [])

  const list = useAsync(
    () => api.get<ComicSummary[]>(`/api/v2/jm/leaderboard${api.qs({ sort: 'mr', category: selected, page: 1 })}`),
    [selected],
  )

  const options = [
    { id: '0', title: '全部' },
    ...(cats.data ?? [])
      .map((c) => ({
        id: String(c.id ?? c.category_id ?? ''),
        title: String(c.title ?? c.name ?? c.category ?? ''),
      }))
      .filter((c) => c.id !== '' && c.id !== '0'),
  ]

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={2} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ExploreIcon color="primary" /> 分类浏览
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        {cats.loading && <CenterLoading label="加载分类…" />}
        {options.map((c) => (
          <Chip
            key={c.id}
            label={c.title}
            clickable
            color={selected === c.id ? 'primary' : 'default'}
            variant={selected === c.id ? 'filled' : 'outlined'}
            onClick={() => setSelected(c.id)}
          />
        ))}
      </Box>

      {list.loading ? (
        <CenterLoading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState text="该分类暂无内容" icon={<ExploreIcon />} />
      ) : (
        <ComicGrid items={list.data} />
      )}
    </Box>
  )
}
