class Game {
    constructor(canvas) {
        this.renderer = new Renderer(canvas);
        this.input = new InputHandler();
        this.input.attachPointerTarget?.(canvas, this.renderer);
        this.tilesetManager = new TilesetManager();
        this.levelLoader = new LevelLoader();
        this.cursor = new GameCursor();
        this.audio = typeof AudioManager !== 'undefined' ? new AudioManager() : null;

        const buildConfig = window.LEMMINGS_BUILD || {};
        this.multiplayerTitleEnabled = buildConfig.showMultiplayerTitle === true;
        this.multiplayerTitleUrl = buildConfig.multiplayerUrl || 'multiplayer/index.html';

        this.skillOrder = [
            { id: 'climber', key: 'climbers', label: 'CLIMB' },
            { id: 'floater', key: 'floaters', label: 'FLOAT' },
            { id: 'bomber', key: 'bombers', label: 'BOMB' },
            { id: 'blocker', key: 'blockers', label: 'BLOCK' },
            { id: 'builder', key: 'builders', label: 'BUILD' },
            { id: 'basher', key: 'bashers', label: 'BASH' },
            { id: 'miner', key: 'miners', label: 'MINE' },
            { id: 'digger', key: 'diggers', label: 'DIG' }
        ];
        this.selectedSkillIndex = null;
        this.skillCounts = {};
        this.skillCycleModeActive = false;
        this.releaseRateHoldFrame = 0;
        this.releaseRateHoldDirection = 0;
        this.releaseRateHotkeyHoldFrame = 0;
        this.releaseRateHotkeyHoldDirection = 0;
        this.RELEASE_RATE_HOLD_INTERVAL_FRAMES = 4;
        this.skillAssignmentBufferActive = false;
        this.skillAssignmentButtonHeldLastFrame = false;
        this.skillAssignmentButtonJustPressed = false;
        this.pauseMenuInputLockFrames = 0;
		this.PAUSE_MENU_INPUT_LOCK_DURATION = 8;

		this.nukeConfirmTicks = 0;
		this.nukeActive = false;
		this.nukeAssignIndex = 0;
		this.nukeCascadeDelayFrames = 0;
		this.nukeOhNoPending = false;
		this.nukeOhNoFinished = false;

		this.resultMusicInputLocked = false;
		this.playStartAudioPending = false;
		this.playStartAudioFinished = false;
		
		this.PRE_LETSGO_DELAY_TICKS = 10;
		this.preLetsGoDelayFrame = 0;
		this.playStartLetsGoStarted = false;
		
		this.lastTimerWarningSecond = null;

		this.cursorImages = null;

        // PC mouse-control scaffold. The SMS cursor remains visible; when mouse
        // mode is enabled it follows the pointer, while LEFT/RIGHT scroll the camera.
        this.mouseControlsEnabled = false;
        this.MOUSE_CAMERA_SCROLL_STANDARD_PX = 8;
        this.MOUSE_CAMERA_SCROLL_FAST_PX = 40;
        // Timing constants. The display runs at PAL/SMS 50Hz, while gameplay
        // logic runs once every 3 display frames. Screen fades are display-frame
        // counts; level delays are logic-tick counts.
        this.DISPLAY_FPS = 50;
		this.LOGIC_FRAMES_PER_UPDATE = 3; // display frames per logic tick
		this.LOGIC_FPS = this.DISPLAY_FPS / this.LOGIC_FRAMES_PER_UPDATE; // 16.666...
		this.LEVEL_TIMER_FRAMES_PER_SECOND = 50;
        this.displayFrameCounter = 0;
        this.SCREEN_FADE_FRAMES = 30;       // display frames
        this.LEVEL_END_DELAY_FRAMES = 5;    // logic ticks (~0.3s at 50/3Hz)
        this.playStartDelayFrame = 0;
        this.screenTransition = null;
        this.levelEndDelayFrame = 0;
        this.levelEndTriggered = false;
        this.levelResult = null;

        this.level = null;
        this.lemmings = [];

        // High-level flow:
        // title -> credits OR levelInfo -> preview OR returningToStart -> startingPlay -> playing.
        // Loading a level must not open the hatch or start the timer.
        this.state = 'title';
        this.returnAfterMenuState = 'title';
        this.startCameraX = 0;
        this.startCameraY = 0;
        // Preview snap-back: 1 SMS tile per logic tick. The camera only moves
        // on the 3-frame SMS logic gate, matching boundary camera scrolling.
        this.cameraReturnSpeed = 8; // px per logic tick (1 SMS tile)
        this.shouldShowCursorAfterReturn = false;

        this.paused = false;
        this.speedMultiplier = 1;
        this.stats = { lemmingsOut: 0, lemmingsSaved: 0, lemmingsLeftToSpawn: 0, timeElapsed: 0 };

        // Spawner state (Z80 Logic)
        this.releaseRate = 0;
        this.spawnTimer = 0;
        this.spawnInterval = 0;

        // Entrance spawning state.
        // SMS starts with its internal finger on trapdoor 1, then increments before
        // spawning, so the first lemming appears from trapdoor 2.
        this.spawnEntrancePointer = 0;

        // Multiple hatch animations. this.hatchAnimation is kept as a compatibility
        // alias for older debug helpers, but gameplay uses this.hatchAnimations.
        this.hatchAnimation = null;
        this.hatchAnimations = [];
        this.hatchAnimationImage = null;

        // Level info screen now acts as the pre-load level selector.
        this.ratingOrder = [
            { label: 'FUN', prefix: 'FUN' },
            { label: 'TRICKY', prefix: 'TRICKY' },
            { label: 'TAXING', prefix: 'TAXING' },
            { label: 'MAYHEM', prefix: 'MAYHEM' },
            { label: 'EXTRA1', prefix: 'EXTRA1' },
            { label: 'EXTRA2', prefix: 'EXTRA2' },
            { label: 'EXTRA3', prefix: 'EXTRA3' },
            { label: 'EXTRA4', prefix: 'EXTRA4' }
        ];
        this.selectedRatingIndex = 0;
        this.selectedLevelNumber = 1;
        this.titleSelectorIndex = 0;
        this.creditsLevelHoldDirection = 0;
        this.creditsLevelHoldFrame = 0;
        this.CREDITS_LEVEL_REPEAT_FRAMES = 5;
        this.selectedLevelInfo = null;
        this.selectedLevelInfoId = null;
        this.levelInfoRequestId = 0;
        this.levelLoadInProgress = false;

        this.initialized = false;
    }

    async initialize() {
        await this.tilesetManager.initialize();
        const spriteSheet = new SpriteSheet();
        await spriteSheet.load('assets/Lemming Animations.png');
        this.renderer.spriteSheet = spriteSheet;
        await this.renderer.loadLevelInfoAssets();

        if (this.audio) {
            await this.audio.initialize();
        }

        const cursorNoSelectionData = await Utils.loadIndexedImage('assets/cursor_no_selection.png');
        const cursorSelectionData = await Utils.loadIndexedImage('assets/cursor_selection.png');
        this.cursorImages = {
            noSelection: cursorNoSelectionData.image,
            selection: cursorSelectionData.image
        };

        // Load hatch animation image once. Individual level hatches share this image.
        this.hatchAnimation = new HatchAnimation();
        await this.hatchAnimation.load('assets/Hatch_Animation.png');
        this.hatchAnimationImage = this.hatchAnimation.image;

        // Load tile animations (torches, water, etc.)
        this.tileAnimationManager = new TileAnimationManager();
        await this.tileAnimationManager.load();

        // Load trap animations (spinners, crushers, etc.)
        this.trapAnimationManager = new TrapAnimationManager();
        await this.trapAnimationManager.load();

        this.pngAnimationManager = new PngAnimationManager();
        await this.pngAnimationManager.load();

        this.initialized = true;
        this.showTitleScreen();
    }

    showTitleScreen() {
        this.level = null;
        this.lemmings = [];
        this.hatchAnimations = [];
        this.hatchAnimation = null;
        this.cursor.setVisible(false);
        this.paused = false;
        this.clearSkillAssignmentBuffer();
        this.resetLevelEndState();
        this.levelResult = null;
        this.state = 'title';
        this.returnAfterMenuState = 'title';
        this.creditsLevelHoldDirection = 0;
        this.creditsLevelHoldFrame = 0;
        this.audio?.playTitleMusic?.();
    }

    // Kept as a compatibility alias for old debug/Esc paths.
    showMenu() {
        this.showTitleScreen();
    }

    hideMenu() {
        if (this.returnAfterMenuState && this.returnAfterMenuState !== 'title') {
            this.state = this.returnAfterMenuState;
        } else {
            this.showTitleScreen();
        }
    }

    showLevelInfo() {
        // Level info is now canvas-rendered.
    }

    hideLevelInfo() {
        // Level info is now canvas-rendered.
    }

    startLevelSelection() {
        this.audio?.stopMusic?.();

        // The level selector lives before the level map is loaded. Keep any
        // previously loaded map out of the way so the briefing screen is clean.
        this.level = null;
        this.lemmings = [];
        this.hatchAnimations = [];
        this.hatchAnimation = null;
        this.cursor.setVisible(false);
        this.paused = false;
        this.stats = { lemmingsOut: 0, lemmingsSaved: 0, lemmingsLeftToSpawn: 0, timeElapsed: 0 };
        this.resetLevelEndState();
        this.levelResult = null;
        this.state = 'levelInfo';
        this.returnAfterMenuState = 'levelInfo';
        return this.loadSelectedLevelInfo();
    }

    enterCreditsScreen() {
        this.level = null;
        this.lemmings = [];
        this.hatchAnimations = [];
        this.hatchAnimation = null;
        this.cursor.setVisible(false);
        this.paused = false;
        this.clearSkillAssignmentBuffer();
        this.resetLevelEndState();
        this.levelResult = null;
        this.state = 'credits';
        this.returnAfterMenuState = 'credits';
        this.creditsLevelHoldDirection = 0;
        this.creditsLevelHoldFrame = 0;
    }

    getTitleRenderData() {
        return {
            selectorIndex: this.titleSelectorIndex,
            ratingCard: this.getSelectedRating()?.prefix || 'FUN',
            showMultiplayer: this.multiplayerTitleEnabled
        };
    }

    getCreditsRenderData() {
        return {
            rating: this.getSelectedRating()?.prefix || 'FUN',
            levelNumber: this.selectedLevelNumber
        };
    }

    getSelectedRating() {
        return this.ratingOrder[this.selectedRatingIndex] || this.ratingOrder[0];
    }

    getSelectedLevelId() {
        const rating = this.getSelectedRating();
        return `${rating.prefix}_${String(this.selectedLevelNumber).padStart(2, '0')}`;
    }

    changeSelectedLevel(deltaLevel, deltaRating) {
        if (deltaLevel) {
            this.selectedLevelNumber = ((this.selectedLevelNumber - 1 + deltaLevel + 30) % 30) + 1;
        }

        if (deltaRating) {
            this.selectedRatingIndex = (this.selectedRatingIndex + deltaRating + this.ratingOrder.length) % this.ratingOrder.length;
        }

        return this.loadSelectedLevelInfo();
    }

