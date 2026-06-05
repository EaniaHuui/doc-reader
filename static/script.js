/**
 * Notion-Style Doc Reader
 * Clean, minimal, functional
 */

// State
let currentPath = null;
let currentRawContent = null;  // Store raw markdown content
let searchTimeout = null;
let isSearchOpen = false;
let sidebarCollapsed = false;
let isResizing = false;
let showEmptyDirectories = false;  // Whether to show empty directories
let showTxtFiles = false;           // Whether to show .txt files
let showJsonFiles = false;          // Whether to show .json files
let allExpanded = false;            // Whether all directories are expanded
let sourceViewMode = 'normal';      // 'normal', 'source', 'split'
let isEditMode = false;             // Edit mode state
let shareLinksCache = [];

// Document search state
let docSearchMatches = [];          // Array of match elements
let docSearchIndex = 0;             // Current match index
let docSearchQuery = '';            // Current search query
let docSearchHighlightSpans = [];   // Array of highlight spans

function isTouchInteractionMode() {
    return window.innerWidth <= 768 || window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

// Helper: Simplify path for display
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

// Auth State
let authToken = null;
let authUsername = null;
let authEnabled = false;

// DOM Elements
const $ = (id) => document.getElementById(id);

const el = {
    sidebar: $('sidebar'),
    main: $('main'),
    resizeHandle: $('resizeHandle'),
    workspaceHome: $('workspaceHome'),
    collapseSidebar: $('collapseSidebar'),
    expandSidebar: $('expandSidebar'),
    treeItems: $('treeItems'),
    treeFilterBtn: $('treeFilterBtn'),
    txtFilterBtn: $('txtFilterBtn'),
    jsonFilterBtn: $('jsonFilterBtn'),
    expandAllBtn: $('expandAllBtn'),
    welcome: $('welcome'),
    document: $('document'),
    docTitle: $('docTitle'),
    docPath: $('docPath'),
    docTime: $('docTime'),
    docContent: $('docContent'),
    docContentSingle: $('docContentSingle'),
    docSource: $('docSource'),
    docSourceSingle: $('docSourceSingle'),
    sourceToggle: $('sourceToggle'),
    copyPath: $('copyPath'),
    toc: $('toc'),
    tocToggle: $('tocToggle'),
    tocList: $('tocList'),
    tocOverlay: $('tocOverlay'),
    searchModal: $('searchModal'),
    searchTrigger: $('searchTrigger'),
    welcomeSearch: $('welcomeSearch'),
    searchInput: $('searchInput'),
    searchResults: $('searchResults'),
    themeToggle: $('themeToggle'),
    breadcrumb: $('breadcrumb'),
    toast: $('toast'),
    // Directory config elements
    dirConfigBtn: $('dirConfigBtn'),
    dirConfigModal: $('dirConfigModal'),
    closeDirConfig: $('closeDirConfig'),
    dirList: $('dirList'),
    dirAddBtn: $('dirAddBtn'),
    dirSaveBtn: $('dirSaveBtn'),
    dirCancelBtn: $('dirCancelBtn'),
    addDirModal: $('addDirModal'),
    closeAddDir: $('closeAddDir'),
    addDirForm: $('addDirForm'),
    dirName: $('dirName'),
    dirPath: $('dirPath'),
    addDirCancelBtn: $('addDirCancelBtn'),
    addDirConfirmBtn: $('addDirConfirmBtn'),
    dirError: $('dirError'),
    // Auth elements
    authBtn: $('authBtn'),
    logoutConfirmModal: $('logoutConfirmModal'),
    logoutCancelBtn: $('logoutCancelBtn'),
    logoutConfirmBtn: $('logoutConfirmBtn'),
    loginModal: $('loginModal'),
    closeLogin: $('closeLogin'),
    loginForm: $('loginForm'),
    loginUsername: $('loginUsername'),
    loginPassword: $('loginPassword'),
    loginBtn: $('loginBtn'),
    loginError: $('loginError'),
    refreshBtn: $('refreshBtn'),
    shareBtn: $('shareBtn'),
    shareModal: $('shareModal'),
    closeShare: $('closeShare'),
    shareCurrentFile: $('shareCurrentFile'),
    shareExpiry: $('shareExpiry'),
    shareMaxViews: $('shareMaxViews'),
    createShareBtn: $('createShareBtn'),
    shareLinks: $('shareLinks'),
    shareError: $('shareError'),
    // Delete elements
    deleteBtn: $('deleteBtn'),
    deleteConfirmModal: $('deleteConfirmModal'),
    closeDeleteConfirm: $('closeDeleteConfirm'),
    deleteCancelBtn: $('deleteCancelBtn'),
    deleteConfirmBtn: $('deleteConfirmBtn'),
    deleteFileName: $('deleteFileName'),
    deleteFilePath: $('deleteFilePath'),
    // Delete directory elements
    deleteDirConfirmModal: $('deleteDirConfirmModal'),
    closeDeleteDirConfirm: $('closeDeleteDirConfirm'),
    deleteDirCancelBtn: $('deleteDirCancelBtn'),
    deleteDirConfirmBtn: $('deleteDirConfirmBtn'),
    deleteDirName: $('deleteDirName'),
    deleteDirPath: $('deleteDirPath'),
    // Edit mode elements
    editBtn: $('editBtn'),
    saveBtn: $('saveBtn'),
    cancelBtn: $('cancelBtn'),
    docEditor: $('docEditor'),
    docEditorSplit: $('docEditorSplit'),
    docPreview: $('docPreview'),
    documentEditSplitView: $('documentEditSplitView'),
    contentWrapper: document.querySelector('.content-wrapper'),
    topbar: document.querySelector('.topbar'),
    // Document search elements
    docSearchToggle: $('docSearchToggle'),
    docSearchBar: $('docSearchBar'),
    docSearchInput: $('docSearchInput'),
    docSearchCount: $('docSearchCount'),
    docSearchPrev: $('docSearchPrev'),
    docSearchNext: $('docSearchNext'),
    docSearchClose: $('docSearchClose'),
    // Create file modal elements
    createFileModal: $('createFileModal'),
    closeCreateFile: $('closeCreateFile'),
    createFileForm: $('createFileForm'),
    createFileDirPath: $('createFileDirPath'),
    createFileName: $('createFileName'),
    createFileError: $('createFileError'),
    createFileCancelBtn: $('createFileCancelBtn'),
    createFileConfirmBtn: $('createFileConfirmBtn'),
    // Create directory modal elements
    createDirModal: $('createDirModal'),
    closeCreateDir: $('closeCreateDir'),
    createDirForm: $('createDirForm'),
    createDirParentPath: $('createDirParentPath'),
    createDirName: $('createDirName'),
    createDirError: $('createDirError'),
    createDirCancelBtn: $('createDirCancelBtn'),
    createDirConfirmBtn: $('createDirConfirmBtn')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initSidebarWidth();
    initTreeFilter();
    initFileFilters();
    checkAuthStatus().then(() => {
        loadDirectories();
        // Check URL for file parameter
        const urlParams = new URLSearchParams(window.location.search);
        const fileParam = urlParams.get('file');
        if (fileParam) {
            loadFile(decodeURIComponent(fileParam));
        }
    });
    setupEventListeners();
    initTheme();
});

