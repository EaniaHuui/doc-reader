/**
 * Notion-Style Doc Reader — main application
 * Pure helpers: static/js/utils.js, static/js/theme.js
 */

// State
let currentPath = null;          // root-relative path
let currentRootId = null;        // opaque root id
let currentRevision = null;      // opaque revision for optimistic concurrency
let currentDocType = null;
let rootsById = {};              // root_id -> {root_id, name, path}
let currentRawContent = null;  // Store raw markdown content
const API_V1 = '/api/v1';

function treeKey(rootId, relPath) {
    return `${rootId || ''}::${relPath || ''}`;
}

function parseTreeKey(key) {
    if (!key || !key.includes('::')) return { rootId: null, path: key || '' };
    const idx = key.indexOf('::');
    return { rootId: key.slice(0, idx), path: key.slice(idx + 2) };
}
let searchTimeout = null;
let isSearchOpen = false;
let sidebarCollapsed = false;
let isResizing = false;
let showEmptyDirectories = false;  // Whether to show empty directories
let showTxtFiles = false;           // Whether to show .txt files
let showJsonFiles = false;          // Whether to show .json files
let showImageFiles = true;          // Whether to show image files
let allExpanded = false;            // Whether all directories are expanded
let sourceViewMode = 'normal';      // 'normal', 'source', 'split'
let isEditMode = false;             // Edit mode state
let shareLinksCache = [];
let directoryOptionsCache = [];
let expandedPathsCache = null;      // In-memory cache of expanded directory paths
let expandedPathsCacheRaw = null;   // Raw localStorage snapshot used to build the cache

// Document search state
let docSearchMatches = [];          // Array of match elements
let docSearchIndex = 0;             // Current match index
let docSearchQuery = '';            // Current search query
let docSearchHighlightSpans = [];   // Array of highlight spans

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
    imageFilterBtn: $('imageFilterBtn'),
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
    // Move item modal elements
    moveItemModal: $('moveItemModal'),
    closeMoveItem: $('closeMoveItem'),
    moveItemForm: $('moveItemForm'),
    moveItemSourcePath: $('moveItemSourcePath'),
    moveItemTargetDir: $('moveItemTargetDir'),
    moveItemDestinationPath: $('moveItemDestinationPath'),
    moveItemError: $('moveItemError'),
    moveItemCancelBtn: $('moveItemCancelBtn'),
    moveItemConfirmBtn: $('moveItemConfirmBtn'),
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
    createDirConfirmBtn: $('createDirConfirmBtn'),
    // AI settings elements
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initSidebarWidth();
    initTreeFilter();
    initFileFilters();
    initShortcutHints();
    checkAuthStatus().then(() => {
        loadDirectories().then(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const rootId = urlParams.get('root_id');
            const pathParam = urlParams.get('path');
            const fileParam = urlParams.get('file');
            if (rootId && pathParam) {
                loadFile(rootId, decodeURIComponent(pathParam));
            } else if (fileParam) {
                // Legacy deep link: unsupported without root — show welcome
                console.warn('Legacy ?file= deep link is deprecated; use root_id+path');
            }
        });
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

    // Mobile pairing (optional button; also exposed on auth button context)
    const pairingBtn = document.getElementById('pairingBtn');
    if (pairingBtn) {
        pairingBtn.addEventListener('click', openPairingModal);
    }
    // Double-click username opens pairing when authenticated
    if (el.authBtn) {
        el.authBtn.addEventListener('dblclick', (e) => {
            if (authToken) {
                e.preventDefault();
                openPairingModal();
            }
        });
    }


    // Home button
    el.workspaceHome.addEventListener('click', goHome);

    // Sidebar toggle
    el.collapseSidebar.addEventListener('click', toggleSidebar);
    el.expandSidebar.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            openMobileSidebar();
        } else {
            el.sidebar.classList.remove('collapsed');
            sidebarCollapsed = false;
        }
    });
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    }

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

    // Move item modal
    el.closeMoveItem.addEventListener('click', closeMoveItemModal);
    el.moveItemModal.querySelector('.modal-backdrop').addEventListener('click', closeMoveItemModal);
    el.moveItemCancelBtn.addEventListener('click', closeMoveItemModal);
    el.moveItemConfirmBtn.addEventListener('click', confirmMoveItem);
    el.moveItemTargetDir.addEventListener('change', updateMoveDestinationPreview);
    el.moveItemForm.addEventListener('submit', (e) => {
        e.preventDefault();
        confirmMoveItem();
    });

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
    el.imageFilterBtn.addEventListener('click', toggleImageFilter);
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
        if (el.moveItemModal.classList.contains('visible')) {
            closeMoveItemModal();
        }
    }
}


// Authentication: static/js/auth.js

// ========================================
// Directory Tree
// ========================================

let directoryTreeData = [];

function buildTreeUrl(rootId, path = null) {
    const params = new URLSearchParams({ root_id: rootId });
    if (path) params.append('path', path);
    return `${API_V1}/tree?${params.toString()}`;
}

function filterTreeEntries(entries) {
    return (entries || []).filter(entry => {
        if (entry.kind === 'directory' || entry.type === 'directory') return true;
        const t = entry.type;
        if (t === 'markdown') return true;
        if (t === 'txt') return showTxtFiles;
        if (t === 'json') return showJsonFiles;
        if (t === 'image') return showImageFiles;
        return false;
    }).map(entry => {
        const kind = entry.kind || entry.type;
        if (kind === 'directory') {
            return {
                name: entry.name,
                path: entry.path,
                root_id: entry.root_id,
                type: 'directory',
                kind: 'directory',
                children: [],
                children_loaded: false,
                has_children: true,
                is_empty: false,
                modified_at: entry.modified_at,
            };
        }
        const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop().toLowerCase() : '';
        return {
            name: entry.name,
            path: entry.path,
            root_id: entry.root_id,
            type: 'file',
            kind: 'file',
            docType: entry.type,
            ext,
            modified_at: entry.modified_at,
            size_bytes: entry.size_bytes,
        };
    });
}

function shouldShowDirectoryNode(node) {
    if (showEmptyDirectories) {
        return true;
    }
    if (node.type !== 'directory') {
        return true;
    }
    return node.has_children || (Array.isArray(node.children) && node.children.length > 0);
}

function getVisibleTreeNodes(nodes) {
    return nodes.filter(node => shouldShowDirectoryNode(node));
}

function collectDirectoryOptions(nodes, result = []) {
    nodes.forEach(node => {
        if (node?.type !== 'directory') return;
        result.push({
            path: node.path,
            name: node.name,
            root_id: node.root_id,
            treeKey: node.treeKey || treeKey(node.root_id, node.path),
        });
        if (Array.isArray(node.children) && node.children.length > 0) {
            collectDirectoryOptions(node.children, result);
        }
    });
    return result;
}

