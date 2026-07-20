/**
 * Doc Reader — pure utilities (no DOM app state).
 * Loaded before script.js; defines globals used by the main app.
 */
/* global authToken */

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

/** Build proxy URL for remote images; reads global authToken when present. */
function remoteImageProxyUrl(url) {
    const token = (typeof authToken !== 'undefined' && authToken)
        ? `&token=${encodeURIComponent(authToken)}`
        : '';
    return `/api/remote-image?url=${encodeURIComponent(url)}${token}`;
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
