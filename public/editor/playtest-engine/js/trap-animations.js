// Multi-Tile Trap Animation Manager
// Handles constant-loop traps and INI-driven triggered trap instances.

class TrapAnimationManager {
    constructor() {
        // Animation images
        this.spinnerTop = null;
        this.flamethrower = null;
        this.crusher = null;
        this.noose = null;
        this.bearTrap = null;
        this.drip = null;

        // Synced timing for always-looping trap animations.
        // Same cadence as water / torch loops: advance every 8 game frames.
        this.constantFrame = 0;
        this.frameCounter = 0;

        // Triggered trap instances from the level INI.
        this.trapInstances = [];
        this.trapStates = new Map();

        // Kept for older tile-ID fallback drawing.
        this.triggeredTraps = new Map();

        // Trap animation/cooldown timing is in simulation frames.
        // Walking animations advance every 4 sim frames, so triggered traps advance
        // every 8 sim frames: half the walking animation speed.
        this.triggeredFrameDelay = 7;
        this.cooldownFramesAfterAnimation = 0; // two walking frames at frameDelay 4

        // trap_type values from the editor:
        // 1 = Crusher (Brick)
        // 2 = Noose (Sand 2 / Yellow)
        // 3 = Bear Trap (Grass)
        // 4 = Tap/Drip (SEGA)
        this.trapTypeDefinitions = {
            1: { name: 'crusher', image: 'crusher', width: 4, height: 2, frameWidth: 32, frameHeight: 16, frames: 6, frameAxis: 'y' },
            2: { name: 'noose', image: 'noose', width: 1, height: 4, frameWidth: 8, frameHeight: 32, frames: 5, frameAxis: 'x' },
            3: { name: 'bearTrap', image: 'bearTrap', width: 2, height: 2, frameWidth: 16, frameHeight: 16, frames: 7, frameAxis: 'y' },
            4: { name: 'drip', image: 'drip', width: 1, height: 4, frameWidth: 8, frameHeight: 32, frames: 5, frameAxis: 'x' }
        };

        // Constant-loop animations
        this.constantAnimations = {
            'Brick': {
                // Spinner_Top.png
                // 3 tiles wide × 1 tile high, 4 frames, frames stacked vertically.
                // Tiles left-to-right: 152 153 154
                152: this.makeAnimation('spinnerTop', 24, 8, 4, 0, 0, 'y'),
                153: this.makeAnimation('spinnerTop', 24, 8, 4, 1, 0, 'y'),
                154: this.makeAnimation('spinnerTop', 24, 8, 4, 2, 0, 'y'),
				155: this.makeAnimation('spinnerTop', 24, 8, 4, 0, 0, 'y'),
                156: this.makeAnimation('spinnerTop', 24, 8, 4, 1, 0, 'y'),
                157: this.makeAnimation('spinnerTop', 24, 8, 4, 2, 0, 'y'),
            },
            'Fire': {
                // Flamethrower.png
                // 4 tiles wide × 2 tiles high, 6 frames, frames stacked vertically.
                // Top row:    41 42 43 44
                // Bottom row: 53 54 55 56
                41: this.makeAnimation('flamethrower', 32, 16, 6, 0, 0, 'y'),
                42: this.makeAnimation('flamethrower', 32, 16, 6, 1, 0, 'y'),
                43: this.makeAnimation('flamethrower', 32, 16, 6, 2, 0, 'y'),
                44: this.makeAnimation('flamethrower', 32, 16, 6, 3, 0, 'y'),
                53: this.makeAnimation('flamethrower', 32, 16, 6, 0, 1, 'y'),
                54: this.makeAnimation('flamethrower', 32, 16, 6, 1, 1, 'y'),
                55: this.makeAnimation('flamethrower', 32, 16, 6, 2, 1, 'y'),
                56: this.makeAnimation('flamethrower', 32, 16, 6, 3, 1, 'y')
            },
            'Fire2': {
                41: this.makeAnimation('flamethrower', 32, 16, 6, 0, 0, 'y'),
                42: this.makeAnimation('flamethrower', 32, 16, 6, 1, 0, 'y'),
                43: this.makeAnimation('flamethrower', 32, 16, 6, 2, 0, 'y'),
                44: this.makeAnimation('flamethrower', 32, 16, 6, 3, 0, 'y'),
                53: this.makeAnimation('flamethrower', 32, 16, 6, 0, 1, 'y'),
                54: this.makeAnimation('flamethrower', 32, 16, 6, 1, 1, 'y'),
                55: this.makeAnimation('flamethrower', 32, 16, 6, 2, 1, 'y'),
                56: this.makeAnimation('flamethrower', 32, 16, 6, 3, 1, 'y')
            }
        };

        // Tile-ID fallback for triggered animation first frames. The proper
        // INI-driven path is drawTrapInstances(), because the first frame should
        // overwrite whatever happens to be in the level.
        this.triggeredAnimations = {
            'Brick': {
                213: this.makeAnimation('crusher', 32, 16, 6, 0, 0, 'y'),
                104: this.makeAnimation('crusher', 32, 16, 6, 1, 0, 'y'),
                214: this.makeAnimation('crusher', 32, 16, 6, 2, 0, 'y'),
                231: this.makeAnimation('crusher', 32, 16, 6, 3, 0, 'y'),
                215: this.makeAnimation('crusher', 32, 16, 6, 0, 1, 'y'),
                216: this.makeAnimation('crusher', 32, 16, 6, 1, 1, 'y'),
                217: this.makeAnimation('crusher', 32, 16, 6, 2, 1, 'y'),
                218: this.makeAnimation('crusher', 32, 16, 6, 3, 1, 'y')
            },
            'Sand 2': {
                227: this.makeAnimation('noose', 8, 32, 5, 0, 0, 'x'),
                225: this.makeAnimation('noose', 8, 32, 5, 0, 1, 'x'),
                224: this.makeAnimation('noose', 8, 32, 5, 0, 2, 'x'),
                149: this.makeAnimation('noose', 8, 32, 5, 0, 3, 'x')
            },
            'Grass': {
                103: this.makeAnimation('bearTrap', 16, 16, 7, 0, 0, 'y'),
                104: this.makeAnimation('bearTrap', 16, 16, 7, 1, 0, 'y'),
                93: this.makeAnimation('bearTrap', 16, 16, 7, 0, 1, 'y'),
                111: this.makeAnimation('bearTrap', 16, 16, 7, 1, 1, 'y')
            },
            'Sega': {
                131: this.makeAnimation('drip', 8, 32, 5, 0, 0, 'x'),
                143: this.makeAnimation('drip', 8, 32, 5, 0, 1, 'x'),
                146: this.makeAnimation('drip', 8, 32, 5, 0, 2, 'x'),
                149: this.makeAnimation('drip', 8, 32, 5, 0, 3, 'x')
            }
        };
    }

