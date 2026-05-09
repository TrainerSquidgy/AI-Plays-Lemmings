// Main entry point
let game = null;
let lastTime = 0;
let fps = 0;
let frameCount = 0;
let fpsUpdateTime = 0;

function loadScriptOnce(src, globalName = null) {
    if (globalName && window[globalName]) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const existing = Array.from(document.scripts).find(script => script.getAttribute('src') === src);
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            if (globalName && window[globalName]) resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

async function init() {
    try {
        await loadScriptOnce('js/audio-manager.js', 'AudioManager');
    } catch (error) {
        console.warn('Audio manager not available:', error);
    }

    const canvas = document.getElementById('canvas');
    game = new Game(canvas);
    window.game = game;

    try {
        await game.initialize();

        console.log('Starting game loop...');
        requestAnimationFrame(gameLoop);
    } catch (error) {
        console.error('Failed to initialize game:', error);
    }
}

function gameLoop(currentTime) {
    requestAnimationFrame(gameLoop);
    if (!lastTime) { lastTime = currentTime; return; }
    const deltaTime = currentTime - lastTime;

    // Target PAL/SMS 50Hz playback. game.update() is called every 50Hz
    // display frame. Inside game.update(), SMS-style logic is gated to every
    // 3rd display frame, giving 50 / 3 = 16.666... logic ticks per second.
    const TARGET_FRAME_MS = 1000 / 50;

    if (deltaTime >= TARGET_FRAME_MS) {
        game.update();
        game.render();
        lastTime = currentTime - (deltaTime % TARGET_FRAME_MS);

        frameCount++;
        if (currentTime - fpsUpdateTime >= 1000) {
            fps = frameCount;
            frameCount = 0;
            fpsUpdateTime = currentTime;
        }
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Listen for animation updates from Electron debug panel
try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('animation-update', (event, frameCounts) => {
        if (game && game.renderer && game.renderer.spriteSheet) {
            game.renderer.spriteSheet.updateFrameCounts(frameCounts);
        }
    });
} catch (error) {
    // Allows the page to run in a normal browser during quick HTML/CSS tests.
}
