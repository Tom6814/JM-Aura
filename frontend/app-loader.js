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
            const res = await fetch(url, { cache: 'force-cache' });
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

    const init = async () => {
        try {
            // 1. Load Shell (Layout & Navigation)
            const shellRes = await fetch('/app-shell.html', { cache: 'force-cache' });
            if(!shellRes.ok) throw new Error('Shell load failed');
            appEl.innerHTML = await shellRes.text();

            // 2. Load View Fragments in parallel
            const views = [
                { id: 'view-home', url: '/views/home.html' },
                { id: 'view-search', url: '/views/search.html' },
                { id: 'view-favorites', url: '/views/favorites.html' },
                { id: 'view-detail', url: '/views/detail.html' },
                { id: 'view-config', url: '/views/config.html' },
                { id: 'view-reader', url: '/views/reader.html' }
            ];

            await Promise.all(views.map(v => loadHtml(v.url, v.id)));

            // 3. Start Vue App
            await loadScript('/app.js');
        } catch (e) {
            console.error('Failed to load app:', e);
            appEl.innerHTML = '<div class="p-4 text-red-500 text-center mt-10">Application loading failed. Please refresh.</div>';
        }
    };

    init();
})();