    makeAnimation(image, frameWidth, frameHeight, frames, tileX, tileY, frameAxis) {
        return { image, frameWidth, frameHeight, frames, tileX, tileY, frameAxis };
    }

    async load() {
        const spinnerData = await Utils.loadIndexedImage('assets/Spinner_Top.png');
        const flamethrowerData = await Utils.loadIndexedImage('assets/Flamethrower.png');
        const crusherData = await Utils.loadIndexedImage('assets/Crusher.png');
        const nooseData = await Utils.loadIndexedImage('assets/Noose.png');
        const bearTrapData = await Utils.loadIndexedImage('assets/Bear_Trap.png');
        const dripData = await Utils.loadIndexedImage('assets/Drip.png');

        this.spinnerTop = spinnerData.image;
        this.flamethrower = flamethrowerData.image;
        this.crusher = crusherData.image;
        this.noose = nooseData.image;
        this.bearTrap = bearTrapData.image;
        this.drip = dripData.image;

        console.log('Trap animations loaded');
    }

    setTrapInstances(trapInstances = []) {
        this.trapInstances = trapInstances;
        this.trapStates.clear();

        for (const trap of this.trapInstances) {
            this.trapStates.set(trap.id, {
                frame: 0,
                frameCounter: 0,
                isPlaying: false,
                cooldown: 0
            });
        }
    }

    updateConstantAnimations() {
        // Constant loops: same cadence as tile animations.
        // This is visual-only, so it should not be multiplied by fast-forward.
        this.frameCounter++;
        if (this.frameCounter >= 8) {
            this.frameCounter = 0;
            this.constantFrame++;
        }
    }

    updateTriggeredTraps() {
        // Triggered traps are gameplay state, so this is called once per
        // simulation step. Fast-forward runs more simulation steps, keeping trap
        // cooldowns aligned with lemming movement/release timing.
        for (const trap of this.trapInstances) {
            const state = this.trapStates.get(trap.id);
            if (!state) continue;

            const definition = this.trapTypeDefinitions[trap.type];
            if (!definition) continue;

            if (state.isPlaying) {
                state.frameCounter++;

                if (state.frameCounter >= this.triggeredFrameDelay) {
                    state.frameCounter = 0;
                    state.frame++;

                    if (state.frame >= definition.frames) {
                        state.frame = 0;
                        state.isPlaying = false;
                        state.cooldown = this.cooldownFramesAfterAnimation;
                    }
                }
            } else if (state.cooldown > 0) {
                state.cooldown--;
            }
        }

        // Older tile-ID triggered fallback.
        for (const [, state] of this.triggeredTraps) {
            if (!state.isPlaying) continue;

            state.frameCounter++;
            if (state.frameCounter < this.triggeredFrameDelay) continue;

            state.frameCounter = 0;
            state.frame++;

            const anim = this.getTriggeredAnimation(state.tilesetName, state.tileId);
            if (!anim || state.frame >= anim.frames) {
                state.frame = 0;
                state.isPlaying = false;
            }
        }
    }

    update() {
        // Backwards-compatible one-shot update for any older callers.
        this.updateConstantAnimations();
        this.updateTriggeredTraps();
    }

    isTrapEnabled(trap) {
        const state = this.trapStates.get(trap.id);
        return !!state && !state.isPlaying && state.cooldown <= 0;
    }

