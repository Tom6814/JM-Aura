import hashlib
import time
import json
import requests
import urllib.parse
from jmcomic import JmCryptoTool
from backend.core.config import GlobalConfig
from backend.core.http_session import get_session
import platform
from urllib.parse import urlparse, urlunparse

from requests.packages.urllib3.exceptions import InsecureRequestWarning
requests.packages.urllib3.disable_warnings(InsecureRequestWarning)

_DOH_CACHE: dict[str, str] = {}
_LAST_OK_API_BASE: str | None = None


def get_last_ok_api_base() -> str | None:
    return _LAST_OK_API_BASE


def get_current_api_base() -> str:
    try:
        v = GlobalConfig.GetApiUrl()
        return v if isinstance(v, str) else ""
    except Exception:
        return ""


def get_current_img_base() -> str:
    try:
        v = GlobalConfig.GetImgUrl()
        return v if isinstance(v, str) else ""
    except Exception:
        return ""

class ServerReq(object):
    def __init__(self, url, params=None, method="POST") -> None:
        self.url = url
        self.params = params or {}
        self.method = method
        self.timeout = 10
        self.proxy = None
        self.cookies = {}
        self.now = int(time.time())
        self.headers = self.GetHeader(url, method)
        
    def GetHeader(self, _url: str, method: str) -> dict:
        param = "{}{}".format(self.now, "18comicAPP")
        token = hashlib.md5(param.encode("utf-8")).hexdigest()
        
        ua = "Mozilla/5.0 (Linux; Android 7.1.2; DT1901A Build/N2G47O; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.198 Mobile Safari/537.36"

        header = {
            "tokenparam": "{},{}".format(self.now, GlobalConfig.HeaderVer.value),
            "token": token,
            "user-agent": ua,
            "accept-encoding": "gzip",
            "version": GlobalConfig.AppVersion.value,
        }
        if method == "POST":
            header["Content-Type"] = "application/x-www-form-urlencoded"
        return header

    def GetHeader2(self, _url: str, method: str) -> dict:
        param = "{}{}".format(self.now, "18comicAPPContent")
        token = hashlib.md5(param.encode("utf-8")).hexdigest()

        header = {
            "tokenparam": "{},{}".format(self.now, GlobalConfig.HeaderVer.value),
            "token": token,
            "user-agent": "Mozilla/5.0 (Linux; Android 7.1.2; DT1901A Build/N2G47O; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.198 Mobile Safari/537.36",
            "accept-encoding": "gzip",
        }
        if method == "POST":
            header["Content-Type"] = "application/x-www-form-urlencoded"
        return header

    def ParseData(self, data) -> str:
        return JmCryptoTool.decode_resp_data(data, ts=self.now)

    def _candidate_api_bases(self) -> list[str]:
        bases: list[str] = []
        if _LAST_OK_API_BASE and isinstance(_LAST_OK_API_BASE, str) and _LAST_OK_API_BASE:
            bases.append(_LAST_OK_API_BASE)
        try:
            cur = GlobalConfig.GetApiUrl()
            if isinstance(cur, str) and cur and cur not in bases:
                bases.append(cur)
        except Exception:
            pass
        for b in (GlobalConfig.Url2List.value or []):
            if isinstance(b, str) and b and b not in bases:
                bases.append(b)
        for b in (GlobalConfig.CdnApiUrl.value, GlobalConfig.ProxyApiUrl.value):
            if isinstance(b, str) and b and b not in bases:
                bases.append(b)
        return bases

    def _replace_base(self, url: str, new_base: str) -> str:
        u = urlparse(url)
        b = urlparse(new_base)
        return urlunparse((b.scheme or u.scheme, b.netloc, u.path, u.params, u.query, u.fragment))

    def _record_last_ok_api_base(self, url: str, bases: list[str]) -> None:
        try:
            netloc = urlparse(url).netloc
            if not netloc:
                return
            for b in bases:
                if urlparse(b).netloc == netloc:
                    global _LAST_OK_API_BASE
                    _LAST_OK_API_BASE = b
                    return
        except Exception:
            return

    def _resolve_host_doh(self, host: str) -> str | None:
        h = (host or "").strip()
        if not h:
            return None
        if h in _DOH_CACHE:
            return _DOH_CACHE[h]
        session = get_session()
        try:
            resp = session.get(
                "https://dns.google/resolve",
                params={"name": h, "type": "A"},
                headers={"accept": "application/json"},
                timeout=5,
                verify=False,
            )
            if resp.status_code != 200:
                return None
            j = resp.json() if resp.text else {}
            ans = j.get("Answer") or []
            if isinstance(ans, list):
                for it in ans:
                    if isinstance(it, dict) and it.get("type") == 1 and it.get("data"):
                        ip = str(it["data"])
                        if ip:
                            _DOH_CACHE[h] = ip
                            return ip
        except Exception:
            return None
        return None

    def _should_try_doh(self, exc: Exception) -> bool:
        msg = str(exc).lower()
        return any(x in msg for x in ("name resolution", "nodename nor servname", "getaddrinfo failed", "temporary failure in name resolution"))

    def execute(self):
        session = get_session()
        bases = self._candidate_api_bases()
        base_matched = any(isinstance(b, str) and b and self.url.startswith(b) for b in bases)
        urls_to_try = [self.url]
        if base_matched:
            for b in bases:
                u2 = self._replace_base(self.url, b)
                if u2 not in urls_to_try:
                    urls_to_try.append(u2)

        last_exc: Exception | None = None
        for idx, url in enumerate(urls_to_try):
            kwargs = {
                "headers": self.headers,
                "timeout": self.timeout,
                "cookies": self.cookies,
                "verify": False,
            }

            if self.proxy:
                kwargs["proxies"] = self.proxy

            try:
                if self.method == "GET":
                    response = session.get(url, **kwargs)
                else:
                    response = session.post(url, data=self.params, **kwargs)
            except Exception as e:
                last_exc = e
                if self._should_try_doh(e):
                    try:
                        u = urlparse(url)
                        host = u.hostname or ""
                        ip = self._resolve_host_doh(host)
                        if ip:
                            new_headers = dict(kwargs.get("headers") or {})
                            new_headers["Host"] = host
                            kwargs["headers"] = new_headers
                            ip_url = urlunparse((u.scheme, ip, u.path, u.params, u.query, u.fragment))
                            if self.method == "GET":
                                response = session.get(ip_url, **kwargs)
                            else:
                                response = session.post(ip_url, data=self.params, **kwargs)
                        else:
                            continue
                    except Exception as e2:
                        last_exc = e2
                        continue
                else:
                    continue

            if response.status_code != 200:
                last_exc = Exception(f"HTTP {response.status_code}")
                continue

            content_type = (response.headers.get("content-type") or "").lower()
            if "text/html" in content_type:
                if base_matched:
                    self._record_last_ok_api_base(url, bases)
                return response.text

            try:
                resp_json = response.json()
            except Exception:
                return response.text

            if isinstance(resp_json, dict) and "code" in resp_json:
                if resp_json.get("code") != 200:
                    raise Exception(f"API Error: {resp_json.get('errorMsg')}")
                encrypted_data = resp_json.get("data")
                if not encrypted_data:
                    if base_matched:
                        self._record_last_ok_api_base(url, bases)
                    return {}
                decoded_str = self.ParseData(encrypted_data)
                try:
                    if base_matched:
                        self._record_last_ok_api_base(url, bases)
                    return json.loads(decoded_str)
                except Exception:
                    if base_matched:
                        self._record_last_ok_api_base(url, bases)
                    return decoded_str

            if base_matched:
                self._record_last_ok_api_base(url, bases)
            return resp_json

        if last_exc:
            raise last_exc
        raise Exception("Request failed")

