class LevelLoader {
    constructor() {
        this.tilesetMap = ['Grass', 'Sand 1', 'Fire', 'Ice', 'Brick', 'Fire2', 'Sand 2', 'Sega'];

        // Updated hatch tile IDs from your research
        this.entranceMarkers = [
            38, // 0 Grass
            26, // 1 Sand 1
            47, // 2 Fire
            37, // 3 Ice/Crystal
            44, // 4 Brick/Pillar
            47, // 5 Fire2
            65, // 6 Sand 2
            20  // 7 Sega 2 (Fallback)
        ];

        this.exitTriggerTiles = [
    /* 0 Grass  */ [ 85,  86],
    /* 1 Sand   */ [100, 101],
    /* 2 Fire   */ [98],
    /* 3 Ice    */ [105, 106],
    /* 4 Brick  */ [ 60,  61],
    /* 5 Fire2   */ [98],
    /* 6 Sand 2 */ [142, 143],
    /* 7 Sega 2 */ [128, 129],
];

        // trap_type values from the editor/INI:
        // 0 = none
        // 1 = Crusher (Brick)
        // 2 = Noose (Sand 2 / Yellow)
        // 3 = Bear Trap (Grass)
        // 4 = Tap/Drip (SEGA)
        //
        // trap_x/trap_y are trigger points in pixels. The offsets below place the
        // top-left of the visual trap animation relative to that trigger tile.
        this.trapDefinitions = {
            1: { name: 'crusher', displayName: 'Crusher', width: 4, height: 2, topLeftOffsetX: -2, topLeftOffsetY: -2 },
            2: { name: 'noose', displayName: 'Noose', width: 1, height: 4, topLeftOffsetX: 0, topLeftOffsetY: -4 },
            3: { name: 'bearTrap', displayName: 'Bear Trap', width: 2, height: 2, topLeftOffsetX: -1, topLeftOffsetY: -2 },
            4: { name: 'drip', displayName: 'Tap', width: 1, height: 4, topLeftOffsetX: 0, topLeftOffsetY: -4 }
        };

        this.defaultLevelWidthTiles = 112;
        this.defaultLevelHeightTiles = 19;
        this.customRatingOrder = ['FUN', 'TRICKY', 'TAXING', 'MAYHEM', 'EXTRA1', 'EXTRA2', 'EXTRA3', 'EXTRA4'];
    }

    parseIniValue(key, value) {
        const raw = String(value ?? '').trim();
        if (raw === '') return '';
        if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';

        // INI metadata is now also used for pack/editor fields, so only parse
        // clean integer values as numbers. Everything else remains a string.
        if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
        return raw;
    }

