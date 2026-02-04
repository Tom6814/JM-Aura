const { createApp } = Vue

const DescrambledImage = {
    props: ['src', 'comicId', 'scrambleId', 'page', 'index'],
    template: `
        <div class="w-full flex justify-center min-h-[300px]" ref="container">
            <div v-if="loading && isVisible" class="w-full h-96 flex items-center justify-center bg-white/5 text-white/20">
                <span class="material-symbols-rounded animate-spin text-3xl">hourglass_empty</span>
            </div>
            <canvas ref="canvas" class="w-full h-auto object-contain block" style="display: none;"></canvas>
            <img v-if="!needDescramble && !loading && isVisible" :src="src" class="w-full h-auto object-contain block" alt="Page">
        </div>
    `,
    data() {
        return {
            loading: true,
            needDescramble: false,
            isVisible: false,
            observer: null,
            loadToken: 0
        }
    },
    mounted() {
        this.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                this.isVisible = true;
                this.loadImage();
                this.observer.disconnect(); 
            }
        }, { rootMargin: '300px' });
        this.observer.observe(this.$refs.container);
    },
    beforeUnmount() {
        if (this.observer) this.observer.disconnect();
    },
    watch: {
        src() {
            if (this.isVisible) this.loadImage();
        }
    },
    methods: {
        calculateMD5(inputStr) {
            return CryptoJS.MD5(inputStr).toString();
        },
        getSegmentationNum(epsId, scrambleId, pictureName) {
            const eid = parseInt(epsId);
            let sid = parseInt(scrambleId);
            if (!sid || sid <= 0) sid = 220980;
            if (isNaN(eid)) return 0;
            if (eid < sid) return 0;
            if (eid < 268850) return 10;
            const hashData = this.calculateMD5(String(eid) + String(pictureName));
            const keyCode = hashData.charCodeAt(hashData.length - 1);
            if (eid > 421926) {
                return (keyCode % 8) * 2 + 2;
            }
            return (keyCode % 10) * 2 + 2;
        },
        async loadImage() {
            const myToken = ++this.loadToken;
            this.loading = true;
            this.needDescramble = false;

            const pageName = this.page.split('.')[0];
            const epsId = parseInt(this.comicId);
            const scrambleId = parseInt(this.scrambleId);
            const sliceCount = this.getSegmentationNum(epsId, scrambleId, pageName);
            if (sliceCount <= 1 || /\.gif$/i.test(this.page)) {
                this.loading = false;
                return;
            }

            this.needDescramble = true;

            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = this.src;
            
            img.onload = () => {
                if (myToken !== this.loadToken) return;
                this.cutImage(img, sliceCount);
                this.loading = false;
            };
            
            img.onerror = () => {
                if (myToken !== this.loadToken) return;
                this.needDescramble = false;
                this.loading = false;
            };
        },
        cutImage(image, sliceCount) {
            const canvas = this.$refs.canvas;
            if (!canvas) return;
            
            const context = canvas.getContext("2d");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            
            if (!sliceCount || sliceCount <= 1) return;
            context.clearRect(0, 0, canvas.width, canvas.height);

            const width = canvas.width;
            const height = canvas.height;

            const rem = height % sliceCount;
            const copyHeight = Math.floor(height / sliceCount);
            const blocks = [];
            let totalH = 0;
            for (let i = 0; i < sliceCount; i++) {
                let h = copyHeight * (i + 1);
                if (i === sliceCount - 1) {
                    h += rem;
                }
                blocks.push([totalH, h]);
                totalH = h;
            }

            let destY = 0;
            for (let i = blocks.length - 1; i >= 0; i--) {
                const start = blocks[i][0];
                const end = blocks[i][1];
                const sliceH = end - start;
                context.drawImage(image, 0, start, width, sliceH, 0, destY, width, sliceH);
                destY += sliceH;
            }
            
            canvas.style.display = 'block';
        }
    }
}

