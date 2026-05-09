importScripts('physics.js', 'lemming.js');

const SKILLS = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];
const RATINGS = ['FUN', 'TRICKY', 'TAXING', 'MAYHEM', 'EXTRA1', 'EXTRA2', 'EXTRA3', 'EXTRA4'];
const ACTIVE_STATES = new Set(['falling', 'walking', 'climbing', 'floating', 'building', 'shrugging', 'bashing', 'mining', 'digging', 'blocking', 'exploding', 'drowning', 'burning', 'splatting', 'exiting']);
const DEAD_STATES = new Set(['dead', 'drowning', 'burning', 'splatting']);

const entranceMarkers = [38, 26, 47, 37, 44, 47, 65, 20];
const exitTriggerTiles = [[85, 86], [100, 101], [98], [105, 106], [60, 61], [98], [142, 143], [128, 129]];
let tileBehaviors = {};
let sims = [];
let socket = null;
let trainerUrl = '';
let nextRequestId = 1;
let running = false;
let lastPost = 0;

function toInt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function parseIni(text) {
    const data = {};
    for (const line of String(text).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('[')) continue;
        const at = trimmed.indexOf('=');
        if (at < 0) continue;
        const key = trimmed.slice(0, at).trim();
        const raw = trimmed.slice(at + 1).trim();
        data[key] = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : raw;
    }
    return data;
}

function parseTileBehaviors(text) {
    const behaviors = {};
    let currentTileset = null;
    let currentList = null;
    for (const line of String(text).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith(';') || trimmed === '') {
            const match = trimmed.match(/; ([A-Z0-9]+)/);
            if (match) {
                currentTileset = match[1];
                behaviors[currentTileset] ||= { nonCollidable: [], steel: [], water: [], toxic: [], oneWayRight: [], oneWayLeft: [] };
            }
            continue;
        }
        if (trimmed.includes('Data_List')) {
            const listMatch = trimmed.match(/List(\d+)/);
            const types = ['nonCollidable', 'steel', 'water', 'toxic', 'oneWayRight', 'oneWayLeft'];
            currentList = listMatch ? types[parseInt(listMatch[1], 10)] : null;
            continue;
        }
        if (trimmed.startsWith('.db') && currentTileset && currentList) {
            const hexValues = trimmed.match(/\$[0-9A-F]+/gi) || [];
            for (const hex of hexValues) {
                const value = parseInt(hex.slice(1), 16);
                if (value) behaviors[currentTileset][currentList].push(value);
            }
        }
    }
    return behaviors;
}

function decodeMLM(bytes, targetLength) {
    const tilemap = new Array(targetLength).fill(0);
    let src = 0;
    let tgt = 0;
    while (src < bytes.length && tgt < tilemap.length) {
        if (bytes[src] === 0) {
            const count = bytes[src + 1] || 0;
            for (let i = 0; i < count && tgt < tilemap.length; i++) tilemap[tgt++] = 0;
            src += 2;
        } else {
            tilemap[tgt++] = bytes[src++];
        }
    }
    return tilemap;
}

function findMarkerPositions(tilemap, width, marker, maxCount) {
    const positions = [];
    for (let i = 0; i < tilemap.length; i++) {
        if (tilemap[i] !== marker) continue;
        positions.push({ tileX: i % width, tileY: Math.floor(i / width), x: (i % width) * 8, y: Math.floor(i / width) * 8, engineId: positions.length });
    }
    return positions.slice(0, maxCount);
}

function findExitPositions(tilemap, width, height, tilesetIndex) {
    const exitTiles = exitTriggerTiles[tilesetIndex] || [];
    const exits = [];
    for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
            if (!exitTiles.includes(tilemap[ty * width + tx])) continue;
            exits.push({ tileX: tx, tileY: ty, x: tx * 8 + 4, y: ty * 8, leftX: tx * 8, rightX: tx * 8 + 7, topY: ty * 8, bottomY: ty * 8 + 15, engineId: exits.length });
        }
    }
    return exits.slice(0, 3);
}

