// PNG Animation/Object Overlay Manager
// Handles PNG-mode overlay objects: decorative loops, triggered traps, hazards,
// exits/hatches metadata is parsed by LevelLoader and gameplay uses these
// objects without altering the source PNG.
class PngAnimationManager {
    constructor() {
        this.objects = [];
        this.animations = new Map();
        this.images = new Map();
        this.trapStates = new Map();
        this.levelStartStates = new Map();
        this.loopFrame = 0;
        this.frameCounter = 0;
        this.frameDelay = 8;
        this.triggeredFrameDelay = 7;
        this.cooldownFramesAfterAnimation = 0;
        this.classicHatchSyncFrames = 6;
        this.foregroundZIndex = 100;
        this.defaultZIndexByRole = {
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
    }

    async load() {
        // Nothing global to preload. Packs are level-specific.
    }

    async setLevel(level) {
        this.objects = Array.isArray(level?.pngAnimationObjects) ? level.pngAnimationObjects : [];
        this.animations = new Map();
        this.images = new Map();
        this.trapStates = new Map();
        this.levelStartStates = new Map();
        this.loopFrame = 0;
        this.frameCounter = 0;

        const animations = Array.isArray(level?.pngAnimationPack?.animations)
            ? level.pngAnimationPack.animations
            : [];

        for (const animation of animations) {
            if (!animation) continue;
            const id = this.normaliseAnimationId(animation.id || animation.animationId || animation.animation_id || animation.name);
            if (!id) continue;
            const normalised = { ...animation, id };
            const image = this.animationImageSource(normalised);
            if (image) normalised.image = image;
            this.registerAnimationAlias(id, normalised);
            this.registerAnimationAlias(normalised.animationId, normalised);
            this.registerAnimationAlias(normalised.animation_id, normalised);
            this.registerAnimationAlias(normalised.name, normalised);
        }

        const imagePaths = new Set();
        for (const animation of this.animations.values()) {
            const path = this.animationImageSource(animation);
            if (path) imagePaths.add(path);
        }
        for (const object of this.objects) {
            const path = this.directObjectImageSource(object);
            if (path) imagePaths.add(path);
        }

        await Promise.all([...imagePaths].map(async (path) => {
            try {
                const data = await Utils.loadIndexedImage(path);
                this.images.set(path, data.image);
            } catch (error) {
                console.warn(`PNG animation image missing: ${path}`, error);
            }
        }));
    }

    normaliseAnimationId(value) {
        if (value === undefined || value === null) return '';
        if (typeof value === 'object') {
            return this.normaliseAnimationId(value.id || value.animationId || value.animation_id || value.name);
        }
        return String(value).trim();
    }

    registerAnimationAlias(id, animation) {
        const key = this.normaliseAnimationId(id);
        if (!key) return;
        this.animations.set(key, animation);
        this.animations.set(key.toLowerCase(), animation);
    }

    findAnimationById(id) {
        const key = this.normaliseAnimationId(id);
        if (!key) return null;
        return this.animations.get(key) || this.animations.get(key.toLowerCase()) || null;
    }

    explicitObjectAnimationId(object) {
        const candidates = [
            object?.animationId,
            object?.animation_id,
            object?.animId,
            object?.anim_id,
            object?.animationKey,
            object?.animation_key,
            object?.animation?.id,
            object?.animation?.animationId,
            object?.animation?.animation_id,
            object?.anim?.id,
            object?.anim?.animationId,
            object?.anim?.animation_id,
            typeof object?.animation === 'string' ? object.animation : null,
            typeof object?.anim === 'string' ? object.anim : null
        ];

        for (const candidate of candidates) {
            const id = this.normaliseAnimationId(candidate);
            if (id) return id;
        }
        return '';
    }

    animationImageSource(animation) {
        if (!animation) return '';
        return String(
            animation.image ||
            animation.png ||
            animation.source ||
            animation.src ||
            animation.url ||
            animation.dataUrl ||
            animation.data_url ||
            animation.imageDataUrl ||
            animation.image_data_url ||
            ''
        ).trim();
    }

    directObjectImageSource(object) {
        if (!object) return '';
        if (object.animation && typeof object.animation === 'object') {
            const nested = this.animationImageSource(object.animation);
            if (nested) return nested;
        }
        // Do not read object.source here: normalised placement objects use
        // source='png-overlay', which is metadata, not an image path.
        return String(
            object.image ||
            object.png ||
            object.src ||
            object.url ||
            object.dataUrl ||
            object.data_url ||
            object.imageDataUrl ||
            object.image_data_url ||
            ''
        ).trim();
    }

    isLevelStartObject(object) {
        const trigger = String(object?.trigger || '').toLowerCase();
        const role = String(object?.role || '').toLowerCase();
        const animation = this.getObjectAnimation(object);
        const animationTrigger = String(animation?.trigger || '').toLowerCase();
        return role === 'hatch' || trigger === 'level_start' || trigger === 'start_of_level' || animationTrigger === 'level_start' || animationTrigger === 'start_of_level';
    }

    startLevelStartAnimations() {
        this.levelStartStates = new Map();
        for (const object of this.objects) {
            if (!this.isLevelStartObject(object)) continue;
            const animation = this.getObjectAnimation(object);
            const frameCount = Math.max(1, Number(animation?.frames || object?.frames || 1));
            this.levelStartStates.set(this.objectKey(object), {
                playing: true,
                frame: 0,
                virtualFrame: 0,
                counter: 0,
                finished: false,
                sourceFrames: frameCount,
                syncFrames: Math.max(frameCount, Number(animation?.hatchSyncFrames || object?.hatchSyncFrames || this.classicHatchSyncFrames) || this.classicHatchSyncFrames)
            });
        }
    }

    updateLevelStartAnimations() {
        for (const [key, state] of this.levelStartStates.entries()) {
            if (!state.playing || state.finished) continue;
            state.counter++;
            if (state.counter < this.frameDelay) continue;
            state.counter = 0;
            state.virtualFrame = (state.virtualFrame || 0) + 1;
            const object = this.objects.find(o => this.objectKey(o) === key);
            const animation = this.getObjectAnimation(object);
            const frameCount = Math.max(1, Number(animation?.frames || object?.frames || state.sourceFrames || 1));
            const syncFrames = Math.max(frameCount, Number(state.syncFrames || animation?.hatchSyncFrames || object?.hatchSyncFrames || this.classicHatchSyncFrames) || this.classicHatchSyncFrames);
            state.sourceFrames = frameCount;
            state.syncFrames = syncFrames;
            const firstFrameHold = Math.max(0, syncFrames - frameCount);
            state.frame = Math.max(0, Math.min(frameCount - 1, state.virtualFrame - firstFrameHold));
            if (state.virtualFrame >= syncFrames - 1) {
                state.frame = Math.max(0, frameCount - 1);
                state.playing = false;
                state.finished = true;
            }
        }
    }

    areLevelStartAnimationsFinished() {
        if (!this.levelStartStates.size) return true;
        for (const state of this.levelStartStates.values()) {
            if (!state.finished) return false;
        }
        return true;
    }

    updateConstantAnimations() {
        this.frameCounter++;
        if (this.frameCounter >= this.frameDelay) {
            this.frameCounter = 0;
            this.loopFrame++;
        }
    }

    updateTriggeredAnimations() {
        this.updateLevelStartAnimations();
        for (const [key, state] of this.trapStates.entries()) {
            if (state.cooldown > 0) {
                state.cooldown--;
                continue;
            }

            if (!state.playing) continue;

            state.counter++;
            if (state.counter < this.triggeredFrameDelay) continue;

            state.counter = 0;
            state.frame++;

            const object = this.objects.find(o => this.objectKey(o) === key);
            const animation = this.getObjectAnimation(object);
            const frameCount = animation?.frames || object?.frames || 1;

            if (state.frame >= frameCount) {
                state.playing = false;
                state.frame = 0;
                state.cooldown = this.cooldownFramesAfterAnimation;
            }
        }
    }

    defaultZIndexForRole(role) {
        return this.defaultZIndexByRole[String(role || 'decorative').toLowerCase()] ?? 0;
    }

    objectZIndex(object) {
        const explicit = Number(object?.zIndex ?? object?.z_index ?? object?.z ?? object?.layer);
        return Number.isFinite(explicit) ? explicit : this.defaultZIndexForRole(object?.role);
    }

    objectsInDrawOrder(options = {}) {
        const minZ = Number.isFinite(Number(options.minZ)) ? Number(options.minZ) : -Infinity;
        const maxZ = Number.isFinite(Number(options.maxZ)) ? Number(options.maxZ) : Infinity;
        return this.objects
            .map((object, index) => ({ object, index, z: this.objectZIndex(object) }))
            .filter(entry => entry.z >= minZ && entry.z <= maxZ)
            .sort((a, b) => a.z - b.z || a.index - b.index)
            .map(entry => entry.object);
    }

    objectKey(object) {
        return object?.id || `${object?.role || 'object'}:${object?.x || 0},${object?.y || 0}`;
    }

    getObjectAnimation(object) {
        if (!object) return null;

        const explicitId = this.explicitObjectAnimationId(object);
        if (explicitId) {
            const exact = this.findAnimationById(explicitId);
            if (exact) return exact;
            // If an object explicitly asks for an animation, never fall back to
            // the first animation in the same role/category. That draws the
            // wrong hatch/trap/goal and hides the real data problem.
            return null;
        }

        // Compatibility for any older/experimental PNG object JSON that carried
        // its own animation image directly on the object instead of an ID into
        // the library. This keeps already-authored test levels visible after
        // the move to the global animation library.
        const directImage = this.directObjectImageSource(object);
        if (directImage) {
            return {
                id: String(object.id || 'direct_png_object'),
                image: directImage,
                role: object.role,
                trigger: object.trigger,
                frameWidth: object.frameWidth || object.frame_width || object.frameWidthPx || object.frame_width_px,
                frameHeight: object.frameHeight || object.frame_height || object.frameHeightPx || object.frame_height_px,
                frameWidthTiles: object.frameWidthTiles || object.frame_width_tiles || object.widthTiles || object.width_tiles,
                frameHeightTiles: object.frameHeightTiles || object.frame_height_tiles || object.heightTiles || object.height_tiles,
                frames: object.frames || object.frame_count || object.frameCount || 1,
                orientation: object.orientation || object.frameAxis || object.frame_axis || 'horizontal'
            };
        }

        const role = String(object.role || '').toLowerCase();
        const category = String(object.category || '').toLowerCase();
        const seen = new Set();
        for (const animation of this.animations.values()) {
            if (!animation || seen.has(animation)) continue;
            seen.add(animation);
            const aRole = String(animation.role || '').toLowerCase();
            const aCategory = String(animation.category || '').toLowerCase();
            if ((role && aRole === role) || (category && aCategory === category)) {
                return animation;
            }
        }

        return null;
    }

    getObjectFrame(object, animation) {
        const trigger = String(object?.trigger || animation?.trigger || '').toLowerCase();
        const role = String(object?.role || animation?.role || '').toLowerCase();

        if (role === 'triggered_trap' || trigger === 'lemming_position' || trigger === 'triggered') {
            const state = this.trapStates.get(this.objectKey(object));
            return state?.playing ? state.frame : 0;
        }

        if (role === 'hatch' || trigger === 'start' || trigger === 'level_start' || trigger === 'start_of_level') {
            const state = this.levelStartStates.get(this.objectKey(object));
            if (state) return state.frame;
            // Before the hatch-opening sequence starts, PNG hatches sit closed on
            // frame 0. They should not loop quietly during preview/start delay.
            return 0;
        }

        if (trigger === 'constant_loop' || trigger === 'loop' || role === 'fire' || role === 'water' || role === 'acid') {
            return this.loopFrame % Math.max(1, animation?.frames || object?.frames || 1);
        }

        return 0;
    }

    draw(ctx, cameraX = 0, cameraY = 0, options = {}) {
        if (!this.objects.length) return;

        for (const object of this.objectsInDrawOrder(options)) {
            const role = String(object.role || '').toLowerCase();

            const animation = this.getObjectAnimation(object);
            const imageSource = this.animationImageSource(animation);
            if (!imageSource) continue;

            const image = this.images.get(imageSource);
            if (!image) continue;

            const configuredFrameWidth = Math.max(1, Number(animation.frameWidth || animation.frame_width || animation.frameWidthPx || animation.frame_width_px || (animation.frameWidthTiles || animation.frame_width_tiles || object.widthTiles || object.width_tiles || 1) * 8));
            const configuredFrameHeight = Math.max(1, Number(animation.frameHeight || animation.frame_height || animation.frameHeightPx || animation.frame_height_px || (animation.frameHeightTiles || animation.frame_height_tiles || object.heightTiles || object.height_tiles || 1) * 8));
            const orientation = String(animation.orientation || animation.frameAxis || animation.frame_axis || 'horizontal').toLowerCase();
            const imageWidth = Math.max(1, Number(image.naturalWidth || image.width || configuredFrameWidth));
            const imageHeight = Math.max(1, Number(image.naturalHeight || image.height || configuredFrameHeight));
            const frameWidth = Math.min(configuredFrameWidth, imageWidth);
            const frameHeight = Math.min(configuredFrameHeight, imageHeight);
            const maxFrame = orientation.startsWith('v')
                ? Math.max(0, Math.floor(imageHeight / frameHeight) - 1)
                : Math.max(0, Math.floor(imageWidth / frameWidth) - 1);
            const frame = Math.max(0, Math.min(maxFrame, Number(this.getObjectFrame(object, animation)) || 0));

            const srcX = orientation.startsWith('v') ? 0 : frame * frameWidth;
            const srcY = orientation.startsWith('v') ? frame * frameHeight : 0;
            const drawX = Math.floor(object.x || 0) - cameraX;
            const drawY = Math.floor(object.y || 0) - cameraY;
            const drawW = Math.max(1, Number(object.widthPx || object.width_px || frameWidth));
            const drawH = Math.max(1, Number(object.heightPx || object.height_px || frameHeight));

            try {
                ctx.drawImage(image, srcX, srcY, frameWidth, frameHeight, drawX, drawY, drawW, drawH);
            } catch (error) {
                // If older authoring metadata has bad frame dimensions, do not
                // silently lose the object. Draw the source image's first frame
                // area as a conservative fallback.
                try {
                    ctx.drawImage(image, 0, 0, Math.min(imageWidth, configuredFrameWidth), Math.min(imageHeight, configuredFrameHeight), drawX, drawY, drawW, drawH);
                } catch (_) {}
            }
        }
    }

    tryTriggerTrapAt(feetX, feetY) {
        const triggerX = Math.floor(feetX);
        const triggerY = Math.floor(feetY);
        let matched = null;

        for (const object of this.objects) {
            const role = String(object.role || '').toLowerCase();
            const trigger = String(object.trigger || '').toLowerCase();
            if (role !== 'triggered_trap' && trigger !== 'lemming_position' && trigger !== 'triggered') continue;

            const ox = Math.floor(object.triggerX ?? object.trigger_x ?? (object.x + Math.floor((object.widthPx || 8) / 2)));
            const oy = Math.floor(object.triggerY ?? object.trigger_y ?? (object.y + Math.max(0, (object.heightPx || 8) - 1)));
            if (triggerX !== ox || triggerY !== oy) continue;

            const key = this.objectKey(object);
            const state = this.trapStates.get(key) || { playing: false, frame: 0, counter: 0, cooldown: 0 };
            if (!state.playing && state.cooldown <= 0) {
                state.playing = true;
                state.frame = 0;
                state.counter = 0;
                this.trapStates.set(key, state);
            }
            matched = matched || object;
        }

        return matched;
    }
}