// Event Listeners
function setupEventListeners() {
    // Auth
    el.authBtn.addEventListener('click', handleAuthClick);
    el.logoutCancelBtn.addEventListener('click', closeLogoutConfirm);
    el.logoutConfirmModal.querySelector('.modal-backdrop').addEventListener('click', closeLogoutConfirm);
    el.logoutConfirmBtn.addEventListener('click', confirmLogout);
    el.closeLogin.addEventListener('click', () => {
        // Only allow closing if not auth required or already authenticated
        if (!authEnabled || authToken) {
            closeLoginModal();
        }
    });
    el.loginModal.querySelector('.modal-backdrop').addEventListener('click', () => {
        // Only allow closing if not auth required or already authenticated
        if (!authEnabled || authToken) {
            closeLoginModal();
        }
    });
    el.loginForm.addEventListener('submit', handleLogin);

    // Home button
    el.workspaceHome.addEventListener('click', goHome);

    // Sidebar toggle
    el.collapseSidebar.addEventListener('click', toggleSidebar);
    el.expandSidebar.addEventListener('click', () => {
        el.sidebar.classList.remove('collapsed');
        el.sidebar.classList.add('open');
        sidebarCollapsed = false;
    });

    // Sidebar resize
    el.resizeHandle.addEventListener('mousedown', startResize);
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);

    // TOC toggle
    el.tocToggle.addEventListener('click', toggleTOC);
    el.tocOverlay.addEventListener('click', closeTOC);

    // Source toggle
    el.sourceToggle.addEventListener('click', toggleSourceView);
    el.refreshBtn.addEventListener('click', refreshCurrentFile);

    // Delete
    el.deleteBtn.addEventListener('click', openDeleteConfirm);
    el.deleteCancelBtn.addEventListener('click', closeDeleteConfirm);
    el.deleteConfirmModal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteConfirm);
    el.closeDeleteConfirm.addEventListener('click', closeDeleteConfirm);
    el.deleteConfirmBtn.addEventListener('click', confirmDelete);

    // Share
    el.shareBtn.addEventListener('click', openShareModal);
    el.closeShare.addEventListener('click', closeShareModal);
    el.shareModal.querySelector('.modal-backdrop').addEventListener('click', closeShareModal);
    el.createShareBtn.addEventListener('click', createShareLink);

    // Delete directory
    el.deleteDirCancelBtn.addEventListener('click', closeDeleteDirConfirm);
    el.deleteDirConfirmModal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteDirConfirm);
    el.closeDeleteDirConfirm.addEventListener('click', closeDeleteDirConfirm);
    el.deleteDirConfirmBtn.addEventListener('click', confirmDeleteDir);

    // Create file modal
    el.closeCreateFile.addEventListener('click', closeCreateFileModal);
    el.createFileModal.querySelector('.modal-backdrop').addEventListener('click', closeCreateFileModal);
    el.createFileCancelBtn.addEventListener('click', closeCreateFileModal);
    el.createFileConfirmBtn.addEventListener('click', confirmCreateFile);
    el.createFileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        confirmCreateFile();
    });

    // Create directory modal
    el.closeCreateDir.addEventListener('click', closeCreateDirModal);
    el.createDirModal.querySelector('.modal-backdrop').addEventListener('click', closeCreateDirModal);
    el.createDirCancelBtn.addEventListener('click', closeCreateDirModal);
    el.createDirConfirmBtn.addEventListener('click', confirmCreateDir);
    el.createDirForm.addEventListener('submit', (e) => {
        e.preventDefault();
        confirmCreateDir();
    });

    // Search
    el.searchTrigger.addEventListener('click', openSearch);
    el.welcomeSearch.addEventListener('click', openSearch);
    el.searchModal.querySelector('.modal-backdrop').addEventListener('click', closeSearch);
    el.searchInput.addEventListener('input', handleSearchInput);

    // Theme toggle
    el.themeToggle.addEventListener('click', toggleTheme);

    // Directory config
    el.dirConfigBtn.addEventListener('click', openDirConfig);
    el.closeDirConfig.addEventListener('click', closeDirConfig);
    el.dirConfigModal.querySelector('.modal-backdrop').addEventListener('click', closeDirConfig);
    el.dirAddBtn.addEventListener('click', openAddDir);
    el.dirCancelBtn.addEventListener('click', closeDirConfig);
    el.dirSaveBtn.addEventListener('click', saveDirectories);
    el.closeAddDir.addEventListener('click', closeAddDir);
    el.addDirModal.querySelector('.modal-backdrop').addEventListener('click', closeAddDir);
    el.addDirCancelBtn.addEventListener('click', closeAddDir);
    el.addDirConfirmBtn.addEventListener('click', addDirectory);

    // Tree filter
    el.treeFilterBtn.addEventListener('click', toggleTreeFilter);
    el.txtFilterBtn.addEventListener('click', toggleTxtFilter);
    el.jsonFilterBtn.addEventListener('click', toggleJsonFilter);
    el.expandAllBtn.addEventListener('click', toggleExpandAll);

    // Copy path
    el.copyPath.addEventListener('click', copyPath);

    // Edit mode
    el.editBtn.addEventListener('click', enterEditMode);
    el.saveBtn.addEventListener('click', saveAndExitEditMode);
    el.cancelBtn.addEventListener('click', exitEditMode);

    // Document search
    el.docSearchToggle.addEventListener('click', toggleDocSearch);
    el.docSearchInput.addEventListener('input', handleDocSearchInput);
    el.docSearchInput.addEventListener('keydown', handleDocSearchKeydown);
    el.docSearchPrev.addEventListener('click', () => navigateDocSearch(-1));
    el.docSearchNext.addEventListener('click', () => navigateDocSearch(1));
    el.docSearchClose.addEventListener('click', closeDocSearch);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);
}

// Keyboard Shortcuts
function handleKeyboard(e) {
    // Cmd/Ctrl + K - Open search (file search)
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
    }

    // Ctrl/Cmd + F - Open document search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        toggleDocSearch();
    }

    // Cmd/Ctrl + \ - Toggle sidebar
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
    }

    // Cmd/Ctrl + S - Save file (in edit mode)
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (isEditMode) {
            e.preventDefault();
            saveAndExitEditMode();
        }
    }

    // Escape - Close modals or exit edit mode
    if (e.key === 'Escape') {
        // Exit edit mode first
        if (isEditMode) {
            exitEditMode();
            return;
        }

        if (isSearchOpen) {
            closeSearch();
        }
        // Only close login modal if auth is not required or already authenticated
        if (el.loginModal.classList.contains('visible') && (!authEnabled || authToken)) {
            closeLoginModal();
        }
        // Close delete confirm modal
        if (el.deleteConfirmModal.classList.contains('visible')) {
            closeDeleteConfirm();
        }
        // Close delete directory confirm modal
        if (el.deleteDirConfirmModal.classList.contains('visible')) {
            closeDeleteDirConfirm();
        }
    }
}

// ========================================
// Authentication
// ========================================

async function checkAuthStatus() {
    try {
        // 先从 localStorage 读取 token
        const savedToken = localStorage.getItem('authToken');
        if (savedToken) {
            authToken = savedToken;
        }

        const response = await authFetch('/api/auth/status');
        const data = await response.json();

        authEnabled = data.enabled;

        if (data.authenticated) {
            authUsername = data.username;
            updateAuthUI(true);
        } else {
            authToken = null;
            authUsername = null;
            localStorage.removeItem('authToken');
            updateAuthUI(false);

            if (authEnabled) {
                openLoginModal();
            }
        }
    } catch (error) {
        console.error('Failed to check auth status:', error);
        authEnabled = false;
        updateAuthUI(false);
    }
}

function updateAuthUI(authenticated) {
    if (authenticated) {
        el.authBtn.classList.add('authenticated');
        el.authBtn.querySelector('.auth-username').textContent = authUsername;
    } else {
        el.authBtn.classList.remove('authenticated');
    }
}

function handleAuthClick() {
    if (authToken) {
        openLogoutConfirm();
    } else {
        openLoginModal();
    }
}

function openLogoutConfirm() {
    el.logoutConfirmModal.classList.add('visible');
}

function closeLogoutConfirm() {
    el.logoutConfirmModal.classList.remove('visible');
}

function confirmLogout() {
    closeLogoutConfirm();
    logout();
}

function openLoginModal() {
    el.loginModal.classList.add('visible');
    el.loginUsername.focus();

    // Hide close button and disable backdrop click when auth is enabled
    if (authEnabled) {
        el.loginModal.classList.add('auth-required');
    } else {
        el.loginModal.classList.remove('auth-required');
    }
}

function closeLoginModal() {
    // Don't allow closing if auth is enabled and not authenticated
    if (authEnabled && !authToken) {
        return;
    }

    el.loginModal.classList.remove('visible');
    el.loginForm.reset();
    el.loginError.style.display = 'none';
}

async function handleLogin(e) {
    e.preventDefault();

    const username = el.loginUsername.value;
    const password = el.loginPassword.value;

    // Show loading state
    el.loginBtn.disabled = true;
    el.loginBtn.querySelector('.login-text').style.display = 'none';
    el.loginBtn.querySelector('.login-loading').style.display = 'flex';
    el.loginError.style.display = 'none';

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.token;
            authUsername = data.username;
            localStorage.setItem('authToken', authToken);

            updateAuthUI(true);
            closeLoginModal();

            // Reload directories after successful login
            loadDirectories();
            showToast(`Welcome, ${authUsername}`);
        } else {
            el.loginError.textContent = data.error || 'Login failed';
            el.loginError.style.display = 'block';
        }
    } catch (error) {
        console.error('Login failed:', error);
        el.loginError.textContent = 'Login failed. Please try again.';
        el.loginError.style.display = 'block';
    } finally {
        el.loginBtn.disabled = false;
        el.loginBtn.querySelector('.login-text').style.display = 'flex';
        el.loginBtn.querySelector('.login-loading').style.display = 'none';
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
    } catch (error) {
        console.error('Logout failed:', error);
    }

    authToken = null;
    authUsername = null;
    localStorage.removeItem('authToken');

    updateAuthUI(false);
    showToast('Logged out');

    // Show login modal if auth is enabled
    if (authEnabled) {
        openLoginModal();
    }

    // Clear document view
    el.welcome.style.display = 'flex';
    el.document.style.display = 'none';
    el.treeItems.innerHTML = '';

    // Clear URL file parameter
    const newUrl = new URL(window.location);
    newUrl.searchParams.delete('file');
    window.history.replaceState({}, '', newUrl);
}

async function authFetch(url, options = {}) {
    // 如果有 token，就带上（除了登录接口）
    if (authToken && url !== '/api/auth/login') {
        options.headers = options.headers || {};
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, options);

    // Handle 401 - Unauthorized
    if (response.status === 401 && authEnabled) {
        authToken = null;
        authUsername = null;
        localStorage.removeItem('authToken');
        updateAuthUI(false);
        openLoginModal();
    }

    return response;
}

// ========================================
// Directory Tree
// ========================================

