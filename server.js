const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let WebSocketServer = null;
try {
  ({ WebSocketServer } = require('ws'));
} catch {
  WebSocketServer = null;
}

const PORT = Number(process.env.PORT || 3003);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CUSTOM_LEVELS_DIR = path.join(PUBLIC_DIR, 'custom-levels');
const MULTIPLAYER_LEVELS_DIR = path.join(PUBLIC_DIR, 'multiplayer', 'levels');
// Room codes deliberately avoid keys that are also gameplay/actions
// (X/Z/F, digits, pause/menu/volume/skill-cycle letters, and ambiguous I/O).
const MULTIPLAYER_ROOM_CODE_ALPHABET = 'ABCDGJKLRSTUVWY';
const LOGIC_FPS = 50 / 3;
const LOGIC_TICK_MS = 1000 / LOGIC_FPS;
const MATCH_START_DELAY_MS = 2500;
const COMMAND_INPUT_DELAY_TICKS = 2;
const AUTOSAVE_DIR = path.join(ROOT_DIR, '.editor-autosaves');
const PNG_ANIMATION_LIBRARY_FILE = 'png-animation-library.json';
const MAX_JSON_BYTES = 75 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.vgz': 'audio/gzip',
  '.mlm': 'text/plain; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_JSON_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function safeFilename(value, fallback) {
  const base = path.basename(String(value || fallback || 'file').replace(/\\/g, '/'));
  const cleaned = base.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/^\.+/, '') || fallback || 'file';
  return cleaned;
}

function safeLevelStem(value, fallback = 'FUN_01') {
  return safeFilename(String(value || fallback).replace(/\.(mlm\.ini|ini|pnglevel\.json|png)$/i, ''), fallback)
    .replace(/\.(mlm\.ini|ini|pnglevel\.json|png)$/i, '') || fallback;
}

function decodeDataUrl(dataUrl, expectedPrefix = 'data:image/') {
  const text = String(dataUrl || '');
  if (!text.startsWith(expectedPrefix)) return null;
  const comma = text.indexOf(',');
  if (comma < 0) return null;
  const header = text.slice(0, comma);
  const body = text.slice(comma + 1);
  if (!/;base64/i.test(header)) return null;
  return Buffer.from(body, 'base64');
}

function imageMimeForFile(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function dataUrlFromFile(file) {
  const data = fs.readFileSync(file);
  return `data:${imageMimeForFile(file)};base64,${data.toString('base64')}`;
}

function manifestFilePath() {
  return path.join(CUSTOM_LEVELS_DIR, 'manifest.json');
}

function readCustomManifest() {
  return readJsonFile(manifestFilePath(), {
    format: 'sms-lemmings-custom-level-manifest',
    version: 1,
    levels: []
  });
}

function normaliseManifestLevels(manifest) {
  return Array.isArray(manifest && manifest.levels) ? manifest.levels : [];
}

function isPngManifestEntry(entry) {
  return !!entry && (entry.png_level_json || entry.terrain_png || String(entry.map_format || entry.mapFormat || '').toLowerCase() === 'png');
}

function findManifestEntry(levelId) {
  const id = String(levelId || '').trim();
  const manifest = readCustomManifest();
  const levels = normaliseManifestLevels(manifest);
  return levels.find(level => String(level.id || '').toLowerCase() === id.toLowerCase()) || null;
}

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, payload) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function normaliseAnimationId(animation) {
  const raw = animation && (animation.id || animation.animationId || animation.animation_id || animation.name);
  return String(raw || '').trim();
}

function mergeAnimationLibraries(existing, incoming) {
  const existingAnimations = Array.isArray(existing && existing.animations) ? existing.animations : [];
  const incomingAnimations = Array.isArray(incoming && incoming.animations) ? incoming.animations : [];
  const byId = new Map();
  for (const animation of existingAnimations) {
    const id = normaliseAnimationId(animation);
    if (id) byId.set(id, animation);
  }
  for (const animation of incomingAnimations) {
    const id = normaliseAnimationId(animation);
    if (id) byId.set(id, animation);
  }
  return {
    format: 'sms-lemmings-png-animation-library',
    version: Number(incoming && incoming.version) || Number(existing && existing.version) || 1,
    name: String((incoming && incoming.name) || (existing && existing.name) || 'Global PNG Animation Library'),
    animations: Array.from(byId.values())
  };
}

