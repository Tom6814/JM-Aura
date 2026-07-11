import { createDecipheriv, createHash } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";
import sharp, { type Sharp } from "sharp";

import type { Image } from "../../../packages/shared/src/schema";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface JmApiEnvelope {
  code: number;
  data: string | JsonValue[];
  errorMsg?: string;
  msg?: string;
  [key: string]: JsonValue | undefined;
}

interface JmFetchProxyObject {
  url: string;
  headers?: HeadersInit;
}

export type JmFetchProxy = string | JmFetchProxyObject;

interface JmFetchInit extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  proxy?: JmFetchProxy;
}

export type JmImageOutputFormat = "jpeg" | "webp";

export interface JmImageDecryptContext {
  /** Scramble seed returned by JM for the chapter or album. */
  scramble_id: string;
  /** Chapter JM ID, named `aid` in the Python image entity. */
  aid: string;
  /** Image file name without suffix, for example `00001`. */
  img_file_name: string;
  /** Encoded output format after decryption. */
  format?: JmImageOutputFormat;
  /** Output quality used by Sharp encoder. */
  quality?: number;
}

export interface JMComicClientConfig {
  api_domains?: readonly string[];
  image_domains?: readonly string[];
  html_domain?: string;
  retry_times?: number;
  timeout_ms?: number;
  proxy?: JmFetchProxy;
  cookies?: Record<string, string>;
  auto_update_api_domains?: boolean;
  require_api_cookies?: boolean;
  use_fixed_timestamp?: boolean;
  app_version?: string;
  allow_insecure_tls_fallback?: boolean;
}

export interface JmDecodedApiResponse<T> {
  response: Response;
  envelope: JmApiEnvelope;
  ts: string;
  encoded_data: string;
  decoded_data: string;
  data: T;
}

export interface DownloadImageOptions {
  decrypt?: boolean;
  image?: Pick<Image, "aid" | "scramble_id" | "img_file_name">;
  format?: JmImageOutputFormat;
  quality?: number;
}

export interface JmImageEncodeResult {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  channels: number;
  format: JmImageOutputFormat;
  segmentCount: number;
}

export class JMComicClient {
  static readonly PROTOCOL = "https://";

  static readonly API_SEARCH = "/search";
  static readonly API_ALBUM = "/album";
  static readonly API_CHAPTER = "/chapter";
  static readonly API_SETTING = "/setting";
  static readonly API_LOGIN = "/login";
  static readonly API_FAVORITE = "/favorite";
  static readonly API_SCRAMBLE = "/chapter_view_template";

  static readonly SCRAMBLE_220980 = 220980;
  static readonly SCRAMBLE_268850 = 268850;
  static readonly SCRAMBLE_421926 = 421926;

  static readonly APP_TOKEN_SECRET = "185Hcomic3PAPP7R";
  static readonly APP_TOKEN_SECRET_2 = "18comicAPPContent";
  static readonly APP_DATA_SECRET = "185Hcomic3PAPP7R";
  static readonly API_DOMAIN_SERVER_SECRET = "diosfjckwpqpdfjkvnqQjsik";

  static readonly DEFAULT_API_DOMAINS = [
    "www.cdnaspa.club",
    "www.cdnaspa.vip",
    "www.cdnplaystation6.cc",
    "www.cdnplaystation6.vip",
  ] as const;

  static readonly DEFAULT_IMAGE_DOMAINS = [
    "cdn-msp.jmapiproxy1.cc",
    "cdn-msp.jmapiproxy2.cc",
    "cdn-msp2.jmapiproxy2.cc",
    "cdn-msp3.jmapiproxy2.cc",
    "cdn-msp.jmapinodeudzn.net",
    "cdn-msp3.jmapinodeudzn.net",
  ] as const;

  static readonly API_DOMAIN_SERVER_LIST = [
    "https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
    "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
    "https://rup4a04-c03.tos-cn-beijing.bytepluses.com.cn/newsvr-2025.txt",
  ] as const;

  static readonly APP_HEADERS_TEMPLATE = {
    "Accept-Encoding": "gzip, deflate",
    "user-agent":
      "Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36",
  } as const;

  static readonly HTML_HEADERS_TEMPLATE = {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    dnt: "1",
    pragma: "no-cache",
    priority: "u=0, i",
    referer: "https://18comic.vip/",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  } as const;