    async loadSelectedLevelInfo() {
        const levelId = this.getSelectedLevelId();
        const requestId = ++this.levelInfoRequestId;
        const rating = this.getSelectedRating();

        this.selectedLevelInfoId = levelId;
        this.selectedLevelInfo = {
            title: 'LOADING',
            numLemmings: 0,
            percentNeeded: 0,
            releaseRate: 0,
            timeMinutes: 0,
            rating: rating.label,
            levelNumber: this.selectedLevelNumber
        };

        try {
            const ini = await this.levelLoader.loadLevelInfo(levelId);
            if (requestId !== this.levelInfoRequestId) return;

            this.selectedLevelInfo = {
                title: ini.name || levelId,
                numLemmings: Number(ini.num_lemmings ?? 0),
                percentNeeded: Number(ini.percent_needed ?? 0),
                releaseRate: Number(ini.release_rate ?? 0),
                timeMinutes: Number(ini.time_minutes ?? 0),
                rating: rating.label,
                levelNumber: this.selectedLevelNumber
            };
        } catch (error) {
            if (requestId !== this.levelInfoRequestId) return;
            console.error(`Failed to load level info for ${levelId}:`, error);
            this.selectedLevelInfo = {
                title: levelId,
                numLemmings: 0,
                percentNeeded: 0,
                releaseRate: 0,
                timeMinutes: 0,
                rating: rating.label,
                levelNumber: this.selectedLevelNumber
            };
        }
    }

    getLevelInfoRenderData() {
        if (this.selectedLevelInfo && this.selectedLevelInfoId === this.getSelectedLevelId()) {
            return this.selectedLevelInfo;
        }

        const rating = this.getSelectedRating();
        return {
            title: 'LOADING',
            numLemmings: 0,
            percentNeeded: 0,
            releaseRate: 0,
            timeMinutes: 0,
            rating: rating.label,
            levelNumber: this.selectedLevelNumber
        };
    }

    cycleTitleDifficulty() {
        this.selectedRatingIndex = (this.selectedRatingIndex + 1) % this.ratingOrder.length;
    }

    getTitleMenuCardRects() {
        const centerColumn = 20;
        const cardRow = 12;
        const cardWidth = 48;
        const cardHeight = 56;
        const cardColumns = this.multiplayerTitleEnabled
            ? [centerColumn - 11, centerColumn - 5, centerColumn + 1, centerColumn + 7]
            : [centerColumn - 8, centerColumn - 2, centerColumn + 4];

        return cardColumns.map((column, index) => ({
            index,
            x: column * 8,
            y: cardRow * 8,
            width: cardWidth,
            height: cardHeight
        }));
    }

    getTitleSelectorIndexAtPointer() {
        const pointer = this.input?.pointer;
        if (!pointer?.insideCanvas) return null;

        for (const rect of this.getTitleMenuCardRects()) {
            if (
                pointer.x >= rect.x &&
                pointer.x < rect.x + rect.width &&
                pointer.y >= rect.y &&
                pointer.y < rect.y + rect.height
            ) {
                return rect.index;
            }
        }

        return null;
    }

    handleTitleScreenInput() {
        const maxTitleSelectorIndex = this.multiplayerTitleEnabled ? 3 : 2;
        const pointer = this.input?.pointer;
        const pointerSelectorIndex = this.getTitleSelectorIndexAtPointer();

        if (pointerSelectorIndex !== null) {
            this.titleSelectorIndex = pointerSelectorIndex;
        }

        if (this.input.wasJustPressed('left')) {
            this.titleSelectorIndex = Math.max(0, this.titleSelectorIndex - 1);
        } else if (this.input.wasJustPressed('right')) {
            this.titleSelectorIndex = Math.min(maxTitleSelectorIndex, this.titleSelectorIndex + 1);
        }

        const pointerSelectPressed = pointer?.leftJustPressed && pointer.insideCanvas;
        const selectPressed = this.input.wasJustPressed('select') || this.input.wasJustPressed('skill2');
        if (!selectPressed) return;

        // Pointer clicks on the title screen should only activate a card when the
        // pointer is actually over a card. Keyboard/controller select still uses
        // the currently highlighted hand position.
        if (pointerSelectPressed && pointerSelectorIndex === null) return;

        if (!this.multiplayerTitleEnabled) {
            if (this.titleSelectorIndex === 0) {
                this.beginScreenTransition(() => this.startLevelSelection());
            } else if (this.titleSelectorIndex === 1) {
                this.beginScreenTransition(() => this.enterCreditsScreen());
            } else {
                this.cycleTitleDifficulty();
            }
            return;
        }

        if (this.titleSelectorIndex === 0) {
            this.beginScreenTransition(() => this.startLevelSelection());
        } else if (this.titleSelectorIndex === 1) {
            this.beginScreenTransition(() => this.openMultiplayerTitle());
        } else if (this.titleSelectorIndex === 2) {
            this.beginScreenTransition(() => this.enterCreditsScreen());
        } else {
            this.cycleTitleDifficulty();
        }
    }

    openMultiplayerTitle() {
        window.location.href = this.multiplayerTitleUrl;
    }

    changeCreditsLevel(delta) {
        const nextLevel = Math.max(1, Math.min(30, this.selectedLevelNumber + delta));
        if (nextLevel !== this.selectedLevelNumber) {
            this.selectedLevelNumber = nextLevel;
            //this.audio?.playSfx?.('chime');
        }
    }

    updateCreditsLevelHold() {
        const leftHeld = this.input.isPressed('left');
        const rightHeld = this.input.isPressed('right');
        const direction = leftHeld && !rightHeld ? -1 : rightHeld && !leftHeld ? 1 : 0;

        if (direction === 0) {
            this.creditsLevelHoldDirection = 0;
            this.creditsLevelHoldFrame = 0;
            return;
        }

        if (direction !== this.creditsLevelHoldDirection) {
            this.creditsLevelHoldDirection = direction;
            this.creditsLevelHoldFrame = 0;
            this.changeCreditsLevel(direction);
            return;
        }

        this.creditsLevelHoldFrame++;
        if (this.creditsLevelHoldFrame >= this.CREDITS_LEVEL_REPEAT_FRAMES) {
            this.creditsLevelHoldFrame = 0;
            this.changeCreditsLevel(direction);
        }
    }

    handleCreditsScreenInput() {
        this.updateCreditsLevelHold();

        if (this.input.wasJustPressed('select') || this.input.wasJustPressed('skill2')) {
            this.beginScreenTransition(() => this.showTitleScreen());
        }
    }

    getFadeAlpha() {
        if (!this.screenTransition?.active) return 0;

        if (this.screenTransition.phase === 'black') return 1;

        const frame = Math.max(0, Math.min(this.SCREEN_FADE_FRAMES, this.screenTransition.frame));
        const t = this.SCREEN_FADE_FRAMES <= 0 ? 1 : frame / this.SCREEN_FADE_FRAMES;
        return this.screenTransition.phase === 'out' ? t : 1 - t;
    }

    beginScreenTransition(afterBlack) {
        if (this.screenTransition?.active) return false;

        this.screenTransition = {
            active: true,
            phase: 'out',
            frame: 0,
            afterBlack: typeof afterBlack === 'function' ? afterBlack : null,
            waitingForAfterBlack: false
        };
        return true;
    }

    finishScreenTransitionBlackPhase(transition) {
        if (this.screenTransition !== transition || !transition.active) return;
        transition.phase = 'in';
        transition.frame = 0;
        transition.waitingForAfterBlack = false;
    }

    runScreenTransitionBlackCallback(transition) {
        const afterBlack = transition.afterBlack;
        transition.afterBlack = null;

        if (!afterBlack) {
            this.finishScreenTransitionBlackPhase(transition);
            return;
        }

        try {
            const maybePromise = afterBlack();

            if (maybePromise && typeof maybePromise.then === 'function') {
                transition.waitingForAfterBlack = true;
                maybePromise
                    .catch(error => console.error('Screen transition failed:', error))
                    .finally(() => this.finishScreenTransitionBlackPhase(transition));
                return;
            }
        } catch (error) {
            console.error('Screen transition failed:', error);
        }

        this.finishScreenTransitionBlackPhase(transition);
    }

    updateScreenTransition() {
        if (!this.screenTransition?.active) return false;

        this.updatePauseSafeAnimations();

        if (this.screenTransition.phase === 'out') {
            this.screenTransition.frame++;

            if (this.screenTransition.frame >= this.SCREEN_FADE_FRAMES) {
                this.screenTransition.phase = 'black';
                this.screenTransition.frame = 0;
                this.runScreenTransitionBlackCallback(this.screenTransition);
            }

            return true;
        }

        if (this.screenTransition.phase === 'black') {
            return true;
        }

        if (this.screenTransition.phase === 'in') {
            this.screenTransition.frame++;
            if (this.screenTransition.frame >= this.SCREEN_FADE_FRAMES) {
                this.screenTransition = null;
            }
        }

        return true;
    }

    resetLevelEndState() {
		this.levelEndDelayFrame = 0;
		this.levelEndTriggered = false;
		this.playStartDelayFrame = 0;
		this.preLetsGoDelayFrame = 0;
		this.playStartLetsGoStarted = false;
		this.resultMusicInputLocked = false;
		this.playStartAudioPending = false;
		this.playStartAudioFinished = false;
		this.resetNukeState();
	}

    getNextLevelSelection() {
        return {
            ratingIndex: this.selectedRatingIndex,
            levelNumber: (this.selectedLevelNumber % 30) + 1
        };
    }

    createLevelResultData() {
        const savedPercent = this.getSavedPercent();
        const neededPercent = Number(this.level?.percent_needed ?? 0);
        const nextSelection = this.getNextLevelSelection();
        const success = savedPercent >= neededPercent;

        return {
            success,
            savedPercent,
            neededPercent,
            ratingIndex: this.selectedRatingIndex,
            levelNumber: this.selectedLevelNumber,
            nextRatingIndex: nextSelection.ratingIndex,
            nextLevelNumber: nextSelection.levelNumber,
            password: '????????',
            // SMS-style harsher failure message: saved less than half of the quota.
            lowFailure: savedPercent * 2 < neededPercent
        };
    }

    enterLevelInfoScreen(ratingIndex = this.selectedRatingIndex, levelNumber = this.selectedLevelNumber) {
        this.selectedRatingIndex = (ratingIndex + this.ratingOrder.length) % this.ratingOrder.length;
        this.selectedLevelNumber = ((levelNumber - 1 + 30) % 30) + 1;
        this.audio?.stopMusic?.();

        this.level = null;
        this.lemmings = [];
        this.hatchAnimations = [];
        this.hatchAnimation = null;
        this.cursor.setVisible(false);
        this.paused = false;
        this.stats = { lemmingsOut: 0, lemmingsSaved: 0, lemmingsLeftToSpawn: 0, timeElapsed: 0 };
        this.clearSkillAssignmentBuffer();
        this.resetLevelEndState();
        this.levelResult = null;
        this.state = 'levelInfo';
        this.returnAfterMenuState = 'levelInfo';
        return this.loadSelectedLevelInfo();
    }