class ToolUtil:
    @staticmethod
    def DictToUrl(data):
        if not isinstance(data, dict):
            return ""
        parts = []
        for k, v in data.items():
            parts.append(f"{urllib.parse.quote(str(k))}={urllib.parse.quote(str(v))}")
        return "&".join(parts)

# 获得首页
class GetIndexInfoReq2(ServerReq):
    def __init__(self, page="0"):
        url = GlobalConfig.GetApiUrl() + "/promote"
        method = "GET"
        data = dict()
        data["page"] = page

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param

        super(self.__class__, self).__init__(url, {}, method)

# 获得最近更新
class GetLatestInfoReq2(ServerReq):
    def __init__(self, page="0"):
        url = GlobalConfig.GetApiUrl() + "/latest"
        method = "GET"
        data = dict()
        data["page"] = page

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param

        super(self.__class__, self).__init__(url, {}, method)

# 检查更新
class CheckUpdateReq(ServerReq):
    def __init__(self, url2, isPre=False):
        method = "GET"
        data = dict()
        data["version"] = GlobalConfig.HeaderVer.value
        data["platform"] = platform.platform()
        if not isPre:
            url = url2 + "/version.txt?"
        else:
            url = url2 + "/version_pre.txt?"
        url += ToolUtil.DictToUrl(data)
        super(self.__class__, self).__init__(url, {}, method)