function savePngAnimationLibrary(payload) {
  ensureDir(CUSTOM_LEVELS_DIR);
  const file = path.join(CUSTOM_LEVELS_DIR, PNG_ANIMATION_LIBRARY_FILE);
  const existing = readJsonFile(file, null);
  const merged = mergeAnimationLibraries(existing, payload || {});
  writeJsonFile(file, merged);
  return { payload: merged, file: `custom-levels/${PNG_ANIMATION_LIBRARY_FILE}` };
}

function normaliseMultiplayerLevelStem(value, fallback = 'MULTI_01') {
  const stem = safeLevelStem(value, fallback).replace(/[^a-zA-Z0-9_-]+/g, '_') || fallback;
  return stem.toUpperCase();
}

function decodeBytesPayload(value) {
  if (Array.isArray(value)) return Buffer.from(value.map(byte => Number(byte) & 0xFF));
  if (value && typeof value === 'object' && Array.isArray(value.data)) return Buffer.from(value.data.map(byte => Number(byte) & 0xFF));
  const text = String(value || '').trim();
  if (!text) return null;
  const clean = text.includes(',') ? text.slice(text.indexOf(',') + 1) : text;
  try {
    const buffer = Buffer.from(clean, 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function saveMultiplayerLevel(payload = {}) {
  ensureDir(MULTIPLAYER_LEVELS_DIR);
  const stem = normaliseMultiplayerLevelStem(payload.levelId || payload.level_id || payload.id, 'MULTI_01');
  const mlmName = safeFilename(payload.mlmName, `${stem}.mlm`);
  const iniName = safeFilename(payload.iniName, `${stem}.mlm.ini`);
  const mlmBytes = decodeBytesPayload(payload.mlmBase64 || payload.mlmBytes || payload.mlmData);
  const iniText = String(payload.iniText || '');

  if (!mlmBytes || !mlmBytes.length) throw new Error('Missing MLM bytes for multiplayer level publish.');
  if (!iniText.trim()) throw new Error('Missing INI text for multiplayer level publish.');

  fs.writeFileSync(path.join(MULTIPLAYER_LEVELS_DIR, mlmName), mlmBytes);
  fs.writeFileSync(path.join(MULTIPLAYER_LEVELS_DIR, iniName), iniText, 'utf8');

  return {
    id: stem,
    files: {
      mlm: `multiplayer/levels/${mlmName}`,
      ini: `multiplayer/levels/${iniName}`
    }
  };
}

function updateCustomManifest(entry) {
  ensureDir(CUSTOM_LEVELS_DIR);
  const manifestFile = manifestFilePath();
  const manifest = readCustomManifest();
  if (!Array.isArray(manifest.levels)) manifest.levels = [];
  const index = manifest.levels.findIndex(level => String(level.id || '').toUpperCase() === String(entry.id || '').toUpperCase());
  if (index >= 0) manifest.levels[index] = { ...manifest.levels[index], ...entry };
  else manifest.levels.push(entry);
  manifest.levels.sort((a, b) => {
    const packA = String(a.rating || a.pack || '').localeCompare(String(b.rating || b.pack || ''));
    if (packA) return packA;
    return Number(a.level_number || 0) - Number(b.level_number || 0) || String(a.id || '').localeCompare(String(b.id || ''));
  });
  writeJsonFile(manifestFile, manifest);
  return manifest;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/multiplayer-levels' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, levels: loadMultiplayerLevels() });
  }

  if (pathname === '/api/editor/multiplayer-levels' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, levels: loadMultiplayerLevels() });
  }

  if (pathname === '/api/editor/multiplayer-level' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const saved = saveMultiplayerLevel(body);
      return sendJson(res, 200, { ok: true, id: saved.id, files: saved.files, levels: loadMultiplayerLevels() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error && error.message ? error.message : 'Could not publish multiplayer level.' });
    }
  }

  if (pathname === '/api/editor/png-animation-library') {
    if (req.method === 'GET') {
      const file = path.join(CUSTOM_LEVELS_DIR, PNG_ANIMATION_LIBRARY_FILE);
      const payload = readJsonFile(file, null);
      if (!payload) return sendJson(res, 404, { ok: false, error: 'No PNG animation library was found.' });
      return sendJson(res, 200, { ok: true, payload, file: `custom-levels/${PNG_ANIMATION_LIBRARY_FILE}` });
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = savePngAnimationLibrary(body);
      return sendJson(res, 200, { ok: true, payload: saved.payload, file: saved.file });
    }
  }

  if (pathname === '/api/editor/png-draft-autosave') {
    const file = path.join(AUTOSAVE_DIR, 'png-draft-autosave.json');
    if (req.method === 'GET') {
      const payload = readJsonFile(file, null);
      if (!payload) return sendJson(res, 404, { ok: false, error: 'No PNG autosave draft was found.' });
      return sendJson(res, 200, { ok: true, payload });
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      writeJsonFile(file, body);
      return sendJson(res, 200, { ok: true, file: '.editor-autosaves/png-draft-autosave.json' });
    }
  }

  if (pathname === '/api/editor/custom-png-levels' && req.method === 'GET') {
    const manifest = readCustomManifest();
    const levels = normaliseManifestLevels(manifest).filter(isPngManifestEntry);
    return sendJson(res, 200, { ok: true, levels, manifest });
  }

  if (pathname === '/api/editor/custom-png-level' && req.method === 'GET') {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const id = requestUrl.searchParams.get('id') || requestUrl.searchParams.get('levelId');
    const entry = findManifestEntry(id);
    if (!entry) return sendJson(res, 404, { ok: false, error: 'Custom PNG level was not found in public/custom-levels/manifest.json.' });

    const iniName = safeFilename(entry.ini || entry.ini_file, `${entry.id}.mlm.ini`);
    const jsonName = safeFilename(entry.png_level_json || entry.pngLevelJson, `${entry.id}.pnglevel.json`);
    const terrainName = safeFilename(entry.terrain_png || entry.terrainPng, `${entry.id}.png`);
    const animationLibraryName = safeFilename(entry.animation_pack_json || entry.animationLibrary, PNG_ANIMATION_LIBRARY_FILE);

    const iniFile = path.join(CUSTOM_LEVELS_DIR, iniName);
    const jsonFile = path.join(CUSTOM_LEVELS_DIR, jsonName);
    const terrainFile = path.join(CUSTOM_LEVELS_DIR, terrainName);
    const animationFile = path.join(CUSTOM_LEVELS_DIR, animationLibraryName);

    if (!fs.existsSync(iniFile)) return sendJson(res, 404, { ok: false, error: `Missing INI file: ${iniName}` });
    if (!fs.existsSync(jsonFile)) return sendJson(res, 404, { ok: false, error: `Missing PNG level JSON file: ${jsonName}` });
    if (!fs.existsSync(terrainFile)) return sendJson(res, 404, { ok: false, error: `Missing terrain PNG file: ${terrainName}` });

    const pngLevelJson = readJsonFile(jsonFile, null);
    if (!pngLevelJson) return sendJson(res, 500, { ok: false, error: `Could not parse PNG level JSON: ${jsonName}` });

    return sendJson(res, 200, {
      ok: true,
      entry,
      iniText: fs.readFileSync(iniFile, 'utf8'),
      pngLevelJson,
      terrainPngDataUrl: dataUrlFromFile(terrainFile),
      animationLibrary: readJsonFile(animationFile, null),
      files: {
        ini: `custom-levels/${iniName}`,
        terrain_png: `custom-levels/${terrainName}`,
        png_level_json: `custom-levels/${jsonName}`,
        animation_library: `custom-levels/${animationLibraryName}`
      }
    });
  }

  if (pathname === '/api/editor/custom-png-level' && req.method === 'POST') {
    const body = await readJsonBody(req);
    ensureDir(CUSTOM_LEVELS_DIR);

    const rating = String(body.rating || 'FUN').toUpperCase().replace(/\s+/g, '') || 'FUN';
    const levelNumber = Math.max(1, Number(body.levelNumber || body.level_number || 1) || 1);
    const stem = safeLevelStem(body.levelId, `${rating}_${String(levelNumber).padStart(2, '0')}`);
    const iniName = safeFilename(body.iniName, `${stem}.mlm.ini`);
    const terrainPngName = safeFilename(body.terrainPngName, `${stem}.png`);
    const pngLevelJsonName = safeFilename(body.pngLevelJsonName, `${stem}.pnglevel.json`);
    const animationLibraryName = PNG_ANIMATION_LIBRARY_FILE;

    const terrain = decodeDataUrl(body.terrainPngDataUrl, 'data:image/');
    if (!terrain || !terrain.length) {
      return sendJson(res, 400, { ok: false, error: 'Missing terrainPngDataUrl; re-import the terrain PNG before publishing.' });
    }

    const pngLevelJson = (body.pngLevelJson && typeof body.pngLevelJson === 'object') ? body.pngLevelJson : null;
    if (!pngLevelJson) return sendJson(res, 400, { ok: false, error: 'Missing pngLevelJson payload.' });

    pngLevelJson.format = pngLevelJson.format || 'sms-lemmings-png-level';
    pngLevelJson.version = Number(pngLevelJson.version || 2);
    pngLevelJson.mapFormat = 'png';
    pngLevelJson.terrainPng = terrainPngName;
    pngLevelJson.animationLibrary = animationLibraryName;
    pngLevelJson.animationPack = { source: 'global', path: animationLibraryName };

    const iniText = String(body.iniText || '');
    if (!iniText.trim()) return sendJson(res, 400, { ok: false, error: 'Missing INI text.' });

    fs.writeFileSync(path.join(CUSTOM_LEVELS_DIR, terrainPngName), terrain);
    fs.writeFileSync(path.join(CUSTOM_LEVELS_DIR, iniName), iniText, 'utf8');
    writeJsonFile(path.join(CUSTOM_LEVELS_DIR, pngLevelJsonName), pngLevelJson);

    if (body.animationLibrary && Array.isArray(body.animationLibrary.animations)) {
      savePngAnimationLibrary(body.animationLibrary);
    }

    const manifest = updateCustomManifest({
      id: stem,
      title: String(body.title || stem),
      rating,
      pack: rating,
      level_number: levelNumber,
      ini: iniName,
      terrain_png: terrainPngName,
      png_level_json: pngLevelJsonName,
      animation_pack_json: animationLibraryName,
      updatedAt: new Date().toISOString()
    });

    return sendJson(res, 200, {
      ok: true,
      manifestCount: manifest.levels.length,
      files: {
        ini: `custom-levels/${iniName}`,
        terrain_png: `custom-levels/${terrainPngName}`,
        png_level_json: `custom-levels/${pngLevelJsonName}`,
        animation_library: `custom-levels/${animationLibraryName}`,
        manifest: 'custom-levels/manifest.json'
      }
    });
  }

  return sendJson(res, 404, { ok: false, error: 'API endpoint not found.' });
}

