/**
 * Doc Reader — pure utilities (no DOM app state).
 * Loaded before script.js; defines globals used by the main app.
 */
/* global authToken */

/** Shared API base for desktop client (declared once; used by script/auth/pairing). */
var API_V1 = '/api/v1';

function isTouchInteractionMode() {
    return window.innerWidth <= 768
        || window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

function isImageExtension(ext) {
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext);
}

function isHttpUrl(value) {
    return value && (value.startsWith('http://') || value.startsWith('https://'));
}

/** Build proxy URL for remote images; cookie/Authorization preferred over query token. */
function remoteImageProxyUrl(url) {
    return `/api/v1/remote-image?url=${encodeURIComponent(url)}`;
}

/** Asset URL for root-relative image paths. */
function assetUrl(rootId, relPath) {
    return `/api/v1/assets?root_id=${encodeURIComponent(rootId)}&path=${encodeURIComponent(relPath)}`;
}

/** Join root-relative directory with a relative link target. */
function joinRootRelative(baseDir, href) {
    if (!href) return baseDir || '';
    if (href.startsWith('/')) return href.replace(/^\/+/, '');
    const baseParts = (baseDir || '').split('/').filter(Boolean);
    const hrefParts = href.split('/');
    for (const part of hrefParts) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
            baseParts.pop();
            continue;
        }
        baseParts.push(part);
    }
    return baseParts.join('/');
}

/** Display path: root name + relative path. */
function displayDocPath(rootName, relPath) {
    if (!relPath) return rootName || '';
    return rootName ? `${rootName}/${relPath}` : relPath;
}

/** Simplify absolute home paths for display: /home/user/foo → ~/foo */
function simplifyPath(path) {
    const homePrefix = '/home/';
    if (path && path.startsWith(homePrefix)) {
        const parts = path.split('/');
        if (parts.length >= 4) {
            return `~/${parts.slice(3).join('/')}`;
        }
    }
    return path;
}

function isApplePlatform() {
    const platform = navigator.platform || '';
    const ua = navigator.userAgent || '';
    return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua);
}

function formatShareTime(value) {
    if (!value) return '永不过期';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function apiErrorMessage(data, fallback) {
    if (!data) return fallback;
    if (data.error && typeof data.error === 'object') {
        return data.error.message || fallback;
    }
    if (typeof data.error === 'string') return data.error;
    return fallback;
}