    completeLevel() {
        if (this.levelEndTriggered) return;

        this.levelEndTriggered = true;
        const result = this.createLevelResultData();

        this.beginScreenTransition(() => {
            this.levelResult = result;
            this.cursor.setVisible(false);
            this.clearSkillAssignmentBuffer();
            this.resetReleaseRateHold();
            this.state = result.success ? 'levelSuccess' : 'levelFailure';
            this.returnAfterMenuState = this.state;
            this.audio?.stopMusic?.();
            this.startResultMusic(result.success);
        });
    }

    startResultMusic(success) {
        this.resultMusicInputLocked = true;

        const playback = this.audio?.playResultMusic?.(success);
        if (playback && typeof playback.then === 'function') {
            playback.finally(() => {
                this.resultMusicInputLocked = false;
            });
        } else {
            this.resultMusicInputLocked = false;
        }
    }

    isResultMusicInputLocked() {
        return !!this.resultMusicInputLocked;
    }

    updateLevelEndCondition() {
        if (this.state !== 'playing' || !this.level || this.levelEndTriggered) return;

        const noLemmingsInPlay = this.getAliveLemmingCount() === 0;
        const noQueuedLemmings = (this.stats.lemmingsLeftToSpawn ?? 0) <= 0;

        if (!noLemmingsInPlay || !noQueuedLemmings) {
            this.levelEndDelayFrame = 0;
            return;
        }

        this.levelEndDelayFrame++;
        if (this.levelEndDelayFrame >= this.LEVEL_END_DELAY_FRAMES) {
            this.completeLevel();
        }
    }

    handleResultScreenInput() {
        if (!this.levelResult) return false;
        if (this.isResultMusicInputLocked()) return false;

        if (this.state === 'levelSuccess') {
            if (this.input.wasJustPressed('button1') || this.input.wasJustPressed('select') ||
                this.input.wasJustPressed('skill1') || this.input.wasJustPressed('skill2')) {
                const { nextRatingIndex, nextLevelNumber } = this.levelResult;
                this.beginScreenTransition(() => this.enterLevelInfoScreen(nextRatingIndex, nextLevelNumber));
                return true;
            }
            return false;
        }

        if (this.state === 'levelFailure') {
            if (this.input.wasJustPressed('button1') || this.input.wasJustPressed('skill1')) {
                this.beginScreenTransition(() => {
                    this.level = null;
                    this.lemmings = [];
                    this.hatchAnimations = [];
                    this.cursor.setVisible(false);
                    this.levelResult = null;
                    this.resetLevelEndState();
                    this.audio?.stopMusic?.();
                    this.showTitleScreen();
                });
                return true;
            }

            if (this.input.wasJustPressed('select') || this.input.wasJustPressed('skill2')) {
                const { ratingIndex, levelNumber } = this.levelResult;
                this.beginScreenTransition(() => this.enterLevelInfoScreen(ratingIndex, levelNumber));
                return true;
            }
        }

        return false;
    }

    async startSelectedLevel(mode) {
        if (this.levelLoadInProgress) return;

        const levelId = this.getSelectedLevelId();
        this.levelLoadInProgress = true;
        this.state = 'loadingLevel';

        try {
            await this.loadLevel(levelId, { showBriefing: false });
            if (mode === 'preview') {
                this.startPreview();
            } else {
                this.requestPlayFromBriefingOrPreview();
            }
        } catch (error) {
            console.error(`Failed to start ${levelId}:`, error);
            this.state = 'levelInfo';
            this.returnAfterMenuState = 'levelInfo';
            this.loadSelectedLevelInfo();
        } finally {
            this.levelLoadInProgress = false;
        }
    }

    async loadLevel(levelName, options = {}) {
        const { showBriefing = true } = options;
        this.level = await this.levelLoader.loadLevel(levelName);
        this.currentLevelName = levelName;
        this.level.tilesetManager = this.tilesetManager;

        if (this.trapAnimationManager) {
            this.trapAnimationManager.setTrapInstances(this.level.trapInstances || []);
        }

        if (this.pngAnimationManager) {
            await this.pngAnimationManager.setLevel(this.level);
        }

        this.lemmings = [];

        this.stats = {
            lemmingsOut: 0,
            lemmingsSaved: 0,
            lemmingsLeftToSpawn: this.level.num_lemmings || 10,
            timeElapsed: 0
        };

        this.initializeSkillCounts();
        this.resetLevelEndState();
        this.levelResult = null;

        // Initialize release rate from INI
        this.releaseRate = this.level.release_rate || 50;
        this.updateSpawnDelay();

        // SMS QUIRK: Reset timer to 0 so it has to count UP to the interval
        // before the very first spawn occurs.
        this.spawnTimer = 0;

        // SMS QUIRK: The spawn pointer starts on trapdoor 1 internally.
        // spawnLemming() pre-increments it, so the visible sequence begins
        // at trapdoor 2 when multiple trapdoors exist.
        this.spawnEntrancePointer = 0;

        this.setupHatchAnimations();
        this.renderer.updateCameraBounds(this.level);
        this.positionCameraAtStartingEntrance();
        this.startCameraX = this.renderer.camera.x;
        this.startCameraY = this.renderer.camera.y;
        this.cursor.reset(this.renderer, this.level);
        this.cursor.setVisible(true);

        const entranceCount = this.level.entrancePositions?.length || 0;
        const exitCount = this.level.exitPositions?.length || 0;
        console.log(`Loaded ${levelName}: ${entranceCount} entrance(s), ${exitCount} exit(s), ${this.level.trapInstances?.length || 0} trap(s)`);

        const menu = document.getElementById('menu');
        if (menu) menu.style.display = 'none';
        this.paused = false;

        if (showBriefing) {
            const rating = this.getSelectedRating();
            this.selectedLevelInfoId = levelName;
            this.selectedLevelInfo = {
                title: this.level.name || levelName,
                numLemmings: Number(this.level.num_lemmings ?? 0),
                percentNeeded: Number(this.level.percent_needed ?? 0),
                releaseRate: Number(this.level.release_rate ?? 0),
                timeMinutes: Number(this.level.time_minutes ?? 0),
                rating: rating.label,
                levelNumber: this.selectedLevelNumber
            };
            this.state = 'levelInfo';
            this.returnAfterMenuState = 'levelInfo';
            this.showLevelInfo();
        }
    }

    getEntrancePositions() {
        if (this.level?.entrancePositions?.length) return this.level.entrancePositions;
        if (this.level?.entrancePos) return [this.level.entrancePos];
        return [{ x: 160, y: 20, tileX: 20, tileY: 2, engineId: 0 }];
    }

    setupHatchAnimations() {
        if (this.level?.terrainMode === 'png') {
            // PNG levels use animation/object overlays for hatches. The
            // PngAnimationManager owns the visual sequence; spawn points are
            // still derived from role=hatch overlay objects by LevelLoader.
            this.hatchAnimations = [];
            this.hatchAnimation = null;
            return;
        }

        const entrances = this.getEntrancePositions();
        this.hatchAnimations = entrances.map((entrance) => {
            const hatch = new HatchAnimation();
            hatch.image = this.hatchAnimationImage;
            hatch.engineId = entrance.engineId;

            // Entrance marker needs offset: X-16, Y-8 for hatch origin
            hatch.setPosition(entrance.x - 16, entrance.y - 8);
            hatch.reset();

            return hatch;
        });

        // Compatibility alias for older debug helpers.
        this.hatchAnimation = this.hatchAnimations[0] || null;
    }

    startHatchAnimations() {
        if (this.level?.terrainMode === 'png') {
            this.pngAnimationManager?.startLevelStartAnimations?.();
            return;
        }

        for (const hatch of this.hatchAnimations) {
            hatch.start();
        }
    }

    updateHatchAnimations() {
        if (this.level?.terrainMode === 'png') return;

        for (const hatch of this.hatchAnimations) {
            hatch.update();
        }
    }

    areHatchAnimationsFinished() {
        if (this.level?.terrainMode === 'png') {
            return this.pngAnimationManager?.areLevelStartAnimationsFinished?.() ?? true;
        }

        if (this.hatchAnimations.length === 0) return true;
        return this.hatchAnimations.every(hatch => hatch.hasFinished);
    }

    positionCameraAtStartingEntrance() {
        const cameraEntrance = this.level.cameraEntrancePos || this.level.entrancePos;
        if (!cameraEntrance) return;

        // Camera starts on the furthest-left entrance. The hatch origin is
        // entrance.x - 16, and SMS placement puts that hatch at screen column 14.
        // Express this as the intended on-screen column instead of a camera
        // nudge, because camera movement visually works in the opposite direction.
        const hatchX = cameraEntrance.x - 16;
        const hatchY = cameraEntrance.y - 8;
        const SMS_HATCH_START_SCREEN_X = 14 * 8;
        const EXPANDED_HATCH_START_SCREEN_Y = 3 * 8;

        this.renderer.updateCameraBounds(this.level);
        this.renderer.camera.x = Math.max(0, Math.min(this.renderer.camera.maxX || 0, hatchX - SMS_HATCH_START_SCREEN_X));
        this.renderer.camera.y = Math.max(0, Math.min(this.renderer.camera.maxY || 0, hatchY - EXPANDED_HATCH_START_SCREEN_Y));
        this.renderer.updateCameraBounds(this.level);

        console.log(`Camera positioned at X=${this.renderer.camera.x}, Y=${this.renderer.camera.y} (leftmost hatch at ${hatchX},${hatchY}, max ${this.renderer.camera.maxX},${this.renderer.camera.maxY})`);
    }

    updateSpawnDelay() {
        // Z80 release-rate math, counted in the current 50/3Hz logic ticks.
        // Formula: (50 - floor(rate / 2)) * 2, minimum 3 ticks.
        // Preserve the tested spawn feel unless deliberately retiming.
        const baseInterval = (50 - Math.floor(this.releaseRate / 2)) * 2;
        this.spawnInterval = Math.max(3, baseInterval);
    }



    initializeSkillCounts() {
        this.skillCounts = {};
        for (const skill of this.skillOrder) {
            this.skillCounts[skill.id] = Number(this.level?.[skill.key] ?? 0);
        }

        // SMS starts a level with no skill selected. Direct HUD selection can
        // choose an available skill, and Button 1+2 cycling can choose any skill.
        this.selectedSkillIndex = null;
    }

    getSelectedSkill() {
        if (!this.skillOrder.length || this.selectedSkillIndex === null) return null;
        return this.skillOrder[this.selectedSkillIndex] || null;
    }

