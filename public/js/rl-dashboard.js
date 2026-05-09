(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search || '');
    const defaultLevel = String(params.get('level') || 'FUN_01').toUpperCase();
    const defaultRuns = Math.max(10, Math.min(120, Number(params.get('sims') || params.get('runs') || 40) || 40));
    const visibleContenders = Math.max(1, Math.min(9, Number(params.get('contenders') || 9) || 9));
    const trainerUrl = String(params.get('trainer') || 'ws://127.0.0.1:8765').trim();

    const LEVEL_RATINGS = ['FUN', 'TRICKY', 'TAXING', 'MAYHEM', 'EXTRA1', 'EXTRA2', 'EXTRA3', 'EXTRA4'];

    const state = {
        level: defaultLevel,
        runs: defaultRuns,
        worker: null,
        runData: [],
        replayPool: [],
        contenderTiles: [],
        spotlightIndex: -1,
        spotlightMode: 'follow',
        spotlightKey: '',
        replayFrame: null,
        replayChangedAt: 0,
        bootedAt: Date.now(),
        trainerConnected: false,
        actionHistory: [],
        pinnedRunId: ''
    };

    function make(tag, className, text = '') {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function clampPercent(value) {
        return Math.max(0, Math.min(100, Number(value) || 0));
    }

    function levelRank(levelId) {
        const match = String(levelId || 'FUN_01').toUpperCase().match(/^([A-Z0-9]+)_(\d{1,2})$/);
        if (!match) return 0;
        const ratingIndex = Math.max(0, LEVEL_RATINGS.indexOf(match[1]));
        const levelNumber = Math.max(1, Math.min(30, Number(match[2]) || 1));
        return ratingIndex * 30 + levelNumber;
    }

    function runId(runState) {
        if (!runState) return '';
        return \`\${runState.index}:\${runState.level}:\${runState.seed}:\${runState.attempt}\`;
    }

    function scoreForSpotlight(runState) {
        if (!runState) return -Infinity;
        return levelRank(runState.level) * 1000000 +
            (runState.bestSaved || 0) * 3000 +
            (runState.savedPercent || 0) * 1800 +
            Math.min(50000, Math.max(0, runState.frame || 0)) +
            (runState.reward || 0) +
            Math.min(1000, (runState.actions?.length || 0) * 5);
    }

    function latestEventText(runState) {
        const action = runState?.actions?.at?.(-1);
        if (action?.skill) return \`\${action.skill.toUpperCase()} at \${action.x},\${action.y}: \${action.reason}\`;
        if (runState?.gameState === 'levelSuccess') return \`Solved attempt with \${runState.savedPercent}% saved\`;
        if (runState?.gameState === 'levelFailure') return \`Attempt ended with \${runState.savedPercent}% saved\`;
        return 'Searching for useful skill timing';
    }

    function skillColor(skill) {
        const colors = {
            climber: '#6ee7b7',
            floater: '#93c5fd',
            bomber: '#fb7185',
            blocker: '#facc15',
            builder: '#fdba74',
            basher: '#c084fc',
            miner: '#a3e635',
            digger: '#f9a8d4',
            nuke: '#ff4d4d'
        };
        return colors[skill] || '#ffd84d';
    }

    function storeReplaySpec(runState, mode) {
        const actions = Array.isArray(runState.replayActions)
            ? runState.replayActions
            : Array.isArray(runState.actions)
                ? runState.actions
                : [];

        const spec = {
            level: runState.level,
            seed: runState.seed,
            attempt: runState.attempt,
            mode,
            frame: runState.frame || 0,
            actions
        };

        const key = \`lemmings-rl-theater-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`;
        try {
            window.sessionStorage.setItem(key, JSON.stringify(spec));
        } catch (error) {
            console.warn('Could not store theatre replay spec:', error);
        }
        return key;
    }

    function theaterUrl(runState, mode) {
        const isFollow = mode === 'follow';
        const isJoin = mode === 'join';
        const isStart = mode === 'start';

        const query = new URLSearchParams({
            rl: '1',
            rlLevel: runState.level,
            rlSeed: String(runState.seed),
            rlDecision: '90',
            rlAutoRestart: isStart ? '0' : '1',
            rlAutoAdvance: isStart ? '0' : '1',
            rlMute: '0',
            rlMini: '1',
            rlRenderEvery: '1',
            rlTheaterRole: 'spotlight'
        });

        if (!isStart) {
            query.set('rlTrainer', trainerUrl);
        }

        if (isFollow) {
            query.set('rlSpeed', '2');
            query.set('rlLiveSpeed', '2');
        } else {
            const key = storeReplaySpec(runState, mode);
            query.set('rlReplayKey', key);
            query.set('rlSpeed', isJoin ? '24' : '1');
            query.set('rlLiveSpeed', '2');
            if (isJoin) {
                query.set('rlJoinLive', '1');
                query.set('rlJoinFrame', String(Math.max(0, Number(runState.frame || 0) - 120)));
                query.set('rlCatchupSpeed', '24');
            }
        }

        return \`index.html?\${query.toString()}\`;
    }

    function relabelSummary() {
        const labels = [
            ['summary-live', 'Furthest Level'],
            ['summary-best', 'Level Best'],
            ['summary-reward', 'Best Reward'],
            ['summary-actions', 'Actions / Min'],
            ['summary-explored', 'Finished Runs'],
            ['summary-trainer', 'Trainer']
        ];

        for (const [id, text] of labels) {
            const value = document.getElementById(id);
            const label = value?.parentElement?.querySelector?.('.summary-label');
            if (label) label.textContent = text;
        }
    }

    function installTheaterButtons() {
        if (document.getElementById('theater-follow')) return;

        const controls = document.querySelector('.controls');
        if (!controls) return;

        const follow = document.createElement('button');
        follow.id = 'theater-follow';
        follow.type = 'button';
        follow.textContent = 'Follow Furthest';
        follow.dataset.theaterMode = 'follow';

        const join = document.createElement('button');
        join.id = 'theater-join';
        join.type = 'button';
        join.textContent = 'Join Mid-Level';
        join.dataset.theaterMode = 'join';

        const start = document.createElement('button');
        start.id = 'theater-start';
        start.type = 'button';
        start.textContent = 'Watch From Start';
        start.dataset.theaterMode = 'start';

        controls.append(follow, join, start);

        controls.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-theater-mode]');
            if (!button) return;
            state.spotlightMode = button.dataset.theaterMode || 'follow';
            state.spotlightKey = '';
            state.pinnedRunId = '';
            updateTheaterButtonState();
            renderDashboard(true);
        });

        updateTheaterButtonState();
    }

    function updateTheaterButtonState() {
        document.querySelectorAll('[data-theater-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.theaterMode === state.spotlightMode);
        });
    }

    function buildRuns() {
        if (state.worker) state.worker.terminate();

        const stage = document.getElementById('spotlight-stage');
        const empty = document.getElementById('spotlight-empty');
        const rail = document.getElementById('run-grid');
        stage.replaceChildren(empty);
        rail.replaceChildren();

        state.runData = [];
        state.replayPool = [];
        state.contenderTiles = [];
        state.spotlightIndex = -1;
        state.spotlightKey = '';
        state.replayFrame = null;
        state.replayChangedAt = 0;
        state.bootedAt = Date.now();
        state.trainerConnected = false;
        state.actionHistory = [];
        state.pinnedRunId = '';

        for (let i = 0; i < visibleContenders; i++) {
            const tile = make('section', 'run-tile sim-tile');
            const panel = make('div', 'sim-stat-panel');
            panel.append(
                make('div', 'sim-rank', \`#\${i + 1}\`),
                make('div', 'sim-level', 'booting'),
                make('div', 'sim-meter', ''),
                make('div', 'sim-detail', 'waiting for worker')
            );

            const footer = make('div', 'run-footer');
            footer.append(
                make('span', 'run-name', \`Sim \${i + 1}\`),
                make('span', 'run-stats', 'headless')
            );

            tile.append(panel, footer);
            rail.appendChild(tile);
            state.contenderTiles.push({ tile, panel, footer });
        }

        updateGridClass();
        updateDirector(null, 'Starting headless simulation pool');
        updateSummary();

        state.worker = new Worker('js/headless-sim-worker.js');
        state.worker.onmessage = handleWorkerMessage;
        state.worker.onerror = event => {
            updateDirector(null, \`Worker error: \${event.message || 'check console'}\`);
        };
        state.worker.postMessage({
            type: 'start',
            runs: state.runs,
            level: state.level,
            seed: Date.now(),
            trainerUrl
        });
    }

    function updateGridClass() {
        const grid = document.getElementById('run-grid');
        grid.dataset.runs = String(state.runs);
    }

    function handleWorkerMessage(event) {
        const msg = event.data || {};
        if (msg.type === 'summary') {
            state.runData = Array.isArray(msg.runs) ? msg.runs : [];
            state.trainerConnected = !!msg.trainerConnected;
            rememberActionCounts(state.runData);
            renderDashboard();
            return;
        }
        if (msg.type === 'result' && msg.run) {
            state.replayPool.push(msg.run);
            state.replayPool.sort((a, b) => scoreForSpotlight(b) - scoreForSpotlight(a));
            state.replayPool = state.replayPool.slice(0, 30);
            renderDashboard();
        }
    }

    function rememberActionCounts(runs) {
        const total = runs.reduce((sum, run) => sum + (run.actions?.length || 0), 0);
        const now = Date.now();
        state.actionHistory.push({ now, total });
        state.actionHistory = state.actionHistory.filter(item => now - item.now <= 65000);
    }

    function actionsPerMinute() {
        if (state.actionHistory.length < 2) return 0;
        const first = state.actionHistory[0];
        const last = state.actionHistory[state.actionHistory.length - 1];
        const minutes = Math.max(1 / 60, (last.now - first.now) / 60000);
        return Math.max(0, Math.round((last.total - first.total) / minutes));
    }

    function rankedRuns() {
        return [...state.runData].sort((a, b) => scoreForSpotlight(b) - scoreForSpotlight(a));
    }

    function currentFurthestRun() {
        return rankedRuns().find(run => run && run.frame > 60) || null;
    }

    function pickSpotlight() {
        const furthest = currentFurthestRun();
        if (!furthest) return null;

        const now = Date.now();
        const mode = state.spotlightMode;
        const id = runId(furthest);

        if ((mode === 'join' || mode === 'start') && state.pinnedRunId) {
            const pinned = state.runData.find(run => runId(run) === state.pinnedRunId);
            if (pinned) return { ...pinned, theaterMode: mode };
        }

        if (mode === 'join' || mode === 'start') {
            state.pinnedRunId = id;
            return { ...furthest, theaterMode: mode };
        }

        if (state.replayFrame && state.spotlightIndex >= 0 && now - state.replayChangedAt < 8000) {
            const current = state.runData.find(run => run.index === state.spotlightIndex);
            if (current && levelRank(furthest.level) <= levelRank(current.level)) {
                return null;
            }
        }

        return { ...furthest, theaterMode: 'follow' };
    }

    function renderDashboard(forceSpotlight = false) {
        const rows = rankedRuns();
        const spotlight = pickSpotlight();
        if (spotlight) updateSpotlight(spotlight, forceSpotlight);
        updateContenderRail(rows);
        updateSummary(rows);

        const current = spotlight || rows[0] || null;
        if (current) {
            const modeText = state.spotlightMode === 'join'
                ? 'joining mid-level catch-up'
                : state.spotlightMode === 'start'
                    ? 'watching selected run from the start'
                    : 'following furthest live run';
            const reason = \`\${modeText}; \${current.savedPercent}/\${current.advanceThreshold || 60}% saved, reward \${current.reward || 0}\`;
            updateDirector(current, reason);
        } else {
            updateDirector(null, 'Waiting for worker results');
        }
    }

    function updateContenderRail(rows) {
        for (let i = 0; i < state.contenderTiles.length; i++) {
            const slot = state.contenderTiles[i];
            const run = rows[i];
            const rank = slot.panel.querySelector('.sim-rank');
            const level = slot.panel.querySelector('.sim-level');
            const meter = slot.panel.querySelector('.sim-meter');
            const detail = slot.panel.querySelector('.sim-detail');
            const name = slot.footer.querySelector('.run-name');
            const stats = slot.footer.querySelector('.run-stats');

            if (!run) {
                rank.textContent = \`#\${i + 1}\`;
                level.textContent = 'booting';
                meter.style.setProperty('--fill', '0%');
                detail.textContent = 'waiting for worker';
                name.textContent = \`Sim \${i + 1}\`;
                stats.textContent = 'headless';
                slot.tile.dataset.best = '0';
                slot.tile.dataset.spotlight = '0';
                continue;
            }

            const latest = run.actions?.at?.(-1);
            const saved = clampPercent(run.savedPercent);
            rank.textContent = \`#\${i + 1}\`;
            level.textContent = \`\${run.level} | Run \${run.index + 1}\`;
            meter.style.setProperty('--fill', \`\${saved}%\`);
            detail.textContent = latest ? \`\${latest.skill} @ \${latest.x},\${latest.y}\` : \`attempt \${run.attempt}, frame \${run.frame}\`;
            name.textContent = \`Run \${run.index + 1} #\${run.attempt}\`;
            stats.textContent = \`\${saved}% | R \${run.reward || 0}\`;
            slot.tile.style.setProperty('--accent', latest ? skillColor(latest.skill) : '#ffd84d');
            slot.tile.dataset.best = i === 0 ? '1' : '0';
            slot.tile.dataset.spotlight = run.index === state.spotlightIndex ? '1' : '0';
        }
    }

    function updateSpotlight(runState, force = false) {
        const stage = document.getElementById('spotlight-stage');
        const actions = runState.replayActions || runState.actions || [];
        const mode = runState.theaterMode || state.spotlightMode || 'follow';

        if ((mode === 'join' || mode === 'start') && !actions.length) return;

        const liveBucket = mode === 'follow' ? Math.floor((runState.frame || 0) / 900) : 'fixed';
        const key = \`\${mode}:\${runState.index}:\${runState.level}:\${runState.seed}:\${runState.attempt}:\${liveBucket}\`;
        if (!force && state.spotlightKey === key && state.replayFrame) return;

        const tile = make('section', 'run-tile');
        tile.dataset.visible = '1';
        tile.dataset.spotlight = '1';

        const frameWrap = make('div', 'frame-wrap');
        const iframe = document.createElement('iframe');
        iframe.src = theaterUrl(runState, mode);
        iframe.title = \`Theatre AI run \${runState.index + 1}\`;
        iframe.loading = 'eager';
        iframe.setAttribute('allow', 'autoplay');
        frameWrap.appendChild(iframe);

        const modeLabel = mode === 'join'
            ? 'joined mid-level'
            : mode === 'start'
                ? 'from start'
                : 'furthest live';

        const footer = make('div', 'run-footer');
        footer.append(
            make('span', 'run-name', \`Theatre \${runState.index + 1}\`),
            make('span', 'run-stats', \`\${runState.level} | \${modeLabel} | \${runState.savedPercent}% saved\`)
        );

        tile.append(frameWrap, footer);
        stage.replaceChildren(tile);
        state.spotlightIndex = runState.index;
        state.spotlightKey = key;
        state.replayFrame = { iframe, tile, footer };
        state.replayChangedAt = Date.now();
    }

    function updateDirector(runState, reason) {
        const run = document.getElementById('director-run');
        const why = document.getElementById('director-reason');
        const event = document.getElementById('director-event');

        if (!runState) {
            run.textContent = 'Waiting';
            why.textContent = reason || 'Looking for the strongest run';
            event.textContent = 'No events yet';
            return;
        }

        run.textContent = \`Run \${runState.index + 1} on \${runState.level}\`;
        why.textContent = reason || \`\${runState.savedPercent}% saved, reward \${runState.reward || 0}\`;
        event.textContent = latestEventText(runState);
    }

    function updateSummary(rows = state.runData) {
        const furthest = rows[0] || null;
        let bestOnFurthest = 0;
        let bestReward = -Infinity;

        if (furthest) {
            const furthestRank = levelRank(furthest.level);
            for (const run of rows) {
                if (levelRank(run.level) === furthestRank) {
                    bestOnFurthest = Math.max(bestOnFurthest, run.bestSaved || run.savedPercent || 0);
                }
                bestReward = Math.max(bestReward, run.reward || 0);
            }
        }

        document.getElementById('summary-live').textContent = furthest ? furthest.level : state.level;
        document.getElementById('summary-best').textContent = \`\${Math.round(bestOnFurthest)}%\`;
        document.getElementById('summary-reward').textContent = Number.isFinite(bestReward) ? String(Math.round(bestReward * 10) / 10) : '0';
        document.getElementById('summary-actions').textContent = String(actionsPerMinute());
        document.getElementById('summary-explored').textContent = String(state.replayPool.length);
        document.getElementById('summary-trainer').textContent = state.trainerConnected ? 'GPU on' : 'local';
    }

    function bindControls() {
        relabelSummary();
        installTheaterButtons();

        const levelInput = document.getElementById('level-input');
        levelInput.value = state.level;
        levelInput.addEventListener('change', () => {
            state.level = String(levelInput.value || 'FUN_01').toUpperCase();
            buildRuns();
        });

        document.getElementById('restart-runs').addEventListener('click', buildRuns);

        for (const button of document.querySelectorAll('[data-runs]')) {
            button.addEventListener('click', () => {
                state.runs = Math.max(10, Math.min(120, Number(button.dataset.runs) || 40));
                document.querySelectorAll('[data-runs]').forEach(node => node.classList.toggle('active', node === button));
                buildRuns();
            });
            button.classList.toggle('active', Number(button.dataset.runs) === state.runs);
        }
    }

    function init() {
        bindControls();
        buildRuns();
    }

    window.addEventListener('beforeunload', () => {
        if (state.worker) state.worker.terminate();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();