import time
import hashlib
import json
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from jmcomic import JmCryptoTool, JmModuleConfig

class ApiClient:
    # Combined Domains from example2 GlobalConfig
    DOMAINS = [
        # App Domains (Url2List) - Updated from example2
        "https://www.cdnhth.club",
        "https://www.cdngwc.cc",
        "https://www.cdnhth.net",
        "https://www.cdnbea.net",
        
        # ApiAutoUrl
        "https://www.cdn-mspjmapiproxy.xyz",
        
        # CdnApiUrl
        "https://www.cdnhth.club",
        
        # Web Domains (UrlList) - Updated from example2
        "https://18comic-hok.vip",
        "https://18comic.vip",
        "https://jmcomic.me",
        "https://18comic-16promax.club",
        "https://18comic.tw",
        "https://18comic-doa.xyz",
        "https://18-comicblade.art",
    ]
    
    # Config from example2 (Updated)
    APP_VERSION = "v1.3.1"
    HEADER_VER = "2.0.14"
    APP_SECRET = "18comicAPP"
    
    def __init__(self):
        # Use requests.Session instead of httpx to avoid extra dependency
        self.client = requests.Session()
        self.client.verify = False
        self.client.trust_env = False
        # requests follows redirects by default for GET methods

    def _get_headers(self, timestamp):
        """
        Mimic ServerReq.GetHeader from example2/src/server/req.py
        """
        token_param = f"{timestamp},{self.HEADER_VER}"
        token = hashlib.md5(f"{timestamp}{self.APP_SECRET}".encode("utf-8")).hexdigest()
        
        return {
            "tokenparam": token_param,
            "token": token,
            "user-agent": "Mozilla/5.0 (Linux; Android 7.1.2; DT1901A Build/N2G47O; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.198 Mobile Safari/537.36",
            "accept-encoding": "gzip",
            "version": self.APP_VERSION
        }

    def get_promote(self, page="0"):
        """
        Mimic GetIndexInfoReq2 from example2/src/server/req.py
        """
        timestamp = int(time.time())
        headers = self._get_headers(timestamp)
        params = {"page": page}
        
        last_error = None
        
        # Combine hardcoded domains with JmModuleConfig domains for robustness
        domain_candidates = []
        # Add updated hardcoded domains first (priority)
        for d in self.DOMAINS:
            if d not in domain_candidates:
                domain_candidates.append(d)
                
        # Add library domains if not present (removing duplicates)
        for d in JmModuleConfig.DOMAIN_API_LIST:
            # Library domains usually don't have protocol
            full_url = f"https://{d}"
            if full_url not in domain_candidates:
                domain_candidates.append(full_url)
        
        for base_url in domain_candidates:
            url = f"{base_url}/promote"
            try:
                # httpx uses params same as requests
                resp = self.client.get(url, params=params, headers=headers, timeout=10)
                
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code}"
                    # print(f"Failed {base_url}: {resp.status_code}")
                    continue
                
                resp_json = resp.json()
                if resp_json.get('code') == 200:
                    data = resp_json.get('data')
                    if data:
                        # Decrypt using JmCryptoTool
                        decoded = JmCryptoTool.decode_resp_data(data, ts=timestamp)
                        return json.loads(decoded)
                    return []
                else:
                    last_error = f"API Error: {resp_json.get('errorMsg')}"
                    continue
                    
            except Exception as e:
                # print(f"Error connecting to {base_url}: {e}")
                last_error = str(e)
                continue
        
        raise Exception(f"All domains failed. Last error: {last_error}")

# Singleton instance
api_client = ApiClient()