    handleSkillSelectionInput() {
        if (!this.skillOrder.length) return;

        if (this.input.wasJustPressed('skillPrev')) {
            this.cycleSelectedSkill(-1);
        }

        if (this.input.wasJustPressed('skillNext')) {
            this.cycleSelectedSkill(1);
        }

        for (let i = 0; i < this.skillOrder.length; i++) {
            if (this.input.wasJustPressed(`skill${i + 1}`)) {
                this.setSelectedSkillIndex(i, true);
                break;
            }
        }
    }

    resetReleaseRateHotkeyHold() {
        this.releaseRateHotkeyHoldFrame = 0;
        this.releaseRateHotkeyHoldDirection = 0;
    }

    handleReleaseRateHotkeys() {
        const upHeld = this.input.isPressed('rateUp');
        const downHeld = this.input.isPressed('rateDown');
        const delta = upHeld === downHeld ? 0 : (upHeld ? 1 : -1);

        if (delta === 0) {
            this.resetReleaseRateHotkeyHold();
            return false;
        }

        if (delta !== this.releaseRateHotkeyHoldDirection) {
            this.releaseRateHotkeyHoldDirection = delta;
            this.releaseRateHotkeyHoldFrame = 0;
            this.changeReleaseRate(delta);
            return true;
        }

        this.releaseRateHotkeyHoldFrame++;
        if (this.releaseRateHotkeyHoldFrame >= this.RELEASE_RATE_HOLD_INTERVAL_FRAMES) {
            this.releaseRateHotkeyHoldFrame = 0;
            this.changeReleaseRate(delta);
        }

        return true;
    }

    getSkillHudColumns() {
        return {
            climber: 13,
            floater: 15,
            bomber: 17,
            blocker: 19,
            builder: 21,
            basher: 23,
            miner: 25,
            digger: 27
        };
    }

    getCursorHudTile() {
        if (!this.cursor || !this.renderer) return null;

        const screenX = this.cursor.x - this.renderer.camera.x;
        const screenY = this.cursor.y - this.renderer.camera.y;

        return this.getHudTileAtScreenPosition(screenX, screenY);
    }

    getHudTileAtScreenPosition(screenX, screenY) {
        if (!this.renderer) return null;

        if (screenX < 0 || screenX >= this.renderer.logicalWidth ||
            screenY < 0 || screenY >= this.renderer.logicalHeight) {
            return null;
        }

        return {
            column: Math.floor((screenX - (this.renderer.hudGroupOffsetX || 0)) / this.renderer.tileSize),
            row: Math.floor((screenY - (this.renderer.hudGroupOffsetY || 0)) / this.renderer.tileSize)
        };
    }

    getPointerHudTile() {
        const pointer = this.input?.pointer;
        if (!pointer?.insideCanvas) return null;
        return this.getHudTileAtScreenPosition(pointer.x, pointer.y);
    }

    isLevelHudControlVisible() {
        return !!this.level && ![
            'title',
            'credits',
            'levelInfo',
            'loadingLevel',
            'startingPlay',
            'returningToStart',
            'levelSuccess',
            'levelFailure'
        ].includes(this.state);
    }

    getHudPauseToggleTile() {
        // Shared draw/click rectangle for the pause/play toggle.
        // Top-left tile is used for drawing; the full 2x2 tile area is clickable.
        return { column: 5, row: 20, width: 2, height: 2 };
    }

    getHudSpeedToggleTile() {
        // Shared draw/click rectangle for the 1x/fast-forward toggle.
        // Top-left tile is used for drawing; the full 2x2 tile area is clickable.
        return { column: 5, row: 22, width: 2, height: 2 };
    }

    getHudMouseToggleTile() {
        // Shared draw/click rectangle for the mouse/controller toggle.
        // Top-left tile is used for drawing; the full 2x2 tile area is clickable.
        return { column: 7, row: 20, width: 2, height: 2 };
    }

    getHudVolumeToggleTile() {
        // Shared draw/click rectangle for the volume toggle.
        // Top-left tile is used for drawing; the full 2x2 tile area is clickable.
        return { column: 7, row: 22, width: 2, height: 2 };
    }

    isHudTileInRect(column, row, rect) {
        if (!rect) return false;
        const width = rect.width || 1;
        const height = rect.height || 1;
        return column >= rect.column &&
            column < rect.column + width &&
            row >= rect.row &&
            row < rect.row + height;
    }

    isHudPauseTile(column, row) {
        return this.isHudTileInRect(column, row, this.getHudPauseToggleTile());
    }

    isHudSpeedTile(column, row) {
        return this.isHudTileInRect(column, row, this.getHudSpeedToggleTile());
    }

    isHudMouseToggleTile(column, row) {
        return this.isHudTileInRect(column, row, this.getHudMouseToggleTile());
    }

    isHudVolumeTile(column, row) {
        return this.isHudTileInRect(column, row, this.getHudVolumeToggleTile());
    }

    toggleMouseControls() {
        this.mouseControlsEnabled = !this.mouseControlsEnabled;
        this.playChimeSfx();
        if (this.mouseControlsEnabled) {
            this.syncCursorToPointer();
        }
        return this.mouseControlsEnabled;
    }

    cycleAudioVolumeStage() {
        this.audio?.cycleVolumeStage?.();
        return true;
    }

    toggleHudPause() {
        if (!this.level || this.state !== 'playing' || this.shouldIgnorePauseOrMenuInput?.()) return false;
        this.paused = !this.paused;
        return true;
    }

    toggleSpeedMultiplier() {
        if (!this.level || this.state !== 'playing') return false;
        this.speedMultiplier = this.speedMultiplier === 1 ? 3 : 1;
        return true;
    }

    handleAudioHotkeys() {
        if (this.input.wasJustPressed('toggleMute')) {
            this.audio?.toggleMute?.();
        }

        if (this.input.wasJustPressed('toggleHalfVolume')) {
            this.audio?.toggleHalfVolume?.();
        }
    }

    handlePointerHudControlPress() {
        // Highest-priority toggle handling. The control/volume buttons must work
        // before ordinary Button 2 flow, skill assignment, pause, or mouse-mode
        // branching can consume the press.
        const candidates = [];
        const pointer = this.input?.pointer;

        // Mouse click directly on the HUD icon, even when mouse mode is OFF.
        if (pointer?.leftJustPressed && pointer.insideCanvas) {
            const pointerTile = this.getPointerHudTile();
            if (pointerTile) candidates.push({ tile: pointerTile, fromPointer: true });
        }

        // Keyboard/controller Button 2 while the SMS cursor is over the icon.
        const selectJustPressed = this.input?.peekJustPressed?.('select') ?? !!this.input?.keysPressed?.select;
        if (selectJustPressed) {
            const cursorTile = this.getCursorHudTile();
            if (cursorTile) candidates.push({ tile: cursorTile, fromPointer: false });
        }

        for (const candidate of candidates) {
            const { column, row } = candidate.tile;

            if (this.isHudPauseTile(column, row)) {
                this.toggleHudPause();
                this.consumeHudTogglePress(candidate.fromPointer);
                return true;
            }

            if (this.isHudSpeedTile(column, row)) {
                this.toggleSpeedMultiplier();
                this.consumeHudTogglePress(candidate.fromPointer);
                return true;
            }

            if (this.isHudMouseToggleTile(column, row)) {
                this.toggleMouseControls();
                this.consumeHudTogglePress(candidate.fromPointer);
                return true;
            }

            if (this.isHudVolumeTile(column, row)) {
                this.cycleAudioVolumeStage();
                this.consumeHudTogglePress(candidate.fromPointer);
                return true;
            }
        }

        return false;
    }

    consumeHudTogglePress(fromPointer = false) {
        if (fromPointer) {
            this.input?.consumePointerSelectPress?.();
        } else {
            this.input?.clearPress?.('select');
        }

        this.clearSkillAssignmentBuffer();
        this.resetReleaseRateHold?.();
    }

    getActiveHudTileForSelect() {
        const pointer = this.input?.pointer;
        if (pointer?.leftJustPressed && pointer.insideCanvas) {
            const pointerTile = this.getPointerHudTile();
            if (pointerTile) return pointerTile;
        }
        return this.getCursorHudTile();
    }

    getLevelPixelWidth() {
        return this.level ? (this.level.pixelWidth || this.level.width * 8) : this.renderer.logicalWidth;
    }

    getLevelPixelHeight() {
        return this.level ? (this.level.pixelHeight || this.level.height * 8) : this.renderer.viewportHeight;
    }

    getCursorWorldMaxY() {
        if (this.cursor?.getCursorMaxY) {
            return this.cursor.getCursorMaxY(this.renderer, this.level);
        }

        const levelBottom = this.getLevelPixelHeight() - 1;
        const hudReachBottom = Math.floor(this.renderer.camera.y + this.renderer.logicalHeight - 1);
        return Math.max(levelBottom, hudReachBottom);
    }

    syncCursorToPointer() {
        const pointer = this.input?.pointer;
        if (!this.mouseControlsEnabled || !pointer?.insideCanvas || !this.cursor || !this.renderer) {
            return false;
        }

        const levelWidth = this.getLevelPixelWidth();
        const cursorMaxY = this.getCursorWorldMaxY();

        this.cursor.x = Math.max(0, Math.min(levelWidth - 1, this.renderer.camera.x + pointer.x));
        this.cursor.y = Math.max(0, Math.min(cursorMaxY, this.renderer.camera.y + pointer.y));
        this.cursor.directionHoldFrames = 0;
        this.cursor.lastMoveX = 0;
        this.cursor.lastMoveY = 0;
        this.cursor.updateLemmingStack?.(this.lemmings);
        return true;
    }

    scrollCameraBy(deltaX = 0, deltaY = 0) {
        if (!this.renderer || !this.level || (deltaX === 0 && deltaY === 0)) return false;

        const levelWidth = this.getLevelPixelWidth();
        const levelHeight = this.getLevelPixelHeight();
        const maxCameraX = Math.max(0, levelWidth - this.renderer.viewportWidth);
        const maxCameraY = Math.max(0, levelHeight - this.renderer.viewportHeight);
        const beforeX = this.renderer.camera.x;
        const beforeY = this.renderer.camera.y;

        this.renderer.camera.x = Math.max(0, Math.min(maxCameraX, this.renderer.camera.x + deltaX));
        this.renderer.camera.y = Math.max(0, Math.min(maxCameraY, this.renderer.camera.y + deltaY));

        return this.renderer.camera.x !== beforeX || this.renderer.camera.y !== beforeY;
    }

