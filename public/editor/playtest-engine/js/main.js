// Main entry point


// EDITOR_PLAYTEST_BRIDGE_V3: lets the level editor embed this engine
// and feed it one exact MLM/INI payload without touching bundled files.
const EDITOR_PLAYTEST_LEVEL_ID = '__EDITOR_PLAYTEST__';
const EDITOR_PLAYTEST_PAYLOAD_SCHEMA_VERSION = 'editor-playtest-v3';
let editorPlaytestPayload = null;
let editorPlaytestFetchPatched = false;
let editorPlaytestPending = null;
let editorPlaytestOptions = { singleLevel: true };

// EDITOR_EMBED_MODE_TITLE_MUSIC_FIX_V1: keep the embedded editor playtester quiet on startup.
function isEditorEmbeddedPlaytestMode() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('editorEmbed') === '1' || params.get('embedded') === '1') return true;
    } catch (_) {}
    try {
        if (window.parent && window.parent !== window) return true;
    } catch (_) {}
    try {
        return !!window.localStorage.getItem('__smsLemmingsEditorPlaytestPayload');
    } catch (_) {
        return false;
    }
}
window.SMS_LEMMINGS_EDITOR_EMBEDDED = isEditorEmbeddedPlaytestMode();
window.LEMMINGS_EMBEDDED_MODE = Object.assign({}, window.LEMMINGS_EMBEDDED_MODE || {}, {
    editorPlaytest: window.SMS_LEMMINGS_EDITOR_EMBEDDED,
    disableTitleMusic: window.SMS_LEMMINGS_EDITOR_EMBEDDED,
    singleLevel: window.SMS_LEMMINGS_EDITOR_EMBEDDED
});
function editorPlaytestSilenceTitleMusic() {
    try {
        if (!window.SMS_LEMMINGS_EDITOR_EMBEDDED) return;
        const audio = (typeof game !== 'undefined' && game && game.audio) ? game.audio : null;
        if (audio && typeof audio.clearTitleRepeatTimer === 'function') audio.clearTitleRepeatTimer();
        if (audio && typeof audio.stopMusic === 'function') audio.stopMusic();
    } catch (_) {}
}

function editorPlaytestPostToHost(message) {
    let sent = false;
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, '*');
            sent = true;
        }
    } catch (_) {}
    try {
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage(message, '*');
            sent = true;
        }
    } catch (_) {}
    return sent;
}

