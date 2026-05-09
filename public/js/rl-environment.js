(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search || '');
    const rlEnabled = params.has('rl') || params.has('rlLab');

    if (!rlEnabled) return;

    const SKILLS = [
        'climber',
        'floater',
        'bomber',
        'blocker',
        'builder',
        'basher',
        'miner',
        'digger'
    ];

    const LEVEL_RATINGS = [
        'FUN',
        'TRICKY',
        'TAXING',
        'MAYHEM',
        'EXTRA1',
        'EXTRA2',
        'EXTRA3',
        'EXTRA4'
    ];

    const LEVELS_PER_RATING = 30;

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

    const DEAD_STATES = new Set([
        'dead',
        'drowning',
        'burning',
        'splatting'
    ]);

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

    function chooseWeighted(items, random) {
        if (!items.length) return null;
        const total = items.reduce((sum, item) => sum + Math.max(0.001, item.weight || 1), 0);
        let roll = random() * total;

        for (const item of items) {
            roll -= Math.max(0.001, item.weight || 1);
            if (roll <= 0) return item.value;
        }

        return items[items.length - 1].value;
    }

    function parseLevelId(levelId) {
        const text = String(levelId || 'FUN_01').trim().toUpperCase();
        const match = text.match(/^([A-Z0-9]+)_(\d{1,2})$/);
        if (!match) return { rating: 'FUN', number: 1 };

        const rating = LEVEL_RATINGS.includes(match[1]) ? match[1] : 'FUN';
        const number = Math.max(1, Math.min(LEVELS_PER_RATING, Number(match[2]) || 1));
        return { rating, number };
    }

    function formatLevelId(rating, number) {
        return `${rating}_${String(number).padStart(2, '0')}`;
    }

    function getNextLevelId(levelId) {
        const current = parseLevelId(levelId);
        if (current.number < LEVELS_PER_RATING) {
            return formatLevelId(current.rating, current.number + 1);
        }

        const ratingIndex = LEVEL_RATINGS.indexOf(current.rating);
        const nextRating = LEVEL_RATINGS[(ratingIndex + 1 + LEVEL_RATINGS.length) % LEVEL_RATINGS.length];
        return formatLevelId(nextRating, 1);
    }

    function parseReplaySpec(encoded) {
        if (!encoded) return null;
        try {
            return JSON.parse(decodeURIComponent(escape(window.atob(encoded))));
        } catch (error) {
            console.warn('Failed to parse RL replay:', error);
            return null;
        }
    }

    function parseReplaySpecFromStorage(key) {
        if (!key || typeof window === 'undefined' || !window.sessionStorage) return null;
        try {
            const raw = window.sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('Failed to parse stored RL replay:', error);
            return null;
        }
    }

    class LemmingsRLEnvironment {
        constructor(game) {
            this.game = game;
            this.replaySpec = parseReplaySpecFromStorage(params.get('rlReplayKey')) || parseReplaySpec(params.get('rlReplay'));
            this.replayMode = !!this.replaySpec;
            this.joinLive = this.replayMode && params.get('rlJoinLive') === '1';
            this.replayOnly = this.replayMode && !this.joinLive;
            this.joinFrame = Math.max(0, toInt(params.get('rlJoinFrame'), 0));
            this.replayCursor = 0;
            this.levelId = String(this.replaySpec?.level || params.get('rlLevel') || 'FUN_01').toUpperCase();
            this.seed = toInt(this.replaySpec?.seed ?? params.get('rlSeed'), Math.floor(Math.random() * 1000000));
            this.random = mulberry32(this.seed);
            this.decisionInterval = Math.max(12, toInt(params.get('rlDecision'), 90));
            this.liveSpeed = Math.max(1, toInt(params.get('rlLiveSpeed'), toInt(params.get('rlSpeed'), this.replayOnly ? 2 : 2)));
            this.catchupSpeed = Math.max(this.liveSpeed, toInt(params.get('rlCatchupSpeed'), 24));
            this.speed = this.joinLive && this.joinFrame > 0 ? this.catchupSpeed : Math.max(1, toInt(params.get('rlSpeed'), this.replayOnly ? 2 : this.liveSpeed));
            this.autoRestart = this.replayOnly ? false : params.get('rlAutoRestart') !== '0';
            this.autoNukeBlockers = params.get('rlAutoNukeBlockers') !== '0';
            this.autoAdvance = this.replayOnly ? false : params.get('rlAutoAdvance') !== '0';
            this.masteryFloorPercent = Math.max(1, Math.min(100, toInt(params.get('rlMasteryThreshold'), 60)));
            this.muteAudio = params.get('rlMute') !== '0';
            this.miniOverlay = params.get('rlMini') !== '0';
            this.theaterRole = params.get('rlTheaterRole') || 'contender';
            this.renderInterval = Math.max(1, toInt(params.get('rlRenderEvery'), this.miniOverlay ? 6 : 1));
            this.renderCounter = 0;
            this.trainerUrl = this.replayOnly ? '' : String(params.get('rlTrainer') || '').trim();
            this.trainerSocket = null;
            this.trainerConnected = false;
            this.trainerPending = false;
            this.trainerPendingFrame = 0;
            this.trainerRequestId = 0;
            this.trainerClientId = `${Date.now()}-${Math.floor(this.random() * 1000000)}`;
            this.enabled = true;
            this.booted = false;
            this.loading = false;
            this.frame = 0;
            this.decisionFrame = 0;
            this.restartCountdown = 0;
            this.attempt = 0;
            this.nextLemmingId = 1;
            this.reward = 0;
            this.lastReward = 0;
            this.bestSaved = 0;
            this.lastSaved = 0;
            this.lastDeaths = 0;
            this.lastReachabilityScore = null;
            this.visitedTiles = new Set();
            this.events = [];
            this.actions = [];
            this.markers = [];
            this.autoNukeTriggeredAttempt = 0;
            this.advancedAttempt = 0;

            this.installOverlay();
            this.applyAudioPreference();
            this.connectTrainer();
            this.syncGameSelectionToLevelId();
            this.publish();
        }

        publish() {
            window.lemmingsRLEnv = this;
        }

        setAudioMuted(muted = true) {
            this.muteAudio = !!muted;
            if (this.game.audio?.setVolumeStage) {
                this.game.audio.setVolumeStage(this.muteAudio ? 'off' : 'loud');
                return true;
            }
            return false;
        }

        setTheaterRole(role = 'contender') {
            this.theaterRole = role;
            if (role === 'spotlight') {
                this.renderInterval = 1;
            } else if (role === 'background') {
                this.renderInterval = 30;
            } else {
                this.renderInterval = 6;
            }
            return true;
        }

        shouldRenderFrame() {
            if (this.frame < 5) return true;
            const interval = Math.max(1, this.renderInterval || 1);
            if (interval <= 1) return true;
            this.renderCounter = (this.renderCounter + 1) % interval;
            return this.renderCounter === 0;
        }

        syncGameSelectionToLevelId() {
            const parsed = parseLevelId(this.levelId);
            if (Array.isArray(this.game.ratingOrder)) {
                const ratingIndex = this.game.ratingOrder.findIndex(rating => rating.prefix === parsed.rating);
                if (ratingIndex >= 0) this.game.selectedRatingIndex = ratingIndex;
            }
            this.game.selectedLevelNumber = parsed.number;
        }

        async boot() {
            if (this.booted || this.loading) return;
            this.booted = true;
            await this.reset();
        }

        async reset() {
            if (this.loading) return;
            this.loading = true;

            try {
                this.syncGameSelectionToLevelId();
                this.attempt++;
                this.frame = 0;
                this.decisionFrame = 20 + Math.floor(this.random() * 40);
                this.restartCountdown = 0;
                this.reward = 0;
                this.lastReward = 0;
                this.replayCursor = 0;
                this.lastSaved = 0;
                this.lastDeaths = 0;
                this.lastReachabilityScore = null;
                this.visitedTiles = new Set();
                this.actions = [];
                this.markers = [];
                this.events = [];
                this.nextLemmingId = 1;
                this.autoNukeTriggeredAttempt = 0;
                this.advancedAttempt = 0;

                this.applyAudioPreference();
                await this.game.loadLevel(this.levelId, { showBriefing: false, source: 'bundled', entry: null });
                this.applyAudioPreference();
                this.game.speedMultiplier = this.speed;
                this.game.beginPlayCycle();
                this.log(`attempt ${this.attempt} started on ${this.levelId}`);
                if (this.joinLive && this.joinFrame > 0) {
                    this.log(`catching up to frame ${this.joinFrame}`, 'action');
                }
            } catch (error) {
                this.log(`reset failed: ${error.message || error}`, 'warn');
            } finally {
                this.loading = false;
            }
        }

        beforeUpdate() {}

        connectTrainer() {
            if (!this.trainerUrl || typeof WebSocket === 'undefined') return false;
            if (this.trainerSocket &&
                (this.trainerSocket.readyState === WebSocket.CONNECTING ||
                    this.trainerSocket.readyState === WebSocket.OPEN)) {
                return true;
            }

            try {
                const socket = new WebSocket(this.trainerUrl);
                this.trainerSocket = socket;

                socket.addEventListener('open', () => {
                    this.trainerConnected = true;
                    this.log('trainer connected', 'action');
                });

                socket.addEventListener('message', event => {
                    this.handleTrainerMessage(event.data);
                });

                socket.addEventListener('close', () => {
                    this.trainerConnected = false;
                    this.trainerPending = false;
                    window.setTimeout(() => this.connectTrainer(), 2000);
                });

                socket.addEventListener('error', () => {
                    this.trainerConnected = false;
                });

                return true;
            } catch (error) {
                this.log(`trainer connect failed: ${error.message || error}`, 'warn');
                return false;
            }
        }

        applyAudioPreference() {
            if (this.game.audio?.setVolumeStage) {
                return this.game.audio.setVolumeStage(this.muteAudio ? 'off' : 'loud');
            }
            return false;
        }

        afterUpdate() {
            if (!this.enabled || this.loading) return;

            this.frame++;
            this.assignLemmingIds();
            this.observeReward();
            this.expireMarkers();
            this.maybeAutoNukeBlockers();
            this.maybeRunUrgentSkillProbe();
            this.updateTheaterCamera();

            if (this.replayMode) {
                this.applyReplayActions();
                if (this.joinLive && this.frame >= this.joinFrame) {
                    this.finishReplayJoin();
                }
            } else if (this.game.state === 'playing' && this.frame >= this.decisionFrame) {
                if (this.trainerConnected && !this.trainerPending) {
                    this.requestTrainerAction();
                } else if (!this.trainerPending) {
                    this.decide();
                } else if (this.frame - this.trainerPendingFrame > 80) {
                    this.trainerPending = false;
                    this.decide();
                }
                this.decisionFrame = this.frame + this.decisionInterval + Math.floor(this.random() * this.decisionInterval);
            }

            if (this.isTerminal()) {
                if (this.restartCountdown <= 0) {
                    this.maybeAdvanceLevel();
                    this.restartCountdown = 80;
                    this.log(`attempt ended: saved ${this.game.stats?.lemmingsSaved || 0}/${this.game.level?.num_lemmings || '?'}`);
                } else {
                    this.restartCountdown--;
                    if (this.restartCountdown <= 0 && this.autoRestart) {
                        this.reset();
                    }
                }
            }

            if (this.frame % 5 === 0) this.updateOverlay();
        }

        finishReplayJoin() {
            if (!this.joinLive || !this.replayMode) return false;
            this.replayMode = false;
            this.replayOnly = false;
            this.speed = this.liveSpeed;
            if (this.game) this.game.speedMultiplier = this.liveSpeed;
            this.decisionFrame = this.frame + Math.max(10, Math.floor(this.decisionInterval * 0.5));
            this.log(`joined live at frame ${this.frame}`, 'action');
            return true;
        }

        isTerminal() {
            return this.game.state === 'levelSuccess' ||
                this.game.state === 'levelFailure' ||
                (this.game.levelEndTriggered && this.game.state !== 'playing');
        }

        getSavedPercent() {
            const total = Number(this.game.level?.num_lemmings || 0);
            if (total <= 0) return 0;
            return Math.round((Number(this.game.stats?.lemmingsSaved || 0) / total) * 100);
        }

        getAdvanceThreshold() {
            const required = Number(this.game.level?.percent_needed || 0);
            if (Number.isFinite(required) && required > this.masteryFloorPercent) {
                return Math.min(100, Math.floor(required));
            }
            return this.masteryFloorPercent;
        }

        maybeAdvanceLevel() {
            if (!this.autoAdvance) return false;
            if (this.advancedAttempt === this.attempt) return false;

            const savedPercent = this.getSavedPercent();
            const threshold = this.getAdvanceThreshold();
            if (savedPercent < threshold) return false;

            const previousLevel = this.levelId;
            const nextLevel = getNextLevelId(previousLevel);
            this.levelId = nextLevel;
            this.advancedAttempt = this.attempt;
            this.log(`advanced: ${previousLevel} ${savedPercent}% >= ${threshold}% -> ${nextLevel}`, 'action');
            return true;
        }

        requestTrainerAction() {
            if (!this.trainerSocket || this.trainerSocket.readyState !== WebSocket.OPEN) return false;
            const requestId = ++this.trainerRequestId;
            this.trainerPending = true;
            this.trainerPendingFrame = this.frame;

            this.trainerSocket.send(JSON.stringify({
                type: 'decision',
                clientId: this.trainerClientId,
                requestId,
                observation: this.getObservation()
            }));

            return true;
        }

        handleTrainerMessage(raw) {
            let message = null;
            try {
                message = JSON.parse(raw);
            } catch {
                return false;
            }

            if (!message || message.type !== 'action') return false;
            this.trainerPending = false;
            this.applyTrainerAction(message);
            return true;
        }

        applyTrainerAction(message) {
            const actionIndex = Number(message.actionIndex ?? 0);
            const skill = String(message.skill || (actionIndex > 0 ? SKILLS[actionIndex - 1] : 'wait')).toLowerCase();

            if (!skill || skill === 'wait') {
                this.log('trainer chose WAIT', 'learning');
                return false;
            }

            const target = this.chooseTargetForSkill(skill);
            if (!target) {
                this.log(`trainer chose ${skill.toUpperCase()}, no valid target`, 'warn');
                return false;
            }

            return this.applySkill(skill, target, message.reason || 'gpu trainer');
        }

        chooseTargetForSkill(skill) {
            const candidates = this.getActionCandidates()
                .map(candidate => candidate.value)
                .filter(value => value && value.skill === skill && value.lemming);

            if (!candidates.length) return null;

            candidates.sort((a, b) => {
                const aContext = this.getLemmingContext(a.lemming);
                const bContext = this.getLemmingContext(b.lemming);
                return this.scoreSkill(skill, bContext) - this.scoreSkill(skill, aContext);
            });

            return candidates[0].lemming;
        }

        assignLemmingIds() {
            for (const lemming of this.game.lemmings || []) {
                if (!lemming.rlId) lemming.rlId = this.nextLemmingId++;
            }
        }

        observeReward() {
            const stats = this.game.stats || {};
            const saved = Number(stats.lemmingsSaved || 0);
            const deaths = this.countDeaths();
            let delta = 0;

            if (saved > this.lastSaved) delta += (saved - this.lastSaved) * 100;
            if (deaths > this.lastDeaths) delta -= (deaths - this.lastDeaths) * 15;

            const newTiles = this.observeVisitedTiles();
            delta += Math.min(4, newTiles * 0.05);

            const reachabilityScore = this.getBestReachabilityScore();
            if (reachabilityScore !== null && this.lastReachabilityScore !== null) {
                delta += Math.max(-2.5, Math.min(2.5, (reachabilityScore - this.lastReachabilityScore) * 0.025));
            }

            if (reachabilityScore !== null) this.lastReachabilityScore = reachabilityScore;

            this.lastSaved = saved;
            this.lastDeaths = deaths;
            this.lastReward = delta;
            this.reward += delta;

            const total = Number(this.game.level?.num_lemmings || 0);
            if (total > 0) {
                this.bestSaved = Math.max(this.bestSaved, Math.round((saved / total) * 100));
            }
        }

        observeVisitedTiles() {
            let added = 0;
            for (const lemming of this.game.lemmings || []) {
                if (!ACTIVE_STATES.has(lemming.state)) continue;
                const key = `${Math.floor(Number(lemming.x || 0) / 8)},${Math.floor(Number(lemming.y || 0) / 8)}`;
                if (!this.visitedTiles.has(key)) {
                    this.visitedTiles.add(key);
                    added++;
                }
            }
            return added;
        }

        getBestReachabilityScore() {
            const exits = this.game.level?.exitPositions || [];
            const active = (this.game.lemmings || []).filter(lemming => ACTIVE_STATES.has(lemming.state));
            if (!exits.length || !active.length) return null;

            let best = -Infinity;
            for (const lemming of active) {
                for (const exit of exits) {
                    best = Math.max(best, this.scoreReachableProgress(lemming, exit));
                }
            }

            return Number.isFinite(best) ? best : null;
        }

        scoreReachableProgress(lemming, exit) {
            const lx = Number(lemming.x || 0);
            const ly = Number(lemming.getFootY?.() ?? lemming.y ?? 0);
            const ex = Number(exit.x || 0);
            const ey = Number(exit.y || 0);
            const dx = ex - lx;
            const dy = ey - ly;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const potential = this.estimateRoutePotential(lemming, exit);

            // Larger is better: close, reachable lemmings produce positive shaping.
            // Unreachable-looking routes still get a tiny signal so exploration does
            // not go completely dark, but they cannot dominate real progress.
            return (1000 - Math.min(1000, distance)) * potential;
        }

        estimateRoutePotential(lemming, exit) {
            const skillCounts = this.game.skillCounts || {};
            const hasBuilder = (skillCounts.builder || 0) > 0 || lemming.state === 'building';
            const hasBasher = (skillCounts.basher || 0) > 0;
            const hasMiner = (skillCounts.miner || 0) > 0;
            const hasDigger = (skillCounts.digger || 0) > 0;
            const hasBomber = (skillCounts.bomber || 0) > 0;
            const hasClimber = (skillCounts.climber || 0) > 0 || lemming.isClimber;
            const hasFloater = (skillCounts.floater || 0) > 0 || lemming.isFloater;

            const lx = Number(lemming.x || 0);
            const ly = Number(lemming.getFootY?.() ?? lemming.y ?? 0);
            const ex = Number(exit.x || 0);
            const ey = Number(exit.y || 0);
            const dx = ex - lx;
            const dy = ey - ly;

            let potential = 1;

            const terrain = this.scanTerrainBetween(lx, ly, ex, ey);

            if (terrain.deadlySamples > 0) {
                potential *= hasBuilder || hasFloater ? 0.55 : 0.12;
            }

            if (terrain.steelSamples > 0) {
                potential *= hasBuilder || hasClimber ? 0.45 : 0.08;
            }

            if (terrain.solidSamples > 8) {
                potential *= hasBasher || hasMiner || hasDigger || hasBomber ? 0.85 : 0.18;
            }

            if (terrain.airGapSamples > 12) {
                potential *= hasBuilder || hasFloater ? 0.85 : 0.24;
            }

            // Exit above the lemming: climbing can handle a wall, builders can
            // make ramps. Without either, naive closeness is less meaningful.
            if (dy < -16 && !hasClimber && !hasBuilder) {
                potential *= 0.32;
            }

            // Exit below the lemming: miners/diggers/bombers can descend through
            // terrain; floaters can make big drops survivable if the path is open.
            if (dy > 20 && !hasMiner && !hasDigger && !hasBomber && !hasFloater) {
                potential *= 0.35;
            }

            const facingExit = Math.sign(dx || lemming.direction || 1) === Math.sign(lemming.direction || 1);
            if (!facingExit && !hasBuilder && !hasBasher && !hasMiner && !hasDigger) {
                potential *= 0.75;
            }

            return Math.max(0.04, Math.min(1, potential));
        }

        scanTerrainBetween(x1, y1, x2, y2) {
            const samples = Math.max(12, Math.min(80, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8)));
            const result = {
                solidSamples: 0,
                steelSamples: 0,
                deadlySamples: 0,
                airGapSamples: 0
            };

            for (let i = 1; i <= samples; i++) {
                const t = i / samples;
                const x = x1 + (x2 - x1) * t;
                const y = y1 + (y2 - y1) * t;
                const behavior = this.getTerrainBehaviorAt(x, y);

                if (behavior === 'water' || behavior === 'toxic') result.deadlySamples++;
                if (behavior === 'steel') result.steelSamples++;
                if (behavior && behavior !== 'empty' && behavior !== 'water' && behavior !== 'toxic') {
                    result.solidSamples++;
                }

                const supportY = y + 10;
                if (!this.hasCollisionAt(x, supportY) && !this.hasCollisionAt(x, supportY + 8)) {
                    result.airGapSamples++;
                }
            }

            return result;
        }

        getTerrainBehaviorAt(x, y) {
            if (this.game.level?.getBaseTerrainBehaviorAtPixel) {
                const baseBehavior = this.game.level.getBaseTerrainBehaviorAtPixel(x, y);
                if (baseBehavior) return baseBehavior;
            }

            if (this.game.level?.checkHazard?.(x, y, this.game.tilesetManager)) {
                return this.game.level.checkHazard(x, y, this.game.tilesetManager);
            }

            return this.hasCollisionAt(x, y) ? 'solid' : null;
        }

        countDeaths() {
            return (this.game.lemmings || []).filter(lemming => DEAD_STATES.has(lemming.state)).length;
        }

        maybeAutoNukeBlockers() {
            if (!this.autoNukeBlockers) return false;
            if (this.autoNukeTriggeredAttempt === this.attempt) return false;
            if (this.game.state !== 'playing' || this.game.paused || this.game.nukeActive) return false;
            if ((this.game.stats?.lemmingsLeftToSpawn || 0) > 0) return false;

            const inPlay = (this.game.lemmings || []).filter(lemming =>
                ACTIVE_STATES.has(lemming.state) &&
                !['exiting', 'drowning', 'burning', 'splatting', 'exploding'].includes(lemming.state)
            );

            if (inPlay.length === 0) return false;
            if (!inPlay.every(lemming => lemming.state === 'blocking')) return false;

            const activated = typeof this.game.activateNuke === 'function'
                ? this.game.activateNuke()
                : this.fallbackNukeInPlayLemmings(inPlay);

            if (!activated) return false;

            this.autoNukeTriggeredAttempt = this.attempt;
            this.actions.push({
                frame: this.frame,
                tick: this.game.stats?.timeElapsed || 0,
                attempt: this.attempt,
                lemmingId: null,
                skill: 'nuke',
                x: 0,
                y: 0,
                before: 'blocking-only',
                after: 'nuke',
                reason: 'only blockers remain'
            });
            if (this.actions.length > 80) this.actions.shift();
            this.log(`auto-nuke: ${inPlay.length} blocker${inPlay.length === 1 ? '' : 's'} left`, 'action');
            return true;
        }

        fallbackNukeInPlayLemmings(lemmings) {
            if (!Array.isArray(lemmings) || lemmings.length === 0) return false;
            if (this.game.stats) this.game.stats.lemmingsLeftToSpawn = 0;
            for (const lemming of lemmings) {
                if (lemming?.assignSkill && lemming.state !== 'exploding') {
                    lemming.assignSkill('bomber');
                }
            }
            return true;
        }

        getAvailableSkillIds() {
            const skillCounts = this.game.skillCounts || {};
            return SKILLS.filter(skill => (skillCounts[skill] || 0) > 0);
        }

        maybeRunUrgentSkillProbe() {
            if (this.game.state !== 'playing' || this.game.paused) return false;

            const available = this.getAvailableSkillIds();
            if (!available.includes('floater')) return false;

            const safeFall = Number(this.game.level?.fall_distance || 56);
            const probeFallDistance = Math.max(8, Math.min(18, Math.floor(safeFall * 0.35)));
            const target = (this.game.lemmings || []).find(lemming =>
                lemming &&
                lemming.state === 'falling' &&
                !lemming.isFloater &&
                Number(lemming.fallDistance || 0) >= probeFallDistance &&
                this.game.canAssignSkillToLemming?.('floater', lemming)
            );

            if (!target) return false;

            const onlySkill = available.length === 1;
            return this.applySkill(
                'floater',
                target,
                onlySkill ? 'single available skill under fall pressure' : 'survival experiment: long fall'
            );
        }

        decide() {
            const candidates = this.getActionCandidates();
            if (!candidates.length) return;

            const candidate = chooseWeighted(candidates, this.random);
            if (!candidate) return;

            this.applySkill(candidate.skill, candidate.lemming, candidate.reason);
        }

        getActionCandidates() {
            const skillCounts = this.game.skillCounts || {};
            const lemmings = (this.game.lemmings || []).filter(lemming => ACTIVE_STATES.has(lemming.state));
            const candidates = [];

            for (const lemming of lemmings) {
                for (const skill of SKILLS) {
                    if ((skillCounts[skill] || 0) <= 0) continue;
                    if (!this.game.canAssignSkillToLemming?.(skill, lemming)) continue;

                    const context = this.getLemmingContext(lemming);
                    candidates.push({
                        value: {
                            lemming,
                            skill,
                            reason: context.reason
                        },
                        weight: this.scoreSkill(skill, context)
                    });
                }
            }

            candidates.push({
                value: null,
                weight: Math.max(0.4, lemmings.length * 0.2)
            });

            return candidates;
        }

        getLemmingContext(lemming) {
            const wallAhead = this.hasCollisionAt(lemming.x + lemming.direction * 7, lemming.getFootY?.() - 5);
            const pitAhead = !this.hasCollisionAt(lemming.x + lemming.direction * 10, lemming.getFootY?.() + 6);
            const hazardAhead = this.hasHazardNear(lemming.x + lemming.direction * 12, lemming.getFootY?.());
            const reason = hazardAhead ? 'hazard nearby' : wallAhead ? 'wall ahead' : pitAhead ? 'drop ahead' : 'curiosity poke';
            return { wallAhead, pitAhead, hazardAhead, reason, state: lemming.state };
        }

        scoreSkill(skill, context) {
            let score = 1;
            const available = this.getAvailableSkillIds();

            if (context.hazardAhead && (skill === 'builder' || skill === 'blocker')) score += 3;
            if (context.wallAhead && (skill === 'basher' || skill === 'miner' || skill === 'climber' || skill === 'bomber')) score += 3;
            if (context.pitAhead && (skill === 'builder' || skill === 'floater' || skill === 'blocker')) score += 3;
            if (context.state === 'falling' && skill === 'floater') score += 9;
            if (available.length === 1 && available[0] === skill) score += 7;
            if (skill === 'bomber') score *= 0.35;
            if (skill === 'blocker' && context.state !== 'walking') score *= 0.2;

            return score;
        }

        hasCollisionAt(x, y) {
            if (!this.game.level?.checkCollision) return false;
            return !!this.game.level.checkCollision(x, y, this.game.tilesetManager);
        }

        hasHazardNear(x, y) {
            if (!this.game.level?.checkHazard) return false;
            for (let oy = -8; oy <= 8; oy += 8) {
                if (this.game.level.checkHazard(x, y + oy, this.game.tilesetManager)) return true;
            }
            return false;
        }

        applySkill(skill, lemming, reason = 'experiment') {
            if (!skill || !lemming) return false;
            if ((this.game.skillCounts?.[skill] || 0) <= 0) return false;
            if (!this.game.canAssignSkillToLemming?.(skill, lemming)) return false;

            const before = lemming.state;
            lemming.assignSkill(skill);
            this.game.skillCounts[skill] = Math.max(0, (this.game.skillCounts[skill] || 0) - 1);

            const action = {
                frame: this.frame,
                tick: this.game.stats?.timeElapsed || 0,
                attempt: this.attempt,
                lemmingId: lemming.rlId,
                skill,
                x: Math.round(Number(lemming.x || 0)),
                y: Math.round(Number(lemming.y || 0)),
                before,
                after: lemming.state,
                reason
            };

            this.actions.push(action);
            if (this.actions.length > 80) this.actions.shift();
            this.markers.push({ ...action, expires: this.frame + 120 });
            this.log(`#${action.lemmingId} ${skill.toUpperCase()} at ${action.x},${action.y} (${reason})`, 'action');
            return true;
        }

        applyReplayActions() {
            if (this.game.state !== 'playing') return false;
            const actions = Array.isArray(this.replaySpec?.actions) ? this.replaySpec.actions : [];
            let applied = false;

            while (this.replayCursor < actions.length) {
                const action = actions[this.replayCursor];
                if (!action || Number(action.frame || 0) > this.frame) break;
                this.replayCursor++;

                if (action.skill === 'nuke') {
                    this.game.activateNuke?.();
                    applied = true;
                    continue;
                }

                const target = this.findReplayTarget(action);
                if (target && this.applySkill(action.skill, target, 'replay')) {
                    applied = true;
                }
            }

            return applied;
        }

        findReplayTarget(action) {
            const live = (this.game.lemmings || []).filter(lemming => ACTIVE_STATES.has(lemming.state));
            const lemmingId = Number(action.lemmingId);
            if (Number.isFinite(lemmingId)) {
                const exact = live.find(lemming => lemming.rlId === lemmingId);
                if (exact) return exact;
            }

            const x = Number(action.x || 0);
            const y = Number(action.y || 0);
            let best = null;
            let bestDistance = Infinity;
            for (const lemming of live) {
                const dx = Number(lemming.x || 0) - x;
                const dy = Number(lemming.y || 0) - y;
                const distance = dx * dx + dy * dy;
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = lemming;
                }
            }

            return best;
        }

        updateTheaterCamera() {
            if (this.theaterRole === 'background') return false;
            if (!this.game.renderer || !this.game.level || !this.game.cursor) return false;

            const focus = this.getCameraFocus();
            if (!focus) return false;

            const renderer = this.game.renderer;
            renderer.updateCameraBounds?.(this.game.level);

            const viewportWidth = renderer.viewportWidth || renderer.logicalWidth || 336;
            const viewportHeight = renderer.viewportHeight || renderer.logicalHeight || 192;
            const targetX = Math.max(0, Math.min(renderer.camera.maxX || 0, Math.round(focus.x - viewportWidth * 0.5)));
            const targetY = Math.max(0, Math.min(renderer.camera.maxY || 0, Math.round(focus.y - viewportHeight * 0.45)));
            const smoothing = this.theaterRole === 'spotlight' ? 0.35 : 0.2;

            renderer.camera.x = Math.round(renderer.camera.x + (targetX - renderer.camera.x) * smoothing);
            renderer.camera.y = Math.round(renderer.camera.y + (targetY - renderer.camera.y) * smoothing);

            const cursorMaxY = this.game.getCursorWorldMaxY?.() ?? (this.game.getLevelPixelHeight?.() || 192) - 1;
            this.game.cursor.x = Math.max(0, Math.min((this.game.getLevelPixelWidth?.() || 896) - 1, Math.round(focus.x)));
            this.game.cursor.y = Math.max(0, Math.min(cursorMaxY, Math.round(focus.y)));
            this.game.cursor.setVisible?.(true);
            this.game.cursor.updateLemmingStack?.(this.game.lemmings || []);
            return true;
        }

        getCameraFocus() {
            const recentAction = this.actions.at?.(-1);
            if (recentAction && this.frame - recentAction.frame < 180) {
                return { x: recentAction.x, y: recentAction.y };
            }

            const lemmings = (this.game.lemmings || []).filter(lemming => ACTIVE_STATES.has(lemming.state));
            if (!lemmings.length) return null;

            let best = null;
            let bestScore = -Infinity;
            for (const lemming of lemmings) {
                const score = this.getLemmingContext(lemming).reachabilityScore;
                if (score > bestScore) {
                    bestScore = score;
                    best = lemming;
                }
            }

            return best ? { x: best.x, y: best.y } : null;
        }

        log(text, type = 'info') {
            this.events.push({
                frame: this.frame,
                attempt: this.attempt,
                type,
                text: String(text)
            });
            if (this.events.length > 12) this.events.shift();
        }

        expireMarkers() {
            this.markers = this.markers.filter(marker => marker.expires >= this.frame);
        }

        getObservation() {
            return {
                level: this.levelId,
                attempt: this.attempt,
                frame: this.frame,
                state: this.game.state,
                reward: this.reward,
                lastReward: this.lastReward,
                bestReachabilityScore: this.lastReachabilityScore,
                advanceThreshold: this.getAdvanceThreshold(),
                stats: { ...(this.game.stats || {}) },
                releaseRate: this.game.releaseRate,
                skillCounts: { ...(this.game.skillCounts || {}) },
                lemmings: (this.game.lemmings || []).map(lemming => ({
                    id: lemming.rlId || null,
                    x: Number(lemming.x || 0),
                    y: Number(lemming.y || 0),
                    direction: Number(lemming.direction || 1),
                    state: lemming.state,
                    isClimber: !!lemming.isClimber,
                    isFloater: !!lemming.isFloater,
                    buildCount: lemming.buildCount || 0
                })),
                exits: this.game.level?.exitPositions || [],
                entrances: this.game.level?.entrancePositions || []
            };
        }

        getPublicState() {
            const total = Number(this.game.level?.num_lemmings || 0);
            const saved = Number(this.game.stats?.lemmingsSaved || 0);
            return {
                level: this.levelId,
                seed: this.seed,
                attempt: this.attempt,
                frame: this.frame,
                gameState: this.game.state,
                reward: Math.round(this.reward * 10) / 10,
                lastReward: Math.round(this.lastReward * 100) / 100,
                saved,
                total,
                savedPercent: total > 0 ? Math.round((saved / total) * 100) : 0,
                advanceThreshold: this.getAdvanceThreshold(),
                autoAdvance: this.autoAdvance,
                nextLevel: getNextLevelId(this.levelId),
                bestSaved: this.bestSaved,
                deaths: this.countDeaths(),
                explored: this.visitedTiles.size,
                trainerConnected: this.trainerConnected,
                theaterRole: this.theaterRole,
                renderInterval: this.renderInterval,
                replayMode: this.replayMode,
                joinLive: this.joinLive,
                joinFrame: this.joinFrame,
                replayCursor: this.replayCursor,
                replayActions: this.actions.slice(),
                actions: this.actions.slice(-6),
                events: this.events.slice(-5)
            };
        }

        installOverlay() {
            if (!this.miniOverlay || typeof document === 'undefined') return;

            const style = document.createElement('style');
            style.textContent = `
                #rl-mini-overlay {
                    position: absolute;
                    left: 6px;
                    top: 6px;
                    z-index: 60;
                    padding: 5px 7px;
                    border: 1px solid rgba(255,255,255,0.48);
                    border-radius: 6px;
                    background: rgba(0,0,0,0.72);
                    color: #fff;
                    font: 11px/1.25 Consolas, monospace;
                    pointer-events: none;
                    text-shadow: 0 1px 2px #000;
                    min-width: 118px;
                }
                #rl-marker-layer {
                    position: absolute;
                    inset: 0;
                    z-index: 61;
                    pointer-events: none;
                    overflow: hidden;
                }
                .rl-action-marker {
                    position: absolute;
                    transform: translate(-50%, -100%);
                    color: #111;
                    background: #ffd84d;
                    border: 1px solid #fff5b0;
                    border-radius: 5px;
                    padding: 1px 4px;
                    font: 10px/1.2 Consolas, monospace;
                    box-shadow: 0 1px 6px rgba(0,0,0,0.6);
                    white-space: nowrap;
                }
            `;
            document.head.appendChild(style);

            this.overlay = document.createElement('div');
            this.overlay.id = 'rl-mini-overlay';
            this.overlay.textContent = 'RL booting';

            this.markerLayer = document.createElement('div');
            this.markerLayer.id = 'rl-marker-layer';

            const container = document.getElementById('game-container') || document.body;
            container.appendChild(this.overlay);
            container.appendChild(this.markerLayer);
        }

        updateOverlay() {
            if (!this.overlay) return;
            const state = this.getPublicState();
            this.overlay.textContent = [
                `RL ${state.level} #${state.attempt}`,
                `saved ${state.saved}/${state.total || '?'}`,
                `reward ${state.reward}`,
                `map ${state.explored}`
            ].join('\n');

            if (!this.markerLayer) return;
            const renderer = this.game.renderer;
            const canvas = renderer?.canvas;
            if (!renderer || !canvas) return;

            const canvasRect = canvas.getBoundingClientRect();
            const container = this.markerLayer.parentElement || document.body;
            const containerRect = container.getBoundingClientRect();
            const scaleX = canvasRect.width / (renderer.logicalWidth || canvas.width || 336);
            const scaleY = canvasRect.height / (renderer.logicalHeight || canvas.height || 192);
            const camera = renderer.camera || { x: 0, y: 0 };
            const nodes = [];

            for (const marker of this.markers) {
                const x = canvasRect.left - containerRect.left + (marker.x - camera.x) * scaleX;
                const y = canvasRect.top - containerRect.top + (marker.y - camera.y - 8) * scaleY;
                if (x < -30 || y < -30 || x > containerRect.width + 30 || y > containerRect.height + 30) continue;

                const node = document.createElement('div');
                node.className = 'rl-action-marker';
                node.textContent = marker.skill.toUpperCase();
                node.style.left = `${x}px`;
                node.style.top = `${y}px`;
                nodes.push(node);
            }

            this.markerLayer.replaceChildren(...nodes);
        }
    }

    function ensureEnvironment(game) {
        if (!game) return null;
        if (!game.rlEnvironment) game.rlEnvironment = new LemmingsRLEnvironment(game);
        return game.rlEnvironment;
    }

    if (typeof Game !== 'undefined' && !Game.prototype.__lemmingsRlEnvironmentPatched) {
        Game.prototype.__lemmingsRlEnvironmentPatched = true;

        const originalInitialize = Game.prototype.initialize;
        Game.prototype.initialize = async function patchedRlInitialize(...args) {
            const result = await originalInitialize.apply(this, args);
            await ensureEnvironment(this)?.boot();
            return result;
        };

        const originalUpdate = Game.prototype.update;
        Game.prototype.update = function patchedRlUpdate(...args) {
            const env = ensureEnvironment(this);
            env?.beforeUpdate();
            const result = originalUpdate.apply(this, args);
            env?.afterUpdate();
            return result;
        };
    }
})();
