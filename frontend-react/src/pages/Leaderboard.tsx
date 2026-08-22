import { useState } from 'react'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Pagination from '@mui/material/Pagination'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import { api } from '../api'
import { ComicGrid, CenterLoading, EmptyState, ErrorState, useAsync } from '../components'
import type { ComicSummary } from '../types'

const SORTS = [
  { id: 'tf', title: '最多爱心' },
  { id: 'mv', title: '最多观看' },
  { id: 'mr', title: '最近更新' },
]

interface RawCategory {
  id?: unknown
  category_id?: unknown
  title?: unknown
  name?: unknown
  category?: unknown
}

export default function Leaderboard() {
  const [sort, setSort] = useState('tf')
  const [category, setCategory] = useState('0')
  const [page, setPage] = useState(1)

  const cats = useAsync(async () => {
    try {
      return await api.get<RawCategory[]>('/api/v2/jm/categories')
    } catch {
      return [] as RawCategory[]
    }
  }, [])

  const list = useAsync(
    () =>
      api.get<ComicSummary[]>(
        `/api/v2/jm/leaderboard${api.qs({ sort, category, page })}`,
      ),
    [sort, category, page],
  )

  const catOptions = (cats.data ?? []).map((c) => ({
    id: String(c.id ?? c.category_id ?? ''),
    title: String(c.title ?? c.name ?? c.category ?? ''),
  }))

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={2} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WhatshotIcon color="primary" /> 排行榜
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>排序</InputLabel>
          <Select
            value={sort}
            label="排序"
            onChange={(e) => {
              setSort(e.target.value)
              setPage(1)
            }}
          >
            {SORTS.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.title}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>分类</InputLabel>
          <Select
            value={category}
            label="分类"
            onChange={(e) => {
              setCategory(e.target.value)
              setPage(1)
            }}
          >
            <MenuItem value="0">全部分类</MenuItem>
            {catOptions
              .filter((c) => c.id !== '' && c.id !== '0')
              .map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.title}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
      </Stack>

      {list.loading ? (
        <CenterLoading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState text="没有找到内容" icon={<WhatshotIcon />} />
      ) : (
        <>
          <ComicGrid items={list.data} />
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <Pagination
              count={50}
              page={page}
              onChange={(_, p) => {
                setPage(p)
                window.scrollTo({ top: 0 })
              }}
              color="primary"
            />
          </Box>
        </>
      )}
    </Box>
  )
}