async function loadDirectories() {
    try {
        // Build URL with file type parameters
        const params = new URLSearchParams();
        if (showTxtFiles) params.append('txt', 'true');
        if (showJsonFiles) params.append('json', 'true');

        const url = `/api/directories${params.toString() ? '?' + params.toString() : ''}`;
        const response = await authFetch(url);
        let directories = await response.json();

        // Filter empty directories if showEmptyDirectories is false
        if (!showEmptyDirectories) {
            directories = directories.map(filterEmptyDirectories);
            directories = directories.filter(dir => dir !== null);
        }

        el.treeItems.innerHTML = '';

        if (directories.length === 0) {
            el.treeItems.innerHTML = `
                <div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
                    No pages found
                </div>
            `;
            return;
        }

        directories.forEach(dir => {
            const treeElement = renderTree(dir, 0);
            el.treeItems.appendChild(treeElement);
        });
    } catch (error) {
        console.error('Failed to load directories:', error);
        el.treeItems.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
                Failed to load pages
            </div>
        `;
    }
}

// Filter empty directories recursively
function filterEmptyDirectories(node) {
    // 防止 null 值
    if (!node) {
        return null;
    }

    if (node.type === 'file') {
        return node;
    }

    if (!node.children || node.children.length === 0) {
        return null;  // Empty directory, remove it
    }

    // Filter children recursively
    const filteredChildren = node.children
        .map(child => filterEmptyDirectories(child))
        .filter(child => child !== null);

    // If all children were filtered out, remove this directory too
    if (filteredChildren.length === 0) {
        return null;
    }

    return {
        ...node,
        children: filteredChildren
    };
}

function renderTree(node, level) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    const isTouchMode = isTouchInteractionMode();

    const hasChildren = node.type === 'directory' && node.children && node.children.length > 0;
    if (!hasChildren) {
        item.classList.add('no-children');
    }

    // Row
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.path = node.path;  // Store path for expand state saving

    // Toggle arrow
    const toggle = document.createElement('div');
    toggle.className = 'tree-toggle';
    toggle.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
        </svg>
    `;
    row.appendChild(toggle);

    // Icon
    const icon = document.createElement('div');
    icon.className = 'tree-icon';

    if (node.type === 'directory') {
        icon.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
        `;
    } else {
        // Get file extension
        const ext = node.name.split('.').pop().toLowerCase();
        if (ext === 'md') {
            // Markdown file icon
            icon.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="M12 18v-6"/>
                    <path d="M9 15l3 3 3-3"/>
                </svg>
            `;
        } else if (ext === 'txt') {
            // TXT file icon
            icon.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="M8 13h8"/>
                    <path d="M8 17h6"/>
                </svg>
            `;
        } else if (ext === 'json') {
            // JSON file icon
            icon.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="M10 12h1"/>
                    <path d="M14 12h1"/>
                    <path d="M10 16h1"/>
                    <path d="M14 16h1"/>
                </svg>
            `;
        }
    }
    row.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;  // Show full name with extension
    row.appendChild(label);

    // Action buttons container
    const actionButtons = document.createElement('div');
    actionButtons.className = 'tree-action-buttons';
    actionButtons.style.cssText = 'display: none; align-items: center; gap: 2px; margin-left: auto;';

    // Copy path button for both files and directories
    const copyBtn = document.createElement('button');
    copyBtn.className = 'tree-copy-btn';
    copyBtn.title = 'Copy path';
    copyBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
    `;
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        copyTreePath(node.path);
    });
    actionButtons.appendChild(copyBtn);

    // Add button for directories only (shows dropdown menu)
    if (node.type === 'directory') {
        const addBtn = document.createElement('button');
        addBtn.className = 'tree-add-btn';
        addBtn.title = 'Add file or directory';
        addBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
        `;

        // Create dropdown menu
        const dropdown = document.createElement('div');
        dropdown.className = 'tree-dropdown';
        dropdown.style.cssText = `
            display: none;
            position: absolute;
            right: 0;
            top: 100%;
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 100;
            min-width: 120px;
            padding: 4px 0;
        `;

        // New file option
        const newFileOption = document.createElement('div');
        newFileOption.className = 'tree-dropdown-item';
        newFileOption.style.cssText = `
            padding: 6px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--text-primary);
        `;
        newFileOption.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>新建文件</span>
        `;
        newFileOption.addEventListener('mouseenter', () => {
            newFileOption.style.background = 'var(--bg-hover)';
        });
        newFileOption.addEventListener('mouseleave', () => {
            newFileOption.style.background = 'transparent';
        });
        newFileOption.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            hideAllDropdowns();
            openCreateFileModal(node.path);
        });

        // New directory option
        const newDirOption = document.createElement('div');
        newDirOption.className = 'tree-dropdown-item';
        newDirOption.style.cssText = `
            padding: 6px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--text-primary);
        `;
        newDirOption.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/>
                <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            <span>新建目录</span>
        `;
        newDirOption.addEventListener('mouseenter', () => {
            newDirOption.style.background = 'var(--bg-hover)';
        });
        newDirOption.addEventListener('mouseleave', () => {
            newDirOption.style.background = 'transparent';
        });
        newDirOption.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            hideAllDropdowns();
            openCreateDirModal(node.path);
        });

        dropdown.appendChild(newFileOption);
        dropdown.appendChild(newDirOption);

        // Wrap button and dropdown in a container
        const addBtnContainer = document.createElement('div');
        addBtnContainer.style.cssText = 'position: relative;';
        addBtnContainer.appendChild(addBtn);
        addBtnContainer.appendChild(dropdown);

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            // Toggle dropdown
            const isVisible = dropdown.style.display === 'block';
            hideAllDropdowns();
            if (!isVisible) {
                dropdown.style.display = 'block';
            }
        });

        actionButtons.insertBefore(addBtnContainer, actionButtons.firstChild);
    }

    // Delete button for directories only
    if (node.type === 'directory') {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tree-delete-btn';
        deleteBtn.title = 'Delete directory';
        deleteBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
        `;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            openDeleteDirConfirm(node.path, node.name);
        });
        actionButtons.appendChild(deleteBtn);
    }

    row.appendChild(actionButtons);

    // Show/hide on hover
    if (!isTouchMode) {
        row.addEventListener('mouseenter', () => {
            actionButtons.style.display = 'flex';
        });
        row.addEventListener('mouseleave', () => {
            actionButtons.style.display = 'none';
        });
    }

    item.appendChild(row);

    // Children
    if (hasChildren) {
        const children = document.createElement('div');
        children.className = 'tree-children';

        node.children.forEach(child => {
            children.appendChild(renderTree(child, level + 1));
        });

        item.appendChild(children);

        // Auto-expand root level or restore expanded state
        const expandedPaths = getExpandedPaths();
        if (level === 0 || expandedPaths.has(node.path)) {
            item.classList.add('expanded');
        }

        // Toggle handler
        const toggleDirectory = () => {
            item.classList.toggle('expanded');
            saveExpandedState();
        };

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleDirectory();
        });

        row.addEventListener('click', (e) => {
            if (e.target.closest('.tree-action-buttons, .tree-dropdown')) {
                return;
            }
            setActiveRow(row);
            toggleDirectory();
        });
    }

    // File click handler
    if (node.type === 'file') {
        row.addEventListener('click', () => {
            loadFile(node.path, node.name);
            setActiveRow(row);

            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                el.sidebar.classList.remove('open');
            }
        });
    }

    return item;
}

function setActiveRow(row) {
    document.querySelectorAll('.tree-row.active').forEach(r => {
        r.classList.remove('active');
    });
    row.classList.add('active');

    if (isTouchInteractionMode()) {
        document.querySelectorAll('.tree-action-buttons').forEach(buttons => {
            buttons.style.display = 'none';
        });

        const actionButtons = row.querySelector('.tree-action-buttons');
        if (actionButtons && actionButtons.children.length > 0) {
            actionButtons.style.display = 'flex';
        }
    }
}

// ========================================
// File Loading
// ========================================

async function loadFile(filePath, fileName) {
    try {
        currentPath = filePath;

        const response = await authFetch(`/api/file?path=${encodeURIComponent(filePath)}`);
        const data = await response.json();

        if (data.error) {
            showError(data.error);
            return;
        }

        // Store raw content for source view
        currentRawContent = data.raw || '';

        // Restore source view mode from localStorage
        const savedViewMode = localStorage.getItem('sourceViewMode') || 'normal';
        sourceViewMode = savedViewMode;
        el.document.classList.remove('split-mode', 'source-mode');
        el.main.classList.remove('split-mode', 'source-mode');
        el.sourceToggle.classList.remove('active');

        if (savedViewMode === 'split') {
            el.document.classList.add('split-mode');
            el.main.classList.add('split-mode');
            el.sourceToggle.classList.add('active');
        } else if (savedViewMode === 'source') {
            el.document.classList.add('source-mode');
            el.main.classList.add('source-mode');
            el.sourceToggle.classList.add('active');
        }

        // Show document
        el.welcome.style.display = 'none';
        el.document.style.display = 'block';

        // Show document search button
        updateDocSearchButton();

        // Enable delete button
        el.deleteBtn.disabled = false;
        el.shareBtn.disabled = false;

        el.docTitle.textContent = data.title;
        el.docPath.textContent = simplifyPath(data.path);
        el.docTime.textContent = data.modified || '';
        el.docContent.innerHTML = data.content;

        // Update single view content for mobile
        if (el.docContentSingle) {
            el.docContentSingle.innerHTML = data.content;
        }

        // Update source view content
        if (el.docSource) {
            el.docSource.textContent = currentRawContent;
        }
        if (el.docSourceSingle) {
            el.docSourceSingle.textContent = currentRawContent;
        }

        // Helper function to process images
        const processImages = (container) => {
            container.querySelectorAll('img').forEach(img => {
                const originalSrc = img.getAttribute('src');
                if (originalSrc && !originalSrc.startsWith('http://') && !originalSrc.startsWith('https://') && !originalSrc.startsWith('data:')) {
                    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
                    const absolutePath = fileDir + '/' + originalSrc;
                    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
                    img.src = '/api/image?path=' + encodeURIComponent(absolutePath) + tokenParam;
                }
            });
        };

        // Helper function to process internal links
        const processLinks = (container) => {
            container.querySelectorAll('a').forEach(link => {
                const href = link.getAttribute('href');
                if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('#') && !href.startsWith('mailto:')) {
                    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
                    const absolutePath = resolveRelativePath(fileDir, href);
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        loadFile(absolutePath);
                    });
                }
            });
        };

        // Helper function for code highlighting
        const highlightCode = (container) => {
            container.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
        };

        // Helper function to process images into grid (WeChat/Weibo style)
        const processImageGrids = (container) => {
            // Find all paragraphs that contain only a single image
            const allParagraphs = Array.from(container.querySelectorAll('p'));

            // Helper to check if element is an image-only paragraph
            const isImageOnlyParagraph = (el) => {
                if (!el || el.tagName !== 'P') return false;
                const children = Array.from(el.childNodes);
                const hasOnlyImages = children.every(child => {
                    if (child.nodeType === Node.TEXT_NODE) {
                        return !child.textContent.trim();
                    }
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        return child.tagName === 'IMG' || child.tagName === 'BR';
                    }
                    return false;
                });
                return hasOnlyImages && el.querySelectorAll('img').length > 0;
            };

            // Group consecutive image-only paragraphs
            const groups = [];
            let currentGroup = [];

            allParagraphs.forEach(p => {
                if (isImageOnlyParagraph(p)) {
                    currentGroup.push(p);
                } else {
                    if (currentGroup.length > 0) {
                        groups.push(currentGroup);
                        currentGroup = [];
                    }
                }
            });
            // Don't forget the last group
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
            }

            // Process each group
            groups.forEach(group => {
                // Limit to 9 images
                const paragraphsToProcess = group.slice(0, 9);
                const totalImages = paragraphsToProcess.length;

                if (totalImages === 0) return;

                // Create grid container
                const grid = document.createElement('div');
                grid.className = `image-grid count-${totalImages}`;

                // Collect all images from paragraphs
                const allImages = [];
                paragraphsToProcess.forEach(p => {
                    const imgs = p.querySelectorAll('img');
                    imgs.forEach(img => allImages.push(img));
                });

                // Add images to grid
                allImages.forEach(img => {
                    const newImg = img.cloneNode(true);
                    newImg.addEventListener('click', () => openImageLightbox(newImg.src));
                    grid.appendChild(newImg);
                });

                // Replace first paragraph with grid
                const firstP = paragraphsToProcess[0];
                firstP.parentNode.replaceChild(grid, firstP);

                // Remove remaining paragraphs
                paragraphsToProcess.slice(1).forEach(p => {
                    if (p.parentNode) {
                        p.parentNode.removeChild(p);
                    }
                });
            });

            // Add lightbox click handler to remaining standalone images
            const standaloneImages = container.querySelectorAll('img:not(.image-grid img)');
            standaloneImages.forEach(img => {
                img.style.cursor = 'pointer';
                img.addEventListener('click', () => openImageLightbox(img.src));
            });
        };

        // Helper function to render JSON with collapsible structure
        const processJsonViewer = (container, rawJson) => {
            const textContent = container.querySelector('.text-file-content');
            if (!textContent) return;

            // Use rawJson if provided, otherwise try to parse from textContent
            let jsonData;
            if (rawJson) {
                try {
                    jsonData = JSON.parse(rawJson);
                } catch (e) {
                    return; // Invalid JSON
                }
            } else {
                // Fallback: try to parse from textContent
                const rawText = textContent.textContent;
                try {
                    jsonData = JSON.parse(rawText);
                } catch (e) {
                    return; // Not valid JSON
                }
            }

                // Create JSON viewer container
                const viewer = document.createElement('div');
                viewer.className = 'json-viewer';

                // Render JSON recursively
                const renderJsonValue = (value, key = null, depth = 0) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'json-item';

                    const type = Array.isArray(value) ? 'array' : typeof value;
                    const isExpandable = type === 'object' || type === 'array';
                    const isEmpty = isExpandable && Object.keys(value).length === 0;

                    // First line: key + toggle + bracket + count
                    const line = document.createElement('div');
                    line.className = 'json-line';
                    line.style.paddingLeft = `${depth * 12}px`;

                    // Key
                    if (key !== null) {
                        const keySpan = document.createElement('span');
                        keySpan.className = 'json-key';
                        keySpan.textContent = `"${key}"`;
                        line.appendChild(keySpan);

                        const colon = document.createElement('span');
                        colon.className = 'json-colon';
                        colon.textContent = ': ';
                        line.appendChild(colon);
                    }

                    if (isExpandable) {
                        wrapper.classList.add('expandable');

                        // Toggle arrow
                        const toggle = document.createElement('span');
                        toggle.className = 'json-toggle';
                        toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
                        line.appendChild(toggle);

                        // Bracket
                        const bracket = document.createElement('span');
                        bracket.className = 'json-bracket';
                        bracket.textContent = type === 'array' ? '[' : '{';
                        line.appendChild(bracket);

                        // Count/preview
                        const count = document.createElement('span');
                        count.className = 'json-count';
                        const len = type === 'array' ? value.length : Object.keys(value).length;
                        count.textContent = isEmpty ? '' : ` ${len} ${type === 'array' ? 'items' : 'keys'} `;
                        line.appendChild(count);

                        wrapper.appendChild(line);

                        // Children container
                        const children = document.createElement('div');
                        children.className = 'json-children';

                        if (type === 'array') {
                            value.forEach((item, index) => {
                                children.appendChild(renderJsonValue(item, index, depth + 1));
                            });
                        } else {
                            Object.keys(value).forEach(k => {
                                children.appendChild(renderJsonValue(value[k], k, depth + 1));
                            });
                        }

                        wrapper.appendChild(children);

                        // Closing bracket (separate line with same indent)
                        const closeBracket = document.createElement('div');
                        closeBracket.className = 'json-bracket json-bracket-close';
                        closeBracket.style.paddingLeft = `${depth * 12}px`;
                        closeBracket.textContent = type === 'array' ? ']' : '}';
                        wrapper.appendChild(closeBracket);

                        // Toggle handler
                        toggle.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const isCollapsed = wrapper.classList.toggle('collapsed');
                            children.style.display = isCollapsed ? 'none' : 'block';
                            count.style.display = isCollapsed ? 'inline' : 'none';
                            closeBracket.style.display = isCollapsed ? 'none' : 'block';
                        });

                        // Click on line to toggle
                        line.addEventListener('click', (e) => {
                            if (e.target === line) {
                                e.stopPropagation();
                                const isCollapsed = wrapper.classList.toggle('collapsed');
                                children.style.display = isCollapsed ? 'none' : 'block';
                                count.style.display = isCollapsed ? 'inline' : 'none';
                                closeBracket.style.display = isCollapsed ? 'none' : 'block';
                            }
                        });
                    } else {
                        // Primitive value
                        const valueSpan = document.createElement('span');
                        valueSpan.className = `json-value json-${type}`;

                        if (type === 'string') {
                            valueSpan.textContent = `"${value}"`;
                        } else if (type === 'null') {
                            valueSpan.textContent = 'null';
                        } else {
                            valueSpan.textContent = String(value);
                        }
                        line.appendChild(valueSpan);
                        wrapper.appendChild(line);
                    }

                    return wrapper;
                };

                viewer.appendChild(renderJsonValue(jsonData));

                // Add toolbar
                const toolbar = document.createElement('div');
                toolbar.className = 'json-toolbar';
                toolbar.innerHTML = `
                    <button class="json-btn" id="jsonExpandAll">Expand All</button>
                    <button class="json-btn" id="jsonCollapseAll">Collapse All</button>
                    <button class="json-btn" id="jsonCopy">Copy JSON</button>
                `;

                const viewerWrapper = document.createElement('div');
                viewerWrapper.className = 'json-viewer-wrapper';
                viewerWrapper.appendChild(toolbar);
                viewerWrapper.appendChild(viewer);

                // Replace content
                textContent.parentNode.replaceChild(viewerWrapper, textContent);

                // Toolbar handlers
                toolbar.querySelector('#jsonExpandAll').addEventListener('click', () => {
                    viewer.querySelectorAll('.json-node.collapsed').forEach(node => {
                        node.classList.remove('collapsed');
                        const children = node.querySelector('.json-children');
                        const count = node.querySelector('.json-count');
                        const closeBracket = node.querySelector('.json-bracket-close');
                        if (children) children.style.display = 'block';
                        if (count) count.style.display = 'none';
                        if (closeBracket) closeBracket.style.display = 'block';
                    });
                });

                toolbar.querySelector('#jsonCollapseAll').addEventListener('click', () => {
                    viewer.querySelectorAll('.json-node.expandable').forEach(node => {
                        node.classList.add('collapsed');
                        const children = node.querySelector('.json-children');
                        const count = node.querySelector('.json-count');
                        const closeBracket = node.querySelector('.json-bracket-close');
                        if (children) children.style.display = 'none';
                        if (count) count.style.display = 'inline';
                        if (closeBracket) closeBracket.style.display = 'none';
                    });
                });

                toolbar.querySelector('#jsonCopy').addEventListener('click', () => {
                    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2)).then(() => {
                        showToast('JSON copied');
                    }).catch(() => {
                        showToast('Copy failed');
                    });
                });
        };

        // Helper function to process inline tags (#tag without space)
        const processInlineTags = (container) => {
            // Process text nodes to wrap #tag patterns
            const walkTextNodes = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    // Match #tag pattern: # followed by word characters, not at start of line
                    const regex = /#([\u4e00-\u9fa5\w\-]+)/g;
                    if (regex.test(text)) {
                        const span = document.createElement('span');
                        span.innerHTML = text.replace(regex, '<span class="inline-tag">#$1</span>');
                        node.parentNode.replaceChild(span, node);
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // Skip code blocks and pre elements
                    if (node.tagName === 'CODE' || node.tagName === 'PRE') return;
                    // Process child nodes
                    Array.from(node.childNodes).forEach(walkTextNodes);
                }
            };
            walkTextNodes(container);
        };

        // Process main content
        processImages(el.docContent);
        processLinks(el.docContent);
        highlightCode(el.docContent);
        processInlineTags(el.docContent);
        processImageGrids(el.docContent);
        processJsonViewer(el.docContent, data.rawJson);

        // Process single view content (mobile)
        if (el.docContentSingle) {
            processImages(el.docContentSingle);
            processLinks(el.docContentSingle);
            highlightCode(el.docContentSingle);
            processInlineTags(el.docContentSingle);
            processImageGrids(el.docContentSingle);
            processJsonViewer(el.docContentSingle, data.rawJson);
        }

        // Generate TOC
        generateTOC();

        // Highlight and expand tree to show current file
        highlightTreeItem(filePath);

        // Update URL without reloading
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('file', filePath);
        window.history.replaceState({}, '', newUrl);

        // Scroll to top
        window.scrollTo(0, 0);

    } catch (error) {
        console.error('Failed to load file:', error);
        showError('Failed to load document');
    }
}

function showError(message) {
    el.welcome.style.display = 'none';
    el.document.style.display = 'block';

    el.docTitle.textContent = 'Error';
    el.docPath.textContent = '';
    el.docContent.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-tertiary);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.5;">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p>${message}</p>
        </div>
    `;
}

