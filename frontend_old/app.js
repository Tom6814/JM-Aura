const { createApp } = Vue

const DescrambledImage = {
    props: ['src', 'comicId', 'scrambleId', 'page', 'index'],
    template: `
        <div class="w-full flex justify-center min-h-[220px]" ref="container">
            <div v-if="state === 'idle'" class="w-full h-56 flex items-center justify-center bg-white/0 text-white/10">
                <span class="material-symbols-rounded text-3xl">more_horiz</span>
            </div>

            <div v-else-if="state === 'loading' && needDescramble" class="w-full h-96 flex items-center justify-center bg-white/5 text-white/20">
                <span class="material-symbols-rounded animate-spin text-3xl">hourglass_empty</span>
            </div>

            <div v-else-if="state === 'error'" class="w-full h-56 flex flex-col items-center justify-center gap-3 bg-white/5 text-white/70 border border-white/10 rounded-2xl mx-2 my-2">
                <div class="flex items-center gap-2 text-sm font-semibold">
                    <span class="material-symbols-rounded text-red-400">broken_image</span>
                    图片加载失败
                </div>
                <button @click.stop="retry"
                    class="h-10 px-5 rounded-full bg-primary text-on-primary hover:brightness-110 transition font-bold shadow-lg shadow-primary/20">
                    重新加载该图片
                </button>
            </div>

            <canvas ref="canvas" class="w-full h-auto object-contain block" style="display: none;"></canvas>
            <img
                v-if="state !== 'idle' && !needDescramble && state !== 'error'"
                :src="displaySrc"
                class="w-full h-auto object-contain block"
                alt="Page"
                @load="onImgLoad"
                @error="onImgError"
            >
        </div>
    `,
    data() {
        return {
            state: 'idle', // idle | loading | error | done
            needDescramble: false,
            loadingStarted: false,
            loadToken: 0,
            imgKey: 0
        }
    },
    computed: {
        displaySrc() {
            const src = String(this.src || '');
            if (!src) return '';
            if (!this.imgKey) return src;
            const sep = src.includes('?') ? '&' : '?';
            return `${src}${sep}retry=${this.imgKey}`;
        }
    },
    mounted() {
        this.checkLoad();
    },
    watch: {
        src() {
            this.loadingStarted = false;
            this.needDescramble = false;
            this.state = 'idle';
            this.checkLoad();
        },
        '$root.readerLoadLimit': {
            immediate: true,
            handler() {
                this.checkLoad();
            }
        }
    },
    methods: {
        checkLoad() {
            if (this.loadingStarted) return;
            const idx = parseInt(this.index || 0);
            const limit = parseInt(this.$root.readerLoadLimit || 0);
            if (idx < limit) {
                this.startLoad();
            }
        },
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
        onFinish() {
            const idx = parseInt(this.index || 0);
            if (this.$root && typeof this.$root.onReaderImageFinished === 'function') {
                this.$root.onReaderImageFinished(idx);
            }
        },
        startLoad() {
            const myToken = ++this.loadToken;
            this.loadingStarted = true;
            this.state = 'loading';
            this.needDescramble = false;

            const canvas = this.$refs.canvas;
            if (canvas) canvas.style.display = 'none';

            const pageName = String(this.page || '').split('.')[0];
            const epsId = parseInt(this.comicId);
            const scrambleId = parseInt(this.scrambleId);
            const sliceCount = this.getSegmentationNum(epsId, scrambleId, pageName);

            if (sliceCount <= 1 || /\.gif$/i.test(String(this.page || ''))) {
                this.needDescramble = false;
                return;
            }

            this.needDescramble = true;
            const img = new Image();
            img.crossOrigin = "Anonymous";
            const rawSrc = String(this.src || '');
            if (this.imgKey) {
                const sep = rawSrc.includes('?') ? '&' : '?';
                img.src = `${rawSrc}${sep}retry=${this.imgKey}`;
            } else {
                img.src = rawSrc;
            }
            
            img.onload = () => {
                if (myToken !== this.loadToken) return;
                this.cutImage(img, sliceCount);
                this.state = 'done';
                this.onFinish();
            };
            
            img.onerror = () => {
                if (myToken !== this.loadToken) return;
                this.needDescramble = false;
                this.state = 'error';
                this.onFinish();
            };
        },
        retry() {
            if (!this.loadingStarted) return;
            this.imgKey += 1;
            this.state = 'loading';
            const canvas = this.$refs.canvas;
            if (canvas) canvas.style.display = 'none';
            this.startLoad();
        },
        onImgLoad() {
            if (!this.loadingStarted) return;
            if (this.state !== 'loading') return;
            this.state = 'done';
            this.onFinish();
        },
        onImgError() {
            if (!this.loadingStarted) return;
            if (this.state !== 'loading') return;
            this.state = 'error';
            this.onFinish();
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
            <div class="rounded-2xl bg-surface-container-low p-4 relative hover:bg-surface-container transition-colors" :style="marginStyle">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-start gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-full overflow-hidden bg-surface-variant flex items-center justify-center shrink-0">
                            <img v-if="avatarUrl" :src="avatarUrl" class="w-full h-full object-cover" alt="avatar">
                            <span v-else class="material-symbols-rounded text-on-surface-variant">person</span>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-semibold text-sm truncate max-w-[12rem] text-on-surface">{{ node.nickname || node.username || 'User' }}</span>
                                <span v-if="node.expinfo && node.expinfo.level_name" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{{ node.expinfo.level_name }}</span>
                                <button v-if="node.spoiler === '1'" @click.stop="onToggleSpoiler" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface text-on-surface-variant hover:bg-primary hover:text-on-primary transition">
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
                            class="flex items-center gap-1 text-xs bg-surface-variant/50 px-2 py-1 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
                            :class="isLiked ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:bg-primary hover:text-on-primary'">
                            <span class="material-symbols-rounded text-base" :class="isLiked ? 'font-variation-settings-fill' : ''">thumb_up</span>
                            {{ node.likes || 0 }}
                        </button>
                        <button v-if="isLoggedIn" @click.stop="onReply" class="w-9 h-9 rounded-full bg-surface-variant/50 text-on-surface-variant hover:bg-primary hover:text-on-primary transition"
                            title="Reply">
                            <span class="material-symbols-rounded">reply</span>
                        </button>
                    </div>
                </div>

                <div class="mt-3 text-sm leading-relaxed whitespace-pre-wrap opacity-90 text-on-surface">
                    <div :class="isSpoilerHidden ? 'blur-sm' : ''">
                        {{ stripHtml ? stripHtml(node.content) : node.content }}
                    </div>
                </div>
            </div>

            <div v-if="node.children && node.children.length" class="ml-6 pl-4 border-l space-y-3" style="border-color: var(--md-stroke-color);">
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

const BookCard = {
    props: {
        book: Object,
        source: { type: String, default: 'jm' },
        showAuthor: { type: Boolean, default: true }
    },
    emits: ['click'],
    methods: {
        getCover() {
            if (this.book.coverUrl) return this.book.coverUrl;
            if (this.book.image) {
                if (this.book.image.startsWith('http')) return this.book.image;
                return this.$root.getImageUrl ? this.$root.getImageUrl(this.book.image) : this.book.image;
            }
            if (this.book.thumb) {
                 return this.$root.getProxyUrl ? this.$root.getProxyUrl(this.book.thumb) : this.book.thumb;
            }
            return '';
        },
        getTitle() {
            return this.book.title || this.book.name || 'Unknown';
        },
        getAuthor() {
            const raw = this.book.author || this.book.writer || '';
            return this.$root && this.$root.formatAuthor ? this.$root.formatAuthor(raw) : raw;
        },
        getId() {
            return this.book.album_id || this.book.id || this.book._id;
        },
        handleClick() {
            this.$emit('click', this.getId());
        }
    },
    template: `
    <div class="md-card md-card-hover overflow-hidden cursor-pointer group flex flex-col h-full"
         @click="handleClick">
        <div class="aspect-[3/4] overflow-hidden relative bg-surface-variant">
            <img :src="getCover()" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" alt="Cover">
            
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end p-3">
                <span class="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg transform translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 delay-75">
                  <span class="material-symbols-rounded">arrow_forward</span>
                </span>
            </div>
            
            <div class="absolute top-2 right-2 flex flex-col items-end gap-1">
                 <span v-if="book.status" class="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] text-white font-medium shadow-sm border border-white/10">
                    {{ book.status }}
                 </span>
            </div>
        </div>
        <div class="p-3 flex flex-col flex-1 gap-1">
            <h3 class="font-bold text-sm line-clamp-2 leading-tight group-hover:text-primary transition-colors" :title="getTitle()">
                {{ getTitle() }}
            </h3>
            <div v-if="showAuthor" class="mt-auto pt-2 flex items-center justify-between opacity-80">
                <p class="text-xs truncate max-w-[100%] text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-rounded text-[14px] opacity-70">person</span>
                    {{ getAuthor() }}
                </p>
            </div>
        </div>
    </div>
    `
};

const LoadingState = {
    props: {
        loading: Boolean
    },
    template: `
    <div v-if="loading" class="flex flex-col items-center justify-center py-16 opacity-60">
        <span class="material-symbols-rounded text-5xl animate-spin text-primary mb-4">progress_activity</span>
        <slot></slot>
    </div>
    `
};

const ErrorState = {
    props: ['error'],
    emits: ['retry'],
    template: `
    <div v-if="error" class="md-card p-4 md:p-6 bg-surface-container-low">
        <div class="flex items-start gap-4">
            <div class="p-2 rounded-full bg-error/10 text-error">
                <span class="material-symbols-rounded text-xl">error</span>
            </div>
            <div class="min-w-0 flex-1 pt-1">
                <h3 class="font-bold text-on-surface mb-1">无法加载内容</h3>
                <p class="text-sm text-on-surface-variant/80 break-words leading-relaxed">{{ error }}</p>
            </div>
            <button @click="$emit('retry')"
                class="md-btn-primary h-10 px-5 text-sm shadow-none bg-surface-variant text-on-surface-variant hover:bg-primary hover:text-on-primary border-none">
                重试
            </button>
        </div>
    </div>
    `
};

const PaginationControls = {
    props: ['page', 'loading', 'hasMore'],
    emits: ['prev', 'next'],
    template: `
    <div class="flex justify-center items-center gap-6 pt-6 pb-2">
        <button @click="$emit('prev')" :disabled="page <= 1 || loading"
            class="w-12 h-12 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center disabled:opacity-30 hover:bg-primary hover:text-on-primary transition shadow-sm hover:shadow-md">
            <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <span class="text-sm font-medium opacity-80 font-mono">Page {{ page }}</span>
        <button @click="$emit('next')" :disabled="loading"
            class="w-12 h-12 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center disabled:opacity-30 hover:bg-primary hover:text-on-primary transition shadow-sm hover:shadow-md">
            <span class="material-symbols-rounded">arrow_forward</span>
        </button>
    </div>
    `
};

createApp({
    components: {
        'descrambled-image': DescrambledImage,
        'comment-node': CommentNode,
        'book-card': BookCard,
        'loading-state': LoadingState,
        'error-state': ErrorState,
        'pagination-controls': PaginationControls
    },
    data() {
        return {
            source: 'jm',
            currentTab: 'home',
            config: { username: '', password: '' },
            accountFeatures: {
                savePassword: false,
                autoLogin: false,
                autoCheckin: false
            },
            isLoggedIn: false,
            searchQuery: '',
            topbarSearchQuery: '',
            topbarOverflowIds: [],
            topbarOverflowOpen: false,
            topbarSearchMode: 'input',
            topbarSearchDropdownOpen: false,
            topbarSearchWidthMode: 'wide',
            topbarLabelMode: 'full',
            topbarReady: false,
            searchResults: [],
            favoriteStateById: {},
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
            commentSpoilerIds: [],
            revealedSpoilerCount: 0,
            homeData: [],
            homeLoading: false,
            homeRefreshing: false,
            homeLastUpdatedAt: 0,
            homeError: '',
            isOnline: true,
            homeTopbarVisible: false,
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
                gap: 0,
                initial: 4,
                batch: 3
            },
            homeScrollPos: 0,
            tabScrollPos: {},
            showBackToTop: false,
            readingHistory: {},
            loginLoading: false,
            loginMsg: '',
            loginMsgType: 'success',
            globalMsg: '',
            globalMsgType: 'info', // 'success', 'error'
            showConfirmModal: false,
            showJmMenu: false,
            jmNavPressTimer: null,
            jmNavSuppressClickUntil: 0,
            showFavMenu: false,
            favNavPressTimer: null,
            favNavSuppressClickUntil: 0,
            lastJmTab: 'jm_latest',
            confirmTitle: 'Confirm',
            confirmMessage: 'Are you sure?',
            confirmCallback: null,
            isSelectionMode: false,
            selectedChapters: [],
            showDownloadTaskModal: false,
            downloadTaskId: '',
            downloadTaskInfo: null,
            downloadTaskPoller: null,

            readerLoadLimit: 4,
            readerBatchEndIndex: 3,

            jmCategories: [],
            jmCategoriesLoading: false,
            jmCategoriesError: '',
            jmSelectedCategory: '0',
            jmSelectedCategoryTitle: '全部',
            jmCategoryKeyword: '',
            jmCategoryItems: [],
            jmCategoryLoading: false,
            jmCategoryError: '',
            jmCategoryPage: 1,
            jmDebugApiBase: '',
            jmDebugImgBase: '',
            jmDebugLastOkApiBase: '',
            jmDebugLoading: false,

            jmLatestCategory: '0',
            jmLatestItems: [],
            jmLatestLoading: false,
            jmLatestError: '',
            jmLatestPage: 1,
            jmLatestHasMore: true,

            jmLeaderboardCategory: '0',
            jmLeaderboardSort: 'tf',
            jmLeaderboardItems: [],
            jmLeaderboardLoading: false,
            jmLeaderboardError: '',
            jmLeaderboardPage: 1,
            jmLeaderboardHasMore: true,
            jmAutoLoadLastAt: 0,
            jmLeaderboardSortOptions: [
                { value: 'mr', label: '最新' },
                { value: 'tf', label: '点赞' },
                { value: 'mv', label: '观看' },
                { value: 'mv_t', label: '日榜' },
                { value: 'mv_w', label: '周榜' },
                { value: 'mv_m', label: '月榜' },
                { value: 'mp', label: '图片' }
            ],

            jmHistoryItems: [],
            jmHistoryLoading: false,
            jmHistoryError: '',
            jmHistoryPage: 1,

            jmFavFolders: [{ id: '0', name: '全部' }],
            jmFavFolderId: '0',
            jmFavFolderTitle: '全部',
            jmFavItems: [],
            jmFavLoading: false,
            jmFavPage: 1,
            jmFavTotalPages: 1,
            jmFavShowCreate: false,
            jmFavNewFolderName: '',
            jmFavCreateError: '',
            jmFavShowMove: false,
            jmFavMoveAlbumId: '',
            jmFavMoveTitle: '',
            jmFavMoveFolderId: '0',
            jmFavFolderOpLoading: false,
            jmFavTitleFilter: '',
            jmFavSelectionMode: false,
            jmFavSelectedIds: [],
            jmFavShowBatchMove: false,
            jmFavBatchFolderId: '0',
            jmFavBatchMoving: false,
            jmFavShowRename: false,
            jmFavRenameFolderId: '',
            jmFavRenameFolderName: '',

            jmSearchCategory: '0',
            jmSearchCategoryTitle: '全部',

            alsoViewedLoading: false,
            alsoViewedItems: [],
            jmRandomPreview: null,
            jmRandomLoading: false,

            accountProfile: null,
            accountProfileLoading: false,
            accountSignature: '',
            accountOldPassword: '',
            accountNewPassword: '',
            accountUpdating: false,
            cacheCleanupLoading: false,
            avatarUploading: false,

            clientIp: '',
            storageScopeKey: 'unknown',

            jmHistoryMode: 'local'
        }
    },
    computed: {
        topbarOverflowMap() {
            const m = {};
            const a = Array.isArray(this.topbarOverflowIds) ? this.topbarOverflowIds : [];
            for (const id of a) m[id] = true;
            return m;
        },
        jmFavFilteredItems() {
            const q = String(this.jmFavTitleFilter || '').trim().toLowerCase();
            const list = Array.isArray(this.jmFavItems) ? this.jmFavItems : [];
            if (!q) return list;
            return list.filter(it => String(it && it.title ? it.title : '').toLowerCase().includes(q));
        },
        jmFavSelectedCount() {
            const a = Array.isArray(this.jmFavSelectedIds) ? this.jmFavSelectedIds : [];
            return a.length;
        },
        jmLocalHistoryItems() {
            const h = (this.readingHistory && typeof this.readingHistory === 'object') ? this.readingHistory : {};
            const items = Object.entries(h).map(([albumId, v]) => ({
                album_id: String(albumId),
                album_title: v && v.album_title ? String(v.album_title) : `Comic ${albumId}`,
                title: v && v.title ? String(v.title) : '',
                photo_id: v && v.photo_id ? String(v.photo_id) : '',
                timestamp: v && v.timestamp ? Number(v.timestamp) : 0
            }));
            items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            return items;
        }
    },
    mounted() {
        this.initAccountFeatures();
        this.installApiReloginInterceptor();
        this.checkLoginStatus().finally(() => {
            this.tryAutoLogin();
        });
        this.initTheme();
        this.initClientScope().finally(() => {
            this.loadReadingHistory();
            this.loadLikedComments();
        });
        this.fetchHomeData();
        window.addEventListener('scroll', this.handleScroll);
        this.isOnline = navigator.onLine;
        window.addEventListener('online', this.handleOnlineStatus);
        window.addEventListener('offline', this.handleOnlineStatus);
        window.addEventListener('resize', this.updateTopbarLayout);
        document.addEventListener('click', this.onTopbarOutsideClick, true);
        this.$nextTick(() => {
            this.syncNavClass();
            this.topbarReady = false;
            Promise.resolve(this.updateTopbarLayout()).finally(() => {
                this.topbarReady = true;
                setTimeout(() => this.updateTopbarLayout(), 240);
                try {
                    if (document && document.fonts && document.fonts.ready) {
                        document.fonts.ready.then(() => this.updateTopbarLayout()).catch(() => {});
                    }
                } catch (e) {}
            });
        });
    },
    beforeUnmount() {
        window.removeEventListener('scroll', this.handleScroll);
        window.removeEventListener('online', this.handleOnlineStatus);
        window.removeEventListener('offline', this.handleOnlineStatus);
        window.removeEventListener('resize', this.updateTopbarLayout);
        document.removeEventListener('click', this.onTopbarOutsideClick, true);
        if (this.downloadTaskPoller) {
            clearInterval(this.downloadTaskPoller);
            this.downloadTaskPoller = null;
        }
    },
    watch: {
        currentTab(newVal, oldVal) {
            if (newVal !== 'home') {
                this.homeTopbarVisible = false;
            }
            this.topbarOverflowOpen = false;
            this.topbarSearchDropdownOpen = false;
            this.syncNavClass();
            try {
                const prev = String(oldVal || '');
                if (prev && prev !== 'reader') {
                    this.tabScrollPos = { ...(this.tabScrollPos || {}), [prev]: window.scrollY || 0 };
                }
            } catch (e) {}
            if (oldVal === 'home') {
                this.homeScrollPos = window.scrollY;
            }
            if (this.isJmTab(newVal)) {
                this.lastJmTab = String(newVal || 'jm_latest');
            }
            try {
                const nextTab = String(newVal || '');
                if (nextTab !== 'home' && nextTab !== 'reader') {
                    const top = (this.tabScrollPos && typeof this.tabScrollPos === 'object' && this.tabScrollPos[nextTab]) ? this.tabScrollPos[nextTab] : 0;
                    try {
                        window.scrollTo({ top, left: 0, behavior: 'auto' });
                    } catch (e) {
                        window.scrollTo(0, top);
                    }
                    requestAnimationFrame(() => {
                        try {
                            window.scrollTo({ top, left: 0, behavior: 'auto' });
                        } catch (e) {
                            window.scrollTo(0, top);
                        }
                    });
                }
            } catch (e) {}
            if (newVal === 'config') {
                this.loadAccountProfile();
            }
            if (newVal === 'search' && this.source === 'jm') {
                this.loadJmCategories();
            }
            if (newVal === 'jm_latest') {
                this.loadJmCategories();
                this.jmLatestHasMore = true;
                this.loadJmLatest(1, false);
            }
            if (newVal === 'jm_categories') {
                this.loadJmCategories();
                this.loadJmDebug();
            }
            if (newVal === 'jm_leaderboard') {
                this.loadJmCategories();
                this.jmLeaderboardHasMore = true;
                this.loadJmLeaderboard(1, false);
            }
            if (newVal === 'jm_random') {
                this.loadJmRandomPreview();
            }
            if (newVal === 'jm_history') {
                if (this.jmHistoryMode === 'remote') {
                    this.loadJmHistory(1);
                }
            }
            if (newVal === 'jm_favorites') {
                this.loadJmFavorites(1);
            }
            this.$nextTick(() => {
                this.updateTopbarLayout();
            });
        },
        readingHistory: {
            handler(newVal) {
                try {
                    localStorage.setItem(this.getStorageKey('readingHistory'), JSON.stringify(newVal));
                } catch (e) {}
            },
            deep: true
        },
        'readerSettings.initial'(v) {
            try {
                const total = (this.readingChapter && Array.isArray(this.readingChapter.images)) ? this.readingChapter.images.length : 0;
                const ini = Math.max(1, parseInt(v || 4));
                if (total > 0 && this.readerLoadLimit < ini) {
                    this.readerLoadLimit = Math.min(total, ini);
                    this.readerBatchEndIndex = Math.max(0, this.readerLoadLimit - 1);
                }
            } catch (e) {}
        }
    },
    methods: {
        syncNavClass() {
            try {
                const has = String(this.currentTab || '') !== 'reader';
                document.body.classList.toggle('has-nav', has);
            } catch (e) {}
        },
        isJmTab(tab) {
            return ['jm_latest', 'jm_categories', 'jm_leaderboard', 'jm_random', 'jm_history'].includes(String(tab || ''));
        },
        onJmNavPressStart() {
            try {
                if (this.jmNavPressTimer) {
                    clearTimeout(this.jmNavPressTimer);
                    this.jmNavPressTimer = null;
                }
            } catch (e) {}
            this.jmNavPressTimer = setTimeout(() => {
                this.showJmMenu = true;
                this.jmNavSuppressClickUntil = Date.now() + 900;
            }, 450);
        },
        onJmNavPressCancel() {
            try {
                if (this.jmNavPressTimer) {
                    clearTimeout(this.jmNavPressTimer);
                    this.jmNavPressTimer = null;
                }
            } catch (e) {}
        },
        onJmRandomNavClick() {
            try {
                if (Date.now() < Number(this.jmNavSuppressClickUntil || 0)) return;
            } catch (e) {}
            this.currentTab = 'jm_random';
        },
        onFavNavPressStart() {
            try {
                if (this.favNavPressTimer) {
                    clearTimeout(this.favNavPressTimer);
                    this.favNavPressTimer = null;
                }
            } catch (e) {}
            this.favNavPressTimer = setTimeout(() => {
                this.showFavMenu = true;
                this.favNavSuppressClickUntil = Date.now() + 900;
            }, 450);
        },
        onFavNavPressCancel() {
            try {
                if (this.favNavPressTimer) {
                    clearTimeout(this.favNavPressTimer);
                    this.favNavPressTimer = null;
                }
            } catch (e) {}
        },
        onFavNavClick() {
            try {
                if (Date.now() < Number(this.favNavSuppressClickUntil || 0)) return;
            } catch (e) {}
            this.currentTab = 'jm_favorites';
        },
        toggleTopbarOverflow() {
            this.topbarOverflowOpen = !this.topbarOverflowOpen;
            if (this.topbarOverflowOpen) {
                this.topbarSearchDropdownOpen = false;
            }
        },
        toggleTopbarSearchDropdown() {
            this.topbarSearchDropdownOpen = !this.topbarSearchDropdownOpen;
            if (this.topbarSearchDropdownOpen) {
                this.topbarOverflowOpen = false;
            }
        },
        onTopbarOutsideClick(e) {
            try {
                if (!this.topbarOverflowOpen && !this.topbarSearchDropdownOpen) return;
                const t = e && e.target ? e.target : null;
                if (!t || !t.closest) return;
                const nav = t.closest('[data-topbar-root="1"]');
                if (nav) return;
                this.topbarOverflowOpen = false;
                this.topbarSearchDropdownOpen = false;
            } catch (err) {}
        },
        async updateTopbarLayout() {
            try {
                if (typeof window === 'undefined') return;
                const isDesktop = window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
                if (!isDesktop) {
                    this.topbarOverflowIds = [];
                    this.topbarOverflowOpen = false;
                    this.topbarSearchMode = 'input';
                    this.topbarSearchDropdownOpen = false;
                    this.topbarSearchWidthMode = 'wide';
                    this.topbarLabelMode = 'full';
                    return;
                }
                const root = document.querySelector('[data-topbar-root="1"]');
                if (!root) return;
                const desktop = root.querySelector('[data-topbar-desktop="1"]');
                if (!desktop) return;

                const calc = () => {
                    const w = desktop.clientWidth || 0;
                    const logo = desktop.querySelector('[data-topbar-logo="1"]');
                    const left = desktop.querySelector('[data-topbar-left="1"]');
                    const right = desktop.querySelector('[data-topbar-right="1"]');
                    const logoW = logo ? (logo.offsetWidth || 0) : 0;
                    const leftW = left ? (left.scrollWidth || 0) : 0;
                    const rightW = right ? (right.scrollWidth || 0) : 0;
                    const gap = 16;
                    return { fits: (logoW + leftW + rightW + gap) <= w, w, logoW, leftW, rightW };
                };

                const visibleIds = [];
                const candidates = [];
                if (this.source === 'jm') {
                    candidates.push('jm_latest', 'jm_categories', 'jm_leaderboard', 'jm_history');
                }
                candidates.push('jm_random', 'jm_favorites', 'config');
                for (const id of candidates) {
                    const el = desktop.querySelector(`[data-topbar-item="${id}"]`);
                    if (el) visibleIds.push(id);
                }
                const hidePriority = ['jm_history', 'jm_leaderboard', 'jm_categories', 'jm_latest', 'jm_random', 'jm_favorites', 'config'];

                const prevOverflow = Array.isArray(this.topbarOverflowIds) ? this.topbarOverflowIds : [];
                let overflow = [];

                this.topbarOverflowIds = [];
                this.topbarLabelMode = 'full';
                this.topbarSearchMode = 'input';
                this.topbarSearchWidthMode = 'wide';
                await this.$nextTick();

                let m = calc();
                if (!m.fits) {
                    this.topbarSearchWidthMode = 'narrow';
                    await this.$nextTick();
                    m = calc();
                }

                if (!m.fits) {
                    this.topbarSearchMode = 'button';
                    await this.$nextTick();
                    m = calc();
                }

                if (!m.fits) {
                    this.topbarLabelMode = 'icon';
                    await this.$nextTick();
                    m = calc();
                }

                if (!m.fits) {
                    for (const id of hidePriority) {
                        if (!visibleIds.includes(id)) continue;
                        overflow.push(id);
                        this.topbarOverflowIds = overflow.slice();
                        await this.$nextTick();
                        m = calc();
                        if (m.fits) break;
                    }
                }

                this.topbarOverflowIds = overflow.slice();
                if (!overflow.length && prevOverflow.length) {
                    this.topbarOverflowOpen = false;
                }
                if (this.topbarSearchMode === 'input') {
                    this.topbarSearchDropdownOpen = false;
                }
            } catch (e) {}
        },
        topbarSearch() {
            const q = String(this.topbarSearchQuery || '').trim();
            if (!q) {
                this.currentTab = 'search';
                return;
            }
            this.searchQuery = q;
            this.jmSearchCategory = '0';
            this.jmSearchCategoryTitle = '全部';
            this.search(1);
        },
        formatAuthor(author) {
            if (author === null || author === undefined) return '';
            if (Array.isArray(author)) {
                const parts = author.map(x => String(x || '').trim()).filter(Boolean);
                return parts.join(', ');
            }
            if (typeof author === 'string') {
                const s = author.trim();
                if (!s) return '';
                if (s.startsWith('[') && s.endsWith(']')) {
                    try {
                        const parsed = JSON.parse(s);
                        return this.formatAuthor(parsed);
                    } catch (e) {}
                    try {
                        const parts = [];
                        const re = /'([^']*)'|"([^"]*)"/g;
                        let m;
                        while ((m = re.exec(s)) !== null) {
                            const v = String((m[1] ?? m[2] ?? '')).trim();
                            if (v) parts.push(v);
                        }
                        if (parts.length) return parts.join(', ');
                        const inner = s.slice(1, -1).trim();
                        if (!inner) return '';
                    } catch (e) {}
                }
                return s;
            }
            if (typeof author === 'number' || typeof author === 'boolean') return String(author);
            if (typeof author === 'object') {
                const a = author && (author.author ?? author.name ?? author.title);
                return this.formatAuthor(a);
            }
            return String(author || '').trim();
        },
        onReaderImageFinished(imgIndex) {
            if (!this.readingChapter || !Array.isArray(this.readingChapter.images)) return;
            const idx = Math.max(0, parseInt(imgIndex || 0));
            const total = this.readingChapter.images.length || 0;
            const end = parseInt(this.readerBatchEndIndex || 0);
            if (total <= 0) return;
            if (idx !== end) return;

            const batch = Math.max(1, parseInt((this.readerSettings && this.readerSettings.batch) ? this.readerSettings.batch : 3));
            const nextLimit = Math.min(total, Math.max(0, parseInt(this.readerLoadLimit || 0)) + batch);
            if (nextLimit <= (this.readerLoadLimit || 0)) return;
            this.readerLoadLimit = nextLimit;
            this.readerBatchEndIndex = nextLimit - 1;
        },
        installApiReloginInterceptor() {
            try {
                if (window.__jmAuraApiFetchPatched) return;
                window.__jmAuraApiFetchPatched = true;
            } catch (e) {
                return;
            }

            const originalFetch = window.fetch ? window.fetch.bind(window) : null;
            if (!originalFetch) return;

            const NOT_LOGIN_ST = 1014;
            const self = this;
            let reloginPromise = null;

            const normalizeUrl = (input) => {
                if (typeof input === 'string') return input;
                if (input && typeof input === 'object' && input.url) return String(input.url);
                return '';
            };

            const shouldIntercept = (url) => {
                if (!url) return false;
                if (!url.startsWith('/api/')) return false;
                if (url.startsWith('/api/config')) return false;
                if (url.startsWith('/api/session/relogin')) return false;
                return true;
            };

            const needsRelogin = async (res) => {
                if (!res) return false;
                if (res.status === 401) return true;
                try {
                    const ct = String(res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '').toLowerCase();
                    if (!ct.includes('application/json')) return false;
                    const j = await res.clone().json().catch(() => null);
                    if (j && typeof j === 'object' && Number(j.st) === NOT_LOGIN_ST) return true;
                } catch (e) {}
                return false;
            };

            const reloginFromLocal = async () => {
                if (reloginPromise) return reloginPromise;
                reloginPromise = (async () => {
                    try {
                        const features = self.accountFeatures || {};
                        if (!features.autoLogin) return false;
                        const u = String(localStorage.getItem('savedUsername') || self.config.username || '').trim();
                        const p = String(self.getSavedPassword ? self.getSavedPassword() : '').trim();
                        if (!u || !p) return false;
                        const res = await originalFetch('/api/session/relogin', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: u, password: p })
                        });
                        const json = await res.json().catch(() => ({}));
                        if (!res.ok) return false;
                        if (json && typeof json === 'object' && json.st && Number(json.st) !== 1001) return false;
                        self.isLoggedIn = true;
                        return true;
                    } catch (e) {
                        return false;
                    } finally {
                        reloginPromise = null;
                    }
                })();
                return reloginPromise;
            };

            window.fetch = async (input, init) => {
                const url = normalizeUrl(input);
                if (!shouldIntercept(url)) {
                    return originalFetch(input, init);
                }
                const res = await originalFetch(input, init);
                const need = await needsRelogin(res);
                if (!need) return res;
                const ok = await reloginFromLocal();
                if (!ok) return res;
                return originalFetch(input, init);
            };
        },
        initAccountFeatures() {
            try {
                const raw = localStorage.getItem('accountFeatures');
                if (raw) {
                    const v = JSON.parse(raw);
                    if (v && typeof v === 'object') {
                        this.accountFeatures = {
                            savePassword: !!v.savePassword,
                            autoLogin: !!v.autoLogin,
                            autoCheckin: !!v.autoCheckin
                        };
                    }
                }
            } catch (e) {}

            const savedUsername = localStorage.getItem('savedUsername') || '';
            const savedPassword = this.getSavedPassword();
            if (savedUsername && !this.config.username) this.config.username = savedUsername;
            if (this.accountFeatures.savePassword && savedPassword && !this.config.password) {
                this.config.password = savedPassword;
            }
        },
        persistAccountFeatures() {
            try {
                localStorage.setItem('accountFeatures', JSON.stringify(this.accountFeatures || {}));
            } catch (e) {}
        },
        encodeBase64(s) {
            try {
                return btoa(unescape(encodeURIComponent(String(s || ''))));
            } catch (e) {
                return '';
            }
        },
        decodeBase64(s) {
            try {
                return decodeURIComponent(escape(atob(String(s || ''))));
            } catch (e) {
                return '';
            }
        },
        getSavedPassword() {
            const enc = localStorage.getItem('savedPassword') || '';
            return enc ? this.decodeBase64(enc) : '';
        },
        setSavedPassword(pwd) {
            try {
                if (!pwd) {
                    localStorage.removeItem('savedPassword');
                    return;
                }
                localStorage.setItem('savedPassword', this.encodeBase64(pwd));
            } catch (e) {}
        },
        toggleAccountFeature(key) {
            if (!this.accountFeatures || typeof this.accountFeatures !== 'object') {
                this.accountFeatures = { savePassword: false, autoLogin: false, autoCheckin: false };
            }
            if (!(key in this.accountFeatures)) return;
            this.accountFeatures[key] = !this.accountFeatures[key];
            this.persistAccountFeatures();

            if (key === 'savePassword' && !this.accountFeatures.savePassword) {
                this.setSavedPassword('');
            }
            if (key === 'autoLogin') {
                this.tryAutoLogin();
            }
        },
        tryAutoLogin() {
            if (this.isLoggedIn) return;
            if (!this.accountFeatures || !this.accountFeatures.autoLogin) return;
            const u = String(this.config.username || localStorage.getItem('savedUsername') || '').trim();
            const p = String(this.config.password || this.getSavedPassword() || '').trim();
            if (!u || !p) return;
            if (this.loginLoading) return;
            this.config.username = u;
            this.config.password = p;
            this.saveConfig();
        },
        showToast(msg, type = 'success') {
            this.globalMsg = msg;
            this.globalMsgType = type;
            setTimeout(() => {
                this.globalMsg = '';
            }, 3000);
        },
        getStorageKey(base) {
            const ip = String(this.storageScopeKey || 'unknown');
            const src = String(this.source || 'jm');
            return `${base}:${src}:${ip}`;
        },
        async initClientScope() {
            try {
                const res = await fetch('/api/client-info');
                const json = await res.json().catch(() => ({}));
                const ip = (json && json.data && json.data.ip) ? String(json.data.ip) : (json && json.ip ? String(json.ip) : '');
                this.clientIp = ip;
                this.storageScopeKey = ip || 'unknown';
            } catch (e) {
                this.clientIp = '';
                this.storageScopeKey = 'unknown';
            }
        },
        setSource(source) {
            const s = 'jm';
            this.source = s;
            localStorage.setItem('source', s);
            this.searchResults = [];
            this.searchQuery = '';
            this.selectedAlbum = null;
            this.commentItems = [];
            this.commentTree = [];
            this.readingChapter = null;
            this.currentTab = 'home';
            this.fetchHomeData();
            this.loadReadingHistory();
            this.loadLikedComments();
            this.checkLoginStatus();
        },
        getJmCategoryId(c) {
            if (!c) return '0';
            if (typeof c === 'string' || typeof c === 'number') return String(c);
            const slug = c.slug || c.SLUG || '';
            if (slug) return String(slug);
            const v = c.CID || c.id || c.category_id || c.cid || '0';
            return String(v || '0');
        },
        getJmCategoryTitle(c) {
            if (!c) return '全部';
            if (typeof c === 'string' || typeof c === 'number') return String(c);
            const v = c.title || c.name || c.CNAME || c.cname || c.tag || c.TITLE || '';
            return String(v || '分类');
        },
        async loadJmCategories() {
            if (this.source !== 'jm') return;
            if (this.jmCategoriesLoading) return;
            this.jmCategoriesError = '';
            this.jmCategoriesLoading = true;
            try {
                const res = await fetch('/api/v2/jm/categories');
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed to load categories');
                }
                const raw = Array.isArray(json.data) ? json.data : [];
                const filtered = raw.filter(x => this.getJmCategoryId(x) !== '0');
                const list = [{ id: '0', slug: '0', name: '全部', title: '全部' }].concat(filtered);
                this.jmCategories = list;
            } catch (e) {
                this.jmCategoriesError = String(e && e.message ? e.message : 'Failed to load categories');
                this.showToast(this.jmCategoriesError, 'error');
                this.jmCategories = [{ id: '0', slug: '0', name: '全部', title: '全部' }];
            } finally {
                this.jmCategoriesLoading = false;
            }
        },
        async loadJmDebug() {
            if (this.source !== 'jm') return;
            if (this.jmDebugLoading) return;
            this.jmDebugLoading = true;
            try {
                const res = await fetch('/api/jm/debug');
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed');
                }
                const d = json.data || {};
                this.jmDebugApiBase = d.api_base || '';
                this.jmDebugImgBase = d.img_base || '';
                this.jmDebugLastOkApiBase = d.last_ok_api_base || '';
            } catch (e) {
                this.jmDebugApiBase = '';
                this.jmDebugImgBase = '';
                this.jmDebugLastOkApiBase = '';
            } finally {
                this.jmDebugLoading = false;
            }
        },
        selectJmCategory(c) {
            const id = this.getJmCategoryId(c);
            this.jmSelectedCategory = id;
            this.jmSelectedCategoryTitle = this.getJmCategoryTitle(c);
            this.jmCategoryItems = [];
            this.loadJmCategoryList(id, 1);
        },
        selectJmCategoryForLatest(c) {
            const id = this.getJmCategoryId(c);
            this.jmLatestCategory = id;
            this.jmLatestHasMore = true;
            this.loadJmLatest(1, false);
        },
        async loadJmLatest(page = 1, append = false) {
            if (this.source !== 'jm') return;
            const p = Math.max(1, parseInt(page || 1));
            if (this.jmLatestLoading) return;
            if (append && !this.jmLatestHasMore) return;
            this.jmLatestError = '';
            this.jmLatestLoading = true;
            try {
                const cat = String(this.jmLatestCategory || '0');
                const res = await fetch(`/api/v2/jm/leaderboard?category=${encodeURIComponent(cat)}&page=${p}&sort=mr`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed');
                }
                const items = Array.isArray(json.data) ? json.data : [];
                const mapped = items.map(x => ({
                    album_id: x.comic_id,
                    title: x.title,
                    author: this.formatAuthor(x.author),
                    image: x.cover_url,
                    raw: x
                })).filter(x => x.album_id);
                if (append) {
                    if (!mapped.length) {
                        this.jmLatestHasMore = false;
                    } else {
                        const dedup = new Map();
                        for (const it of (this.jmLatestItems || [])) dedup.set(String(it.album_id), it);
                        for (const it of mapped) dedup.set(String(it.album_id), it);
                        this.jmLatestItems = Array.from(dedup.values());
                    }
                } else {
                    this.jmLatestHasMore = true;
                    this.jmLatestItems = mapped;
                }
                this.jmLatestPage = p;
            } catch (e) {
                this.jmLatestError = String(e && e.message ? e.message : 'Failed to load latest');
                this.showToast(this.jmLatestError, 'error');
                if (!append) this.jmLatestItems = [];
            } finally {
                this.jmLatestLoading = false;
            }
        },
        async refreshJmRandomPage() {
            await this.loadJmRandomPreview();
        },
        async loadJmRandomPreview() {
            if (this.source !== 'jm') return;
            if (this.jmRandomLoading) return;
            this.jmRandomLoading = true;
            try {
                const res = await fetch('/api/v2/jm/random');
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed');
                }
                const x = json.data;
                if (!x || !x.comic_id) {
                    this.jmRandomPreview = null;
                    return;
                }
                this.jmRandomPreview = {
                    album_id: x.comic_id,
                    title: x.title,
                    author: this.formatAuthor(x.author),
                    image: x.cover_url
                };
            } catch (e) {
                this.jmRandomPreview = null;
                this.showToast(e.message || 'Failed', 'error');
            } finally {
                this.jmRandomLoading = false;
            }
        },
        async loadJmCategoryList(categoryId, page = 1) {
            if (this.source !== 'jm') return;
            const cat = String(categoryId || '0');
            const p = Math.max(1, parseInt(page || 1));
            if (this.jmCategoryLoading) return;
            this.jmCategoryError = '';
            this.jmCategoryLoading = true;
            try {
                const res = await fetch(`/api/v2/jm/leaderboard?category=${encodeURIComponent(cat)}&page=${p}&sort=tf`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed');
                }
                const items = Array.isArray(json.data) ? json.data : [];
                this.jmCategoryItems = items.map(x => ({
                    album_id: x.comic_id,
                    title: x.title,
                    author: this.formatAuthor(x.author),
                    image: x.cover_url,
                    raw: x
                })).filter(x => x.album_id);
                this.jmCategoryPage = p;
            } catch (e) {
                this.jmCategoryError = String(e && e.message ? e.message : 'Failed to load category');
                this.showToast(this.jmCategoryError, 'error');
                this.jmCategoryItems = [];
            } finally {
                this.jmCategoryLoading = false;
            }
        },
        async jmSearchInCategory() {
            const q = (this.jmCategoryKeyword || '').trim();
            if (!q) return;
            this.jmSearchCategory = String(this.jmSelectedCategory || '0');
            this.jmSearchCategoryTitle = String(this.jmSelectedCategoryTitle || '全部');
            this.searchQuery = q;
            this.currentTab = 'search';
            await this.search(1);
        },
        setJmSearchCategory(c) {
            const id = this.getJmCategoryId(c);
            this.jmSearchCategory = String(id || '0');
            this.jmSearchCategoryTitle = this.getJmCategoryTitle(c);
            if (this.currentTab === 'search' && !(this.searchQuery || '').trim()) {
                this.search(1);
            }
        },
        openJmFolderCreate() {
            if (!this.isLoggedIn) {
                this.showToast('请先在 Settings 登录 JM', 'error');
                return;
            }
            this.jmFavNewFolderName = '';
            this.jmFavCreateError = '';
            this.jmFavShowCreate = true;
        },
        closeJmFolderCreate() {
            this.jmFavShowCreate = false;
            this.jmFavNewFolderName = '';
            this.jmFavCreateError = '';
        },
        async createJmFolder() {
            const name = (this.jmFavNewFolderName || '').trim();
            if (!name) return;
            if (this.jmFavFolderOpLoading) return;
            this.jmFavCreateError = '';
            this.jmFavFolderOpLoading = true;
            try {
                const res = await fetch('/api/favorite_folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'add', folder_name: name })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Create failed');
                }
                const r = json && typeof json === 'object' ? json.result : null;
                if (r && typeof r === 'object' && String(r.status || '').toLowerCase() === 'fail') {
                    throw new Error(r.msg || json.msg || 'Create failed');
                }
                this.showToast('收藏夹已创建', 'success');
                this.closeJmFolderCreate();
                await this.loadJmFavorites(1);
            } catch (e) {
                const msg = String(e && e.message ? e.message : '') || 'Create failed';
                this.jmFavCreateError = msg;
                this.showToast(msg, 'error');
            } finally {
                this.jmFavFolderOpLoading = false;
            }
        },
        deleteJmFolder(folder) {
            const id = folder && folder.id ? String(folder.id) : '';
            const name = folder && folder.name ? String(folder.name) : '';
            if (!id || id === '0') return;
            this.askConfirm('删除收藏夹', `确定删除「${name}」吗？（不会删除作品本身）`, async () => {
                if (this.jmFavFolderOpLoading) return;
                this.jmFavFolderOpLoading = true;
                try {
                    const res = await fetch('/api/favorite_folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'del', folder_id: id })
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || (json.st && json.st !== 1001)) {
                        throw new Error(json.msg || json.detail || 'Delete failed');
                    }
                    const r = json && typeof json === 'object' ? json.result : null;
                    if (r && typeof r === 'object' && String(r.status || '').toLowerCase() === 'fail') {
                        throw new Error(r.msg || json.msg || 'Delete failed');
                    }
                    this.showToast('收藏夹已删除', 'success');
                    if (this.jmFavFolderId === id) {
                        this.jmFavFolderId = '0';
                        this.jmFavFolderTitle = '全部';
                    }
                    await this.loadJmFavorites(1);
                } catch (e) {
                    this.showToast(e.message || 'Delete failed', 'error');
                } finally {
                    this.jmFavFolderOpLoading = false;
                }
            });
        },
        selectJmFavFolder(f) {
            const id = f && f.id ? String(f.id) : '0';
            const name = f && f.name ? String(f.name) : '全部';
            this.jmFavFolderId = id;
            this.jmFavFolderTitle = name;
            this.jmFavSelectionMode = false;
            this.jmFavSelectedIds = [];
            this.loadJmFavorites(1);
        },
        toggleJmFavSelectionMode() {
            this.jmFavSelectionMode = !this.jmFavSelectionMode;
            this.jmFavSelectedIds = [];
        },
        isJmFavSelected(aid) {
            const id = String(aid || '');
            return Array.isArray(this.jmFavSelectedIds) && this.jmFavSelectedIds.includes(id);
        },
        toggleJmFavSelectOne(aid) {
            const id = String(aid || '');
            if (!id) return;
            const cur = Array.isArray(this.jmFavSelectedIds) ? [...this.jmFavSelectedIds] : [];
            const idx = cur.indexOf(id);
            if (idx >= 0) cur.splice(idx, 1);
            else cur.push(id);
            this.jmFavSelectedIds = cur;
        },
        toggleJmFavSelectAll() {
            const list = Array.isArray(this.jmFavFilteredItems) ? this.jmFavFilteredItems : [];
            const ids = list.map(x => String(x && x.album_id ? x.album_id : '')).filter(Boolean);
            const cur = Array.isArray(this.jmFavSelectedIds) ? this.jmFavSelectedIds : [];
            if (cur.length === ids.length && ids.length > 0) {
                this.jmFavSelectedIds = [];
            } else {
                this.jmFavSelectedIds = ids;
            }
        },
        openJmFavBatchMove() {
            if (!this.jmFavSelectionMode) return;
            if (!this.jmFavSelectedCount) return;
            this.jmFavBatchFolderId = String(this.jmFavFolderId || '0');
            this.jmFavShowBatchMove = true;
        },
        closeJmFavBatchMove() {
            this.jmFavShowBatchMove = false;
            this.jmFavBatchFolderId = '0';
        },
        async confirmJmFavBatchMove() {
            if (!this.jmFavSelectedCount) return;
            const fid = String(this.jmFavBatchFolderId || '').trim();
            if (!fid) return;
            if (this.jmFavBatchMoving) return;
            this.jmFavBatchMoving = true;
            try {
                const ids = Array.isArray(this.jmFavSelectedIds) ? [...this.jmFavSelectedIds] : [];
                for (const aid of ids) {
                    const res = await fetch('/api/favorite_folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'move', album_id: String(aid), folder_id: fid })
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || (json.st && json.st !== 1001)) {
                        throw new Error(json.msg || json.detail || 'Move failed');
                    }
                    const r = json && typeof json === 'object' ? json.result : null;
                    if (r && typeof r === 'object' && String(r.status || '').toLowerCase() === 'fail') {
                        throw new Error(r.msg || json.msg || 'Move failed');
                    }
                }
                this.showToast(`已移动 ${this.jmFavSelectedCount} 项`, 'success');
                this.closeJmFavBatchMove();
                this.jmFavSelectionMode = false;
                this.jmFavSelectedIds = [];
                await this.loadJmFavorites(this.jmFavPage);
            } catch (e) {
                this.showToast(e.message || 'Move failed', 'error');
            } finally {
                this.jmFavBatchMoving = false;
            }
        },
        openJmFolderRename(folder) {
            const id = folder && folder.id ? String(folder.id) : '';
            const name = folder && folder.name ? String(folder.name) : '';
            if (!id || id === '0') return;
            this.jmFavRenameFolderId = id;
            this.jmFavRenameFolderName = name;
            this.jmFavShowRename = true;
        },
        closeJmFolderRename() {
            this.jmFavShowRename = false;
            this.jmFavRenameFolderId = '';
            this.jmFavRenameFolderName = '';
        },
        async confirmJmFolderRename() {
            const id = String(this.jmFavRenameFolderId || '').trim();
            const name = String(this.jmFavRenameFolderName || '').trim();
            if (!id || !name) return;
            if (this.jmFavFolderOpLoading) return;
            this.jmFavFolderOpLoading = true;
            try {
                const res = await fetch('/api/favorite_folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'rename', folder_id: id, folder_name: name })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Rename failed');
                }
                const r = json && typeof json === 'object' ? json.result : null;
                if (r && typeof r === 'object' && String(r.status || '').toLowerCase() === 'fail') {
                    throw new Error(r.msg || json.msg || 'Rename failed');
                }
                const newFolderId = json && typeof json === 'object' && json.new_folder_id ? String(json.new_folder_id) : '';
                const oldFolderId = json && typeof json === 'object' && json.old_folder_id ? String(json.old_folder_id) : '';
                const folders = Array.isArray(json.folders) ? json.folders : (Array.isArray(json.data?.folders) ? json.data.folders : []);
                if (folders && folders.length) {
                    const safeFolders = [{ id: '0', name: '全部' }].concat(
                        (folders || []).map(x => ({ id: String(x.id || '0'), name: String(x.name || '') })).filter(x => x.id)
                    );
                    const dedup = new Map();
                    for (const f of safeFolders) {
                        if (!dedup.has(f.id)) dedup.set(f.id, f);
                    }
                    this.jmFavFolders = Array.from(dedup.values());
                }
                if (newFolderId && oldFolderId && this.jmFavFolderId === oldFolderId) {
                    this.jmFavFolderId = newFolderId;
                    this.jmFavFolderTitle = name;
                } else if (this.jmFavFolderId === id) {
                    this.jmFavFolderTitle = name;
                }
                this.showToast((json && json.emulated) ? '已重命名（已迁移）' : '已重命名', 'success');
                this.closeJmFolderRename();
                await this.loadJmFavorites(1);
            } catch (e) {
                const msg = String(e && e.message ? e.message : '') || 'Rename failed';
                if (msg.includes('Invalid type') || msg.includes('invalid') || msg.includes('Not supported')) {
                    this.showToast('上游暂不支持重命名', 'error');
                } else {
                    this.showToast(msg, 'error');
                }
            } finally {
                this.jmFavFolderOpLoading = false;
            }
        },
        async loadJmFavorites(page = 1) {
            if (this.source !== 'jm') return;
            if (!this.isLoggedIn) return;
            const p = Math.max(1, parseInt(page || 1));
            if (this.jmFavLoading) return;
            this.jmFavLoading = true;
            try {
                const res = await fetch(`/api/favorites?page=${p}&folder_id=${encodeURIComponent(this.jmFavFolderId || '0')}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed');
                }
                const content = Array.isArray(json.data?.content) ? json.data.content : (Array.isArray(json.content) ? json.content : []);
                const folders = Array.isArray(json.data?.folders) ? json.data.folders : (Array.isArray(json.folders) ? json.folders : []);
                const pages = parseInt((json.data?.pages ?? json.pages) || 1);
                const safeFolders = [{ id: '0', name: '全部' }].concat(
                    (folders || []).map(x => ({ id: String(x.id || '0'), name: String(x.name || '') })).filter(x => x.id)
                );
                const dedup = new Map();
                for (const f of safeFolders) {
                    if (!dedup.has(f.id)) dedup.set(f.id, f);
                }
                this.jmFavFolders = Array.from(dedup.values());
                this.jmFavItems = (content || []).map(x => ({
                    album_id: x.album_id,
                    title: x.title,
                    author: this.formatAuthor(x.author),
                    image: x.image,
                    category: x.category
                })).filter(x => x.album_id);
                try {
                    const m = { ...(this.favoriteStateById || {}) };
                    for (const it of this.jmFavItems) {
                        const id = String(it && it.album_id ? it.album_id : '');
                        if (id) m[id] = true;
                    }
                    this.favoriteStateById = m;
                } catch (e) {}
                this.jmFavTitleFilter = '';
                this.jmFavSelectionMode = false;
                this.jmFavSelectedIds = [];
                this.jmFavPage = p;
                this.jmFavTotalPages = isNaN(pages) ? 1 : pages;
                const currentFolder = this.jmFavFolders.find(x => x.id === String(this.jmFavFolderId || '0'));
                if (currentFolder) this.jmFavFolderTitle = currentFolder.name;
            } catch (e) {
                this.jmFavItems = [];
                this.jmFavTotalPages = 1;
            } finally {
                this.jmFavLoading = false;
            }
        },
        openJmMoveFavorite(item) {
            this.jmFavMoveAlbumId = String(item && item.album_id ? item.album_id : '');
            this.jmFavMoveTitle = String(item && item.title ? item.title : '');
            this.jmFavMoveFolderId = String(this.jmFavFolderId || '0');
            this.jmFavShowMove = true;
        },
        closeJmMoveFavorite() {
            this.jmFavShowMove = false;
            this.jmFavMoveAlbumId = '';
            this.jmFavMoveTitle = '';
            this.jmFavMoveFolderId = '0';
        },
        async confirmJmMoveFavorite() {
            const aid = String(this.jmFavMoveAlbumId || '').trim();
            const fid = String(this.jmFavMoveFolderId || '').trim();
            if (!aid || !fid) return;
            if (this.jmFavFolderOpLoading) return;
            this.jmFavFolderOpLoading = true;
            try {
                const res = await fetch('/api/favorite_folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'move', album_id: aid, folder_id: fid })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Move failed');
                }
                const r = json && typeof json === 'object' ? json.result : null;
                if (r && typeof r === 'object' && String(r.status || '').toLowerCase() === 'fail') {
                    throw new Error(r.msg || json.msg || 'Move failed');
                }
                this.showToast('已移动', 'success');
                this.closeJmMoveFavorite();
                await this.loadJmFavorites(this.jmFavPage);
            } catch (e) {
                this.showToast(e.message || 'Move failed', 'error');
            } finally {
                this.jmFavFolderOpLoading = false;
            }
        },
        removeJmFavorite(item) {
            const aid = String(item && item.album_id ? item.album_id : '');
            if (!aid) return;
            this.askConfirm('取消收藏', '确定从收藏中移除该作品吗？', async () => {
                try {
                    const res = await fetch('/api/favorite/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ album_id: aid, desired_state: false })
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || (json.st && json.st !== 1001)) {
                        throw new Error(json.msg || json.detail || 'Failed');
                    }
                    const next = typeof json.is_favorite === 'boolean' ? json.is_favorite : false;
                    this.favoriteStateById = { ...(this.favoriteStateById || {}), [aid]: next };
                    this.showToast('已移除', 'success');
                    await this.loadJmFavorites(this.jmFavPage);
                } catch (e) {
                    this.showToast(e.message || 'Failed', 'error');
                }
            });
        },
        setJmLeaderboardSort(sort) {
            this.jmLeaderboardSort = String(sort || 'tf');
            this.jmLeaderboardHasMore = true;
            this.loadJmLeaderboard(1, false);
        },
        setJmLeaderboardCategory(cat) {
            this.jmLeaderboardCategory = String(cat || '0');
            this.jmLeaderboardHasMore = true;
            this.loadJmLeaderboard(1, false);
        },
        async loadJmLeaderboard(page = 1, append = false) {
            if (this.source !== 'jm') return;
            const p = Math.max(1, parseInt(page || 1));
            if (this.jmLeaderboardLoading) return;
            if (append && !this.jmLeaderboardHasMore) return;
            this.jmLeaderboardError = '';
            this.jmLeaderboardLoading = true;
            try {
                const cat = String(this.jmLeaderboardCategory || '0');
                const sort = String(this.jmLeaderboardSort || 'tf');
                const res = await fetch(`/api/v2/jm/leaderboard?category=${encodeURIComponent(cat)}&page=${p}&sort=${encodeURIComponent(sort)}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed');
                }
                const items = Array.isArray(json.data) ? json.data : [];
                const mapped = items.map(x => ({
                    album_id: x.comic_id,
                    title: x.title,
                    author: this.formatAuthor(x.author),
                    image: x.cover_url,
                    raw: x
                })).filter(x => x.album_id);
                if (append) {
                    if (!mapped.length) {
                        this.jmLeaderboardHasMore = false;
                    } else {
                        const dedup = new Map();
                        for (const it of (this.jmLeaderboardItems || [])) dedup.set(String(it.album_id), it);
                        for (const it of mapped) dedup.set(String(it.album_id), it);
                        this.jmLeaderboardItems = Array.from(dedup.values());
                    }
                } else {
                    this.jmLeaderboardHasMore = true;
                    this.jmLeaderboardItems = mapped;
                }
                this.jmLeaderboardPage = p;
            } catch (e) {
                this.jmLeaderboardError = String(e && e.message ? e.message : 'Failed to load leaderboard');
                this.showToast(this.jmLeaderboardError, 'error');
                if (!append) this.jmLeaderboardItems = [];
            } finally {
                this.jmLeaderboardLoading = false;
            }
        },
        async loadJmHistory(page = 1) {
            if (this.source !== 'jm') return;
            if (!this.isLoggedIn) return;
            const p = Math.max(1, parseInt(page || 1));
            if (this.jmHistoryLoading) return;
            this.jmHistoryError = '';
            this.jmHistoryLoading = true;
            try {
                const res = await fetch(`/api/history?page=${p}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed');
                }
                const raw = json.data || {};
                const list = raw.list || raw.data || raw.records || [];
                const items = Array.isArray(list) ? list : [];
                this.jmHistoryItems = items.map(x => ({
                    album_id: x.album_id || x.id || x.AID || '',
                    title: x.title || x.name || x.book_name || '',
                    author: this.formatAuthor(x.author || ''),
                    image: x.image || x.cover || '',
                    raw: x
                })).filter(x => x.album_id);
                this.jmHistoryPage = p;
            } catch (e) {
                this.jmHistoryError = String(e && e.message ? e.message : 'Failed to load history');
                this.showToast(this.jmHistoryError, 'error');
                this.jmHistoryItems = [];
            } finally {
                this.jmHistoryLoading = false;
            }
        },
        setJmHistoryMode(mode) {
            const m = mode === 'local' ? 'local' : 'remote';
            this.jmHistoryMode = m;
            if (this.currentTab === 'jm_history' && m === 'remote') {
                this.loadJmHistory(1);
            }
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
            const res = await fetch(`/api/v2/${this.source}/download/tasks/${this.downloadTaskId}`);
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
        getCoverUrlByAlbumId(albumId) {
            const id = String(albumId || '').trim();
            if (!id) return '';
            const domain = 'cdn-msp.jmapinodeudzn.net';
            const url = `https://${domain}/media/albums/${encodeURIComponent(id)}.jpg`;
            return this.getImageUrl(url);
        },
        handleOnlineStatus() {
            this.isOnline = navigator.onLine;
        },
        formatTimeAgo(ts) {
            const t = Number(ts || 0);
            if (!t) return '';
            const diff = Math.max(0, Date.now() - t);
            const sec = Math.floor(diff / 1000);
            if (sec < 10) return '刚刚';
            if (sec < 60) return `${sec}秒前`;
            const min = Math.floor(sec / 60);
            if (min < 60) return `${min}分钟前`;
            const hr = Math.floor(min / 60);
            if (hr < 24) return `${hr}小时前`;
            const day = Math.floor(hr / 24);
            if (day < 30) return `${day}天前`;
            const d = new Date(t);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
        },
        refreshHomeData() {
            this.fetchHomeData(true);
        },
        async resumeFromHistory(item) {
            const aid = item && item.album_id ? String(item.album_id) : '';
            const pid = item && item.photo_id ? String(item.photo_id) : '';
            const title = item && item.title ? String(item.title) : '';
            if (!aid || !pid) {
                this.showToast('历史记录不完整，无法继续阅读', 'error');
                return;
            }
            try {
                await this.viewDetails(aid);
                await this.readChapter(pid, title || 'Continue Reading');
            } catch (e) {
                this.showToast('继续阅读失败', 'error');
            }
        },
        handleScroll() {
            const y = window.scrollY || 0;
            this.showBackToTop = y > 300;
            this.homeTopbarVisible = (this.currentTab === 'home') && y > 160;
            this.tryAutoLoadMore();
        },
        tryAutoLoadMore() {
            if (this.source !== 'jm') return;
            const tab = String(this.currentTab || '');
            if (tab !== 'jm_latest' && tab !== 'jm_leaderboard') return;
            const now = Date.now();
            if (now - (this.jmAutoLoadLastAt || 0) < 800) return;
            const doc = document.documentElement;
            const nearBottom = (window.scrollY + window.innerHeight) > ((doc.scrollHeight || 0) - 700);
            if (!nearBottom) return;
            this.jmAutoLoadLastAt = now;
            if (tab === 'jm_latest') {
                if (this.jmLatestLoading) return;
                if (!this.jmLatestHasMore) return;
                if (!Array.isArray(this.jmLatestItems) || this.jmLatestItems.length === 0) return;
                this.loadJmLatest((this.jmLatestPage || 1) + 1, true);
                return;
            }
            if (tab === 'jm_leaderboard') {
                if (this.jmLeaderboardLoading) return;
                if (!this.jmLeaderboardHasMore) return;
                if (!Array.isArray(this.jmLeaderboardItems) || this.jmLeaderboardItems.length === 0) return;
                this.loadJmLeaderboard((this.jmLeaderboardPage || 1) + 1, true);
                return;
            }
        },
        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        restoreHomeScroll() {
            const top = (this.homeScrollPos > 0) ? this.homeScrollPos : 0;
            try {
                window.scrollTo({ top, left: 0, behavior: 'auto' });
            } catch (e) {
                window.scrollTo(0, top);
            }
        },
        getHomeCacheKey() {
            return this.getStorageKey('homeCache');
        },
        normalizeHomeData(data) {
            if (Array.isArray(data)) {
                return data;
            }
            if (data && typeof data === 'object') {
                return Object.entries(data).map(([title, content]) => ({
                    id: title,
                    title: title,
                    content: content
                }));
            }
            return [];
        },
        loadHomeCache() {
            const key = this.getHomeCacheKey();
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            try {
                const parsed = JSON.parse(raw);
                const ts = parsed && parsed.ts ? Number(parsed.ts) : 0;
                const data = parsed && parsed.data != null ? parsed.data : null;
                const normalized = this.normalizeHomeData(data);
                if (!normalized.length) return false;
                this.homeData = normalized;
                if (ts) this.homeLastUpdatedAt = ts;
                return true;
            } catch (e) {
                return false;
            }
        },
        saveHomeCache(rawData) {
            const key = this.getHomeCacheKey();
            try {
                localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: rawData }));
            } catch (e) {}
        },
        async fetchHomeData(force = false) {
            this.homeError = '';
            if (!force) {
                this.loadHomeCache();
            }

            const hasData = Array.isArray(this.homeData) && this.homeData.length > 0;
            this.homeLoading = !hasData;
            this.homeRefreshing = hasData || force;

            const controller = new AbortController();
            const timeoutMs = 15000;
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetch('/api/promote', { cache: 'no-store', signal: controller.signal });
                if (!res.ok) throw new Error('Failed to fetch home data');
                const raw = await res.json();
                const normalized = this.normalizeHomeData(raw);
                this.homeData = normalized;
                this.homeLastUpdatedAt = Date.now();
                this.saveHomeCache(raw);
            } catch (e) {
                const isAbort = e && e.name === 'AbortError';
                const msg = isAbort ? '请求超时' : String(e && e.message ? e.message : '加载失败');
                this.homeError = msg;
                const showHasData = Array.isArray(this.homeData) && this.homeData.length > 0;
                this.showToast(showHasData ? '推荐更新失败，已显示缓存' : '推荐加载失败', 'error');
            } finally {
                clearTimeout(timer);
                this.homeLoading = false;
                this.homeRefreshing = false;
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
        loadReadingHistory() {
            const key = this.getStorageKey('readingHistory');
            let stored = localStorage.getItem(key);
            if (!stored) {
                const legacy = localStorage.getItem('readingHistory');
                if (legacy) {
                    stored = legacy;
                    try {
                        localStorage.setItem(key, legacy);
                    } catch (e) {}
                }
            }
            if (stored) {
                try {
                    this.readingHistory = JSON.parse(stored);
                } catch (e) {
                    console.error('Failed to parse history', e);
                    this.readingHistory = {};
                }
            } else {
                this.readingHistory = {};
            }
        },
        loadLikedComments() {
            const key = this.getStorageKey('likedCommentIds');
            let stored = localStorage.getItem(key);
            if (!stored) {
                const legacy = localStorage.getItem('likedCommentIds');
                if (legacy) {
                    stored = legacy;
                    try {
                        localStorage.setItem(key, legacy);
                    } catch (e) {}
                }
            }
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    this.likedCommentIds = (parsed && typeof parsed === 'object') ? parsed : {};
                } catch (e) {
                    this.likedCommentIds = {};
                }
            } else {
                this.likedCommentIds = {};
            }
        },
        saveLikedComments() {
            try {
                localStorage.setItem(this.getStorageKey('likedCommentIds'), JSON.stringify(this.likedCommentIds || {}));
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
            const aid = album && album.album_id ? String(album.album_id) : '';
            if (!aid) return;
            if (!this.isLoggedIn) {
                this.showToast('请先在 Settings 登录 JM', 'error');
                return;
            }
            const desired = !this.isFavorite(aid);
            (async () => {
                try {
                    const res = await fetch('/api/favorite/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ album_id: aid, desired_state: desired })
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || (json.st && json.st !== 1001)) {
                        throw new Error(json.msg || json.detail || 'Failed');
                    }
                    const next = typeof json.is_favorite === 'boolean' ? json.is_favorite : desired;
                    this.favoriteStateById = { ...(this.favoriteStateById || {}), [aid]: next };
                    if (this.selectedAlbum && String(this.selectedAlbum.album_id) === aid) {
                        this.selectedAlbum.is_favorite = next;
                    }
                    if (this.currentTab === 'jm_favorites' && !next) {
                        this.jmFavItems = (this.jmFavItems || []).filter(x => String(x && x.album_id ? x.album_id : '') !== aid);
                    }
                    this.showToast(next ? '已收藏' : '已取消收藏', 'success');
                } catch (e) {
                    this.showToast(e && e.message ? e.message : 'Failed', 'error');
                }
            })();
        },
        isFavorite(albumId) {
            const id = String(albumId || '');
            if (!id) return false;
            const m = this.favoriteStateById || {};
            return m[id] === true;
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
            this.toggleFavorite(this.selectedAlbum);
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
            html.classList.remove('dark', 'theme-orange', 'theme-green', 'theme-yuuka');
            if (this.themeColor === 'orange') {
                html.classList.add('theme-orange');
            } else if (this.themeColor === 'green') {
                html.classList.add('theme-green');
            } else if (this.themeColor === 'yuuka') {
                html.classList.add('theme-yuuka');
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
            if (imageName && /^https?:\/\//i.test(imageName)) {
                return `/api/image-proxy?url=${encodeURIComponent(imageName)}`;
            }
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
        async loadAccountProfile() {
            if (!this.isLoggedIn) {
                this.accountProfile = null;
                this.accountSignature = '';
                return;
            }
            if (this.accountProfileLoading) return;
            this.accountProfileLoading = true;
            try {
                const res = await fetch(`/api/v2/jm/user/profile`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Failed to load profile');
                }
                this.accountProfile = json.data || null;
                const sig = this.accountProfile && this.accountProfile.signature ? String(this.accountProfile.signature) : '';
                if (!this.accountSignature) {
                    this.accountSignature = sig;
                }
            } catch (e) {
                this.accountProfile = null;
            } finally {
                this.accountProfileLoading = false;
            }
        },
        async accountCheckin() {
            if (!this.isLoggedIn) return;
            try {
                const res = await fetch(`/api/v2/jm/user/checkin`, { method: 'POST' });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Check-in failed');
                }
                const msg = (json.data && (json.data.message || json.data.msg)) ? (json.data.message || json.data.msg) : 'OK';
                this.showToast(String(msg), 'success');
            } catch (e) {
                this.showToast(e.message || 'Check-in failed', 'error');
            }
        },
        async updateAccountSignature() {
            const sig = (this.accountSignature || '').trim();
            if (!sig) return;
            if (!this.isLoggedIn) return;
            if (this.accountUpdating) return;
            this.accountUpdating = true;
            try {
                const res = await fetch(`/api/v2/jm/user/profile`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ signature: sig })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Update failed');
                }
                this.showToast('签名已更新', 'success');
                await this.loadAccountProfile();
            } catch (e) {
                this.showToast(e.message || 'Update failed', 'error');
            } finally {
                this.accountUpdating = false;
            }
        },
        async updateAccountPassword() {
            const oldP = (this.accountOldPassword || '').trim();
            const newP = (this.accountNewPassword || '').trim();
            if (!oldP || !newP) return;
            if (!this.isLoggedIn) return;
            if (this.accountUpdating) return;
            this.accountUpdating = true;
            try {
                const res = await fetch(`/api/v2/jm/user/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ old_password: oldP, new_password: newP })
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Update failed');
                }
                this.accountOldPassword = '';
                this.accountNewPassword = '';
                this.config.password = '';
                this.showToast('密码已更新', 'success');
            } catch (e) {
                this.showToast(e.message || 'Update failed', 'error');
            } finally {
                this.accountUpdating = false;
            }
        },
        async cleanupCache() {
            if (this.cacheCleanupLoading) return;
            this.cacheCleanupLoading = true;
            try {
                const res = await fetch('/api/v2/cache/cleanup', { method: 'POST' });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    throw new Error(json.msg || json.detail || 'Cleanup failed');
                }
                const d = json.data || {};
                this.showToast(`已清理：work ${d.removed_work || 0}，目录 ${d.removed_dirs || 0}`, 'success');
            } catch (e) {
                this.showToast(e.message || 'Cleanup failed', 'error');
            } finally {
                this.cacheCleanupLoading = false;
            }
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
                if (data && data.st && data.st !== 1001) {
                    throw new Error(data.msg || 'Login failed');
                }
                
                this.loginMsg = data.message || data.msg || 'OK';
                this.loginMsgType = 'success';

                try {
                    localStorage.setItem('savedUsername', String(this.config.username || ''));
                    if (this.accountFeatures && this.accountFeatures.savePassword) {
                        this.setSavedPassword(String(this.config.password || ''));
                    } else {
                        this.setSavedPassword('');
                    }
                } catch (e) {}
                
                setTimeout(() => {
                    this.checkLoginStatus().finally(() => {
                        this.loadAccountProfile();
                        if (this.isLoggedIn && this.accountFeatures && this.accountFeatures.autoCheckin) {
                            this.accountCheckin();
                        }
                    });
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
                    this.accountProfile = null;
                    this.accountSignature = '';
                    this.accountOldPassword = '';
                    this.accountNewPassword = '';
                    this.checkLoginStatus();
                } catch (e) {
                    this.showToast('Logout failed', 'error');
                }
            });
        },
        async search(page = 1) {
            const q0 = (this.searchQuery || '').trim();
            if (!q0 && String(this.jmSearchCategory || '0') === '0') return;
            if (typeof page !== 'number') page = 1;
            this.loading = true;
            this.currentTab = 'search';
            this.currentPage = page;
            try {
                if (!q0 && String(this.jmSearchCategory || '0') !== '0') {
                    const cat = String(this.jmSearchCategory || '0');
                    const res = await fetch(`/api/v2/jm/leaderboard?category=${encodeURIComponent(cat)}&page=${this.currentPage}&sort=mr`);
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || (data.st && data.st !== 1001)) throw new Error(data?.msg || data?.detail || 'Search failed');
                    const items = Array.isArray(data.data) ? data.data : [];
                    this.searchResults = items.map(x => ({
                        album_id: x.comic_id,
                        title: x.title,
                        author: this.formatAuthor(x.author),
                        image: x.cover_url,
                        category: this.jmSearchCategoryTitle || '',
                        source: 'jm'
                    })).filter(x => x.album_id);
                } else {
                    const res = await fetch(`/api/search?q=${encodeURIComponent(this.searchQuery)}&page=${this.currentPage}`);
                    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
                    const data = await res.json();
                    let items = data.results || [];
                    if (String(this.jmSearchCategory || '0') !== '0') {
                        const catTitle = String(this.jmSearchCategoryTitle || '').trim();
                        const catId = String(this.jmSearchCategory || '').trim();
                        if (catTitle) {
                            items = (items || []).filter(it => {
                                const c = String(it && it.category ? it.category : '');
                                return c === catId || c === catTitle || c.includes(catTitle);
                            });
                        }
                    }
                    this.searchResults = (items || []).map(it => {
                        if (!it || typeof it !== 'object') return it;
                        return { ...it, author: this.formatAuthor(it.author) };
                    });
                }
            } catch (e) {
                this.showToast('Search failed', 'error');
            } finally {
                this.loading = false;
            }
        },
        changePage(delta) {
            const newPage = this.currentPage + delta;
            if (newPage < 1) return;
            this.search(newPage);
        },
        async viewDetails(albumId) {
            this.selectedAlbum = null;
            this.alsoViewedItems = [];
            this.alsoViewedLoading = false;
            this.currentTab = 'detail';
            try {
                const res = await fetch(`/api/album/${albumId}`);
                if (!res.ok) throw new Error('Failed');
                this.selectedAlbum = await res.json();
                try {
                    if (this.selectedAlbum && typeof this.selectedAlbum === 'object') {
                        this.selectedAlbum.author = this.formatAuthor(this.selectedAlbum.author);
                    }
                } catch (e) {}
                try {
                    const aid = String(this.selectedAlbum && this.selectedAlbum.album_id ? this.selectedAlbum.album_id : albumId);
                    const fav = !!(this.selectedAlbum && this.selectedAlbum.is_favorite);
                    if (aid) {
                        this.favoriteStateById = { ...(this.favoriteStateById || {}), [aid]: fav };
                    }
                } catch (e) {}
                this.loadAlsoViewed(String(this.selectedAlbum?.album_id || albumId)).catch(() => {});
                this.commentItems = [];
                this.commentPage = 1;
                this.commentTotal = 0;
                this.commentTotalPages = 1;
                this.commentText = '';
                this.commentReplyTo = '';
                this.revealedSpoilers = {};
                this.commentSpoilerIds = [];
                this.revealedSpoilerCount = 0;
                this.fetchComments(1);
            } catch (e) {
                this.showToast('Could not load details', 'error');
                this.currentTab = 'search';
            }
        },
        async loadAlsoViewed(comicId) {
            const id = String(comicId || '').trim();
            if (!id) return;
            if (this.alsoViewedLoading) return;
            this.alsoViewedLoading = true;
            try {
                const res = await fetch(`/api/v2/jm/also_viewed/${encodeURIComponent(id)}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok || (json.st && json.st !== 1001)) {
                    this.alsoViewedItems = [];
                    return;
                }
                const items = Array.isArray(json.data) ? json.data : [];
                this.alsoViewedItems = items.map(x => ({
                    album_id: x.comic_id,
                    title: x.title,
                    author: this.formatAuthor(x.author),
                    image: x.cover_url,
                    source: 'jm'
                })).filter(x => x.album_id);
            } catch (e) {
                this.alsoViewedItems = [];
            } finally {
                this.alsoViewedLoading = false;
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
            const prev = !!(this.revealedSpoilers && this.revealedSpoilers[id]);
            const next = !prev;
            this.revealedSpoilers = { ...this.revealedSpoilers, [id]: next };
            if (next) {
                this.revealedSpoilerCount = (parseInt(this.revealedSpoilerCount) || 0) + 1;
            } else {
                this.revealedSpoilerCount = Math.max(0, (parseInt(this.revealedSpoilerCount) || 0) - 1);
            }
        },
        revealAllSpoilers() {
            const ids = Array.isArray(this.commentSpoilerIds) ? this.commentSpoilerIds : [];
            if (!ids.length) return;
            const next = { ...(this.revealedSpoilers || {}) };
            for (const id of ids) {
                if (!id) continue;
                next[id] = true;
            }
            this.revealedSpoilers = next;
            this.revealedSpoilerCount = ids.length;
        },
        hideAllSpoilers() {
            this.revealedSpoilers = {};
            this.revealedSpoilerCount = 0;
        },
        toggleAllSpoilers() {
            const ids = Array.isArray(this.commentSpoilerIds) ? this.commentSpoilerIds : [];
            if (!ids.length) return;
            const allShown = (parseInt(this.revealedSpoilerCount) || 0) >= ids.length;
            if (allShown) {
                this.hideAllSpoilers();
            } else {
                this.revealAllSpoilers();
            }
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
                const spoilerIds = [];
                for (const c of list) {
                    if (!c || typeof c !== 'object') continue;
                    if (c.spoiler !== '1') continue;
                    const cid = String(c.CID || '').trim();
                    if (cid) spoilerIds.push(cid);
                }
                this.commentSpoilerIds = spoilerIds;
                this.revealedSpoilers = {};
                this.revealedSpoilerCount = 0;
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
                this.showToast('Comment posted', 'success');
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
            const initial = Math.max(1, parseInt((this.readerSettings && this.readerSettings.initial) ? this.readerSettings.initial : 4));
            this.readerLoadLimit = initial;
            this.readerBatchEndIndex = initial - 1;
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
                try {
                    const total = (this.readingChapter && Array.isArray(this.readingChapter.images)) ? this.readingChapter.images.length : 0;
                    const ini = Math.max(1, parseInt((this.readerSettings && this.readerSettings.initial) ? this.readerSettings.initial : 4));
                    this.readerLoadLimit = total > 0 ? Math.min(total, ini) : ini;
                    this.readerBatchEndIndex = Math.max(0, this.readerLoadLimit - 1);
                } catch (e) {}
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
                    comic_id: String(this.selectedAlbum.album_id),
                    comic_title: String(this.selectedAlbum.title || ''),
                    status: 'queued',
                    stage: 'queued',
                    message: 'Queuing...',
                    percent: 0,
                    downloaded_images: 0,
                    total_images: 0,
                };

                const res = await fetch(`/api/v2/${this.source}/download/tasks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        comic_id: String(this.selectedAlbum.album_id),
                        comic_title: String(this.selectedAlbum.title || ''),
                        chapters,
                        include_all: false
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