function serveStatic(req, res, pathname) {
  let requestPath = decodeURIComponent(pathname);
  if (requestPath === '/') requestPath = '/index.html';
  if (requestPath === '/editor') {
    res.writeHead(302, { Location: '/editor/' });
    return res.end();
  }
  if (requestPath.endsWith('/')) requestPath += 'index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden');

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) return sendText(res, 404, 'Not found');
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error && error.message ? error.message : 'Server error.' });
  }
});

function readMultiplayerIniTitle(iniPath, fallback) {
  try {
    const text = fs.readFileSync(iniPath, 'utf8');
    const line = text.split(/\r?\n/).find(entry => /^\s*name\s*=/i.test(entry));
    if (!line) return fallback;
    const title = line.replace(/^\s*name\s*=\s*/i, '').trim();
    return title || fallback;
  } catch {
    return fallback;
  }
}

function loadMultiplayerLevels() {
  try {
    return fs.readdirSync(MULTIPLAYER_LEVELS_DIR)
      .filter(name => /\.mlm$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map(name => {
        const id = name.replace(/\.mlm$/i, '').toUpperCase();
        const fallbackLabel = id.replace(/[_-]+/g, ' ');
        const ini = `${id}.mlm.ini`;
        const iniPath = path.join(MULTIPLAYER_LEVELS_DIR, ini);
        const hasIni = fs.existsSync(iniPath);
        const title = hasIni ? readMultiplayerIniTitle(iniPath, fallbackLabel) : fallbackLabel;
        return {
          id,
          label: title,
          title,
          file: name,
          ini: hasIni ? ini : null
        };
      });
  } catch {
    return [];
  }
}

function getMultiplayerLevelIds() {
  return loadMultiplayerLevels()
    .map(level => String(level && level.id || '').trim().toUpperCase())
    .filter(Boolean);
}

function normaliseMultiplayerLevelVote(levelId) {
  const id = String(levelId || '').trim().toUpperCase();
  if (id === 'RANDOM') return id;
  return getMultiplayerLevelIds().includes(id) ? id : '';
}

function resolveMultiplayerSelectedLevel(levelId) {
  const id = String(levelId || '').trim().toUpperCase();
  const playableIds = getMultiplayerLevelIds();
  if (!playableIds.length) return '';
  if (id === 'RANDOM') {
    return playableIds[Math.floor(Math.random() * playableIds.length)];
  }
  return playableIds.includes(id) ? id : playableIds[0];
}

function getMultiplayerLevelsForMenu() {
  return [
    { id: 'RANDOM', label: 'RANDOM', title: 'RANDOM' },
    ...loadMultiplayerLevels()
  ];
}

function normaliseMultiplayerLevelChoice(levelId) {
  const choice = String(levelId || '').trim().toUpperCase();
  if (choice === 'RANDOM') return choice;
  const available = loadMultiplayerLevels().map(level => String(level.id || '').trim().toUpperCase());
  return available.includes(choice) ? choice : '';
}

function setupMultiplayerServer() {
  if (!WebSocketServer) {
    console.warn('Multiplayer WebSocket support unavailable: install the ws package to enable /mp.');
    return;
  }

  const wss = new WebSocketServer({ server, path: '/mp' });
  const rooms = new Map();

  function makeRoomCode() {
    const alphabet = MULTIPLAYER_ROOM_CODE_ALPHABET;
    let code = '';
    do {
      code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function send(ws, message) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.warn('Could not send websocket message:', error.message);
    }
  }

  function getPlayerCount(room) {
    return room.players.filter(Boolean).length;
  }

  function getPlayerVote(room, playerNumber) {
    return room.levelVotes[playerNumber] || null;
  }

  function buildRoomStateFor(room, client) {
    return {
      type: 'roomState',
      roomCode: room.code,
      player: client.player || 0,
      playerCount: getPlayerCount(room),
      phase: room.phase,
      levelVotes: {
        1: getPlayerVote(room, 1),
        2: getPlayerVote(room, 2)
      },
      selectedLevel: room.selectedLevel || null,
      levels: getMultiplayerLevelsForMenu()
    };
  }

  function broadcastRoom(room) {
    if (!room) return;
    if (getPlayerCount(room) >= 2 && room.phase === 'room') {
      room.phase = 'levelSelect';
    }

    for (const client of room.players) {
      if (client) send(client, buildRoomStateFor(room, client));
    }
  }

  function resolveLevelChoice(room) {
    const available = loadMultiplayerLevels().map(level => String(level.id || '').trim().toUpperCase()).filter(Boolean);
    const p1 = room.levelVotes[1];
    const p2 = room.levelVotes[2];
    const choices = [p1, p2]
      .filter(Boolean)
      .map(choice => choice === 'RANDOM'
        ? available[Math.floor(Math.random() * available.length)]
        : choice)
      .filter(choice => available.includes(choice));

    if (!choices.length) return available[0] || 'MULTI_01';
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function startMatchIfReady(room) {
    if (!room || getPlayerCount(room) < 2) return false;
    if (!room.levelVotes[1] || !room.levelVotes[2]) return false;

    const now = Date.now();
    room.selectedLevel = resolveLevelChoice(room);
    room.phase = 'playing';
    room.startAt = now + MATCH_START_DELAY_MS;
    room.commandSequence = 0;

    for (const client of room.players) {
      if (!client) continue;
      send(client, {
        type: 'matchStart',
        roomCode: room.code,
        levelId: room.selectedLevel,
        serverTime: now,
        startAt: room.startAt,
        logicFps: LOGIC_FPS,
        inputDelayTicks: COMMAND_INPUT_DELAY_TICKS
      });
    }

    return true;
  }

  function resetRoomToLevelSelect(room) {
    if (!room) return;
    room.phase = getPlayerCount(room) >= 2 ? 'levelSelect' : 'room';
    room.levelVotes = { 1: null, 2: null };
    room.selectedLevel = null;
    room.startAt = 0;
    room.commandSequence = 0;
    broadcastRoom(room);
  }

  function closeRoomToMenu(room, status = 'LEFT LOBBY') {
    if (!room) return;
    const clients = room.players.filter(Boolean);
    for (const client of clients) {
      send(client, { type: 'leftLobby', status });
      client.roomCode = null;
      client.player = 0;
    }
    rooms.delete(room.code);
  }

  function forfeitRoom(room, leavingClient, reason = 'FORFEIT') {
    if (!room || !leavingClient || !(leavingClient.player === 1 || leavingClient.player === 2)) {
      closeRoomToMenu(room, reason);
      return;
    }

    const loser = leavingClient.player;
    const winner = loser === 1 ? 2 : 1;
    const clients = room.players.filter(Boolean);
    for (const client of clients) {
      if (client === leavingClient) {
        send(client, { type: 'leftLobby', status: reason });
      } else {
        send(client, { type: 'matchForfeit', winner, loser, reason });
      }
      client.roomCode = null;
      client.player = 0;
    }
    rooms.delete(room.code);
  }

  function leaveCurrentRoom(ws, options = {}) {
    const code = ws.roomCode;
    if (!code) {
      ws.player = 0;
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      ws.roomCode = null;
      ws.player = 0;
      return;
    }

    if (options.forfeitIfPlaying && room.phase === 'playing') {
      forfeitRoom(room, ws, options.reason || 'FORFEIT');
      return;
    }

    if (options.closeRoom) {
      closeRoomToMenu(room, options.reason || 'LEFT LOBBY');
      return;
    }

    room.players = room.players.map(client => client === ws ? null : client);
    if (ws.player === 1 || ws.player === 2) room.levelVotes[ws.player] = null;
    ws.roomCode = null;
    ws.player = 0;

    if (!room.players.some(Boolean)) {
      rooms.delete(code);
      return;
    }

    room.phase = getPlayerCount(room) >= 2 ? 'levelSelect' : 'room';
    room.selectedLevel = null;
    room.startAt = 0;
    room.commandSequence = 0;
    broadcastRoom(room);
  }

  function createRoom(ws) {
    leaveCurrentRoom(ws);
    const code = makeRoomCode();
    const room = {
      code,
      players: [ws, null],
      phase: 'room',
      levelVotes: { 1: null, 2: null },
      selectedLevel: null,
      startAt: 0,
      commandSequence: 0
    };

    rooms.set(code, room);
    ws.roomCode = code;
    ws.player = 1;

    send(ws, {
      type: 'lobbyCreated',
      roomCode: code,
      player: 1,
      playerCount: 1,
      phase: room.phase,
      levels: getMultiplayerLevelsForMenu()
    });
    broadcastRoom(room);
  }

  function joinRoom(ws, roomCode) {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return send(ws, { type: 'error', message: 'ROOM NOT FOUND' });
    if (room.players[0] && room.players[1] && !room.players.includes(ws)) {
      return send(ws, { type: 'error', message: 'ROOM FULL' });
    }

    leaveCurrentRoom(ws);
    const slotIndex = room.players[0] ? 1 : 0;
    room.players[slotIndex] = ws;
    ws.roomCode = code;
    ws.player = slotIndex + 1;

    if (getPlayerCount(room) >= 2 && room.phase === 'room') {
      room.phase = 'levelSelect';
    }

    send(ws, {
      type: 'lobbyJoined',
      roomCode: code,
      player: ws.player,
      playerCount: getPlayerCount(room),
      phase: room.phase,
      levels: getMultiplayerLevelsForMenu()
    });
    broadcastRoom(room);
  }

  function handleLevelSelect(ws, levelId) {
    const room = rooms.get(ws.roomCode);
    if (!room || !(ws.player === 1 || ws.player === 2)) {
      send(ws, { type: 'error', message: 'NO ROOM' });
      return;
    }

    const choice = normaliseMultiplayerLevelChoice(levelId);
    if (!choice) {
      send(ws, { type: 'error', message: 'BAD LEVEL' });
      return;
    }

    room.phase = 'levelSelect';
    room.levelVotes[ws.player] = choice;
    if (!startMatchIfReady(room)) broadcastRoom(room);
  }

  function handleAssignSkill(ws, message) {
    const room = rooms.get(ws.roomCode);
    if (!room || !(ws.player === 1 || ws.player === 2)) {
      send(ws, { type: 'error', message: 'NO ROOM' });
      return;
    }
    if (room.phase !== 'playing') {
      send(ws, { type: 'error', message: 'NOT PLAYING' });
      return;
    }

    const skill = String(message.skill || '').trim().toLowerCase();
    const lemmingId = Number(message.lemmingId);
    const proposedTick = Number(message.tick || 0);
    if (!skill || !Number.isFinite(lemmingId)) {
      send(ws, { type: 'error', message: 'BAD COMMAND' });
      return;
    }

    const serverTick = room.startAt
      ? Math.max(0, Math.floor((Date.now() - room.startAt) / LOGIC_TICK_MS))
      : 0;
    const tick = Math.max(Number.isFinite(proposedTick) ? proposedTick : 0, serverTick + COMMAND_INPUT_DELAY_TICKS);

    room.commandSequence = Number(room.commandSequence || 0) + 1;
    const command = {
      type: 'assignSkill',
      roomCode: room.code,
      commandId: `${room.code}-${room.commandSequence}`,
      player: ws.player,
      skill,
      lemmingId,
      tick,
      serverTick
    };

    for (const client of room.players) {
      if (client) send(client, command);
    }
  }

  function handleMatchComplete(ws, message = {}) {
    const room = rooms.get(ws.roomCode);
    if (!room || !(ws.player === 1 || ws.player === 2)) return;
    if (room.phase !== 'playing' && room.phase !== 'result') return;

    room.phase = 'result';
    room.lastResult = {
      p1: Number(message.p1 || 0),
      p2: Number(message.p2 || 0),
      winner: Number(message.winner || 0),
      reportedBy: ws.player,
      reportedAt: Date.now()
    };
    broadcastRoom(room);
  }

  wss.on('connection', ws => {
    ws.roomCode = null;
    ws.player = 0;

    send(ws, { type: 'connected', levels: getMultiplayerLevelsForMenu() });

    ws.on('message', rawData => {
      let message;
      try {
        message = JSON.parse(rawData.toString());
      } catch {
        send(ws, { type: 'error', message: 'BAD MESSAGE' });
        return;
      }

      switch (message.type) {
        case 'createLobby':
          createRoom(ws);
          break;
        case 'joinLobby':
          joinRoom(ws, message.roomCode);
          break;
        case 'selectLevel':
          handleLevelSelect(ws, message.levelId);
          break;
        case 'assignSkill':
          handleAssignSkill(ws, message);
          break;
        case 'matchComplete':
          handleMatchComplete(ws, message);
          break;
        case 'rematch': {
          const room = rooms.get(ws.roomCode);
          if (!room) {
            send(ws, { type: 'error', message: 'NO ROOM' });
            return;
          }
          resetRoomToLevelSelect(room);
          break;
        }
        case 'endMatch':
        case 'leaveLobby': {
          const room = rooms.get(ws.roomCode);
          if (room?.phase === 'playing') {
            leaveCurrentRoom(ws, { forfeitIfPlaying: true, reason: 'FORFEIT' });
          } else if (room) {
            closeRoomToMenu(room, 'LEFT LOBBY');
          } else {
            leaveCurrentRoom(ws);
            send(ws, { type: 'leftLobby', status: 'LEFT LOBBY' });
          }
          break;
        }
        case 'ping':
          send(ws, { type: 'pong', time: Date.now() });
          break;
        default:
          send(ws, { type: 'error', message: 'UNKNOWN MESSAGE' });
          break;
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom(ws, { forfeitIfPlaying: true, closeRoom: true, reason: 'DISCONNECT FORFEIT' });
    });

    ws.on('error', error => {
      console.warn('WebSocket error:', error.message);
      leaveCurrentRoom(ws, { forfeitIfPlaying: true, closeRoom: true, reason: 'DISCONNECT FORFEIT' });
    });
  });

  console.log('Multiplayer WebSocket endpoint: /mp');
}
setupMultiplayerServer();

server.listen(PORT, () => {
  console.log(`SMS Lemmings server running at http://localhost:${PORT}/`);
  console.log(`Editor available at http://localhost:${PORT}/editor/`);
});