// ========================================
// Table of Contents
// ========================================

function generateTOC() {
    let headers = el.docContent.querySelectorAll('h2, h3, h4');

    // Filter out headers that look like tags (#xxx without space, usually short)
    headers = Array.from(headers).filter(header => {
        const text = header.textContent.trim();
        // Skip if it looks like a tag: starts with # and is short (no spaces, typically single word)
        if (text.startsWith('#') && !text.includes(' ') && text.length < 30) {
            return false;
        }
        return true;
    });

    if (headers.length === 0) {
        el.tocList.innerHTML = '';
        el.toc.classList.remove('visible');
        return;
    }

    // Add IDs to headers
    headers.forEach((header, index) => {
        if (!header.id) {
            header.id = `heading-${index}`;
        }
    });

    // Build TOC
    el.tocList.innerHTML = '';

    headers.forEach(header => {
        const item = document.createElement('div');
        item.className = `toc-item toc-${header.tagName.toLowerCase()}`;
        item.textContent = header.textContent;

        item.addEventListener('click', () => {
            header.scrollIntoView({ behavior: 'smooth', block: 'start' });

            document.querySelectorAll('.toc-item.active').forEach(i => {
                i.classList.remove('active');
            });
            item.classList.add('active');

            // Close TOC on mobile after clicking
            if (window.innerWidth <= 1200) {
                closeTOC();
            }
        });

        el.tocList.appendChild(item);
    });

    // Scroll spy
    setupScrollSpy(headers);
}

