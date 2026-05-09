// AI Test Pilot overlay, watcher, and controller-driver prototype.
// Step 9 defaults to curiosity/discovery mode: fewer hard-coded solutions,
// more poke/observe/learn loops through normal controller input.
// Enable with ?ai=1 or ?bot=1. From step 4, this starts the controller/player
// pilot by default; add ?aiWatch=1 or ?aiMode=watcher for read-only watching.
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search || '');
    const aiEnabled = params.has('ai') || params.has('bot') || params.get('debug') === 'ai';
    const canvasHudEnabled = params.has('aiCanvasHud');
    const startupDemoSkill = cleanSkillName(params.get('aiDemo') || params.get('botDemo') || params.get('aiSkill') || '');
    const controlParam = String(params.get('aiMode') || '').toLowerCase();
    const watchOnly = params.has('aiWatch') || params.has('aiWatcher') || params.has('botWatch') ||
        controlParam === 'watch' || controlParam === 'watcher' || controlParam === 'observe' || controlParam === 'observer';
    // From step 4 onward, ?ai=1 means "let the AI player try" by default.
    // Use ?aiWatch=1 if you only want the read-only spectator/debug layer.
    const startupControlEnabled = aiEnabled && !watchOnly;
    const requestedAiSpeed = Math.max(1, Math.floor(Number(params.get('aiSpeed') || '4')));
    const aiSpeedEnabled = params.get('aiSpeed') !== '0';
    const aiLearningEnabled = params.get('aiLearn') !== '0';
    const aiBrainMode = String(params.get('aiBrain') || 'discover').toLowerCase();
    const aiExperimentGap = Math.max(20, Math.floor(Number(params.get('aiExperimentGap') || '160')));
    const learningStorageKey = 'lemmings-ai-test-pilot-skill-learning-v1';
    const levelMemoryStorageKey = 'lemmings-ai-test-pilot-level-memory-v1';

    const ACTIVE_STATES = new Set([
        'falling',
        'walking',
        'climbing',
        'floating',
        'building',
        'shrugging',
        'bashing',
        'mining',
        'digging',
        'blocking',
        'exploding',
        'drowning',
        'burning',
        'splatting',
        'exiting'
    ]);

    const CONTROLLABLE_STATES = new Set([
        'walking',
        'falling',
        'floating',
        'climbing',
        'building',
        'shrugging',
        'bashing',
        'mining',
        'digging',
        'blocking'
    ]);

    const TERMINAL_STATES = new Set([
        'dead',
        'saved',
        'exiting',
        'drowning',
        'burning',
        'splatting'
    ]);

    const SKILL_PRIORITY = [
        'digger',
        'builder',
        'basher',
        'miner',
        'blocker',
        'floater',
        'climber',
        'bomber'
    ];

    function cleanSkillName(skill) {
        return String(skill || '').trim().toLowerCase();
    }

    function getLemmingId(lemming) {
        return lemming?.aiId ?? lemming?.id ?? null;
    }

    function formatTick(tick) {
        return String(Math.max(0, Math.floor(Number(tick) || 0))).padStart(5, '0');
    }

    function clampText(text, length) {
        const value = String(text || '');
        return value.length > length ? `${value.slice(0, Math.max(0, length - 1))}…` : value;
    }

    function safeNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function getSkillLabel(skill) {
        const value = cleanSkillName(skill);
        return value ? value.toUpperCase() : 'SKILL';
    }

    function makeEmptyLearningJournal() {
        return {
            version: 1,
            updatedAt: null,
            skills: {}
        };
    }

    function installVirtualInputPatch() {
        if (typeof InputHandler === 'undefined' || InputHandler.prototype.__lemmingsAiVirtualInputPatched) return;
        InputHandler.prototype.__lemmingsAiVirtualInputPatched = true;

        const originalIsPressed = InputHandler.prototype.isPressed;
        const originalWasJustPressed = InputHandler.prototype.wasJustPressed;
        const originalPeekJustPressed = InputHandler.prototype.peekJustPressed;
        const originalClearPress = InputHandler.prototype.clearPress;
        const originalClearPresses = InputHandler.prototype.clearPresses;
        const originalResetAllHeldInputs = InputHandler.prototype.resetAllHeldInputs;

        InputHandler.prototype.ensureAiVirtualInput = function ensureAiVirtualInput() {
            if (!this.aiVirtualHeld) this.aiVirtualHeld = {};
            if (!this.aiVirtualPressed) this.aiVirtualPressed = {};
        };

        InputHandler.prototype.setAiVirtualAction = function setAiVirtualAction(action, held, justPressed = false) {
            this.ensureAiVirtualInput();
            if (!action) return;
            this.aiVirtualHeld[action] = !!held;
            if (justPressed) this.aiVirtualPressed[action] = true;
        };

        InputHandler.prototype.clearAiVirtualActions = function clearAiVirtualActions() {
            this.aiVirtualHeld = {};
            this.aiVirtualPressed = {};
        };

        InputHandler.prototype.clearAiVirtualHeld = function clearAiVirtualHeld() {
            this.aiVirtualHeld = {};
        };

        InputHandler.prototype.isPressed = function patchedAiIsPressed(action) {
            this.ensureAiVirtualInput();
            return !!this.aiVirtualHeld[action] || originalIsPressed.call(this, action);
        };

        InputHandler.prototype.wasJustPressed = function patchedAiWasJustPressed(action) {
            this.ensureAiVirtualInput();
            if (this.aiVirtualPressed[action]) {
                delete this.aiVirtualPressed[action];
                return true;
            }
            return originalWasJustPressed.call(this, action);
        };

        InputHandler.prototype.peekJustPressed = function patchedAiPeekJustPressed(action) {
            this.ensureAiVirtualInput();
            return !!this.aiVirtualPressed[action] || originalPeekJustPressed.call(this, action);
        };

        InputHandler.prototype.clearPress = function patchedAiClearPress(action) {
            this.ensureAiVirtualInput();
            delete this.aiVirtualPressed[action];
            return originalClearPress.call(this, action);
        };

        InputHandler.prototype.clearPresses = function patchedAiClearPresses(...args) {
            const result = originalClearPresses.apply(this, args);
            this.ensureAiVirtualInput();
            this.aiVirtualPressed = {};
            return result;
        };

        InputHandler.prototype.resetAllHeldInputs = function patchedAiResetAllHeldInputs(...args) {
            const result = originalResetAllHeldInputs.apply(this, args);
            this.aiVirtualHeld = {};
            this.aiVirtualPressed = {};
            return result;
        };
    }

    function getCanvasRectParts(game) {
        const renderer = game?.renderer;
        const canvas = renderer?.canvas;
        if (!renderer || !canvas || typeof canvas.getBoundingClientRect !== 'function') return null;

        const canvasRect = canvas.getBoundingClientRect();
        const container = document.getElementById('game-container') || canvas.parentElement || document.body;
        const containerRect = container.getBoundingClientRect();
        const logicalWidth = renderer.logicalWidth || canvas.width || 336;
        const logicalHeight = renderer.logicalHeight || canvas.height || 192;
        const scaleX = canvasRect.width / logicalWidth;
        const scaleY = canvasRect.height / logicalHeight;

        return {
            container,
            canvasRect,
            containerRect,
            scaleX,
            scaleY,
            left: canvasRect.left - containerRect.left,
            top: canvasRect.top - containerRect.top,
            logicalWidth,
            logicalHeight
        };
    }

    class LemmingsAiPilot {
        constructor(game) {
            this.game = game;
            this.enabled = aiEnabled;
            this.controlEnabled = startupControlEnabled;
            this.mode = this.controlEnabled ? 'controller boot' : 'watching';
            this.events = [];
            this.maxEvents = 220;
            this.nextLemmingId = 1;
            this.lastLevelKey = null;
            this.lastGameState = null;
            this.lastObservedTick = -1;
            this.lastLemmingSnapshots = new Map();
            this.lastSignals = new Map();
            this.commandQueue = [];
            this.nextCommandId = 1;
            this.targetId = null;
            this.advice = 'waiting for game';
            this.screenRead = 'waiting';
            this.inputRead = 'none';
            this.actionMarkers = [];
            this.scriptName = null;
            this.scriptLoaded = false;
            this.startupDemoSkill = startupDemoSkill;
            this.driverCooldown = 18;
            this.driverFrame = 0;
            this.driverGoal = startupDemoSkill ? `try ${startupDemoSkill}, then discover what happens` : 'discover level rules by experimenting';
            this.driverTask = null;
            this.driverHold = null;
            this.driverLastInfoId = null;
            this.driverLastSkillSnapshot = '';
            this.driverLastResultKey = null;
            this.driverAttempts = [];
            this.driverSkillAttemptCounts = new Map();
            this.driverMaxAttempts = safeNumber(params.get('aiMaxAttempts'), 24);
            this.driverStartViaPreview = params.get('aiDirectPlay') !== '1';
            this.lastVirtualAction = 'none';
            this.manualCursorTarget = null;
            this.aiSpeed = requestedAiSpeed;
            this.aiSpeedEnabled = aiSpeedEnabled;
            this.learningEnabled = aiLearningEnabled;
            this.learningJournal = this.loadLearningJournal();
            this.learningObservations = [];
            this.learningRecent = [];
            this.levelMemory = this.loadLevelMemory();
            this.levelRunSerial = 0;
            this.lastWorldAnalysis = null;
            this.lastWorldAnalysisTick = -9999;
            this.lastRecordedResultKey = null;
            this.brainMode = aiBrainMode;
            this.sessionSeed = Math.floor(Math.random() * 1000000);
            this.targetRotation = Math.floor(Math.random() * 97);
            this.abortedTaskKeys = new Set();
            this.nextExperimentFrame = 0;
            this.lastExperimentSkill = '';
            this.lastExperimentOutcome = 'none yet';
            this.experimentGap = aiExperimentGap;

            this.installDomOverlay();
            this.log(this.controlEnabled
                ? 'AI Test Pilot enabled - controller/player mode'
                : 'AI Test Pilot enabled - watcher-only mode');
            this.publishApi();
        }

        publishApi() {
            window.lemmingsAI = {
                pilot: this,
                getState: () => this.getState(),
                getEvents: () => [...this.events],
                clearEvents: () => {
                    this.events = [];
                    this.updateDomOverlay();
                },
                enableControl: (skill = '') => {
                    const clean = cleanSkillName(skill);
                    if (clean) this.startupDemoSkill = clean;
                    this.controlEnabled = true;
                    this.mode = 'controller boot';
                    this.driverCooldown = 6;
                    this.log(`Controller mode enabled${clean ? ` for ${clean.toUpperCase()}` : ''}`, 'action');
                    return true;
                },
                disableControl: () => {
                    this.controlEnabled = false;
                    this.driverTask = null;
                    this.driverHold = null;
                    this.releaseVirtualInput();
                    this.mode = 'watching';
                    this.log('Controller mode disabled');
                    return true;
                },
                setGoalSkill: (skill) => {
                    this.startupDemoSkill = cleanSkillName(skill);
                    this.driverGoal = this.startupDemoSkill ? `try ${this.startupDemoSkill}` : 'try available skills';
                    this.driverTask = null;
                    this.log(`Goal skill set to ${this.startupDemoSkill || 'auto'}`, 'action');
                    return this.startupDemoSkill;
                },
                moveCursorTo: (x, y) => {
                    this.manualCursorTarget = { x: safeNumber(x), y: safeNumber(y) };
                    this.controlEnabled = true;
                    this.log(`Manual cursor target ${Math.round(this.manualCursorTarget.x)},${Math.round(this.manualCursorTarget.y)}`, 'action');
                    return true;
                },
                tap: (action) => this.forceTap(action, 'console tap'),
                hold: (action, frames = 8) => this.startHold(action, frames, `console hold ${action}`),
                enqueueCommand: (command) => this.enqueueCommand(command),
                loadScript: (commands, options = {}) => this.loadScript(commands, options),
                clearScript: () => this.clearScript(),
                getScript: () => this.commandQueue.map(command => ({ ...command })),
                getLearning: () => JSON.parse(JSON.stringify(this.learningJournal || makeEmptyLearningJournal())),
                getWorld: () => this.analyzeWorld(true),
                getLevelMemory: () => JSON.parse(JSON.stringify(this.levelMemory || {})),
                setBrain: (mode = 'discover') => {
                    this.brainMode = String(mode || 'discover').toLowerCase();
                    this.driverGoal = this.brainMode === 'goal' ? 'goal-plan from hatch to exit' : 'discover level rules by experimenting';
                    this.driverTask = null;
                    this.log(`AI brain mode set to ${this.brainMode}`, 'action');
                    return this.brainMode;
                },
                setExperimentGap: (frames = 160) => {
                    this.experimentGap = Math.max(20, Math.floor(safeNumber(frames, 160)));
                    this.log(`AI experiment observation gap set to ${this.experimentGap} frames`, 'action');
                    return this.experimentGap;
                },
                clearLearning: () => {
                    this.learningJournal = makeEmptyLearningJournal();
                    this.learningRecent = [];
                    this.saveLearningJournal();
                    this.log('Learning journal cleared', 'action');
                    return true;
                },
                setSpeed: (speed = 4) => {
                    this.aiSpeed = Math.max(1, Math.floor(safeNumber(speed, 4)));
                    this.aiSpeedEnabled = this.aiSpeed > 1;
                    this.log(`AI speed target set to ${this.aiSpeed}x`, 'action');
                    return this.aiSpeed;
                },
                demo: (skill = 'digger') => {
                    this.startupDemoSkill = cleanSkillName(skill || 'digger');
                    this.controlEnabled = true;
                    this.driverGoal = `try ${this.startupDemoSkill}`;
                    this.driverTask = null;
                    this.driverCooldown = 6;
                    this.log(`Controller demo armed for ${this.startupDemoSkill.toUpperCase()}`, 'action');
                    return true;
                }
            };
        }

        installDomOverlay() {
            if (!this.enabled || typeof document === 'undefined') return;
            if (document.getElementById('lemmings-ai-dom-overlay')) {
                this.dom = {
                    root: document.getElementById('lemmings-ai-dom-overlay'),
                    status: document.getElementById('lemmings-ai-status-panel'),
                    events: document.getElementById('lemmings-ai-event-panel'),
                    markers: document.getElementById('lemmings-ai-marker-layer')
                };
                return;
            }

            const style = document.createElement('style');
            style.id = 'lemmings-ai-dom-style';
            style.textContent = `
                #lemmings-ai-dom-overlay {
                    position: absolute;
                    inset: 0;
                    z-index: 40;
                    pointer-events: none;
                    font-family: Consolas, 'Courier New', monospace;
                    color: #fff;
                    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
                }
                #lemmings-ai-dom-overlay .ai-panel {
                    position: absolute;
                    background: rgba(0, 0, 0, 0.78);
                    border: 1px solid rgba(255, 255, 255, 0.62);
                    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
                    border-radius: 7px;
                    padding: 8px 10px;
                    line-height: 1.28;
                    font-size: clamp(12px, 1.45vw, 16px);
                    letter-spacing: 0.01em;
                    max-width: min(520px, calc(100vw - 24px));
                    white-space: nowrap;
                }
                #lemmings-ai-status-panel { left: 10px; top: 10px; }
                #lemmings-ai-event-panel { right: 10px; top: 10px; min-width: min(420px, calc(100vw - 24px)); }
                #lemmings-ai-dom-overlay .ai-title {
                    font-weight: 700;
                    font-size: clamp(14px, 1.7vw, 18px);
                    margin-bottom: 4px;
                }
                #lemmings-ai-dom-overlay .ai-row { display: flex; gap: 8px; align-items: baseline; }
                #lemmings-ai-dom-overlay .ai-label { color: rgba(255, 255, 255, 0.68); min-width: 76px; }
                #lemmings-ai-dom-overlay .ai-value { color: #fff; }
                #lemmings-ai-dom-overlay .ai-muted { color: rgba(255, 255, 255, 0.70); }
                #lemmings-ai-dom-overlay .ai-action { color: #ffe86a; }
                #lemmings-ai-dom-overlay .ai-warn { color: #ff9b86; }
                #lemmings-ai-dom-overlay .ai-learning { color: #a9f3ff; }
                #lemmings-ai-marker-layer { position: absolute; inset: 0; overflow: hidden; }
                #lemmings-ai-dom-overlay .ai-lemming-marker {
                    position: absolute;
                    transform: translate(-50%, -100%);
                    font-size: clamp(11px, 1.2vw, 14px);
                    font-weight: 700;
                    padding: 1px 5px;
                    border-radius: 999px;
                    background: rgba(0, 0, 0, 0.68);
                    border: 1px solid rgba(255, 255, 255, 0.45);
                    color: rgba(255, 255, 255, 0.96);
                }
                #lemmings-ai-dom-overlay .ai-lemming-marker.ai-target {
                    color: #111;
                    background: rgba(255, 232, 106, 0.96);
                    border-color: rgba(255, 255, 255, 0.9);
                    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55), 0 0 10px rgba(255, 232, 106, 0.55);
                }
                #lemmings-ai-dom-overlay .ai-lemming-box {
                    position: absolute;
                    transform: translate(-50%, -50%);
                    width: 18px;
                    height: 18px;
                    border: 2px solid rgba(255, 232, 106, 0.95);
                    border-radius: 4px;
                    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.75);
                }
                #lemmings-ai-dom-overlay .ai-cursor-target {
                    position: absolute;
                    transform: translate(-50%, -50%);
                    width: 16px;
                    height: 16px;
                    border: 2px dashed rgba(127, 220, 255, 0.95);
                    border-radius: 50%;
                    box-shadow: 0 0 8px rgba(127, 220, 255, 0.5);
                }
                #lemmings-ai-dom-overlay .ai-action-marker {
                    position: absolute;
                    transform: translate(-50%, -100%);
                    font-size: clamp(12px, 1.2vw, 15px);
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 5px;
                    background: rgba(255, 232, 106, 0.96);
                    color: #111;
                    border: 1px solid rgba(0, 0, 0, 0.55);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
                }
            `;
            document.head.appendChild(style);

            const root = document.createElement('div');
            root.id = 'lemmings-ai-dom-overlay';

            const status = document.createElement('div');
            status.id = 'lemmings-ai-status-panel';
            status.className = 'ai-panel';

            const events = document.createElement('div');
            events.id = 'lemmings-ai-event-panel';
            events.className = 'ai-panel';

            const markers = document.createElement('div');
            markers.id = 'lemmings-ai-marker-layer';

            root.appendChild(markers);
            root.appendChild(status);
            root.appendChild(events);

            const container = document.getElementById('game-container') || document.body;
            if (getComputedStyle(container).position === 'static') {
                container.style.position = 'relative';
            }
            container.appendChild(root);

            this.dom = { root, status, events, markers };
        }

        getTick() {
            return Number(this.game?.stats?.timeElapsed || 0);
        }

        getDisplayFrame() {
            return safeNumber(this.game?.displayFrameCounter, 0);
        }

        getLevelKey() {
            const game = this.game;
            if (!game?.level) return null;
            return String(game.currentLevelName || game.selectedLevelInfoId || game.level?.name || 'loaded-level');
        }

        resetForLevel(levelKey) {
            this.nextLemmingId = 1;
            this.targetId = null;
            this.advice = 'watching level start';
            this.lastLemmingSnapshots.clear();
            this.lastSignals.clear();
            this.actionMarkers = [];
            this.clearScript(false);
            this.driverTask = null;
            this.driverAttempts = [];
            this.driverSkillAttemptCounts = new Map();
            this.learningObservations = [];
            this.nextExperimentFrame = this.driverFrame + 20;
            this.lastExperimentSkill = '';
            this.lastExperimentOutcome = 'new level';
            this.abortedTaskKeys = new Set();
            this.levelRunSerial = this.getLevelMemoryEntry(levelKey).runs || 0;
            this.targetRotation = Math.floor(Math.random() * 97) + this.levelRunSerial * 31;
            this.lastWorldAnalysis = null;
            this.lastWorldAnalysisTick = -9999;
            this.lastLevelKey = levelKey;
            this.log(`Loaded ${levelKey}`);
        }

        log(text, type = 'info') {
            const entry = {
                tick: this.getTick(),
                text: String(text || ''),
                type
            };
            this.events.push(entry);
            if (this.events.length > this.maxEvents) {
                this.events.splice(0, this.events.length - this.maxEvents);
            }
            if (type === 'warn' || type === 'action') {
                console.log(`[AI ${formatTick(entry.tick)}] ${entry.text}`);
            }
            return entry;
        }

        beforeUpdate() {
            if (!this.enabled) return;
            this.installDomOverlay();
            this.releaseVirtualInput();
            this.driverFrame++;
            this.lastVirtualAction = 'none';
            if (this.driverCooldown > 0) this.driverCooldown--;
            if (this.driverHold) this.applyHeldAction();
            if (this.controlEnabled && !this.driverHold) this.driveController();
            this.updateDomOverlay();
        }

        afterUpdate() {
            if (!this.enabled) return;

            const levelKey = this.getLevelKey();
            if (!levelKey) {
                if (this.lastLevelKey !== null) {
                    this.lastLevelKey = null;
                    this.lastLemmingSnapshots.clear();
                    this.lastSignals.clear();
                    this.targetId = null;
                    this.advice = 'waiting for level';
                }
                this.observeGameStateOnly();
                this.expireActionMarkers();
                this.updateDomOverlay();
                return;
            }

            if (levelKey !== this.lastLevelKey) this.resetForLevel(levelKey);
            this.observeGameStateOnly();
            this.ensureLemmingIds();
            this.observeLemmings();
            this.chooseTarget();
            this.runQueuedCommands();
            this.updateLearningObservations();
            this.expireActionMarkers();
            this.lastObservedTick = this.getTick();
            this.updateDomOverlay();
        }

        afterRender() {
            if (!this.enabled) return;
            this.updateDomOverlay();
            if (canvasHudEnabled || !this.dom?.root) this.drawCanvasOverlay();
        }

        observeGameStateOnly() {
            if (this.lastGameState !== this.game?.state) {
                this.log(`Game state: ${this.lastGameState || 'none'} -> ${this.game?.state || 'none'}`);
                this.lastGameState = this.game?.state || null;
            }
        }

        releaseVirtualInput() {
            const input = this.game?.input;
            if (!input) return;
            if (typeof input.clearAiVirtualHeld === 'function') {
                input.clearAiVirtualHeld();
            } else {
                input.aiVirtualHeld = {};
            }
        }

        setVirtualAction(action, held = true, justPressed = false, reason = '') {
            const input = this.game?.input;
            if (!input || !action) return false;
            if (typeof input.setAiVirtualAction === 'function') {
                input.setAiVirtualAction(action, held, justPressed);
            } else {
                input.aiVirtualHeld = input.aiVirtualHeld || {};
                input.aiVirtualPressed = input.aiVirtualPressed || {};
                input.aiVirtualHeld[action] = held;
                if (justPressed) input.aiVirtualPressed[action] = true;
            }
            this.lastVirtualAction = `${justPressed ? 'tap' : 'hold'} ${action}${reason ? ` - ${reason}` : ''}`;
            return true;
        }

        forceTap(action, reason = 'tap') {
            this.setVirtualAction(action, true, true, reason);
            this.driverCooldown = Math.max(this.driverCooldown, 5);
            this.log(`Controller tapped ${action}: ${reason}`, 'action');
            return true;
        }

        tap(action, reason = 'tap', cooldown = 8) {
            if (this.driverCooldown > 0) return false;
            this.setVirtualAction(action, true, true, reason);
            this.driverCooldown = Math.max(1, cooldown);
            this.log(`Controller tapped ${action}: ${reason}`, 'action');
            return true;
        }

        startHold(action, frames = 8, reason = 'hold') {
            const safeFrames = Math.max(1, Math.floor(safeNumber(frames, 1)));
            this.driverHold = {
                action,
                framesRemaining: safeFrames,
                justPressed: true,
                reason
            };
            this.applyHeldAction();
            this.log(`Controller holding ${action} for ${safeFrames} frames: ${reason}`, 'action');
            return true;
        }

        applyHeldAction() {
            if (!this.driverHold) return false;
            const hold = this.driverHold;
            this.setVirtualAction(hold.action, true, hold.justPressed, hold.reason);
            hold.justPressed = false;
            hold.framesRemaining--;
            if (hold.framesRemaining <= 0) {
                this.driverHold = null;
                this.driverCooldown = Math.max(this.driverCooldown, 4);
            }
            return true;
        }

        normalizeGameState(state) {
            const value = String(state || '').trim();
            const aliases = {
                menu: 'title',
                titleScreen: 'title',
                briefing: 'levelInfo',
                levelSelect: 'levelInfo',
                levelInfoScreen: 'levelInfo',
                previewScreen: 'preview',
                play: 'playing',
                success: 'levelSuccess',
                failure: 'levelFailure'
            };
            return aliases[value] || value;
        }

        driveController() {
            const game = this.game;
            if (!game) {
                this.mode = 'controller boot';
                this.advice = 'waiting for game object';
                return;
            }

            const rawState = String(game.state || '').trim();
            const normalizedState = this.normalizeGameState(rawState);

            if (!game.initialized) {
                this.mode = 'controller boot';
                this.screenRead = rawState ? `state visible before init: ${rawState}` : 'no game state yet';
                this.advice = rawState
                    ? `waiting for initialisation to finish before driving ${rawState}`
                    : 'waiting for game initialisation';
                return;
            }

            if (this.manualCursorTarget && (normalizedState === 'playing' || normalizedState === 'preview')) {
                this.mode = 'manual cursor drive';
                const arrived = this.driveCursorToWorld(this.manualCursorTarget.x, this.manualCursorTarget.y, 2, 'manual cursor target');
                if (arrived) this.advice = `cursor reached ${Math.round(this.manualCursorTarget.x)},${Math.round(this.manualCursorTarget.y)}`;
                return;
            }

            if (game.screenTransition?.active || game.levelLoadInProgress || normalizedState === 'loadingLevel') {
                this.mode = 'controller waiting';
                this.advice = 'waiting for transition/loading';
                return;
            }

            if (normalizedState === 'title') {
                this.driveTitleScreen();
                return;
            }

            if (normalizedState === 'levelInfo') {
                this.driveLevelInfoScreen();
                return;
            }

            if (normalizedState === 'preview') {
                this.drivePreviewScreen();
                return;
            }

            if (normalizedState === 'returningToStart' || normalizedState === 'startingPlay') {
                this.mode = 'controller waiting';
                this.advice = `waiting during ${normalizedState}`;
                return;
            }

            if (normalizedState === 'playing') {
                this.drivePlaying();
                return;
            }

            if (normalizedState === 'levelSuccess' || normalizedState === 'levelFailure') {
                this.driveResultScreen(normalizedState);
                return;
            }

            this.mode = 'controller watching';
            this.advice = `no controller rule for ${rawState || normalizedState || 'unknown'}`;
        }

        driveTitleScreen() {
            const game = this.game;
            this.mode = 'menu pilot';
            this.screenRead = `title selector ${safeNumber(game.titleSelectorIndex, 0)}`;
            this.advice = 'navigating title screen to 1 PLAYER';

            if (safeNumber(game.titleSelectorIndex, 0) > 0) {
                this.tap('left', 'move title cursor toward 1 PLAYER');
                return;
            }

            this.tap('select', 'choose 1 PLAYER on title screen', 16);
        }

        driveLevelInfoScreen() {
            const game = this.game;
            const info = typeof game.getLevelInfoRenderData === 'function' ? game.getLevelInfoRenderData() : game.selectedLevelInfo;
            const title = String(info?.title || 'LOADING');
            const id = `${game.selectedLevelInfoId || game.getSelectedLevelId?.() || '?'}:${title}`;
            this.mode = 'reading briefing';
            this.screenRead = `${info?.rating || '?'} ${info?.levelNumber || '?'} ${title} | ${info?.numLemmings || 0} lems | ${info?.percentNeeded || 0}% | RR ${info?.releaseRate || 0} | ${info?.timeMinutes || 0}m`;
            this.advice = 'reading the level info screen before choosing preview/play';

            if (title === 'LOADING') return;
            if (this.driverLastInfoId !== id) {
                this.driverLastInfoId = id;
                this.log(`Read briefing: ${this.screenRead}`, 'action');
            }

            if (this.driverStartViaPreview) {
                this.tap('button1', 'Button 1 from briefing: enter preview', 16);
            } else {
                this.tap('select', 'Button 2 from briefing: direct play', 16);
            }
        }

        drivePreviewScreen() {
            const game = this.game;
            this.mode = 'reading preview';
            const skillSnapshot = this.getSkillSnapshotText();
            const world = this.analyzeWorld(true);
            this.screenRead = `preview HUD skills: ${skillSnapshot} | ${world.summary}`;
            this.advice = 'reading loaded level/HUD, then pressing Button 2 to start play';

            if (skillSnapshot && skillSnapshot !== this.driverLastSkillSnapshot) {
                this.driverLastSkillSnapshot = skillSnapshot;
                this.log(`Read preview/HUD skill stock: ${skillSnapshot}`, 'action');
            }

            this.tap('select', 'Button 2 from preview: start play', 18);
        }

        driveResultScreen(normalizedState) {
            const game = this.game;
            const result = game?.levelResult || {};
            const savedPercent = safeNumber(result.savedPercent, game?.getSavedPercent?.() || 0);
            const neededPercent = safeNumber(result.neededPercent, game?.level?.percent_needed || 0);
            const saved = safeNumber(game?.stats?.lemmingsSaved, 0);
            const total = safeNumber(game?.level?.num_lemmings, game?.level?.lemmingCount || 0);
            const resultName = normalizedState === 'levelSuccess' ? 'success' : 'failure';
            const nextLevel = normalizedState === 'levelSuccess'
                ? `${result.nextLevelNumber || '?'}`
                : `${result.levelNumber || '?'}`;

            this.mode = 'result pilot';
            this.screenRead = `${resultName.toUpperCase()} ${savedPercent}% / need ${neededPercent}% | saved ${saved}/${total || '?'}`;

            const resultKey = `${normalizedState}:${result.levelNumber || '?'}:${savedPercent}:${neededPercent}:${saved}:${total}`;
            if (this.driverLastResultKey !== resultKey) {
                this.driverLastResultKey = resultKey;
                this.recordLevelResult(normalizedState, result, savedPercent, neededPercent, saved, total);
                this.log(`Read result screen: ${this.screenRead}`, normalizedState === 'levelSuccess' ? 'action' : 'warn');
            }

            if (typeof game?.isResultMusicInputLocked === 'function' && game.isResultMusicInputLocked()) {
                this.advice = 'result music is still playing; waiting before pressing through';
                return;
            }

            if (game?.screenTransition?.active) {
                this.advice = 'waiting for result screen transition';
                return;
            }

            if (normalizedState === 'levelSuccess') {
                this.advice = `success: pressing Button 1 to continue to level ${nextLevel}`;
                this.tap('button1', 'success result: continue to next level info', 24);
                return;
            }

            this.advice = `failure: pressing Button 2 to retry level ${nextLevel}`;
            this.tap('select', 'failure result: retry same level info', 24);
        }

        drivePlaying() {
            const game = this.game;
            this.mode = 'controller playing';
            this.applyAiSpeed();
            const world = this.analyzeWorld();
            if (world?.summary) this.screenRead = `${world.summary} | ${this.getSkillSnapshotText()}`;

            if (!game.level) {
                this.advice = 'waiting for level';
                return;
            }

            if ((!this.driverTask || this.isDriverTaskFinished(this.driverTask)) && this.driverFrame < this.nextExperimentFrame) {
                const wait = Math.max(0, this.nextExperimentFrame - this.driverFrame);
                this.advice = `observing after ${this.lastExperimentSkill || 'experiment'} (${wait} frames before next poke)`;
                return;
            }

            if (!this.driverTask || this.isDriverTaskFinished(this.driverTask)) {
                this.driverTask = this.makeNextDriverTask();
            }

            if (!this.driverTask) {
                this.advice = 'no valid skill experiment available';
                return;
            }

            this.runDriverTask(this.driverTask);
        }

        applyAiSpeed() {
            const game = this.game;
            if (!game || !this.aiSpeedEnabled || !this.controlEnabled) return false;
            if (String(game.state || '') !== 'playing') return false;
            const target = Math.max(1, Math.floor(safeNumber(this.aiSpeed, 4)));
            if (safeNumber(game.speedMultiplier, 1) !== target) {
                game.speedMultiplier = target;
                this.log(`AI fast-forward set to ${target}x`, 'action');
            }
            return true;
        }

        getSkillSnapshotText() {
            const game = this.game;
            const counts = game?.skillCounts || {};
            return (game?.skillOrder || [])
                .map(skill => `${skill.id}:${safeNumber(counts[skill.id], 0)}`)
                .join(' ');
        }

        makeNextDriverTask() {
            const game = this.game;
            const candidates = this.getSkillCandidates();
            if (!candidates.length) return null;

            let chosen = null;
            const forcedAlreadyTried = this.startupDemoSkill
                ? safeNumber(this.driverSkillAttemptCounts.get(this.startupDemoSkill), 0) > 0
                : false;
            if (this.startupDemoSkill && !forcedAlreadyTried) {
                chosen = candidates.find(candidate => candidate.skill === this.startupDemoSkill) || null;
            }
            if (!chosen) chosen = candidates[0];
            if (!chosen) return null;

            const task = {
                id: `${chosen.skill}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                phase: 'select-skill',
                skill: chosen.skill,
                lemmingId: getLemmingId(chosen.lemming),
                reason: chosen.reason,
                startedTick: this.getTick(),
                startedFrame: this.driverFrame,
                skillCountAtStart: safeNumber(game.skillCounts?.[chosen.skill], 0),
                previousState: chosen.lemming?.state || 'unknown',
                beforeSnapshot: this.snapshot(chosen.lemming),
                beforeStats: this.getStatsSnapshot(),
                pressFrames: 0,
                done: false,
                failed: false,
                brainMode: this.brainMode
            };
            this.targetId = task.lemmingId;
            this.driverAttempts.push({ skill: task.skill, lemmingId: task.lemmingId, x: task.beforeSnapshot?.x, y: task.beforeSnapshot?.y, tick: this.getTick(), reason: task.reason });
            this.driverSkillAttemptCounts.set(task.skill, safeNumber(this.driverSkillAttemptCounts.get(task.skill), 0) + 1);
            this.log(`Controller plan: ${task.skill.toUpperCase()} on L#${task.lemmingId} (${task.reason})`, 'action');
            return task;
        }


        loadLevelMemory() {
            if (typeof window === 'undefined' || !window.localStorage) return { version: 1, levels: {} };
            try {
                const raw = window.localStorage.getItem(levelMemoryStorageKey);
                if (!raw) return { version: 1, levels: {} };
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object') return { version: 1, levels: {} };
                parsed.levels = parsed.levels || {};
                return parsed;
            } catch (error) {
                console.warn('[AI] Could not load level memory', error);
                return { version: 1, levels: {} };
            }
        }

        saveLevelMemory() {
            if (typeof window === 'undefined' || !window.localStorage) return false;
            try {
                this.levelMemory.updatedAt = new Date().toISOString();
                window.localStorage.setItem(levelMemoryStorageKey, JSON.stringify(this.levelMemory));
                return true;
            } catch (error) {
                console.warn('[AI] Could not save level memory', error);
                return false;
            }
        }

        getLevelMemoryEntry(levelKey = this.getLevelKey()) {
            const key = String(levelKey || 'unknown-level');
            this.levelMemory = this.levelMemory || { version: 1, levels: {} };
            this.levelMemory.levels = this.levelMemory.levels || {};
            if (!this.levelMemory.levels[key]) {
                this.levelMemory.levels[key] = {
                    runs: 0,
                    successes: 0,
                    failures: 0,
                    bestSavedPercent: 0,
                    recentPlans: []
                };
            }
            return this.levelMemory.levels[key];
        }

        getCurrentPlanSignature() {
            return this.driverAttempts
                .slice(0, 12)
                .map(attempt => `${attempt.skill}@${Math.round(safeNumber(attempt.x, 0) / 16) * 16},${Math.round(safeNumber(attempt.y, 0) / 16) * 16}`)
                .join('|') || 'no-actions';
        }

        recordLevelResult(normalizedState, result, savedPercent, neededPercent, saved, total) {
            const levelKey = this.getLevelKey() || String(result?.levelName || result?.levelNumber || 'unknown-level');
            const resultKey = `${levelKey}:${normalizedState}:${savedPercent}:${saved}:${total}:${this.getCurrentPlanSignature()}`;
            if (this.lastRecordedResultKey === resultKey) return;
            this.lastRecordedResultKey = resultKey;

            const entry = this.getLevelMemoryEntry(levelKey);
            entry.runs = safeNumber(entry.runs, 0) + 1;
            entry.bestSavedPercent = Math.max(safeNumber(entry.bestSavedPercent, 0), safeNumber(savedPercent, 0));
            if (normalizedState === 'levelSuccess') entry.successes = safeNumber(entry.successes, 0) + 1;
            else entry.failures = safeNumber(entry.failures, 0) + 1;
            entry.recentPlans = entry.recentPlans || [];
            entry.recentPlans.unshift({
                when: new Date().toISOString(),
                result: normalizedState,
                savedPercent: safeNumber(savedPercent, 0),
                neededPercent: safeNumber(neededPercent, 0),
                saved: safeNumber(saved, 0),
                total: safeNumber(total, 0),
                signature: this.getCurrentPlanSignature()
            });
            entry.recentPlans = entry.recentPlans.slice(0, 12);
            this.saveLevelMemory();
            this.log(`Level memory: run ${entry.runs}, best ${entry.bestSavedPercent}% (${normalizedState})`, normalizedState === 'levelSuccess' ? 'action' : 'warn');
        }

        analyzeWorld(force = false) {
            const game = this.game;
            const level = game?.level;
            const tick = this.getTick();
            if (!force && this.lastWorldAnalysis && tick - this.lastWorldAnalysisTick < 20) return this.lastWorldAnalysis;

            if (!level || typeof level.checkCollision !== 'function') {
                return { ready: false, summary: 'world: no level/collision map yet' };
            }

            const width = Math.max(336, Math.floor(safeNumber(level.width, level.pixelWidth || level.mapWidth || 336)));
            const height = Math.max(192, Math.floor(safeNumber(level.height, level.pixelHeight || level.mapHeight || 192)));
            const exits = (level.exitPositions?.length ? level.exitPositions : (level.exitPos ? [level.exitPos] : []))
                .map(exit => ({
                    x: safeNumber(exit.x, 0),
                    y: safeNumber(exit.y, 0),
                    topY: safeNumber(exit.topY ?? exit.triggerTopY, safeNumber(exit.y, 0) - 4),
                    bottomY: safeNumber(exit.bottomY ?? exit.triggerBottomY, safeNumber(exit.y, 0) + 12)
                }));
            const entrances = (level.entrancePositions?.length ? level.entrancePositions : (level.entrancePos ? [level.entrancePos] : []))
                .map(entrance => ({ x: safeNumber(entrance.x, 0), y: safeNumber(entrance.y, 0) }));

            const hazards = [];
            let sampledHazards = 0;
            if (typeof level.checkHazard === 'function') {
                for (let y = 0; y < height; y += 8) {
                    for (let x = 0; x < width; x += 8) {
                        const hazard = level.checkHazard(x, y, level.tilesetManager);
                        if (!hazard) continue;
                        sampledHazards++;
                        if (hazards.length < 20) hazards.push({ x, y, type: String(hazard) });
                    }
                }
            }

            const surfaces = [];
            let current = null;
            const stepX = 4;
            for (let x = 0; x < width; x += stepX) {
                let floorY = null;
                for (let y = 1; y < height; y += 1) {
                    const solid = !!level.checkCollision(x, y, level.tilesetManager);
                    const airAbove = !level.checkCollision(x, y - 1, level.tilesetManager);
                    if (solid && airAbove) {
                        floorY = y - 1;
                        break;
                    }
                }
                if (floorY == null) {
                    if (current) { surfaces.push(current); current = null; }
                    continue;
                }
                if (!current || Math.abs(current.y - floorY) > 3 || x - current.x2 > stepX + 1) {
                    if (current) surfaces.push(current);
                    current = { x1: x, x2: x, y: floorY, samples: 1 };
                } else {
                    current.x2 = x;
                    current.y = Math.round((current.y * current.samples + floorY) / (current.samples + 1));
                    current.samples += 1;
                }
            }
            if (current) surfaces.push(current);

            const broadSurfaces = surfaces
                .filter(surface => surface.x2 - surface.x1 >= 16)
                .sort((a, b) => (b.x2 - b.x1) - (a.x2 - a.x1))
                .slice(0, 10);

            const timeText = `${safeNumber(level.time_minutes ?? level.timeMinutes, 0)}m`;
            const need = safeNumber(level.percent_needed ?? level.percentNeeded, game?.selectedLevelInfo?.percentNeeded || 0);
            const total = safeNumber(level.num_lemmings ?? level.lemmingCount, game?.selectedLevelInfo?.numLemmings || 0);
            const rr = safeNumber(game?.releaseRate, game?.selectedLevelInfo?.releaseRate || level.release_rate || 0);
            const exitText = exits.length ? `exit ${Math.round(exits[0].x)},${Math.round(exits[0].y)}` : 'no exit found';
            const hazardText = sampledHazards ? `${sampledHazards} hazard samples` : 'no hazards sampled';

            const analysis = {
                ready: true,
                width,
                height,
                exits,
                entrances,
                hazards,
                sampledHazards,
                surfaces: broadSurfaces,
                restrictions: { total, need, rr, timeText },
                summary: `goal ${need}% of ${total || '?'} to ${exitText}; RR ${rr}; ${timeText}; ${hazardText}; ${broadSurfaces.length} floor runs`
            };
            this.lastWorldAnalysis = analysis;
            this.lastWorldAnalysisTick = tick;
            return analysis;
        }

        getNearestExit(x, y, world = this.analyzeWorld()) {
            const exits = world?.exits || [];
            if (!exits.length) return null;
            return [...exits].sort((a, b) => {
                const ad = Math.abs(safeNumber(a.x) - safeNumber(x)) + Math.abs(safeNumber(a.y) - safeNumber(y));
                const bd = Math.abs(safeNumber(b.x) - safeNumber(x)) + Math.abs(safeNumber(b.y) - safeNumber(y));
                return ad - bd;
            })[0];
        }

        estimateDrop(lemming, probeX = null, maxDrop = 96) {
            const level = this.game?.level;
            if (!level || typeof level.checkCollision !== 'function' || !lemming) return { drop: 0, lands: false, hazard: null };
            const x = Math.floor(probeX == null ? safeNumber(lemming.x, 0) : safeNumber(probeX, 0));
            const footY = typeof lemming.getFootY === 'function' ? lemming.getFootY() : Math.floor(lemming.y + lemming.height - 1);
            let hazard = null;
            for (let d = 1; d <= maxDrop; d++) {
                const y = footY + d;
                if (!hazard && typeof level.checkHazard === 'function') hazard = level.checkHazard(x, y, level.tilesetManager) || null;
                if (level.checkCollision(x, y, level.tilesetManager)) return { drop: d, lands: true, hazard };
            }
            return { drop: maxDrop, lands: false, hazard };
        }

        getLemmingContext(lemming, world = this.analyzeWorld()) {
            const exit = this.getNearestExit(lemming?.x, lemming?.y, world);
            const dir = Math.sign(safeNumber(lemming?.direction, 1)) || 1;
            const x = safeNumber(lemming?.x, 0);
            const y = safeNumber(lemming?.y, 0);
            const dxExit = exit ? safeNumber(exit.x, 0) - x : 0;
            const dyExit = exit ? safeNumber(exit.y, 0) - y : 0;
            const aheadX = x + dir * 10;
            const dropAhead = this.estimateDrop(lemming, aheadX, 96);
            const dropHere = this.estimateDrop(lemming, x, 96);
            return {
                exit,
                dxExit,
                dyExit,
                distanceToExit: exit ? Math.abs(dxExit) + Math.abs(dyExit) : 9999,
                facingExit: exit ? Math.sign(dxExit || dir) === dir : true,
                exitBelow: dyExit > 8,
                exitAbove: dyExit < -8,
                wallAhead: this.hasWallAhead(lemming),
                pitAhead: this.hasPitAhead(lemming),
                dropAhead,
                dropHere,
                groundUnder: this.hasGroundUnder(lemming),
                hazardNear: !!(dropAhead.hazard || dropHere.hazard)
            };
        }

        getRunMemoryPenalty(skill, lemming) {
            const entry = this.getLevelMemoryEntry();
            const plans = entry.recentPlans || [];
            if (!plans.length) return 0;
            const coarse = `${skill}@${Math.round(safeNumber(lemming?.x, 0) / 16) * 16},${Math.round(safeNumber(lemming?.y, 0) / 16) * 16}`;
            let penalty = 0;
            for (const plan of plans.slice(0, 6)) {
                if (String(plan.result || '').includes('Success')) continue;
                if (String(plan.signature || '').includes(coarse)) penalty += 80;
            }
            return penalty;
        }

        randomRankFor(...parts) {
            // Tiny deterministic-ish noise so equal candidates do not replay in
            // identical lemming order forever. This is deliberately not crypto
            // or simulation-critical; it is just curiosity jitter.
            let hash = (this.sessionSeed || 1) ^ ((this.levelRunSerial || 0) * 2654435761) ^ ((this.driverAttempts.length + 1) * 2246822519);
            const text = parts.map(part => String(part ?? '')).join('|');
            for (let i = 0; i < text.length; i++) {
                hash ^= text.charCodeAt(i) + 0x9e3779b9 + (hash << 6) + (hash >>> 2);
            }
            return Math.abs(hash % 1000) / 1000;
        }

        getSameRegionAttemptPenalty(skill, lemming) {
            const x = safeNumber(lemming?.x, 0);
            const y = safeNumber(lemming?.y, 0);
            const coarseX = Math.round(x / 16) * 16;
            const coarseY = Math.round(y / 16) * 16;
            let penalty = 0;
            for (const attempt of this.driverAttempts.slice(-16)) {
                if (attempt.skill !== skill) continue;
                const ax = Math.round(safeNumber(attempt.x, 0) / 16) * 16;
                const ay = Math.round(safeNumber(attempt.y, 0) / 16) * 16;
                const sameRow = Math.abs(ay - coarseY) <= 8;
                const nearX = Math.abs(ax - coarseX) <= 24;
                if (sameRow && skill === 'blocker') penalty += 720;
                else if (sameRow) penalty += 260;
                if (sameRow && nearX) penalty += 420;
            }
            return penalty;
        }

        scoreDiscoveryCandidate(skill, lemming, world = this.analyzeWorld()) {
            skill = cleanSkillName(skill);
            const ctx = this.getLemmingContext(lemming, world);
            const learned = this.learningJournal?.skills?.[skill] || {};
            const triedThisRun = safeNumber(this.driverSkillAttemptCounts.get(skill), 0);
            const id = safeNumber(getLemmingId(lemming), 9999);
            let score = 0;
            let reason = `curiosity: try ${skill} and observe the consequences`;

            // Prefer skills we know least about, but do not force a fixed HUD order.
            score += triedThisRun * 650;
            score += safeNumber(learned.attempts, 0) * 20;
            score += this.getSameRegionAttemptPenalty(skill, lemming);
            score += this.getRunMemoryPenalty(skill, lemming);

            if (skill === this.lastExperimentSkill) score += 220;

            // Light situational nudges only. These are not intended as a solution
            // script; they just keep experiments observable and vaguely sensible.
            if (skill === 'blocker') {
                if (ctx.groundUnder && (ctx.pitAhead || ctx.wallAhead || !ctx.facingExit)) {
                    score -= 90;
                    reason = 'curiosity: Blocker near an edge/wall may change the crowd route';
                } else {
                    reason = 'curiosity: Blocker should alter other walkers, wait and watch';
                }
            } else if (skill === 'builder') {
                if (ctx.pitAhead || ctx.exitAbove) {
                    score -= 80;
                    reason = 'curiosity: Builder near a gap/uphill need should create terrain';
                }
            } else if (skill === 'basher') {
                if (ctx.wallAhead) {
                    score -= 90;
                    reason = 'curiosity: Basher with terrain ahead should remove a tunnel';
                } else score += 35;
            } else if (skill === 'miner') {
                if (ctx.wallAhead || ctx.exitBelow) {
                    score -= 60;
                    reason = 'curiosity: Miner may create a diagonal route downward';
                }
            } else if (skill === 'digger') {
                if (ctx.groundUnder) {
                    score -= 55;
                    reason = 'curiosity: Digger should remove floor below the lemming';
                }
            } else if (skill === 'floater') {
                if (lemming.state === 'falling') {
                    score -= 140;
                    reason = 'curiosity: Floater during a fall should reveal safe-fall behaviour';
                } else if (!lemming.isFloater) {
                    score -= 25;
                    reason = 'curiosity: Floater may add a permanent fall-safety ability';
                }
            } else if (skill === 'climber') {
                if (ctx.wallAhead) {
                    score -= 75;
                    reason = 'curiosity: Climber near a wall should reveal climbing behaviour';
                } else if (!lemming.isClimber) {
                    score -= 20;
                    reason = 'curiosity: Climber may add a permanent wall ability';
                }
            } else if (skill === 'bomber') {
                score += triedThisRun ? 500 : 160;
                if (ctx.wallAhead) score -= 55;
                reason = 'curiosity: Bomber is costly, save as a sparse destructive experiment';
            }

            // Spread targets across the stream. This avoids the exact same first
            // lemmings being picked on every run when several choices are equal.
            score += this.getRotatingLemmingRank(id) * 0.7;
            score += this.randomRankFor(skill, id, Math.round(ctx.x / 8), Math.round(ctx.y / 8)) * 180;

            return { score, reason, context: ctx };
        }

        scoreSkillCandidate(skill, lemming, world = this.analyzeWorld()) {
            skill = cleanSkillName(skill);
            const ctx = this.getLemmingContext(lemming, world);
            let score = 0;
            let reason = `goal-aware ${skill} experiment`;

            if (skill === 'floater') {
                if (lemming.state === 'falling') {
                    score -= ctx.dropHere.drop > 28 || ctx.hazardNear ? 130 : 45;
                    reason = ctx.hazardNear ? 'falling toward danger; try Floater' : 'falling; learn/try Floater safety';
                } else if (!lemming.isFloater) {
                    score += 30;
                    reason = 'learn permanent Floater ability before any big drops';
                }
            }

            if (skill === 'climber') {
                if (ctx.wallAhead) {
                    score -= ctx.exitAbove || !ctx.facingExit ? 70 : 25;
                    reason = ctx.exitAbove ? 'wall ahead and exit is higher; try Climber' : 'wall ahead; learn Climber wall behaviour';
                } else {
                    score += 55;
                    reason = 'Climber has no wall nearby yet';
                }
            }

            if (skill === 'builder') {
                if (ctx.pitAhead || !ctx.dropAhead.lands || ctx.dropAhead.hazard) {
                    score -= ctx.facingExit ? 120 : 65;
                    reason = ctx.dropAhead.hazard ? 'drop/hazard ahead; bridge over it' : 'gap/drop ahead; try Builder';
                } else if (ctx.exitAbove && ctx.facingExit) {
                    score -= 55;
                    reason = 'exit is higher/ahead; try Builder as upward path';
                } else {
                    score += 45;
                    reason = 'no obvious gap/uphill need for Builder';
                }
            }

            if (skill === 'basher') {
                if (ctx.wallAhead && ctx.facingExit) {
                    score -= 110;
                    reason = 'solid terrain blocks route toward exit; try Basher';
                } else if (ctx.wallAhead) {
                    score -= 30;
                    reason = 'wall ahead; learn Basher tunnel behaviour';
                } else {
                    score += 65;
                    reason = 'no wall in front for Basher';
                }
            }

            if (skill === 'miner') {
                if (ctx.exitBelow && ctx.facingExit) {
                    score -= 95;
                    reason = 'exit is lower and ahead; try Miner diagonal tunnel';
                } else if (ctx.wallAhead && ctx.exitBelow) {
                    score -= 45;
                    reason = 'wall/lower route; learn Miner behaviour';
                } else {
                    score += 50;
                    reason = 'no lower-ahead route for Miner yet';
                }
            }

            if (skill === 'digger') {
                if (ctx.exitBelow && Math.abs(ctx.dxExit) < 80) {
                    score -= 115;
                    reason = 'exit is mostly below; try Digger vertical route';
                } else if (ctx.groundUnder) {
                    score -= 18;
                    reason = 'grounded; learn Digger vertical tunnel';
                } else {
                    score += 70;
                    reason = 'not a useful Digger spot';
                }
            }

            if (skill === 'blocker') {
                if (!ctx.facingExit && ctx.groundUnder) {
                    score -= 80;
                    reason = 'lemming is walking away from exit; Blocker can turn the crowd';
                } else if (ctx.pitAhead && ctx.dropAhead.hazard) {
                    score -= 75;
                    reason = 'danger ahead; Blocker may stop the crowd';
                } else {
                    score += 35;
                    reason = 'Blocker is only useful as crowd control here';
                }
            }

            if (skill === 'bomber') {
                // Keep bomber as a late experiment. It can remove terrain, but it
                // costs a lemming, so a goal-aware player should avoid it unless
                // stuck against terrain with no better destructive option.
                score += ctx.wallAhead ? 35 : 140;
                reason = ctx.wallAhead ? 'wall ahead; Bomber is destructive but costly' : 'Bomber costs a lemming; save for stuck cases';
            }

            score += Math.min(120, Math.floor(ctx.distanceToExit / 12));
            score += this.getRunMemoryPenalty(skill, lemming);
            return { score, reason, context: ctx };
        }

        getSkillCandidates() {
            const game = this.game;
            const lemmings = (game?.lemmings || []).filter(lemming => this.isControllableLemming(lemming));
            const counts = game?.skillCounts || {};
            const attemptsByKey = new Set(this.driverAttempts.map(attempt => `${attempt.skill}:${attempt.lemmingId}`));
            const candidates = [];
            const world = this.analyzeWorld();
            const skillOrder = (game?.skillOrder || [])
                .map(skill => cleanSkillName(skill?.id || skill))
                .filter(Boolean);
            const knownSkills = skillOrder.length ? skillOrder : SKILL_PRIORITY;

            const baseSkillRank = (skill, lemming) => {
                const id = safeNumber(getLemmingId(lemming), 9999);
                const priorityIndex = SKILL_PRIORITY.indexOf(skill);
                const priority = priorityIndex >= 0 ? priorityIndex : 99;
                if (this.brainMode === 'goal') {
                    const triedThisSkill = safeNumber(this.driverSkillAttemptCounts.get(skill), 0);
                    const goalScore = this.scoreSkillCandidate(skill, lemming, world).score;
                    const runVariety = (safeNumber(this.levelRunSerial, 0) * 17 + id * 13 + priority * 19) % 37;
                    return goalScore + triedThisSkill * 900 + priority * 8 + runVariety + this.getRotatingLemmingRank(id);
                }
                return this.scoreDiscoveryCandidate(skill, lemming, world).score;
            };

            const pushCandidate = (skill, lemming, reason) => {
                skill = cleanSkillName(skill);
                if (!skill || !lemming) return;
                if (safeNumber(counts[skill], 0) <= 0) return;
                if (!this.isSkillSensibleForCurrentState(skill, lemming, false)) return;
                if (typeof game.canAssignSkillToLemming === 'function' && !game.canAssignSkillToLemming(skill, lemming)) return;
                const key = `${skill}:${getLemmingId(lemming)}`;
                if (attemptsByKey.has(key) || this.abortedTaskKeys.has(key)) return;
                const scored = this.brainMode === 'goal'
                    ? this.scoreSkillCandidate(skill, lemming, world)
                    : this.scoreDiscoveryCandidate(skill, lemming, world);
                candidates.push({
                    skill,
                    lemming,
                    reason: reason || scored.reason,
                    rank: baseSkillRank(skill, lemming),
                    context: scored.context
                });
            };

            const shuffledLemmings = [...lemmings].sort((a, b) => {
                const ar = this.getRotatingLemmingRank(getLemmingId(a));
                const br = this.getRotatingLemmingRank(getLemmingId(b));
                if (ar !== br) return ar - br;
                return safeNumber(getLemmingId(a), 9999) - safeNumber(getLemmingId(b), 9999);
            });

            for (const lemming of shuffledLemmings) {
                const id = getLemmingId(lemming);
                if (this.startupDemoSkill) {
                    pushCandidate(this.startupDemoSkill, lemming, `demo requested ${this.startupDemoSkill}`);
                }

                if (lemming.state === 'falling') {
                    pushCandidate('floater', lemming, null);
                    pushCandidate('bomber', lemming, null);
                    continue;
                }

                if (lemming.state === 'walking') {
                    for (const skill of knownSkills) {
                        pushCandidate(skill, lemming, null);
                    }
                }
            }

            candidates.sort((a, b) => {
                if (a.rank !== b.rank) return a.rank - b.rank;
                return this.getRotatingLemmingRank(getLemmingId(a.lemming)) - this.getRotatingLemmingRank(getLemmingId(b.lemming));
            });

            if (this.driverMaxAttempts > 0 && this.driverAttempts.length >= this.driverMaxAttempts) {
                return [];
            }

            return candidates;
        }

        runDriverTask(task) {
            const game = this.game;
            const lemming = this.getLemmingById(task.lemmingId);
            if (!lemming || TERMINAL_STATES.has(lemming.state)) {
                task.failed = true;
                this.queueLearningObservation(task, null, false, 'lemming unavailable');
                this.log(`Controller task failed: L#${task.lemmingId} unavailable`, 'warn');
                this.scheduleNextExperiment(task, false, 'lemming unavailable');
                return;
            }

            this.targetId = task.lemmingId;
            if (this.hasTaskSucceeded(task, lemming)) {
                task.done = true;
                this.addActionMarker(lemming, task.skill.toUpperCase());
                this.queueLearningObservation(task, lemming, true, 'assignment accepted');
                this.log(`Controller task succeeded: ${task.skill.toUpperCase()} on L#${task.lemmingId}`, 'action');
                this.scheduleNextExperiment(task, true, 'assignment accepted');
                return;
            }

            if (this.driverFrame - task.startedFrame > 900) {
                task.failed = true;
                this.queueLearningObservation(task, lemming, false, 'controller timed out');
                this.log(`Controller task timed out: ${task.skill.toUpperCase()} on L#${task.lemmingId}`, 'warn');
                this.scheduleNextExperiment(task, false, 'controller timed out');
                return;
            }

            if (!this.isSkillSensibleForCurrentState(task.skill, lemming, true)) {
                task.failed = true;
                this.abortedTaskKeys.add(`${task.skill}:${task.lemmingId}`);
                this.queueLearningObservation(task, lemming, false, `${task.skill} no longer sensible for ${lemming.state}`);
                this.log(`Retargeting: L#${task.lemmingId} is now ${lemming.state}, so ${task.skill.toUpperCase()} is skipped`, 'warn');
                this.scheduleNextExperiment(task, false, `${task.skill} no longer sensible`);
                return;
            }

            if (typeof game.canAssignSkillToLemming === 'function' && !game.canAssignSkillToLemming(task.skill, lemming)) {
                task.failed = true;
                this.abortedTaskKeys.add(`${task.skill}:${task.lemmingId}`);
                this.queueLearningObservation(task, lemming, false, `rules reject ${task.skill} on ${lemming.state}`);
                this.log(`Retargeting: game rules reject ${task.skill.toUpperCase()} on L#${task.lemmingId} (${lemming.state})`, 'warn');
                this.scheduleNextExperiment(task, false, 'game rules rejected assignment');
                return;
            }

            if (task.phase === 'select-skill') {
                const selected = game.getSelectedSkill?.();
                if (selected?.id === task.skill) {
                    task.phase = 'move-to-lemming';
                    this.advice = `${task.skill.toUpperCase()} already selected; moving cursor to L#${task.lemmingId}`;
                    return;
                }

                const atHud = this.driveCursorToSkillHud(task.skill);
                this.advice = `using cursor to select ${task.skill.toUpperCase()} from HUD`;
                if (atHud) {
                    this.tap('select', `select ${task.skill.toUpperCase()} on HUD`, 8);
                }
                return;
            }

            if (task.phase === 'move-to-lemming') {
                const arrived = this.driveCursorToLemming(lemming);
                this.advice = `moving cursor to L#${task.lemmingId} for ${task.skill.toUpperCase()}`;
                if (arrived && this.game.cursor?.hoveredLemming === lemming) {
                    if (!this.isSkillSensibleForCurrentState(task.skill, lemming, true) ||
                        (typeof game.canAssignSkillToLemming === 'function' && !game.canAssignSkillToLemming(task.skill, lemming))) {
                        task.failed = true;
                        this.abortedTaskKeys.add(`${task.skill}:${task.lemmingId}`);
                        this.queueLearningObservation(task, lemming, false, `target changed to ${lemming.state} before click`);
                        this.log(`Click cancelled: L#${task.lemmingId} became ${lemming.state} before ${task.skill.toUpperCase()}`, 'warn');
                        this.scheduleNextExperiment(task, false, 'target changed before click');
                        return;
                    }
                    task.phase = 'press-on-lemming';
                    task.pressFrames = 10;
                    this.startHold('select', task.pressFrames, `assign ${task.skill.toUpperCase()} to L#${task.lemmingId}`);
                }
                return;
            }

            if (task.phase === 'press-on-lemming') {
                this.advice = `holding Button 2 over L#${task.lemmingId}`;
                if (!this.driverHold && !this.hasTaskSucceeded(task, lemming)) {
                    task.failed = true;
                    this.queueLearningObservation(task, lemming, false, 'assignment not accepted');
                    this.log(`Controller assignment was not accepted for L#${task.lemmingId}`, 'warn');
                    this.scheduleNextExperiment(task, false, 'assignment not accepted');
                }
            }
        }

        getStatsSnapshot() {
            const game = this.game;
            return {
                saved: safeNumber(game?.stats?.lemmingsSaved, 0),
                out: safeNumber(game?.stats?.lemmingsOut, 0),
                leftToSpawn: safeNumber(game?.stats?.lemmingsLeftToSpawn, 0),
                alive: typeof game?.getAliveLemmingCount === 'function'
                    ? safeNumber(game.getAliveLemmingCount(), 0)
                    : (game?.lemmings || []).filter(lemming => this.isActiveLemming(lemming)).length,
                tick: this.getTick()
            };
        }

        loadLearningJournal() {
            if (!this.learningEnabled || typeof window === 'undefined' || !window.localStorage) {
                return makeEmptyLearningJournal();
            }
            try {
                const raw = window.localStorage.getItem(learningStorageKey);
                if (!raw) return makeEmptyLearningJournal();
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object') return makeEmptyLearningJournal();
                parsed.skills = parsed.skills || {};
                return parsed;
            } catch (error) {
                console.warn('[AI] Could not load learning journal', error);
                return makeEmptyLearningJournal();
            }
        }

        saveLearningJournal() {
            if (!this.learningEnabled || typeof window === 'undefined' || !window.localStorage) return false;
            try {
                this.learningJournal.updatedAt = new Date().toISOString();
                window.localStorage.setItem(learningStorageKey, JSON.stringify(this.learningJournal));
                return true;
            } catch (error) {
                console.warn('[AI] Could not save learning journal', error);
                return false;
            }
        }

        queueLearningObservation(task, lemming, accepted, note) {
            if (!this.learningEnabled || !task || task.learningQueued) return;
            task.learningQueued = true;
            this.learningObservations.push({
                id: task.id,
                skill: task.skill,
                lemmingId: task.lemmingId,
                reason: task.reason,
                accepted: !!accepted,
                note: String(note || ''),
                dueFrame: this.driverFrame + (accepted ? 150 : 18),
                startedTick: task.startedTick,
                startedFrame: task.startedFrame,
                before: task.beforeSnapshot || null,
                afterAssign: lemming ? this.snapshot(lemming) : null,
                beforeStats: task.beforeStats || this.getStatsSnapshot()
            });
        }

        updateLearningObservations() {
            if (!this.learningObservations.length) return;
            const remaining = [];
            for (const observation of this.learningObservations) {
                if (this.driverFrame < observation.dueFrame) {
                    remaining.push(observation);
                    continue;
                }
                this.finishLearningObservation(observation);
            }
            this.learningObservations = remaining;
        }

        finishLearningObservation(observation) {
            const lemming = this.getLemmingById(observation.lemmingId);
            const after = lemming ? this.snapshot(lemming) : null;
            const afterStats = this.getStatsSnapshot();
            const outcome = this.describeLearningOutcome(observation, after, afterStats);
            const skill = observation.skill;
            const journal = this.learningJournal || makeEmptyLearningJournal();
            journal.skills = journal.skills || {};
            const entry = journal.skills[skill] || {
                attempts: 0,
                accepted: 0,
                rejected: 0,
                examples: [],
                lastOutcome: ''
            };
            entry.attempts += 1;
            if (observation.accepted) entry.accepted += 1;
            else entry.rejected += 1;
            entry.lastOutcome = outcome.summary;
            entry.examples.unshift({
                level: this.getLevelKey(),
                tick: observation.startedTick,
                lemmingId: observation.lemmingId,
                reason: observation.reason,
                accepted: observation.accepted,
                before: observation.before,
                after,
                summary: outcome.summary,
                details: outcome.details
            });
            entry.examples = entry.examples.slice(0, 5);
            journal.skills[skill] = entry;
            this.learningJournal = journal;
            this.learningRecent.unshift(`${getSkillLabel(skill)}: ${outcome.summary}`);
            this.learningRecent = this.learningRecent.slice(0, 8);
            this.saveLearningJournal();
            this.log(`Learned ${getSkillLabel(skill)}: ${outcome.summary}`, observation.accepted ? 'action' : 'warn');
        }

        describeLearningOutcome(observation, after, afterStats) {
            const before = observation.before || {};
            const afterAssign = observation.afterAssign || {};
            const details = [];

            if (!observation.accepted) {
                details.push(observation.note || 'not accepted by normal rules');
                return { summary: details[0], details };
            }

            if (!after) {
                details.push('lemming disappeared before observation ended');
            } else {
                if (before.state && after.state && before.state !== after.state) details.push(`${before.state} -> ${after.state}`);
                if (afterAssign.state && after.state && afterAssign.state !== after.state) details.push(`then ${after.state}`);
                const dx = safeNumber(after.x, 0) - safeNumber(before.x, 0);
                const dy = safeNumber(after.y, 0) - safeNumber(before.y, 0);
                if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) details.push(`moved ${dx >= 0 ? '+' : ''}${dx},${dy >= 0 ? '+' : ''}${dy}px`);
                if (!before.isClimber && after.isClimber) details.push('climber flag gained');
                if (!before.isFloater && after.isFloater) details.push('floater flag gained');
                if (safeNumber(before.fuseValue, 0) <= 0 && safeNumber(after.fuseValue, 0) > 0) details.push('bomber fuse armed');
                if (TERMINAL_STATES.has(after.state)) details.push(`terminal state ${after.state}`);
            }

            const savedDelta = safeNumber(afterStats.saved, 0) - safeNumber(observation.beforeStats?.saved, 0);
            const aliveDelta = safeNumber(afterStats.alive, 0) - safeNumber(observation.beforeStats?.alive, 0);
            if (savedDelta > 0) details.push(`saved +${savedDelta}`);
            if (aliveDelta < 0) details.push(`alive ${aliveDelta}`);
            if (!details.length) details.push(`${observation.skill} accepted; no obvious short-term change yet`);

            return {
                summary: details.slice(0, 3).join('; '),
                details
            };
        }

        getLearningSummaryText() {
            const skills = this.learningJournal?.skills || {};
            const known = Object.keys(skills);
            if (!known.length) return 'no skill observations yet';
            return known
                .sort((a, b) => {
                    const ai = SKILL_PRIORITY.indexOf(a);
                    const bi = SKILL_PRIORITY.indexOf(b);
                    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
                })
                .map(skill => {
                    const entry = skills[skill] || {};
                    return `${skill}:${safeNumber(entry.accepted, 0)}/${safeNumber(entry.attempts, 0)}`;
                })
                .join(' ');
        }

        hasTaskSucceeded(task, lemming) {
            const countNow = safeNumber(this.game?.skillCounts?.[task.skill], 0);
            if (countNow < task.skillCountAtStart) return true;
            if (['climber', 'floater'].includes(task.skill)) {
                if (task.skill === 'climber' && lemming.isClimber) return true;
                if (task.skill === 'floater' && lemming.isFloater) return true;
            }
            if (task.skill === 'bomber' && safeNumber(lemming.fuseValue, 0) > 0) return true;
            if (task.skill === 'builder' && (lemming.state === 'building' || lemming.state === 'shrugging')) return true;
            const stateBySkill = {
                blocker: 'blocking',
                basher: 'bashing',
                miner: 'mining',
                digger: 'digging'
            };
            return stateBySkill[task.skill] && lemming.state === stateBySkill[task.skill];
        }

        isDriverTaskFinished(task) {
            return !task || task.done || task.failed;
        }

        scheduleNextExperiment(task, accepted, note = '') {
            if (!task || task.experimentScheduled) return;
            task.experimentScheduled = true;
            const skill = cleanSkillName(task.skill);
            const base = accepted
                ? (skill === 'blocker' ? Math.max(this.experimentGap, 240) : this.experimentGap)
                : Math.max(24, Math.floor(this.experimentGap / 4));
            const jitter = Math.floor(this.randomRankFor('gap', skill, task.lemmingId, this.driverAttempts.length) * 90);
            this.nextExperimentFrame = Math.max(this.nextExperimentFrame || 0, this.driverFrame + base + jitter);
            this.lastExperimentSkill = skill;
            this.lastExperimentOutcome = accepted ? `watching ${skill} effect` : (note || `${skill} rejected`);
        }

        getLemmingById(id) {
            return (this.game?.lemmings || []).find(lemming => Number(getLemmingId(lemming)) === Number(id)) || null;
        }

        driveCursorToSkillHud(skill) {
            const game = this.game;
            const columns = typeof game.getSkillHudColumns === 'function' ? game.getSkillHudColumns() : null;
            const column = columns?.[skill];
            if (column === undefined) return false;
            const screenX = (column + 1) * 8;
            const screenY = 22 * 8 + 4;
            const camera = game.renderer?.camera || { x: 0, y: 0 };
            return this.driveCursorToWorld(camera.x + screenX, camera.y + screenY, 3, `${skill} HUD icon`);
        }

        driveCursorToLemming(lemming) {
            if (!lemming) return false;
            return this.driveCursorToWorld(safeNumber(lemming.x), safeNumber(lemming.y) + 12, 2, `L#${getLemmingId(lemming)}`);
        }

        driveCursorToWorld(targetX, targetY, tolerance = 2, reason = 'cursor target') {
            const cursor = this.game?.cursor;
            if (!cursor) return false;
            const dx = safeNumber(targetX) - safeNumber(cursor.x);
            const dy = safeNumber(targetY) - safeNumber(cursor.y);
            const arrivedX = Math.abs(dx) <= tolerance;
            const arrivedY = Math.abs(dy) <= tolerance;
            this.inputRead = `cursor ${Math.round(cursor.x)},${Math.round(cursor.y)} -> ${Math.round(targetX)},${Math.round(targetY)} (${reason})`;

            if (arrivedX && arrivedY) {
                this.lastVirtualAction = `cursor arrived - ${reason}`;
                return true;
            }

            if (!arrivedX) this.setVirtualAction(dx > 0 ? 'right' : 'left', true, false, reason);
            if (!arrivedY) this.setVirtualAction(dy > 0 ? 'down' : 'up', true, false, reason);
            return false;
        }

        isControllableLemming(lemming) {
            return !!lemming && CONTROLLABLE_STATES.has(lemming.state);
        }

        ensureLemmingIds() {
            const lemmings = this.game?.lemmings || [];
            for (const lemming of lemmings) {
                if (!lemming || lemming.aiId !== undefined) continue;
                lemming.aiId = this.nextLemmingId++;
                if (lemming.id === undefined) lemming.id = lemming.aiId;
                this.log(`L#${lemming.aiId} spawned at ${Math.round(lemming.x)},${Math.round(lemming.y)}`);
            }
        }

        snapshot(lemming) {
            return {
                id: getLemmingId(lemming),
                state: lemming?.state || 'unknown',
                x: Math.round(Number(lemming?.x || 0)),
                y: Math.round(Number(lemming?.y || 0)),
                direction: Math.sign(Number(lemming?.direction || 1)) || 1,
                fallDistance: Math.round(Number(lemming?.fallDistance || 0)),
                skillTick: Math.floor(Number(lemming?.skillTick || 0)),
                buildCount: Math.floor(Number(lemming?.buildCount || 0)),
                fuseValue: Math.floor(Number(lemming?.fuseValue || 0)),
                isClimber: !!lemming?.isClimber,
                isFloater: !!lemming?.isFloater
            };
        }

        isActiveLemming(lemming) {
            return !!lemming && ACTIVE_STATES.has(lemming.state);
        }

        observeLemmings() {
            const liveIds = new Set();
            for (const lemming of this.game?.lemmings || []) {
                const snap = this.snapshot(lemming);
                if (snap.id == null) continue;

                liveIds.add(snap.id);
                const prev = this.lastLemmingSnapshots.get(snap.id);

                if (prev) {
                    if (prev.state !== snap.state) this.log(`L#${snap.id} ${prev.state} -> ${snap.state}`);
                    if (prev.direction !== snap.direction && this.isActiveLemming(lemming)) {
                        this.log(`L#${snap.id} turned ${snap.direction > 0 ? 'right' : 'left'}`);
                    }
                    if (prev.fuseValue <= 0 && snap.fuseValue > 0) this.log(`L#${snap.id} bomber fuse armed`, 'action');
                    if (!prev.isClimber && snap.isClimber) this.log(`L#${snap.id} gained climber`, 'action');
                    if (!prev.isFloater && snap.isFloater) this.log(`L#${snap.id} gained floater`, 'action');
                }

                this.observeSimpleSignals(lemming, snap);
                this.lastLemmingSnapshots.set(snap.id, snap);
            }

            for (const id of [...this.lastLemmingSnapshots.keys()]) {
                if (!liveIds.has(id)) {
                    this.lastLemmingSnapshots.delete(id);
                    this.lastSignals.delete(id);
                }
            }
        }

        hasWallAhead(lemming) {
            const level = this.game?.level;
            if (!level || !lemming || lemming.state !== 'walking') return false;
            if (typeof level.checkCollision !== 'function') return false;

            const dir = Math.sign(Number(lemming.direction || 1)) || 1;
            const aheadX = Math.floor(lemming.x + dir * 5);
            const footY = typeof lemming.getFootY === 'function'
                ? lemming.getFootY()
                : Math.floor(lemming.y + lemming.height - 1);

            let solid = 0;
            for (let y = footY - 9; y <= footY - 4; y++) {
                if (level.checkCollision(aheadX, y, level.tilesetManager)) solid++;
            }
            return solid >= 4;
        }

        hasPitAhead(lemming) {
            const level = this.game?.level;
            if (!level || !lemming || lemming.state !== 'walking') return false;
            if (typeof level.checkCollision !== 'function') return false;

            const dir = Math.sign(Number(lemming.direction || 1)) || 1;
            const aheadX = Math.floor(lemming.x + dir * 7);
            const footY = typeof lemming.getFootY === 'function'
                ? lemming.getFootY()
                : Math.floor(lemming.y + lemming.height - 1);

            for (let y = footY + 1; y <= footY + 8; y++) {
                if (level.checkCollision(aheadX, y, level.tilesetManager)) return false;
            }
            return true;
        }

        getRotatingLemmingRank(id) {
            const numericId = safeNumber(id, 9999);
            const seed = safeNumber(this.targetRotation, 0) + safeNumber(this.sessionSeed, 0);
            // A tiny stable shuffle per browser run/level load. This stops the AI
            // from always picking L#1, then L#2, then L#3 when several choices are
            // equally valid, while still being predictable enough to debug.
            return ((numericId * 37 + seed) % 997) + numericId * 0.0001;
        }

        hasGroundUnder(lemming) {
            const level = this.game?.level;
            if (!level || !lemming || typeof level.checkCollision !== 'function') return false;
            const footY = typeof lemming.getFootY === 'function'
                ? lemming.getFootY()
                : Math.floor(lemming.y + lemming.height - 1);
            const centerX = Math.floor(lemming.x);
            const halfWidth = Math.max(2, Math.floor(safeNumber(lemming.width, 8) / 2) - 1);
            for (let x = centerX - halfWidth; x <= centerX + halfWidth; x += 2) {
                if (level.checkCollision(x, footY + 1, level.tilesetManager) ||
                    level.checkCollision(x, footY, level.tilesetManager)) {
                    return true;
                }
            }
            return false;
        }

        isSkillSensibleForCurrentState(skill, lemming, strict = false) {
            skill = cleanSkillName(skill);
            if (!skill || !lemming) return false;
            const state = String(lemming.state || '').toLowerCase();
            if (TERMINAL_STATES.has(state) || !this.isActiveLemming(lemming)) return false;

            if (skill === 'bomber') {
                return CONTROLLABLE_STATES.has(state) && safeNumber(lemming.fuseValue, 0) <= 0;
            }

            if (skill === 'floater') {
                if (lemming.isFloater) return false;
                // Floaters can be taught as a permanent ability on walkers, but
                // they are especially meaningful when someone is already falling.
                return state === 'falling' || state === 'walking';
            }

            if (skill === 'climber') {
                if (lemming.isClimber) return false;
                return state === 'walking';
            }

            if (skill === 'blocker') {
                // This is the big common-sense rule Callum spotted: blockers are
                // not a useful experiment on falling lemmings. Recheck it just
                // before the click as well as when planning, because the cursor
                // may take long enough for a walker to leave the floor.
                return state === 'walking' && this.hasGroundUnder(lemming);
            }

            if (skill === 'builder' || skill === 'basher' || skill === 'miner' || skill === 'digger') {
                if (state !== 'walking') return false;
                if (strict && !this.hasGroundUnder(lemming)) return false;
                return true;
            }

            return CONTROLLABLE_STATES.has(state);
        }

        observeSimpleSignals(lemming, snap) {
            if (!this.isActiveLemming(lemming)) return;
            const id = snap.id;
            const previous = this.lastSignals.get(id) || {};
            const signals = {
                wallAhead: this.hasWallAhead(lemming),
                pitAhead: this.hasPitAhead(lemming)
            };

            if (signals.wallAhead && !previous.wallAhead) this.log(`L#${id} sees solid terrain ahead`);
            if (signals.pitAhead && !previous.pitAhead) this.log(`L#${id} sees a drop ahead`);
            this.lastSignals.set(id, signals);
        }

        chooseTarget() {
            const candidates = (this.game?.lemmings || []).filter(lemming => this.isActiveLemming(lemming));
            if (candidates.length === 0) {
                if (!this.controlEnabled) this.advice = 'no active lemmings yet';
                this.targetId = null;
                return null;
            }

            const previousTarget = candidates.find(lemming => getLemmingId(lemming) === this.targetId);
            const target = previousTarget || [...candidates].sort((a, b) => {
                const ar = this.getRotatingLemmingRank(getLemmingId(a));
                const br = this.getRotatingLemmingRank(getLemmingId(b));
                if (ar !== br) return ar - br;
                return safeNumber(getLemmingId(a), 9999) - safeNumber(getLemmingId(b), 9999);
            })[0];
            this.targetId = getLemmingId(target);
            if (!this.controlEnabled) this.advice = this.describeAdviceFor(target);
            return target;
        }

        describeAdviceFor(lemming) {
            if (!lemming) return 'waiting';
            const id = getLemmingId(lemming);
            const state = lemming.state;
            const skills = this.game?.skillCounts || {};

            if (state === 'walking') {
                if (this.hasWallAhead(lemming) && (skills.builder || 0) > 0) return `L#${id}: wall ahead - would test BUILDER`;
                if (this.hasWallAhead(lemming) && (skills.basher || 0) > 0) return `L#${id}: wall ahead - would test BASHER`;
                if (this.hasPitAhead(lemming) && (skills.builder || 0) > 0) return `L#${id}: drop ahead - would test BUILDER`;
                if ((skills.digger || 0) > 0) return `L#${id}: stable walker - DIGGER is a possible probe`;
                return `L#${id}: walking ${lemming.direction > 0 ? 'right' : 'left'}`;
            }
            if (state === 'falling' && !lemming.isFloater && (skills.floater || 0) > 0) return `L#${id}: falling - floater may be useful`;
            if (state === 'building') return `L#${id}: building, brick ${lemming.buildCount || 0}`;
            if (state === 'digging' || state === 'bashing' || state === 'mining') return `L#${id}: ${state} tunnel in progress`;
            return `L#${id}: ${state}`;
        }

        enqueueCommand(command) {
            if (!command || typeof command !== 'object') return false;
            const skill = cleanSkillName(command.skill);
            const target = command.target ?? command.selector ?? command.lemmingId ?? command.id ?? 'target';
            const explicitTick = command.tick ?? command.at;
            const relativeTick = command.in ?? command.after;
            const now = this.getTick();
            const tick = explicitTick !== undefined ? Number(explicitTick) : now + Number(relativeTick ?? 0);

            if (!Number.isFinite(tick) || !skill) {
                this.log('Rejected bad AI command', 'warn');
                return false;
            }

            const retryTicks = Number(command.retryTicks ?? command.retryFor ?? 90);
            const normalized = {
                commandId: this.nextCommandId++,
                tick: Math.max(0, Math.floor(tick)),
                retryUntil: Math.max(0, Math.floor(tick + Math.max(0, retryTicks))),
                lemmingId: command.lemmingId !== undefined || command.id !== undefined
                    ? Math.floor(Number(command.lemmingId ?? command.id))
                    : null,
                target,
                skill,
                reason: command.reason || 'queued controller command',
                status: 'queued',
                attempts: 0,
                lastError: ''
            };

            this.commandQueue.push(normalized);
            this.commandQueue.sort((a, b) => a.tick - b.tick || a.commandId - b.commandId);
            this.scriptLoaded = true;
            this.mode = 'script replay pending';
            this.log(`Queued controller ${skill.toUpperCase()} for ${this.describeCommandTarget(normalized)} at tick ${formatTick(normalized.tick)}`);
            return normalized.commandId;
        }

        loadScript(commands, options = {}) {
            if (!Array.isArray(commands)) {
                this.log('Rejected AI script: expected an array of commands', 'warn');
                return false;
            }
            if (options.clear !== false) this.clearScript(false);
            this.scriptName = options.name || 'console script';
            let accepted = 0;
            for (const command of commands) if (this.enqueueCommand(command)) accepted++;
            this.scriptLoaded = accepted > 0;
            this.log(`Loaded controller script "${this.scriptName}" with ${accepted}/${commands.length} commands`, accepted ? 'action' : 'warn');
            return accepted > 0;
        }

        clearScript(logIt = true) {
            this.commandQueue = [];
            this.scriptLoaded = false;
            this.scriptName = null;
            if (logIt) this.log('Cleared AI script');
        }

        describeCommandTarget(command) {
            if (command.lemmingId != null && Number.isFinite(command.lemmingId)) return `L#${command.lemmingId}`;
            if (command.target != null) return String(command.target);
            return 'target';
        }

        runQueuedCommands() {
            if (!this.commandQueue.length || this.controlEnabled) return;
            // Script support remains read-only for now unless controller mode is disabled;
            // the hands-on driver is the main path for real player-like input.
        }

        onSkillAssigned(lemming, skill, previousState) {
            if (!this.enabled || !lemming) return;
            const id = getLemmingId(lemming) || '?';
            this.log(`L#${id} accepted ${String(skill).toUpperCase()} (${previousState} -> ${lemming.state})`, 'action');
        }

        addActionMarker(lemming, label) {
            if (!lemming) return;
            const id = getLemmingId(lemming);
            this.actionMarkers.push({
                id,
                x: Number(lemming.x || 0),
                y: Number(lemming.y || 0),
                label: String(label || 'ACTION'),
                expiresTick: this.getTick() + 55
            });
            if (this.actionMarkers.length > 16) this.actionMarkers.splice(0, this.actionMarkers.length - 16);
        }

        expireActionMarkers() {
            const tick = this.getTick();
            this.actionMarkers = this.actionMarkers.filter(marker => marker.expiresTick >= tick);
        }

        getCommandSummary() {
            const counts = { queued: 0, done: 0, failed: 0 };
            for (const command of this.commandQueue) if (counts[command.status] !== undefined) counts[command.status]++;
            return counts;
        }

        getState() {
            const game = this.game;
            return {
                enabled: this.enabled,
                controlEnabled: this.controlEnabled,
                mode: this.mode,
                scriptName: this.scriptName,
                gameState: game?.state || null,
                screenRead: this.screenRead,
                inputRead: this.inputRead,
                lastVirtualAction: this.lastVirtualAction,
                driverGoal: this.driverGoal,
                driverTask: this.driverTask ? { ...this.driverTask } : null,
                aiSpeed: this.aiSpeed,
                learning: this.getLearningSummaryText(),
                world: this.lastWorldAnalysis?.summary || this.analyzeWorld()?.summary || '',
                brainMode: this.brainMode,
                nextExperimentIn: Math.max(0, safeNumber(this.nextExperimentFrame, 0) - this.driverFrame),
                lastExperimentOutcome: this.lastExperimentOutcome,
                levelMemory: this.getLevelMemoryEntry(),
                level: this.getLevelKey(),
                tick: this.getTick(),
                stats: { ...(game?.stats || {}) },
                skillCounts: { ...(game?.skillCounts || {}) },
                commandSummary: this.getCommandSummary(),
                targetId: this.targetId,
                advice: this.advice,
                lemmings: (game?.lemmings || []).map(lemming => this.snapshot(lemming)),
                recentEvents: this.events.slice(-12)
            };
        }

        drawCanvasOverlay() {
            const renderer = this.game?.renderer;
            const ctx = renderer?.ctx;
            if (!renderer || !ctx) return;
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            this.drawCanvasTargetBox(ctx, renderer);
            ctx.restore();
        }

        drawCanvasTargetBox(ctx, renderer) {
            const camera = renderer.camera || { x: 0, y: 0 };
            const target = (this.game?.lemmings || []).find(lemming => Number(getLemmingId(lemming)) === Number(this.targetId));
            if (!target) return;
            const x = Math.floor(target.x - camera.x);
            const y = Math.floor(target.y - camera.y) - 1;
            if (x < -16 || x > renderer.viewportWidth + 16 || y < -16 || y > renderer.viewportHeight + 16) return;
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.95)';
            ctx.strokeRect(x - 5, y - 8, 10, 18);
        }

        updateDomOverlay() {
            if (!this.dom?.root) return;
            this.updateStatusPanel();
            this.updateEventPanel();
            this.updateMarkerLayer();
        }

        updateStatusPanel() {
            const panel = this.dom?.status;
            if (!panel) return;
            const state = this.getState();
            const saved = Number(state.stats.lemmingsSaved || 0);
            const total = Number(this.game?.level?.num_lemmings || this.game?.level?.lemmingCount || 0);
            const alive = typeof this.game?.getAliveLemmingCount === 'function'
                ? this.game.getAliveLemmingCount()
                : state.lemmings.filter(lemming => ACTIVE_STATES.has(lemming.state)).length;
            const commands = state.commandSummary;
            const levelName = state.level ? clampText(state.level, 32) : 'none';
            const task = state.driverTask ? `${state.driverTask.phase} ${state.driverTask.skill || ''} L#${state.driverTask.lemmingId || '-'}` : 'none';

            panel.replaceChildren(
                this.makeDiv('ai-title', 'AI TEST PILOT'),
                this.makeRow('mode', `${state.mode || 'watching'}${state.controlEnabled ? ' / controller' : ''}`),
                this.makeRow('state', state.gameState || 'none'),
                this.makeRow('level', levelName),
                this.makeRow('tick', `${formatTick(state.tick)}   alive ${alive}`),
                this.makeRow('saved', `${saved}/${total || '?'}`),
                this.makeRow('speed', `${safeNumber(this.game?.speedMultiplier, 1)}x target ${state.aiSpeed || 1}x`),
                this.makeRow('target', state.targetId ? `#${state.targetId}` : '-'),
                this.makeRow('goal', clampText(state.driverGoal || 'watch', 44)),
                this.makeRow('brain', `${state.brainMode || 'discover'} | run ${safeNumber(state.levelMemory?.runs, 0)} best ${safeNumber(state.levelMemory?.bestSavedPercent, 0)}%`),
                this.makeRow('observe', state.nextExperimentIn > 0 ? `${state.nextExperimentIn}f | ${clampText(state.lastExperimentOutcome || '', 30)}` : 'ready to poke'),
                this.makeRow('world', clampText(state.world || 'world pending', 54)),
                this.makeRow('task', clampText(task, 44)),
                this.makeRow('input', clampText(state.lastVirtualAction || 'none', 48)),
                this.makeRow('queue', `${commands.queued} queued / ${commands.done} done / ${commands.failed} failed`),
                this.makeDiv('ai-learning', clampText(state.learning || 'no learning yet', 66)),
                this.makeDiv('ai-muted', clampText(this.screenRead || 'screen read pending', 66)),
                this.makeDiv('ai-muted', clampText(this.advice || 'watching', 66))
            );
        }

        updateEventPanel() {
            const panel = this.dom?.events;
            if (!panel) return;
            const rows = [this.makeDiv('ai-title', 'AI EVENTS / LEARNING')];
            const recent = this.events.slice(-9);
            if (!recent.length) {
                rows.push(this.makeDiv('ai-muted', 'No events yet'));
            } else {
                for (const entry of recent) {
                    const cls = entry.type === 'warn' ? 'ai-warn' : entry.type === 'action' ? 'ai-action' : 'ai-muted';
                    rows.push(this.makeDiv(cls, `[${formatTick(entry.tick)}] ${clampText(entry.text, 64)}`));
                }
            }
            panel.replaceChildren(...rows);
        }

        updateMarkerLayer() {
            const layer = this.dom?.markers;
            if (!layer) return;
            const rect = getCanvasRectParts(this.game);
            if (!rect) {
                layer.replaceChildren();
                return;
            }

            const camera = this.game?.renderer?.camera || { x: 0, y: 0 };
            const markerNodes = [];
            const lemmings = (this.game?.lemmings || []).filter(lemming => this.isActiveLemming(lemming));
            const drawAllIds = lemmings.length <= 14;

            for (const lemming of lemmings) {
                const id = getLemmingId(lemming);
                const isTarget = Number(id) === Number(this.targetId);
                if (!drawAllIds && !isTarget) continue;

                const x = rect.left + (Number(lemming.x || 0) - Number(camera.x || 0)) * rect.scaleX;
                const y = rect.top + (Number(lemming.y || 0) - Number(camera.y || 0) - 7) * rect.scaleY;
                if (x < rect.left - 24 || x > rect.left + rect.canvasRect.width + 24) continue;
                if (y < rect.top - 24 || y > rect.top + rect.canvasRect.height + 24) continue;

                const marker = document.createElement('div');
                marker.className = `ai-lemming-marker${isTarget ? ' ai-target' : ''}`;
                marker.textContent = isTarget ? `#${id} ★` : `#${id}`;
                marker.style.left = `${x}px`;
                marker.style.top = `${y}px`;
                markerNodes.push(marker);

                if (isTarget) {
                    const box = document.createElement('div');
                    box.className = 'ai-lemming-box';
                    box.style.left = `${x}px`;
                    box.style.top = `${rect.top + (Number(lemming.y || 0) - Number(camera.y || 0) + 2) * rect.scaleY}px`;
                    markerNodes.push(box);
                }
            }

            const cursor = this.game?.cursor;
            if (cursor && (this.controlEnabled || this.manualCursorTarget)) {
                const cursorNode = document.createElement('div');
                cursorNode.className = 'ai-cursor-target';
                cursorNode.style.left = `${rect.left + (Number(cursor.x || 0) - Number(camera.x || 0)) * rect.scaleX}px`;
                cursorNode.style.top = `${rect.top + (Number(cursor.y || 0) - Number(camera.y || 0)) * rect.scaleY}px`;
                markerNodes.push(cursorNode);
            }

            for (const action of this.actionMarkers) {
                const marker = document.createElement('div');
                marker.className = 'ai-action-marker';
                marker.textContent = action.label;
                const x = rect.left + (Number(action.x || 0) - Number(camera.x || 0)) * rect.scaleX;
                const y = rect.top + (Number(action.y || 0) - Number(camera.y || 0) - 14) * rect.scaleY;
                marker.style.left = `${x}px`;
                marker.style.top = `${y}px`;
                markerNodes.push(marker);
            }

            layer.replaceChildren(...markerNodes);
        }

        makeDiv(className, text) {
            const div = document.createElement('div');
            div.className = className;
            div.textContent = text;
            return div;
        }

        makeRow(label, value) {
            const row = document.createElement('div');
            row.className = 'ai-row';
            const left = document.createElement('span');
            left.className = 'ai-label';
            left.textContent = label;
            const right = document.createElement('span');
            right.className = 'ai-value';
            right.textContent = value;
            row.appendChild(left);
            row.appendChild(right);
            return row;
        }
    }

    window.LemmingsAiPilot = LemmingsAiPilot;

    if (window.LEMMINGS_AI_PATCHED) return;
    window.LEMMINGS_AI_PATCHED = true;
    installVirtualInputPatch();

    function ensurePilot(game) {
        if (!aiEnabled || !game) return null;
        if (!game.aiPilot) game.aiPilot = new LemmingsAiPilot(game);
        return game.aiPilot;
    }

    if (typeof Game !== 'undefined') {
        const originalUpdate = Game.prototype.update;
        Game.prototype.update = function patchedAiUpdate(...args) {
            const pilot = ensurePilot(this);
            pilot?.beforeUpdate();
            const result = originalUpdate.apply(this, args);
            pilot?.afterUpdate();
            return result;
        };

        const originalRender = Game.prototype.render;
        Game.prototype.render = function patchedAiRender(...args) {
            const result = originalRender.apply(this, args);
            ensurePilot(this)?.afterRender();
            return result;
        };
    }

    if (typeof Lemming !== 'undefined') {
        const originalAssignSkill = Lemming.prototype.assignSkill;
        Lemming.prototype.assignSkill = function patchedAiAssignSkill(skill, ...args) {
            const previousState = this.state;
            const result = originalAssignSkill.call(this, skill, ...args);
            window.game?.aiPilot?.onSkillAssigned?.(this, skill, previousState);
            return result;
        };
    }
})();
