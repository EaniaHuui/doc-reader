/**
 * Doc Reader — authentication (globals: el, authToken, authUsername, authEnabled, showToast, ...)
 * Loaded after script.js defines state/DOM refs; used from DOMContentLoaded.
 */
// ========================================
// Authentication
// ========================================

function setAuthTokenCookie(token) {
    if (!token) return;
    // 30 days — keeps /view and image requests authenticated without Authorization headers.
    const maxAge = 60 * 60 * 24 * 30;
    document.cookie = `authToken=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function clearAuthTokenCookie() {
    document.cookie = 'authToken=; Path=/; Max-Age=0; SameSite=Lax';
}

function apiErrorMessage(data, fallback) {
    if (!data) return fallback;
    if (data.error && typeof data.error === 'object') {
        return data.error.message || fallback;
    }
    if (typeof data.error === 'string') return data.error;
    return fallback;
}

async function checkAuthStatus() {
    try {
        const savedToken = localStorage.getItem('authToken');
        if (savedToken) {
            authToken = savedToken;
            setAuthTokenCookie(savedToken);
        }

        // Probe /auth/me; 401 means login required when auth is enabled.
        const response = await authFetch(`${API_V1}/auth/me`);
        if (response.status === 401) {
            authEnabled = true;
            authToken = null;
            authUsername = null;
            localStorage.removeItem('authToken');
            clearAuthTokenCookie();
            updateAuthUI(false);
            openLoginModal();
            return;
        }

        if (!response.ok) {
            // Fallback: health is public
            authEnabled = false;
            updateAuthUI(true);
            return;
        }

        const data = await response.json();
        authEnabled = !!data.auth_enabled;
        authUsername = (data.user && (data.user.name || data.user.username)) || 'user';
        if (authToken) {
            setAuthTokenCookie(authToken);
        }
        updateAuthUI(true);
    } catch (error) {
        console.error('Failed to check auth status:', error);
        authEnabled = false;
        updateAuthUI(false);
    }
}

function updateAuthUI(authenticated) {
    if (authenticated) {
        el.authBtn.classList.add('authenticated');
        el.authBtn.querySelector('.auth-username').textContent = authUsername || '';
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

    if (authEnabled) {
        el.loginModal.classList.add('auth-required');
    } else {
        el.loginModal.classList.remove('auth-required');
    }
}

function closeLoginModal() {
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

    el.loginBtn.disabled = true;
    el.loginBtn.querySelector('.login-text').style.display = 'none';
    el.loginBtn.querySelector('.login-loading').style.display = 'flex';
    el.loginError.style.display = 'none';

    try {
        const response = await fetch(`${API_V1}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.access_token;
            authUsername = (data.user && data.user.name) || username;
            localStorage.setItem('authToken', authToken);
            setAuthTokenCookie(authToken);

            updateAuthUI(true);
            closeLoginModal();

            loadDirectories();
            showToast(`欢迎，${authUsername}`);
        } else {
            el.loginError.textContent = apiErrorMessage(data, '登录失败');
            el.loginError.style.display = 'block';
        }
    } catch (error) {
        console.error('Login failed:', error);
        el.loginError.textContent = '登录失败，请重试。';
        el.loginError.style.display = 'block';
    } finally {
        el.loginBtn.disabled = false;
        el.loginBtn.querySelector('.login-text').style.display = 'flex';
        el.loginBtn.querySelector('.login-loading').style.display = 'none';
    }
}

async function logout() {
    try {
        await authFetch(`${API_V1}/auth/logout`, { method: 'POST' });
    } catch (error) {
        console.error('Logout failed:', error);
    }

    authToken = null;
    authUsername = null;
    localStorage.removeItem('authToken');
    clearAuthTokenCookie();

    updateAuthUI(false);
    showToast('已退出登录');

    if (authEnabled) {
        openLoginModal();
    }

    el.welcome.style.display = 'flex';
    el.document.style.display = 'none';
    el.treeItems.innerHTML = '';

    const newUrl = new URL(window.location);
    newUrl.searchParams.delete('file');
    newUrl.searchParams.delete('path');
    newUrl.searchParams.delete('root_id');
    window.history.replaceState({}, '', newUrl);
}

async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (authToken && !String(url).includes('/auth/login') && !String(url).includes('/auth/pairing/exchange')) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, options);

    if (response.status === 401 && authEnabled) {
        authToken = null;
        authUsername = null;
        localStorage.removeItem('authToken');
        clearAuthTokenCookie();
        updateAuthUI(false);
        openLoginModal();
    }

    return response;
}