    updateMouseModeCameraNavigation(isLogicTick = false) {
        if (!this.mouseControlsEnabled || !this.level || !this.renderer) return false;

        let moved = false;

        if (isLogicTick) {
            const leftHeld = this.input.isPressed('left');
            const rightHeld = this.input.isPressed('right');
            const upHeld = this.input.isPressed('up');
            const downHeld = this.input.isPressed('down');
            const directionX = leftHeld && !rightHeld ? -1 : rightHeld && !leftHeld ? 1 : 0;
            const directionY = upHeld && !downHeld ? -1 : downHeld && !upHeld ? 1 : 0;

            if (directionX !== 0 || directionY !== 0) {
                const speed = this.input.isPressed('button1')
                    ? this.MOUSE_CAMERA_SCROLL_FAST_PX
                    : this.MOUSE_CAMERA_SCROLL_STANDARD_PX;
                moved = this.scrollCameraBy(directionX * speed, directionY * speed) || moved;
            }
        }

        const wheelSteps = this.input.consumeWheelSteps?.() || 0;
        if (wheelSteps !== 0) {
            const levelCanScrollVertically = this.getLevelPixelHeight() > this.renderer.viewportHeight;
            const levelCanScrollHorizontally = this.getLevelPixelWidth() > this.renderer.viewportWidth;
            const wheelDelta = Math.sign(wheelSteps) * this.MOUSE_CAMERA_SCROLL_FAST_PX;

            // Mouse wheel keeps the old horizontal behaviour for standard wide
            // levels. Pure/taller-than-screen vertical maps use the wheel for Y.
            if (levelCanScrollVertically && !levelCanScrollHorizontally) {
                moved = this.scrollCameraBy(0, wheelDelta) || moved;
            } else {
                moved = this.scrollCameraBy(wheelDelta, 0) || moved;
            }
        }

        return moved;
    }

    updateCursorForCurrentInputMode(isLogicTick = false) {
        if (this.mouseControlsEnabled) {
            this.updateMouseModeCameraNavigation(isLogicTick);
            this.syncCursorToPointer();
            return this.cursor?.hoveredLemming || null;
        }

        return this.cursor.update(this.input, this.renderer, this.level, this.lemmings, { allowCameraScroll: isLogicTick });
    }
	
	isHudNukeTile(column, row) {
		return column >= 29 && column <= 30 && row >= 21 && row <= 23;
	}

	resetNukeConfirm() {
		this.nukeConfirmTicks = 0;
	}

	resetNukeState() {
		this.nukeConfirmTicks = 0;
		this.nukeActive = false;
		this.nukeAssignIndex = 0;
		this.nukeCascadeDelayFrames = 0;
		this.nukeOhNoPending = false;
		this.nukeOhNoFinished = false;
	}

	activateNuke() {
		if (this.nukeActive || this.state !== 'playing' || !this.level) return false;

		// SMS nuke cancels any remaining hatch queue immediately. Already-spawned
		// lemmings then receive bomber fuses one slot per logic tick.
		this.stats.lemmingsLeftToSpawn = 0;
		this.nukeActive = true;
		this.nukeAssignIndex = 0;
		this.nukeCascadeDelayFrames = 0;
		this.nukeOhNoPending = true;
		this.nukeOhNoFinished = false;

		const ohNoPlayback = this.audio?.playOhNo?.();
		if (ohNoPlayback && typeof ohNoPlayback.then === 'function') {
			ohNoPlayback.finally(() => {
				this.nukeOhNoFinished = true;
			});
		} else {
			this.nukeOhNoFinished = true;
		}

		this.resetNukeConfirm();
		this.clearSkillAssignmentBuffer();
		return true;
	}

	updateNukeControl(isLogicTick = false) {
		const tile = this.getCursorHudTile();
		const overNuke = !!tile && this.isHudNukeTile(tile.column, tile.row);
		const nukeButtonHeld = overNuke &&
			this.input.isPressed('select') &&
			!this.input.isPressed('button1') &&
			!this.skillCycleModeActive;

		if (!nukeButtonHeld) {
			this.resetNukeConfirm();
			return false;
		}

		// The Nuke button owns Button 2 while held over it, even on display
		// frames that are not game-logic ticks.
		if (!isLogicTick) return true;

		if (this.state !== 'playing' || this.paused || this.nukeActive) {
			this.resetNukeConfirm();
			return true;
		}

		this.nukeConfirmTicks++;
		if (this.nukeConfirmTicks >= 2) {
			this.activateNuke();
		}

		return true;
	}

	shouldNukeAssignBomber(lemming) {
		if (!lemming) return false;
		if (lemming.state === 'exploding') return false;
		if (lemming.isOutOfPlayForBomberFuse?.()) return false;
		return true;
	}

	updateNukeCascade() {
		if (!this.nukeActive) return false;

		if (this.nukeOhNoPending) {
			if (!this.nukeOhNoFinished) return true;
			this.nukeOhNoPending = false;
		}

		if (this.nukeCascadeDelayFrames > 0) {
			this.nukeCascadeDelayFrames--;
			return true;
		}

		if (this.nukeAssignIndex >= this.lemmings.length) {
			this.nukeActive = false;
			return false;
		}

		// One lemming-array slot per logic tick, preserving the SMS stagger.
		const lemming = this.lemmings[this.nukeAssignIndex];
		this.nukeAssignIndex++;

		if (this.shouldNukeAssignBomber(lemming)) {
			lemming.assignSkill('bomber');
		}
		
		this.nukeCascadeDelayFrames = 4;

		return true;
	}

    getSkillAtHudTile(column, row) {
        const columns = this.getSkillHudColumns();

        for (const [skillId, startColumn] of Object.entries(columns)) {
            const withinColumns = column >= startColumn && column <= startColumn + 1;
            const onNumberRow = row === 21;
            const onIconRows = row >= 22 && row <= 23;

            if (withinColumns && (onNumberRow || onIconRows)) {
                return skillId;
            }
        }

        return null;
    }

    playChimeSfx() {
        this.audio?.playChime?.();
    }

    setSelectedSkillIndex(index, playChime = true) {
        if (index < 0 || index >= this.skillOrder.length) return false;
        this.selectedSkillIndex = index;
        if (playChime) this.playChimeSfx();
        return true;
    }

    selectSkillById(skillId, requireAvailable = false) {
        const index = this.skillOrder.findIndex(skill => skill.id === skillId);
        if (index < 0) return false;

        if (requireAvailable && (this.skillCounts[skillId] ?? 0) <= 0) {
            return false;
        }

        return this.setSelectedSkillIndex(index, true);
    }

    cycleSelectedSkill(direction) {
        if (!this.skillOrder.length || direction === 0) return false;

        const nextIndex = this.selectedSkillIndex === null
            ? (direction > 0 ? 0 : this.skillOrder.length - 1)
            : (this.selectedSkillIndex + direction + this.skillOrder.length) % this.skillOrder.length;

        return this.setSelectedSkillIndex(nextIndex, true);
    }

    changeReleaseRate(delta) {
        if (!this.level || delta === 0) return false;

        const minRate = Number(this.level.release_rate || 1);
        const maxRate = 99;
        const nextRate = Math.max(minRate, Math.min(maxRate, this.releaseRate + delta));

        if (nextRate === this.releaseRate) return false;

        this.releaseRate = nextRate;
        this.updateSpawnDelay();
        return true;
    }

    getReleaseRateHudDelta(column, row) {
        // SMS release-rate controls use the two tiles above/below the displayed
        // release-rate digits: upper pair increases, lower pair decreases.
        if (column >= 10 && column <= 11 && row === 21) return 1;
        if (column >= 10 && column <= 11 && row === 23) return -1;
        return 0;
    }

    resetReleaseRateHold() {
        this.releaseRateHoldFrame = 0;
        this.releaseRateHoldDirection = 0;
    }

    updateReleaseRateHold() {
        const tile = this.getCursorHudTile();
        const delta = tile ? this.getReleaseRateHudDelta(tile.column, tile.row) : 0;

        if (!this.input.isPressed('select') || delta === 0) {
            this.resetReleaseRateHold();
            return false;
        }

        if (delta !== this.releaseRateHoldDirection) {
            this.releaseRateHoldDirection = delta;
            this.releaseRateHoldFrame = 0;
            this.changeReleaseRate(delta);
            return true;
        }

        this.releaseRateHoldFrame++;
        if (this.releaseRateHoldFrame >= this.RELEASE_RATE_HOLD_INTERVAL_FRAMES) {
            this.releaseRateHoldFrame = 0;
            this.changeReleaseRate(delta);
        }

        return true;
    }

    handleHudSelectPress() {
        const tile = this.getActiveHudTileForSelect();
        if (!tile) return false;

        const { column, row } = tile;

        if (this.isHudPauseTile(column, row)) {
            this.toggleHudPause();
            return true;
        }

        if (this.isHudSpeedTile(column, row)) {
            this.toggleSpeedMultiplier();
            return true;
        }

        if (this.isHudMouseToggleTile(column, row)) {
            this.toggleMouseControls();
            return true;
        }

        if (this.isHudVolumeTile(column, row)) {
            this.cycleAudioVolumeStage();
            return true;
        }

        const skillId = this.getSkillAtHudTile(column, row);
        if (skillId) {
            this.selectSkillById(skillId, true);
            return true;
        }

        // Nuke and close-up panel are distinct HUD controls. Consume Button 2
		// here so clicks do not leak into gameplay assignment. Nuke activation
		// itself is handled by updateNukeControl(), because it needs two
		// consecutive logic ticks rather than a single display-frame press.
		if (this.isHudNukeTile(column, row)) return true;

		const overCloseup = column >= 31 && column <= 33 && row >= 21 && row <= 23;
		return overCloseup;
	}
	updateSkillAssignmentButtonState() {
        const button2Held = this.input.isPressed('select');
        this.skillAssignmentButtonJustPressed = button2Held && !this.skillAssignmentButtonHeldLastFrame;
        this.skillAssignmentButtonHeldLastFrame = button2Held;

        if (!button2Held) {
            this.clearSkillAssignmentBuffer();
        }
    }

    clearSkillAssignmentBuffer() {
        this.skillAssignmentBufferActive = false;
    }

    queueSkillAssignmentBuffer() {
        const selectedSkill = this.getSelectedSkill();
        if (!selectedSkill) return false;

        if ((this.skillCounts[selectedSkill.id] ?? 0) <= 0) {
            return false;
        }

        this.skillAssignmentBufferActive = true;
        return true;
    }

    updateSkillAssignmentBuffer(isLogicTick = false) {
        if (!this.skillAssignmentBufferActive || !this.input.isPressed('select')) {
            return false;
        }

        if (this.tryAssignSelectedSkill(isLogicTick)) {
            this.clearSkillAssignmentBuffer();
            return true;
        }

        // No valid target yet: keep the pending press alive until Button 2 is
        // released, even if the cursor passes over invalid/non-assignable lemmings.
        return false;
    }

    isSmsActionButtonHeld() {
        return this.input.isPressed('button1') || this.input.isPressed('select');
    }

    isSkillCycleComboHeld() {
        return this.input.isPressed('button1') && this.input.isPressed('select');
    }

    shouldIgnorePauseOrMenuInput() {
        // Actual manual pause/menu must still work while holding movement or
        // action buttons. The Button 1+Button 2 skill-cycle path clears pause
        // presses before this point, so it cannot leak into pause toggling.
        return this.skillCycleModeActive;
    }

