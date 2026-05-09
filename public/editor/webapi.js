// ─── Browser-local shim for the static Pack Editor ───────────────────────
// No /api calls live here. File opening uses browser file pickers, saving uses
// downloads, and small editor state uses localStorage.
(function(){
  const TOKEN = 'pack-editor-local';
  const API_REMOVED = 'This Pack Editor build has no backend API. Use JSON/MLM/INI export files instead.';
  const EDITOR_BASE_URL = new URL('.', document.currentScript?.src || window.location.href);

  function editorAssetUrl(path){
    const clean = String(path || '').replace(/^\/+/, '');
    return new URL(clean, EDITOR_BASE_URL).toString();
  }

  function storageKey(key){ return TOKEN + ':' + key; }

  const LS = {
    get(key){ try { return localStorage.getItem(storageKey(key)); } catch { return null; } },
    set(key, value){ try { localStorage.setItem(storageKey(key), value); } catch {} },
    remove(key){ try { localStorage.removeItem(storageKey(key)); } catch {} },
    keys(prefix){
      try {
        const start = storageKey(prefix);
        return Object.keys(localStorage)
          .filter(key => key.startsWith(start))
          .map(key => key.slice(start.length));
      } catch { return []; }
    }
  };

  function bytesToBase64(bytes){
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < arr.length; i += chunk) {
      binary += String.fromCharCode(...arr.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function textFromBytes(bytes){
    return new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
  }

  function mimeFromFilename(filename){
    const ext = String(filename || '').split('.').pop().toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'image/png';
  }

  function dataUrlFromBytes(bytes, filename){
    return `data:${mimeFromFilename(filename)};base64,${bytesToBase64(bytes)}`;
  }

  function customLevelsUrl(filename = ''){
    const clean = String(filename || '').replace(/^\/+/, '');
    return new URL('../custom-levels/' + clean, EDITOR_BASE_URL).toString();
  }

  function pickFile(accept){
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*/*';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);

      input.onchange = async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) { resolve(null); return; }

        const data = new Uint8Array(await file.arrayBuffer());
        resolve({ path: file.name, name: file.name, data: Array.from(data), _file: file });
      };

      input.oncancel = () => { input.remove(); resolve(null); };
      input.click();
    });
  }

  function downloadBytes(bytes, filename){
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const blob = new Blob([arr]);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'download.bin';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function removedResult(extra = {}){
    return Promise.resolve({ ok: false, error: API_REMOVED, ...extra });
  }

  async function fetchStaticBytes(path){
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  let pendingAnimationPng = null;

  window.electronAPI = {
    // Local file pickers / downloads ------------------------------------------------
    openFile(filters){
      const extensions = (filters || []).flatMap(filter => (filter.extensions || []).map(ext => '.' + ext));
      return pickFile(extensions.length ? extensions.join(',') : '*/*');
    },

    async openImage(){
      const picked = await pickFile('image/*');
      if (!picked) return null;
      const ext = String(picked.name || picked.path || '').split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext || 'png'}`;
      return {
        dataUrl: `data:${mime};base64,${bytesToBase64(picked.data)}`,
        filename: picked.name || picked.path || 'image.png',
        path: picked.path || picked.name || 'image.png'
      };
    },

    saveFile({ defaultName, data }){
      downloadBytes(data || [], defaultName || 'download.bin');
      return Promise.resolve(true);
    },


    async publishCustomPngLevel(payload){
      try {
        const response = await fetch('/api/editor/custom-png-level', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });

        let data = null;
        try { data = await response.json(); } catch {}

        if (!response.ok) {
          return { ok: false, error: (data && data.error) || `${response.status} ${response.statusText}` };
        }

        return data || { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: 'Automatic publishing needs the local Node server. Start with npm run web, then open /editor/ from localhost.'
        };
      }
    },

    async publishMultiplayerLevel(payload){
      try {
        const response = await fetch('/api/editor/multiplayer-level', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });

        let data = null;
        try { data = await response.json(); } catch {}

        if (!response.ok) {
          return { ok: false, error: (data && data.error) || `${response.status} ${response.statusText}` };
        }

        return data || { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: 'Automatic multiplayer publishing needs the local Node server. Start with npm run web, then open /editor/ from localhost.'
        };
      }
    },

    async listMultiplayerLevels(){
      try {
        const response = await fetch('/api/editor/multiplayer-levels', { cache: 'no-store' });
        if (response.ok) return await response.json();
      } catch {}
      return { ok: false, levels: [], error: 'Could not read multiplayer levels from the local Node server.' };
    },

    async listCustomPngLevels(){
      try {
        const response = await fetch('/api/editor/custom-png-levels', { cache: 'no-store' });
        if (response.ok) return await response.json();
      } catch {}

      try {
        const response = await fetch(customLevelsUrl('manifest.json'), { cache: 'no-store' });
        if (!response.ok) return { ok: false, levels: [], error: 'No custom-levels manifest was found.' };
        const manifest = await response.json();
        return { ok: true, levels: Array.isArray(manifest.levels) ? manifest.levels : [], manifest };
      } catch (error) {
        return { ok: false, levels: [], error: 'Could not read custom-levels/manifest.json.' };
      }
    },

    async loadCustomPngLevel(levelId){
      const id = String(levelId || '').trim();
      if (!id) return { ok: false, error: 'No level id was provided.' };

      try {
        const response = await fetch('/api/editor/custom-png-level?id=' + encodeURIComponent(id), { cache: 'no-store' });
        if (response.ok) return await response.json();
      } catch {}

      try {
        const manifestResponse = await fetch(customLevelsUrl('manifest.json'), { cache: 'no-store' });
        if (!manifestResponse.ok) throw new Error('No manifest found.');
        const manifest = await manifestResponse.json();
        const levels = Array.isArray(manifest.levels) ? manifest.levels : [];
        const entry = levels.find(level => String(level.id || '').toLowerCase() === id.toLowerCase());
        if (!entry) return { ok: false, error: 'That PNG level is not listed in custom-levels/manifest.json.' };

        const iniName = entry.ini || `${entry.id}.mlm.ini`;
        const jsonName = entry.png_level_json || entry.pngLevelJson || `${entry.id}.pnglevel.json`;
        const terrainName = entry.terrain_png || entry.terrainPng || `${entry.id}.png`;
        const animName = entry.animation_pack_json || entry.animationLibrary || 'png-animation-library.json';

        const [iniResponse, jsonResponse, terrainBytes, animResponse] = await Promise.all([
          fetch(customLevelsUrl(iniName), { cache: 'no-store' }),
          fetch(customLevelsUrl(jsonName), { cache: 'no-store' }),
          fetchStaticBytes(customLevelsUrl(terrainName)),
          fetch(customLevelsUrl(animName), { cache: 'no-store' })
        ]);

        if (!iniResponse.ok) throw new Error('Could not read the level INI.');
        if (!jsonResponse.ok) throw new Error('Could not read the PNG level JSON.');
        if (!terrainBytes) throw new Error('Could not read the terrain PNG.');

        let animationLibrary = null;
        try { if (animResponse.ok) animationLibrary = await animResponse.json(); } catch {}

        return {
          ok: true,
          entry,
          iniText: await iniResponse.text(),
          pngLevelJson: await jsonResponse.json(),
          terrainPngDataUrl: dataUrlFromBytes(terrainBytes, terrainName),
          animationLibrary
        };
      } catch (error) {
        return { ok: false, error: error && error.message ? error.message : 'Could not load the PNG level.' };
      }
    },

    async savePngDraftAutosave(payload){
      try {
        const response = await fetch('/api/editor/png-draft-autosave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });
        let data = null;
        try { data = await response.json(); } catch {}
        if (!response.ok) throw new Error((data && data.error) || `${response.status} ${response.statusText}`);
        LS.set('png:draft-autosave', JSON.stringify(payload || {}));
        return data || { ok: true };
      } catch (error) {
        try {
          LS.set('png:draft-autosave', JSON.stringify(payload || {}));
          return { ok: true, storage: 'browser-local' };
        } catch (storageError) {
          return { ok: false, error: 'PNG draft autosave failed. Save PNG Level JSON before closing.' };
        }
      }
    },

    async loadPngDraftAutosave(){
      try {
        const response = await fetch('/api/editor/png-draft-autosave', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          if (data && data.ok && data.payload) return data;
        }
      } catch {}
      const stored = LS.get('png:draft-autosave');
      if (!stored) return { ok: false, error: 'No PNG autosave draft was found.' };
      try { return { ok: true, payload: JSON.parse(stored), storage: 'browser-local' }; }
      catch { return { ok: false, error: 'PNG autosave draft is corrupt.' }; }
    },

    async savePngAnimationLibrary(payload){
      try {
        const response = await fetch('/api/editor/png-animation-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });
        let data = null;
        try { data = await response.json(); } catch {}
        if (!response.ok) throw new Error((data && data.error) || `${response.status} ${response.statusText}`);
        LS.set('png:animation-library', JSON.stringify(payload || {}));
        return data || { ok: true };
      } catch (error) {
        try {
          LS.set('png:animation-library', JSON.stringify(payload || {}));
          return { ok: true, storage: 'browser-local' };
        } catch {
          return { ok: false, error: 'PNG animation library save failed.' };
        }
      }
    },

    async loadPngAnimationLibrary(){
      try {
        const response = await fetch('/api/editor/png-animation-library', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          if (data && data.ok && data.payload) return data;
        }
      } catch {}
      const stored = LS.get('png:animation-library');
      if (!stored) return { ok: false, error: 'No PNG animation library was found.' };
      try { return { ok: true, payload: JSON.parse(stored), storage: 'browser-local' }; }
      catch { return { ok: false, error: 'PNG animation library is corrupt.' }; }
    },

    // Static assets -----------------------------------------------------------------
    async loadTilesetImage(filename){
      try {
        const bytes = await fetchStaticBytes(editorAssetUrl(`tilesets/${encodeURIComponent(filename)}?v=${Date.now()}`));
        if (!bytes) return null;
        const ext = String(filename || '').split('.').pop().toLowerCase() || 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        return `data:${mime};base64,${bytesToBase64(bytes)}`;
      } catch { return null; }
    },

    async fetchLevelFile(filename){
      try {
        const safe = String(filename || '').replace(/^\/+/, '');
        return await fetchStaticBytes(editorAssetUrl(`levels/${encodeURIComponent(safe)}?v=${Date.now()}`));
      } catch { return null; }
    },

    // Browser-local brush/session storage ------------------------------------------
    async loadBrushes(){
      const stored = LS.get('brushes');
      if (stored) return stored;
      try {
        const res = await fetch(editorAssetUrl('default-brushes/brushes.json'), { cache: 'no-store' });
        if (res.ok) {
          const text = await res.text();
          LS.set('brushes', text);
          return text;
        }
      } catch {}
      return null;
    },
    saveBrushes(json){ LS.set('brushes', json || ''); return Promise.resolve(true); },

    async loadTilesetPackByName(filename){
      const key = 'pack:' + filename;
      const stored = LS.get(key);
      if (stored) return stored;

      try {
        const safeName = String(filename || '').replace(/\s+/g, '_');
        let res = await fetch(editorAssetUrl('default-brushes/' + encodeURIComponent(safeName)), { cache: 'no-store' });
        if (!res.ok) res = await fetch(editorAssetUrl('default-brushes/' + encodeURIComponent(filename)), { cache: 'no-store' });
        if (!res.ok) return null;
        const text = await res.text();
        LS.set(key, text);
        return text;
      } catch { return null; }
    },
    saveTilesetPackByName(filename, json){ LS.set('pack:' + filename, json || ''); return Promise.resolve(true); },

    saveSession(json){ LS.set('session:auto', json || ''); return Promise.resolve(true); },
    loadSession(){ return Promise.resolve(LS.get('session:auto')); },
    saveNamedSession(name, json){ LS.set('session:named:' + String(name || 'Untitled'), json || ''); return Promise.resolve(true); },
    loadNamedSession(name){ return Promise.resolve(LS.get('session:named:' + String(name || 'Untitled'))); },
    listSessions(){ return Promise.resolve(LS.keys('session:named:')); },

    findSiblingIni(){ return Promise.resolve(null); },
    setDirty(){},
    saveBuildPaths(){ return Promise.resolve(true); },
    loadBuildPaths(){ return Promise.resolve(null); },
    getRomStatus(){ return Promise.resolve({ ok: false, cleanRomVerified: false, error: API_REMOVED }); },

    // Local pseudo-backup of browser-side editor state ------------------------------
    async backupLevels(){
      const snapshot = {};
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith(TOKEN + ':')) snapshot[key] = localStorage.getItem(key);
        }
      } catch {}
      const bytes = new TextEncoder().encode(JSON.stringify({ format: 'sms-lemmings-pack-editor-local-storage-backup', version: 1, snapshot }, null, 2));
      downloadBytes(bytes, 'sms-lemmings-pack-editor-local-backup.json');
      return true;
    },

    async restoreLevels(){
      const picked = await pickFile('.json,application/json');
      if (!picked) return { ok: false, cancelled: true };
      try {
        const payload = JSON.parse(textFromBytes(picked.data));
        const snapshot = payload && payload.snapshot;
        if (!snapshot || typeof snapshot !== 'object') throw new Error('Not an Pack Editor local backup.');
        for (const [key, value] of Object.entries(snapshot)) {
          if (key.startsWith(TOKEN + ':')) localStorage.setItem(key, String(value));
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    },

    // Custom tilesets are not backed by an API in this static pass ------------------
    listCustomTilesets(){ return Promise.resolve({ ok: true, tilesets: [] }); },
    createTemplateTileset(){ return removedResult(); },
    cloneBuiltinTileset(){ return removedResult(); },
    duplicateCustomTileset(){ return removedResult(); },
    updateCustomTileset(){ return removedResult(); },
    deleteCustomTileset(){ return removedResult(); },
    importCustomTilesetPng(){ return removedResult(); },
    getCustomTilesetImage(){ return Promise.resolve(null); },

    async previewCustomAnimationPng(projectName, tilesetId){
      const picked = await pickFile('.png,image/png');
      if (!picked) return { ok: false, cancelled: true };
      pendingAnimationPng = { tilesetId: Number(tilesetId), filename: picked.name || picked.path || 'animation.png', data: picked.data };
      return { ok: true, filename: pendingAnimationPng.filename, dataUrl: 'data:image/png;base64,' + bytesToBase64(picked.data) };
    },
    importCustomAnimationPng(){ return removedResult(); },
    updateCustomAnimation(){ return removedResult(); },
    removeCustomAnimation(){ return removedResult(); },
    importCustomAnimationAsm(){ return removedResult(); },

    // Removed ROM/project/community API methods ------------------------------------
    downloadSmsFromCleanRom(){ return removedResult(); },
    buildInject(){ return removedResult(); },
    buildConvert(){ return removedResult(); },
    buildCompile(){ return removedResult(); },
    listLevelVersions(){ return removedResult({ versions: [] }); },
    loadLevelVersion(){ return removedResult(); },
    restoreLevelVersion(){ return removedResult(); }
  };

  console.log('[Pack Editor] browser-local shim loaded; backend API disabled');
})();