function findNodeByPath(pathOrKey, nodes = directoryTreeData) {
    for (const node of nodes) {
        const key = node.treeKey || treeKey(node.root_id, node.path);
        if (node?.path === pathOrKey || key === pathOrKey) {
            return node;
        }
        if (node?.type === 'directory' && Array.isArray(node.children) && node.children.length > 0) {
            const match = findNodeByPath(path, node.children);
            if (match) {
                return match;
            }
        }
    }
    return null;
}

function updateDirectoryOptionsCache() {
    directoryOptionsCache = collectDirectoryOptions(directoryTreeData);
}

function ensureDefaultExpandedRoots() {
    const expandedPaths = getExpandedPaths();
    if (expandedPaths.size > 0) {
        return;
    }
    directoryTreeData.forEach(node => {
        if (node?.type === 'directory') {
            expandedPaths.add(node.treeKey || treeKey(node.root_id, node.path));
        }
    });
    persistExpandedPaths(expandedPaths);
}

async function fetchDirectoryChildren(rootId, relPath) {
    const response = await authFetch(buildTreeUrl(rootId, relPath || null));
    const data = await response.json();
    if (!response.ok) {
        throw new Error(apiErrorMessage(data, '加载目录失败'));
    }
    const entries = filterTreeEntries(data.entries || []);
    return entries.map(entry => ({
        ...entry,
        root_id: rootId,
        treeKey: treeKey(rootId, entry.path),
    }));
}

async function ensureDirectoryLoaded(nodeOrKey) {
    let node = typeof nodeOrKey === 'object' ? nodeOrKey : findNodeByPath(nodeOrKey);
    if (!node || node.type !== 'directory') {
        return null;
    }
    if (node.children_loaded) {
        return node;
    }

    const children = await fetchDirectoryChildren(node.root_id, node.path || '');
    node.children = children;
    node.children_loaded = true;
    node.has_children = children.length > 0;
    node.is_empty = children.length === 0;
    updateDirectoryOptionsCache();
    return node;
}

async function restoreExpandedDirectories() {
    const expandedPaths = Array.from(getExpandedPaths())
        .sort((a, b) => a.split('/').length - b.split('/').length);

    // Group by depth so parents finish loading before children are resolved.
    // Same-depth nodes can still load concurrently.
    const byDepth = new Map();
    for (const path of expandedPaths) {
        const depth = path.split('/').length;
        if (!byDepth.has(depth)) byDepth.set(depth, []);
        byDepth.get(depth).push(path);
    }

    const concurrency = 6;
    const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
    for (const depth of depths) {
        const pathsAtDepth = byDepth.get(depth);
        for (let index = 0; index < pathsAtDepth.length; index += concurrency) {
            const batch = pathsAtDepth.slice(index, index + concurrency);
            await Promise.all(batch.map(async (path) => {
                const node = findNodeByPath(path);
                if (!node || node.type !== 'directory' || node.children_loaded || !node.has_children) {
                    return;
                }
                try {
                    await ensureDirectoryLoaded(path);
                } catch (error) {
                    console.error(`Failed to restore directory ${path}:`, error);
                }
            }));
        }
    }
}

function findTreeItemElement(pathOrKey) {
    if (!el.treeItems) return null;
    let row = el.treeItems.querySelector(`.tree-row[data-key="${CSS.escape(pathOrKey)}"]`);
    if (!row) {
        row = el.treeItems.querySelector(`.tree-row[data-path="${CSS.escape(pathOrKey)}"]`);
    }
    return row ? row.closest('.tree-item') : null;
}

function getOrCreateTreeChildrenContainer(item) {
    let children = item.querySelector(':scope > .tree-children');
    if (!children) {
        children = document.createElement('div');
        children.className = 'tree-children';
        item.appendChild(children);
    }
    return children;
}

function mountDirectoryChildren(item, node, level) {
    const children = getOrCreateTreeChildrenContainer(item);
    children.innerHTML = '';

    const fragment = document.createDocumentFragment();
    getVisibleTreeNodes(node.children || []).forEach(child => {
        fragment.appendChild(renderTree(child, level + 1));
    });
    children.appendChild(fragment);
    return children;
}

function collapseDirectoryItem(item, nodePath, expandedPaths = getExpandedPaths()) {
    if (!item) return;

    item.classList.remove('expanded');
    const children = item.querySelector(':scope > .tree-children');
    if (children) {
        children.innerHTML = '';
    }

    // Drop nested expanded paths so restore/render stay proportional to visible state.
    let changed = expandedPaths.delete(nodePath);
    for (const path of Array.from(expandedPaths)) {
        if (path.startsWith(nodePath + '/')) {
            expandedPaths.delete(path);
            changed = true;
        }
    }
    if (changed) {
        persistExpandedPaths(expandedPaths);
    }
}

function expandDirectoryItem(item, node, level, expandedPaths = getExpandedPaths()) {
    if (!item || !node) return;

    mountDirectoryChildren(item, node, level);
    item.classList.add('expanded');
    item.classList.toggle(
        'no-children',
        !(node.has_children || getVisibleTreeNodes(node.children || []).length > 0)
    );

    if (!expandedPaths.has(node.treeKey || treeKey(node.root_id, node.path))) {
        expandedPaths.add(node.treeKey || treeKey(node.root_id, node.path));
        persistExpandedPaths(expandedPaths);
    }
}

function getTreeNodeLevel(item) {
    let level = 0;
    let parent = item?.parentElement;
    while (parent && parent !== el.treeItems) {
        if (parent.classList?.contains('tree-children')) {
            level += 1;
        }
        parent = parent.parentElement;
    }
    return level;
}

function renderDirectoryTree() {
    const visibleDirectories = getVisibleTreeNodes(directoryTreeData);
    const expandedPaths = getExpandedPaths();
    el.treeItems.innerHTML = '';

    if (visibleDirectories.length === 0) {
        el.treeItems.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
                暂无页面
            </div>
        `;
        updateDirectoryOptionsCache();
        updateExpandAllButton();
        return;
    }

    const fragment = document.createDocumentFragment();
    visibleDirectories.forEach(dir => {
        fragment.appendChild(renderTree(dir, 0, expandedPaths));
    });
    el.treeItems.appendChild(fragment);

    updateDirectoryOptionsCache();
    updateExpandAllButton();

    if (currentPath) {
        highlightTreeItem(currentPath, {scrollIntoView: false});
    }
}

async function loadDirectories() {
    try {
        const response = await authFetch(`${API_V1}/bootstrap`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(apiErrorMessage(data, '加载目录列表失败'));
        }

        const roots = Array.isArray(data.roots) ? data.roots : [];
        rootsById = {};
        roots.forEach(r => { rootsById[r.root_id] = r; });

        directoryTreeData = roots.map(root => ({
            name: root.name,
            path: '',
            root_id: root.root_id,
            treeKey: treeKey(root.root_id, ''),
            type: 'directory',
            kind: 'directory',
            children: [],
            children_loaded: false,
            has_children: true,
            is_empty: false,
            is_root: true,
        }));
        ensureDefaultExpandedRoots();
        await restoreExpandedDirectories();
        renderDirectoryTree();
    } catch (error) {
        console.error('Failed to load directories:', error);
        el.treeItems.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
                加载页面失败
            </div>
        `;
        directoryTreeData = [];
        directoryOptionsCache = [];
        updateExpandAllButton();
    }
}

