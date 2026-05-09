// Renderer - handles all drawing to canvas
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
		this.setPixelPerfectRendering();

        // Native logical layout for the SMS-plus widescreen build.
        // The playfield keeps the original 19-tile SMS height; the bottom
        // 40px is reserved for the later in-canvas HUD/skill panel.
        this.tileSize = 8;
        this.viewportWidth = 336;
        this.viewportHeight = 152;
        this.hudHeight = 40;
        this.logicalWidth = this.viewportWidth;
        this.logicalHeight = this.viewportHeight + this.hudHeight;

        // CSS/display scale only. The actual canvas remains 336x192 internally.
        // The displayed size is recalculated to fit the viewport while staying
        // on an 8px grid in both directions.
        this.scale = 1;
        this.displayWidth = this.logicalWidth;
        this.displayHeight = this.logicalHeight;

        this.canvas.width = this.logicalWidth;
        this.canvas.height = this.logicalHeight;

        this.applyDynamicCanvasScale();

        window.addEventListener('resize', () => {
            this.applyDynamicCanvasScale();
        });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                this.applyDynamicCanvasScale();
            });
        }

        this.ctx.imageSmoothingEnabled = false;

        this.camera = {
            x: 0,
            y: 0,
            maxX: 896 - this.viewportWidth,
            maxY: 0
        };

        this.spriteSheet = null;

        // SMS-style level briefing/title assets.
        this.levelInfoBackground = null;
        this.titleScreenBackground = null;
        this.titleCards = new Map();
        this.titleHand = null;
        this.titleHandCurrentX = null;
        this.titleHandSlideSpeedPx = 4;
        this.levelInfoFont = new Map();
        this.levelInfoAssetsLoaded = false;

        // In-canvas SMS HUD assets for the lower icon bar. 
        this.hudIcons = new Map();
        this.hudAssetsLoaded = false;
        this.hudGroupOffsetX = 0;
        this.hudGroupOffsetY = 0;

        // Keep these HUD button draw positions in one place so the visible
        // icons don't drift away from the matching game.js hitboxes.
        this.hudPauseTile = { column: 5, row: 20 };
        this.hudSpeedTile = { column: 5, row: 22 };
        this.hudControlTile = { column: 7, row: 20 };
        this.hudVolumeTile = { column: 7, row: 22 };

        this.backLayerScratchCanvas = null;
        this.backLayerScratchCtx = null;
    }

    async loadLevelInfoAssets() {
        const background = await Utils.loadIndexedImage('assets/LevelInfoBackground.png');
        this.levelInfoBackground = background.image;

        const symbolMap = {
            '!': '_symbol_01',
            '"': '_symbol_02',
            '#': '_symbol_03',
            '$': '_symbol_04',
            '%': '_symbol_05',
            '&': '_symbol_06',
            "'": '_symbol_07',
            '(': '_symbol_08',
            ')': '_symbol_09',
            '*': '_symbol_10',
            '+': '_symbol_11',
            ',': '_symbol_12',
            '-': '_symbol_13',
            '.': '_symbol_14',
            '/': '_symbol_15',
            ':': '_symbol_16',
            ';': '_symbol_17',
            '<': '_symbol_18',
            '=': '_symbol_19',
            '>': '_symbol_20',
            '?': '_symbol_21',
            '@': '_symbol_22',
            '[': '_symbol_23',
            ']': '_symbol_24',
            '\\': '_symbol_25',
            '^': '_symbol_26',
            '_': '_symbol_27',
            '§': '_symbol_28'
        };

        const loadCharacter = async (char, path) => {
            try {
                const data = await Utils.loadIndexedImage(path);
                this.levelInfoFont.set(char, data.image);
            } catch (error) {
                console.warn(`Missing level-info font glyph ${char} (${path}): ${error.message}`);
            }
        };

        const characterLoads = [];

        for (let code = 48; code <= 57; code++) {
            const char = String.fromCharCode(code);
            characterLoads.push(loadCharacter(char, `assets/_font/${char}.png`));
        }

        for (let code = 65; code <= 90; code++) {
            const char = String.fromCharCode(code);
            characterLoads.push(loadCharacter(char, `assets/_font/${char}.png`));
        }

        for (const [char, fileStem] of Object.entries(symbolMap)) {
            characterLoads.push(loadCharacter(char, `assets/_font/${fileStem}.png`));
        }

        await Promise.all(characterLoads);
        await this.loadTitleScreenAssets();
        this.levelInfoAssetsLoaded = true;

        await this.loadHudAssets();
    }

    async loadTitleScreenAssets() {
        const loadOptionalImage = async (path, label) => {
            try {
                const data = await Utils.loadIndexedImage(path);
                return data.image;
            } catch (error) {
                console.warn(`Missing title-screen asset ${label}: ${error.message}`);
                return null;
            }
        };

        this.titleScreenBackground = await loadOptionalImage(
            'assets/title_cards/titlescreenbackground.png',
            'titlescreenbackground.png'
        );

        this.titleHand = await loadOptionalImage(
            'assets/title_cards/hand.png',
            'hand.png'
        );

        const titleAssets = [
            ['LOGO', 'lemmings_LOGO.png'],
            ['1PLAYER', 'card_1PLAYER.png'],
            ['2PLAYER', 'card_2PLAYER.png'],
            ['NEWLEVEL', 'card_NEWLEVEL.png'],
            ['FUN', 'card_FUN.png'],
            ['TRICKY', 'card_TRICKY.png'],
            ['TAXING', 'card_TAXING.png'],
            ['MAYHEM', 'card_MAYHEM.png'],
            ['EXTRA1', 'card_EXTRA1.png'],
            ['EXTRA2', 'card_EXTRA2.png'],
            ['EXTRA3', 'card_EXTRA3.png'],
            ['EXTRA4', 'card_EXTRA4.png']
        ];

        await Promise.all(titleAssets.map(async ([key, filename]) => {
            const image = await loadOptionalImage(`assets/title_cards/${filename}`, filename);
            if (image) this.titleCards.set(key, image);
        }));
    }

    async loadHudAssets() {
        const hudAssetNames = [
            'hud_release_rate_box',
            'hud_climber',
            'hud_floater',
            'hud_bomber',
            'hud_blocker',
            'hud_builder',
            'hud_basher',
            'hud_miner',
            'hud_digger',
            'hud_nuke',
            'hud_pause',
            'hud_play',
            'hud_1x_speed',
            'hud_2x_speed',
            'hud_mouse',
            'hud_controller',
            'volume_off',
            'volume_medium',
            'volume_loud',
            'hud_closeup_skill_null',
            'hud_closeup_skill_blocker',
            'hud_closeup_skill_builder',
            'hud_closeup_skill_basher',
            'hud_closeup_skill_miner',
            'hud_closeup_skill_digger',
            'hud_closeup_skill_floater',
            'hud_closeup_skill_climber',
            'hud_closeup_skill_walker',
            'hud_active_skill'
        ];

        for (let digit = 0; digit <= 9; digit++) {
            hudAssetNames.push(`hud_${digit}_left`);
            hudAssetNames.push(`hud_${digit}_right`);
        }

        const optionalHudAssets = new Set([
            'hud_pause',
            'hud_play',
            'hud_1x_speed',
            'hud_2x_speed',
            'hud_mouse',
            'hud_controller',
            'volume_off',
            'volume_medium',
            'volume_loud'
        ]);

        const hudAssetAliases = new Map([
            ['hud_mouse', ['hud_mouse', 'hud mouse']],
            ['hud_controller', ['hud_controller', 'hud controller']],
            ['volume_off', ['volume_off', 'volume off']],
            ['volume_medium', ['volume_medium', 'volume medium']],
            ['volume_loud', ['volume_loud', 'volume loud']]
        ]);

        const assetLoads = hudAssetNames.map(async (name) => {
            const candidateNames = hudAssetAliases.get(name) || [name];

            for (const candidateName of candidateNames) {
                const primaryPath = `assets/_hud_icons/${candidateName}.png`;
                try {
                    const data = await Utils.loadIndexedImage(primaryPath);
                    this.hudIcons.set(name, data.image);
                    return;
                } catch (error) {
                    // Try the next alias before warning.
                }
            }

            // The current asset pack contains hud_8.png instead of
            // hud_8_right.png, so allow that specific SMS quirk.
            if (name === 'hud_8_right') {
                try {
                    const fallback = await Utils.loadIndexedImage('assets/_hud_icons/hud_8.png');
                    this.hudIcons.set(name, fallback.image);
                    return;
                } catch (fallbackError) {
                    console.warn(`Missing HUD asset ${name}: ${fallbackError.message}`);
                    return;
                }
            }

            if (!optionalHudAssets.has(name)) {
                console.warn(`Missing HUD asset ${name}`);
            }
        });

        await Promise.all(assetLoads);
        this.hudAssetsLoaded = true;
    }

    updateCameraBounds(level) {
        const levelWidth = (level?.width || 112) * this.tileSize;
        const levelHeight = (level?.height || 19) * this.tileSize;

        this.camera.maxX = Math.max(0, levelWidth - this.viewportWidth);
        this.camera.maxY = Math.max(0, levelHeight - this.viewportHeight);
        this.camera.x = Math.max(0, Math.min(this.camera.x, this.camera.maxX));
        this.camera.y = Math.max(0, Math.min(this.camera.y, this.camera.maxY));
    }

	setPixelPerfectRendering() {
		this.ctx.imageSmoothingEnabled = false;
		this.ctx.webkitImageSmoothingEnabled = false;
		this.ctx.mozImageSmoothingEnabled = false;
		this.ctx.msImageSmoothingEnabled = false;

		this.canvas.style.imageRendering = 'pixelated';
	}

    applyDynamicCanvasScale() {
        // Native canvas is 336x192, which reduces to a 7:4 aspect ratio.
        // To keep the displayed size on an 8px grid:
        // width  = 56 * unit
        // height = 32 * unit
        const viewport = window.visualViewport || window;
        const viewportWidth = Math.floor(viewport.width || window.innerWidth || this.logicalWidth);
        const viewportHeight = Math.floor(viewport.height || window.innerHeight || this.logicalHeight);

        // Leave room for the 2px outline on each side.
        const outlineAllowance = 0;
        const maxWidth = Math.max(56, viewportWidth - outlineAllowance);
        const maxHeight = Math.max(32, viewportHeight - outlineAllowance);

        const widthStep = 56;
        const heightStep = 32;
        const unit = Math.max(1, Math.floor(Math.min(maxWidth / widthStep, maxHeight / heightStep)));

        const displayWidth = widthStep * unit;
        const displayHeight = heightStep * unit;

        this.displayWidth = displayWidth;
        this.displayHeight = displayHeight;
        this.scale = displayWidth / this.logicalWidth;

        this.canvas.style.width = `${displayWidth}px`;
        this.canvas.style.height = `${displayHeight}px`;

        this.setPixelPerfectRendering();
    }

    clear() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
    }

    drawHudBand() {
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, this.viewportHeight, this.logicalWidth, this.hudHeight);
        this.ctx.fillStyle = '#333333';
        this.ctx.fillRect(0, this.viewportHeight, this.logicalWidth, 1);
    }

    beginPlayfieldClip() {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, this.viewportWidth, this.viewportHeight);
        this.ctx.clip();
    }

    endPlayfieldClip() {
        this.ctx.restore();
    }

    drawTiledFullScreenBackground(image) {
        if (!image) {
            this.ctx.fillStyle = '#000000';
            this.ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
            return;
        }

        const anchorX = Math.floor((this.logicalWidth - image.width) / 2);

        for (let y = 0; y < this.logicalHeight; y += image.height) {
            for (let x = anchorX; x < this.logicalWidth; x += image.width) {
                this.ctx.drawImage(image, x, y);
            }
            for (let x = anchorX - image.width; x + image.width > 0; x -= image.width) {
                this.ctx.drawImage(image, x, y);
            }
        }
    }

    drawLevelInfoBackground() {
        this.drawTiledFullScreenBackground(this.levelInfoBackground);
    }

    drawTitleScreenBackground() {
        this.drawTiledFullScreenBackground(this.titleScreenBackground || this.levelInfoBackground);
    }

    drawLevelInfoText(text, column, row) {
        const safeText = String(text ?? '').toUpperCase();
        let x = Math.floor(column) * this.tileSize;
        const y = Math.floor(row) * this.tileSize;

        for (const char of safeText) {
            if (char !== ' ') {
                const glyph = this.levelInfoFont.get(char);
                if (glyph) this.ctx.drawImage(glyph, x, y);
            }
            x += this.tileSize;
        }
    }

    drawCenteredLevelInfoText(text, row, centerColumn) {
        const safeText = String(text ?? '').toUpperCase();
        const startColumn = centerColumn - Math.floor(safeText.length / 2);
        this.drawLevelInfoText(safeText, startColumn, row);
    }

    drawRightAlignedLevelInfoText(text, rightColumn, row) {
        const safeText = String(text ?? '').toUpperCase();
        this.drawLevelInfoText(safeText, rightColumn - safeText.length, row);
    }

    drawTitleSprite(assetKey, column, row) {
        const image = this.titleCards.get(assetKey);
        if (!image) return false;

        this.ctx.drawImage(image, Math.floor(column) * this.tileSize, Math.floor(row) * this.tileSize);
        return true;
    }

    drawTitleCard(assetKey, column, row, fallbackText = assetKey) {
        if (this.drawTitleSprite(assetKey, column, row)) return;

        // Missing card fallback: keep the screen usable while new assets are being made.
        const x = Math.floor(column) * this.tileSize;
        const y = Math.floor(row) * this.tileSize;
        this.ctx.save();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.strokeRect(x, y, 32, 32);
        this.ctx.restore();

        const safeText = String(fallbackText ?? assetKey).replace(/\s+/g, '');
        this.drawCenteredLevelInfoText(safeText.slice(0, 8), Math.floor(row) + 1, Math.floor(column) + 2);
    }

    drawTitleHand(column, row) {
        const targetX = Math.floor(column) * this.tileSize;
        const y = Math.floor(row) * this.tileSize;

        if (this.titleHandCurrentX === null) {
            this.titleHandCurrentX = targetX;
        } else if (this.titleHandCurrentX !== targetX) {
            const delta = targetX - this.titleHandCurrentX;
            const step = Math.min(Math.abs(delta), this.titleHandSlideSpeedPx);
            this.titleHandCurrentX += Math.sign(delta) * step;
        }

        const x = Math.round(this.titleHandCurrentX);

        if (this.titleHand) {
            this.ctx.drawImage(this.titleHand, x, y);
            return;
        }

        // Missing hand fallback: a small white pointer over the selected card.
        this.ctx.save();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(x + 4, y, 8, 4);
        this.ctx.fillRect(x + 8, y + 4, 8, 4);
        this.ctx.fillRect(x + 12, y + 8, 8, 4);
        this.ctx.restore();
    }

    drawTitleScreen(data) {
        this.drawTitleScreenBackground();
        if (!this.levelInfoAssetsLoaded) return;

        const centerColumn = 20;
        const showMultiplayer = data?.showMultiplayer === true;
        const maxSelectorIndex = showMultiplayer ? 3 : 2;
        const selectorIndex = Math.max(0, Math.min(maxSelectorIndex, Number(data?.selectorIndex ?? 0)));
        const ratingCard = String(data?.ratingCard || 'FUN').replace(/\s+/g, '').toUpperCase();

        this.drawTitleSprite('LOGO', centerColumn - 13, 1);

        if (showMultiplayer) {
            // Web multiplayer layout:
            // 1 PLAYER moves 3 tiles left. NEW LEVEL and RATING move 3 tiles right.
            // 2 PLAYER slots into the new gap.
            this.drawTitleCard('1PLAYER', centerColumn - 11, 12, '1PLAYER');
            this.drawTitleCard('2PLAYER', centerColumn - 5, 12, '2PLAYER');
            this.drawTitleCard('NEWLEVEL', centerColumn + 1, 12, 'NEW');
            this.drawTitleCard(ratingCard, centerColumn + 7, 12, ratingCard);
        } else {
            this.drawTitleCard('1PLAYER', centerColumn - 8, 12, '1PLAYER');
            this.drawTitleCard('NEWLEVEL', centerColumn - 2, 12, 'NEW');
            this.drawTitleCard(ratingCard, centerColumn + 4, 12, ratingCard);
        }

        this.drawCenteredLevelInfoText('100% UNOFFICIAL', 21, centerColumn);

        const handColumns = showMultiplayer
            ? [centerColumn - 7, centerColumn - 1, centerColumn + 5, centerColumn + 11]
            : [centerColumn - 4, centerColumn + 2, centerColumn + 8];

        this.drawTitleHand(handColumns[selectorIndex], 17);
    }

    drawCreditsScreen(data) {
        if (!this.levelInfoAssetsLoaded) return;

        const centerColumn = 20;
        const rating = String(data?.rating || 'FUN').replace(/\s+/g, '').toUpperCase();
        const levelNumber = String(data?.levelNumber ?? 1).padStart(2, '0');

        this.drawCenteredLevelInfoText('LEMMINGS  SEGA MASTER SYSTEM', 0, centerColumn);
        this.drawCenteredLevelInfoText('CONVERSION BY PROBE SOFTWARE', 3, centerColumn);
        this.drawCenteredLevelInfoText('PROGRAM BY DOMINIC WOOD', 6, centerColumn);
        this.drawCenteredLevelInfoText('ARTWORK BY MARK KNOWLES', 9, centerColumn);
        this.drawCenteredLevelInfoText('PRODUCER NEIL YOUNG', 12, centerColumn);
        this.drawCenteredLevelInfoText('JAVASCRIPT PORT BY CALLUM', 15, centerColumn);
        this.drawCenteredLevelInfoText('ALL LEVELS INSTALLED', 18, centerColumn);

        this.drawLevelInfoText('RATING', centerColumn - 11, 21);
        this.drawRightAlignedLevelInfoText(rating, centerColumn, 21);
        this.drawLevelInfoText(`LEVEL ${levelNumber}`, centerColumn + 6, 21);
    }

    drawLevelInfoScreen(info) {
        this.drawLevelInfoBackground();
        if (!this.levelInfoAssetsLoaded) return;

        // The SMS screen treats tile column 15 as its midpoint. The widescreen
        // 42-column canvas adds five columns on each side, so centre-relative
        // SMS positions translate to column 20 here.
        const centerColumn = 20;

        const title = info.title || 'UNKNOWN LEVEL';
        const numLemmings = String(info.numLemmings ?? 0).padStart(2, '0');
        const percentNeeded = String(info.percentNeeded ?? 0);
        const releaseRate = String(info.releaseRate ?? 0).padStart(2, '0');
        const timeMinutes = String(info.timeMinutes ?? 0);
        const rating = info.rating || 'FUN';
        const levelNumber = String(info.levelNumber ?? 0).padStart(2, '0');

        this.drawCenteredLevelInfoText(title, 0, centerColumn + 1);
        this.drawLevelInfoText(`NUMBER OF LEMMINGS ${numLemmings}`, centerColumn - 9, 3);

        const percentColumn = centerColumn - 4;
        this.drawLevelInfoText(percentNeeded, percentColumn - percentNeeded.length, 6);
        this.drawLevelInfoText('% TO BE SAVED', percentColumn, 6);

        this.drawLevelInfoText(`RELEASE RATE = ${releaseRate}`, centerColumn - 7, 9);
        this.drawLevelInfoText(`TIME  = ${timeMinutes} MINUTES`, centerColumn - 7, 12);
        this.drawLevelInfoText('RATING =', centerColumn - 6, 15);
        this.drawLevelInfoText(rating, centerColumn + 3, 15);
        this.drawLevelInfoText(`LEVEL = ${levelNumber}`, centerColumn - 4, 18);
        this.drawLevelInfoText('1 TO PREVIEW  2 TO PLAY', centerColumn - 10, 21);
    }

    getBackLayerScratchContext() {
        if (!this.backLayerScratchCanvas) {
            this.backLayerScratchCanvas = document.createElement('canvas');
            this.backLayerScratchCanvas.width = this.tileSize;
            this.backLayerScratchCanvas.height = this.tileSize;
            this.backLayerScratchCtx = this.backLayerScratchCanvas.getContext('2d');
            this.backLayerScratchCtx.imageSmoothingEnabled = false;
        }

        return this.backLayerScratchCtx;
    }

    drawBackLayerTiles(level, tilesetManager, revealErasedOnly = false) {
        if (!level.backLayerTiles?.length || !tilesetManager) return;

        const tileSize = this.tileSize;

        for (const tile of level.backLayerTiles) {
            const worldX = tile.tileX * tileSize;
            const worldY = tile.tileY * tileSize;
            const screenX = worldX - this.camera.x;
            const screenY = worldY - this.camera.y;

            if (screenX + tileSize <= 0 || screenX >= this.viewportWidth ||
                screenY + tileSize <= 0 || screenY >= this.viewportHeight) {
                continue;
            }

            if (!revealErasedOnly) {
                tilesetManager.drawTile(
                    this.ctx,
                    level.tilesetName,
                    tile.tileIndex,
                    screenX,
                    screenY
                );
                continue;
            }

            if (!level.erasureMask || !level.isErasedPixel) continue;

            const scratchCtx = this.getBackLayerScratchContext();
            scratchCtx.clearRect(0, 0, tileSize, tileSize);

            tilesetManager.drawTile(
                scratchCtx,
                level.tilesetName,
                tile.tileIndex,
                0,
                0
            );

            const imageData = scratchCtx.getImageData(0, 0, tileSize, tileSize);
            const data = imageData.data;

            for (let localY = 0; localY < tileSize; localY++) {
                for (let localX = 0; localX < tileSize; localX++) {
                    const px = worldX + localX;
                    const py = worldY + localY;

                    if (!level.isErasedPixel(px, py)) {
                        const alphaIndex = ((localY * tileSize + localX) * 4) + 3;
                        data[alphaIndex] = 0;
                    }
                }
            }

            scratchCtx.putImageData(imageData, 0, 0);
            this.ctx.drawImage(this.backLayerScratchCanvas, screenX, screenY);
        }
    }

    drawPngTerrainBackplate(level) {
        if (level?.terrainMode !== 'png') return false;

        this.ctx.fillStyle = level.backgroundColor || '#000000';
        this.ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

        if (level.terrainImage) {
            const sx = Math.floor(this.camera.x);
            const sy = Math.floor(this.camera.y);
            const sw = Math.min(this.viewportWidth, Math.max(0, level.pixelWidth - sx));
            const sh = Math.min(this.viewportHeight, Math.max(0, level.pixelHeight - sy));
            if (sw > 0 && sh > 0) {
                this.ctx.drawImage(level.terrainImage, sx, sy, sw, sh, 0, 0, sw, sh);
            }
        }

        return true;
    }

    drawLevel(level, tilesetManager, tileAnimationManager, trapAnimationManager, options = {}) {
        if (!level.tilemap && !level.terrainImage) return;

        const { tilemap, tilesetName, width, height } = level;
        const tileSize = this.tileSize;
        const skipPngTerrainBackplate = !!options.skipPngTerrainBackplate;

        const startX = Math.max(0, Math.floor(this.camera.x / tileSize));
        const startY = Math.max(0, Math.floor(this.camera.y / tileSize));
        const endX = Math.min(width, Math.ceil((this.camera.x + this.viewportWidth) / tileSize));
        const endY = Math.min(height, Math.ceil((this.camera.y + this.viewportHeight) / tileSize));

        if (level.terrainMode === 'png') {
            if (!skipPngTerrainBackplate) this.drawPngTerrainBackplate(level);
        } else {
            this.drawBackLayerTiles(level, tilesetManager, false);
        }

        for (let ty = startY; ty < endY; ty++) {
            for (let tx = startX; tx < endX; tx++) {
                const tileIndex = tilemap?.[ty * width + tx];
                if (tileIndex !== undefined && tileIndex !== 0) {
                    const screenX = tx * tileSize - this.camera.x;
                    const screenY = ty * tileSize - this.camera.y;
                    let drawn = false;

                    if (level.terrainMode !== 'png' && tileAnimationManager && tileAnimationManager.shouldAnimate(tilesetName, tileIndex)) {
                        drawn = tileAnimationManager.drawTile(this.ctx, tilesetName, tileIndex, screenX, screenY);
                    }

                    if (level.terrainMode !== 'png' && !drawn && trapAnimationManager) {
                        drawn = trapAnimationManager.drawTile(this.ctx, tilesetName, tileIndex, screenX, screenY, tx, ty);
                    }

                    if (!drawn && tilesetManager && tilesetName !== 'PNG') {
                        tilesetManager.drawTile(this.ctx, tilesetName, tileIndex, screenX, screenY);
                    }
                }
            }
        }

        this.drawErasureMask(level);
		if (level.terrainMode !== 'png') this.drawBackLayerTiles(level, tilesetManager, true);
		// Builder terrain is drawn late by Game.render so bridge pixels sit
		// above tiles, back-layer graphics, hatches, and trap animations.
    }

    drawTerrainAdditions(level) {
		if (!level.terrainAdditions?.length) return;

		const viewLeft = Math.floor(this.camera.x);
		const viewTop = Math.floor(this.camera.y);
		const viewRight = Math.ceil(this.camera.x + this.viewportWidth);
		const viewBottom = Math.ceil(this.camera.y + this.viewportHeight);
		const hasErasureMask = typeof level.isErasedPixel === 'function';

		for (const rect of level.terrainAdditions) {
			const left = Math.max(Math.floor(rect.x), viewLeft);
			const top = Math.max(Math.floor(rect.y), viewTop);
			const right = Math.min(Math.floor(rect.x + rect.width), viewRight);
			const bottom = Math.min(Math.floor(rect.y + rect.height), viewBottom);

			if (right <= left || bottom <= top) continue;

			this.ctx.fillStyle = rect.color || '#d8c850';

			if (!hasErasureMask) {
				this.ctx.fillRect(
					left - this.camera.x,
					top - this.camera.y,
					right - left,
					bottom - top
				);
				continue;
			}

			for (let py = top; py < bottom; py++) {
				let runStart = -1;

				for (let px = left; px < right; px++) {
					const visible = !level.isErasedPixel(px, py);

					if (visible && runStart < 0) {
						runStart = px;
					} else if (!visible && runStart >= 0) {
						this.ctx.fillRect(
							runStart - this.camera.x,
							py - this.camera.y,
							px - runStart,
							1
						);
						runStart = -1;
					}
				}

				if (runStart >= 0) {
					this.ctx.fillRect(
						runStart - this.camera.x,
						py - this.camera.y,
						right - runStart,
						1
					);
				}
			}
		}
	}

    drawErasureMask(level) {
        if (!level.erasureMask || !level.pixelWidth || !level.pixelHeight) return;

        const startX = Math.max(0, Math.floor(this.camera.x));
        const startY = Math.max(0, Math.floor(this.camera.y));
        const endX = Math.min(level.pixelWidth, Math.ceil(this.camera.x + this.viewportWidth));
        const endY = Math.min(level.pixelHeight, Math.ceil(this.camera.y + this.viewportHeight));

        this.ctx.fillStyle = '#000000';

        // Draw horizontal runs of erased pixels rather than one fill per pixel.
        for (let py = startY; py < endY; py++) {
            let runStart = -1;
            const rowOffset = py * level.pixelWidth;

            for (let px = startX; px < endX; px++) {
                const erased = level.erasureMask[rowOffset + px] === 1;

                if (erased && runStart < 0) {
                    runStart = px;
                } else if (!erased && runStart >= 0) {
                    this.ctx.fillRect(
                        runStart - this.camera.x,
                        py - this.camera.y,
                        px - runStart,
                        1
                    );
                    runStart = -1;
                }
            }

            if (runStart >= 0) {
                this.ctx.fillRect(
                    runStart - this.camera.x,
                    py - this.camera.y,
                    endX - runStart,
                    1
                );
            }
        }
    }

    drawLemmings(lemmings) {
        if (!this.spriteSheet) return;

        for (const lemming of lemmings) {
            if (lemming.state !== 'dead' && lemming.state !== 'saved') {
                const screenX = Math.floor(lemming.x - this.camera.x - lemming.width / 2);
                const screenY = Math.floor(lemming.y - this.camera.y) - 1;
                this.spriteSheet.draw(this.ctx, lemming, screenX, screenY);
            }
        }
    }

    drawCursor(cursor, images) {
        if (!cursor || !images || !cursor.visible) return;

        const showSelectionCursor = typeof cursor.selectionCursorActive === 'boolean'
            ? cursor.selectionCursorActive
            : !!cursor.hoveredLemming;
        const image = showSelectionCursor ? images.selection : images.noSelection;
        if (!image) return;

        const rect = cursor.getScreenRect(this.camera);
        this.ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    }

    getHudPixelPosition(column, row) {
        return {
            x: Math.floor(column) * this.tileSize + this.hudGroupOffsetX,
            y: Math.floor(row) * this.tileSize + this.hudGroupOffsetY
        };
    }

    drawHudSprite(assetName, column, row) {
        if (!this.hudAssetsLoaded) return false;
        const image = this.hudIcons.get(assetName);
        if (!image) return false;

        const { x, y } = this.getHudPixelPosition(column, row);
        this.ctx.drawImage(image, x, y);
        return true;
    }

    drawHudFallbackButton(label, column, row) {
        const { x, y } = this.getHudPixelPosition(column, row);

        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(x, y, 16, 16);

        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(x, y, 16, 1);
        this.ctx.fillRect(x, y + 15, 16, 1);
        this.ctx.fillRect(x, y, 1, 16);
        this.ctx.fillRect(x + 15, y, 1, 16);

        this.drawLevelInfoText(label, column, row);
    }

    drawHudNumber(value, tensColumn, row) {
        const safeValue = Math.max(0, Math.min(99, Number(value ?? 0)));
        const text = String(safeValue).padStart(2, '0');
        this.drawHudSprite(`hud_${text[0]}_left`, tensColumn, row);
        this.drawHudSprite(`hud_${text[1]}_right`, tensColumn + 1, row);
    }

    drawLevelHud(hudInfo) {
        if (!hudInfo || !this.levelInfoAssetsLoaded) return;

        const centerColumn = 20;

        if (hudInfo.mode === 'preview') {
            this.drawLevelInfoText('PRESS BUTTON TO PLAY', centerColumn - 9, 19);
        } else if (hudInfo.mode === 'play') {
            const outText = String(hudInfo.out ?? 0).padStart(2, '0');
            const inText = String(hudInfo.inPercent ?? 0).padStart(2, '0');
            const minutes = String(hudInfo.minutes ?? 0);
            const seconds = String(hudInfo.seconds ?? 0).padStart(2, '0');
            this.drawLevelInfoText(`OUT ${outText} IN ${inText}% TIME ${minutes} ${seconds}`, centerColumn - 10, 19);
        }

        const stackCount = Math.max(0, Math.min(99, Number(hudInfo.stackCount ?? 0)));
        this.drawLevelInfoText(String(stackCount), 34, 22);

        // Icon strip / skill inventory cluster. Coordinates are based on the
        // SMS row/column layout Callum supplied, with an optional shared group
        // offset for later fine-tuning.
        this.drawHudSprite('hud_release_rate_box', 9, 21);
        this.drawHudNumber(hudInfo.releaseRate ?? 0, 10, 22);

        const pauseTile = hudInfo.hudPauseToggleTile || this.hudPauseTile;
        const pauseIcon = hudInfo.paused ? 'hud_play' : 'hud_pause';
        if (!this.drawHudSprite(pauseIcon, pauseTile.column, pauseTile.row)) {
            this.drawHudFallbackButton(hudInfo.paused ? '>' : 'P', pauseTile.column, pauseTile.row);
        }

        const speedTile = hudInfo.hudSpeedToggleTile || this.hudSpeedTile;
        const speedIcon = (hudInfo.speedMultiplier ?? 1) > 1 ? 'hud_2x_speed' : 'hud_1x_speed';
        if (!this.drawHudSprite(speedIcon, speedTile.column, speedTile.row)) {
            this.drawHudFallbackButton((hudInfo.speedMultiplier ?? 1) > 1 ? '2' : '1', speedTile.column, speedTile.row);
        }

        const controlIcon = hudInfo.mouseControlsEnabled ? 'hud_mouse' : 'hud_controller';
        const controlTile = hudInfo.hudMouseToggleTile || this.hudControlTile;
        if (!this.drawHudSprite(controlIcon, controlTile.column, controlTile.row)) {
            this.drawHudFallbackButton(hudInfo.mouseControlsEnabled ? 'M' : 'C', controlTile.column, controlTile.row);
        }

        const volumeIconByStage = {
            off: 'volume_off',
            medium: 'volume_medium',
            loud: 'volume_loud'
        };
        const volumeFallbackByStage = {
            off: '0',
            medium: '1',
            loud: '2'
        };
        const volumeTile = hudInfo.hudVolumeToggleTile || this.hudVolumeTile;
        const volumeStage = hudInfo.volumeStage || 'loud';
        if (!this.drawHudSprite(volumeIconByStage[volumeStage] || 'volume_loud', volumeTile.column, volumeTile.row)) {
            this.drawHudFallbackButton(volumeFallbackByStage[volumeStage] || '2', volumeTile.column, volumeTile.row);
        }

        const skillColumns = {
            climber: 13,
            floater: 15,
            bomber: 17,
            blocker: 19,
            builder: 21,
            basher: 23,
            miner: 25,
            digger: 27
        };

        for (const [skillId, column] of Object.entries(skillColumns)) {
            this.drawHudNumber(hudInfo.skillCounts?.[skillId] ?? 0, column, 21);
            this.drawHudSprite(`hud_${skillId}`, column, 22);
        }

        const selectedSkillColumn = skillColumns[hudInfo.selectedSkillId];
        if (selectedSkillColumn !== undefined) {
            this.drawHudSprite('hud_active_skill', selectedSkillColumn, 22);
        }

        this.drawHudSprite('hud_nuke', 29, 21);

        const closeupSkillId = hudInfo.closeupSkillId || 'null';
        const closeupAsset = this.hudIcons.has(`hud_closeup_skill_${closeupSkillId}`)
            ? `hud_closeup_skill_${closeupSkillId}`
            : 'hud_closeup_skill_null';
        this.drawHudSprite(closeupAsset, 31, 21);
    }

    formatResultPercent(value) {
        const percent = Math.max(0, Math.min(999, Math.round(Number(value ?? 0))));
        if (percent >= 100) return String(percent);
        return String(percent).padStart(2, '0').padStart(3, ' ');
    }

    drawLevelResultScreen(result) {
        this.drawLevelInfoBackground();
        if (!this.levelInfoAssetsLoaded || !result) return;

        const centerColumn = 20;
        const savedPercent = this.formatResultPercent(result.savedPercent);
        const neededPercent = this.formatResultPercent(result.neededPercent);

        this.drawLevelInfoText('ALL LEMMINGS ACCOUNTED FOR', centerColumn - 12, 1);
        this.drawLevelInfoText(`YOU RESCUED ${savedPercent}%`, centerColumn - 7, 4);
        this.drawLevelInfoText(`YOU NEEDED  ${neededPercent}%`, centerColumn - 7, 7);

        if (result.success) {
            const nextLevel = String(result.nextLevelNumber ?? 1).padStart(2, '0');
            const password = result.password || '????????';

            this.drawLevelInfoText(`CODE FOR LEVEL  ${nextLevel}`, centerColumn - 8, 13);
            this.drawLevelInfoText(password, centerColumn - 3, 16);
            this.drawLevelInfoText('PRESS BUTTON TO CONTINUE', centerColumn - 11, 19);
            return;
        }

        if (result.lowFailure) {
            this.drawLevelInfoText('ROCK BOTTOM! I HOPE YOU', centerColumn - 11, 10);
            this.drawLevelInfoText('NUKED THAT LEVEL', centerColumn - 7, 13);
        } else {
            this.drawLevelInfoText('TRY HARDER', centerColumn - 4, 10);
        }

        this.drawLevelInfoText('PRESS BUTTON 1 FOR MENU', centerColumn - 11, 19);
        this.drawLevelInfoText('PRESS BUTTON 2 TO REPLAY', centerColumn - 11, 22);
    }

    drawFadeOverlay(alpha) {
        const safeAlpha = Math.max(0, Math.min(1, Number(alpha ?? 0)));
        if (safeAlpha <= 0) return;

        this.ctx.save();
        this.ctx.globalAlpha = safeAlpha;
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
        this.ctx.restore();
    }

    moveCamera(dx, dy) {
        this.camera.x += dx;
        this.camera.y += dy;
        this.camera.x = Math.max(0, Math.min(this.camera.x, this.camera.maxX));
        this.camera.y = Math.max(0, Math.min(this.camera.y, this.camera.maxY));
    }
}