  private apiDomains: string[];
  private readonly imageDomains: string[];
  private readonly htmlDomain: string;
  private readonly retryTimes: number;
  private readonly timeoutMs: number;
  private readonly proxy?: JmFetchProxy;
  private readonly allowInsecureTlsFallback: boolean;
  private readonly autoUpdateApiDomains: boolean;
  private readonly requireApiCookies: boolean;
  private readonly useFixedTimestamp: boolean;
  private readonly cookieJar = new Map<string, string>();

  private appVersion: string;
  private fixedTimestampCache?: { ts: string; token: string; tokenparam: string };
  private initialized = false;
  private initializing?: Promise<void>;
  private cachedProfileSnapshot: Record<string, JsonValue> | null = null;
  private readonly insecureTlsDispatcher = new Agent({
    connect: {
      rejectUnauthorized: false,
    },
  });
  private insecureFetch = async (
    input: string,
    init: RequestInit & { dispatcher?: Agent },
  ): Promise<Response> => undiciFetch(input, init as any) as unknown as Response;

  constructor(config: JMComicClientConfig = {}) {
    this.apiDomains = [...(config.api_domains ?? JMComicClient.DEFAULT_API_DOMAINS)];
    this.imageDomains = [...(config.image_domains ?? JMComicClient.DEFAULT_IMAGE_DOMAINS)];
    this.htmlDomain = config.html_domain ?? "18comic.vip";
    this.retryTimes = config.retry_times ?? 1;
    this.timeoutMs = config.timeout_ms ?? 15_000;
    this.proxy = config.proxy;
    this.allowInsecureTlsFallback = config.allow_insecure_tls_fallback ?? true;
    this.autoUpdateApiDomains = config.auto_update_api_domains ?? true;
    this.requireApiCookies = config.require_api_cookies ?? true;
    this.useFixedTimestamp = config.use_fixed_timestamp ?? true;
    this.appVersion = config.app_version ?? "2.0.26";

    for (const [name, value] of Object.entries(config.cookies ?? {})) {
      this.cookieJar.set(name, value);
    }
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initializing) {
      this.initializing = this.performInit();
    }