async function toggleDirectoryNode(node) {
    if (node.type !== 'directory') {
        return;
    }

    const expandable = node.has_children || (node.children_loaded && node.children.length > 0);
    if (!expandable) {
        return;
    }

    const key = node.treeKey || treeKey(node.root_id, node.path);
    const expandedPaths = getExpandedPaths();
    const isExpanded = expandedPaths.has(key);
    const item = findTreeItemElement(key);

    if (isExpanded) {
        if (item) {
            collapseDirectoryItem(item, key, expandedPaths);
        } else {
            expandedPaths.delete(key);
            persistExpandedPaths(expandedPaths);
            renderDirectoryTree();
        }
        updateExpandAllButton();
        return;
    }

    if (!node.children_loaded) {
        if (item) {
            item.classList.add('loading');
        }
        try {
            await ensureDirectoryLoaded(node);
        } catch (error) {
            console.error(`Failed to expand directory ${key}:`, error);
            showToast(error.message || '加载目录失败');
            return;
        } finally {
            if (item) {
                item.classList.remove('loading');
            }
        }
    }

    if (item) {
        expandDirectoryItem(item, node, getTreeNodeLevel(item), expandedPaths);
    } else {
        expandedPaths.add(key);
        persistExpandedPaths(expandedPaths);
        renderDirectoryTree();
    }
    updateExpandAllButton();
}

// Pre-parsed SVG templates — clone instead of re-parsing innerHTML per row.
const TREE_SVG_HTML = {
    toggle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    md: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>',
    txt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>',
    json: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12h1"/><path d="M14 12h1"/><path d="M10 16h1"/><path d="M14 16h1"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    move: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></svg>',
    add: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    trash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    fileOpt: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    dirOpt: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
};

const treeSvgCache = new Map();

function cloneTreeSvg(name) {
    let cached = treeSvgCache.get(name);
    if (!cached) {
        const template = document.createElement('template');
        template.innerHTML = TREE_SVG_HTML[name];
        cached = template.content.firstElementChild;
        treeSvgCache.set(name, cached);
    }
    return cached.cloneNode(true);
}

function treeFileIconName(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'md') return 'md';
    if (ext === 'txt') return 'txt';
    if (ext === 'json') return 'json';
    if (isImageExtension(ext)) return 'image';
    return 'md';
}

function showTreeActionButtons(row) {
    const actionButtons = ensureTreeActionButtons(row);
    if (actionButtons) {
        actionButtons.style.display = 'flex';
    }
}

function hideTreeActionButtons(row) {
    const actionButtons = row.querySelector(':scope > .tree-action-buttons');
    if (actionButtons) {
        actionButtons.style.display = 'none';
    }
}

/**
 * Build hover/touch action controls on demand.
 * Large directories stay cheap until the user actually interacts with a row.
 */
function ensureTreeActionButtons(row) {
    if (!row) return null;
    let actionButtons = row.querySelector(':scope > .tree-action-buttons');
    if (actionButtons) {
        return actionButtons;
    }

    const path = row.dataset.path || '';
    const key = row.dataset.key || treeKey(row.dataset.rootId, path);
    const nodeType = row.dataset.type;
    const nodeName = row.dataset.name || '';
    if (!nodeType || !row.dataset.rootId) {
        return null;
    }

    actionButtons = document.createElement('div');
    actionButtons.className = 'tree-action-buttons';
    actionButtons.style.cssText = 'display: none; align-items: center; gap: 2px; margin-left: auto;';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'tree-copy-btn';
    copyBtn.type = 'button';
    copyBtn.title = '复制路径';
    copyBtn.appendChild(cloneTreeSvg('copy'));
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        copyTreePath(path || key);
    });
    actionButtons.appendChild(copyBtn);

    const moveBtn = document.createElement('button');
    moveBtn.className = 'tree-move-btn';
    moveBtn.type = 'button';
    moveBtn.title = nodeType === 'directory' ? '移动目录' : '移动文件';
    moveBtn.appendChild(cloneTreeSvg('move'));
    moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openMoveItemModal(key, nodeName, nodeType);
    });
    actionButtons.appendChild(moveBtn);

    if (nodeType === 'directory') {
        const addBtn = document.createElement('button');
        addBtn.className = 'tree-add-btn';
        addBtn.type = 'button';
        addBtn.title = '新建文件或目录';
        addBtn.appendChild(cloneTreeSvg('add'));

        const dropdown = document.createElement('div');
        dropdown.className = 'tree-dropdown';
        dropdown.hidden = true;

        const newFileOption = document.createElement('div');
        newFileOption.className = 'tree-dropdown-item';
        newFileOption.appendChild(cloneTreeSvg('fileOpt'));
        const newFileLabel = document.createElement('span');
        newFileLabel.textContent = '新建文件';
        newFileOption.appendChild(newFileLabel);
        newFileOption.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            hideAllDropdowns();
            openCreateFileModal(key);
        });

        const newDirOption = document.createElement('div');
        newDirOption.className = 'tree-dropdown-item';
        newDirOption.appendChild(cloneTreeSvg('dirOpt'));
        const newDirLabel = document.createElement('span');
        newDirLabel.textContent = '新建目录';
        newDirOption.appendChild(newDirLabel);
        newDirOption.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            hideAllDropdowns();
            openCreateDirModal(key);
        });

        dropdown.appendChild(newFileOption);
        dropdown.appendChild(newDirOption);

        const addBtnContainer = document.createElement('div');
        addBtnContainer.className = 'tree-add-btn-wrap';
        addBtnContainer.appendChild(addBtn);
        addBtnContainer.appendChild(dropdown);

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const isVisible = !dropdown.hidden && dropdown.style.display !== 'none';
            hideAllDropdowns();
            if (!isVisible) {
                dropdown.hidden = false;
                dropdown.style.display = 'block';
            }
        });

        actionButtons.insertBefore(addBtnContainer, actionButtons.firstChild);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tree-delete-btn';
        deleteBtn.type = 'button';
        deleteBtn.title = '删除目录';
        deleteBtn.appendChild(cloneTreeSvg('trash'));
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            openDeleteDirConfirm(key, nodeName);
        });
        actionButtons.appendChild(deleteBtn);
    }

    row.appendChild(actionButtons);
    return actionButtons;
}