    clearPauseMenuPresses() {
        if (typeof this.input.clearPress === 'function') {
            this.input.clearPress('pause');
            this.input.clearPress('menu');
        }
    }

    updatePauseMenuInputLock() {
        if (this.skillCycleModeActive) {
            this.pauseMenuInputLockFrames = this.PAUSE_MENU_INPUT_LOCK_DURATION;
        } else if (this.pauseMenuInputLockFrames > 0) {
            this.pauseMenuInputLockFrames--;
        }

        if (this.pauseMenuInputLockFrames > 0) {
            this.clearPauseMenuPresses();
        }
    }

    isPauseMenuInputLocked() {
        return this.pauseMenuInputLockFrames > 0 || this.skillCycleModeActive;
    }

    updateSkillCycleMode() {
        const button1Held = this.input.isPressed('button1');
        const button2Held = this.input.isPressed('select');
        const comboHeld = this.isSkillCycleComboHeld();

        if (comboHeld) {
            this.skillCycleModeActive = true;
            this.clearPauseMenuPresses();
        }

        if (!this.skillCycleModeActive) {
            return false;
        }

        // Button 1+2 skill cycling owns Button 2 while active, so make sure
        // release-rate hold repeat and buffered assignment cannot keep firing
        // underneath it.
        this.resetReleaseRateHold();
        this.clearSkillAssignmentBuffer();

        if (comboHeld) {
            if (this.input.wasJustPressed('left')) {
                this.cycleSelectedSkill(-1);
            }

            if (this.input.wasJustPressed('right')) {
                this.cycleSelectedSkill(1);
            }
        }

        if (!button1Held && !button2Held) {
            this.skillCycleModeActive = false;
        }

        // Returning true means only cursor/HUD assignment controls should be
        // frozen. The level simulation must continue while skills are cycled.
        return true;
    }
	
    finishLandingFallerForImmediateSkill(lemming) {
		if (!lemming || lemming.state !== 'falling' || !this.level) return false;

		// Do not use a skill assignment to interrupt floater deployment. This
		// helper is only for the one-frame gap where a normal faller is about to
		// land, but input is processed before the gated physics update.
		if (lemming.isFloater) return false;

		let simulatedY = lemming.y;
		let simulatedFallDistance = lemming.fallDistance;

		for (let i = 0; i < Physics.fallSpeed; i++) {
			const probeY = Math.floor(simulatedY + lemming.height + 1);

			if (this.level.checkCollision(
				lemming.x,
				probeY,
				this.level.tilesetManager
			)) {
				lemming.y = simulatedY;
				lemming.fallDistance = simulatedFallDistance;
				lemming.land(this.level, probeY);

				return lemming.state === 'walking';
			}

			simulatedY++;
			simulatedFallDistance++;
		}

		return false;
	}
	
	hasPermanentSkillAlready(skillId, lemming) {
    if (!lemming) return true;

    if (skillId === 'climber') {
        return !!lemming.isClimber;
    }

    if (skillId === 'floater') {
        return !!lemming.isFloater;
    }

    if (skillId === 'bomber') {
        return lemming.fuseValue > 0 || lemming.state === 'exploding';
    }

    return false;
}

	canAssignSkillToLemming(skillId, lemming) {
		if (!skillId || !lemming) return false;

		// Climber, Floater, and Bomber are immutable/permanent-style flags.
		// Once assigned, they cannot be assigned again.
		if (this.hasPermanentSkillAlready(skillId, lemming)) {
			return false;
		}

		const anySkill = [
			'climber',
			'floater',
			'bomber',
			'blocker',
			'builder',
			'basher',
			'miner',
			'digger'
		];

		const stateSkillRules = {
			walking: anySkill,

			falling: [
				'climber',
				'floater',
				'bomber'
			],

			climbing: [
				'floater',
				'bomber'
			],

			floating: [
				'climber',
				'bomber'
			],

			building: [
				'climber',
				'floater',
				'bomber',
				'blocker',
				'miner',
				'digger'
			],
			
			blocking: [
				'bomber'
			],

			shrugging: [
				'climber',
				'floater',
				'bomber',
				'blocker',
				'builder',
				'miner',
				'digger'
			],

			bashing: [
				'climber',
				'floater',
				'bomber',
				'blocker',
				'builder',
				'miner',
				'digger'
			],

			mining: [
				'climber',
				'floater',
				'bomber',
				'blocker',
				'builder',
				'digger'
			],

			digging: [
				'climber',
				'floater',
				'bomber',
				'basher',
				'blocker',
				'builder',
				'miner'
			]
		};

		return stateSkillRules[lemming.state]?.includes(skillId) || false;
	}

	tryAssignSelectedSkill(isLogicTick = false) {
		const selectedSkill = this.getSelectedSkill();
		const target = this.cursor?.hoveredLemming;

		if (!selectedSkill || !target) return false;

		const skillId = selectedSkill.id;

		if ((this.skillCounts[skillId] ?? 0) <= 0) {
			return false;
		}

		// Input is processed before the gated falling update. If Button 2 is
		// pressed on the exact logic tick a faller would land, finish that landing
		// first so walking-state skills are not lost on the landing frame.
		if (!this.canAssignSkillToLemming(skillId, target)) {
			const landedThisTick = isLogicTick &&
				target.state === 'falling' &&
				this.finishLandingFallerForImmediateSkill(target);

			if (!landedThisTick || !this.canAssignSkillToLemming(skillId, target)) {
				return false;
			}
		}

		target.assignSkill(skillId);
		this.skillCounts[skillId] = Math.max(0, (this.skillCounts[skillId] ?? 0) - 1);
		this.playChimeSfx();
		return true;
	}

    getCloseupSkillIdForLemming(lemming) {
        if (!lemming || !this.cursor?.isSelectableLemming?.(lemming)) return null;

        const exclusiveStateIcons = {
            blocking: 'blocker',
            building: 'builder',
            bashing: 'basher',
            mining: 'miner',
            digging: 'digger'
        };

        if (exclusiveStateIcons[lemming.state]) {
            return exclusiveStateIcons[lemming.state];
        }

        if (lemming.state === 'floating') return 'floater';
        if (lemming.state === 'climbing' || lemming.isClimber) return 'climber';
        if (lemming.isFloater) return 'floater';

        return 'walker';
    }

    startPreview() {
        if (!this.level) return;
        this.hideLevelInfo();
        this.state = 'preview';
        this.returnAfterMenuState = 'preview';
        console.log('Preview started: hatch shut, timer stopped');
    }

    requestPlayFromBriefingOrPreview() {
        if (!this.level) return;
        this.hideLevelInfo();

        // Reset the hatch/opening state every time the real play cycle begins.
        // Previewing never opens the hatch.
        this.setupHatchAnimations();
        this.lemmings = [];
        this.cursor.setVisible(false);
        this.shouldShowCursorAfterReturn = true;
        this.stats.lemmingsOut = 0;
        this.stats.lemmingsSaved = 0;
        this.stats.lemmingsLeftToSpawn = this.level.num_lemmings || 10;
        this.stats.timeElapsed = 0;
        this.resetLevelEndState();
        this.levelResult = null;
        this.spawnTimer = 0;
        this.spawnEntrancePointer = 0;

        const dx = Math.abs(this.renderer.camera.x - this.startCameraX);
        const dy = Math.abs(this.renderer.camera.y - this.startCameraY);

        if (dx > 0 || dy > 0) {
            this.state = 'returningToStart';
            this.returnAfterMenuState = 'returningToStart';
            console.log('Returning camera to start before opening hatch');
        } else {
            this.beginPlayStartDelay();
        }
    }

    beginPlayStartDelay() {
		this.renderer.camera.x = this.startCameraX;
		this.renderer.camera.y = this.startCameraY;
		this.cursor.reset(this.renderer, this.level);
		this.cursor.setVisible(true);
		this.shouldShowCursorAfterReturn = false;

		this.playStartDelayFrame = 0;
		this.preLetsGoDelayFrame = 0;
		this.playStartLetsGoStarted = false;
		this.playStartAudioPending = false;
		this.playStartAudioFinished = false;

		this.state = 'startingPlay';
		this.returnAfterMenuState = 'startingPlay';
		this.paused = false;

		console.log("Pre-Let's Go delay started: hatch shut, timer stopped, input disabled");
	}

	startLetsGoSequence() {
		if (this.playStartLetsGoStarted) return;

		this.playStartLetsGoStarted = true;
		this.playStartAudioPending = true;
		this.playStartAudioFinished = false;

		const playback = this.audio?.playLetsGo?.();
		if (playback && typeof playback.then === 'function') {
			playback.finally(() => {
				this.playStartAudioPending = false;
				this.playStartAudioFinished = true;
			});
		} else {
			this.playStartAudioPending = false;
			this.playStartAudioFinished = true;
		}

		console.log("Let's Go music started: hatch shut, timer stopped, input disabled");
	}

    beginPlayCycle() {
        this.renderer.camera.x = this.startCameraX;
        this.renderer.camera.y = this.startCameraY;
        this.cursor.setVisible(true);
        this.shouldShowCursorAfterReturn = false;
		this.playStartDelayFrame = 0;
		this.preLetsGoDelayFrame = 0;
		this.playStartLetsGoStarted = false;
		this.playStartAudioPending = false;
		this.playStartAudioFinished = false;

		this.audio?.playLevelMusic?.(this.selectedLevelNumber, this.level?.music);
        this.startHatchAnimations();
        this.state = 'playing';
        this.returnAfterMenuState = 'playing';
        this.paused = false;
        console.log('Play cycle started: hatch opening');
    }

    updateCameraReturnToStart(isLogicTick = false) {
        const moveAxis = (current, target, speed) => {
            if (current === target) return current;
            const diff = target - current;
            if (Math.abs(diff) <= speed) return target;
            return current + Math.sign(diff) * speed;
        };

        // Cursor is hidden during the return trip. It reappears re-centred once
        // the camera has snapped back and the hatch-opening play cycle begins.
        this.cursor.setVisible(false);

        if (isLogicTick) {
            this.renderer.camera.x = moveAxis(this.renderer.camera.x, this.startCameraX, this.cameraReturnSpeed);
            this.renderer.camera.y = moveAxis(this.renderer.camera.y, this.startCameraY, this.cameraReturnSpeed);
        }

        if (this.renderer.camera.x === this.startCameraX && this.renderer.camera.y === this.startCameraY) {
            this.beginPlayStartDelay();
        }
    }

    updatePlayStartDelay(isLogicTick = false) {
		this.updatePauseSafeAnimations();
		this.clearSkillAssignmentBuffer();
		this.resetReleaseRateHold();

		if (!this.playStartLetsGoStarted) {
			if (isLogicTick) {
				this.preLetsGoDelayFrame++;

				if (this.preLetsGoDelayFrame >= this.PRE_LETSGO_DELAY_TICKS) {
					this.startLetsGoSequence();
				}
			}

			return true;
		}

		if (!this.playStartAudioPending && this.playStartAudioFinished) {
			this.beginPlayCycle();
		}

		return true;
	}