# 检查更新配置
class CheckUpdateConfigReq(ServerReq):
    def __init__(self, url2):
        method = "GET"
        data = dict()
        data["version"] = GlobalConfig.HeaderVer.value
        data["platform"] = platform.platform()
        url = url2 + "/config.txt?"
        url += ToolUtil.DictToUrl(data)
        super(self.__class__, self).__init__(url, {}, method)

# 登陆
class LoginReq2(ServerReq):
    def __init__(self, userId, passwd):
        method = "POST"
        url = GlobalConfig.GetApiUrl() + "/login"
        data = dict()
        data["username"] = userId
        data["password"] = passwd
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 注册
class RegisterReq(ServerReq):
    def __init__(self, userId, email, passwd, passwd2, sex="Male",  ver=""):
        # [Male, Female]

        method = "POST2" # Note: example2 has POST2, we map to POST but keep method name for clarity if needed, or just use POST
        # But requests logic in execute() checks self.method. Let's stick to POST.
        method = "POST" 
        url = GlobalConfig.Url.value + "/signup"
        data = dict()
        data["username"] = userId
        data["password"] = passwd
        data["email"] = email
        data["verification"] = ver
        data["password_confirm"] = passwd2
        data["gender"] = sex
        data["age"] = "on"
        data["terms"] = "on"
        data["submit_signup"] = ""
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)
        # self.headers = self.GetWebHeader() # We might need web headers for this

# 本子信息
class GetBookInfoReq2(ServerReq):
    def __init__(self, bookId):
        self.bookId = bookId
        url = GlobalConfig.GetApiUrl() + "/album"
        method = "GET"
        data = dict()
        data["comicName"] = ""
        data["id"] = bookId

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        super(self.__class__, self).__init__(url, {}, method)

# 获得scramble_id
class GetBookEpsScrambleReq2(ServerReq):
    def __init__(self, bookId, epsIndex, epsId):
        self.bookId = bookId
        self.epsIndex = epsIndex
        url = GlobalConfig.GetApiUrl() + "/chapter_view_template"
        method = "GET"
        data = dict()
        data["id"] = epsId
        data["mode"] = "vertical"
        data["page"] = "0"
        data["app_img_shunt"] = "NaN"

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        super(self.__class__, self).__init__(url, {}, method)
        self.headers = self.GetHeader2(url, method)

# 章节信息
class GetBookEpsInfoReq2(ServerReq):
    def __init__(self, bookId, epsId):
        self.bookId = bookId
        url = GlobalConfig.GetApiUrl() + "/chapter"
        method = "GET"
        data = dict()
        data["comicName"] = ""
        data["skip"] = ""
        data["id"] = epsId

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        super(self.__class__, self).__init__(url, {}, method)

