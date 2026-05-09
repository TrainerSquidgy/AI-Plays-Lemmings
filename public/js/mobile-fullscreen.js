(() => {
    const MOBILE_MAX_SHORT_EDGE = 900;
    const BUTTON_TEXT = 'TAP FOR FULLSCREEN';
    const PORTRAIT_TITLE = 'ROTATE YOUR DEVICE';
    const LANDSCAPE_TITLE = 'FULLSCREEN MODE';

    let overlay = null;
    let panel = null;
    let title = null;
    let body = null;
    let button = null;
    let lastError = '';
    let hasInteracted = false;

    function isMobileLike() {
        const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
        const smallScreen = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= MOBILE_MAX_SHORT_EDGE;
        const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || '');
        return Boolean((coarse && smallScreen) || uaMobile);
    }

    function isLandscape() {
        return window.innerWidth >= window.innerHeight;
    }

    function isFullscreen() {
        return Boolean(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement ||
            window.navigator.standalone
        );
    }

    function getFullscreenTarget() {
        return document.getElementById('game-container') || document.documentElement;
    }

    async function requestFullscreen(target) {
        if (isFullscreen()) {
            return;
        }

        const request =
            target.requestFullscreen ||
            target.webkitRequestFullscreen ||
            target.msRequestFullscreen;

        if (!request) {
            throw new Error('Fullscreen is not supported by this browser.');
        }

        const result = request.call(target, { navigationUI: 'hide' });
        if (result && typeof result.then === 'function') {
            await result;
        }
    }

    async function requestLandscapeLock() {
        const orientation = screen.orientation;
        if (!orientation || typeof orientation.lock !== 'function') {
            return;
        }

        await orientation.lock('landscape');
    }

    async function enterMobileFullscreen() {
        hasInteracted = true;
        lastError = '';
        if (button) {
            button.disabled = true;
            button.textContent = 'WORKING...';
        }

        try {
            await requestFullscreen(getFullscreenTarget());
        } catch (err) {
            lastError = err?.message || 'Fullscreen request failed.';
            console.warn('Mobile fullscreen request failed:', err);
        }

        try {
            await requestLandscapeLock();
        } catch (err) {
            // This commonly fails unless the browser is already fullscreen.
            // Keep the game usable and fall back to the rotate-device prompt.
            if (!lastError) {
                lastError = 'Rotate lock was refused by this browser.';
            }
            console.warn('Landscape orientation lock failed:', err);
        }

        updateOverlay();
    }

    function createOverlay() {
        if (overlay) {
            return;
        }

        overlay = document.createElement('div');
        overlay.id = 'mobile-fullscreen-overlay';
        overlay.setAttribute('aria-live', 'polite');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'none';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(0, 0, 0, 0.88)';
        overlay.style.color = '#fff';
        overlay.style.fontFamily = 'Courier New, monospace';
        overlay.style.textAlign = 'center';
        overlay.style.padding = '24px';
        overlay.style.touchAction = 'manipulation';
        overlay.style.userSelect = 'none';

        panel = document.createElement('div');
        panel.style.maxWidth = '520px';
        panel.style.border = '2px solid #fff';
        panel.style.background = '#000';
        panel.style.padding = '18px';
        panel.style.boxShadow = '0 0 0 4px #0030a8';

        title = document.createElement('div');
        title.style.fontSize = '20px';
        title.style.marginBottom = '12px';
        title.style.letterSpacing = '1px';

        body = document.createElement('div');
        body.style.fontSize = '14px';
        body.style.lineHeight = '1.45';
        body.style.marginBottom = '16px';

        button = document.createElement('button');
        button.type = 'button';
        button.textContent = BUTTON_TEXT;
        button.style.font = 'inherit';
        button.style.fontSize = '14px';
        button.style.color = '#fff';
        button.style.background = '#0030a8';
        button.style.border = '2px solid #fff';
        button.style.padding = '10px 14px';
        button.style.cursor = 'pointer';
        button.style.touchAction = 'manipulation';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            enterMobileFullscreen();
        });

        panel.append(title, body, button);
        overlay.append(panel);
        document.body.append(overlay);
    }

    function setOverlayMode(mode) {
        createOverlay();

        button.disabled = false;
        button.textContent = BUTTON_TEXT;

        if (mode === 'hidden') {
            overlay.style.display = 'none';
            overlay.style.pointerEvents = 'none';
            return;
        }

        overlay.style.pointerEvents = 'auto';
        overlay.style.display = 'flex';

        if (mode === 'portrait') {
            title.textContent = PORTRAIT_TITLE;
            body.textContent = lastError
                ? `${lastError} Please rotate your device to landscape, then tap again if needed.`
                : 'This game is happiest in landscape. Rotate your device, then tap to request fullscreen.';
            panel.style.opacity = '1';
            return;
        }

        if (mode === 'fullscreen') {
            title.textContent = LANDSCAPE_TITLE;
            body.textContent = lastError
                ? `${lastError} You can still play in landscape, or tap again to retry fullscreen.`
                : 'Tap once to enter fullscreen. If your browser refuses, the game will still run in landscape.';
            panel.style.opacity = hasInteracted && lastError ? '0.95' : '1';
        }
    }

    function updateOverlay() {
        if (!isMobileLike()) {
            setOverlayMode('hidden');
            return;
        }

        if (!isLandscape()) {
            setOverlayMode('portrait');
            return;
        }

        if (!isFullscreen() && !hasInteracted) {
            setOverlayMode('fullscreen');
            return;
        }

        if (!isFullscreen() && lastError) {
            setOverlayMode('fullscreen');
            return;
        }

        setOverlayMode('hidden');
    }

    function install() {
        createOverlay();
        updateOverlay();

        window.addEventListener('resize', updateOverlay, { passive: true });
        window.addEventListener('orientationchange', () => setTimeout(updateOverlay, 250), { passive: true });
        document.addEventListener('fullscreenchange', updateOverlay);
        document.addEventListener('webkitfullscreenchange', updateOverlay);
        document.addEventListener('msfullscreenchange', updateOverlay);
        document.addEventListener('visibilitychange', updateOverlay);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
        install();
    }
})();