function setupScrollSpy(headers) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                document.querySelectorAll('.toc-item.active').forEach(i => {
                    i.classList.remove('active');
                });

                const index = Array.from(headers).indexOf(entry.target);
                const tocItem = el.tocList.children[index];
                if (tocItem) {
                    tocItem.classList.add('active');
                }
            }
        });
    }, {
        rootMargin: '-80px 0px -80% 0px'
    });

    headers.forEach(header => observer.observe(header));
}

function toggleTOC() {
    const isVisible = el.toc.classList.toggle('visible');
    if (window.innerWidth <= 1200) {
        el.tocOverlay.classList.toggle('visible', isVisible);
    }
}

function closeTOC() {
    el.toc.classList.remove('visible');
    el.tocOverlay.classList.remove('visible');
}

// ========================================
// Search
// ========================================

function openSearch() {
    isSearchOpen = true;
    el.searchModal.classList.add('visible');
    el.searchInput.value = '';
    el.searchInput.focus();
    showSearchPlaceholder();
}

function closeSearch() {
    isSearchOpen = false;
    el.searchModal.classList.remove('visible');
}

function handleSearchInput(e) {
    const query = e.target.value.trim();

    clearTimeout(searchTimeout);

    if (!query) {
        showSearchPlaceholder();
        return;
    }

    searchTimeout = setTimeout(() => performSearch(query), 200);
}

function showSearchPlaceholder() {
    el.searchResults.innerHTML = `
        <div class="search-placeholder">
            Type to search across all pages...
        </div>
    `;
}

async function performSearch(query) {
    try {
        const response = await authFetch(`/api/search?q=${encodeURIComponent(query)}`);
        const results = await response.json();

        displaySearchResults(results);
    } catch (error) {
        console.error('Search failed:', error);
        el.searchResults.innerHTML = `
            <div class="search-placeholder">
                Search failed
            </div>
        `;
    }
}

function displaySearchResults(results) {
    if (results.length === 0) {
        el.searchResults.innerHTML = `
            <div class="search-placeholder">
                No results found
            </div>
        `;
        return;
    }

    el.searchResults.innerHTML = results.map(result => `
        <div class="search-result" data-path="${result.path}">
            <div class="search-result-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="M12 18v-6"/>
                    <path d="M9 15l3 3 3-3"/>
                </svg>
            </div>
            <div class="search-result-info">
                <div class="search-result-title">${escapeHtml(result.name)}</div>
                <div class="search-result-path">${result.directory}</div>
            </div>
        </div>
    `).join('');

    // Add click handlers
    el.searchResults.querySelectorAll('.search-result').forEach(item => {
        item.addEventListener('click', () => {
            const path = item.dataset.path;
            loadFile(path);
            closeSearch();
        });
    });
}

// ========================================
// Sidebar
// ========================================

function goHome() {
    // Show welcome screen
    el.welcome.style.display = 'flex';
    el.document.style.display = 'none';

    // Hide document search button and close search
    updateDocSearchButton();

    // Clear active state in tree
    document.querySelectorAll('.tree-row.active').forEach(r => {
        r.classList.remove('active');
    });

    // Clear breadcrumb
    el.breadcrumb.textContent = '';

    // Clear current path
    currentPath = null;
    currentRawContent = null;

    // Reset source view mode
    sourceViewMode = 'normal';
    el.document.classList.remove('split-mode', 'source-mode');
    el.sourceToggle.classList.remove('active');

    // Disable delete button
    el.deleteBtn.disabled = true;
    el.shareBtn.disabled = true;

    // Clear URL file parameter
    const newUrl = new URL(window.location);
    newUrl.searchParams.delete('file');
    window.history.replaceState({}, '', newUrl);

    // Close TOC if open
    closeTOC();
}

// ========================================
// Source View Toggle
// ========================================

// Refresh current file
function refreshCurrentFile() {
    // Add spinning animation to button
    el.refreshBtn.classList.add('spinning');

    // Refresh directories
    loadDirectories();

    // Refresh current file if one is loaded
    if (currentPath) {
        loadFile(currentPath).then(() => {
            setTimeout(() => {
                el.refreshBtn.classList.remove('spinning');
            }, 300);
            showToast('Refreshed');
        });
    } else {
        setTimeout(() => {
            el.refreshBtn.classList.remove('spinning');
        }, 300);
        showToast('Refreshed');
    }
}

function toggleSourceView() {
    if (!currentRawContent) {
        showToast('No source content available');
        return;
    }

    // Clear search highlights when switching views (search only works in content view)
    clearDocSearchHighlights();

    const isMobile = window.innerWidth <= 768;

    // Cycle through modes: normal -> source (mobile) / split (desktop) -> normal
    if (sourceViewMode === 'normal') {
        if (isMobile) {
            sourceViewMode = 'source';
            el.document.classList.remove('split-mode');
            el.document.classList.add('source-mode');
            el.main.classList.remove('split-mode');
            el.main.classList.add('source-mode');
        } else {
            sourceViewMode = 'split';
            el.document.classList.remove('source-mode');
            el.document.classList.add('split-mode');
            el.main.classList.remove('source-mode');
            el.main.classList.add('split-mode');
        }
        el.sourceToggle.classList.add('active');
    } else {
        sourceViewMode = 'normal';
        el.document.classList.remove('split-mode', 'source-mode');
        el.main.classList.remove('split-mode', 'source-mode');
        el.sourceToggle.classList.remove('active');
    }

    // Save to localStorage
    localStorage.setItem('sourceViewMode', sourceViewMode);
}

// ========================================
// Sidebar Resize
// ========================================

function initSidebarWidth() {
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        setSidebarWidth(parseInt(savedWidth));
    }
}

function setSidebarWidth(width) {
    // Clamp width between min and max
    const minWidth = 180;
    const maxWidth = 500;
    width = Math.max(minWidth, Math.min(maxWidth, width));

    // Update CSS variable
    document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    localStorage.setItem('sidebarWidth', width);
}

function startResize(e) {
    isResizing = true;
    el.resizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
}

function handleResize(e) {
    if (!isResizing) return;

    const newWidth = e.clientX;
    setSidebarWidth(newWidth);
}

function stopResize() {
    if (isResizing) {
        isResizing = false;
        el.resizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
}

function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;

    if (window.innerWidth <= 768) {
        el.sidebar.classList.toggle('open');
    } else {
        el.sidebar.classList.toggle('collapsed');
    }
}

// ========================================
// Theme
// ========================================

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
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
}

// ========================================
// Copy Path
// ========================================

function copyPath() {
    if (!currentPath) return;
    copyText(currentPath, 'Path copied');
}

function copyText(text, successMessage = 'Copied') {
    // Check if Clipboard API is available
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMessage);
        }).catch(() => {
            // Fallback if Clipboard API fails
            fallbackCopy();
        });
    } else {
        // Direct fallback if Clipboard API is not available
        fallbackCopy();
    }

    function fallbackCopy() {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast(successMessage);
        } catch (err) {
            showToast('Copy failed');
        }
        document.body.removeChild(textarea);
    }
}

// ========================================
// Share Links
// ========================================

async function openShareModal() {
    if (!currentPath) return;

    el.shareError.style.display = 'none';
    el.shareError.textContent = '';
    el.shareCurrentFile.textContent = simplifyPath(currentPath);
    el.shareModal.classList.add('visible');
    await loadShareLinks();
}

function closeShareModal() {
    el.shareModal.classList.remove('visible');
}