    getFirstFiniteNumber(...values) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isFinite(number) && number > 0) return Math.floor(number);
        }
        return null;
    }

    resolveLevelDimensions(iniData = {}, mlmByteLength = null) {
        const width = this.getFirstFiniteNumber(
            iniData.width_tiles,
            iniData.level_width_tiles,
            iniData.map_width_tiles,
            iniData.cols,
            iniData.columns,
            iniData.width
        ) || this.defaultLevelWidthTiles;

        const explicitHeight = this.getFirstFiniteNumber(
            iniData.height_tiles,
            iniData.level_height_tiles,
            iniData.map_height_tiles,
            iniData.rows,
            iniData.height
        );

        let height = explicitHeight || this.defaultLevelHeightTiles;

        // If a custom width is provided but height is missing, use the decoded
        // MLM byte count as a last-ditch helper. Existing original levels still
        // fall back to 112x19.
        if (!explicitHeight && Number.isFinite(mlmByteLength) && mlmByteLength > 0 && width > 0) {
            const inferredHeight = Math.ceil(mlmByteLength / width);
            if (inferredHeight > 0) height = inferredHeight;
        }

        return { width, height };
    }

    sortBookOrder(positions) {
        return positions.sort((a, b) => {
            if (a.tileY !== b.tileY) return a.tileY - b.tileY;
            return a.tileX - b.tileX;
        });
    }

    findMarkerPositions(tilemap, width, markerTile, maxCount = 4) {
        const positions = [];

        // "Reading a book" order naturally happens by scanning the flat tilemap:
        // left-to-right across a row, then down to the next row.
        for (let i = 0; i < tilemap.length; i++) {
            if (tilemap[i] !== markerTile) continue;

            const tileX = i % width;
            const tileY = Math.floor(i / width);

            positions.push({
                tileX,
                tileY,
                x: tileX * 8,
                y: tileY * 8,
                engineId: positions.length
            });
        }

        if (positions.length > maxCount) {
            console.warn(`Found ${positions.length} entrances; SMS supports ${maxCount}. Using the first ${maxCount} in engine order.`);
        }

        return positions.slice(0, maxCount);
    }

    findMarkerPosition(tilemap, width, markerTile) {
        // Compatibility helper for older code.
        return this.findMarkerPositions(tilemap, width, markerTile, 1)[0] || null;
    }

    findExitPositions(tilemap, width, height, tilesetIndex, maxCount = 3) {
        const exitTiles = this.exitTriggerTiles[tilesetIndex];
        if (!exitTiles) return [];

        const isExitTile = (tileX, tileY) => {
            if (tileX < 0 || tileX >= width || tileY < 0 || tileY >= height) return false;
            return exitTiles.includes(tilemap[tileY * width + tileX]);
        };

        const visited = new Set();
        const exits = [];

        for (let tileY = 0; tileY < height; tileY++) {
            for (let tileX = 0; tileX < width; tileX++) {
                const key = `${tileX},${tileY}`;
                if (visited.has(key) || !isExitTile(tileX, tileY)) continue;

                // Group adjacent exit trigger tiles into a single exit.
                const stack = [{ tileX, tileY }];
                const component = [];
                visited.add(key);

                while (stack.length > 0) {
                    const current = stack.pop();
                    component.push(current);

                    const neighbours = [
                        { tileX: current.tileX - 1, tileY: current.tileY },
                        { tileX: current.tileX + 1, tileY: current.tileY },
                        { tileX: current.tileX, tileY: current.tileY - 1 },
                        { tileX: current.tileX, tileY: current.tileY + 1 }
                    ];

                    for (const next of neighbours) {
                        const nextKey = `${next.tileX},${next.tileY}`;
                        if (visited.has(nextKey) || !isExitTile(next.tileX, next.tileY)) continue;
                        visited.add(nextKey);
                        stack.push(next);
                    }
                }

                component.sort((a, b) => {
                    if (a.tileY !== b.tileY) return a.tileY - b.tileY;
                    return a.tileX - b.tileX;
                });

                const minX = Math.min(...component.map(p => p.tileX));
				const maxX = Math.max(...component.map(p => p.tileX));
				const minY = Math.min(...component.map(p => p.tileY));
				const maxY = Math.max(...component.map(p => p.tileY));

				const componentWidth = maxX - minX + 1;

				exits.push({
					tileX: minX,
					tileY: minY,

					// Centre the trigger within the grouped exit marker.
					// Two-tile exits still trigger between the two marker tiles.
					// One-tile exits trigger at the centre of that tile instead of its right edge.
					x: (minX + componentWidth / 2) * 8,
					y: minY * 8,
					leftX: minX * 8,
					rightX: ((maxX + 1) * 8) - 1,
					topY: minY * 8,
					bottomY: ((maxY + 1) * 8) - 1,

					engineId: exits.length,
					tiles: component
				});
            }
        }

        this.sortBookOrder(exits);

        exits.forEach((exit, index) => {
            exit.engineId = index;
        });

        if (exits.length > maxCount) {
            console.warn(`Found ${exits.length} exits; SMS supports ${maxCount}. Using the first ${maxCount} in engine order.`);
        }

        return exits.slice(0, maxCount);
    }

    findExitPosition(tilemap, width, tilesetIndex) {
        // Compatibility helper for older code.
        // Height is inferred from the current SMS level dimensions.
        return this.findExitPositions(tilemap, width, Math.ceil(tilemap.length / width), tilesetIndex, 1)[0] || null;
    }

    getCameraEntrance(entrancePositions) {
        if (!entrancePositions || entrancePositions.length === 0) return null;

        // Camera starts on the furthest-left entrance, regardless of spawn order.
        return [...entrancePositions].sort((a, b) => {
            if (a.tileX !== b.tileX) return a.tileX - b.tileX;
            return a.tileY - b.tileY;
        })[0];
    }

    getHardcodedHiddenExitDefinition(iniData = {}, levelName = '') {
        const rawName = String(iniData.name || '').trim().toUpperCase();
        const normalizedName = rawName.replace(/\?+$/u, '').trim();
        const normalizedLevelName = String(levelName || '').trim().toUpperCase();

        const hiddenExitDefinitions = [
            {
                // Tricky 28: LOST SOMETHING?
                matches: normalizedLevelName === 'TRICKY_28' || normalizedName === 'LOST SOMETHING',
                tileXStart: 55,
                tileYStart: 5,
                source: 'lost-something-hidden-exit'
            },
            {
                // Extra 4-05: STRAY SHEEP
                matches: normalizedLevelName === 'EXTRA4_05' || normalizedName === 'STRAY SHEEP',
                tileXStart: 27,
                tileYStart: 2,
                source: 'stray-sheep-hidden-exit'
            }
        ];

        return hiddenExitDefinitions.find(definition => definition.matches) || null;
    }

    getHardcodedBackLayerTiles(iniData = {}, levelName = '') {
        const hiddenExit = this.getHardcodedHiddenExitDefinition(iniData, levelName);
        if (!hiddenExit) return [];

        const rows = [
            { tileY: hiddenExit.tileYStart, firstTile: 74 },
            { tileY: hiddenExit.tileYStart + 1, firstTile: 78 },
            { tileY: hiddenExit.tileYStart + 2, firstTile: 84 }
        ];

        const tiles = [];

        for (const row of rows) {
            for (let offset = 0; offset < 4; offset++) {
                tiles.push({
                    tileX: hiddenExit.tileXStart + offset,
                    tileY: row.tileY,
                    tileIndex: row.firstTile + offset,
                    source: hiddenExit.source
                });
            }
        }

        return tiles;
    }

    getHardcodedExitPositions(iniData = {}, levelName = '') {
        const hiddenExit = this.getHardcodedHiddenExitDefinition(iniData, levelName);
        if (!hiddenExit) return [];

        const hiddenExitTiles = this.getHardcodedBackLayerTiles(iniData, levelName);
        const exitWidthTiles = 4;
        const exitBottomTileY = hiddenExit.tileYStart + 2;

        return [{
            tileX: hiddenExit.tileXStart,
            tileY: hiddenExit.tileYStart,

            // Hidden exits are four tiles wide. The lemming exit check samples
            // the foot/contact Y, so the trigger is anchored to the bottom
            // row of the hidden exit graphic rather than the top row.
            x: (hiddenExit.tileXStart + exitWidthTiles / 2) * 8,
            y: exitBottomTileY * 8,
            leftX: hiddenExit.tileXStart * 8,
            rightX: ((hiddenExit.tileXStart + exitWidthTiles) * 8) - 1,
            topY: hiddenExit.tileYStart * 8,
            bottomY: ((exitBottomTileY + 1) * 8) - 1,

            engineId: 0,
            source: hiddenExit.source,
            tiles: hiddenExitTiles.map(tile => ({
                tileX: tile.tileX,
                tileY: tile.tileY,
                tileIndex: tile.tileIndex
            }))
        }];
    }

    findTrapInstances(iniData) {
        const traps = [];

        const addTrap = (type, x, y, sourceKey = 'trap') => {
            if (!Number.isFinite(type) || type === 0) return;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;

            const definition = this.trapDefinitions[type];
            if (!definition) {
                console.warn(`Unknown trap type ${type} at ${x},${y}`);
                return;
            }

            const triggerTileX = Math.floor(x / 8);
            const triggerTileY = Math.floor(y / 8);

            traps.push({
                id: `${sourceKey}_${traps.length}`,
                type,
                name: definition.name,
                displayName: definition.displayName,
                x,
                y,
                triggerTileX,
                triggerTileY,
                topLeftTileX: triggerTileX + definition.topLeftOffsetX,
                topLeftTileY: triggerTileY + definition.topLeftOffsetY,
                width: definition.width,
                height: definition.height
            });
        };

        // Current format used by the editor.
        addTrap(iniData.trap_type, iniData.trap_x, iniData.trap_y, 'trap');

        // Future-proofing in case we add multiple trap entries later.
        // Supported shapes:
        //   trap_1_type / trap_1_x / trap_1_y
        //   trap_type_1 / trap_x_1 / trap_y_1
        for (let i = 1; i <= 8; i++) {
            addTrap(iniData[`trap_${i}_type`], iniData[`trap_${i}_x`], iniData[`trap_${i}_y`], `trap_${i}`);
            addTrap(iniData[`trap_type_${i}`], iniData[`trap_x_${i}`], iniData[`trap_y_${i}`], `trap_${i}`);
        }

        return traps;
    }



    normalisePathValue(value) {
        if (value === undefined || value === null) return null;
        // Some older PNG editor saves used nested objects such as
        // { animation: { id: "..." } }. Treat those as absent here instead
        // of turning them into the literal string "[object Object]", which
        // then prevents overlay objects from resolving their animation.
        if (typeof value === 'object') return null;
        const text = String(value).trim();
        return text || null;
    }

    getDirectory(path) {
        const text = String(path || '');
        const slash = text.lastIndexOf('/');
        return slash >= 0 ? text.slice(0, slash + 1) : '';
    }

    resolveRelativePath(value, basePath = '') {
        const text = this.normalisePathValue(value);
        if (!text) return null;
        if (/^(https?:)?\/\//i.test(text) || text.startsWith('/') || text.startsWith('data:')) return text;
        if (/^(assets|bundled-levels|custom-levels)\//i.test(text)) return text;
        return `${this.getDirectory(basePath)}${text}`;
    }

    firstTextValue(...values) {
        for (const value of values) {
            const text = this.normalisePathValue(value);
            if (text) return text;
        }
        return null;
    }

    getTerrainPngPath(iniData = {}, iniPath = '') {
        const value = this.firstTextValue(
            iniData.terrain_png,
            iniData.terrain_image,
            iniData.map_image,
            iniData.png
        );
        return this.resolveRelativePath(value, iniPath);
    }

    async loadJSON(path, fallback = null) {
        if (!path) return fallback;
        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.warn(`Could not load JSON ${path}:`, error);
            return fallback;
        }
    }

    async loadTerrainPNG(path) {
        const data = await Utils.loadIndexedImage(path);
        if (data.width % 8 !== 0 || data.height % 8 !== 0) {
            throw new Error(`PNG terrain dimensions must be multiples of 8: ${path} is ${data.width}×${data.height}`);
        }

        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = data.width;
        displayCanvas.height = data.height;
        const displayCtx = displayCanvas.getContext('2d');
        const displayData = displayCtx.createImageData(data.width, data.height);
        const collisionMask = new Uint8Array(data.width * data.height);

        for (let i = 0; i < data.data.length; i += 4) {
            const pixel = i / 4;
            const r = data.data[i];
            const g = data.data[i + 1];
            const b = data.data[i + 2];
            const a = data.data[i + 3];
            const isAir = a === 0 || (r === 0 && g === 0 && b === 0);

            collisionMask[pixel] = isAir ? 0 : 1;
            displayData.data[i] = r;
            displayData.data[i + 1] = g;
            displayData.data[i + 2] = b;
            displayData.data[i + 3] = isAir ? 0 : a;
        }

        displayCtx.putImageData(displayData, 0, 0);

        return {
            path,
            image: data.image,
            displayImage: displayCanvas,
            width: data.width,
            height: data.height,
            widthTiles: data.width / 8,
            heightTiles: data.height / 8,
            collisionMask
        };
    }

    defaultPngZIndexForRole(role) {
        const map = {
            decorative: 0,
            no_collision: 5,
            steel: 5,
            water: 20,
            acid: 20,
            toxic: 20,
            fire: 30,
            hatch: 40,
            exit: 50,
            goal: 50,
            triggered_trap: 120
        };
        return map[String(role || 'decorative').toLowerCase()] ?? 0;
    }

    normaliseAnimationIdValue(value) {
        if (value === undefined || value === null) return null;
        if (typeof value === 'object') {
            return this.normaliseAnimationIdValue(value.id || value.animationId || value.animation_id || value.name);
        }
        const text = String(value).trim();
        return text || null;
    }

    firstAnimationIdValue(...values) {
        for (const value of values) {
            const text = this.normaliseAnimationIdValue(value);
            if (text) return text;
        }
        return null;
    }

    normaliseOverlayObjects(rawObjects = [], animationPack = null, basePath = '') {
        const objects = Array.isArray(rawObjects) ? rawObjects : [];
        return objects.map((raw, index) => {
            const role = String(raw.role || raw.type || 'decorative').toLowerCase();
            const col = this.getFirstFiniteNumber(raw.col, raw.tile_col, raw.tileX, raw.tile_x);
            const row = this.getFirstFiniteNumber(raw.row, raw.tile_row, raw.tileY, raw.tile_y);
            const x = this.getFirstFiniteNumber(raw.x, raw.pixel_x, raw.left, col !== null ? col * 8 : null) || 0;
            const y = this.getFirstFiniteNumber(raw.y, raw.pixel_y, raw.top, row !== null ? row * 8 : null) || 0;
            const widthTiles = this.getFirstFiniteNumber(raw.width_tiles, raw.widthTiles, raw.w_tiles, raw.w, raw.width) || 1;
            const heightTiles = this.getFirstFiniteNumber(raw.height_tiles, raw.heightTiles, raw.h_tiles, raw.h, raw.height) || 1;
            const widthPx = this.getFirstFiniteNumber(raw.width_px, raw.widthPx) || widthTiles * 8;
            const heightPx = this.getFirstFiniteNumber(raw.height_px, raw.heightPx) || heightTiles * 8;
            const animationId = this.firstAnimationIdValue(
                raw.animation_id,
                raw.animationId,
                raw.anim_id,
                raw.animId,
                raw.animation_key,
                raw.animationKey,
                raw.animation?.id,
                raw.animation?.animation_id,
                raw.animation?.animationId,
                raw.anim?.id,
                raw.anim?.animation_id,
                raw.anim?.animationId,
                raw.anim,
                raw.animation
            );
            const zIndex = this.getFirstFiniteNumber(raw.zIndex, raw.z_index, raw.z, raw.layer);

            return {
                ...raw,
                id: this.firstTextValue(raw.id) || `overlay_${index}`,
                role,
                col: col ?? Math.floor(x / 8),
                row: row ?? Math.floor(y / 8),
                x,
                y,
                widthTiles,
                heightTiles,
                widthPx,
                heightPx,
                animationId,
                zIndex: zIndex ?? this.defaultPngZIndexForRole(role),
                trigger: this.firstTextValue(raw.trigger) || undefined,
                triggerX: this.getFirstFiniteNumber(raw.trigger_x, raw.triggerX, raw.trap_x),
                triggerY: this.getFirstFiniteNumber(raw.trigger_y, raw.triggerY, raw.trap_y),
                source: raw.source || 'png-overlay'
            };
        });
    }

    normaliseAnimationPack(rawPack = {}, basePath = '') {
        const animations = Array.isArray(rawPack?.animations) ? rawPack.animations : [];
        return {
            ...rawPack,
            animations: animations.map((animation) => {
                const image = this.resolveRelativePath(
                    animation.image ||
                    animation.png ||
                    animation.source ||
                    animation.src ||
                    animation.url ||
                    animation.dataUrl ||
                    animation.data_url ||
                    animation.imageDataUrl ||
                    animation.image_data_url,
                    basePath
                );
                const frameWidthTiles = this.getFirstFiniteNumber(animation.frame_width_tiles, animation.frameWidthTiles, animation.width_tiles, animation.widthTiles) || 1;
                const frameHeightTiles = this.getFirstFiniteNumber(animation.frame_height_tiles, animation.frameHeightTiles, animation.height_tiles, animation.heightTiles) || 1;
                return {
                    ...animation,
                    id: String(animation.id || animation.animationId || animation.animation_id || animation.name || image || 'animation'),
                    image,
                    frameWidthTiles,
                    frameHeightTiles,
                    frameWidth: this.getFirstFiniteNumber(animation.frame_width_px, animation.frameWidthPx, animation.frame_width, animation.frameWidth) || frameWidthTiles * 8,
                    frameHeight: this.getFirstFiniteNumber(animation.frame_height_px, animation.frameHeightPx, animation.frame_height, animation.frameHeight) || frameHeightTiles * 8,
                    frames: this.getFirstFiniteNumber(animation.frames, animation.frame_count, animation.frameCount) || 1,
                    orientation: String(animation.orientation || animation.frame_axis || animation.frameAxis || 'horizontal').toLowerCase(),
                    trigger: String(animation.trigger || 'constant_loop').toLowerCase(),
                    role: String(animation.role || 'decorative').toLowerCase()
                };
            })
        };
    }

    async loadPngOverlay(iniData = {}, iniPath = '') {
        const levelJsonPath = this.resolveRelativePath(
            this.firstTextValue(iniData.png_level_json, iniData.png_animations_json, iniData.level_json),
            iniPath
        );

        if (levelJsonPath) {
            const rawLevel = await this.loadJSON(levelJsonPath, null);
            if (rawLevel) {
                const embeddedAnimations = rawLevel.animations || rawLevel.animationPack?.animations || rawLevel.animation_pack?.animations || [];
                const embeddedPack = rawLevel.animationPack || rawLevel.animation_pack || { animations: embeddedAnimations };
                const libraryPath = this.resolveRelativePath(
                    this.firstTextValue(
                        rawLevel.animationLibrary,
                        rawLevel.animation_library,
                        rawLevel.animationPack?.path,
                        rawLevel.animation_pack?.path,
                        iniData.animation_pack_json,
                        iniData.animation_pack,
                        iniData.animations_json,
                        'png-animation-library.json'
                    ),
                    levelJsonPath
                );
                const libraryPack = libraryPath ? await this.loadJSON(libraryPath, null) : null;
                const libraryAnimations = Array.isArray(libraryPack?.animations) ? libraryPack.animations : [];
                const animationPack = this.normaliseAnimationPack(
                    { ...(libraryPack || embeddedPack || {}), animations: [...libraryAnimations, ...embeddedAnimations] },
                    libraryPath || levelJsonPath
                );
                const overlayObjects = this.normaliseOverlayObjects(rawLevel.objects || rawLevel.overlayObjects || rawLevel.overlay_objects || [], animationPack, levelJsonPath);

                return { levelJsonPath, overlayPath: levelJsonPath, packPath: libraryPath || levelJsonPath, animationPack, overlayObjects };
            }
        }

        const overlayPath = this.resolveRelativePath(
            this.firstTextValue(iniData.overlay_json, iniData.animation_overlay, iniData.objects_json),
            iniPath
        );
        const packPath = this.resolveRelativePath(
            this.firstTextValue(iniData.animation_pack_json, iniData.animation_pack, iniData.animations_json),
            iniPath
        );

        const rawOverlay = await this.loadJSON(overlayPath, { objects: [] });
        const rawPack = await this.loadJSON(packPath, { animations: [] });
        const animationPack = this.normaliseAnimationPack(rawPack || {}, packPath || iniPath);
        const overlayObjects = this.normaliseOverlayObjects(
            Array.isArray(rawOverlay) ? rawOverlay : (rawOverlay?.objects || []),
            animationPack,
            overlayPath || iniPath
        );

        return { overlayPath, packPath, animationPack, overlayObjects };
    }

    objectsToEntrances(objects = []) {
        return this.sortBookOrder(objects
            .filter(object => String(object.role).toLowerCase() === 'hatch')
            .map((object, index) => ({
                tileX: object.col,
                tileY: object.row,
                x: this.getFirstFiniteNumber(object.spawn_x, object.spawnX) || (object.x + 16),
                y: this.getFirstFiniteNumber(object.spawn_y, object.spawnY) || (object.y + 8),
                engineId: index,
                source: object.id || 'png-hatch'
            }))
        );
    }

    objectsToExits(objects = []) {
        return this.sortBookOrder(objects
            .filter(object => ['exit', 'goal'].includes(String(object.role).toLowerCase()))
            .map((object, index) => {
                const widthPx = Number(object.widthPx || object.width_px || 8);
                const heightPx = Number(object.heightPx || object.height_px || 8);
                return {
                    tileX: object.col,
                    tileY: object.row,
                    // PNG goals are single animated objects. By default the exit
                    // trigger sits in the middle 8px of the animation's bottom row.
                    x: this.getFirstFiniteNumber(object.triggerX, object.trigger_x, object.exit_x) || (object.x + Math.floor(widthPx / 2)),
                    y: this.getFirstFiniteNumber(object.triggerY, object.trigger_y, object.exit_y) || (object.y + Math.max(0, heightPx - 1)),
                    leftX: object.x,
                    rightX: object.x + Math.max(0, widthPx - 1),
                    topY: object.y,
                    bottomY: object.y + Math.max(0, heightPx - 1),
                    engineId: index,
                    source: object.id || 'png-exit',
                    widthPx,
                    heightPx
                };
            })
        );
    }

    checkOverlayHazard(objects = [], x, y) {
        const px = Math.floor(x), py = Math.floor(y);
        for (const object of objects) {
            const role = String(object.role || '').toLowerCase();
            if (!['fire', 'water', 'acid', 'toxic'].includes(role)) continue;
            if (px < object.x || px >= object.x + object.widthPx || py < object.y || py >= object.y + object.heightPx) continue;
            return role === 'water' ? 'water' : 'toxic';
        }
        return null;
    }

    normaliseRatingPrefix(value, fallbackId = '') {
        const raw = String(value || '').trim() || String(fallbackId || '').split('_')[0];
        const safe = raw.toUpperCase().replace(/\s+/g, '');
        return this.customRatingOrder.includes(safe) ? safe : 'FUN';
    }

    normaliseCustomLevelEntry(entry = {}, index = 0) {
        if (!entry || typeof entry !== 'object') return null;
        const id = String(entry.id || entry.level_id || entry.name || `custom_${index + 1}`).trim();
        if (!id) return null;
        const ini = String(entry.ini || entry.ini_file || `${id}.mlm.ini`).replace(/^\/+/, '');
        const rating = this.normaliseRatingPrefix(entry.rating || entry.pack || entry.category || entry.difficulty, id);
        const levelNumber = Number(entry.level_number ?? entry.levelNumber ?? entry.number ?? index + 1) || (index + 1);
        return {
            ...entry,
            id,
            title: String(entry.title || entry.name || id).trim() || id,
            ini,
            rating,
            pack: rating,
            level_number: levelNumber,
            number: levelNumber
        };
    }

    async listCustomLevels() {
        const manifest = await this.loadJSON('custom-levels/manifest.json', { levels: [] });
        const levels = Array.isArray(manifest?.levels) ? manifest.levels : [];
        return levels
            .map((entry, index) => this.normaliseCustomLevelEntry(entry, index))
            .filter(Boolean)
            .sort((a, b) => {
                const ar = this.customRatingOrder.indexOf(a.rating);
                const br = this.customRatingOrder.indexOf(b.rating);
                if (ar !== br) return ar - br;
                if (a.level_number !== b.level_number) return a.level_number - b.level_number;
                return String(a.id || '').localeCompare(String(b.id || ''));
            });
    }

    getCustomLevelIniPath(levelName, entry = null) {
        const levelEntry = this.normaliseCustomLevelEntry(entry || { id: levelName }, 0) || { id: levelName, ini: `${levelName}.mlm.ini` };
        const ini = String(levelEntry.ini || `${levelEntry.id}.mlm.ini`).replace(/^\/+/, '');
        if (/^(https?:)?\/\//i.test(ini) || ini.startsWith('data:')) return ini;
        return ini.startsWith('custom-levels/') ? ini : `custom-levels/${ini}`;
    }

    getCustomLevelMlmPath(levelName, entry = null) {
        const id = String(entry?.id || levelName || 'level_001').replace(/[^a-zA-Z0-9_.-]+/g, '_');
        const mlm = String(entry?.mlm || entry?.mlm_file || `${id}.mlm`).replace(/^\/+/, '');
        if (/^(https?:)?\/\//i.test(mlm) || mlm.startsWith('data:')) return mlm;
        return mlm.startsWith('custom-levels/') ? mlm : `custom-levels/${mlm}`;
    }

    async loadLevelInfo(levelName, options = {}) {
        const source = options.source === 'custom' || options.entry ? 'custom' : 'bundled';
        const iniPath = source === 'custom'
            ? this.getCustomLevelIniPath(levelName, options.entry)
            : `bundled-levels/${levelName}.mlm.ini`;
        const ini = await this.loadINI(iniPath);
        ini.source = source;
        ini.levelSource = source;
        return ini;
    }

    async loadLevel(levelName, options = {}) {
        const source = options.source === 'custom' || options.entry ? 'custom' : 'bundled';
        const iniPath = source === 'custom'
            ? this.getCustomLevelIniPath(levelName, options.entry)
            : `bundled-levels/${levelName}.mlm.ini`;
        const mlmPath = source === 'custom'
            ? this.getCustomLevelMlmPath(levelName, options.entry)
            : `bundled-levels/${levelName}.mlm`;
        const iniData = await this.loadINI(iniPath);
        iniData.source = source;
        iniData.levelSource = source;
        const terrainPngPath = this.getTerrainPngPath(iniData, iniPath);
        const isPngMap = !!terrainPngPath || String(iniData.map_format || iniData.mapFormat || '').toLowerCase() === 'png';
        const pngTerrain = terrainPngPath ? await this.loadTerrainPNG(terrainPngPath) : null;
        const pngOverlay = isPngMap ? await this.loadPngOverlay(iniData, iniPath) : { overlayObjects: [], animationPack: { animations: [] } };
        const dimensions = pngTerrain
            ? { width: pngTerrain.widthTiles, height: pngTerrain.heightTiles }
            : this.resolveLevelDimensions(iniData);
        const mlmData = pngTerrain
            ? { tilemap: Array(dimensions.width * dimensions.height).fill(0), width: dimensions.width, height: dimensions.height, sourceByteLength: 0 }
            : await this.loadMLM(mlmPath, dimensions);

        // Echo the effective dimensions back into the level metadata so debug
        // screens and future pack tooling can see whether defaults were used.
        iniData.width_tiles = mlmData.width;
        iniData.height_tiles = mlmData.height;

        iniData.map_format = pngTerrain ? 'png' : (iniData.map_format || 'mlm');
        iniData.terrain_png = terrainPngPath || iniData.terrain_png || '';

        const hatchID = this.entranceMarkers[iniData.tileset] || 38;
        let entrancePositions = pngTerrain
            ? this.objectsToEntrances(pngOverlay.overlayObjects)
            : this.findMarkerPositions(mlmData.tilemap, mlmData.width, hatchID, 4);
        const detectedExitPositions = pngTerrain
            ? this.objectsToExits(pngOverlay.overlayObjects)
            : this.findExitPositions(mlmData.tilemap, mlmData.width, mlmData.height, iniData.tileset, 3);
        const hardcodedBackLayerTiles = pngTerrain ? [] : this.getHardcodedBackLayerTiles(iniData, levelName);
        const hardcodedExitPositions = pngTerrain ? [] : this.getHardcodedExitPositions(iniData, levelName);
        const exitPositions = this.sortBookOrder([...detectedExitPositions, ...hardcodedExitPositions]);

        exitPositions.forEach((exit, index) => {
            exit.engineId = index;
        });

        // PNG levels use dynamic animated trap objects with per-object trigger
        // points. Legacy INI trap_type metadata is MLM-only so PNG levels do not
        // inherit tileset trap baggage by accident.
        const trapInstances = pngTerrain ? [] : this.findTrapInstances(iniData);
        const cameraEntrancePos = this.getCameraEntrance(entrancePositions);

        if (entrancePositions.length === 0) {
            console.warn(`${levelName}: no valid entrance markers found for tileset ${iniData.tileset}`);
        }

        if (exitPositions.length === 0) {
            console.warn(`${levelName}: no valid exit trigger tiles found for tileset ${iniData.tileset}`);
        }

        return {
            ...iniData,
            levelLoader: this,
            tilemap: mlmData.tilemap,
            width: mlmData.width,
            height: mlmData.height,
            terrainMode: pngTerrain ? 'png' : 'mlm',
            terrainPngPath,
            terrainImage: pngTerrain?.displayImage || null,
            terrainCollisionMask: pngTerrain?.collisionMask || null,
            backgroundColor: iniData.background_color || iniData.background_colour || '#000000',
            pngAnimationObjects: pngOverlay.overlayObjects || [],
            pngAnimationPack: pngOverlay.animationPack || { animations: [] },
            overlayPath: pngOverlay.overlayPath || '',
            animationPackPath: pngOverlay.packPath || '',
            tilesetName: pngTerrain ? 'PNG' : (this.tilesetMap[iniData.tileset] || 'Grass'),
            source,
            levelSource: source,
            manifestEntry: options.entry || null,

            // New plural forms.
            entrancePositions,
            exitPositions,
            trapInstances,
            traps: trapInstances,
            backLayerTiles: hardcodedBackLayerTiles,
            cameraEntrancePos,
            pixelWidth: mlmData.width * 8,
            pixelHeight: mlmData.height * 8,
            terrainAdditions: [],
            erasureMask: new Uint8Array(mlmData.width * 8 * mlmData.height * 8),

            // Compatibility aliases for older code/debugging.
            entrancePos: entrancePositions[0] || null,
            exitPos: exitPositions[0] || null,

            checkCollision(x, y, tilesetManager) {
                const px = Math.floor(x), py = Math.floor(y);
                const tx = Math.floor(px / 8), ty = Math.floor(py / 8);
                if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return false;
                if (this.isErasedPixel(px, py)) return false;

                if (this.checkAddedTerrainPixel(px, py)) return true;
                if (this.checkPngNoCollisionPixel?.(px, py)) return false;

                return this.checkBaseTerrainCollision(px, py, tilesetManager);
            },
            getPixelIndex(x, y) {
                const px = Math.floor(x), py = Math.floor(y);
                if (px < 0 || px >= this.pixelWidth || py < 0 || py >= this.pixelHeight) return -1;
                return py * this.pixelWidth + px;
            },
            isErasedPixel(x, y) {
                if (!this.erasureMask) return false;
                const index = this.getPixelIndex(x, y);
                return index >= 0 && this.erasureMask[index] === 1;
            },
            checkRawBaseTerrainCollision(x, y, tilesetManager) {
                const px = Math.floor(x), py = Math.floor(y);
                const tx = Math.floor(px / 8), ty = Math.floor(py / 8);
                if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return false;

                if (this.terrainMode === 'png') {
                    if (this.checkPngNoCollisionPixel?.(px, py)) return false;
                    const index = this.getPixelIndex(px, py);
                    return index >= 0 && this.terrainCollisionMask && this.terrainCollisionMask[index] === 1;
                }

                const idx = this.tilemap[ty * this.width + tx];
                if (!idx || idx === 0) return false;
                if (tilesetManager) {
                    return tilesetManager.isPixelSolid(
                        this.tilesetName,
                        idx,
                        Math.floor(px % 8),
                        Math.floor(py % 8),
                        this.tileset
                    );
                }
                return true;
            },
            checkBaseTerrainCollision(x, y, tilesetManager) {
                const px = Math.floor(x), py = Math.floor(y);
                if (this.isErasedPixel(px, py)) return false;
                if (this.checkPngNoCollisionPixel?.(px, py)) return false;
                return this.checkRawBaseTerrainCollision(px, py, tilesetManager);
            },
            checkAddedTerrainPixel(x, y) {
                if (this.isErasedPixel(x, y)) return false;
                if (!this.terrainAdditions?.length) return false;

                // Newer additions are checked first so later terrain tools can
                // cheaply trim/replace bridge pieces without changing callers.
                for (let i = this.terrainAdditions.length - 1; i >= 0; i--) {
                    const rect = this.terrainAdditions[i];
                    if (x >= rect.x && x < rect.x + rect.width &&
                        y >= rect.y && y < rect.y + rect.height) {
                        return true;
                    }
                }

                return false;
            },
            getPngTerrainRuleAtPixel(x, y) {
                if (this.terrainMode !== 'png' || !Array.isArray(this.pngAnimationObjects)) return null;
                const px = Math.floor(x), py = Math.floor(y);
                for (let i = this.pngAnimationObjects.length - 1; i >= 0; i--) {
                    const object = this.pngAnimationObjects[i];
                    const role = String(object.role || '').toLowerCase();
                    if (role !== 'steel' && role !== 'no_collision') continue;
                    const left = Math.floor(object.x ?? (object.col || 0) * 8);
                    const top = Math.floor(object.y ?? (object.row || 0) * 8);
                    const width = Math.max(1, Number(object.widthPx || object.width_px || (object.widthTiles || object.width_tiles || 1) * 8));
                    const height = Math.max(1, Number(object.heightPx || object.height_px || (object.heightTiles || object.height_tiles || 1) * 8));
                    if (px >= left && px < left + width && py >= top && py < top + height) return role;
                }
                return null;
            },
            checkPngNoCollisionPixel(x, y) {
                return this.getPngTerrainRuleAtPixel(x, y) === 'no_collision';
            },
            checkPngSteelPixel(x, y) {
                return this.getPngTerrainRuleAtPixel(x, y) === 'steel';
            },
            getBuilderBrickColor() {
                return '#FFFFFF';
            },
            checkHazard(x, y, tilesetManager) {
                const overlayHazard = this.levelLoader?.checkOverlayHazard
                    ? this.levelLoader.checkOverlayHazard(this.pngAnimationObjects || [], x, y)
                    : null;
                if (overlayHazard) return overlayHazard;

                const tx = Math.floor(x / 8), ty = Math.floor(y / 8);
                if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return null;

                if (this.terrainMode === 'png') return null;

                const idx = this.tilemap[ty * this.width + tx];
                if (!idx || idx === 0 || !tilesetManager) return null;

                const behavior = tilesetManager.getTileBehavior(this.tilesetName, idx, this.tileset);
                if (behavior === 'water') return 'water';
                if (behavior === 'toxic') return 'toxic';

                return null;
            },
            getBuilderBrickMask() {
                return Array.isArray(Physics?.builderBrickMask) && Physics.builderBrickMask.length
                    ? Physics.builderBrickMask
                    : ['###'];
            },
            getBuilderBrickRect(x, y, dir = 1) {
                const mask = this.getBuilderBrickMask();
                const brickWidth = mask.reduce((max, row) => Math.max(max, row.length), 0) || (Physics?.brickWidth || 3);
                const brickHeight = mask.length || (Physics?.brickHeight || 1);
                const rightOffsetX = Physics?.builderBrickOffsetX ?? -2;
                const mirroredLeftOffsetX = -rightOffsetX - (brickWidth - 1);
                const offsetX = dir < 0
                    ? mirroredLeftOffsetX + (Physics?.builderBrickLeftAnchorOffsetX ?? 0)
                    : rightOffsetX + (Physics?.builderBrickRightAnchorOffsetX ?? 0);
                const baseOffsetY = Physics?.builderBrickOffsetY ?? 0;
                const offsetY = baseOffsetY + (dir < 0
                    ? (Physics?.builderBrickLeftAnchorOffsetY ?? 0)
                    : (Physics?.builderBrickRightAnchorOffsetY ?? 0));

                return {
                    x: Math.floor(x) + offsetX,
                    y: Math.floor(y) + offsetY,
                    width: brickWidth,
                    height: brickHeight
                };
            },
            getBuilderBrickPixels(x, y, dir = 1) {
                const rect = this.getBuilderBrickRect(x, y, dir);
                const mask = this.getBuilderBrickMask();
                const pixels = [];

                for (let row = 0; row < mask.length; row++) {
                    const line = mask[row];
                    for (let col = 0; col < line.length; col++) {
                        if (line[col] === '#') {
                            pixels.push({
                                x: rect.x + col,
                                y: rect.y + row
                            });
                        }
                    }
                }

                return pixels;
            },
            getBuilderAsmBrickPixels(x, y, dir = 1) {
                const facing = dir < 0 ? -1 : 1;
                const originX = Math.floor(x);
                const py = Math.floor(y);

                // ASM _LABEL_3292_ probes/writes at HL, HL+dir, HL+2*dir
                // with B = ix+5 - 1. Keep this exact 3px stamp separate from
                // the older offset-based helper so Builder logic is anchored
                // directly to the lemming's ix+3/ix+5 position.
                return [0, 1, 2].map(offset => ({
                    x: originX + facing * offset,
                    y: py
                }));
            },
            placeBuilderPixels(pixels) {
                const worldWidth = this.pixelWidth || this.width * 8;
                const worldHeight = this.pixelHeight || this.height * 8;
                const rows = new Map();

                for (const pixel of pixels) {
                    if (pixel.x < 0 || pixel.x >= worldWidth ||
                        pixel.y < 0 || pixel.y >= worldHeight) {
                        continue;
                    }

                    if (!rows.has(pixel.y)) rows.set(pixel.y, []);
                    rows.get(pixel.y).push(pixel.x);
                }

                let placed = false;

                for (const [py, xs] of rows.entries()) {
                    xs.sort((a, b) => a - b);
                    let runStart = null;
                    let previous = null;

                    const flushRun = () => {
                        if (runStart === null || previous === null) return;

                        const rectWidth = previous - runStart + 1;

				if (
					!Number.isFinite(runStart) ||
					!Number.isFinite(previous) ||
					!Number.isFinite(py) ||
					rectWidth <= 0 ||
					rectWidth > 4
				) {
					console.warn('Skipped invalid Builder terrain rect:', {
						runStart,
						previous,
						py,
						rectWidth,
						pixels
					});
					return;
				}

				this.terrainAdditions.push({
					x: runStart,
					y: py,
					width: rectWidth,
					height: 1,
					color: this.getBuilderBrickColor(),
					source: 'builder'
				});

                        if (this.erasureMask) {
                            for (let px = runStart; px <= previous; px++) {
                                const index = this.getPixelIndex(px, py);
                                if (index >= 0) this.erasureMask[index] = 0;
                            }
                        }

                        placed = true;
                    };

                    for (const px of xs) {
                        if (runStart === null) {
                            runStart = px;
                            previous = px;
                        } else if (px === previous + 1) {
                            previous = px;
                        } else {
                            flushRun();
                            runStart = px;
                            previous = px;
                        }
                    }

                    flushRun();
                }

                return placed;
            },
            placeBuilderAsmBrick(x, y, dir = 1) {
                return this.placeBuilderPixels(this.getBuilderAsmBrickPixels(x, y, dir));
            },
            isBaseTerrainTopPixel(x, y) {
                return this.checkBaseTerrainCollision(x, y, this.tilesetManager) &&
                    !this.checkBaseTerrainCollision(x, y - 1, this.tilesetManager);
            },
            wouldBuilderBrickCollide(x, y, dir = 1) {
                const pixels = this.getBuilderBrickPixels(x, y, dir);

                // SMS writes through a tiny stamp table. Builder-added bridge
                // terrain is deliberately ignored here, but real/base terrain
                // still blocks the next stamp unless the proposed pixel is
                // exactly the exposed top surface that the bridge is resting on.
                for (const pixel of pixels) {
                    if (this.checkBaseTerrainCollision(pixel.x, pixel.y, this.tilesetManager) &&
                        !this.isBaseTerrainTopPixel(pixel.x, pixel.y)) {
                        return true;
                    }
                }

                return false;
            },
            placeBrick(x, y, dir = 1) {
                return this.placeBuilderPixels(this.getBuilderBrickPixels(x, y, dir));
            },
            getBaseTerrainBehaviorAtPixel(x, y) {
    const px = Math.floor(x);
    const py = Math.floor(y);
    const tx = Math.floor(px / 8);
    const ty = Math.floor(py / 8);

    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) {
        return null;
    }

    if (this.isErasedPixel(px, py)) {
        return null;
    }

    if (this.checkPngNoCollisionPixel?.(px, py)) {
        return null;
    }

    if (!this.checkRawBaseTerrainCollision(px, py, this.tilesetManager)) {
        return null;
    }

    if (this.terrainMode === 'png') {
        return this.checkPngSteelPixel?.(px, py) ? 'steel' : 'solid';
    }

    const idx = this.tilemap[ty * this.width + tx];
    if (!idx || idx === 0) {
        return null;
    }

    if (!this.tilesetManager) {
        return 'solid';
    }

    return this.tilesetManager.getTileBehavior(
        this.tilesetName,
        idx,
        this.tileset
    ) || 'solid';
},

getTerrainRemovalPixelStatus(x, y, options = {}) {
    const px = Math.floor(x);
    const py = Math.floor(y);

    const status = {
        solid: false,
        removable: false,
        blockedBySteel: false,
        blockedByOneWay: false
    };

    const index = this.getPixelIndex(px, py);
    if (index < 0 || !this.erasureMask) {
        return status;
    }

    if (this.erasureMask[index] === 1) {
        return status;
    }

    const behavior = this.getBaseTerrainBehaviorAtPixel(px, py);

    if (behavior) {
        status.solid = true;

        if (behavior === 'steel') {
            status.blockedBySteel = true;
            return status;
        }

        if (
            (options.skill === 'basher' || options.skill === 'miner') &&
            (behavior === 'oneWayLeft' || behavior === 'oneWayRight')
        ) {
            const direction = Number(options.direction || 0);
            const allowed =
                (behavior === 'oneWayLeft' && direction < 0) ||
                (behavior === 'oneWayRight' && direction > 0);

            if (!allowed) {
                status.blockedByOneWay = true;
                return status;
            }
        }

        status.removable = true;
    }

    // Builder-added terrain remains destructible, but base Steel still wins
    // above. If this pixel is Steel underneath, the action has already blocked.
    if (this.checkAddedTerrainPixel(px, py)) {
        status.solid = true;
        status.removable = true;
    }

    return status;
},

	removeTerrainRects(rects, options = {}) {
		const result = {
			erased: false,
			hitSolid: false,
			blocked: false,
			blockedBySteel: false,
			blockedByOneWay: false
		};

		if (!this.erasureMask || !Array.isArray(rects) || rects.length === 0) {
			return result;
		}

		const worldWidth = this.pixelWidth || this.width * 8;
		const worldHeight = this.pixelHeight || this.height * 8;
		const removablePixels = [];
		const seenPixels = new Set();

		// First pass: scan every rectangle before erasing anything.
		// Steel and wrong-way One-Way cancel the entire combined action.
		for (const rect of rects) {
			const left = Math.max(0, Math.floor(rect.x));
			const top = Math.max(0, Math.floor(rect.y));
			const right = Math.min(worldWidth, left + Math.max(0, Math.floor(rect.w)));
			const bottom = Math.min(worldHeight, top + Math.max(0, Math.floor(rect.h)));

			if (right <= left || bottom <= top) continue;

			for (let py = top; py < bottom; py++) {
				for (let px = left; px < right; px++) {
					const status = this.getTerrainRemovalPixelStatus(px, py, options);

					if (status.solid) {
						result.hitSolid = true;
					}

					if (status.blockedBySteel) {
						result.blocked = true;
						result.blockedBySteel = true;
					}

					if (status.blockedByOneWay) {
						result.blocked = true;
						result.blockedByOneWay = true;
					}

					if (status.removable) {
						const key = `${px},${py}`;

						if (!seenPixels.has(key)) {
							seenPixels.add(key);
							removablePixels.push({ x: px, y: py });
						}
					}
				}
			}
		}

		if (result.blocked) {
			return result;
		}

		// Second pass: only erase after proving every rect in the combined
		// destructive action is legal.
		for (const pixel of removablePixels) {
			const index = this.getPixelIndex(pixel.x, pixel.y);

			if (index >= 0 && this.erasureMask[index] !== 1) {
				this.erasureMask[index] = 1;
				result.erased = true;
			}
		}

		return result;
	},

	removeTerrainRect(x, y, w, h, options = {}) {
		const result = {
			erased: false,
			hitSolid: false,
			blocked: false,
			blockedBySteel: false,
			blockedByOneWay: false
		};

		if (!this.erasureMask) {
			return result;
		}

		const worldWidth = this.pixelWidth || this.width * 8;
		const worldHeight = this.pixelHeight || this.height * 8;
		const left = Math.max(0, Math.floor(x));
		const top = Math.max(0, Math.floor(y));
		const right = Math.min(worldWidth, left + Math.max(0, Math.floor(w)));
		const bottom = Math.min(worldHeight, top + Math.max(0, Math.floor(h)));

		if (right <= left || bottom <= top) {
			return result;
		}

		const removablePixels = [];

		// First pass: inspect the whole destructive stamp before erasing anything.
		// SMS Steel cancels the entire action if touched.
		// Wrong-way One-Way also cancels the whole action for Bashers/Miners.
		for (let py = top; py < bottom; py++) {
			for (let px = left; px < right; px++) {
				const status = this.getTerrainRemovalPixelStatus(px, py, options);

				if (status.solid) {
					result.hitSolid = true;
				}

				if (status.blockedBySteel) {
					result.blocked = true;
					result.blockedBySteel = true;
				}

				if (status.blockedByOneWay) {
					result.blocked = true;
					result.blockedByOneWay = true;
				}

				if (status.removable) {
					removablePixels.push({ x: px, y: py });
				}
			}
		}

		if (result.blocked) {
			return result;
		}

		// Second pass: only erase after proving the whole stamp is legal.
		for (const pixel of removablePixels) {
			const index = this.getPixelIndex(pixel.x, pixel.y);

			if (index >= 0 && this.erasureMask[index] !== 1) {
				this.erasureMask[index] = 1;
				result.erased = true;
			}
		}

		return result;
	},

	removeTerrain(x, y, w, h, typeOrOptions = {}) {
		// Compatibility wrapper for older skill stubs that pass a centre-ish point.
		// New skills should prefer removeTerrainRect for exact pixel masks.
		const options = typeof typeOrOptions === 'object'
			? typeOrOptions
			: { skill: typeOrOptions };

		return this.removeTerrainRect(
			Math.floor(x - w / 2),
			Math.floor(y - h / 2),
			w,
			h,
			options
		);
	},
            explode(x, y, r) {}
        };
    }

    async loadINI(path) {
        const text = await fetch(path).then(r => r.text());
        const data = {};

        text.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith(';')) return;

            const equalsIndex = trimmed.indexOf('=');
            if (equalsIndex < 0) return;

            const key = trimmed.slice(0, equalsIndex).trim();
            const value = trimmed.slice(equalsIndex + 1).trim();
            data[key] = this.parseIniValue(key, value);
        });

        return data;
    }

    decodeMLMTilemap(data, targetLength) {
        const tilemap = new Uint8Array(targetLength);
        let src = 0;
        let tgt = 0;

        while (src < data.length && tgt < tilemap.length) {
            if (data[src] === 0) {
                const count = data[src + 1] || 0;
                for (let i = 0; i < count && tgt < tilemap.length; i++) tilemap[tgt++] = 0;
                src += 2;
            } else {
                tilemap[tgt++] = data[src++];
            }
        }

        return tilemap;
    }

    async loadMLM(path, dimensions = {}) {
        const data = new Uint8Array(await (await fetch(path)).arrayBuffer());
        const requestedWidth = this.getFirstFiniteNumber(dimensions.width, dimensions.width_tiles) || this.defaultLevelWidthTiles;
        const requestedHeight = this.getFirstFiniteNumber(dimensions.height, dimensions.height_tiles) || this.defaultLevelHeightTiles;
        const width = requestedWidth;
        const height = requestedHeight;
        const tilemap = this.decodeMLMTilemap(data, width * height);

        return {
            tilemap: Array.from(tilemap),
            width,
            height,
            sourceByteLength: data.length
        };
    }

    async listLevels() {
        // Return all 240 levels organized by category
        const categories = {
            'Fun': Array.from({length: 30}, (_, i) => `FUN_${String(i + 1).padStart(2, '0')}`),
            'Tricky': Array.from({length: 30}, (_, i) => `TRICKY_${String(i + 1).padStart(2, '0')}`),
            'Taxing': Array.from({length: 30}, (_, i) => `TAXING_${String(i + 1).padStart(2, '0')}`),
            'Mayhem': Array.from({length: 30}, (_, i) => `MAYHEM_${String(i + 1).padStart(2, '0')}`),
            'Extra 1': Array.from({length: 30}, (_, i) => `EXTRA1_${String(i + 1).padStart(2, '0')}`),
            'Extra 2': Array.from({length: 30}, (_, i) => `EXTRA2_${String(i + 1).padStart(2, '0')}`),
            'Extra 3': Array.from({length: 30}, (_, i) => `EXTRA3_${String(i + 1).padStart(2, '0')}`),
            'Extra 4': Array.from({length: 30}, (_, i) => `EXTRA4_${String(i + 1).padStart(2, '0')}`)
        };
        return categories;
    }
}
