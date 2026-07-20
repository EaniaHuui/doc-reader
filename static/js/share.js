/**
 * Doc Reader — share links UI (globals: el, currentPath, currentRootId, authFetch, ...)
 */
// ========================================
// Share Links
// ========================================

async function openShareModal() {
    if (!currentPath || !currentRootId) return;

    el.shareError.style.display = 'none';
    el.shareError.textContent = '';
    el.shareCurrentFile.textContent = displayDocPath(
        (rootsById[currentRootId] && rootsById[currentRootId].name) || '',
        currentPath
    );
    el.shareModal.classList.add('visible');
    await loadShareLinks();
}

function closeShareModal() {
    el.shareModal.classList.remove('visible');
}

async function loadShareLinks() {
    if (!currentPath || !currentRootId) return;

    el.shareLinks.innerHTML = '<div class="share-empty">加载中...</div>';

    try {
        const qs = new URLSearchParams({
            root_id: currentRootId,
            path: currentPath,
        });
        const response = await authFetch(`/api/share-links?${qs}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(apiErrorMessage(data, '加载分享链接失败'));
        }

        shareLinksCache = data;
        renderShareLinks();
    } catch (error) {
        console.error('Failed to load share links:', error);
        el.shareLinks.innerHTML = '<div class="share-empty">加载分享链接失败</div>';
    }
}

async function createShareLink() {
    if (!currentPath || !currentRootId) return;

    el.shareError.style.display = 'none';
    el.createShareBtn.disabled = true;
    el.createShareBtn.textContent = '生成中...';

    const payload = {
        root_id: currentRootId,
        path: currentPath,
        expires_in_hours: Number(el.shareExpiry.value),
        max_views: el.shareMaxViews.value ? Number(el.shareMaxViews.value) : null
    };

    try {
        const response = await authFetch('/api/share-links', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (!response.ok) {
            el.shareError.textContent = apiErrorMessage(data, '创建分享链接失败');
            el.shareError.style.display = 'block';
            return;
        }

        shareLinksCache.unshift(data);
        renderShareLinks();
        copyText(data.url, '分享链接已复制');
    } catch (error) {
        console.error('Failed to create share link:', error);
        el.shareError.textContent = '创建分享链接失败';
        el.shareError.style.display = 'block';
    } finally {
        el.createShareBtn.disabled = false;
        el.createShareBtn.textContent = '生成只读分享链接';
    }
}

function renderShareLinks() {
    if (!shareLinksCache.length) {
        el.shareLinks.innerHTML = '<div class="share-empty">还没有分享链接</div>';
        return;
    }

    el.shareLinks.innerHTML = '';
    shareLinksCache.forEach(link => {
        const item = document.createElement('div');
        item.className = `share-link-item${link.active ? '' : ' inactive'}`;

        const info = document.createElement('div');
        info.className = 'share-link-info';

        const url = document.createElement('div');
        url.className = 'share-link-url';
        url.textContent = link.url;

        const meta = document.createElement('div');
        meta.className = 'share-link-meta';
        const viewsText = link.max_views
            ? `${link.view_count}/${link.max_views} 次访问`
            : `${link.view_count} 次访问`;
        const statusText = link.active ? '有效' : '已失效';
        meta.textContent = `${statusText} · 过期 ${formatShareTime(link.expires_at)} · ${viewsText}`;

        info.appendChild(url);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'share-link-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'icon-btn';
        copyBtn.title = '复制分享链接';
        copyBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.addEventListener('click', () => copyText(link.url, '分享链接已复制'));
        actions.appendChild(copyBtn);

        if (link.active) {
            const revokeBtn = document.createElement('button');
            revokeBtn.className = 'icon-btn danger';
            revokeBtn.title = '撤销分享链接';
            revokeBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            `;
            revokeBtn.addEventListener('click', () => revokeShareLink(link.id));
            actions.appendChild(revokeBtn);
        }

        item.appendChild(info);
        item.appendChild(actions);
        el.shareLinks.appendChild(item);
    });
}

async function revokeShareLink(linkId) {
    try {
        const response = await authFetch(`/api/share-links/${encodeURIComponent(linkId)}`, {
            method: 'DELETE'
        });
        const data = await response.json();

        if (!response.ok) {
            showToast(apiErrorMessage(data, '撤销分享链接失败'));
            return;
        }

        shareLinksCache = shareLinksCache.map(link => link.id === linkId ? data.link : link);
        renderShareLinks();
        showToast('分享链接已撤销');
    } catch (error) {
        console.error('Failed to revoke share link:', error);
        showToast('撤销分享链接失败');
    }
}
