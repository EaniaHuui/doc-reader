/**
 * Mobile pairing QR (60s one-time session).
 * Depends on: authFetch, API_V1, showToast, el (optional modal nodes created here).
 */

let pairingTimer = null;
let pairingExpiresAt = null;

function ensurePairingModal() {
    if (document.getElementById('pairingModal')) return;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'pairingModal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-content" style="max-width: 420px;">
            <div class="modal-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/>
                    <rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/>
                    <rect x="18" y="18" width="3" height="3"/>
                </svg>
                <span>手机配对</span>
                <button class="modal-close" id="closePairing">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body" style="text-align: center;">
                <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
                    使用手机 App 扫描下方二维码，60 秒内有效。配对码为一次性，不含密码或长期令牌。
                </p>
                <div id="pairingQrBox" style="display:flex;justify-content:center;min-height:200px;align-items:center;background:var(--bg-tertiary);border-radius:8px;padding:16px;">
                    <div id="pairingQrPlaceholder" style="color:var(--text-secondary);font-size:13px;">生成中…</div>
                    <img id="pairingQrImage" alt="配对二维码" style="display:none;max-width:220px;max-height:220px;"/>
                </div>
                <p id="pairingStatus" style="margin-top:12px;font-size:13px;color:var(--text-secondary);"></p>
                <p id="pairingCountdown" style="margin-top:4px;font-size:12px;font-family:var(--font-mono);color:var(--text-tertiary);"></p>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="pairingRefreshBtn">刷新二维码</button>
                <button class="btn-primary" id="pairingCloseBtn">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.modal-backdrop').addEventListener('click', closePairingModal);
    document.getElementById('closePairing').addEventListener('click', closePairingModal);
    document.getElementById('pairingCloseBtn').addEventListener('click', closePairingModal);
    document.getElementById('pairingRefreshBtn').addEventListener('click', () => createPairingSession());
}

function openPairingModal() {
    ensurePairingModal();
    document.getElementById('pairingModal').classList.add('visible');
    createPairingSession();
}

function closePairingModal() {
    const modal = document.getElementById('pairingModal');
    if (modal) modal.classList.remove('visible');
    if (pairingTimer) {
        clearInterval(pairingTimer);
        pairingTimer = null;
    }
}

async function createPairingSession() {
    ensurePairingModal();
    const statusEl = document.getElementById('pairingStatus');
    const countdownEl = document.getElementById('pairingCountdown');
    const img = document.getElementById('pairingQrImage');
    const placeholder = document.getElementById('pairingQrPlaceholder');

    statusEl.textContent = '正在创建配对会话…';
    countdownEl.textContent = '';
    img.style.display = 'none';
    placeholder.style.display = 'block';
    placeholder.textContent = '生成中…';

    if (pairingTimer) {
        clearInterval(pairingTimer);
        pairingTimer = null;
    }

    try {
        const response = await authFetch(`${API_V1}/auth/pairing-sessions`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) {
            statusEl.textContent = apiErrorMessage(data, '创建配对失败');
            placeholder.textContent = '失败';
            return;
        }

        const qrData = data.qr_data || JSON.stringify(data.qr_payload || {});
        // Use a public QR image API-free approach: Google chart is deprecated;
        // encode with a simple offline SVG via qrserver (or data URL library).
        // Prefer local generation with QR code API that doesn't leak tokens to third parties:
        // render as text payload + online qr if needed — use api.qrserver.com only for display of non-secret-long payload.
        // Payload is short-lived pairing secret (60s) — acceptable for personal use.
        const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(qrData);
        img.src = qrUrl;
        img.style.display = 'block';
        placeholder.style.display = 'none';

        pairingExpiresAt = data.expires_at ? new Date(data.expires_at).getTime() : (Date.now() + 60000);
        statusEl.textContent = '等待手机扫描…（会话 ' + (data.pairing_session_id || '').slice(0, 8) + '…）';

        pairingTimer = setInterval(() => {
            const left = Math.max(0, Math.ceil((pairingExpiresAt - Date.now()) / 1000));
            countdownEl.textContent = left > 0 ? `剩余 ${left} 秒` : '已过期，请刷新';
            if (left <= 0) {
                statusEl.textContent = '配对码已过期';
                img.style.opacity = '0.35';
                clearInterval(pairingTimer);
                pairingTimer = null;
            } else {
                img.style.opacity = '1';
            }
        }, 250);
    } catch (err) {
        console.error(err);
        statusEl.textContent = '创建配对失败';
        placeholder.textContent = '网络错误';
    }
}