    updatePauseSafeAnimations() {
        // Keep presentation-layer animation clocks alive while interaction/simulation
        // are suspended by the pause/menu overlay. This deliberately does not move
        // lemmings, spawn new lemmings, advance release timers, or increment level time.
        this.updateHatchAnimations();

        if (this.tileAnimationManager) {
            this.tileAnimationManager.update();
        }

        if (this.trapAnimationManager) {
            this.trapAnimationManager.updateConstantAnimations();

            // If a trap animation was already playing when pause/menu was opened,
            // let the visible animation finish instead of freezing on a half-frame.
            // No lemmings move while paused, so no new traps are triggered here.
            this.trapAnimationManager.updateTriggeredTraps();
        }

        if (this.pngAnimationManager) {
            this.pngAnimationManager.updateConstantAnimations();
            this.pngAnimationManager.updateTriggeredAnimations();
        }

        // Do not advance lemming sprite frames here. During gameplay pause the
        // world must freeze completely; menus/briefing screens do not need live
        // lemming animation.
    }

    update() {
        if (!this.initialized) return;

        // Count display frames. SMS physics logic advances every 3rd display frame
        // (50 / 3 = 16.666...Hz). Cursor/HUD input stays responsive every display frame; camera
        // edge-scroll and preview snap-back only move on the logic gate.
        this.displayFrameCounter = (this.displayFrameCounter + 1) % this.LOGIC_FRAMES_PER_UPDATE;
        const isLogicTick = this.displayFrameCounter === 0;

        this.input.update();
        this.handleAudioHotkeys();
        this.handlePointerHudControlPress();
        this.updateSkillAssignmentButtonState();
        this.updatePauseMenuInputLock();

        if (this.updateScreenTransition()) {
            this.input.clearPresses();
            return;
        }

        if (this.state === 'startingPlay') {
            this.updatePlayStartDelay(isLogicTick);
            this.input.clearPresses();
            return;
        }

        const menuPressed = this.input.wasJustPressed('menu');
        if (menuPressed) {
            if (!this.isPauseMenuInputLocked() && !this.shouldIgnorePauseOrMenuInput()) {
                this.beginScreenTransition(() => this.showTitleScreen());
                this.input.clearPresses();
                return;
            }
            this.clearPauseMenuPresses();
        }

        if (this.state === 'title') {
            this.updatePauseSafeAnimations();
            this.handleTitleScreenInput();
            this.input.clearPresses();
            return;
        }

        if (this.state === 'credits') {
            this.updatePauseSafeAnimations();
            this.handleCreditsScreenInput();
            this.input.clearPresses();
            return;
        }

        if (this.state === 'levelInfo') {
            this.updatePauseSafeAnimations();

            if (this.input.wasJustPressed('left')) {
                this.beginScreenTransition(() => this.changeSelectedLevel(-1, 0));
            } else if (this.input.wasJustPressed('right')) {
                this.beginScreenTransition(() => this.changeSelectedLevel(1, 0));
            } else if (this.input.wasJustPressed('up')) {
                this.beginScreenTransition(() => this.changeSelectedLevel(0, -1));
            } else if (this.input.wasJustPressed('down')) {
                this.beginScreenTransition(() => this.changeSelectedLevel(0, 1));
            } else if (this.input.wasJustPressed('button1') || this.input.wasJustPressed('skill1')) {
                this.beginScreenTransition(() => this.startSelectedLevel('preview'));
            } else if (this.input.wasJustPressed('select') || this.input.wasJustPressed('skill2')) {
                this.beginScreenTransition(() => this.startSelectedLevel('play'));
            }

            this.input.clearPresses();
            return;
        }

        if (this.state === 'loadingLevel') {
            this.updatePauseSafeAnimations();
            this.input.clearPresses();
            return;
        }

        if (this.state === 'levelSuccess' || this.state === 'levelFailure') {
            this.updatePauseSafeAnimations();
            this.handleResultScreenInput();
            this.input.clearPresses();
            return;
        }

        if (this.state === 'preview') {
            this.updatePauseSafeAnimations();

            const skillCycleActive = this.updateSkillCycleMode();
            if (skillCycleActive) {
                this.input.clearPresses();
                return;
            }

            this.updateCursorForCurrentInputMode(isLogicTick);

            if (this.updateReleaseRateHold()) {
                this.input.clearPresses();
                return;
            }

            if (this.input.wasJustPressed('select')) {
                this.clearSkillAssignmentBuffer();

                if (this.handleHudSelectPress()) {
                    this.input.clearPresses();
                    return;
                }

                this.requestPlayFromBriefingOrPreview();
                this.input.clearPresses();
                return;
            }

            if (this.input.wasJustPressed('button1') ||
                this.input.wasJustPressed('skill1') || this.input.wasJustPressed('skill2')) {
                this.requestPlayFromBriefingOrPreview();
            }

            this.input.clearPresses();
            return;
        }

        if (this.state === 'returningToStart') {
            this.updatePauseSafeAnimations();
            this.updateCameraReturnToStart(isLogicTick);
            this.input.clearPresses();
            return;
        }

        // Button 1+Button 2 skill cycling must own those inputs before pause
        // handling gets a look in. It must not return from the main update loop,
        // though: only the cursor/HUD assignment controls freeze while the level
        // simulation and animations continue normally.
        const skillCycleActive = this.updateSkillCycleMode();

        this.updatePauseMenuInputLock();
        const pausePressed = this.input.wasJustPressed('pause');
        if (pausePressed) {
            if (!this.isPauseMenuInputLocked() && !this.shouldIgnorePauseOrMenuInput()) {
                this.paused = !this.paused;
                this.input.clearPresses();
                return;
            }
            this.clearPauseMenuPresses();
        }

        if (this.paused) {
            // SMS pause behaviour: simulation is frozen, but the crosshair can
            // still move, edge-scroll the camera, and interact with the HUD.
            this.updatePauseSafeAnimations();

            if (skillCycleActive) {
                this.input.clearPresses();
                return;
            }

            this.updateCursorForCurrentInputMode(isLogicTick);

            if (this.updateReleaseRateHold()) {
                this.clearSkillAssignmentBuffer();
                this.input.clearPresses();
                return;
            }

            if (this.skillAssignmentButtonJustPressed) {
                if (this.handleHudSelectPress()) {
                    this.clearSkillAssignmentBuffer();
                } else {
                    this.queueSkillAssignmentBuffer();
                }
            }

            // Assignments are deliberately not executed while paused, but the
            // pending Button 2 press is preserved for unpause if it is still held.
            this.input.clearPresses();
            return;
        }

        if (!skillCycleActive) {
            this.handleReleaseRateHotkeys();

            if (this.input.wasJustPressed('speedUp')) this.toggleSpeedMultiplier();

            this.updateCursorForCurrentInputMode(isLogicTick);

            const releaseRateHandled = this.updateReleaseRateHold();
			const nukeControlHandled = !releaseRateHandled && this.updateNukeControl(isLogicTick);

			if (releaseRateHandled || nukeControlHandled) {
				this.clearSkillAssignmentBuffer();
			} else {
                if (this.skillAssignmentButtonJustPressed) {
                    if (this.handleHudSelectPress()) {
                        this.clearSkillAssignmentBuffer();
                    } else {
                        this.queueSkillAssignmentBuffer();
                    }
                }

                this.updateSkillAssignmentBuffer(isLogicTick);
            }
        } else {
            this.resetReleaseRateHold();
            this.clearSkillAssignmentBuffer();
        }

        // Update hatch animations
        this.updateHatchAnimations();

        // Update tile animations (torches, water, constant trap loops, etc.)
        if (this.tileAnimationManager) {
            this.tileAnimationManager.update();
        }
        if (this.trapAnimationManager) {
            this.trapAnimationManager.updateConstantAnimations();
            // Triggered trap animations are visual-only timing; run at 50Hz so
            // frameDelay=7 gives the original ~8.6fps trap animation rate.
            this.trapAnimationManager.updateTriggeredTraps();
        }
        if (this.pngAnimationManager) {
            this.pngAnimationManager.updateConstantAnimations();
            this.pngAnimationManager.updateTriggeredAnimations();
        }

        // Advance lemming sprite animations every display frame (50Hz).
        // frameDelay=4 -> 12.5fps animations at the current PAL display rate.
        for (const lemming of this.lemmings) {
            lemming.updateAnimation();
        }

        // Physics, spawning, and timers only advance on logic ticks (every 3rd
        // display frame = 16.666...Hz), matching the current SMS-feel pacing.
        if (isLogicTick) {
		for (let i = 0; i < this.speedMultiplier; i++) {

			this.updateNukeCascade();

			// Handle Spawning with the countdown quirk
            if (this.stats.lemmingsLeftToSpawn > 0 && this.areHatchAnimationsFinished()) {
                this.spawnTimer++;
                if (this.spawnTimer >= this.spawnInterval) {
                    this.spawnLemming();
                    this.spawnTimer = 0; // Reset for next lemming
                }
            }

			// Dynamic blockers are deliberately exposed as a side-list,
            // not as terrain. Only walker/builder logic opts into this list,
            // so fallers, floaters, climbers, bashers, miners, and diggers
            // pass through blockers like the SMS original.
            this.level.activeBlockers = this.lemmings.filter(lemming =>
                lemming.state === 'blocking'
            );

            for (const lemming of this.lemmings) {
                const prevState = lemming.state;
                const prevBuildCount = lemming.buildCount || 0;
                const wasBomberBangVisible = lemming.isBomberBangVisible?.() === true;

                // Advance the bomber pre-ignition fuse for any armed lemming
                // that has not yet entered the active exploding state.
                // Mirrors the ix+10/ix+16 countdown in _LABEL_2DA9_/_LABEL_367F_.
                if (lemming.fuseValue > 0 && lemming.state !== 'exploding') {
                    lemming.updateBomberFuse();
                }

			lemming.update(this.level);

				if (prevState !== 'splatting' && lemming.state === 'splatting') {
					this.audio?.playSplat?.();
				}

                if (prevState !== lemming.state &&
					lemming.state === 'drowning' &&
					lemming.lastHazardDeathType === 'water') {
					this.audio?.playSplash?.();
				}

				if (!wasBomberBangVisible && lemming.isBomberBangVisible?.()) {
					this.audio?.playBang?.();
				}

				if (prevState !== 'exiting' && lemming.state === 'exiting') {
					this.audio?.playGoal?.();
				}

                if ((lemming.buildCount || 0) > prevBuildCount &&
                    lemming.buildCount >= Math.max(1, (Physics.maxBricks || 12) - 3)) {
                    this.playChimeSfx();
                }

                this.handleTriggeredTrapForLemming(lemming);
				this.handleBottomOutForLemming(lemming);
                if (prevState !== 'saved' && lemming.state === 'saved') this.stats.lemmingsSaved++;
            }
            this.stats.timeElapsed++;
            const levelTimeTicks = Number(this.level?.time_minutes || 0) * 60 * (this.LOGIC_FPS || 20);
            if (levelTimeTicks > 0 && this.stats.timeElapsed >= levelTimeTicks) this.completeLevel();
            this.updateTimerWarningChime();
        }
            this.updateLevelEndCondition();
        } // end isLogicTick physics gate

        this.input.clearPresses();
    }

