import { useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardMedia from '@mui/material/CardMedia'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Pagination from '@mui/material/Pagination'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DownloadIcon from '@mui/icons-material/Download'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import SendIcon from '@mui/icons-material/Send'
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { CenterLoading, EmptyState, ErrorState, SectionTitle, useAsync } from '../components'
import { useToast } from '../toast'
import type { ChapterSummary, ComicDetail as ComicDetailData, V2Comment } from '../types'

function CommentNode({
  node,
  onReply,
  depth = 0,
}: {
  node: V2Comment
  onReply: (n: V2Comment) => void
  depth?: number
}) {
  const [liked, setLiked] = useState(false)
  const [busy, setBusy] = useState(false)
  const cid = String(node.CID ?? '')
  const children = Array.isArray(node.children) ? node.children : []

  const like = async () => {
    if (!cid || liked || busy) return
    setBusy(true)
    try {
      await api.post(`/api/v2/jm/comment/${encodeURIComponent(cid)}/like`)
      setLiked(true)
    } catch (e) {
      if (e instanceof ApiError && e.st === 1014) window.dispatchEvent(new Event('aura:unauthorized'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ pl: depth > 0 ? 3 : 0 }}>
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          py: 1.5,
          px: depth === 0 ? 0 : 1.5,
          borderRadius: 3,
        }}
      >
        <Box
          sx={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {(node.nickname || node.username || 'U').slice(0, 1).toUpperCase()}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            {node.nickname || node.username || '匿名'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {node.content}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
            <Button size="small" startIcon={<ThumbUpAltOutlinedIcon fontSize="small" />} disabled={busy || liked} onClick={() => void like()} sx={{ minWidth: 0 }}>
              {node.likes !== undefined && Number(node.likes) > 0 ? Number(node.likes) : '赞'}
            </Button>
            {depth === 0 && (
              <Button size="small" onClick={() => onReply(node)} sx={{ minWidth: 0 }}>
                回复
              </Button>
            )}
          </Stack>
        </Box>
      </Box>
      {children.map((c) => (
        <CommentNode key={String(c.CID)} node={c} onReply={onReply} depth={depth + 1} />
      ))}
    </Box>
  )
}

export default function ComicDetail() {
  const { comicId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()

  const [favLoading, setFavLoading] = useState(false)
  const [dlLoading, setDlLoading] = useState(false)
  const [commentPage, setCommentPage] = useState(1)
  const [replyTo, setReplyTo] = useState<V2Comment | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const detail = useAsync(() => api.get<ComicDetailData>(`/api/v2/jm/comic/${encodeURIComponent(comicId)}`), [comicId])
  const comments = useAsync(
    async () => {
      try {
        return await api.get<{ list?: V2Comment[]; total?: number } | V2Comment[]>(
          `/api/v2/jm/comic/${encodeURIComponent(comicId)}/comments${api.qs({ page: commentPage })}`,
        )
      } catch (e) {
        // 未登录时评论区降级为空，不阻塞页面
        if (e instanceof ApiError && e.st === 1014) return null
        throw e
      }
    },
    [comicId, commentPage],
  )

  if (detail.loading) return <CenterLoading label="加载漫画详情…" />
  if (detail.error)
    return (
      <Box>
        <ErrorState message={detail.error} onRetry={detail.reload} />
        <Button component={RouterLink} to="/" sx={{ mt: 2 }}>
          返回首页
        </Button>
      </Box>
    )
  if (!detail.data) return <EmptyState text="内容不存在" />

  const d = detail.data
  const chapters = d.chapters ?? []
  const coverUrl = d.cover_url
    ? api.url(
        d.cover_url.startsWith('http') ? `/api/image-proxy?url=${encodeURIComponent(d.cover_url)}` : d.cover_url,
      )
    : null

  const commentList = Array.isArray(comments.data) ? comments.data : (comments.data?.list ?? [])

  const toggleFav = async () => {
    setFavLoading(true)
    try {
      await api.post(`/api/v2/jm/comic/${encodeURIComponent(comicId)}/favorite`)
      toast('收藏状态已更新')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '操作失败', 'error')
    } finally {
      setFavLoading(false)
    }
  }

  const downloadAll = async () => {
    setDlLoading(true)
    try {
      await api.post('/api/v2/jm/download/tasks', { comic_id: comicId, include_all: true })
      toast('已加入下载队列，前往「下载管理」查看进度')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '创建任务失败', 'error')
    } finally {
      setDlLoading(false)
    }
  }

  const openChapter = (ch: ChapterSummary) => {
    // 尽力记录阅读历史（未登录则忽略）
    if (user) {
      void api
        .post('/api/aura/library/history', {
          album_id: comicId,
          album_title: d.title,
          photo_id: ch.id,
          title: ch.title,
        })
        .catch(() => {})
    }
    navigate(`/reader/${encodeURIComponent(ch.id)}`)
  }

  const sendComment = async () => {
    const content = draft.trim()
    if (!content) return
    setSending(true)
    try {
      await api.post(`/api/v2/jm/comic/${encodeURIComponent(comicId)}/comments`, {
        content,
        reply_to: replyTo ? String(replyTo.CID ?? '') || undefined : undefined,
      })
      setDraft('')
      setReplyTo(null)
      toast('评论已发送')
      comments.reload()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '发送失败', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Box>
      {/* 头部 */}
      <Card sx={{ borderRadius: 5, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 3, p: { xs: 2.5, md: 4 } }}>
          {coverUrl && (
            <CardMedia
              component="img"
              image={coverUrl}
              alt={d.title}
              decoding="async"
              sx={{
                width: { xs: '100%', sm: 210 },
                height: 'auto',
                aspectRatio: '3/4',
                objectFit: 'cover',
                borderRadius: 4,
                flexShrink: 0,
                justifySelf: 'center',
              }}
            />
          )}
          <CardContent sx={{ p: 0, flex: 1, '&:last-child': { pb: 0 } }}>
            <Typography variant="h4" component="h1" gutterBottom>
              {d.title || `#${comicId}`}
            </Typography>
            {d.author && (
              <Typography color="text.secondary" mb={1}>
                作者：{d.author}
              </Typography>
            )}
            {d.tags.length > 0 && (
              <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75} mb={2}>
                {d.tags.slice(0, 10).map((t) => (
                  <Chip key={t} label={t} size="small" variant="outlined" />
                ))}
              </Stack>
            )}
            {d.description && (
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>
                {d.description}
              </Typography>
            )}
            {chapters.length > 0 && (
              <Button
                variant="contained"
                size="large"
                startIcon={<MenuBookIcon />}
                onClick={() => openChapter(chapters[0]!)}
                sx={{ mb: 1.5, borderRadius: 3, width: { xs: '100%', sm: 'auto' }, fontWeight: 700 }}
              >
                开始阅读
              </Button>
            )}
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" startIcon={<FavoriteBorderIcon />} onClick={() => void toggleFav()} disabled={favLoading}>
                收藏
              </Button>
              <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => void downloadAll()} disabled={dlLoading}>
                {dlLoading ? <CircularProgress size={18} /> : '下载全部'}
              </Button>
            </Stack>
            {!user && (
              <Alert
                severity="info"
                sx={{ mt: 2, borderRadius: 3 }}
                action={
                  <Button color="inherit" size="small" component={RouterLink} to="/login">
                    去登录
                  </Button>
                }
              >
                登录后可使用收藏、下载与评论功能
              </Alert>
            )}
          </CardContent>
        </Box>
      </Card>

      {/* 章节 */}
      <SectionTitle>📚 章节（{chapters.length}）</SectionTitle>
      {chapters.length === 0 ? (
        <EmptyState text="无章节信息（可能为单话作品）" icon={<MenuBookIcon />} />
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
          {chapters.map((ch) => (
            <Button key={ch.id} variant="outlined" onClick={() => openChapter(ch)} sx={{ justifyContent: 'space-between', textTransform: 'none', minHeight: 46 }}>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ch.title || ch.id}
              </Box>
            </Button>
          ))}
        </Box>
      )}

      {/* 评论 */}
      <SectionTitle>💬 评论</SectionTitle>
      <Box sx={{ mb: 2 }}>
        {replyTo && (
          <Alert
            severity="info"
            sx={{ mb: 1, borderRadius: 3 }}
            onClose={() => setReplyTo(null)}
          >
            回复 @{replyTo.nickname || replyTo.username || '匿名'}
          </Alert>
        )}
        <Stack direction="row" spacing={1.5}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            size="small"
            placeholder={user ? '写下你的评论…' : '登录后参与评论'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!user || sending}
          />
          <Button variant="contained" endIcon={<SendIcon />} onClick={() => void sendComment()} disabled={!user || sending || !draft.trim()}>
            发送
          </Button>
        </Stack>
      </Box>

      {comments.error ? (
        <ErrorState message={comments.error} onRetry={comments.reload} />
      ) : comments.loading ? (
        <CenterLoading label="加载评论…" />
      ) : commentList.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" py={3}>
          还没有评论，来抢沙发吧
        </Typography>
      ) : (
        <>
          <Divider sx={{ my: 1 }} />
          {commentList.map((c) => (
            <CommentNode key={String(c.CID)} node={c} onReply={setReplyTo} />
          ))}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Pagination count={20} page={commentPage} onChange={(_, p) => setCommentPage(p)} color="primary" size="small" />
          </Box>
        </>
      )}
    </Box>
  )
}