# 搜索请求
class GetSearchReq2(ServerReq):
    def __init__(self, search, sort="mr", page=1):
        # 最新，最多点击，最多图片, 最多爱心
        # o = [mr, mv, mp, tf]

        data = dict()
        data["search_query"] = search
        if page > 1:
            data['page'] = str(page)
        if sort:
            data["o"] = sort
        url = GlobalConfig.GetApiUrl() + "/search"

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        method = "GET"
        super(self.__class__, self).__init__(url, {}, method)

# 分類请求
class GetCategoryReq2(ServerReq):
    def __init__(self):
        url = GlobalConfig.GetApiUrl() + "/categories"
        data = dict()
        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        method = "GET"
        super(self.__class__, self).__init__(url, {}, method)

# 分類搜索请求
class GetSearchCategoryReq2(ServerReq):
    def __init__(self, category="0", page=1, sort="mr", tag: str | None = None):
        # sort []&t=t&o=tf
        # 最新，总排行，月排行，周排行， 日排行，最多图片, 最多爱心
        # o = [mr, mv, mv_m, mv_w, mv_t, mp, tf]
        # 最新, 同人, 单本, 短篇， 其他，韩漫， 美漫， CosPlay， 3D
        # category = ["0", "doujin", "single", "short", "another", "hanman", "meiman", "doujin_cosplay", "3D"]

        url = GlobalConfig.GetApiUrl() + "/categories/filter"

        data = dict()

        if page > 1:
            data['page'] = str(page)
        if sort:
            data["o"] = sort

        if category:
            data["c"] = category
        if tag:
            data["t"] = str(tag)

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        method = "GET"
        super(self.__class__, self).__init__(url, {}, method)

# 获得收藏
class GetFavoritesReq2(ServerReq):
    def __init__(self, page=1, sort="mr", fid=""):
        # 收藏时间, 更新时间
        # o = [mr, mp]
        url = GlobalConfig.GetApiUrl() + "/favorite"
        method = "GET"
        data = dict()
        data["page"] = page
        if fid:
            data["folder_id"] = fid
        else:
            data["folder_id"] = "0"
        data["o"] = sort

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param

        super(self.__class__, self).__init__(url, {}, method)

# 添加收藏文件夹
class AddFavoritesFoldReq2(ServerReq):
    def __init__(self, name=""):
        url = GlobalConfig.GetApiUrl() + "/favorite_folder"
        method = "POST"
        data = dict()
        data["folder_name"] = name
        data["type"] = "add"
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 删除收藏文件夹
class DelFavoritesFoldReq2(ServerReq):
    def __init__(self, fid=""):
        url = GlobalConfig.GetApiUrl() + "/favorite_folder"
        method = "POST"
        data = dict()
        data["folder_id"] = fid
        data["type"] = "del"
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 重命名收藏文件夹
class RenameFavoritesFoldReq2(ServerReq):
    def __init__(self, fid="", name="", rename_type="rename"):
        url = GlobalConfig.GetApiUrl() + "/favorite_folder"
        method = "POST"
        data = dict()
        data["folder_id"] = fid
        data["folder_name"] = name
        data["type"] = rename_type
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 移动收藏文件夹
class MoveFavoritesFoldReq2(ServerReq):
    def __init__(self, bookId="", fid=""):
        url = GlobalConfig.GetApiUrl() + "/favorite_folder"
        method = "POST"
        data = dict()
        data["folder_id"] = fid
        data["type"] = "move"
        data["aid"] = bookId
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 添加收藏
class AddAndDelFavoritesReq2(ServerReq):
    def __init__(self, bookId=""):
        url = GlobalConfig.GetApiUrl() + "/favorite"
        method = "POST"
        data = dict()
        data["aid"] = bookId
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 获得评论
class GetCommentReq2(ServerReq):
    def __init__(self, bookId="", page="1", readMode="manhua"):
        self.bookId = bookId
        url = GlobalConfig.GetApiUrl() + "/forum"
        method = "GET"
        data = dict()
        data["mode"] = readMode
        if bookId:
            data["aid"] = bookId
        data["page"] = page

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        super(self.__class__, self).__init__(url, {}, method)