    updateTimerWarningChime() {
        if (this.state !== 'playing' || !this.level) return;

        const remaining = this.getRemainingTimeParts();
        if (remaining.minutes === 0 && remaining.seconds >= 1 && remaining.seconds <= 10) {
            if (this.lastTimerWarningSecond !== remaining.seconds) {
                this.lastTimerWarningSecond = remaining.seconds;
                this.playChimeSfx();
            }
            return;
        }

        this.lastTimerWarningSecond = null;
    }

    handleTriggeredTrapForLemming(lemming) {
        if (['dead', 'saved', 'exiting', 'drowning', 'burning'].includes(lemming.state)) return false;

        const feetX = Math.floor(lemming.x);
		const feetY = typeof lemming.getFootY === 'function'
			? lemming.getFootY()
			: Math.floor(lemming.y + lemming.height - 1);

        let trap = null;
        if (this.trapAnimationManager && this.level?.trapInstances?.length) {
			trap = this.trapAnimationManager.tryTriggerTrapAt(feetX, feetY);
        }
        if (!trap && this.pngAnimationManager) {
            trap = this.pngAnimationManager.tryTriggerTrapAt(feetX, feetY);
        }

        if (!trap) return false;

        // SMS behaviour: trap removes the lemming sprite immediately. The trap
        // animation plays in the level; the lemming itself is now out of play.
        lemming.clearBomberFuse?.();
		lemming.state = 'dead';
		lemming.vx = 0;
		lemming.vy = 0;
        return true;
    }
	
	handleBottomOutForLemming(lemming) {
		if (!lemming || !this.level) return false;

		// Already out of normal play; leave existing death/exit animations alone.
		if ([
			'dead',
			'saved',
			'exiting',
			'splatting',
			'drowning',
			'burning',
			'exploding'
		].includes(lemming.state)) {
			return false;
		}

		const levelBottomY = this.level.pixelHeight || (this.level.height * 8);

		// Once the lemming's anchor/top has passed below the playable level,
		// remove them from play immediately. This is not a splat animation.
		if (lemming.y >= levelBottomY) {
			lemming.state = 'dead';
			lemming.vx = 0;
			lemming.vy = 0;
			return true;
		}

		return false;
	}

    getNextEntranceForSpawn() {
        const entrances = this.getEntrancePositions();

        // The SMS increments the pointer before using it.
        this.spawnEntrancePointer++;
        if (this.spawnEntrancePointer >= entrances.length) {
            this.spawnEntrancePointer = 0;
        }

        return entrances[this.spawnEntrancePointer];
    }

    spawnLemming() {
        const entrance = this.getNextEntranceForSpawn();
        const spawnX = entrance ? entrance.x : 160;
        const spawnY = entrance ? entrance.y : 20;

        // Spawn centered at the TOP of the entrance tile
        this.lemmings.push(new Lemming(spawnX + 4, spawnY - 8, 1));

        this.stats.lemmingsLeftToSpawn--;
        this.stats.lemmingsOut++;
    }

    getAliveLemmingCount() {
        return this.lemmings.filter(lemming => !['dead', 'saved'].includes(lemming.state)).length;
    }

    getSavedPercent() {
        const total = Number(this.level?.num_lemmings || 0);
        if (total <= 0) return 0;
        return Math.round((this.stats.lemmingsSaved / total) * 100);
    }

    getRemainingTimeParts() {
        // stats.timeElapsed is counted on the logic gate, not every 50Hz
        // display frame. Use LOGIC_FPS here or the HUD timer runs 3x slow.
        const ticksPerSecond = this.LOGIC_FPS || 20;
        const totalTicks = Math.max(0, Number(this.level?.time_minutes || 0) * 60 * ticksPerSecond);
        const remainingTicks = Math.max(0, totalTicks - this.stats.timeElapsed);
        const totalSeconds = Math.floor(remainingTicks / ticksPerSecond);
        return {
            minutes: Math.floor(totalSeconds / 60),
            seconds: totalSeconds % 60
        };
    }

    getLevelHudInfo() {
        if (!this.level || this.state === 'levelInfo' || this.state === 'loadingLevel' ||
            this.state === 'levelSuccess' || this.state === 'levelFailure' ||
            this.state === 'title' || this.state === 'credits') {
            return null;
        }

        const time = this.getRemainingTimeParts();
        const selectedSkill = this.getSelectedSkill();

        return {
            mode: this.state === 'preview' ? 'preview' : 'play',
            out: this.getAliveLemmingCount(),
            inPercent: this.getSavedPercent(),
            minutes: time.minutes,
            seconds: time.seconds,
            stackCount: this.cursor?.hoverStackCount ?? 0,
            releaseRate: this.releaseRate,
            mouseControlsEnabled: this.mouseControlsEnabled,
            volumeStage: this.audio?.getVolumeStage?.() || 'loud',
            paused: this.paused,
            speedMultiplier: this.speedMultiplier,
            hudPauseToggleTile: this.getHudPauseToggleTile(),
            hudSpeedToggleTile: this.getHudSpeedToggleTile(),
            hudMouseToggleTile: this.getHudMouseToggleTile(),
            hudVolumeToggleTile: this.getHudVolumeToggleTile(),
            skillCounts: { ...this.skillCounts },
            selectedSkillId: selectedSkill?.id ?? null,
            closeupSkillId: this.getCloseupSkillIdForLemming(this.cursor?.hoveredLemming)
        };
    }

    render() {
        if (!this.initialized) return;
        this.renderer.clear();
        if (this.level) {
            this.renderer.beginPlayfieldClip();
            const isPngLevel = this.level.terrainMode === 'png';
            if (isPngLevel) {
                // PNG levels use their terrain PNG as the absolute backplate.
                // Draw it before every overlay/object layer so hatches, goals,
                // traps, hazards, decorative objects, and lemmings can never
                // end up hidden behind the base image.
                this.renderer.drawPngTerrainBackplate?.(this.level);
            }
            this.renderer.drawLevel(
                this.level,
                this.tilesetManager,
                this.tileAnimationManager,
                this.trapAnimationManager,
                isPngLevel ? { skipPngTerrainBackplate: true } : undefined
            );

            if (this.pngAnimationManager) {
                this.pngAnimationManager.draw(
                    this.renderer.ctx,
                    this.renderer.camera.x,
                    this.renderer.camera.y,
                    { maxZ: 99 }
                );
            }

            // INI-triggered trap instances draw over the level. Frame 0 is drawn
            // even while idle, so it overwrites the underlying level tiles.
            if (this.trapAnimationManager) {
                this.trapAnimationManager.drawTrapInstances(
                    this.renderer.ctx,
                    this.renderer.camera.x,
                    this.renderer.camera.y
                );
            }

            // Draw hatch animations (after terrain, before lemmings)
            for (const hatch of this.hatchAnimations) {
				hatch.draw(
					this.renderer.ctx, 
					this.renderer.camera.x, 
					this.renderer.camera.y
				);
			}

			// Builder bridges are live terrain and should sit above level art,
			// hatches, and trap animations, but below lemming sprites.
			this.renderer.drawTerrainAdditions(this.level);

			this.renderer.drawLemmings(this.lemmings);

            if (this.pngAnimationManager) {
                this.pngAnimationManager.draw(
                    this.renderer.ctx,
                    this.renderer.camera.x,
                    this.renderer.camera.y,
                    { minZ: 100 }
                );
            }

            if (this.cursor?.updateLemmingStack) {
                this.cursor.updateLemmingStack(this.lemmings);
            }
            this.renderer.endPlayfieldClip();
        }

        if (this.state === 'title') {
            this.renderer.drawTitleScreen(this.getTitleRenderData());
        } else if (this.state === 'credits') {
            this.renderer.drawCreditsScreen(this.getCreditsRenderData());
        } else if (this.state === 'levelInfo' || this.state === 'loadingLevel') {
            this.renderer.drawLevelInfoScreen(this.getLevelInfoRenderData());
        } else if (this.state === 'levelSuccess' || this.state === 'levelFailure') {
            this.renderer.drawLevelResultScreen(this.levelResult);
        } else {
            this.renderer.drawLevelHud(this.getLevelHudInfo());
            this.renderer.drawCursor(this.cursor, this.cursorImages);
        }

        this.renderer.drawFadeOverlay(this.getFadeAlpha());
        this.updateHUD();
    }

    updateHUD() {
        // Legacy DOM debug HUD is optional/removed in the canvas-only public view.
        const hudElement = document.getElementById('hud');
        const outElement = document.getElementById('out');
        const savedElement = document.getElementById('saved');
        const timeElement = document.getElementById('time');

        if (!hudElement || !outElement || !savedElement || !timeElement) {
            return;
        }

        const levelNameElement = document.getElementById('levelName');
        if (levelNameElement) {
            if (this.level) levelNameElement.textContent = this.level.name || 'Unknown';
            else if (this.state === 'levelInfo') levelNameElement.textContent = this.getSelectedLevelId();
        }

        outElement.textContent = this.getAliveLemmingCount();
        savedElement.textContent = this.stats.lemmingsSaved;
        timeElement.textContent = Utils.formatTime(this.stats.timeElapsed);

        let spawnStatus = document.getElementById('spawnStatus');
        if (!spawnStatus) {
            spawnStatus = document.createElement('div');
            spawnStatus.id = 'spawnStatus';
            hudElement.appendChild(spawnStatus);
        }

        const entranceCount = this.level?.entrancePositions?.length || 0;
        const exitCount = this.level?.exitPositions?.length || 0;
        const selectedSkill = this.getSelectedSkill();
        const selectedSkillText = selectedSkill
            ? `${selectedSkill.label}: ${this.skillCounts[selectedSkill.id] ?? 0}`
            : 'No skill';

        const flowText = this.state === 'title' ? 'TITLE' : this.state === 'credits' ? 'CREDITS' : this.state === 'levelInfo' ? 'LEVEL SELECT' : this.state === 'loadingLevel' ? 'LOADING' : this.state === 'levelSuccess' ? 'SUCCESS' : this.state === 'levelFailure' ? 'FAILURE' : this.state === 'preview' ? 'PREVIEW' : this.state === 'returningToStart' ? 'RETURNING' : this.state === 'startingPlay' ? "LET'S GO" : this.paused ? 'PAUSED' : 'PLAY';
        spawnStatus.textContent = `State: ${flowText} | Rate: ${this.releaseRate} | Left: ${this.stats.lemmingsLeftToSpawn} | ${selectedSkillText} | Entrances: ${entranceCount} | Exits: ${exitCount}`;
    }
}