function makeLevel(id, ini, tilemap) {
    const width = 112;
    const height = 19;
    const tileset = Number(ini.tileset || 0);
    const tilesetName = ['Grass', 'Sand 1', 'Fire', 'Ice', 'Brick', 'Fire2', 'Sand 2', 'Sega'][tileset] || 'Grass';
    const behaviorKey = ['GRASS', 'SAND1', 'FIRE', 'ICE', 'BRICK', 'FIRE2', 'SAND2', 'SEGA'][tileset] || 'GRASS';
    const level = {
        ...ini,
        id,
        width,
        height,
        pixelWidth: width * 8,
        pixelHeight: height * 8,
        tilemap,
        tileset,
        tilesetName,
        behaviorKey,
        num_lemmings: Number(ini.num_lemmings || 10),
        percent_needed: Number(ini.percent_needed || 10),
        fall_distance: Number(ini.fall_distance || 56),
        time_minutes: Number(ini.time_minutes || 5),
        release_rate: Number(ini.release_rate || 50),
        erasureMask: new Uint8Array(width * 8 * height * 8),
        terrainAdditions: [],
        activeBlockers: [],
        entrancePositions: findMarkerPositions(tilemap, width, entranceMarkers[tileset] || 38, 4),
        exitPositions: findExitPositions(tilemap, width, height, tileset),
        getPixelIndex(x, y) {
            const px = Math.floor(x), py = Math.floor(y);
            if (px < 0 || px >= this.pixelWidth || py < 0 || py >= this.pixelHeight) return -1;
            return py * this.pixelWidth + px;
        },
        isErasedPixel(x, y) {
            const index = this.getPixelIndex(x, y);
            return index >= 0 && this.erasureMask[index] === 1;
        },
        tileBehavior(tileIndex) {
            const set = tileBehaviors[this.behaviorKey] || tileBehaviors[this.tilesetName?.toUpperCase()] || tileBehaviors[this.tilesetName] || {};
            if ((set.water || []).includes(tileIndex)) return 'water';
            if ((set.toxic || []).includes(tileIndex)) return 'toxic';
            if ((set.steel || []).includes(tileIndex)) return 'steel';
            if ((set.nonCollidable || []).includes(tileIndex)) return null;
            return tileIndex ? 'solid' : null;
        },
        getBaseTerrainBehaviorAtPixel(x, y) {
            const px = Math.floor(x), py = Math.floor(y);
            const tx = Math.floor(px / 8), ty = Math.floor(py / 8);
            if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height || this.isErasedPixel(px, py)) return null;
            return this.tileBehavior(this.tilemap[ty * this.width + tx]);
        },
        checkAddedTerrainPixel(x, y) {
            if (this.isErasedPixel(x, y)) return false;
            for (let i = this.terrainAdditions.length - 1; i >= 0; i--) {
                const r = this.terrainAdditions[i];
                if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return true;
            }
            return false;
        },
        checkCollision(x, y) {
            if (this.checkAddedTerrainPixel(Math.floor(x), Math.floor(y))) return true;
            const behavior = this.getBaseTerrainBehaviorAtPixel(x, y);
            return !!behavior && behavior !== 'water' && behavior !== 'toxic';
        },
        checkHazard(x, y) {
            const behavior = this.getBaseTerrainBehaviorAtPixel(x, y);
            if (behavior === 'water') return 'water';
            if (behavior === 'toxic') return 'toxic';
            return null;
        },
        removeTerrainRects(rects) {
            let erased = false, hitSolid = false, blocked = false, blockedBySteel = false;
            const pixels = [];
            for (const rect of rects) {
                const left = Math.floor(rect.x), top = Math.floor(rect.y), right = left + Math.floor(rect.w || rect.width || 0), bottom = top + Math.floor(rect.h || rect.height || 0);
                for (let py = top; py < bottom; py++) {
                    for (let px = left; px < right; px++) {
                        const behavior = this.getBaseTerrainBehaviorAtPixel(px, py);
                        if (behavior) hitSolid = true;
                        if (behavior === 'steel') { blocked = true; blockedBySteel = true; }
                        if (behavior && behavior !== 'steel') pixels.push({ x: px, y: py });
                        if (this.checkAddedTerrainPixel(px, py)) pixels.push({ x: px, y: py });
                    }
                }
            }
            if (!blocked) {
                for (const pixel of pixels) {
                    const index = this.getPixelIndex(pixel.x, pixel.y);
                    if (index >= 0) { this.erasureMask[index] = 1; erased = true; }
                }
            }
            return { erased, hitSolid, blocked, blockedBySteel, blockedByOneWay: false };
        },
        removeTerrainRect(x, y, w, h, options) { return this.removeTerrainRects([{ x, y, w, h }], options); },
        removeTerrain(x, y, w, h, options) { return this.removeTerrainRect(x - w / 2, y - h / 2, w, h, options); },
        placeBuilderPixels(pixels) {
            for (const p of pixels) this.terrainAdditions.push({ x: p.x, y: p.y, width: 1, height: 1, source: 'builder' });
            return true;
        },
        getBuilderAsmBrickPixels(x, y, dir = 1) {
            const facing = dir < 0 ? -1 : 1;
            const originX = Math.floor(x) + (facing > 0 ? 1 : -3);
            const originY = Math.floor(y);
            return [{ x: originX, y: originY }, { x: originX + 1, y: originY }, { x: originX + 2, y: originY }];
        },
        placeBuilderAsmBrick(x, y, dir) { return this.placeBuilderPixels(this.getBuilderAsmBrickPixels(x, y, dir)); },
        checkBaseTerrainCollision(x, y) {
            const behavior = this.getBaseTerrainBehaviorAtPixel(x, y);
            return !!behavior && behavior !== 'water' && behavior !== 'toxic';
        }
    };
    if (!level.entrancePositions.length) level.entrancePositions = [{ x: 160, y: 20, engineId: 0 }];
    if (!level.exitPositions.length) level.exitPositions = [{ x: 800, y: 120, engineId: 0, topY: 112, bottomY: 136 }];
    level.entrancePos = level.entrancePositions[0];
    level.exitPos = level.exitPositions[0];
    level.tilesetManager = null;
    return level;
}