function editorPlaytestDecodeBase64(base64) {
    const clean = String(base64 || '');
    if (!clean) return new Uint8Array();
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function editorPlaytestNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function editorPlaytestNormalisePayload(payload = {}) {
    const metadata = Object.assign({}, payload.metadata || payload.levelData || {});
    if (metadata.tileset === undefined && metadata.tileset_id !== undefined) metadata.tileset = metadata.tileset_id;
    metadata.tileset = editorPlaytestNumber(metadata.tileset, 0);
    metadata.level_number = editorPlaytestNumber(metadata.level_number, 1);
    metadata.num_lemmings = editorPlaytestNumber(metadata.num_lemmings, 50);
    metadata.percent_needed = editorPlaytestNumber(metadata.percent_needed, 50);
    metadata.release_rate = editorPlaytestNumber(metadata.release_rate, 50);
    metadata.time_minutes = editorPlaytestNumber(metadata.time_minutes, 5);
    metadata.climbers = editorPlaytestNumber(metadata.climbers, 0);
    metadata.floaters = editorPlaytestNumber(metadata.floaters, 0);
    metadata.bombers = editorPlaytestNumber(metadata.bombers, 0);
    metadata.blockers = editorPlaytestNumber(metadata.blockers, 0);
    metadata.builders = editorPlaytestNumber(metadata.builders, 0);
    metadata.bashers = editorPlaytestNumber(metadata.bashers, 0);
    metadata.miners = editorPlaytestNumber(metadata.miners, 0);
    metadata.diggers = editorPlaytestNumber(metadata.diggers, 0);
    metadata.fall_distance = editorPlaytestNumber(metadata.fall_distance, 56);
    metadata.trap_type = editorPlaytestNumber(metadata.trap_type, 0);
    metadata.trap_x = editorPlaytestNumber(metadata.trap_x, 0);
    metadata.trap_y = editorPlaytestNumber(metadata.trap_y, 0);
    metadata.music = editorPlaytestNumber(metadata.music, 0);
    metadata.name = String(metadata.name || payload.name || 'Editor Playtest');
    metadata.rating = String(metadata.rating || payload.rating || 'FUN').toUpperCase();
    if (payload.pngLevelJson || payload.png_level_json || payload.terrainPngDataUrl) {
        metadata.animation_pack_json = String(metadata.animation_pack_json || '__EDITOR_PLAYTEST__.animpack.json');
    }

    let mlmBytes = payload.mlmBytes;
    if (typeof payload.mlmBase64 === 'string') mlmBytes = editorPlaytestDecodeBase64(payload.mlmBase64);
    else if (Array.isArray(mlmBytes)) mlmBytes = new Uint8Array(mlmBytes);
    else if (!(mlmBytes instanceof Uint8Array)) mlmBytes = new Uint8Array();

    return {
        schemaVersion: String(payload.schemaVersion || payload.playtest_payload_schema || EDITOR_PLAYTEST_PAYLOAD_SCHEMA_VERSION),
        levelId: String(payload.levelId || `${metadata.rating}_${String(metadata.level_number || 1).padStart(2, '0')}`),
        verificationKey: String(payload.verificationKey || payload.proofKey || ''),
        metadata,
        mlmBytes,
        terrainPngDataUrl: typeof payload.terrainPngDataUrl === 'string' ? payload.terrainPngDataUrl : '',
        pngLevelJson: payload.pngLevelJson || payload.png_level_json || null,
        overlayJson: payload.overlayJson || payload.overlay_json || null,
        animationPackJson: payload.animationPackJson || payload.animation_pack_json || null
    };
}

function editorPlaytestIniText(payload) {
    const m = payload.metadata || {};
    const order = [
        'name','mlm_file','rating','level_number','map_address','num_lemmings','percent_needed',
        'release_rate','time_minutes','climbers','floaters','bombers','blockers','builders',
        'bashers','miners','diggers','tileset','trap_type','trap_x','trap_y','fall_distance','music'
    ];
    const out = ['[level]'];
    const seen = new Set();
    for (const key of order) {
        let value = m[key];
        if (key === 'mlm_file') value = EDITOR_PLAYTEST_LEVEL_ID + '.mlm';
        if (value === undefined || value === null || value === '') continue;
        out.push(`${key}=${value}`);
        seen.add(key);
    }
    for (const [key, value] of Object.entries(m)) {
        if (seen.has(key) || value === undefined || value === null || typeof value === 'object') continue;
        out.push(`${key}=${value}`);
    }
    return out.join('\n') + '\n';
}

function editorPlaytestPatchFetch() {
    if (editorPlaytestFetchPatched) return;
    editorPlaytestFetchPatched = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const cleanUrl = String(url).split('?')[0].replace(/\\/g, '/');
        if (editorPlaytestPayload && cleanUrl.endsWith(`bundled-levels/${EDITOR_PLAYTEST_LEVEL_ID}.mlm.ini`)) {
            return Promise.resolve(new Response(editorPlaytestIniText(editorPlaytestPayload), {
                status: 200,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            }));
        }
        if (editorPlaytestPayload && (cleanUrl.endsWith(`bundled-levels/__EDITOR_PLAYTEST__.png`) || cleanUrl.endsWith(`${EDITOR_PLAYTEST_LEVEL_ID}.png`))) {
            return nativeFetch(editorPlaytestPayload.terrainPngDataUrl, init);
        }
        if (editorPlaytestPayload && (cleanUrl.endsWith(`bundled-levels/__EDITOR_PLAYTEST__.pnglevel.json`) || cleanUrl.endsWith(`${EDITOR_PLAYTEST_LEVEL_ID}.pnglevel.json`))) {
            return Promise.resolve(new Response(JSON.stringify(editorPlaytestPayload.pngLevelJson || { objects: [], animations: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }));
        }
        if (editorPlaytestPayload && (cleanUrl.endsWith(`bundled-levels/__EDITOR_PLAYTEST__.overlay.json`) || cleanUrl.endsWith(`${EDITOR_PLAYTEST_LEVEL_ID}.overlay.json`))) {
            return Promise.resolve(new Response(JSON.stringify(editorPlaytestPayload.overlayJson || { objects: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }));
        }
        if (editorPlaytestPayload && (
            cleanUrl.endsWith(`bundled-levels/__EDITOR_PLAYTEST__.animpack.json`) ||
            cleanUrl.endsWith(`${EDITOR_PLAYTEST_LEVEL_ID}.animpack.json`) ||
            cleanUrl.endsWith('bundled-levels/png-animation-library.json') ||
            cleanUrl.endsWith('custom-levels/png-animation-library.json') ||
            cleanUrl.endsWith('/png-animation-library.json') ||
            cleanUrl.endsWith('png-animation-library.json')
        )) {
            return Promise.resolve(new Response(JSON.stringify(editorPlaytestPayload.animationPackJson || { animations: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }));
        }
        if (editorPlaytestPayload && cleanUrl.endsWith(`bundled-levels/${EDITOR_PLAYTEST_LEVEL_ID}.mlm`)) {
            return Promise.resolve(new Response(editorPlaytestPayload.mlmBytes, {
                status: 200,
                headers: { 'Content-Type': 'application/octet-stream' }
            }));
        }
        return nativeFetch(input, init);
    };
}

async function loadEditorPlaytestPayload(payload, options = {}) {
    editorPlaytestOptions = Object.assign({ singleLevel: true }, options || {});
    if (editorPlaytestOptions.singleLevel !== false) editorPlaytestOptions.singleLevel = true;
    editorPlaytestPayload = editorPlaytestNormalisePayload(payload);
    const playtestMeta = editorPlaytestPayload.metadata || {};
    const animationCount = Array.isArray(editorPlaytestPayload.animationPackJson?.animations) ? editorPlaytestPayload.animationPackJson.animations.length : 0;
    const objectCount = Array.isArray(editorPlaytestPayload.pngLevelJson?.objects) ? editorPlaytestPayload.pngLevelJson.objects.length : 0;
    const playtestMetaMessage = `payload ${editorPlaytestPayload.schemaVersion}: fall_distance=${playtestMeta.fall_distance}, music=${playtestMeta.music}, pngObjects=${objectCount}, pngAnimations=${animationCount}`;
    try { console.log('[editor playtest] ' + playtestMetaMessage); } catch (_) {}
    try { editorPlaytestPostToHost({ type: 'sms-lemmings-playtest-diagnostic', level: 'info', message: playtestMetaMessage }); } catch (_) {}
    try { window.SMS_LEMMINGS_PLAYTEST_STATUS?.('Electron playtest: ' + playtestMetaMessage, 'info'); } catch (_) {}
    editorPlaytestPatchFetch();
    window.SMS_LEMMINGS_EDITOR_EMBEDDED = true;
    window.LEMMINGS_EMBEDDED_MODE = Object.assign({}, window.LEMMINGS_EMBEDDED_MODE || {}, {
        editorPlaytest: true,
        disableTitleMusic: true,
        singleLevel: editorPlaytestOptions.singleLevel !== false
    });
    editorPlaytestSilenceTitleMusic();

    if (!game || !game.initialized) {
        editorPlaytestPending = { payload: editorPlaytestPayload, options };
        return;
    }

    const rating = String(editorPlaytestPayload.metadata.rating || 'FUN').toUpperCase().replace(/\s+/g, '');
    const ratingIndex = game.ratingOrder.findIndex(r => String(r.prefix).toUpperCase() === rating || String(r.label).toUpperCase() === rating);
    if (ratingIndex >= 0) game.selectedRatingIndex = ratingIndex;
    game.selectedLevelNumber = Math.max(1, Math.min(30, editorPlaytestNumber(editorPlaytestPayload.metadata.level_number, 1)));
    game.selectedLevelInfoId = EDITOR_PLAYTEST_LEVEL_ID;
    game.selectedLevelInfo = {
        title: editorPlaytestPayload.metadata.name || 'Editor Playtest',
        numLemmings: editorPlaytestPayload.metadata.num_lemmings || 0,
        percentNeeded: editorPlaytestPayload.metadata.percent_needed || 0,
        releaseRate: editorPlaytestPayload.metadata.release_rate || 0,
        timeMinutes: editorPlaytestPayload.metadata.time_minutes || 0,
        rating: rating || 'FUN',
        levelNumber: game.selectedLevelNumber
    };

    editorPlaytestSilenceTitleMusic();
    await game.loadLevel(EDITOR_PLAYTEST_LEVEL_ID, { showBriefing: false });
    try {
        const loaded = game.level || {};
        editorPlaytestPostToHost({ type: 'sms-lemmings-playtest-diagnostic', level: 'info', message: `loaded level: fall_distance=${loaded.fall_distance}, music=${loaded.music}` });
        console.log(`[editor playtest] loaded level: fall_distance=${loaded.fall_distance}, music=${loaded.music}`);
    } catch (_) {}
    if (options.mode === 'preview') game.startPreview();
    else game.requestPlayFromBriefingOrPreview();

    const canvas = document.getElementById('canvas');
    if (canvas) {
        canvas.setAttribute('tabindex', '0');
        setTimeout(() => canvas.focus(), 0);
    }
}

function installEditorPlaytestBridge() {
    editorPlaytestPatchFetch();
    window.addEventListener('message', event => {
        const data = event && event.data;
        if (!data || data.type !== 'sms-lemmings-playtest-level') return;
        loadEditorPlaytestPayload(data.payload || {}, data.options || {}).catch(error => {
            console.error('Could not load editor playtest level:', error);
            try { window.parent?.postMessage?.({ type: 'sms-lemmings-playtest-error', message: error.message || String(error) }, '*'); } catch (_) {}
        });
    });

    try {
        const stored = window.localStorage.getItem('__smsLemmingsEditorPlaytestPayload');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && parsed.payload) {
                editorPlaytestPending = { payload: parsed.payload, options: parsed.options || {} };
            }
        }
    } catch (_) {}

    try { window.parent?.postMessage?.({ type: 'sms-lemmings-playtest-ready' }, '*'); } catch (_) {}
}

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
    installEditorPlaytestBridge();

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

        if (editorPlaytestPending) {
            const pending = editorPlaytestPending;
            editorPlaytestPending = null;
            await loadEditorPlaytestPayload(pending.payload, pending.options || {});
        }
        try { window.parent?.postMessage?.({ type: 'sms-lemmings-playtest-ready' }, '*'); } catch (_) {}
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