const CommentNode = {
    name: 'CommentNode',
    props: ['node', 'parent', 'depth', 'isLoggedIn', 'revealedSpoilers', 'likedComments', 'likeLoading', 'getAvatarUrl', 'stripHtml'],
    emits: ['reply', 'toggle-spoiler', 'like'],
    computed: {
        marginStyle() {
            const d = parseInt(this.depth);
            const ml = isNaN(d) ? 0 : d * 14;
            return { marginLeft: `${ml}px` };
        },
        avatarUrl() {
            if (!this.getAvatarUrl) return '';
            return this.getAvatarUrl(this.node);
        },
        parentName() {
            const p = this.parent;
            if (!p) return '';
            return p.nickname || p.username || 'User';
        },
        isSpoilerHidden() {
            const id = this.node && this.node.CID ? this.node.CID : '';
            return this.node && this.node.spoiler === '1' && !(this.revealedSpoilers && this.revealedSpoilers[id]);
        },
        isLiked() {
            const id = this.node && this.node.CID ? String(this.node.CID) : '';
            return !!(id && this.likedComments && this.likedComments[id]);
        },
        isLikeLoading() {
            const id = this.node && this.node.CID ? String(this.node.CID) : '';
            return !!(id && this.likeLoading && this.likeLoading[id]);
        }
    },
    methods: {
        onReply() {
            this.$emit('reply', this.node);
        },
        onToggleSpoiler() {
            this.$emit('toggle-spoiler', this.node);
        },
        onLike() {
            this.$emit('like', this.node);
        }
    },
    template: `
        <div class="space-y-2">
            <div class="rounded-2xl border border-outline/10 bg-surface-variant/40 p-4 relative" :style="marginStyle">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-start gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-full overflow-hidden bg-surface border border-outline/10 flex items-center justify-center shrink-0">
                            <img v-if="avatarUrl" :src="avatarUrl" class="w-full h-full object-cover" alt="avatar">
                            <span v-else class="material-symbols-rounded text-on-surface-variant">person</span>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-semibold text-sm truncate max-w-[12rem]">{{ node.nickname || node.username || 'User' }}</span>
                                <span v-if="node.expinfo && node.expinfo.level_name" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{{ node.expinfo.level_name }}</span>
                                <button v-if="node.spoiler === '1'" @click.stop="onToggleSpoiler" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface text-on-surface-variant border border-outline/10 hover:bg-primary hover:text-on-primary transition">
                                    Spoiler
                                </button>
                            </div>
                            <div v-if="parentName" class="text-[11px] text-on-surface-variant mt-1 truncate">
                                回复 @{{ parentName }}
                            </div>
                            <div class="text-xs text-on-surface-variant mt-1">{{ node.addtime }}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button @click.stop="onLike"
                            :disabled="!isLoggedIn || isLikeLoading || isLiked"
                            class="flex items-center gap-1 text-xs bg-surface px-2 py-1 rounded-full border border-outline/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            :class="isLiked ? 'text-primary border-primary/30 bg-primary/10' : 'text-on-surface-variant hover:bg-primary hover:text-on-primary'">
                            <span class="material-symbols-rounded text-base" :class="isLiked ? 'font-variation-settings-fill' : ''">thumb_up</span>
                            {{ node.likes || 0 }}
                        </button>
                        <button v-if="isLoggedIn" @click.stop="onReply" class="w-9 h-9 rounded-full bg-surface text-on-surface-variant border border-outline/10 hover:bg-primary hover:text-on-primary transition"
                            title="Reply">
                            <span class="material-symbols-rounded">reply</span>
                        </button>
                    </div>
                </div>

                <div class="mt-3 text-sm leading-relaxed whitespace-pre-wrap opacity-90">
                    <div :class="isSpoilerHidden ? 'blur-sm' : ''">
                        {{ stripHtml ? stripHtml(node.content) : node.content }}
                    </div>
                </div>
            </div>

            <div v-if="node.children && node.children.length" class="ml-6 pl-4 border-l border-outline/10 space-y-3">
                <comment-node
                    v-for="ch in node.children"
                    :key="ch.CID"
                    :node="ch"
                    :parent="node"
                    :depth="(parseInt(depth) || 0) + 1"
                    :is-logged-in="isLoggedIn"
                    :revealed-spoilers="revealedSpoilers"
                    :liked-comments="likedComments"
                    :like-loading="likeLoading"
                    :get-avatar-url="getAvatarUrl"
                    :strip-html="stripHtml"
                    @reply="$emit('reply', $event)"
                    @toggle-spoiler="$emit('toggle-spoiler', $event)"
                    @like="$emit('like', $event)"
                ></comment-node>
            </div>
        </div>
    `
}

