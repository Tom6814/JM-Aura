import os
import jmcomic
import shutil
import tempfile
import time
import zipfile
from jmcomic import create_option, JmHtmlClient, JmOption, JmModuleConfig
from backend.core.paths import default_config_path, default_download_dir

class JmService:
    def __init__(self, config_path: str = None):
        cfg = config_path or os.environ.get("JM_AURA_CONFIG_PATH") or default_config_path()
        self.config_path = cfg
        self.download_dir = os.environ.get("JM_AURA_DOWNLOAD_DIR") or default_download_dir(self.config_path)
        self.option = self._load_or_create_option()
        self.client = None

    def _load_or_create_option(self):
        # Create option with default config if not exists
        if not os.path.exists(self.config_path):
            # Create default config file
            default_config = """
client:
  domain: []
  postman:
    type: requests
    headers:
      User-Agent: Mozilla/5.0
download:
  image:
    decode: true
            """
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, 'w', encoding='utf-8') as f:
                f.write(default_config.strip())
            
        try:
            # Load existing option
            op = create_option(self.config_path)
            
            # Update download directory to our project's download folder
            op.dir_rule.base_dir = self.download_dir
            return op
        except Exception as e:
            print(f"Error loading config: {e}")
            return None

    def login_and_save(self, username, password):
        """
        Attempt to login with provided credentials.
        If successful, save to config.
        """
        try:
            # Create a temporary option/client to verify credentials
            # We can't use self.option because it might have old credentials
            # We need to construct a new client.
            
            # Since create_option loads from file, we might need to modify the config in memory
            # But jmcomic doesn't make it easy to create option from dict without file.
            # However, we can create a client and then call login.
            
            # Use current option but override headers/cookies later?
            # Better: Create a client from current option, then try to login.
            
            client = self.option.build_jm_client()
            
            # jmcomic's login method: login(self, username, password, refresh_token=None)
            # It updates the client's cookies/headers if successful.
            # If it fails, it usually raises an exception or prints error.
            # Let's inspect source code of login if possible, but assuming it raises on failure is safe.
            
            client.login(username, password)
            
            # If we are here, login was successful (no exception raised).
            # Now save the credentials to config.
            return self.update_config(username, password)
            
        except Exception as e:
            print(f"Login verification failed: {e}")
            return False

    def update_config(self, username, password):
        # We need to read the existing yaml, update it, and write it back.
        # Or just use create_option to overwrite?
        # jmcomic create_option might not write back if we just pass params.
        # Let's try to update the yaml file directly or use a helper.
        
        try:
            # Simple YAML update (string based or use a library if available, but we have pyyaml)
            import yaml
            
            # Load current or default
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config = yaml.safe_load(f) or {}
            else:
                config = {}
            
            if 'client' not in config:
                config['client'] = {}

            client_cfg = config.get('client', {}) if isinstance(config.get('client', {}), dict) else {}
            if 'username' in client_cfg:
                client_cfg.pop('username', None)
            if 'password' in client_cfg:
                client_cfg.pop('password', None)
            config['client'] = client_cfg
            
            with open(self.config_path, 'w', encoding='utf-8') as f:
                yaml.dump(config, f, allow_unicode=True)
            
            # Reload option
            self.option = self._load_or_create_option()
            # Invalidate client to force rebuild with new credentials
            self.client = None
            return True
        except Exception as e:
            print(f"Error updating config: {e}")
            return False

    def get_config(self):
        try:
            import yaml
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config = yaml.safe_load(f) or {}
                    client_config = config.get('client', {})
                    return {
                        "username": str(client_config.get('username', '') or ''),
                        "is_logged_in": False
                    }
            return {"username": "", "is_logged_in": False}
        except Exception as e:
            print(f"Error reading config: {e}")
            return {"username": "", "is_logged_in": False}

    def get_credentials(self) -> tuple[str, str]:
        return "", ""

    def get_client(self) -> JmHtmlClient:
        if self.client:
            return self.client
        if not self.option:
            self.option = self._load_or_create_option()
        self.client = self.option.build_jm_client()
        return self.client

    def search(self, query: str, page: int = 1):
        try:
            client = self.get_client()
            # client.search_site returns a JmSearchPage object
            # accessing .content gives us detailed info tuples: (album_id, info_dict)
            results = client.search_site(query, page=page)
            
            data = []
            # Check if content attribute exists, otherwise fallback to iteration
            if hasattr(results, 'content'):
                for album_id, info in results.content:
                    # Debug info structure
                    # print(f"DEBUG: Album {album_id} info keys: {info.keys()}")
                    # print(f"DEBUG: Album {album_id} raw info: {info}")
                    
                    # Try to extract image URL. 
                    image_url = info.get('image', '')
                    
                    # If image is empty, check for 'cover' or try to fetch details if needed (slow)
                    if not image_url:
                        # Try finding any key that looks like an image
                        for k, v in info.items():
                            if isinstance(v, str) and (v.endswith('.jpg') or v.endswith('.png') or v.endswith('.webp')):
                                image_url = v
                                # print(f"DEBUG: Found image in key '{k}': {image_url}")
                                break
                    
                    # print(f"DEBUG: Final image_url for {album_id}: {image_url}")
                    
                    # If still empty, use a placeholder or check if 'category' dict has image (unlikely)
                    if not image_url and len(JmModuleConfig.DOMAIN_IMAGE_LIST) > 0:
                        # Construct default cover URL
                        # Try the first domain. If it fails, the proxy might handle it or fail.
                        # Usually format is /media/albums/{ID}.jpg
                        # Some IDs might need specific handling but this covers most.
                        domain = JmModuleConfig.DOMAIN_IMAGE_LIST[0]
                        image_url = f"https://{domain}/media/albums/{album_id}.jpg"
                        # print(f"DEBUG: Constructed image URL for {album_id}: {image_url}")
                    
                    data.append({
                        "album_id": album_id,
                        "title": info.get('name'),
                        "author": info.get('author'),
                        "category": info.get('category', {}).get('title') if isinstance(info.get('category'), dict) else str(info.get('category')),
                        "image": image_url
                    })
            else:
                # Fallback for iteration (returns id, title)
                for item in results:
                    if isinstance(item, tuple) and len(item) >= 2:
                        data.append({
                            "album_id": item[0],
                            "title": item[1],
                            "author": "",
                            "category": "",
                            "image": ""
                        })
            return data
        except Exception as e:
            print(f"Search error: {e}")
            # If error is due to missing auth, we might want to signal that.
            return []

    def get_album_detail(self, album_id: str):
        client = self.get_client()
        album = client.get_album_detail(album_id)
        
        # Album detail usually has cover image
        # Check album attributes for cover image
        cover_image = getattr(album, 'cover_image', getattr(album, 'image', ''))
        
        if not cover_image and len(JmModuleConfig.DOMAIN_IMAGE_LIST) > 0:
             domain = JmModuleConfig.DOMAIN_IMAGE_LIST[0]
             cover_image = f"https://{domain}/media/albums/{album_id}.jpg"
        
        episode_list = []
        if hasattr(album, 'episode_list'):
            for i, ep in enumerate(album.episode_list):
                ep_id = None
                ep_title = None
                
                # Handle Tuple case (observed in some environments)
                if isinstance(ep, tuple):
                    # Observed pattern in jmcomic 2.5+:
                    # (photo_id, scramble_id/index, title)
                    if len(ep) >= 3:
                        ep_id = ep[0]
                        ep_title = ep[2]
                    # Fallback pattern (older or different context):
                    # (photo_id, title)
                    elif len(ep) >= 2:
                        ep_id = ep[0]
                        ep_title = ep[1]
                    else:
                        ep_id = str(i)
                        ep_title = str(ep)
                
                # Handle Object case (standard jmcomic JmImageDetail)
                else:
                    ep_id = getattr(ep, 'episode_id', getattr(ep, 'photo_id', getattr(ep, 'id', None)))
                    ep_title = getattr(ep, 'title', getattr(ep, 'name', None))
                
                # Final Fallback
                if not ep_id:
                    ep_id = str(i)
                if not ep_title:
                    ep_title = f"第 {i+1} 话"
                
                # Fix for single chapter albums where photo_id might be '1' or '0'
                # In these cases, photo_id is often the same as album_id
                # Only apply this logic if it's likely a single chapter work or the ID is clearly invalid for a multi-chapter work
                # But to be safe, we restrict this fallback to when we only have one episode found so far (or total)
                # However, we don't know total yet. 
                # But usually '0' or '1' only happens in single chapter contexts or parsing failures.
                
                # If we are in a loop, checking len(album.episode_list) is better.
                is_single_chapter = len(album.episode_list) == 1
                
                if is_single_chapter and str(ep_id) in ['0', '1']:
                    ep_id = album_id

                episode_list.append({
                    "id": str(ep_id),
                    "title": str(ep_title).strip()
                })

        return {
            "album_id": album.album_id,
            "title": album.title,
            "author": str(album.author),
            "description": album.description,
            "episode_list": episode_list,
            "image_count": len(episode_list),
            "image": cover_image
        }

    def get_chapter_detail(self, photo_id: str):
        client = self.get_client()
        # Ensure we try to fetch with correct ID (though we fixed it in get_album_detail)
        # But if user calls directly, we might need check.
        # Assuming photo_id passed here is correct.
        
        photo = client.get_photo_detail(photo_id)
        
        # Get image list
        images = []
        if hasattr(photo, 'page_arr'):
            images = photo.page_arr
        elif hasattr(photo, 'image_list'):
            images = [img.img_url for img in photo.image_list] # Might need processing
            
        return {
            "photo_id": photo.photo_id,
            "album_id": getattr(photo, 'album_id', ''),
            "scramble_id": getattr(photo, 'scramble_id', '0'),
            "data_original_domain": getattr(photo, 'data_original_domain', None),
            "images": images,
            "title": photo.title,
            "index": photo.index
        }


    def download_album(self, album_id: str, chapter_ids: list[str] = None):
        # This is blocking. In a real app we should run this in a background task.
        # For now, we'll run it and return.
        # But for better UX, we should use BackgroundTasks in FastAPI.
        try:
            op = self.option
            os.makedirs(self.download_dir, exist_ok=True)
            before_items = set()
            try:
                before_items = set(os.listdir(self.download_dir))
            except Exception:
                before_items = set()
            if chapter_ids:
                # Create a specific option for this download to avoid affecting global state
                # We can clone the option or reload it
                op = create_option(self.config_path)
                op.dir_rule.base_dir = self.download_dir
                
                # Filter chapters
                # jmcomic passes JmPhotoDetail object to filter_chapter (or similar)
                # We simply check if the photo_id is in our list
                allowed_ids = set(str(cid) for cid in chapter_ids)
                
                # Override the filter_chapter method of the option
                # Note: This depends on jmcomic version. 
                # Assuming jmcomic 2.5+ uses a filter mechanism.
                # We can set a custom filter function.
                
                # In jmcomic, option.filter_chapter is a function that takes a JmPhotoDetail and returns bool.
                # True to keep, False to skip.
                op.filter_chapter = lambda photo_detail: str(photo_detail.photo_id) in allowed_ids
                
            jmcomic.download_album(album_id, op)
            after_items = set()
            try:
                after_items = set(os.listdir(self.download_dir))
            except Exception:
                after_items = set()

            zip_paths = self._zip_and_cleanup_new_outputs(album_id=str(album_id), before_items=before_items, after_items=after_items)
            if zip_paths:
                return True, f"Download completed. Zipped: {len(zip_paths)}"
            return True, "Download completed"
        except Exception as e:
            return False, str(e)

    def _zip_and_cleanup_new_outputs(self, album_id: str, before_items: set[str], after_items: set[str]) -> list[str]:
        zip_dir = os.path.join(self.download_dir, "zips")
        os.makedirs(zip_dir, exist_ok=True)

        new_items = sorted([x for x in (after_items - before_items) if x and x != "zips"])
        candidates: list[str] = []
        for name in new_items:
            candidates.append(os.path.join(self.download_dir, name))

        if not candidates:
            try:
                items = [os.path.join(self.download_dir, x) for x in os.listdir(self.download_dir) if x and x != "zips"]
                items.sort(key=lambda p: os.path.getmtime(p), reverse=True)
                candidates = items[:3]
            except Exception:
                candidates = []

        zip_paths: list[str] = []
        ts = int(time.time())
        for p in candidates:
            if not os.path.exists(p):
                continue
            if os.path.isfile(p):
                if str(p).lower().endswith(".zip"):
                    continue
                try:
                    os.remove(p)
                except Exception:
                    pass
                continue

            base_name = os.path.basename(p.rstrip("\\/")) or album_id
            safe = "".join(ch if ch not in '<>:"/\\\\|?*' else "_" for ch in base_name).strip() or album_id
            zip_name = f"{safe}_{ts}.zip"
            zip_path = os.path.join(zip_dir, zip_name)

            try:
                with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                    for root, _dirs, files in os.walk(p):
                        for fn in files:
                            fp = os.path.join(root, fn)
                            arcname = os.path.relpath(fp, self.download_dir)
                            zf.write(fp, arcname)
                zip_paths.append(zip_path)
            except Exception:
                try:
                    if os.path.exists(zip_path):
                        os.remove(zip_path)
                except Exception:
                    pass
                continue

            shutil.rmtree(p, ignore_errors=True)

        return zip_paths

    def get_favorites(self, page: int = 1, folder_id: str = '0'):
        try:
            client = self.get_client()
            # folder_id='0' is usually the default "Favorites" folder
            fav_page = client.favorite_folder(page=page, folder_id=folder_id)
            
            data = []
            # Check if content attribute exists
            if hasattr(fav_page, 'content'):
                for item in fav_page.content:
                    # Initialize vars
                    aid = None
                    title = ""
                    author = ""
                    image = ""
                    
                    # Handle Tuple case (common in fav_page.content)
                    if isinstance(item, tuple) and len(item) >= 2:
                        aid = item[0]
                        info = item[1]
                        
                        # Check if info is a dictionary (which contains name, author, etc.)
                        if isinstance(info, dict):
                            title = info.get('name', info.get('title', ''))
                            author = info.get('author', '')
                            image = info.get('image', info.get('cover_image', ''))
                        else:
                            # Fallback if info is just a string or other type
                            title = str(info)
                    
                    # Handle Object case (if it's a JmAlbumDetail object)
                    else:
                        aid = getattr(item, 'album_id', getattr(item, 'id', None))
                        title = getattr(item, 'title', getattr(item, 'name', ''))
                        author = getattr(item, 'author', '')
                        image = getattr(item, 'cover_image', getattr(item, 'image', ''))

                    if not aid:
                        continue
                        
                    # Try to get image if missing
                    if not image and len(JmModuleConfig.DOMAIN_IMAGE_LIST) > 0:
                        domain = JmModuleConfig.DOMAIN_IMAGE_LIST[0]
                        image = f"https://{domain}/media/albums/{aid}.jpg"

                    data.append({
                        "album_id": aid,
                        "title": title,
                        "author": author,
                        "image": image
                    })
            
            # Extract folders
            folders = []
            if hasattr(fav_page, 'folder_list'):
                for f in fav_page.folder_list:
                    # jmcomic usually returns dict with 'FID' and 'name'
                    if isinstance(f, dict):
                        folders.append({
                            "id": f.get('FID', f.get('id', '')),
                            "name": f.get('name', '')
                        })
            
            return {
                "content": data,
                "total": getattr(fav_page, 'total', 0),
                "pages": getattr(fav_page, 'page_count', 1),
                "folders": folders
            }
        except Exception as e:
            print(f"Favorites error: {e}")
            return {"content": [], "total": 0, "pages": 0, "folders": [], "error": str(e)}

    def download_album_zip(self, album_id: str):
        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        try:
            # Create a specific option for this download
            op = create_option(self.config_path)
            op.dir_rule.base_dir = temp_dir
            
            # Download
            jmcomic.download_album(album_id, op)
            
            # Find the downloaded folder
            items = os.listdir(temp_dir)
            if not items:
                raise Exception("Download failed: No files found")
            
            # Usually jmcomic creates a folder for the album
            # If multiple folders (unlikely for one album), pick the first one
            album_folder = os.path.join(temp_dir, items[0])
            
            # Zip it
            # We create the zip in the system temp directory
            zip_filename = f"{album_id}_{int(os.times().system)}.zip"
            zip_path = os.path.join(tempfile.gettempdir(), zip_filename)
            
            # shutil.make_archive adds .zip extension automatically, so we remove it from base_name
            base_name = zip_path.replace('.zip', '')
            shutil.make_archive(base_name, 'zip', album_folder)
            
            # Ensure the file exists (make_archive might append .zip)
            if not os.path.exists(zip_path) and os.path.exists(zip_path + ".zip"):
                zip_path = zip_path + ".zip"
            
            return True, zip_path
        except Exception as e:
            return False, str(e)
        finally:
            # Cleanup download temp_dir (but keep the zip file for serving)
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except:
                pass

jm_service = JmService()