    tryTriggerTrapAt(feetX, feetY) {
    const triggerX = Math.floor(feetX);
    const triggerY = Math.floor(feetY);

    for (const trap of this.trapInstances) {
        if (!this.isTrapEnabled(trap)) continue;

        // trap_x/trap_y are exact pixel trigger points from the MLM/INI.
        // Nearby pixels must not fire the trap.
        if (triggerX === Math.floor(trap.x) &&
            triggerY === Math.floor(trap.y)) {
            this.triggerTrapInstance(trap);
            return trap;
        }
    }

    return null;
}

 
    triggerTrapInstance(trap) {
        const state = this.trapStates.get(trap.id);
        if (!state || state.isPlaying || state.cooldown > 0) return false;

        state.frame = 0;
        state.frameCounter = 0;
        state.isPlaying = true;
        state.cooldown = 0;

        return true;
    }

    isConstantAnimation(tilesetName, tileId) {
        return this.constantAnimations[tilesetName]?.[tileId] !== undefined;
    }

    isTriggeredAnimation(tilesetName, tileId) {
        return this.triggeredAnimations[tilesetName]?.[tileId] !== undefined;
    }

    getTriggeredAnimation(tilesetName, tileId) {
        return this.triggeredAnimations[tilesetName]?.[tileId];
    }

    getTrapInstanceKey(tilesetName, tileId, mapX = null, mapY = null) {
        if (mapX !== null && mapY !== null) {
            return `${tilesetName}:${tileId}:${mapX},${mapY}`;
        }

        return `${tilesetName}:${tileId}`;
    }

    getTriggeredState(tilesetName, tileId, mapX = null, mapY = null) {
        const key = this.getTrapInstanceKey(tilesetName, tileId, mapX, mapY);
        return this.triggeredTraps.get(key);
    }

    triggerTrap(tilesetName, tileId, mapX = null, mapY = null) {
        if (!this.isTriggeredAnimation(tilesetName, tileId)) return;

        const key = this.getTrapInstanceKey(tilesetName, tileId, mapX, mapY);

        if (!this.triggeredTraps.has(key)) {
            this.triggeredTraps.set(key, {
                tilesetName,
                tileId,
                frame: 0,
                isPlaying: false,
                frameCounter: 0
            });
        }

        const state = this.triggeredTraps.get(key);
        if (!state.isPlaying) {
            state.isPlaying = true;
            state.frame = 0;
            state.frameCounter = 0;
        }
    }

    getSourceRect(anim, frame) {
        if (anim.frameAxis === 'x') {
            return {
                srcX: frame * anim.frameWidth + anim.tileX * 8,
                srcY: anim.tileY * 8
            };
        }

        return {
            srcX: anim.tileX * 8,
            srcY: frame * anim.frameHeight + anim.tileY * 8
        };
    }

    getTrapFrameSourceRect(definition, frame) {
        if (definition.frameAxis === 'x') {
            return {
                srcX: frame * definition.frameWidth,
                srcY: 0
            };
        }

        return {
            srcX: 0,
            srcY: frame * definition.frameHeight
        };
    }

    drawTrapInstances(ctx, cameraX, cameraY) {
        for (const trap of this.trapInstances) {
            const definition = this.trapTypeDefinitions[trap.type];
            if (!definition) continue;

            const image = this[definition.image];
            if (!image) continue;

            const state = this.trapStates.get(trap.id);
            const frame = state?.frame ?? 0;
            const { srcX, srcY } = this.getTrapFrameSourceRect(definition, frame);

            const destX = trap.topLeftTileX * 8 - cameraX;
            const destY = trap.topLeftTileY * 8 - cameraY;

            ctx.drawImage(
                image,
                srcX, srcY,
                definition.frameWidth, definition.frameHeight,
                destX, destY,
                definition.frameWidth, definition.frameHeight
            );
        }
    }

    drawTile(ctx, tilesetName, tileId, x, y, mapX = null, mapY = null) {
        const constantAnim = this.constantAnimations[tilesetName]?.[tileId];
        if (constantAnim) {
            const image = this[constantAnim.image];
            if (!image) return false;

            const frame = this.constantFrame % constantAnim.frames;
            const { srcX, srcY } = this.getSourceRect(constantAnim, frame);
            ctx.drawImage(image, srcX, srcY, 8, 8, x, y, 8, 8);
            return true;
        }

        const triggeredAnim = this.triggeredAnimations[tilesetName]?.[tileId];
        if (triggeredAnim) {
            const image = this[triggeredAnim.image];
            if (!image) return false;

            // Idle traps render frame 0 immediately. Once triggered by the old
            // fallback path, they play through, then return to frame 0.
            const state = this.getTriggeredState(tilesetName, tileId, mapX, mapY);
            const frame = state?.frame ?? 0;
            const { srcX, srcY } = this.getSourceRect(triggeredAnim, frame);
            ctx.drawImage(image, srcX, srcY, 8, 8, x, y, 8, 8);
            return true;
        }

        return false;
    }
}