createApp({
    components: {
        'descrambled-image': DescrambledImage,
        'comment-node': CommentNode
    },
    data() {
        return {
            currentTab: 'home',
            config: { username: '', password: '' },
            isLoggedIn: false,
            searchQuery: '',
            searchResults: [],
            favorites: [],
            favPage: 1,
            favTotalPages: 1,
            favFolders: [],
            currentFavFolder: '0',
            commentItems: [],
            commentTree: [],
            commentPage: 1,
            commentTotal: 0,
            commentTotalPages: 1,
            commentLoading: false,
            commentSending: false,
            commentText: '',
            commentReplyTo: '',
            commentCooldownUntil: 0,
            commentNodeById: {},
            likedCommentIds: {},
            commentLikeLoading: {},
            revealedSpoilers: {},
            homeData: [],
            homeLoading: false,
            loading: false,
            selectedAlbum: null,
            currentPage: 1,
            readingChapter: null,
            isDark: false,
            themeColor: 'pink',
            showReaderControls: true,
            showReaderSettings: false,
            readerHideTimer: null,
            readerLastScrollTop: 0,
            readerTouchStartY: 0,
            readerSettings: {
                width: 100,
                gap: 0
            },
            homeScrollPos: 0,
            showBackToTop: false,
            readingHistory: {},
            loginLoading: false,
            loginMsg: '',
            loginMsgType: 'success',
            globalMsg: '',
            globalMsgType: 'info', // 'success', 'error'
            showConfirmModal: false,
            confirmTitle: 'Confirm',
            confirmMessage: 'Are you sure?',
            confirmCallback: null,
            isSelectionMode: false,
            selectedChapters: [],
            showDownloadTaskModal: false,
            downloadTaskId: '',
            downloadTaskInfo: null,
            downloadTaskPoller: null
        }
    },
    mounted() {
        this.checkLoginStatus();
        this.initTheme();
        this.loadFavorites();
        this.loadReadingHistory();
        this.loadLikedComments();
        this.fetchHomeData();
        window.addEventListener('scroll', this.handleScroll);
    },
    beforeUnmount() {
        window.removeEventListener('scroll', this.handleScroll);
        if (this.downloadTaskPoller) {
            clearInterval(this.downloadTaskPoller);
            this.downloadTaskPoller = null;
        }
    },
    watch: {
        currentTab(newVal, oldVal) {
            if (oldVal === 'home') {
                this.homeScrollPos = window.scrollY;
            }
            if (newVal === 'favorites') {
                this.fetchFavorites();
            }
        },
        favorites: {
            handler(newVal) {
                localStorage.setItem('favorites', JSON.stringify(newVal));
            },
            deep: true
        },
        readingHistory: {
            handler(newVal) {
                localStorage.setItem('readingHistory', JSON.stringify(newVal));
            },
            deep: true
        }
    },
    methods: {
        showToast(msg, type = 'success') {
            this.globalMsg = msg;
            this.globalMsgType = type;
            setTimeout(() => {
                this.globalMsg = '';
            }, 3000);
        },
        askConfirm(title, message, callback) {
            this.confirmTitle = title;
            this.confirmMessage = message;
            this.confirmCallback = callback;
            this.showConfirmModal = true;
        },
        handleConfirm(result) {
            this.showConfirmModal = false;
            if (result && this.confirmCallback) {
                this.confirmCallback();
            }
            this.confirmCallback = null;
        },
        closeDownloadTaskModal() {
            this.showDownloadTaskModal = false;
            if (this.downloadTaskPoller) {
                clearInterval(this.downloadTaskPoller);
                this.downloadTaskPoller = null;
            }
        },
        startDownloadTaskPolling() {
            if (this.downloadTaskPoller) {
                clearInterval(this.downloadTaskPoller);
                this.downloadTaskPoller = null;
            }
            this.downloadTaskPoller = setInterval(() => {
                this.fetchDownloadTask().catch(() => {});
            }, 1000);
        },
        async fetchDownloadTask() {
            if (!this.downloadTaskId) return;
            const res = await fetch(`/api/download/tasks/${this.downloadTaskId}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to fetch task');
            }
            const json = await res.json().catch(() => ({}));
            if (json.st && json.st !== 1001) {
                throw new Error(json.msg || 'Failed to fetch task');
            }
            this.downloadTaskInfo = json.data || null;
            const status = this.downloadTaskInfo && this.downloadTaskInfo.status ? String(this.downloadTaskInfo.status) : '';
            if ((status === 'completed' || status === 'failed') && this.downloadTaskPoller) {
                clearInterval(this.downloadTaskPoller);
                this.downloadTaskPoller = null;
            }
        },
        getCoverUrl(book) {
            if (book.image && book.image.startsWith('http')) {
                return this.getImageUrl(book.image);
            }
            const domain = 'cdn-msp.jmapinodeudzn.net';
            const url = `https://${domain}/media/albums/${book.id}.jpg`;
            return this.getImageUrl(url);
        },
        handleScroll() {
            this.showBackToTop = window.scrollY > 300;
        },
        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        restoreHomeScroll() {
            if (this.homeScrollPos > 0) {
                window.scrollTo({ top: this.homeScrollPos, behavior: 'instant' });
            } else {
                window.scrollTo({ top: 0, behavior: 'instant' });
            }
        },
        async fetchHomeData() {
            this.homeLoading = true;
            try {
                const res = await fetch('/api/promote');
                if (!res.ok) throw new Error('Failed to fetch home data');
                const data = await res.json();
                if (Array.isArray(data)) {
                    this.homeData = data;
                } else if (typeof data === 'object') {
                    this.homeData = Object.entries(data).map(([title, content]) => ({
                        id: title,
                        title: title,
                        content: content
                    }));
                }
            } catch (e) {
                console.error(e);
                this.showToast('Failed to load home page', 'error');
            } finally {
                this.homeLoading = false;
            }
        },
        clearHistory() {
            this.askConfirm('Clear History', 'Are you sure you want to clear all reading history?', () => {
                this.readingHistory = {};
                this.showToast('History cleared');
            });
        },
        removeHistoryItem(aid) {
            this.askConfirm('Remove Item', 'Remove this comic from history?', () => {
                delete this.readingHistory[aid];
                this.readingHistory = { ...this.readingHistory };
                this.showToast('Item removed');
            });
        },
        loadFavorites() {
            const stored = localStorage.getItem('favorites');
            if (stored) {
                try {
                    this.favorites = JSON.parse(stored);
                } catch (e) {
                    console.error('Failed to parse favorites', e);
                    this.favorites = [];
                }
            }
        },
        loadReadingHistory() {
            const stored = localStorage.getItem('readingHistory');
            if (stored) {
                try {
                    this.readingHistory = JSON.parse(stored);
                } catch (e) {
                    console.error('Failed to parse history', e);
                    this.readingHistory = {};
                }
            }
        },
        loadLikedComments() {
            const stored = localStorage.getItem('likedCommentIds');
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    this.likedCommentIds = (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (e) {
                    this.likedCommentIds = {};
                }
            }
        },
        saveLikedComments() {
            try {
                localStorage.setItem('likedCommentIds', JSON.stringify(this.likedCommentIds || {}));
            } catch (e) {}
        },
        getReadingButtonText(albumId) {
            const h = this.readingHistory[albumId];
            return h ? 'Continue Reading' : 'Start Reading';
        },
        getHistoryText(albumId) {
            const h = this.readingHistory[albumId];
            return h ? `Last read: ${h.title}` : '';
        },
        async startReading(album) {
            const h = this.readingHistory[album.album_id];
            if (h) {
                this.readChapter(h.photo_id, h.title);
                return;
            }
            if (album.episode_list && album.episode_list.length > 0) {
                let sorted = [...album.episode_list];
                try {
                    sorted.sort((a, b) => {
                        const idA = parseInt(a.id);
                        const idB = parseInt(b.id);
                        if (!isNaN(idA) && !isNaN(idB)) {
                            return idA - idB;
                        }
                        return 0;
                    });
                } catch (e) {}
                const first = sorted[0];
                this.readChapter(first.id, first.title);
            } else {
                this.showToast('No chapters found', 'error');
            }
        },
        toggleFavorite(album) {
            const index = this.favorites.findIndex(f => f.album_id === album.album_id);
            if (index === -1) {
                this.favorites.push({
                    album_id: album.album_id,
                    title: album.title,
                    author: album.author,
                    image: album.image,
                    category: 'Favorite'
                });
            } else {
                this.favorites.splice(index, 1);
            }
        },
        isFavorite(albumId) {
            return this.favorites.some(f => f.album_id === albumId);
        },
        handleReaderClick() {
            if (this.showReaderSettings) {
                this.showReaderSettings = false;
                return;
            }
            if (this.showReaderControls) {
                this.hideReaderUi();
                return;
            }
            this.showReaderUiForAwhile();
        },
        showReaderUiForAwhile() {
            this.showReaderControls = true;
            if (this.readerHideTimer) {
                clearTimeout(this.readerHideTimer);
                this.readerHideTimer = null;
            }
            this.readerHideTimer = setTimeout(() => {
                this.showReaderControls = false;
                this.readerHideTimer = null;
            }, 2200);
        },
        hideReaderUi() {
            this.showReaderControls = false;
            if (this.readerHideTimer) {
                clearTimeout(this.readerHideTimer);
                this.readerHideTimer = null;
            }
        },
        handleReaderScroll(e) {
            const el = e && e.target ? e.target : null;
            if (!el) return;
            const top = el.scrollTop || 0;
            if (top < this.readerLastScrollTop - 8) {
                this.hideReaderUi();
            }
            this.readerLastScrollTop = top;
        },
        handleReaderTouchStart(e) {
            const t = e && e.touches && e.touches[0] ? e.touches[0] : null;
            if (!t) return;
            this.readerTouchStartY = t.clientY || 0;
        },
        handleReaderTouchEnd(e) {
            const t = e && e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null;
            if (!t) return;
            const endY = t.clientY || 0;
            const delta = this.readerTouchStartY - endY;
            if (delta > 40) {
                this.hideReaderUi();
            }
        },
        getReaderChapterIndex() {
            if (!this.selectedAlbum || !this.selectedAlbum.episode_list || !this.readingChapter) return -1;
            const id = String(this.readingChapter.photo_id || '');
            const idx = this.selectedAlbum.episode_list.findIndex(ep => String(ep.id) === id);
            return idx;
        },
        getReaderChapterCount() {
            if (!this.selectedAlbum || !this.selectedAlbum.episode_list) return 0;
            return this.selectedAlbum.episode_list.length || 0;
        },
        canReadPrevChapter() {
            const idx = this.getReaderChapterIndex();
            return idx > 0;
        },
        canReadNextChapter() {
            const idx = this.getReaderChapterIndex();
            const total = this.getReaderChapterCount();
            return idx >= 0 && idx < total - 1;
        },
        async readPrevChapter() {
            const idx = this.getReaderChapterIndex();
            if (idx <= 0) return;
            const ep = this.selectedAlbum.episode_list[idx - 1];
            if (!ep) return;
            await this.readChapter(ep.id, ep.title);
            this.$nextTick(() => {
                if (this.$refs.readerRoot) this.$refs.readerRoot.scrollTo({ top: 0, behavior: 'instant' });
            });
            this.showReaderUiForAwhile();
        },
        async readNextChapter() {
            const idx = this.getReaderChapterIndex();
            const total = this.getReaderChapterCount();
            if (idx < 0 || idx >= total - 1) return;
            const ep = this.selectedAlbum.episode_list[idx + 1];
            if (!ep) return;
            await this.readChapter(ep.id, ep.title);
            this.$nextTick(() => {
                if (this.$refs.readerRoot) this.$refs.readerRoot.scrollTo({ top: 0, behavior: 'instant' });
            });
            this.showReaderUiForAwhile();
        },
        async toggleReaderLike() {
            if (!this.selectedAlbum) return;
            if (!this.isLoggedIn) {
                this.showToast('Please sign in first', 'error');
                return;
            }
            try {
                const res = await fetch('/api/favorite/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ album_id: this.selectedAlbum.album_id })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.detail || 'Failed');
                }
                if (json.st && json.st !== 1001) {
                    throw new Error(json.msg || 'Failed');
                }
                this.toggleFavorite(this.selectedAlbum);
                this.showToast(this.isFavorite(this.selectedAlbum.album_id) ? 'Liked' : 'Unliked', 'success');
            } catch (e) {
                this.showToast(e.message || 'Failed', 'error');
            }
        },
        initTheme() {
            if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                this.isDark = true;
            } else {
                this.isDark = false;
            }
            if (localStorage.themeColor) {
                this.themeColor = localStorage.themeColor;
            }
            this.updateThemeClasses();
        },
        toggleTheme() {
            this.isDark = !this.isDark;
            localStorage.theme = this.isDark ? 'dark' : 'light';
            this.updateThemeClasses();
        },
        setThemeColor(color) {
            this.themeColor = color;
            localStorage.themeColor = color;
            this.updateThemeClasses();
        },
        updateThemeClasses() {
            const html = document.documentElement;
            html.classList.remove('dark', 'theme-orange', 'theme-green');
            if (this.themeColor === 'orange') {
                html.classList.add('theme-orange');
            } else if (this.themeColor === 'green') {
                html.classList.add('theme-green');
            }
            if (this.isDark) {
                html.classList.add('dark');
            }
        },
        getImageUrl(url) {
            if (!url) return '';
            return `/api/image-proxy?url=${encodeURIComponent(url)}`;
        },
        getChapterImageUrl(photoId, imageName, scrambleId, domain) {
            let url = `/api/chapter_image/${photoId}/${imageName}?scramble_id=${scrambleId}`;
            if (domain) {
                url += `&domain=${encodeURIComponent(domain)}`;
            }
            return url;
        },
        async checkLoginStatus() {
            try {
                const res = await fetch('/api/config');
                const data = await res.json();
                this.isLoggedIn = data.is_logged_in;
                if (this.isLoggedIn) {
                    this.config.username = data.username;
                }
            } catch (e) {}
        },
        async saveConfig() {
            if (!this.config.username || !this.config.password) {
                this.loginMsg = 'Please enter both username and password';
                this.loginMsgType = 'error';
                return;
            }

            this.loginLoading = true;
            this.loginMsg = '';
            
            try {
                const res = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.config)
                });
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.detail || 'Login failed');
                }
                
                this.loginMsg = data.message;
                this.loginMsgType = 'success';
                
                setTimeout(() => {
                    this.checkLoginStatus();
                    this.loginMsg = '';
                }, 1000);
                
            } catch (e) {
                this.loginMsg = e.message;
                this.loginMsgType = 'error';
            } finally {
                this.loginLoading = false;
            }
        },
        async logout() {
            this.askConfirm('Sign Out', 'Are you sure you want to logout?', async () => {
                try {
                    const res = await fetch('/api/logout', { method: 'POST' });
                    const data = await res.json();
                    this.showToast(data.message);
                    this.config.username = '';
                    this.config.password = '';
                    this.checkLoginStatus();
                } catch (e) {
                    this.showToast('Logout failed', 'error');
                }
            });
        },
        async search(page = 1) {
            if (!this.searchQuery) return;
            if (typeof page !== 'number') page = 1;
            this.loading = true;
            this.currentTab = 'search';
            this.currentPage = page;
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(this.searchQuery)}&page=${this.currentPage}`);
                if (!res.ok) throw new Error(`Search failed: ${res.status}`);
                const data = await res.json();
                this.searchResults = data.results || [];
            } catch (e) {
                this.showToast('Search failed', 'error');
            } finally {
                this.loading = false;
            }
        },
        async fetchFavorites(page = 1) {
            if (!this.isLoggedIn) {
                this.favorites = [];
                return;
            }
            this.loading = true;
            this.favPage = page;
            try {
                const res = await fetch(`/api/favorites?page=${this.favPage}&folder_id=${this.currentFavFolder}`);
                if (!res.ok) throw new Error('Failed to fetch favorites');
                const data = await res.json();
                if (data.content) {
                    this.favorites = data.content;
                    this.favTotalPages = data.pages || 1;
                    if (data.folders) {
                        this.favFolders = data.folders;
                    }
                } else {
                    this.favorites = Array.isArray(data) ? data : [];
                }
            } catch (e) {} finally {
                this.loading = false;
            }
        },
        changeFavPage(delta) {
            const newPage = this.favPage + delta;
            if (newPage < 1 || newPage > this.favTotalPages) return;
            this.fetchFavorites(newPage);
        },
        changeFavFolder(folderId) {
            this.currentFavFolder = folderId;
            this.fetchFavorites(1);
        },
        changePage(delta) {
            const newPage = this.currentPage + delta;
            if (newPage < 1) return;
            this.search(newPage);
        },
        async viewDetails(albumId) {
            this.selectedAlbum = null;
            this.currentTab = 'detail';
            try {
                const res = await fetch(`/api/album/${albumId}`);
                if (!res.ok) throw new Error('Failed');
                this.selectedAlbum = await res.json();
                this.commentItems = [];
                this.commentPage = 1;
                this.commentTotal = 0;
                this.commentTotalPages = 1;
                this.commentText = '';
                this.commentReplyTo = '';
                this.revealedSpoilers = {};
                this.fetchComments(1);
            } catch (e) {
                this.showToast('Could not load details', 'error');
                this.currentTab = 'search';
            }
        },
        stripHtml(html) {
            if (!html) return '';
            return String(html)
                .replace(/<br\s*\/?\s*>/gi, '\n')
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();
        },
        toggleSpoiler(c) {
            if (!c || c.spoiler !== '1') return;
            const id = c.CID;
            this.revealedSpoilers = { ...this.revealedSpoilers, [id]: !this.revealedSpoilers[id] };
        },
        replyToComment(c) {
            if (!c || !c.CID) return;
            this.commentReplyTo = c.CID;
            this.commentText = '';
            this.showToast(`Replying to #${c.CID}`, 'info');
        },
        cancelReply() {
            this.commentReplyTo = '';
        },
        async likeComment(node) {
            if (!node || !node.CID) return;
            if (!this.isLoggedIn) {
                this.showToast('Please sign in first', 'error');
                return;
            }
            const cid = String(node.CID);
            if (this.likedCommentIds && this.likedCommentIds[cid]) {
                this.showToast('已点赞', 'info');
                return;
            }
            if (this.commentLikeLoading && this.commentLikeLoading[cid]) return;
            this.commentLikeLoading = { ...(this.commentLikeLoading || {}), [cid]: true };
            try {
                const applyLocalLike = (toastMsg) => {
                    const n = this.commentNodeById ? this.commentNodeById[cid] : null;
                    if (n) {
                        const cur = parseInt(n.likes || 0);
                        n.likes = (isNaN(cur) ? 0 : cur) + 1;
                    }
                    this.likedCommentIds = { ...(this.likedCommentIds || {}), [cid]: true };
                    this.saveLikedComments();
                    this.showToast(toastMsg || '已点赞', 'success');
                };

                const res = await fetch('/api/comment/like', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cid })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.detail || 'Failed to like');
                }
                if (json.st && json.st !== 1001) {
                    const msg = String(json.msg || '');
                    if (msg.includes('勿重複留言') || msg.includes('勿重复留言')) {
                        applyLocalLike('已点赞（上游接口限制，已本地记录）');
                        return;
                    }
                    throw new Error(msg || 'Failed to like');
                }
                const data = (json.data && typeof json.data === 'object') ? json.data : {};
                const msg = (data && typeof data.msg === 'string' && data.msg) ? data.msg : '';
                applyLocalLike(msg || '点赞成功');
            } catch (e) {
                this.showToast(e.message || 'Failed to like', 'error');
            } finally {
                const next = { ...(this.commentLikeLoading || {}) };
                delete next[cid];
                this.commentLikeLoading = next;
            }
        },
        buildCommentTree(list) {
            if (!Array.isArray(list)) return [];
            const nodeMap = new Map();
            const order = [];
            for (const raw of list) {
                if (!raw || !raw.CID) continue;
                if (!nodeMap.has(raw.CID)) {
                    const n = { ...raw, children: [] };
                    nodeMap.set(raw.CID, n);
                    order.push(raw.CID);
                } else {
                    const existing = nodeMap.get(raw.CID);
                    nodeMap.set(raw.CID, { ...existing, ...raw, children: existing.children || [] });
                }
            }

            const byId = {};
            for (const [k, v] of nodeMap.entries()) {
                byId[String(k)] = v;
            }
            this.commentNodeById = byId;

            const roots = [];
            for (const cid of order) {
                const n = nodeMap.get(cid);
                if (!n) continue;
                const pid = n.parent_CID;
                if (pid && pid !== '0' && nodeMap.has(pid)) {
                    nodeMap.get(pid).children.push(n);
                } else {
                    roots.push(n);
                }
            }
            return roots;
        },
        getUserAvatarUrl(node) {
            const photo = node && node.photo ? String(node.photo) : '';
            if (!photo || photo.startsWith('nopic-')) return '';
            if (photo.startsWith('http://') || photo.startsWith('https://')) {
                return this.getImageUrl(photo);
            }
            if (photo.includes('/media/users/')) {
                const base = this.getPreferredImageBase();
                return this.getImageUrl(`${base}${photo.startsWith('/') ? '' : '/'}${photo}`);
            }
            const base = this.getPreferredImageBase();
            return this.getImageUrl(`${base}/media/users/${encodeURIComponent(photo)}`);
        },
        getPreferredImageBase() {
            const fallback = 'https://cdn-msp.jmapiproxy1.cc';
            try {
                if (this.selectedAlbum && this.selectedAlbum.image && String(this.selectedAlbum.image).startsWith('http')) {
                    const u = new URL(this.selectedAlbum.image);
                    return `${u.protocol}//${u.host}`;
                }
            } catch (e) {}
            return fallback;
        },
        async fetchComments(page = 1) {
            if (!this.selectedAlbum) return;
            if (page < 1) page = 1;
            this.commentLoading = true;
            try {
                const res = await fetch(`/api/comments?album_id=${encodeURIComponent(this.selectedAlbum.album_id)}&page=${page}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.detail || 'Failed to load comments');
                }
                if (json.st && json.st !== 1001) {
                    this.commentItems = [];
                    this.commentTotal = 0;
                    this.commentTotalPages = 1;
                    this.commentPage = 1;
                    return;
                }
                const data = (json.data && typeof json.data === 'object') ? json.data : {};
                const list = Array.isArray(data.list) ? data.list : [];
                const total = parseInt(data.total || 0);
                const pageSize = 20;
                const totalPages = Math.max(1, Math.ceil((isNaN(total) ? 0 : total) / pageSize));
                this.commentItems = list;
                this.commentTree = this.buildCommentTree(list);
                this.commentTotal = isNaN(total) ? list.length : total;
                this.commentTotalPages = totalPages;
                this.commentPage = page;
            } catch (e) {
                this.showToast(e.message || 'Failed to load comments', 'error');
            } finally {
                this.commentLoading = false;
            }
        },
        async sendComment() {
            if (!this.selectedAlbum) return;
            if (!this.isLoggedIn) {
                this.showToast('Please sign in first', 'error');
                return;
            }
            const text = (this.commentText || '').trim();
            if (!text) return;
            if (this.commentCooldownUntil && Date.now() < this.commentCooldownUntil) {
                this.showToast('请稍后再发送', 'info');
                return;
            }
            if (/[A-Za-z0-9]/.test(text)) {
                this.showToast('评论暂不支持英文/数字，请改为中文内容', 'error');
                return;
            }
            if (text.length < 6) {
                this.showToast('留言太短，容易被判为重复，建议至少 6 个字', 'error');
                return;
            }
            this.commentSending = true;
            try {
                const res = await fetch('/api/comment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        album_id: this.selectedAlbum.album_id,
                        comment: text,
                        comment_id: this.commentReplyTo || null
                    })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.detail || 'Failed to post comment');
                }
                const data = (json.data && typeof json.data === 'object') ? json.data : {};
                const backendMsg = (data && typeof data.msg === 'string' && data.msg) ? data.msg : (json.msg || '');
                if (json.st && json.st !== 1001) {
                    throw new Error(backendMsg || 'Failed to post comment');
                }
                if (data && typeof data.status === 'string' && data.status.toLowerCase() === 'fail') {
                    throw new Error(backendMsg || 'Failed to post comment');
                }
                this.commentText = '';
                this.commentReplyTo = '';
                this.showToast(backendMsg || 'Comment posted', 'success');
                this.commentCooldownUntil = Date.now() + 5000;
                this.fetchComments(1);
            } catch (e) {
                const msg = String(e && e.message ? e.message : '') || 'Failed to post comment';
                if (msg.includes('短時間內連續發文') || msg.includes('短时间内连续发文')) {
                    this.commentCooldownUntil = Date.now() + 20000;
                } else if (msg.includes('勿重複留言') || msg.includes('勿重复留言')) {
                    this.commentCooldownUntil = Date.now() + 8000;
                } else {
                    this.commentCooldownUntil = Date.now() + 3000;
                }
                if (msg.includes('勿重複留言') || msg.includes('勿重复留言')) {
                    this.showToast('该平台会把过短/常见内容判为重复：建议多写几个字并避免模板词', 'error');
                } else {
                    this.showToast(msg, 'error');
                }
            } finally {
                this.commentSending = false;
            }
        },
        async readChapter(photoId, title) {
            this.readingChapter = null;
            this.currentTab = 'reader';
            this.showReaderControls = true;
            this.readerLastScrollTop = 0;
            if (this.readerHideTimer) {
                clearTimeout(this.readerHideTimer);
                this.readerHideTimer = null;
            }
            
            if (this.selectedAlbum) {
                this.readingHistory[this.selectedAlbum.album_id] = {
                    photo_id: photoId,
                    title: title,
                    album_title: this.selectedAlbum.title,
                    timestamp: Date.now()
                };
                this.readingHistory = { ...this.readingHistory };
            }

            try {
                const res = await fetch(`/api/chapter/${photoId}`);
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.detail || 'Failed to load chapter');
                }
                this.readingChapter = await res.json();
                this.showReaderUiForAwhile();
            } catch (e) {
                this.showToast(`Error: ${e.message}`, 'error');
                setTimeout(() => {
                    if (!this.readingChapter) this.currentTab = 'detail';
                }, 2000);
            }
        },
        async download(albumId) {
            this.askConfirm('Download', `Download entire album ${albumId}?`, async () => {
                this.showToast('Queuing download...', 'info');
                try {
                    const res = await fetch('/api/download', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ album_id: albumId, chapter_ids: [] })
                    });
                    const data = await res.json();
                    if (res.ok) {
                        this.showToast(data.message, 'success');
                    } else {
                        throw new Error(data.detail || 'Download failed');
                    }
                } catch(e) {
                    this.showToast(e.message, 'error');
                }
            });
        },
        toggleSelectionMode() {
            this.isSelectionMode = !this.isSelectionMode;
            if (!this.isSelectionMode) {
                this.selectedChapters = [];
                return;
            }
            const eps = (this.selectedAlbum && Array.isArray(this.selectedAlbum.episode_list)) ? this.selectedAlbum.episode_list : [];
            if (eps.length === 1 && eps[0] && eps[0].id != null) {
                this.selectedChapters = [String(eps[0].id)];
                return;
            }
            this.selectedChapters = [];
        },
        selectAll() {
            if (this.selectedAlbum && this.selectedAlbum.episode_list) {
                if (this.selectedChapters.length === this.selectedAlbum.episode_list.length) {
                    this.selectedChapters = [];
                } else {
                    this.selectedChapters = this.selectedAlbum.episode_list.map(ep => ep.id);
                }
            }
        },
        isSelected(epId) {
            return this.selectedChapters.includes(epId);
        },
        handleChapterClick(ep) {
            if (this.isSelectionMode) {
                const index = this.selectedChapters.indexOf(ep.id);
                if (index === -1) {
                    this.selectedChapters.push(ep.id);
                } else {
                    this.selectedChapters.splice(index, 1);
                }
            } else {
                this.readChapter(ep.id, ep.title);
            }
        },
        async downloadSelected() {
            if (!this.selectedAlbum) return;
            if (this.selectedChapters.length === 0) return;
            try {
                const selectedSet = new Set(this.selectedChapters.map(String));
                const chapters = (this.selectedAlbum.episode_list || [])
                    .filter(ep => selectedSet.has(String(ep.id)))
                    .map(ep => ({ id: String(ep.id), title: String(ep.title || '') }));

                this.showDownloadTaskModal = true;
                this.downloadTaskInfo = {
                    album_id: String(this.selectedAlbum.album_id),
                    album_title: String(this.selectedAlbum.title || ''),
                    status: 'queued',
                    stage: 'queued',
                    message: 'Queuing...',
                    percent: 0,
                    downloaded_images: 0,
                    total_images: 0,
                };

                const res = await fetch('/api/download/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        album_id: String(this.selectedAlbum.album_id),
                        album_title: String(this.selectedAlbum.title || ''),
                        chapters
                    })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.detail || 'Download failed');
                }
                if (json.st && json.st !== 1001) {
                    throw new Error(json.msg || 'Download failed');
                }
                this.downloadTaskInfo = json.data || null;
                this.downloadTaskId = this.downloadTaskInfo ? (this.downloadTaskInfo.task_id || '') : '';
                this.startDownloadTaskPolling();

                this.isSelectionMode = false;
                this.selectedChapters = [];
            } catch (e) {
                this.showToast(e.message || 'Download failed', 'error');
            }
        }
    }
}).mount('#app')