    await this.initializing;
    this.initialized = true;
  }

  private async performInit(): Promise<void> {
    if (this.autoUpdateApiDomains) {
      await this.tryUpdateApiDomains();
    }

    if (this.requireApiCookies) {
      await this.ensureCookies({ skipInit: true });
    }
  }

  getCookies(): Record<string, string> {
    return Object.fromEntries(this.cookieJar.entries());
  }

  setCookies(cookies: Record<string, string>): void {
    for (const [name, value] of Object.entries(cookies)) {
      this.cookieJar.set(name, value);
    }
  }

  buildAppUserAgent(): string {
    return JMComicClient.APP_HEADERS_TEMPLATE["user-agent"];
  }

  buildHtmlHeaders(domain = this.htmlDomain): HeadersInit {
    return {
      ...JMComicClient.HTML_HEADERS_TEMPLATE,
      authority: domain,
      origin: `${JMComicClient.PROTOCOL}${domain}`,
      referer: `${JMComicClient.PROTOCOL}${domain}`,
    };
  }

  buildImageHeaders(): HeadersInit {
    return {
      ...JMComicClient.APP_HEADERS_TEMPLATE,
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "X-Requested-With": "com.JMComic3.app",
      Referer: `${JMComicClient.PROTOCOL}${this.apiDomains[0]}`,
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    };
  }

  async setting(options: { skipInit?: boolean } = {}): Promise<JmDecodedApiResponse<Record<string, JsonValue>>> {
    const result = await this.requestApi<Record<string, JsonValue>>(JMComicClient.API_SETTING, {
      skipInit: options.skipInit,
    });

    const remoteVersion = result.data["jm3_version"];
    if (typeof remoteVersion === "string" && this.compareVersions(remoteVersion, this.appVersion) === 1) {
      this.appVersion = remoteVersion;
      this.fixedTimestampCache = undefined;
    }

    return result;
  }

  async login(username: string, password: string): Promise<JmDecodedApiResponse<Record<string, JsonValue>>> {
    const result = await this.requestApi<Record<string, JsonValue>>(JMComicClient.API_LOGIN, {
      method: "POST",
      form: {
        username,
        password,
      },
    });

    const session = result.data["s"];
    if (typeof session === "string" && session.length > 0) {
      this.cookieJar.set("AVS", session);
    }

    this.cachedProfileSnapshot = result.data;

    return result;
  }

  getCachedProfileSnapshot(): Record<string, JsonValue> | null {
    return this.cachedProfileSnapshot;
  }

  async fetchProfile(): Promise<Record<string, JsonValue>> {
    const result = await this.requestApi<Record<string, JsonValue>>("/user/profile");
    return result.data;
  }

  async fetchAlbumDetail<T extends JsonValue = JsonValue>(albumId: string | number): Promise<JmDecodedApiResponse<T>> {
    return this.requestApi<T>(JMComicClient.API_ALBUM, {
      params: { id: this.parseToJmId(albumId) },
    });
  }

  async fetchChapterDetail<T extends JsonValue = JsonValue>(photoId: string | number): Promise<JmDecodedApiResponse<T>> {
    return this.requestApi<T>(JMComicClient.API_CHAPTER, {
      params: { id: this.parseToJmId(photoId) },
    });
  }

  async fetchScrambleId(photoId: string | number): Promise<string> {
    await this.init();

    const normalized = this.parseToJmId(photoId);
    const textResponse = await this.requestSignedText(JMComicClient.API_SCRAMBLE, {
      params: {
        id: normalized,
        mode: "vertical",
        page: "0",
        app_img_shunt: "1",
        express: "off",
        v: this.timestamp(),
      },
      secret: JMComicClient.APP_TOKEN_SECRET_2,
      skipInit: true,
    });

    const match = /var\s+scramble_id\s*=\s*(\d+);/.exec(textResponse.text);
    return match?.[1] ?? String(JMComicClient.SCRAMBLE_220980);
  }

  async requestApi<T extends JsonValue = JsonValue>(
    path: string,
    options: {
      method?: "GET" | "POST";
      params?: Record<string, string | number>;
      form?: Record<string, string | number>;
      headers?: HeadersInit;
      skipInit?: boolean;
      requireSuccess?: boolean;
    } = {},
  ): Promise<JmDecodedApiResponse<T>> {
    if (!options.skipInit) {
      await this.initOrContinue();
    }

    const method = options.method ?? "GET";
    const urlPath = this.withSearchParams(path, options.params);
    const { headers, ts } = this.buildApiHeaders(path, options.headers);
    const init = this.buildFetchInit(method, headers, options.form);
    const response = await this.requestWithRetry(urlPath, init, async (candidate) => {
      if (candidate.status >= 500) {
        throw new Error(`禁漫API异常响应，HTTP状态码: ${candidate.status}`);
      }

      const rawText = await candidate.clone().text();
      this.ensureApiShape(path, rawText);
    });

    this.captureCookies(response);

    if (response.status >= 500) {
      throw new Error(`禁漫API异常响应，HTTP状态码: ${response.status}`);
    }

    const rawText = await response.text();
    this.ensureApiShape(path, rawText);

    const envelope = this.parseApiEnvelope(rawText);
    if ((options.requireSuccess ?? true) && envelope.code !== 200) {
      throw new Error(`禁漫API请求失败，code=${envelope.code}，msg=${String(envelope.msg ?? envelope.errorMsg ?? "")}`);
    }

    if (Array.isArray(envelope.data) && envelope.data.length === 0 && typeof envelope.errorMsg === "string") {
      throw new Error(`data返回值异常: ${rawText}`);
    }

    if (typeof envelope.data !== "string") {
      throw new Error(`禁漫API返回的 data 不是字符串密文: ${rawText}`);
    }

    const decoded = this.decodeRespData(envelope.data, ts);
    return {
      response,
      envelope,
      ts,
      encoded_data: envelope.data,
      decoded_data: decoded,
      data: JSON.parse(decoded) as T,
    };
  }

  async requestSignedText(
    path: string,
    options: {
      method?: "GET" | "POST";
      params?: Record<string, string | number>;
      form?: Record<string, string | number>;
      headers?: HeadersInit;
      secret?: string;
      skipInit?: boolean;
    } = {},
  ): Promise<{ response: Response; text: string; ts: string }> {
    if (!options.skipInit) {
      await this.initOrContinue();
    }

    const method = options.method ?? "GET";
    const urlPath = this.withSearchParams(path, options.params);
    const { headers, ts } = this.buildApiHeaders(path, options.headers, options.secret);
    const init = this.buildFetchInit(method, headers, options.form);
    const response = await this.requestWithRetry(urlPath, init);

    this.captureCookies(response);
    return {
      response,
      text: await response.text(),
      ts,
    };
  }

  async fetchImageResponse(url: string): Promise<Response> {
    await this.initOrContinue();

    return this.requestWithRetry(
      url,
      {
        headers: this.buildImageHeaders(),
      },
      async (candidate) => {
        if (!candidate.ok) {
          throw new Error(`禁漫图片获取失败: [${url}]，http状态码=${candidate.status}`);
        }

        const bytes = new Uint8Array(await candidate.clone().arrayBuffer());
        if (bytes.length === 0) {
          throw new Error(`禁漫图片获取失败: [${url}]，响应数据为空`);
        }
      },
    );
  }

  async downloadImage(url: string, options: DownloadImageOptions = {}): Promise<Uint8Array> {
    const response = await this.fetchImageResponse(url);

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (options.decrypt !== true || options.image === undefined) {
      return bytes;
    }

    const result = await this.decryptImage(bytes, {
      aid: options.image.aid,
      scramble_id: options.image.scramble_id,
      img_file_name: options.image.img_file_name,
      format: options.format,
      quality: options.quality,
    });

    return result.data;
  }

  async encodeImage(buffer: Uint8Array, format: JmImageOutputFormat = "webp", quality = 90): Promise<JmImageEncodeResult> {
    const metadata = await sharp(buffer).metadata();
    const encoded = await this.encodeWithSharp(sharp(buffer), format, quality);

    return {
      data: encoded,
      contentType: this.contentTypeForFormat(format),
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      channels: metadata.channels ?? 0,
      format,
      segmentCount: 0,
    };
  }

  async decryptImage(buffer: Uint8Array, context: JmImageDecryptContext): Promise<JmImageEncodeResult> {
    const num = this.getScrambleNum(context.scramble_id, context.aid, context.img_file_name);
    if (num === 0) {
      return this.encodeImage(buffer, context.format ?? "webp", context.quality ?? 90);
    }

    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const reordered = this.reorderImagePixels(new Uint8Array(data), info.width, info.height, info.channels, num);
    const encoded = await this.encodeRawImage(reordered, info.width, info.height, info.channels, context.format ?? "webp", context.quality ?? 90);

    return {
      data: encoded,
      contentType: this.contentTypeForFormat(context.format ?? "webp"),
      width: info.width,
      height: info.height,
      channels: info.channels,
      format: context.format ?? "webp",
      segmentCount: num,
    };
  }

  private reorderImagePixels(source: Uint8Array, width: number, height: number, channels: number, segmentCount: number): Uint8Array {
    const output = new Uint8Array(source.byteLength);
    const rowStride = width * channels;
    const over = height % segmentCount;

    for (let i = 0; i < segmentCount; i += 1) {
      let move = Math.floor(height / segmentCount);
      const ySrc = height - move * (i + 1) - over;
      let yDst = move * i;

      if (i === 0) {
        move += over;
      } else {
        yDst += over;
      }

      const sourceStart = ySrc * rowStride;
      const sourceEnd = sourceStart + move * rowStride;
      output.set(source.subarray(sourceStart, sourceEnd), yDst * rowStride);
    }

    return output;
  }

  private async encodeRawImage(
    rawBuffer: Uint8Array,
    width: number,
    height: number,
    channels: number,
    format: JmImageOutputFormat,
    quality: number,
  ): Promise<Uint8Array> {
    const pipeline = sharp(rawBuffer, {
      raw: {
        width,
        height,
        channels: this.normalizeSharpChannels(channels),
      },
    });

    return this.encodeWithSharp(pipeline, format, quality);
  }

  private async encodeWithSharp(
    pipeline: Sharp,
    format: JmImageOutputFormat,
    quality: number,
  ): Promise<Uint8Array> {
    const transformed =
      format === "jpeg"
        ? pipeline.removeAlpha().jpeg({ quality })
        : pipeline.webp({ quality });

    return new Uint8Array(await transformed.toBuffer());
  }

  private contentTypeForFormat(format: JmImageOutputFormat): string {
    return format === "jpeg" ? "image/jpeg" : "image/webp";
  }

  private normalizeSharpChannels(channels: number): 1 | 2 | 3 | 4 {
    if (channels === 1 || channels === 2 || channels === 3 || channels === 4) {
      return channels;
    }

    throw new Error(`Sharp raw 通道数异常: ${channels}`);
  }

  getScrambleNum(scrambleId: string | number, aid: string | number, filename: string): number {
    const scramble = Number(scrambleId);
    const albumOrPhotoId = Number(aid);

    if (albumOrPhotoId < scramble) {
      return 0;
    }

    if (albumOrPhotoId < JMComicClient.SCRAMBLE_268850) {
      return 10;
    }

    const moduloBase = albumOrPhotoId < JMComicClient.SCRAMBLE_421926 ? 10 : 8;
    const digest = createHash("md5").update(`${albumOrPhotoId}${filename}`).digest("hex");
    const asciiCode = digest.charCodeAt(digest.length - 1);
    return (asciiCode % moduloBase) * 2 + 2;
  }

  getImageDomain(index = 0): string {
    if (this.imageDomains.length === 0) {
      return JMComicClient.DEFAULT_IMAGE_DOMAINS[0];
    }

    const normalizedIndex = Math.abs(index) % this.imageDomains.length;
    return this.imageDomains[normalizedIndex] ?? JMComicClient.DEFAULT_IMAGE_DOMAINS[0];
  }

  /**
   * Build the upstream manga cover URL (aligned with Python cover_url rules).
   *
   * Example:
   * - size=""     → https://{domain}/media/albums/{albumId}.jpg
   * - size="_3x4" → https://{domain}/media/albums/{albumId}_3x4.jpg
   */
  buildAlbumCoverUrl(albumId: string | number, size: "" | "_3x4" = ""): string {
    const normalizedAlbumId = this.parseToJmId(albumId);
    const domain = this.getImageDomain();
    const normalizedDomain = domain.startsWith(JMComicClient.PROTOCOL) ? domain.slice(JMComicClient.PROTOCOL.length) : domain;
    return `${JMComicClient.PROTOCOL}${normalizedDomain}/media/albums/${normalizedAlbumId}${size}.jpg`;
  }

  buildImageUrl(photoId: string | number, fileName: string, domain = this.getImageDomain()): string {
    const normalizedPhotoId = this.parseToJmId(photoId);
    const normalizedDomain = domain.startsWith(JMComicClient.PROTOCOL) ? domain.slice(JMComicClient.PROTOCOL.length) : domain;
    return `${JMComicClient.PROTOCOL}${normalizedDomain}/media/photos/${normalizedPhotoId}/${fileName}`;
  }

  buildImageDownloadUrl(image: Pick<Image, "img_url" | "query_params">): string {
    return image.query_params ? `${image.img_url}?${image.query_params}` : image.img_url;
  }

  private buildFetchInit(method: "GET" | "POST", headers: HeadersInit, form?: Record<string, string | number>): JmFetchInit {
    const init: JmFetchInit = {
      method,
      headers: this.withCookieHeader(headers),
      proxy: this.proxy,
    };

    if (method === "POST" && form !== undefined) {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) {
        body.set(key, String(value));
      }
      init.body = body.toString();
      init.headers = {
        ...this.headersToRecord(init.headers),
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      };
    }

    return init;
  }

  private async requestWithRetry(
    pathOrUrl: string,
    init: JmFetchInit,
    validateResponse?: (response: Response) => Promise<void> | void,
  ): Promise<Response> {
    const isPath = pathOrUrl.startsWith("/");
    const domains = isPath ? this.apiDomains : [""];
    let lastError: unknown;

    for (let domainIndex = 0; domainIndex < domains.length; domainIndex += 1) {
      const domain = domains[domainIndex];
      const target = isPath ? this.formatUrl(pathOrUrl, domain) : pathOrUrl;

      for (let retry = 0; retry <= this.retryTimes; retry += 1) {
        try {
          const requestInit: JmFetchInit = {
            ...init,
            signal: AbortSignal.timeout(this.timeoutMs),
          };
          const response = await this.fetchWithTlsFallback(target, requestInit);

          await validateResponse?.(response);
          return response;
        } catch (error: unknown) {
          lastError = error;
        }
      }
    }

    throw new Error(`请求重试全部失败: [${pathOrUrl}]，${String(lastError)}`);
  }

  private buildApiHeaders(path: string, extraHeaders?: HeadersInit, secret?: string): { headers: HeadersInit; ts: string } {
    const { ts, token, tokenparam } =
      path === JMComicClient.API_SCRAMBLE
        ? this.generateTokenBundle(JMComicClient.APP_TOKEN_SECRET_2)
        : this.useFixedTimestamp
          ? this.getFixedTokenBundle()
          : this.generateTokenBundle(secret ?? JMComicClient.APP_TOKEN_SECRET);

    return {
      ts,
      headers: {
        ...JMComicClient.APP_HEADERS_TEMPLATE,
        ...this.headersToRecord(extraHeaders),
        token,
        tokenparam,
      },
    };
  }

  private withCookieHeader(headers: HeadersInit): HeadersInit {
    const merged = this.headersToRecord(headers);
    const cookieHeader = this.serializeCookies();
    if (cookieHeader.length > 0) {
      merged.Cookie = cookieHeader;
    }
    return merged;
  }

  private headersToRecord(headers?: HeadersInit): Record<string, string> {
    if (headers === undefined) {
      return {};
    }

    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries());
    }

    if (Array.isArray(headers)) {
      return Object.fromEntries(headers);
    }

    return { ...headers };
  }

  private serializeCookies(): string {
    return [...this.cookieJar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private captureCookies(response: Response): void {
    const setCookieList = this.readSetCookies(response.headers);
    for (const setCookie of setCookieList) {
      const pair = setCookie.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index <= 0) {
        continue;
      }
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (name.length > 0) {
        this.cookieJar.set(name, value);
      }
    }
  }

  private readSetCookies(headers: Headers): string[] {
    const candidate = headers as Headers & { getSetCookie?: () => string[] };
    if (typeof candidate.getSetCookie === "function") {
      return candidate.getSetCookie();
    }

    const single = headers.get("set-cookie");
    if (single === null || single.length === 0) {
      return [];
    }

    return single.split(/,(?=\s*[^;=]+=[^;]+)/g);
  }

  private parseApiEnvelope(text: string): JmApiEnvelope {
    const parsed = JSON.parse(this.extractJsonObject(text)) as unknown;
    if (!this.isApiEnvelope(parsed)) {
      throw new Error(`禁漫API响应结构非法: ${text.slice(0, 200)}`);
    }
    return parsed;
  }

  private ensureApiShape(path: string, text: string): void {
    if (path === JMComicClient.API_SCRAMBLE) {
      return;
    }

    for (const char of text) {
      if (char === " " || char === "\n" || char === "\t") {
        continue;
      }

      if (char !== "{") {
        throw new Error(`请求不是json格式，强制重试！响应文本: [${text.slice(0, 200)}]`);
      }
      return;
    }

    throw new Error("响应无数据！");
  }

  private isApiEnvelope(value: unknown): value is JmApiEnvelope {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const record = value as Record<string, unknown>;
    return typeof record.code === "number" && "data" in record;
  }

  private extractJsonObject(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed;
    }

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        if (depth === 0) {
          start = index;
        }
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          return text.slice(start, index + 1);
        }
      }
    }

    throw new Error(`未解析出json数据: ${text.slice(0, 200)}`);
  }

  private decodeRespData(data: string, ts: string, secret = JMComicClient.APP_DATA_SECRET): string {
    const encrypted = Buffer.from(data, "base64");
    const key = Buffer.from(this.md5Hex(`${ts}${secret}`), "utf8");
    const decipher = createDecipheriv("aes-256-ecb", key, null);
    decipher.setAutoPadding(false);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const padding = decrypted[decrypted.length - 1] ?? 0;
    return decrypted.subarray(0, decrypted.length - padding).toString("utf8");
  }

  private async ensureCookies(options: { skipInit?: boolean } = {}): Promise<void> {
    if (this.cookieJar.size > 0) {
      return;
    }

    await this.setting({ skipInit: options.skipInit });
  }

  private async tryUpdateApiDomains(): Promise<void> {
    for (const url of JMComicClient.API_DOMAIN_SERVER_LIST) {
      try {
        const domains = await this.requestApiDomainServer(url);
        if (domains.length > 0) {
          this.apiDomains = domains;
          return;
        }
      } catch {
        continue;
      }
    }
  }

  private async requestApiDomainServer(url: string): Promise<string[]> {
    const response = await this.fetchWithTlsFallback(url, {
      proxy: this.proxy,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const raw = await response.text();
    const text = raw.replace(/^[^\x00-\x7F]+/, "");
    const decrypted = this.decodeRespData(text, "", JMComicClient.API_DOMAIN_SERVER_SECRET);
    const parsed = JSON.parse(decrypted) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }

    const record = parsed as Record<string, unknown>;
    const server = record.Server;
    if (!Array.isArray(server)) {
      return [];
    }

    return server.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  private parseToJmId(input: string | number): string {
    if (typeof input === "number") {
      return String(input);
    }

    if (/^\d+$/.test(input)) {
      return input;
    }

    if (/^jm\d+$/i.test(input)) {
      return input.slice(2);
    }

    throw new Error(`无法解析jm车号: ${input}`);
  }

  private withSearchParams(path: string, params?: Record<string, string | number>): string {
    if (params === undefined || Object.keys(params).length === 0) {
      return path;
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      query.set(key, String(value));
    }
    return `${path}?${query.toString()}`;
  }

  private formatUrl(path: string, domain: string): string {
    return domain.startsWith(JMComicClient.PROTOCOL) ? `${domain}${path}` : `${JMComicClient.PROTOCOL}${domain}${path}`;
  }

  private async fetchWithTlsFallback(input: string, init: JmFetchInit): Promise<Response> {
    try {
      return await fetch(input, init as RequestInit);
    } catch (error) {
      if (!this.shouldRetryWithInsecureTls(error)) {
        throw error;
      }

      const insecureInit: RequestInit & { dispatcher?: Agent } = {
        ...(init as RequestInit),
        dispatcher: this.insecureTlsDispatcher,
      };
      return this.insecureFetch(input, insecureInit);
    }
  }

  private async initOrContinue(): Promise<void> {
    try {
      await this.init();
    } catch (error) {
      if (this.cookieJar.has("AVS")) {
        return;
      }
      throw error;
    }
  }

  private shouldRetryWithInsecureTls(error: unknown): boolean {
    if (!this.allowInsecureTlsFallback) {
      return false;
    }

    let cursor: unknown = error;
    while (cursor && typeof cursor === "object") {
      const record = cursor as { code?: unknown; message?: unknown; cause?: unknown };
      const code = typeof record.code === "string" ? record.code : "";
      const message = typeof record.message === "string" ? record.message : "";

      if (
        code === "SELF_SIGNED_CERT_IN_CHAIN" ||
        code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
        message.includes("SELF_SIGNED_CERT_IN_CHAIN") ||
        message.includes("UNABLE_TO_GET_ISSUER_CERT_LOCALLY")
      ) {
        return true;
      }

      cursor = record.cause;
    }

    return false;
  }

  private timestamp(): string {
    return String(Math.floor(Date.now() / 1000));
  }

  private getFixedTokenBundle(): { ts: string; token: string; tokenparam: string } {
    if (this.fixedTimestampCache === undefined) {
      this.fixedTimestampCache = this.generateTokenBundle(JMComicClient.APP_TOKEN_SECRET);
    }
    return this.fixedTimestampCache;
  }

  private generateTokenBundle(secret: string): { ts: string; token: string; tokenparam: string } {
    const ts = this.timestamp();
    const tokenparam = `${ts},${this.appVersion}`;
    const token = this.md5Hex(`${ts}${secret}`);
    return { ts, token, tokenparam };
  }

  private md5Hex(input: string): string {
    return createHash("md5").update(input).digest("hex");
  }

  private compareVersions(left: string, right: string): number {
    const leftParts = left.split(".").map((part) => Number(part));
    const rightParts = right.split(".").map((part) => Number(part));
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index += 1) {
      const leftPart = leftParts[index] ?? 0;
      const rightPart = rightParts[index] ?? 0;
      if (leftPart > rightPart) {
        return 1;
      }
      if (leftPart < rightPart) {
        return -1;
      }
    }

    return 0;
  }
}