async function loadLevel(id) {
    const iniText = await fetch(`../bundled-levels/${id}.mlm.ini`).then(r => r.text());
    const ini = parseIni(iniText);
    const bytes = new Uint8Array(await fetch(`../bundled-levels/${id}.mlm`).then(r => r.arrayBuffer()));
    return makeLevel(id, ini, decodeMLM(bytes, 112 * 19));
}

class HeadlessSim {
    constructor(index, levelId, seed) {
        this.index = index;
        this.levelId = levelId;
        this.seed = seed;
        this.random = mulberry32(seed);
        this.clientId = `headless-${index}-${seed}`;
        this.level = null;
        this.lemmings = [];
        this.skillCounts = {};
        this.stats = {};
        this.frame = 0;
        this.logicFrame = 0;
        this.spawnTimer = 0;
        this.spawnInterval = 50;
        this.spawnEntrancePointer = 0;
        this.attempt = 0;
        this.reward = 0;
        this.lastReward = 0;
        this.lastSaved = 0;
        this.lastDeaths = 0;
        this.bestSaved = 0;
        this.actions = [];
        this.pending = false;
        this.resetting = false;
        this.nextDecision = 30 + Math.floor(this.random() * 40);
        this.doneCooldown = 0;
    }
    async reset() {
        this.level = await loadLevel(this.levelId);
        this.lemmings = [];
        this.skillCounts = {};
        for (const skill of SKILLS) this.skillCounts[skill] = Number(this.level[`${skill}s`] || 0);
        this.stats = { lemmingsOut: 0, lemmingsSaved: 0, lemmingsLeftToSpawn: this.level.num_lemmings, timeElapsed: 0 };
        this.frame = 0; this.logicFrame = 0; this.spawnTimer = 0; this.spawnEntrancePointer = 0; this.attempt++;
        this.reward = 0; this.lastReward = 0; this.lastSaved = 0; this.lastDeaths = 0; this.bestSaved = 0; this.actions = [];
        this.spawnInterval = Math.max(3, (50 - Math.floor(Number(this.level.release_rate || 50) / 2)) * 2);
        this.nextDecision = 30 + Math.floor(this.random() * 40);
    }
    step() {
        if (!this.level || this.resetting) return;
        this.frame++;
        if (this.doneCooldown > 0) {
            this.doneCooldown--;
            if (this.doneCooldown === 0) {
                this.resetting = true;
                this.reset().finally(() => { this.resetting = false; });
            }
            return;
        }
        this.level.activeBlockers = this.lemmings.filter(l => l.state === 'blocking');
        this.spawnTimer++;
        if (this.stats.lemmingsLeftToSpawn > 0 && this.spawnTimer >= this.spawnInterval) {
            this.spawn();
            this.spawnTimer = 0;
        }
        for (const lemming of this.lemmings) {
            const prev = lemming.state;
            if (lemming.fuseValue > 0) lemming.updateBomberFuse();
            lemming.update(this.level);
            if (prev !== 'saved' && lemming.state === 'saved') this.stats.lemmingsSaved++;
            if (lemming.y > this.level.pixelHeight + 40 && !['dead', 'saved'].includes(lemming.state)) lemming.die('bottom');
        }
        this.stats.timeElapsed++;
        this.observeReward();
        if (this.frame >= this.nextDecision) {
            this.requestDecision();
            this.nextDecision = this.frame + 70 + Math.floor(this.random() * 70);
        }
        const aliveLemmings = this.lemmings.filter(l => !['dead', 'saved'].includes(l.state));
        const onlyBlockers = aliveLemmings.length > 0 && aliveLemmings.every(l => l.state === 'blocking');
        if ((!aliveLemmings.length || onlyBlockers) && this.stats.lemmingsLeftToSpawn <= 0) this.finishAttempt();
    }
    spawn() {
        const entrances = this.level.entrancePositions;
        this.spawnEntrancePointer = (this.spawnEntrancePointer + 1) % entrances.length;
        const entrance = entrances[this.spawnEntrancePointer];
        const lemming = new Lemming(entrance.x + 4, entrance.y - 8, 1);
        lemming.rlId = this.stats.lemmingsOut + 1;
        this.lemmings.push(lemming);
        this.stats.lemmingsOut++;
        this.stats.lemmingsLeftToSpawn--;
    }
    finishAttempt() {
        this.doneCooldown = 20;
        const savedPercent = this.savedPercent();
        const advanceThreshold = Math.max(60, Number(this.level.percent_needed || 0));
        postResult(this, savedPercent >= advanceThreshold ? 'levelSuccess' : 'levelFailure');
        if (savedPercent >= advanceThreshold) this.levelId = nextLevelId(this.levelId);
    }
    savedPercent() { return this.level?.num_lemmings ? Math.round((this.stats.lemmingsSaved / this.level.num_lemmings) * 100) : 0; }
    countDeaths() { return this.lemmings.filter(l => DEAD_STATES.has(l.state)).length; }
    observeReward() {
        const saved = this.stats.lemmingsSaved;
        const deaths = this.countDeaths();
        const delta = (saved - this.lastSaved) * 100 - (deaths - this.lastDeaths) * 15 + Math.max(0, this.bestProgress() - 500) * 0.002;
        this.lastSaved = saved; this.lastDeaths = deaths; this.lastReward = delta; this.reward += delta;
        this.bestSaved = Math.max(this.bestSaved, this.savedPercent());
    }
    bestProgress() {
        let best = 0;
        for (const l of this.lemmings) {
            if (!ACTIVE_STATES.has(l.state)) continue;
            for (const e of this.level.exitPositions) {
                const d = Math.hypot(l.x - e.x, l.y - e.y);
                best = Math.max(best, 1000 - Math.min(1000, d));
            }
        }
        return best;
    }
    canAssign(skill, lemming) {
        if (!skill || !lemming || (this.skillCounts[skill] || 0) <= 0) return false;
        if (skill === 'climber') return !lemming.isClimber;
        if (skill === 'floater') return !lemming.isFloater;
        if (skill === 'bomber') return !['dead', 'saved', 'exiting'].includes(lemming.state) && lemming.fuseValue <= 0;
        if (skill === 'blocker') return lemming.state === 'walking';
        if (skill === 'builder') return ['walking', 'falling'].includes(lemming.state);
        return lemming.state === 'walking';
    }
    chooseTarget(skill) {
        const candidates = this.lemmings.filter(l => ACTIVE_STATES.has(l.state) && this.canAssign(skill, l));
        if (!candidates.length) return null;
        candidates.sort((a, b) => this.targetScore(b, skill) - this.targetScore(a, skill));
        return candidates[0];
    }
    targetScore(l, skill) {
        let score = this.bestProgress();
        if (skill === 'floater' && l.state === 'falling') score += l.fallDistance * 20;
        if (['digger', 'miner', 'basher', 'builder'].includes(skill)) score += 100;
        return score + this.random();
    }
    applyAction(actionIndex, reason = 'trainer') {
        if (!actionIndex) return;
        const skill = SKILLS[actionIndex - 1];
        const target = this.chooseTarget(skill);
        if (!target) return;
        target.assignSkill(skill);
        this.skillCounts[skill] = Math.max(0, (this.skillCounts[skill] || 0) - 1);
        this.actions.push({ frame: this.frame, tick: this.stats.timeElapsed, attempt: this.attempt, lemmingId: target.rlId, skill, x: Math.round(target.x), y: Math.round(target.y), before: target.state, after: target.state, reason });
        if (this.actions.length > 800) this.actions.shift();
    }
    requestDecision() {
        if (socket?.readyState !== WebSocket.OPEN) {
            this.applyAction(Math.floor(this.random() * 9), 'local fallback');
            return;
        }
        const requestId = nextRequestId++;
        pendingRequests.set(requestId, this);
        socket.send(JSON.stringify({ type: 'decision', clientId: this.clientId, requestId, observation: this.observation() }));
    }
    observation() {
        return {
            level: this.levelId, attempt: this.attempt, frame: this.frame, state: 'playing',
            reward: this.reward, lastReward: this.lastReward, bestReachabilityScore: this.bestProgress(),
            stats: this.stats, releaseRate: this.level.release_rate, skillCounts: this.skillCounts,
            lemmings: this.lemmings.filter(l => ACTIVE_STATES.has(l.state)).slice(0, 10).map(l => ({ id: l.rlId, x: l.x, y: l.y, direction: l.direction, state: l.state, isClimber: l.isClimber, isFloater: l.isFloater, buildCount: l.buildCount || 0 })),
            exits: this.level.exitPositions, entrances: this.level.entrancePositions
        };
    }
    summary(gameState = 'playing') {
        const actions = this.actions.slice();
        return {
            index: this.index,
            level: this.levelId,
            seed: this.seed,
            attempt: this.attempt,
            frame: this.frame,
            gameState,
            savedPercent: this.savedPercent(),
            bestSaved: this.bestSaved,
            advanceThreshold: Math.max(60, Number(this.level?.percent_needed || 0)),
            reward: Math.round(this.reward * 10) / 10,
            actions,
            replayActions: actions,
            trainerConnected: socket?.readyState === WebSocket.OPEN
        };
    }
}