# 获得评论
class GetMyCommentReq2(ServerReq):
    def __init__(self, uid, page="1"):
        self.uid = uid
        url = GlobalConfig.GetApiUrl() + "/forum"
        method = "GET"
        data = dict()
        data["mode"] = "undefined"
        data["uid"] = uid
        data["page"] = page

        param = ToolUtil.DictToUrl(data)
        if param:
            url += "/?" + param
        super(self.__class__, self).__init__(url, {}, method)

# 发送评论
class SendCommentReq2(ServerReq):
    def __init__(self, bookId="", comment="", cid=""):
        url = GlobalConfig.GetApiUrl() + "/comment"
        method = "POST"
        data = dict()
        data["comment"] = comment
        data["aid"] = bookId
        if cid:
            data["comment_id"] = cid
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 评论点赞
class LikeCommentReq2(ServerReq):
    def __init__(self, cid=""):
        url = GlobalConfig.GetApiUrl() + "/comment/like"
        method = "POST"
        data = {"cid": cid}
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 获取观看记录
class GetHistoryReq2(ServerReq):
    def __init__(self, page=1):
        url = GlobalConfig.GetApiUrl() + "/watch_list"
        method = "GET"
        data = dict()
        data["page"] = page
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# Jcoin购买
class GetBuyComicsReq2(ServerReq):
    def __init__(self, bookId=""):
        url = GlobalConfig.GetApiUrl() + "/coin_buy_comics"
        method = "POST"
        data = dict()
        data["id"] = bookId
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 获取周推荐分类
class GetWeekCategoriesReq2(ServerReq):
    def __init__(self, page=0):
        url = GlobalConfig.GetApiUrl() + "/week"
        method = "GET"
        data = dict()
        data["page"] = page
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)

# 获取周推荐
class GetWeekFilterReq2(ServerReq):
    def __init__(self, id, type, page=0):
        url = GlobalConfig.GetApiUrl() + "/week/filter?"
        method = "GET"
        data = dict()
        data["page"] = page
        data["id"] = id
        data["type"] = type
        url = url + ToolUtil.DictToUrl(data)
        super(self.__class__, self).__init__(url, {}, method)

# 获取深夜食堂
class GetBlogsReq2(ServerReq):
    def __init__(self, blog_type="dinner", search_query="", page=1):
        url = GlobalConfig.GetApiUrl() + "/blogs?"
        method = "GET"
        data = dict()
        data["blog_type"] = blog_type
        data["page"] = page
        data["search_query"] = search_query
        url = url + ToolUtil.DictToUrl(data)
        super(self.__class__, self).__init__(url, {}, method)

# 获取深夜食堂
class GetBlogInfoReq2(ServerReq):
    def __init__(self, id):
        url = GlobalConfig.GetApiUrl() + "/blog?"
        method = "GET"
        data = dict()
        data["id"] = id
        url = url + ToolUtil.DictToUrl(data)
        super(self.__class__, self).__init__(url, {}, method)

# 获取深夜食堂
class GetBlogForumReq2(ServerReq):
    def __init__(self, bid, page=1, mode="blog"):
        url = GlobalConfig.GetApiUrl() + "/forum?"
        method = "GET"
        data = dict()
        data["bid"] = bid
        data["page"] = page
        data["mode"] = mode
        url = url + ToolUtil.DictToUrl(data)
        super(self.__class__, self).__init__(url, {}, method)

# 获取签到信息
class GetDailyReq2(ServerReq):
    def __init__(self, user_id):
        url = GlobalConfig.GetApiUrl() + "/daily?user_id=" + user_id
        method = "GET"
        super(self.__class__, self).__init__(url, {}, method)

# 签到
class SignDailyReq2(ServerReq):
    def __init__(self, user_id, daily_id):
        url = GlobalConfig.GetApiUrl() + "/daily_chk"
        method = "POST"
        data = dict()
        data["user_id"] = user_id
        data["daily_id"] = daily_id
        super(self.__class__, self).__init__(url, ToolUtil.DictToUrl(data), method)
