/**
 * Doc Reader — theme + shortcut label helpers.
 * Depends on utils.js for isApplePlatform when available (also defined below fallback).
 */

function isDarkThemeActive() {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'dark') return true;
    if (current === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyHighlightTheme() {
    const light = document.getElementById('hljs-theme-light');
    const dark = document.getElementById('hljs-theme-dark');
    if (!light || !dark) return;

    const darkMode = isDarkThemeActive();
    light.disabled = darkMode;
    dark.disabled = !darkMode;
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
    applyHighlightTheme();

    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (!localStorage.getItem('theme')) {
                applyHighlightTheme();
            }
        });
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let newTheme;
    if (current === 'dark') {
        newTheme = 'light';
    } else if (current === 'light') {
        newTheme = 'dark';
    } else {
        newTheme = systemDark ? 'light' : 'dark';
    }

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    applyHighlightTheme();
}

function initShortcutHints() {
    const apple = (typeof isApplePlatform === 'function')
        ? isApplePlatform()
        : /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
    const label = apple ? '⌘K' : 'Ctrl+K';
    document.querySelectorAll('kbd.shortcut-mod-k').forEach((elKbd) => {
        elKbd.textContent = label;
    });
}
