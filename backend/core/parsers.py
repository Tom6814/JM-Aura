import re
from typing import Any
from urllib.parse import urlparse


def parse_chapter_view_template(html: str) -> dict[str, Any]:
    if not html:
        return {"scramble_id": "220980", "data_original_domain": None}

    scramble_id = "220980"
    data_original_domain = None

    m = re.search(r"scramble[_\s-]?id\s*[:=]\s*(\d+)", html, flags=re.IGNORECASE)
    if m:
        scramble_id = m.group(1)

    m = re.search(r"data-original-domain\s*=\s*\"([^\"]+)\"", html, flags=re.IGNORECASE)
    if m:
        data_original_domain = m.group(1)

    if not data_original_domain:
        m = re.search(r"data_original_domain\s*[:=]\s*\"([^\"]+)\"", html, flags=re.IGNORECASE)
        if m:
            data_original_domain = m.group(1)

    if not data_original_domain:
        m = re.search(r"data-original\s*=\s*\"(https?://[^\"]+)\"", html, flags=re.IGNORECASE)
        if m:
            try:
                data_original_domain = urlparse(m.group(1)).netloc
            except Exception:
                data_original_domain = None

    return {
        "scramble_id": scramble_id,
        "data_original_domain": data_original_domain,
    }
