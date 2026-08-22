// 与 Go 后端 v2.go / content.go / aura.go 响应结构对齐的共享类型。

export interface ComicSummary {
  source: string
  comic_id: string
  title: string
  author?: string | null
  cover_url?: string | null
  tags: string[]
  category?: string | null
}

export interface ChapterSummary {
  id: string
  title: string
  order: number
}

export interface ComicDetail extends ComicSummary {
  description?: string | null
  chapters: ChapterSummary[]
}

export interface ChapterPage {
  name?: string | null
  url?: string | null
}

export interface ChapterRaw {
  photo_id?: string
  album_id?: string
  scramble_id?: string
  data_original_domain?: string | null
  images?: string[]
  title?: string
  index?: number
}

export interface ChapterDetail {
  source: string
  chapter_id: string
  title?: string | null
  images: ChapterPage[]
  raw: ChapterRaw
}

export interface SiteMe {
  username: string
  is_admin: boolean
}

export interface V2Comment {
  CID?: number | string
  nickname?: string
  username?: string
  content?: string
  created_at?: string
  likes?: number | string
  spoiler?: string
  children?: V2Comment[]
  [key: string]: unknown
}

export interface V2UserProfile {
  source: string
  username?: string | null
  nickname?: string | null
  avatar_url?: string | null
  signature?: string | null
  raw?: Record<string, unknown>
}

/** 图片代理地址（同源，供 DescrambledImage 以 crossOrigin 加载）。
 *  domain 参数对齐旧版 Vue 实现，让后端优先用 chapter_view_template 返回的域名拉图。 */
export function chapterImageUrl(photoId: string, imageName: string, domain?: string | null): string {
  let url = `/api/chapter_image/${encodeURIComponent(photoId)}/${encodeURIComponent(imageName)}`
  if (domain) {
    url += `?domain=${encodeURIComponent(domain)}`
  }
  return url
}
