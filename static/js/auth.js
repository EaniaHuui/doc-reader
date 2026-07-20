/**
 * Doc Reader — authentication (globals: el, authToken, authUsername, authEnabled, showToast, ...)
 * Loaded after script.js defines state/DOM refs; used from DOMContentLoaded.
 */
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
            showToast(`欢迎，${authUsername}`);
        } else {
            el.loginError.textContent = data.error || '登录失败';
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
    showToast('已退出登录');

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