function renderTree(node, level, expandedPaths = getExpandedPaths()) {
    const item = document.createElement('div');
    item.className = 'tree-item';

    const isDirectory = node.type === 'directory';
    const isExpanded = isDirectory && expandedPaths.has(node.treeKey || treeKey(node.root_id, node.path));
    const hasRenderedChildren = isDirectory
        && Array.isArray(node.children)
        && getVisibleTreeNodes(node.children).length > 0;
    const canExpand = isDirectory && (node.has_children || hasRenderedChildren);
    if (isDirectory && !canExpand) {
        item.classList.add('no-children');
    }

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.path = node.path;
    row.dataset.rootId = node.root_id || '';
    row.dataset.key = node.treeKey || treeKey(node.root_id, node.path);
    row.dataset.type = node.type;
    row.dataset.name = node.name;

    const toggle = document.createElement('div');
    toggle.className = 'tree-toggle';
    if (isDirectory) {
        toggle.appendChild(cloneTreeSvg('toggle'));
    }
    row.appendChild(toggle);

    const icon = document.createElement('div');
    icon.className = 'tree-icon';
    icon.appendChild(cloneTreeSvg(isDirectory ? 'folder' : treeFileIconName(node.name)));
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;
    row.appendChild(label);

    // Action buttons are created on first hover / touch activation.
    if (!isTouchInteractionMode()) {
        row.addEventListener('mouseenter', () => showTreeActionButtons(row));
        row.addEventListener('mouseleave', () => hideTreeActionButtons(row));
    }

    item.appendChild(row);

    if (isDirectory) {
        // Only mount children for expanded directories so collapsed branches stay cheap.
        if (isExpanded) {
            mountDirectoryChildren(item, node, level);
            item.classList.add('expanded');
        } else {
            const children = document.createElement('div');
            children.className = 'tree-children';
            item.appendChild(children);
        }

        const handleToggle = async (e) => {
            if (e.target.closest('.tree-action-buttons, .tree-dropdown')) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            setActiveRow(row);
            await toggleDirectoryNode(node);
        };

        toggle.addEventListener('click', handleToggle);
        row.addEventListener('click', handleToggle);
    } else {
        row.addEventListener('click', () => {
            loadFile(node.root_id, node.path, node.name);
            setActiveRow(row);

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
        showTreeActionButtons(row);
    }
}

// ========================================
// File Loading
// ========================================

async function loadFile(rootIdOrPath, pathOrName, maybeName) {
    try {
        // Support loadFile(rootId, path, name?) and legacy loadFile(path)
        let rootId = rootIdOrPath;
        let filePath = pathOrName;
        let fileName = maybeName;
        if (pathOrName === undefined || (typeof pathOrName === 'string' && !rootsById[rootIdOrPath] && !rootIdOrPath.startsWith('root_'))) {
            // ambiguous legacy: try treat as path only if root known
            filePath = rootIdOrPath;
            fileName = pathOrName;
            rootId = currentRootId;
        }
        if (!rootId) {
            showError('缺少文档根');
            return false;
        }

        currentRootId = rootId;
        currentPath = filePath;

        // On mobile, close the drawer after picking a page so content is readable.
        if (window.innerWidth <= 768) {
            closeMobileSidebar();
        }

        const docTypeHint = filePath && filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : '';
        const isImageExt = isImageExtension(docTypeHint);

        let data;
        let isImageFile = isImageExt;

        if (isImageFile) {
            const summaryName = fileName || filePath.split('/').pop();
            data = {
                title: summaryName,
                path: filePath,
                modified: '',
                content: `<div class="image-file-viewer"><img src="${assetUrl(rootId, filePath)}" alt="${escapeHtml(summaryName)}"></div>`,
                raw: null,
                fileType: 'image',
                revision: null,
                type: 'image',
            };
            currentRawContent = null;
            currentRevision = null;
            currentDocType = 'image';
        } else {
            const qs = new URLSearchParams({ root_id: rootId, path: filePath });
            const response = await authFetch(`${API_V1}/documents?${qs}`);
            const payload = await response.json();
            if (!response.ok) {
                showError(apiErrorMessage(payload, '加载文件失败'));
                return false;
            }
            const doc = payload.document || payload;
            currentRawContent = doc.raw_content ?? null;
            currentRevision = doc.revision || null;
            currentDocType = doc.type || 'markdown';

            // Render HTML for reading view
            let htmlContent = '';
            if (currentDocType === 'markdown' || currentDocType === 'md') {
                const rr = await authFetch(`${API_V1}/render`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: currentRawContent || '', path: filePath }),
                });
                const rd = await rr.json();
                htmlContent = rr.ok ? (rd.content || '') : `<pre>${escapeHtml(currentRawContent || '')}</pre>`;
            } else if (currentDocType === 'json') {
                const rr = await authFetch(`${API_V1}/render`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: currentRawContent || '', path: filePath }),
                });
                const rd = await rr.json();
                htmlContent = rr.ok ? (rd.content || '') : `<pre>${escapeHtml(currentRawContent || '')}</pre>`;
            } else {
                const rr = await authFetch(`${API_V1}/render`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: currentRawContent || '', path: filePath }),
                });
                const rd = await rr.json();
                htmlContent = rr.ok ? (rd.content || '') : `<pre>${escapeHtml(currentRawContent || '')}</pre>`;
            }

            data = {
                title: doc.title || fileName || filePath.split('/').pop(),
                path: doc.path || filePath,
                modified: (doc.modified_at || '').replace('T', ' ').replace('Z', ''),
                content: htmlContent,
                raw: currentRawContent,
                revision: currentRevision,
                type: currentDocType,
            };

            // Record recent
            authFetch(`${API_V1}/documents/opened`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ root_id: rootId, path: filePath }),
            }).catch(() => {});
        }

        // Restore source view mode from localStorage
        const savedViewMode = isImageFile ? 'normal' : (localStorage.getItem('sourceViewMode') || 'normal');
        sourceViewMode = savedViewMode;
        el.document.classList.remove('split-mode', 'source-mode');
        el.main.classList.remove('split-mode', 'source-mode');
        el.sourceToggle.classList.remove('active');
        el.document.classList.toggle('image-mode', isImageFile);
        el.topbar.classList.toggle('image-mode', isImageFile);

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
        el.docPath.textContent = displayDocPath((rootsById[rootId] && rootsById[rootId].name) || '', data.path || filePath);
        el.docTime.textContent = data.modified || '';
        el.docContent.innerHTML = data.content;

        // Update single view content for mobile
        if (el.docContentSingle) {
            el.docContentSingle.innerHTML = data.content;
        }

        // Update source view content
        if (el.docSource) {
            el.docSource.textContent = currentRawContent || '';
        }
        if (el.docSourceSingle) {
            el.docSourceSingle.textContent = currentRawContent || '';
        }

        // Helper function to process images
        const processImages = (container) => {
            container.querySelectorAll('img').forEach(img => {
                const originalSrc = img.getAttribute('src');
                if (isHttpUrl(originalSrc)) {
                    img.src = remoteImageProxyUrl(originalSrc);
                } else if (originalSrc && !originalSrc.startsWith('data:') && !originalSrc.startsWith('/api/')) {
                    const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
                    const rel = joinRootRelative(fileDir, originalSrc);
                    img.src = assetUrl(rootId, rel);
                }
            });
        };

        // Helper function to process internal links
        const processLinks = (container) => {
            container.querySelectorAll('a').forEach(link => {
                const href = link.getAttribute('href');
                if (isHttpUrl(href)) {
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                } else if (href && !href.startsWith('#') && !href.startsWith('mailto:')) {
                    const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
                    const rel = joinRootRelative(fileDir, href);
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        loadFile(rootId, rel);
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
                        count.textContent = isEmpty ? '' : ` ${len} ${type === 'array' ? '项' : '个键'} `;
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
                    <button class="json-btn" id="jsonCopy">复制 JSON</button>
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
                        showToast('JSON 已复制');
                    }).catch(() => {
                        showToast('复制失败');
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
        highlightTreeItem(filePath, {scrollIntoView: true});

        // Update URL without reloading
        const newUrl = new URL(window.location);
        newUrl.searchParams.delete('file');
        newUrl.searchParams.set('root_id', rootId);
        newUrl.searchParams.set('path', filePath);
        window.history.replaceState({}, '', newUrl);

        // Scroll to top (callers that need in-doc jump will scroll to the hit after this)
        window.scrollTo(0, 0);

        return true;
    } catch (error) {
        console.error('Failed to load file:', error);
        showError('加载文档失败');
        return false;
    }
}

function showError(message) {
    el.welcome.style.display = 'none';
    el.document.style.display = 'block';
    el.document.classList.remove('image-mode');
    el.topbar.classList.remove('image-mode');

    el.docTitle.textContent = '出错了';
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
            输入关键词，搜索全部页面...
        </div>
    `;
}

async function performSearch(query) {
    el.searchResults.innerHTML = `
        <div class="search-placeholder">搜索中…</div>
    `;

    try {
        const response = await authFetch(`${API_V1}/search?q=${encodeURIComponent(query)}`);
        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (response.status === 401) {
            el.searchResults.innerHTML = `
                <div class="search-placeholder">请先登录后再搜索</div>
            `;
            return;
        }

        if (!response.ok) {
            const msg = apiErrorMessage(payload, `搜索失败 (${response.status})`);
            el.searchResults.innerHTML = `
                <div class="search-placeholder">${escapeHtml(String(msg))}</div>
            `;
            return;
        }

        const results = (payload && Array.isArray(payload.results)) ? payload.results : null;
        if (!results) {
            el.searchResults.innerHTML = `
                <div class="search-placeholder">搜索返回格式异常</div>
            `;
            return;
        }

        displaySearchResults(results, query);
    } catch (error) {
        console.error('Search failed:', error);
        el.searchResults.innerHTML = `
            <div class="search-placeholder">
                搜索失败，请检查网络后重试
            </div>
        `;
    }
}

function displaySearchResults(results, query = '') {
    if (!Array.isArray(results) || results.length === 0) {
        el.searchResults.innerHTML = `
            <div class="search-placeholder">
                未找到结果
            </div>
        `;
        return;
    }

    el.searchResults.innerHTML = results.map((result) => {
        const doc = result.document || result;
        const path = doc.path || '';
        const rootId = doc.root_id || '';
        const name = doc.title || path.split('/').pop() || '未命名';
        const dirLabel = (rootsById[rootId] && rootsById[rootId].name) || rootId || '';
        const snippet = result.snippet || '';
        const matchKind = result.title_match ? 'name' : 'content';
        const matchLabel = matchKind === 'name' ? '标题' : '正文';
        return `
        <div class="search-result" role="option" data-path="${escapeHtml(path)}" data-root-id="${escapeHtml(rootId)}" data-query="${escapeHtml(query)}" data-match="${matchKind}" tabindex="0">
            <div class="search-result-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
            </div>
            <div class="search-result-info">
                <div class="search-result-title">${escapeHtml(name)}</div>
                <div class="search-result-path">${escapeHtml(dirLabel)} · ${matchLabel}</div>
                ${snippet ? `<div class="search-result-snippet">${escapeHtml(snippet)}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    const openResult = async (item) => {
        const path = item.getAttribute('data-path');
        const rootId = item.getAttribute('data-root-id');
        const q = item.getAttribute('data-query') || '';
        const matchKind = item.getAttribute('data-match') || 'content';
        if (!path) return;
        closeSearch();
        const ok = await loadFile(rootId, path);
        if (!ok || !q) return;
        await jumpToSearchHitInDocument(q, matchKind);
    };

    el.searchResults.querySelectorAll('.search-result').forEach(item => {
        item.addEventListener('click', () => openResult(item));
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                openResult(item);
            }
        });
    });
}

/**
 * After opening a file from 跨库搜索: locate first hit in the 阅读视图.
 * matchKind: 'name' | 'content' (from API). Filename-only → toast, no fake highlight.
 */
async function jumpToSearchHitInDocument(query, matchKind) {
    if (!query) return;

    // Wait two frames so layout/paint catch up after innerHTML + hljs.
    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    if (matchKind === 'name') {
        showToast('已打开（文件名匹配）');
        return;
    }

    if (!el.docSearchBar || !el.docSearchInput) {
        showToast('已打开，正文中未定位到关键词');
        return;
    }

    openDocSearch();
    el.docSearchInput.value = query;
    docSearchQuery = query;
    const count = performDocSearch(query);

    if (!count) {
        closeDocSearch();
        showToast('已打开，正文中未定位到关键词');
    }
}

/** Open the in-document find bar and run a query (manual / programmatic). */
function openDocSearchWithQuery(query) {
    if (!el.docSearchBar || !el.docSearchInput || !query) return;
    openDocSearch();
    el.docSearchInput.value = query;
    docSearchQuery = query;
    return performDocSearch(query);
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
    el.document.classList.remove('split-mode', 'source-mode', 'image-mode');
    el.topbar.classList.remove('image-mode');
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
        loadFile(currentRootId, currentPath).then(() => {
            setTimeout(() => {
                el.refreshBtn.classList.remove('spinning');
            }, 300);
            showToast('已刷新');
        });
    } else {
        setTimeout(() => {
            el.refreshBtn.classList.remove('spinning');
        }, 300);
        showToast('已刷新');
    }
}

function toggleSourceView() {
    if (!currentRawContent) {
        showToast('没有可显示的源码');
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

function setMobileSidebarOpen(isOpen) {
    const backdrop = document.getElementById('sidebarBackdrop');
    if (isOpen) {
        el.sidebar.classList.add('open');
        if (backdrop) {
            backdrop.hidden = false;
            backdrop.classList.add('visible');
        }
        sidebarCollapsed = false;
    } else {
        el.sidebar.classList.remove('open');
        if (backdrop) {
            backdrop.classList.remove('visible');
            backdrop.hidden = true;
        }
        sidebarCollapsed = true;
    }
}

function openMobileSidebar() {
    setMobileSidebarOpen(true);
}

function closeMobileSidebar() {
    setMobileSidebarOpen(false);
}

function toggleSidebar() {
    if (window.innerWidth <= 768) {
        setMobileSidebarOpen(!el.sidebar.classList.contains('open'));
        return;
    }

    sidebarCollapsed = !sidebarCollapsed;
    el.sidebar.classList.toggle('collapsed', sidebarCollapsed);
}

// Theme helpers: static/js/theme.js (initTheme, toggleTheme, initShortcutHints)

// ========================================
// Copy Path
// ========================================

function copyPath() {
    if (!currentPath) return;
    copyText(currentPath, '路径已复制');
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
            showToast('复制失败');
        }
        document.body.removeChild(textarea);
    }
}


// Share Links: static/js/share.js

// formatShareTime: static/js/utils.js

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
        const response = await authFetch(`${API_V1}/admin/directories`);
        const cfg = await response.json();
        directoriesCache = (cfg && cfg.directories) ? cfg.directories : [];
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
            <button class="dir-item-remove" data-index="${index}" title="移除目录">
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
        el.dirSaveBtn.textContent = '保存中...';

        const response = await authFetch(`${API_V1}/admin/directories`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ directories: directoriesCache })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('目录配置已保存');
            closeDirConfig();
            await loadDirectories();
        } else {
            el.dirError.textContent = data.error || '保存目录失败';
            el.dirError.style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to save directories:', error);
        showToast('保存目录失败');
    } finally {
        el.dirSaveBtn.disabled = false;
        el.dirSaveBtn.textContent = '保存';
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
        el.dirError.textContent = '请填写目录名称和路径';
        el.dirError.style.display = 'block';
        return;
    }

    try {
        el.addDirConfirmBtn.disabled = true;
        el.addDirConfirmBtn.textContent = '添加中...';

        // Check if path is valid by temporarily adding to cache and validating
        const tempDir = { name, path };
        const testResponse = await authFetch(`${API_V1}/admin/directories`, {
            method: 'PUT',
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
            showToast('目录已添加');
        } else {
            el.dirError.textContent = testData.error || '添加目录失败';
            el.dirError.style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to add directory:', error);
        el.dirError.textContent = '添加目录失败';
        el.dirError.style.display = 'block';
    } finally {
        el.addDirConfirmBtn.disabled = false;
        el.addDirConfirmBtn.textContent = '添加';
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

async function toggleTreeFilter() {
    showEmptyDirectories = !showEmptyDirectories;
    localStorage.setItem('showEmptyDirectories', showEmptyDirectories);
    updateTreeFilterButton();
    await loadDirectories();
}

function updateTreeFilterButton() {
    if (showEmptyDirectories) {
        el.treeFilterBtn.classList.add('active');
        el.treeFilterBtn.querySelector('.icon-show-empty').style.display = 'none';
        el.treeFilterBtn.querySelector('.icon-hide-empty').style.display = 'block';
        el.treeFilterBtn.title = '隐藏空目录';
    } else {
        el.treeFilterBtn.classList.remove('active');
        el.treeFilterBtn.querySelector('.icon-show-empty').style.display = 'block';
        el.treeFilterBtn.querySelector('.icon-hide-empty').style.display = 'none';
        el.treeFilterBtn.title = '显示空目录';
    }
}

// ========================================
// File Type Filters
// ========================================

function initFileFilters() {
    const savedTxt = localStorage.getItem('showTxtFiles');
    const savedJson = localStorage.getItem('showJsonFiles');
    const savedImages = localStorage.getItem('showImageFiles');
    showTxtFiles = savedTxt === 'true';
    showJsonFiles = savedJson === 'true';
    showImageFiles = savedImages === null ? true : savedImages === 'true';
    updateFileFilterButtons();
}

async function toggleTxtFilter() {
    showTxtFiles = !showTxtFiles;
    localStorage.setItem('showTxtFiles', showTxtFiles);
    updateFileFilterButtons();
    await loadDirectories();
}

async function toggleJsonFilter() {
    showJsonFiles = !showJsonFiles;
    localStorage.setItem('showJsonFiles', showJsonFiles);
    updateFileFilterButtons();
    await loadDirectories();
}

async function toggleImageFilter() {
    showImageFiles = !showImageFiles;
    localStorage.setItem('showImageFiles', showImageFiles);
    updateFileFilterButtons();
    await loadDirectories();
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

    // Update image button
    if (showImageFiles) {
        el.imageFilterBtn.classList.add('active');
        el.imageFilterBtn.title = '隐藏图片';
    } else {
        el.imageFilterBtn.classList.remove('active');
        el.imageFilterBtn.title = '显示图片';
    }
}

// Hide all dropdown menus
function hideAllDropdowns() {
    document.querySelectorAll('.tree-dropdown').forEach(dropdown => {
        dropdown.hidden = true;
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
            showToast('路径已复制');
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
            showToast('路径已复制');
        } catch (err) {
            showToast('复制失败');
        }
        document.body.removeChild(textarea);
    }
}

// ========================================
// Expand/Collapse All Directories
// ========================================

function getExpandedPaths() {
    const saved = localStorage.getItem('expandedPaths');
    if (expandedPathsCache && expandedPathsCacheRaw === saved) {
        return expandedPathsCache;
    }

    expandedPathsCache = saved ? new Set(JSON.parse(saved)) : new Set();
    expandedPathsCacheRaw = saved;
    return expandedPathsCache;
}

function persistExpandedPaths(paths) {
    const list = paths instanceof Set ? Array.from(paths) : Array.from(paths || []);
    const raw = JSON.stringify(list);
    expandedPathsCache = new Set(list);
    expandedPathsCacheRaw = raw;
    localStorage.setItem('expandedPaths', raw);
    return expandedPathsCache;
}

function saveExpandedState() {
    const expandedItems = el.treeItems.querySelectorAll('.tree-item.expanded');
    const paths = [];
    expandedItems.forEach(item => {
        const row = item.querySelector('.tree-row');
        if (row?.dataset?.path) {
            paths.push(row.dataset.path);
        }
    });
    persistExpandedPaths(paths);
}

function getLoadedExpandableDirectoryPaths(nodes = directoryTreeData, result = []) {
    nodes.forEach(node => {
        if (node?.type !== 'directory') {
            return;
        }
        if (node.has_children || (node.children_loaded && node.children.length > 0)) {
            result.push(node.path);
        }
        if (Array.isArray(node.children) && node.children.length > 0) {
            getLoadedExpandableDirectoryPaths(node.children, result);
        }
    });
    return result;
}

function getRootDirectoryPaths() {
    return directoryTreeData
        .filter(node => node?.type === 'directory')
        .map(node => node.path);
}

function toggleExpandAll() {
    const loadedPaths = getLoadedExpandableDirectoryPaths();
    allExpanded = !allExpanded;

    if (allExpanded) {
        persistExpandedPaths(loadedPaths);
    } else {
        persistExpandedPaths(getRootDirectoryPaths());
    }

    renderDirectoryTree();
}

function updateExpandAllButton() {
    const expandIcon = el.expandAllBtn.querySelector('.icon-expand');
    const collapseIcon = el.expandAllBtn.querySelector('.icon-collapse');
    const loadedPaths = getLoadedExpandableDirectoryPaths();
    const expandedPaths = getExpandedPaths();
    allExpanded = loadedPaths.length > 0 && loadedPaths.every(path => expandedPaths.has(path));

    if (allExpanded) {
        expandIcon.style.display = 'none';
        collapseIcon.style.display = 'block';
        el.expandAllBtn.title = '折叠已加载目录';
    } else {
        expandIcon.style.display = 'block';
        collapseIcon.style.display = 'none';
        el.expandAllBtn.title = '展开已加载目录';
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

function highlightTreeItem(filePath, options = {}) {
    const {scrollIntoView = false} = options;
    document.querySelectorAll('.tree-row.active').forEach(r => {
        r.classList.remove('active');
    });

    const treeItems = el.treeItems.querySelectorAll('.tree-item');
    let targetRow = null;

    treeItems.forEach(item => {
        const row = item.querySelector('.tree-row');
        if (!row) return;
        if (row.dataset.key === filePath || row.dataset.path === filePath) {
            targetRow = row;
        }
        if (currentRootId && row.dataset.rootId === currentRootId && row.dataset.path === filePath) {
            targetRow = row;
        }
    });

    if (!targetRow) return;

    targetRow.classList.add('active');
    if (scrollIntoView) {
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
        el.deleteConfirmBtn.textContent = '删除中...';

        const response = await authFetch(`${API_V1}/entries`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                root_id: currentRootId,
                path: currentPath,
                if_match_revision: currentRevision || undefined,
            })
        });

        const data = await response.json();

        if (response.ok) {
            closeDeleteConfirm();
            showToast('文件已移入回收站');

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
            showToast(data.error || '删除文件失败');
        }
    } catch (error) {
        console.error('Delete failed:', error);
        showToast('删除文件失败');
    } finally {
        // Re-enable buttons
        el.deleteConfirmBtn.disabled = false;
        el.deleteConfirmBtn.textContent = '删除';
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
        el.deleteDirConfirmBtn.textContent = '删除中...';

        const node = findNodeByPath(deleteDirPath);
        const rootId = (node && node.root_id) || currentRootId;
        const relPath = (node && node.path !== undefined) ? node.path : parseTreeKey(deleteDirPath).path;
        const response = await authFetch(`${API_V1}/entries`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ root_id: rootId, path: relPath })
        });

        const data = await response.json();

        if (response.ok) {
            closeDeleteDirConfirm();
            showToast('目录已删除');

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
            showToast(data.error || '删除目录失败');
        }
    } catch (error) {
        console.error('Delete directory failed:', error);
        showToast('删除目录失败');
    } finally {
        // Re-enable buttons
        el.deleteDirConfirmBtn.disabled = false;
        el.deleteDirConfirmBtn.textContent = '删除';
    }
}

// ========================================
// Move Item
// ========================================

let moveItemSourcePath = null;
let moveItemName = null;
let moveItemType = null;

function openMoveItemModal(path, name, type) {
    moveItemSourcePath = path;
    moveItemName = name;
    moveItemType = type;

    el.moveItemSourcePath.textContent = simplifyPath(path);
    el.moveItemError.style.display = 'none';
    el.moveItemError.textContent = '';

    renderMoveTargetOptions();
    updateMoveDestinationPreview();

    el.moveItemModal.classList.add('visible');
    el.moveItemTargetDir.focus();
}

function closeMoveItemModal() {
    el.moveItemModal.classList.remove('visible');
    moveItemSourcePath = null;
    moveItemName = null;
    moveItemType = null;
    el.moveItemTargetDir.innerHTML = '';
    el.moveItemDestinationPath.textContent = '';
    el.moveItemError.style.display = 'none';
    el.moveItemError.textContent = '';
}

function renderMoveTargetOptions() {
    const currentParent = moveItemSourcePath?.includes('/')
        ? moveItemSourcePath.slice(0, moveItemSourcePath.lastIndexOf('/'))
        : '';
    const sourcePrefix = moveItemType === 'directory' ? `${moveItemSourcePath}/` : null;

    const options = directoryOptionsCache.filter(option => {
        if (option.path === currentParent) {
            return false;
        }
        if (option.path === moveItemSourcePath) {
            return false;
        }
        if (moveItemType === 'directory' && (option.path === moveItemSourcePath || option.path.startsWith(sourcePrefix))) {
            return false;
        }
        return true;
    });

    el.moveItemTargetDir.innerHTML = '';

    options.forEach(option => {
        const element = document.createElement('option');
        element.value = option.treeKey || treeKey(option.root_id, option.path);
        element.textContent = `${option.name} · ${displayDocPath((rootsById[option.root_id]||{}).name || '', option.path)}`;
        if (option.path === currentParent) {
            element.selected = true;
        }
        el.moveItemTargetDir.appendChild(element);
    });

    if (!options.length) {
        const element = document.createElement('option');
        element.value = '';
        element.textContent = '没有可用目标目录';
        el.moveItemTargetDir.appendChild(element);
        el.moveItemConfirmBtn.disabled = true;
        return;
    }

    el.moveItemConfirmBtn.disabled = false;
}

function updateMoveDestinationPreview() {
    const targetDirectory = el.moveItemTargetDir.value;
    if (!targetDirectory || !moveItemName) {
        el.moveItemDestinationPath.textContent = '';
        return;
    }
    el.moveItemDestinationPath.textContent = simplifyPath(`${targetDirectory}/${moveItemName}`);
}

async function confirmMoveItem() {
    if (!moveItemSourcePath) return;

    const targetDirectory = el.moveItemTargetDir.value;
    if (!targetDirectory) {
        el.moveItemError.textContent = '请选择目标目录';
        el.moveItemError.style.display = 'block';
        return;
    }

    try {
        el.moveItemConfirmBtn.disabled = true;
        el.moveItemConfirmBtn.textContent = '移动中...';

        const srcNode = findNodeByPath(moveItemSourcePath);
        const dstOpt = directoryOptionsCache.find(o => o.treeKey === targetDirectory || o.path === targetDirectory);
        const rootId = (srcNode && srcNode.root_id) || (dstOpt && dstOpt.root_id) || currentRootId;
        const fromPath = (srcNode && srcNode.path !== undefined) ? srcNode.path : parseTreeKey(moveItemSourcePath).path;
        const toDir = (dstOpt && dstOpt.path !== undefined) ? dstOpt.path : parseTreeKey(targetDirectory).path;
        const toPath = toDir ? `${toDir}/${moveItemName}` : moveItemName;
        const response = await authFetch(`${API_V1}/entries/move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                root_id: rootId,
                from_path: fromPath,
                to_path: toPath,
                if_match_revision: currentRevision || undefined,
            })
        });

        const data = await response.json();

        if (!response.ok) {
            el.moveItemError.textContent = apiErrorMessage(data, '移动失败');
            el.moveItemError.style.display = 'block';
            return;
        }

        const movedFrom = fromPath;
        const movedTo = data.to_path || toPath;
        const wasCurrentFile = currentPath && currentRootId === rootId && currentPath === movedFrom;
        const currentFileInsideMovedDir = moveItemType === 'directory' && currentRootId === rootId && currentPath && currentPath.startsWith(`${movedFrom}/`);

        const movedType = moveItemType;
        closeMoveItemModal();
        saveExpandedState();
        const expandedPaths = getExpandedPaths();
        expandedPaths.add(treeKey(rootId, toDir));
        persistExpandedPaths(expandedPaths);
        await loadDirectories();

        if (wasCurrentFile) {
            await loadFile(rootId, movedTo);
        } else if (currentFileInsideMovedDir) {
            const suffix = currentPath.slice(movedFrom.length);
            await loadFile(rootId, `${movedTo}${suffix}`);
        } else if (currentPath) {
            highlightTreeItem(treeKey(currentRootId, currentPath), {scrollIntoView: false});
        }

        showToast(movedType === 'directory' ? '目录已移动' : '文件已移动');
    } catch (error) {
        console.error('Move item failed:', error);
        el.moveItemError.textContent = '移动失败';
        el.moveItemError.style.display = 'block';
    } finally {
        el.moveItemConfirmBtn.disabled = false;
        el.moveItemConfirmBtn.textContent = '移动';
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
    const parentNode = findNodeByPath(createFileDirPath);
    const rootId = (parentNode && parentNode.root_id) || currentRootId;
    const parentRel = (parentNode && parentNode.path !== undefined) ? parentNode.path : parseTreeKey(createFileDirPath).path;
    const filePath = parentRel ? `${parentRel}/${fullFileName}` : fullFileName;
    const typeMap = { md: 'markdown', txt: 'txt', json: 'json' };
    const apiType = typeMap[fileType] || 'markdown';

    // Disable buttons during creation
    el.createFileConfirmBtn.disabled = true;
    el.createFileConfirmBtn.textContent = '创建中...';

    try {
        const response = await authFetch(`${API_V1}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                root_id: rootId,
                path: filePath,
                type: apiType,
                raw_content: apiType === 'json' ? '{}' : '',
            })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('文件已创建');
            closeCreateFileModal();

            // Reload directories to update tree
            await loadDirectories();

            // Open the newly created file in edit mode
            const createdPath = (data.document && data.document.path) || filePath;
            loadFile(rootId, createdPath);
            enterEditMode();
        } else {
            el.createFileError.textContent = apiErrorMessage(data, '创建文件失败');
            el.createFileError.style.display = 'block';
        }
    } catch (error) {
        console.error('Create file failed:', error);
        el.createFileError.textContent = '创建文件失败';
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

    const parentNode = findNodeByPath(createDirParentPath);
    const rootId = (parentNode && parentNode.root_id) || currentRootId;
    const parentRel = (parentNode && parentNode.path !== undefined) ? parentNode.path : parseTreeKey(createDirParentPath).path;
    const dirPath = parentRel ? `${parentRel}/${dirName}` : dirName;

    // Disable buttons during creation
    el.createDirConfirmBtn.disabled = true;
    el.createDirConfirmBtn.textContent = '创建中...';

    try {
        const response = await authFetch(`${API_V1}/directories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root_id: rootId, path: dirPath })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('目录已创建');
            closeCreateDirModal();

            saveExpandedState();
            const expandedPaths = getExpandedPaths();
            expandedPaths.add(createDirParentPath);
            persistExpandedPaths(expandedPaths);

            await loadDirectories();
        } else {
            el.createDirError.textContent = data.error || '创建目录失败';
            el.createDirError.style.display = 'block';
        }
    } catch (error) {
        console.error('Create directory failed:', error);
        el.createDirError.textContent = '创建目录失败';
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
        showToast('未打开文件');
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
        const response = await authFetch(`${API_V1}/render`, {
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
                if (isHttpUrl(originalSrc)) {
                    img.src = remoteImageProxyUrl(originalSrc);
                } else if (originalSrc && !originalSrc.startsWith('data:') && !originalSrc.startsWith('/api/')) {
                    const fileDir = currentPath.includes('/') ? currentPath.substring(0, currentPath.lastIndexOf('/')) : '';
                    img.src = assetUrl(currentRootId, joinRootRelative(fileDir, originalSrc));
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

        const response = await authFetch(`${API_V1}/documents`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                root_id: currentRootId,
                path: currentPath,
                raw_content: newContent,
                if_match_revision: currentRevision,
            })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('文件已保存');
            if (data.document && data.document.revision) {
                currentRevision = data.document.revision;
            }
            exitEditMode();
            await loadFile(currentRootId, currentPath);
        } else if (response.status === 409 && data.document) {
            const overwrite = confirm('文档已被修改。确定用本地内容覆盖远程版本？');
            if (overwrite) {
                const forceResp = await authFetch(`${API_V1}/documents`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        root_id: currentRootId,
                        path: currentPath,
                        raw_content: newContent,
                        force: true,
                    })
                });
                if (forceResp.ok) {
                    showToast('已强制覆盖保存');
                    exitEditMode();
                    await loadFile(currentRootId, currentPath);
                } else {
                    const fd = await forceResp.json();
                    showToast(apiErrorMessage(fd, '保存失败'));
                }
            } else {
                showToast(apiErrorMessage(data, '版本冲突'));
            }
        } else {
            showToast(apiErrorMessage(data, '保存文件失败'));
        }
    } catch (error) {
        console.error('Save failed:', error);
        showToast('保存文件失败');
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
    if (!contentContainer || !query) {
        updateDocSearchCount();
        return 0;
    }

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
        // Reset before test+exec cycle
        regex.lastIndex = 0;
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

    return docSearchHighlightSpans.length;
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
