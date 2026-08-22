// API 客户端：统一处理后端信封 {st,msg,data}、{detail} 错误体与登录门 st=1014。
// 所有响应 HTTP 状态恒为 200（除 FastAPI 风格 4xx），以 st 判定业务结果。

export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export const STATUS_OK = 1001
export const STATUS_NOT_LOGIN = 1014

export const UNAUTHORIZED_EVENT = 'aura:unauthorized'

export class ApiError extends Error {
  readonly st: number
  readonly httpStatus: number

  constructor(st: number, message: string, httpStatus = 0) {
    super(message)
    this.name = 'ApiError'
    this.st = st
    this.httpStatus = httpStatus
  }
}

interface EnvelopeBody {
  st?: number
  msg?: string
  data?: unknown
  detail?: unknown
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_BASE + path, { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiError(-1, '网络错误：无法连接服务器')
  }
  let body: EnvelopeBody = {}
  try {
    body = (await res.json()) as EnvelopeBody
  } catch {
    /* 空响应体或非 JSON */
  }
  if (body.detail !== undefined || (!res.ok && body.st === undefined)) {
    const detail =
      typeof body.detail === 'string' ? body.detail : `请求失败（HTTP ${res.status}）`
    throw new ApiError(-1, detail, res.status)
  }
  const st = typeof body.st === 'number' ? body.st : res.ok ? STATUS_OK : -1
  if (st === STATUS_NOT_LOGIN) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(STATUS_NOT_LOGIN, '请先登录 Aura 账号', res.status)
  }
  if (st !== STATUS_OK) {
    throw new ApiError(st, body.msg || `请求失败（st=${st}）`, res.status)
  }
  return body.data as T
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, jsonInit('POST', body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, jsonInit('PUT', body)),
  del: <T>(path: string, body?: unknown) => request<T>(path, jsonInit('DELETE', body)),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  qs,
  url: (path: string) => API_BASE + path,
}