async function loadShareLinks() {
    if (!currentPath) return;

    el.shareLinks.innerHTML = '<div class="share-empty">Loading...</div>';

    try {
        const response = await authFetch(`/api/share-links?path=${encodeURIComponent(currentPath)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load share links');
        }

        shareLinksCache = data;
        renderShareLinks();
    } catch (error) {
        console.error('Failed to load share links:', error);
        el.shareLinks.innerHTML = '<div class="share-empty">Failed to load share links</div>';
    }
}

async function createShareLink() {
    if (!currentPath) return;

    el.shareError.style.display = 'none';
    el.createShareBtn.disabled = true;
    el.createShareBtn.textContent = 'Generating...';

    const payload = {
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
            el.shareError.textContent = data.error || 'Failed to create share link';
            el.shareError.style.display = 'block';
            return;
        }

        shareLinksCache.unshift(data);
        renderShareLinks();
        copyText(data.url, 'Share link copied');
    } catch (error) {
        console.error('Failed to create share link:', error);
        el.shareError.textContent = 'Failed to create share link';
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
        const viewsText = link.max_views ? `${link.view_count}/${link.max_views} views` : `${link.view_count} views`;
        const statusText = link.active ? 'Active' : 'Inactive';
        meta.textContent = `${statusText} · expires ${formatShareTime(link.expires_at)} · ${viewsText}`;

        info.appendChild(url);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'share-link-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'icon-btn';
        copyBtn.title = 'Copy share link';
        copyBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.addEventListener('click', () => copyText(link.url, 'Share link copied'));
        actions.appendChild(copyBtn);

        if (link.active) {
            const revokeBtn = document.createElement('button');
            revokeBtn.className = 'icon-btn danger';
            revokeBtn.title = 'Revoke share link';
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
            showToast(data.error || 'Failed to revoke share link');
            return;
        }

        shareLinksCache = shareLinksCache.map(link => link.id === linkId ? data.link : link);
        renderShareLinks();
        showToast('Share link revoked');
    } catch (error) {
        console.error('Failed to revoke share link:', error);
        showToast('Failed to revoke share link');
    }
}

function formatShareTime(value) {
    if (!value) return 'never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

// ========================================
// Toast
// ========================================

function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('visible');

    setTimeout(() => {
        el.toast.classList.remove('visible');
    }, 2000);
}

// ========================================
// Directory Configuration
// ========================================

let directoriesCache = [];

async function openDirConfig() {
    el.dirConfigModal.classList.add('visible');
    await loadDirectoriesConfig();
    renderDirectoryList();
}

function closeDirConfig() {
    el.dirConfigModal.classList.remove('visible');
}

async function loadDirectoriesConfig() {
    try {
        const response = await authFetch('/api/directories/config');
        directoriesCache = await response.json();
    } catch (error) {
        console.error('Failed to load directories config:', error);
        directoriesCache = [];
    }
}

function renderDirectoryList() {
    if (directoriesCache.length === 0) {
        el.dirList.innerHTML = `
            <div class="empty-state">
                <p>No directories configured yet.</p>
                <p>Click "Add Directory" to get started.</p>
            </div>
        `;
        return;
    }

    el.dirList.innerHTML = directoriesCache.map((dir, index) => `
        <div class="dir-item" data-index="${index}">
            <div class="dir-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
            </div>
            <div class="dir-item-info">
                <div class="dir-item-name">${escapeHtml(dir.name)}</div>
                <div class="dir-item-path">${escapeHtml(dir.path)}</div>
            </div>
            <button class="dir-item-remove" data-index="${index}" title="Remove directory">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
    `).join('');

    // Add remove button handlers
    el.dirList.querySelectorAll('.dir-item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            removeDirectory(index);
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function removeDirectory(index) {
    directoriesCache.splice(index, 1);
    renderDirectoryList();
}

async function saveDirectories() {
    try {
        el.dirSaveBtn.disabled = true;
        el.dirSaveBtn.textContent = 'Saving...';

        const response = await authFetch('/api/directories/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ directories: directoriesCache })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Directories saved successfully');
            closeDirConfig();
            // Reload directories tree
            loadDirectories();
        } else {
            el.dirError.textContent = data.error || 'Failed to save directories';
            el.dirError.style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to save directories:', error);
        showToast('Failed to save directories');
    } finally {
        el.dirSaveBtn.disabled = false;
        el.dirSaveBtn.textContent = 'Save';
    }
}

function openAddDir() {
    el.dirConfigModal.classList.remove('visible');
    el.addDirModal.classList.add('visible');
    el.dirName.focus();
    el.addDirForm.reset();
    el.dirError.style.display = 'none';
}

function closeAddDir() {
    el.addDirModal.classList.remove('visible');
    el.dirConfigModal.classList.add('visible');
}

async function addDirectory() {
    const name = el.dirName.value.trim();
    const path = el.dirPath.value.trim();

    if (!name || !path) {
        el.dirError.textContent = 'Please enter both name and path';
        el.dirError.style.display = 'block';
        return;
    }

    try {
        el.addDirConfirmBtn.disabled = true;
        el.addDirConfirmBtn.textContent = 'Adding...';

        // Check if path is valid by temporarily adding to cache and validating
        const tempDir = { name, path };
        const testResponse = await authFetch('/api/directories/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ directories: [...directoriesCache, tempDir] })
        });

        const testData = await testResponse.json();

        if (testResponse.ok) {
            directoriesCache.push(tempDir);
            renderDirectoryList();
            closeAddDir();
            showToast('Directory added');
        } else {
            el.dirError.textContent = testData.error || 'Failed to add directory';
            el.dirError.style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to add directory:', error);
        el.dirError.textContent = 'Failed to add directory';
        el.dirError.style.display = 'block';
    } finally {
        el.addDirConfirmBtn.disabled = false;
        el.addDirConfirmBtn.textContent = 'Add';
    }
}

// ========================================
// Tree Filter
// ========================================

function initTreeFilter() {
    const saved = localStorage.getItem('showEmptyDirectories');
    showEmptyDirectories = saved === 'true';
    updateTreeFilterButton();
}

function toggleTreeFilter() {
    showEmptyDirectories = !showEmptyDirectories;
    localStorage.setItem('showEmptyDirectories', showEmptyDirectories);
    updateTreeFilterButton();
    loadDirectories();
}

function updateTreeFilterButton() {
    if (showEmptyDirectories) {
        el.treeFilterBtn.classList.add('active');
        el.treeFilterBtn.querySelector('.icon-show-empty').style.display = 'none';
        el.treeFilterBtn.querySelector('.icon-hide-empty').style.display = 'block';
        el.treeFilterBtn.title = 'Hide empty directories';
    } else {
        el.treeFilterBtn.classList.remove('active');
        el.treeFilterBtn.querySelector('.icon-show-empty').style.display = 'block';
        el.treeFilterBtn.querySelector('.icon-hide-empty').style.display = 'none';
        el.treeFilterBtn.title = 'Show empty directories';
    }
}

// ========================================
// File Type Filters
// ========================================

function initFileFilters() {
    const savedTxt = localStorage.getItem('showTxtFiles');
    const savedJson = localStorage.getItem('showJsonFiles');
    showTxtFiles = savedTxt === 'true';
    showJsonFiles = savedJson === 'true';
    updateFileFilterButtons();
}

function toggleTxtFilter() {
    showTxtFiles = !showTxtFiles;
    localStorage.setItem('showTxtFiles', showTxtFiles);
    updateFileFilterButtons();
    loadDirectories();
}

function toggleJsonFilter() {
    showJsonFiles = !showJsonFiles;
    localStorage.setItem('showJsonFiles', showJsonFiles);
    updateFileFilterButtons();
    loadDirectories();
}

function updateFileFilterButtons() {
    // Update TXT button
    if (showTxtFiles) {
        el.txtFilterBtn.classList.add('active');
    } else {
        el.txtFilterBtn.classList.remove('active');
    }

    // Update JSON button
    if (showJsonFiles) {
        el.jsonFilterBtn.classList.add('active');
    } else {
        el.jsonFilterBtn.classList.remove('active');
    }
}

// Hide all dropdown menus
function hideAllDropdowns() {
    document.querySelectorAll('.tree-dropdown').forEach(dropdown => {
        dropdown.style.display = 'none';
    });
}

// Click outside to close dropdowns
document.addEventListener('click', (e) => {
    if (!e.target.closest('.tree-add-btn') && !e.target.closest('.tree-dropdown')) {
        hideAllDropdowns();
    }

    if (isTouchInteractionMode() && !e.target.closest('.tree-row')) {
        document.querySelectorAll('.tree-action-buttons').forEach(buttons => {
            buttons.style.display = 'none';
        });
        document.querySelectorAll('.tree-row.active').forEach(row => {
            row.classList.remove('active');
        });
    }
});

// ESC key to close dropdowns
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideAllDropdowns();
    }
});

// Copy path from tree item
function copyTreePath(path) {
    // Check if Clipboard API is available
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(path).then(() => {
            showToast('Path copied');
        }).catch(() => {
            // Fallback if Clipboard API fails
            fallbackCopy(path);
        });
    } else {
        // Direct fallback if Clipboard API is not available
        fallbackCopy(path);
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast('Path copied');
        } catch (err) {
            showToast('Copy failed');
        }
        document.body.removeChild(textarea);
    }
}

// ========================================
// Expand/Collapse All Directories
// ========================================

function getExpandedPaths() {
    const saved = localStorage.getItem('expandedPaths');
    return saved ? new Set(JSON.parse(saved)) : new Set();
}

function saveExpandedState() {
    const expandedItems = el.treeItems.querySelectorAll('.tree-item.expanded');
    const paths = [];
    expandedItems.forEach(item => {
        const row = item.querySelector('.tree-row');
        if (row) {
            const path = row.dataset?.path;
            if (path) {
                paths.push(path);
            }
        }
    });
    localStorage.setItem('expandedPaths', JSON.stringify(paths));
}

function toggleExpandAll() {
    allExpanded = !allExpanded;
    const treeItems = el.treeItems.querySelectorAll('.tree-item');
    
    treeItems.forEach(item => {
        if (allExpanded) {
            item.classList.add('expanded');
        } else {
            // Don't collapse root level items
            const isRoot = item.parentElement === el.treeItems;
            if (!isRoot) {
                item.classList.remove('expanded');
            }
        }
    });
    
    // Save state
    if (allExpanded) {
        // Save all paths
        const allPaths = [];
        treeItems.forEach(item => {
            const row = item.querySelector('.tree-row');
            if (row && row.dataset?.path) {
                allPaths.push(row.dataset.path);
            }
        });
        localStorage.setItem('expandedPaths', JSON.stringify(allPaths));
    } else {
        // Save only root paths
        const rootPaths = [];
        el.treeItems.querySelectorAll(':scope > .tree-item').forEach(item => {
            const row = item.querySelector('.tree-row');
            if (row && row.dataset?.path) {
                rootPaths.push(row.dataset.path);
            }
        });
        localStorage.setItem('expandedPaths', JSON.stringify(rootPaths));
    }
    
    updateExpandAllButton();
}

function updateExpandAllButton() {
    const expandIcon = el.expandAllBtn.querySelector('.icon-expand');
    const collapseIcon = el.expandAllBtn.querySelector('.icon-collapse');
    
    if (allExpanded) {
        expandIcon.style.display = 'none';
        collapseIcon.style.display = 'block';
        el.expandAllBtn.title = 'Collapse all directories';
    } else {
        expandIcon.style.display = 'block';
        collapseIcon.style.display = 'none';
        el.expandAllBtn.title = 'Expand all directories';
    }
}

// ========================================
// Path Resolution
// ========================================

function resolveRelativePath(baseDir, relativePath) {
    // Handle paths starting with ~
    if (relativePath.startsWith('~/')) {
        return relativePath;
    }

    // Split paths into parts
    const baseParts = baseDir.split('/');
    const relativeParts = relativePath.split('/');

    // Process each part of the relative path
    for (const part of relativeParts) {
        if (part === '..') {
            baseParts.pop();
        } else if (part !== '.' && part !== '') {
            baseParts.push(part);
        }
    }

    return baseParts.join('/');
}

// ========================================
// Tree Highlight
// ========================================

function highlightTreeItem(filePath) {
    // Remove previous active state
    document.querySelectorAll('.tree-row.active').forEach(r => {
        r.classList.remove('active');
    });

    // Find the tree item with matching path
    const treeItems = el.treeItems.querySelectorAll('.tree-item');
    let targetItem = null;
    let targetRow = null;

    treeItems.forEach(item => {
        const row = item.querySelector('.tree-row');
        if (row && row.dataset.path === filePath) {
            targetItem = item;
            targetRow = row;
        }
    });

    if (!targetItem) return;

    // Expand all parent directories
    let parent = targetItem.parentElement;
    while (parent) {
        if (parent.classList && parent.classList.contains('tree-children')) {
            const parentItem = parent.parentElement;
            if (parentItem && parentItem.classList.contains('tree-item')) {
                parentItem.classList.add('expanded');
            }
        }
        parent = parent.parentElement;
    }

    // Set active state
    if (targetRow) {
        targetRow.classList.add('active');
        // Scroll into view
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ========================================
// Delete File
// ========================================

function openDeleteConfirm() {
    if (!currentPath) return;

    // Show file info in modal
    const fileName = currentPath.split('/').pop();
    el.deleteFileName.textContent = fileName;
    el.deleteFilePath.textContent = simplifyPath(currentPath);

    el.deleteConfirmModal.classList.add('visible');
}

function closeDeleteConfirm() {
    el.deleteConfirmModal.classList.remove('visible');
}

async function confirmDelete() {
    if (!currentPath) return;

    try {
        // Disable buttons during deletion
        el.deleteConfirmBtn.disabled = true;
        el.deleteConfirmBtn.textContent = 'Deleting...';

        const response = await authFetch('/api/file', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: currentPath })
        });

        const data = await response.json();

        if (response.ok) {
            closeDeleteConfirm();
            showToast('File deleted successfully');

            // Clear current path
            const deletedPath = currentPath;
            currentPath = null;
            currentRawContent = null;

            // Show welcome screen
            el.welcome.style.display = 'flex';
            el.document.style.display = 'none';

            // Clear breadcrumb
            el.breadcrumb.textContent = '';

            // Clear URL file parameter
            const newUrl = new URL(window.location);
            newUrl.searchParams.delete('file');
            window.history.replaceState({}, '', newUrl);

            // Reload directories to update tree
            await loadDirectories();

            // Remove the tree row for deleted file
            const treeItems = el.treeItems.querySelectorAll('.tree-item');
            treeItems.forEach(item => {
                const row = item.querySelector('.tree-row');
                if (row && row.dataset.path === deletedPath) {
                    // Remove the tree item
                    item.remove();
                }
            });

            // Disable delete button
            el.deleteBtn.disabled = true;
            el.shareBtn.disabled = true;

        } else {
            showToast(data.error || 'Failed to delete file');
        }
    } catch (error) {
        console.error('Delete failed:', error);
        showToast('Failed to delete file');
    } finally {
        // Re-enable buttons
        el.deleteConfirmBtn.disabled = false;
        el.deleteConfirmBtn.textContent = 'Delete';
    }
}

// ========================================
// Delete Directory
// ========================================

let deleteDirPath = null;

function openDeleteDirConfirm(path, name) {
    deleteDirPath = path;

    // Show directory info in modal
    el.deleteDirName.textContent = name;
    el.deleteDirPath.textContent = simplifyPath(path);

    el.deleteDirConfirmModal.classList.add('visible');
}

function closeDeleteDirConfirm() {
    el.deleteDirConfirmModal.classList.remove('visible');
    deleteDirPath = null;
}

async function confirmDeleteDir() {
    if (!deleteDirPath) return;

    try {
        // Disable buttons during deletion
        el.deleteDirConfirmBtn.disabled = true;
        el.deleteDirConfirmBtn.textContent = 'Deleting...';

        const response = await authFetch('/api/directory', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: deleteDirPath })
        });

        const data = await response.json();

        if (response.ok) {
            closeDeleteDirConfirm();
            showToast('Directory deleted successfully');

            // If the deleted directory contains the current file, clear it
            if (currentPath && currentPath.startsWith(deleteDirPath)) {
                currentPath = null;
                currentRawContent = null;
                el.welcome.style.display = 'flex';
                el.document.style.display = 'none';
                el.breadcrumb.textContent = '';
                el.deleteBtn.disabled = true;

                const newUrl = new URL(window.location);
                newUrl.searchParams.delete('file');
                window.history.replaceState({}, '', newUrl);
            }

            // Reload directories to update tree
            await loadDirectories();
        } else {
            showToast(data.error || 'Failed to delete directory');
        }
    } catch (error) {
        console.error('Delete directory failed:', error);
        showToast('Failed to delete directory');
    } finally {
        // Re-enable buttons
        el.deleteDirConfirmBtn.disabled = false;
        el.deleteDirConfirmBtn.textContent = 'Delete';
    }
}

// ========================================
// Create File Modal
// ========================================

let createFileDirPath = null;

function openCreateFileModal(dirPath) {
    createFileDirPath = dirPath;

    // Show directory path in modal
    el.createFileDirPath.textContent = simplifyPath(dirPath);

    // Reset form
    el.createFileName.value = '';
    el.createFileError.style.display = 'none';
    el.createFileError.textContent = '';

    // Set default file type to .md
    const mdRadio = document.querySelector('input[name="fileType"][value="md"]');
    if (mdRadio) mdRadio.checked = true;

    el.createFileModal.classList.add('visible');
    el.createFileName.focus();
}

function closeCreateFileModal() {
    el.createFileModal.classList.remove('visible');
    createFileDirPath = null;
}

async function confirmCreateFile() {
    if (!createFileDirPath) return;

    const fileName = el.createFileName.value.trim();
    if (!fileName) {
        el.createFileError.textContent = '请输入文件名';
        el.createFileError.style.display = 'block';
        return;
    }

    // Get selected file type
    const fileTypeRadio = document.querySelector('input[name="fileType"]:checked');
    const fileType = fileTypeRadio ? fileTypeRadio.value : 'md';

    // Build full file path
    const fullFileName = fileName.endsWith('.' + fileType) ? fileName : fileName + '.' + fileType;
    const filePath = createFileDirPath + '/' + fullFileName;

    // Disable buttons during creation
    el.createFileConfirmBtn.disabled = true;
    el.createFileConfirmBtn.textContent = 'Creating...';

    try {
        const response = await authFetch('/api/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content: '' })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('File created successfully');
            closeCreateFileModal();

            // Reload directories to update tree
            await loadDirectories();

            // Open the newly created file in edit mode
            loadFile(data.path, data.name);
            enterEditMode();
        } else {
            el.createFileError.textContent = data.error || 'Failed to create file';
            el.createFileError.style.display = 'block';
        }
    } catch (error) {
        console.error('Create file failed:', error);
        el.createFileError.textContent = 'Failed to create file';
        el.createFileError.style.display = 'block';
    } finally {
        // Re-enable buttons
        el.createFileConfirmBtn.disabled = false;
        el.createFileConfirmBtn.textContent = '创建';
    }
}

// ========================================
// Create Directory Modal
// ========================================

let createDirParentPath = null;

function openCreateDirModal(parentPath) {
    createDirParentPath = parentPath;

    // Show parent path in modal
    el.createDirParentPath.textContent = simplifyPath(parentPath);

    // Reset form
    el.createDirName.value = '';
    el.createDirError.style.display = 'none';
    el.createDirError.textContent = '';

    el.createDirModal.classList.add('visible');
    el.createDirName.focus();
}

function closeCreateDirModal() {
    el.createDirModal.classList.remove('visible');
    createDirParentPath = null;
}

async function confirmCreateDir() {
    if (!createDirParentPath) return;

    const dirName = el.createDirName.value.trim();
    if (!dirName) {
        el.createDirError.textContent = '请输入目录名';
        el.createDirError.style.display = 'block';
        return;
    }

    // Build full directory path
    const dirPath = createDirParentPath + '/' + dirName;

    // Disable buttons during creation
    el.createDirConfirmBtn.disabled = true;
    el.createDirConfirmBtn.textContent = 'Creating...';

    try {
        const response = await authFetch('/api/directory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Directory created successfully');
            closeCreateDirModal();

            // Save expanded state before reload
            saveExpandedState();

            // Add new directory to expanded paths
            const expandedPaths = getExpandedPaths();
            expandedPaths.add(createDirParentPath);

            // Reload directories to update tree
            await loadDirectories();
        } else {
            el.createDirError.textContent = data.error || 'Failed to create directory';
            el.createDirError.style.display = 'block';
        }
    } catch (error) {
        console.error('Create directory failed:', error);
        el.createDirError.textContent = 'Failed to create directory';
        el.createDirError.style.display = 'block';
    } finally {
        // Re-enable buttons
        el.createDirConfirmBtn.disabled = false;
        el.createDirConfirmBtn.textContent = '创建';
    }
}

// ========================================
// Image Lightbox
// ========================================

function openImageLightbox(src) {
    // Create lightbox if it doesn't exist
    let lightbox = document.getElementById('imageLightbox');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'imageLightbox';
        lightbox.className = 'image-lightbox';
        lightbox.innerHTML = `
            <button class="image-lightbox-close" aria-label="Close">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
            <img src="" alt="Full size image">
        `;
        document.body.appendChild(lightbox);

        // Close on click
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox || e.target.closest('.image-lightbox-close')) {
                closeImageLightbox();
            }
        });

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && lightbox.classList.contains('visible')) {
                closeImageLightbox();
            }
        });
    }

    // Set image source and show
    const img = lightbox.querySelector('img');
    img.src = src;
    lightbox.classList.add('visible');
}

function closeImageLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox) {
        lightbox.classList.remove('visible');
    }
}

// ========================================
// Edit Mode
// ========================================

let editPreviewTimeout = null;

function enterEditMode() {
    if (currentRawContent === null) {
        showToast('No file loaded');
        return;
    }

    // Close document search when entering edit mode
    closeDocSearch();

    isEditMode = true;

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Mobile: show simple editor
        el.docEditor.value = currentRawContent;
        el.docEditor.focus();
    } else {
        // PC: show split view with editor and live preview
        el.docEditorSplit.value = currentRawContent;
        updateEditPreview();
        el.docEditorSplit.focus();

        // Add input listener for live preview
        el.docEditorSplit.addEventListener('input', handleEditInput);
    }

    // Add edit-mode class to topbar and document
    el.topbar.classList.add('edit-mode');
    el.document.classList.add('edit-mode');
    if (el.contentWrapper) {
        el.contentWrapper.classList.add('edit-mode');
    }
}

function handleEditInput() {
    // Debounce preview update
    clearTimeout(editPreviewTimeout);
    editPreviewTimeout = setTimeout(updateEditPreview, 300);
}

async function updateEditPreview() {
    const content = el.docEditorSplit.value;

    try {
        const response = await authFetch('/api/render', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: content,
                path: currentPath
            })
        });

        const data = await response.json();

        if (response.ok) {
            el.docPreview.innerHTML = data.content;

            // Process images in preview
            el.docPreview.querySelectorAll('img').forEach(img => {
                const originalSrc = img.getAttribute('src');
                if (originalSrc && !originalSrc.startsWith('http://') && !originalSrc.startsWith('https://') && !originalSrc.startsWith('data:')) {
                    const fileDir = currentPath.substring(0, currentPath.lastIndexOf('/'));
                    const absolutePath = fileDir + '/' + originalSrc;
                    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
                    img.src = '/api/image?path=' + encodeURIComponent(absolutePath) + tokenParam;
                }
            });

            // Highlight code blocks
            el.docPreview.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
        }
    } catch (error) {
        console.error('Preview update failed:', error);
    }
}

async function saveAndExitEditMode() {
    if (!isEditMode) return;

    const isMobile = window.innerWidth <= 768;
    const newContent = isMobile ? el.docEditor.value : el.docEditorSplit.value;

    try {
        el.saveBtn.disabled = true;

        const response = await authFetch('/api/file', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: currentPath,
                content: newContent
            })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('File saved');

            // Exit edit mode
            exitEditMode();

            // Reload file to show updated content
            await loadFile(currentPath);
        } else {
            showToast(data.error || 'Failed to save file');
        }
    } catch (error) {
        console.error('Save failed:', error);
        showToast('Failed to save file');
    } finally {
        el.saveBtn.disabled = false;
    }
}

function exitEditMode() {
    if (!isEditMode) return;

    // Remove input listener
    if (el.docEditorSplit) {
        el.docEditorSplit.removeEventListener('input', handleEditInput);
    }

    isEditMode = false;
    el.topbar.classList.remove('edit-mode');
    el.document.classList.remove('edit-mode');
    if (el.contentWrapper) {
        el.contentWrapper.classList.remove('edit-mode');
    }
    el.docEditor.value = '';
    if (el.docEditorSplit) {
        el.docEditorSplit.value = '';
    }
    if (el.docPreview) {
        el.docPreview.innerHTML = '';
    }
    clearTimeout(editPreviewTimeout);
}

// ========================================
// Document Search (Find in page)
// ========================================

function toggleDocSearch() {
    if (el.docSearchBar.style.display === 'none' || !el.docSearchBar.style.display) {
        openDocSearch();
    } else {
        closeDocSearch();
    }
}

function openDocSearch() {
    el.docSearchBar.style.display = 'flex';
    el.topbar.classList.add('search-open');
    el.docSearchInput.focus();
    // If there's existing query, restore it
    if (docSearchQuery) {
        el.docSearchInput.value = docSearchQuery;
        updateDocSearchCount();
    }
}

function closeDocSearch() {
    el.docSearchBar.style.display = 'none';
    el.topbar.classList.remove('search-open');
    clearDocSearchHighlights();
}

function handleDocSearchInput(e) {
    const query = e.target.value.trim();
    docSearchQuery = query;

    if (!query) {
        clearDocSearchHighlights();
        updateDocSearchCount();
        return;
    }

    performDocSearch(query);
}

function handleDocSearchKeydown(e) {
    // Enter key - navigate to next match
    if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
            navigateDocSearch(-1);
        } else {
            navigateDocSearch(1);
        }
    }
    // Escape key - close search
    if (e.key === 'Escape') {
        closeDocSearch();
    }
}

function performDocSearch(query) {
    // Clear previous highlights
    clearDocSearchHighlights();

    // Get current content container
    const contentContainer = getCurrentContentContainer();
    if (!contentContainer) return;

    // Find all text nodes in the content
    const textNodes = [];
    const walker = document.createTreeWalker(
        contentContainer,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                // Skip text nodes inside script, style, code, or pre tags
                const parent = node.parentElement;
                if (parent && (
                    parent.tagName === 'SCRIPT' ||
                    parent.tagName === 'STYLE' ||
                    parent.tagName === 'CODE' ||
                    parent.tagName === 'PRE' ||
                    parent.tagName === 'NOSCRIPT'
                )) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Only accept nodes with actual content
                if (node.textContent.trim().length > 0) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }

    // Escape special regex characters in the query
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    // Highlight matches
    textNodes.forEach(textNode => {
        const text = textNode.textContent;
        if (!regex.test(text)) return;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;

        // Reset regex for this text node
        regex.lastIndex = 0;

        while ((match = regex.exec(text)) !== null) {
            // Add text before match
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }

            // Create highlight span for the match
            const span = document.createElement('span');
            span.className = 'search-highlight';
            span.textContent = match[0];
            span.dataset.searchIndex = docSearchHighlightSpans.length;
            docSearchHighlightSpans.push(span);
            fragment.appendChild(span);

            lastIndex = regex.lastIndex;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        textNode.parentNode.replaceChild(fragment, textNode);
    });

    // Update match count and navigate to first match
    updateDocSearchCount();

    if (docSearchHighlightSpans.length > 0) {
        docSearchIndex = 0;
        highlightCurrentMatch();
    }
}

function navigateDocSearch(direction) {
    if (docSearchHighlightSpans.length === 0) return;

    // Remove current active highlight
    if (docSearchHighlightSpans[docSearchIndex]) {
        docSearchHighlightSpans[docSearchIndex].classList.remove('search-highlight-active');
    }

    // Update index with wrap-around
    docSearchIndex += direction;
    if (docSearchIndex < 0) {
        docSearchIndex = docSearchHighlightSpans.length - 1;
    } else if (docSearchIndex >= docSearchHighlightSpans.length) {
        docSearchIndex = 0;
    }

    highlightCurrentMatch();
    updateDocSearchCount();
}

function highlightCurrentMatch() {
    if (!docSearchHighlightSpans[docSearchIndex]) return;

    const currentSpan = docSearchHighlightSpans[docSearchIndex];
    currentSpan.classList.add('search-highlight-active');

    // Scroll into view
    currentSpan.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}

function updateDocSearchCount() {
    const total = docSearchHighlightSpans.length;
    const current = total > 0 ? docSearchIndex + 1 : 0;
    el.docSearchCount.textContent = `${current}/${total}`;

    // Enable/disable navigation buttons
    el.docSearchPrev.disabled = total === 0;
    el.docSearchNext.disabled = total === 0;
}

function clearDocSearchHighlights() {
    // Remove all highlight spans and restore original text
    docSearchHighlightSpans.forEach(span => {
        const parent = span.parentNode;
        if (parent) {
            const text = document.createTextNode(span.textContent);
            parent.replaceChild(text, span);
            // Normalize to merge adjacent text nodes
            parent.normalize();
        }
    });

    docSearchHighlightSpans = [];
    docSearchIndex = 0;
    updateDocSearchCount();
}

function getCurrentContentContainer() {
    // Determine which content container is currently visible
    if (el.docContent && el.docContent.offsetParent !== null) {
        return el.docContent;
    }
    if (el.docContentSingle && el.docContentSingle.offsetParent !== null) {
        return el.docContentSingle;
    }
    if (el.docPreview && el.docPreview.offsetParent !== null) {
        return el.docPreview;
    }
    // Default to docContent
    return el.docContent;
}

// Show/hide document search toggle button based on document visibility
function updateDocSearchButton() {
    const isDocumentVisible = el.document.style.display !== 'none';
    el.docSearchToggle.style.display = isDocumentVisible ? 'flex' : 'none';

    // Close search bar if document is hidden
    if (!isDocumentVisible) {
        closeDocSearch();
    }
}