const pendingRequests = new Map();

function nextLevelId(levelId) {
    const [rating, raw] = String(levelId).split('_');
    const num = Math.max(1, Number(raw) || 1);
    if (num < 30) return `${rating}_${String(num + 1).padStart(2, '0')}`;
    const nextRating = RATINGS[(RATINGS.indexOf(rating) + 1) % RATINGS.length] || 'FUN';
    return `${nextRating}_01`;
}

function postResult(sim, gameState) {
    postMessage({ type: 'result', run: sim.summary(gameState) });
}

function connectTrainer() {
    if (!trainerUrl || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    socket = new WebSocket(trainerUrl);
    socket.onmessage = event => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        const sim = pendingRequests.get(msg.requestId);
        if (!sim) return;
        pendingRequests.delete(msg.requestId);
        sim.applyAction(Number(msg.actionIndex || 0), msg.reason || 'gpu trainer');
    };
    socket.onclose = () => setTimeout(connectTrainer, 1000);
    socket.onerror = () => {};
}

function tick() {
    if (!running) return;
    for (let burst = 0; burst < 8; burst++) {
        for (const sim of sims) sim.step();
    }
    const now = Date.now();
    if (now - lastPost > 500) {
        lastPost = now;
        postMessage({ type: 'summary', trainerConnected: socket?.readyState === WebSocket.OPEN, runs: sims.map(sim => sim.summary()) });
    }
    setTimeout(tick, 0);
}

onmessage = async event => {
    const msg = event.data || {};
    if (msg.type !== 'start') return;
    running = false;
    trainerUrl = msg.trainerUrl || '';
    try {
        tileBehaviors = parseTileBehaviors(await fetch('../assets/TileBehaviours.txt').then(r => r.text()));
    } catch {
        tileBehaviors = {};
    }
    sims = [];
    const count = Math.max(1, Number(msg.runs || 40));
    const level = String(msg.level || 'FUN_01').toUpperCase();
    const baseSeed = Number(msg.seed || Date.now());
    for (let i = 0; i < count; i++) {
        const sim = new HeadlessSim(i, level, baseSeed + i * 1009);
        await sim.reset();
        sims.push(sim);
    }
    connectTrainer();
    running = true;
    tick();
};
