class GlobalItem(object):
    def __init__(self, default):
        self.value = default
        self.def_value = default

    def is_same(self):
        return self.value == self.def_value

    def set_value(self, value):
        if isinstance(self.def_value, int):
            self.value = int(value)
        elif isinstance(self.def_value, list) and isinstance(value, str):
            self.value = value.split(",")
        else:
            self.value = value

class GlobalConfig:
    Ver = GlobalItem(65)
    VerTime = GlobalItem("2026-1-7")

    # web url
    WebDnsList = GlobalItem([])
    Url = GlobalItem("https://18-comicblade.art")
    UrlList = GlobalItem(["https://18comic-hok.vip",
                          "https://18comic.vip",
                          "https://jmcomic.me",
                          "https://18comic-16promax.club",
                          "https://18comic.tw",
                          "https://18comic-doa.xyz"])

    # mobile url
    Url2List = GlobalItem(["https://www.cdnhth.club",
                           "https://www.cdngwc.cc",
                           "https://www.cdnhth.net",
                           "https://www.cdnbea.net"])

    ProxyApiDomain2 = GlobalItem("jm2-api.jpacg.cc")
    ProxyImgDomain2 = GlobalItem("jm2-img.jpacg.cc")

    PicUrlList = GlobalItem(
        [
            "https://cdn-msp.jmapiproxy1.cc",
            "https://cdn-msp.jmapiproxy3.cc",
            "https://cdn-msp.jmapinodeudzn.net",
            "https://cdn-msp.jmdanjonproxy.xyz",
        ])

    ImgAutoUrl = GlobalItem([
        "cdn-msp2.jmapiproxy1.cc",
        "cdn-msp2.jmapiproxy3.cc",
        "cdn-msp2.jmapinodeudzn.net",
        "cdn-msp3.jmapinodeudzn.net",
        "cdn-msp3.jmapiproxy1.cc",
        "cdn-msp3.jmapiproxy3.cc",
    ])

    ApiAutoUrl = GlobalItem([
        "www.cdn-mspjmapiproxy.xyz",
    ])

    CdnApiUrl = GlobalItem("https://www.cdnhth.club")
    CdnImgUrl = GlobalItem("https://cdn-msp.jmapiproxy3.cc")
    ProxyApiUrl = GlobalItem("https://www.cdnhth.club")
    ProxyImgUrl = GlobalItem("https://cdn-msp.jmapiproxy3.cc")
    HeaderVer = GlobalItem("2.0.14")
    AppVersion = GlobalItem("v1.3.1")
    
    # Defaults for settings usually found in Setting class
    ProxySelectIndex = 0
    ProxyImgSelectIndex = 0
    HostApiDomain = ""
    HostImgDomain = ""

    @staticmethod
    def GetApiUrl():
        return GlobalConfig.GetApiUrl2(GlobalConfig.ProxySelectIndex)

    @staticmethod
    def GetApiUrl2(index):
        try:
            index = int(index)
        except Exception:
            index = 0
        if index == 5:
            return GlobalConfig.CdnApiUrl.value
        elif index == 6:
            return GlobalConfig.ProxyApiUrl.value
        elif index == 7:
            # Simplified: Assuming HostApiDomain is just a string
            return "https://" + GlobalConfig.HostApiDomain

        urls = GlobalConfig.Url2List.value or []
        if not isinstance(urls, list) or not urls:
            return ""
        if index <= 0:
            return urls[0]
        if 1 <= index <= len(urls):
            return urls[index - 1]
        if 0 <= index < len(urls):
            return urls[index]
        return urls[0]

    @staticmethod
    def GetImgUrl():
        return GlobalConfig.GetImgUrl2(GlobalConfig.ProxyImgSelectIndex)

    @staticmethod
    def GetImgUrl2(index):
        try:
            index = int(index)
        except Exception:
            index = 0
        if index == 5:
            return GlobalConfig.CdnImgUrl.value
        elif index == 6:
            return GlobalConfig.ProxyImgUrl.value
        elif index == 7:
             return "https://" + GlobalConfig.HostImgDomain
             
        urls = GlobalConfig.PicUrlList.value or []
        if not isinstance(urls, list) or not urls:
            return ""
        if index <= 0:
            return urls[0]
        if 1 <= index <= len(urls):
            return urls[index - 1]
        if 0 <= index < len(urls):
            return urls[index]
        return urls[0]
