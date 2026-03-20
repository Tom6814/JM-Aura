(() => {
    const appEl = document.getElementById('app');

    const loadScript = (src) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.body.appendChild(script);
        });
    };

    const loadHtml = async (url, targetId) => {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const html = await res.text();
            if (targetId) {
                const el = document.getElementById(targetId);
                if (el) el.outerHTML = html;
            }
        } catch (e) {
            console.error(`Failed to load ${url}:`, e);
        }
    };

    const loadAppBundle = async () => {
        try {
            const res = await fetch('/app.bundle.json');
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const json = await res.json().catch(() => ({}));
            const shell = json && typeof json === 'object' ? json.shell : '';
            const views = json && typeof json === 'object' ? json.views : null;
            if (typeof shell === 'string' && shell.trim()) {
                appEl.innerHTML = shell;
            } else {
                return false;
            }
            if (views && typeof views === 'object') {
                for (const [filename, html] of Object.entries(views)) {
                    if (typeof html !== 'string' || !html.trim()) continue;
                    const id = 'view-' + String(filename).replace(/\.html$/i, '').replace(/_/g, '-');
                    const el = document.getElementById(id);
                    if (el) el.outerHTML = html;
                }
            }
            return true;
        } catch (e) {
            console.error('Failed to load app bundle:', e);
            return false;
        }
    };

    const loadViewBundle = async () => {
        try {
            const res = await fetch('/views.bundle.json');
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const json = await res.json().catch(() => ({}));
            const views = json && typeof json === 'object' ? json.views : null;
            if (!views || typeof views !== 'object') return false;
            for (const [filename, html] of Object.entries(views)) {
                if (typeof html !== 'string' || !html.trim()) continue;
                const id = 'view-' + String(filename).replace(/\.html$/i, '').replace(/_/g, '-');
                const el = document.getElementById(id);
                if (el) el.outerHTML = html;
            }
            return true;
        } catch (e) {
            console.error('Failed to load views bundle:', e);
            return false;
        }
    };

    const init = async () => {
        try {
            // 1. Load Shell + Views
            const bundleOk = await loadAppBundle();
            if (!bundleOk) {
                const shellRes = await fetch('/app-shell.html');
                if(!shellRes.ok) throw new Error('Shell load failed');
                appEl.innerHTML = await shellRes.text();

                // 2. Load View Fragments (required before Vue mount)
                const ok = await loadViewBundle();
                if (!ok) {
                    const views = [
                        { id: 'view-home', url: '/views/home.html' },
                        { id: 'view-search', url: '/views/search.html' },
                        { id: 'view-detail', url: '/views/detail.html' },
                        { id: 'view-config', url: '/views/config.html' },
                        { id: 'view-reader', url: '/views/reader.html' },
                        { id: 'view-jm-latest', url: '/views/jm_latest.html' },
                        { id: 'view-jm-categories', url: '/views/jm_categories.html' },
                        { id: 'view-jm-leaderboard', url: '/views/jm_leaderboard.html' },
                        { id: 'view-jm-random', url: '/views/jm_random.html' },
                        { id: 'view-jm-history', url: '/views/jm_history.html' },
                        { id: 'view-jm-favorites', url: '/views/jm_favorites.html' }
                    ];
                    await Promise.all(views.map(v => loadHtml(v.url, v.id)));
                }
            }

            // 3. Start Vue App
            await loadScript('/app.js');
        } catch (e) {
            console.error('Failed to load app:', e);
            appEl.innerHTML = '<div class="p-4 text-red-500 text-center mt-10">Application loading failed. Please refresh.</div>';
        }
    };

    init();
})();
