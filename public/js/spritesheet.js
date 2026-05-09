// Sprite sheet loader and animation manager

class SpriteSheet {
    constructor() {
        this.image = null;
        this.animations = {};
        this.tileWidth = 8;
        this.tileHeight = 8;
		
		this.bomberCountdownImages = {};
		this.bomberBangImage = null;
		this.bomberShrugImage = null;
		
    }
    
    async load(path) {
		const imageData = await Utils.loadIndexedImage(path);
		this.image = imageData.image;
		this.imageData = imageData;
		
		// Define all lemming animations from the main atlas first.
		this.defineAnimations();

		// Bomber uses external countdown, BANG, and detonation/shrug PNGs.
		await this.loadBomberImages();
		
		// Miner now uses split 8x16 strip PNGs instead of the old atlas frames.
		await this.loadSplitMinerAnimations();
		
		console.log('Sprite sheet loaded:', path);
		console.log('Animations defined:', Object.keys(this.animations).length);
	}
	
	async loadSplitMinerAnimations() {
		try {
			const rightData = await Utils.loadIndexedImage('assets/Miner-Animation-Right.png');
			const leftData = await Utils.loadIndexedImage('assets/Miner-Animation-Left.png');

			this.animations.mineRight = {
				stripImage: rightData.image,
				frameWidth: 8,
				frameHeight: 16,
				frameCount: 18,
				offsetX: -5,
				loop: true
			};

			this.animations.mineLeft = {
				stripImage: leftData.image,
				frameWidth: 8,
				frameHeight: 16,
				frameCount: 18,
				loop: true
			};

			console.log('Split Miner animations loaded');
		} catch (error) {
			console.warn('Split Miner animations not loaded; falling back to main atlas Miner frames.', error);
		}
	}
	
	applyBomberShrugAnimation() {
    if (!this.bomberShrugImage) return;

    this.animations.exploding = {
        stripImage: this.bomberShrugImage,
        frameWidth: 8,
        frameHeight: 16,
        frameCount: Physics?.bomberShrugFrames || 21,
        loop: false
    };
}

async loadBomberImages() {
	this.bomberCountdownImages = {};
	this.bomberBangImage = null;
	this.bomberShrugImage = null;

	for (let number = 1; number <= 5; number++) {
		try {
			const imageData = await Utils.loadIndexedImage(`assets/Bomber_${number}.png`);
			this.bomberCountdownImages[number] = imageData.image;
		} catch (error) {
			console.warn(`Bomber countdown image ${number} not loaded.`, error);
		}
	}

	try {
		const bangData = await Utils.loadIndexedImage('assets/Bomber_Bang.png');
		this.bomberBangImage = bangData.image;
	} catch (error) {
		console.warn('Bomber_Bang.png not loaded.', error);
	}

	try {
		const shrugData = await Utils.loadIndexedImage('assets/Bomber_Shrug.png');
		this.bomberShrugImage = shrugData.image;
		this.applyBomberShrugAnimation();
	} catch (error) {
		console.warn('Bomber_Shrug.png not loaded; falling back to atlas exploding animation.', error);
	}
}
    
    defineAnimations() {
        // Each frame = 2 consecutive tiles (top, bottom)
        // Just count tiles linearly through the sprite sheet
        
        // Default frame counts (can be overridden from debug panel)
        const frameCounts = this.frameCounts || {
            walkFrames: 8,
            digFrames: 12,
            drownFrames: 16,
            climberFrames: 8,
            basherFrames: 28,
            minerFrames: 18,
            fallFrames: 8,
            blockerFrames: 8,
            builderFrames: 16,
            splatFrames: 10,
            exitFrames: 8,
            floaterStartFrames: 4,
            floaterLoopFrames: 4,
            bomberFrames: 23,
            burningFrames: 7
        };
        
        let tileIndex = 0;
        
        // 1. Walking Right
        this.animations.walkRight = {
            startTile: tileIndex,
            frameCount: frameCounts.walkFrames,
            loop: true
        };
        tileIndex += frameCounts.walkFrames * 2;
        
        // 2. Walking Left
        this.animations.walkLeft = {
            startTile: tileIndex,
            frameCount: frameCounts.walkFrames,
            loop: true
        };
        tileIndex += frameCounts.walkFrames * 2;
        
        // 3. Digger
        this.animations.digging = {
            startTile: tileIndex,
            frameCount: frameCounts.digFrames,
            loop: true
        };
        tileIndex += frameCounts.digFrames * 2;
        
        // 4. Drowning
        this.animations.drowning = {
            startTile: tileIndex,
            frameCount: frameCounts.drownFrames,
            loop: false
        };
        tileIndex += frameCounts.drownFrames * 2;
        
        // 5. Climber Right
		this.animations.climbRight = {
			startTile: tileIndex,
			frameCount: frameCounts.climberFrames,
			loop: true,
			offsetX: -(Physics?.climberSpriteOffsetX || 3)
		};
        tileIndex += frameCounts.climberFrames * 2;
        
        // 6. Climber Left
        this.animations.climbLeft = {
				startTile: tileIndex,
				frameCount: frameCounts.climberFrames,
				loop: true,
				offsetX: Physics?.climberSpriteOffsetX || 3
			};
        tileIndex += frameCounts.climberFrames * 2;
        
        // 7. Basher Right
        this.animations.bashRight = {
            startTile: tileIndex,
            frameCount: frameCounts.basherFrames,
            loop: true
        };
        tileIndex += frameCounts.basherFrames * 2;
        
        // 8. Basher Left
        this.animations.bashLeft = {
            startTile: tileIndex,
            frameCount: frameCounts.basherFrames,
			reverseFrames: true,
            loop: true
        };
        tileIndex += frameCounts.basherFrames * 2;
        
        // 9. Miner Right
        this.animations.mineRight = {
            startTile: tileIndex,
            frameCount: frameCounts.minerFrames,
            loop: true
        };
        tileIndex += frameCounts.minerFrames * 2;
        
        // 10. Miner Left
        this.animations.mineLeft = {
            startTile: tileIndex,
            frameCount: frameCounts.minerFrames,
            loop: true,
			reverseFrames: true
        };
        tileIndex += frameCounts.minerFrames * 2;
        
        // 11. Falling
        this.animations.falling = {
            startTile: tileIndex,
            frameCount: frameCounts.fallFrames,
            loop: true
        };
        tileIndex += frameCounts.fallFrames * 2;
        
        // 12. Blocker
        this.animations.blocking = {
            startTile: tileIndex,
            frameCount: frameCounts.blockerFrames,
            loop: true
        };
        tileIndex += frameCounts.blockerFrames * 2;
        
        // 13. Builder Right
        this.animations.buildRight = {
            startTile: tileIndex,
            frameCount: frameCounts.builderFrames,
            loop: true,
            offsetX: Physics?.builderRightAnimationOffsetX ?? 0,
            offsetY: Physics?.builderRightAnimationOffsetY ?? 0
        };
        tileIndex += frameCounts.builderFrames * 2;
        
        // 14. Builder Left
        // The left-facing builder strip is stored in reverse visual order
        // compared with the right-facing strip. Read it backwards so gameplay
        // frame 9 draws as the true mirror of right-facing frame 9.
        this.animations.buildLeft = {
            startTile: tileIndex,
            frameCount: frameCounts.builderFrames,
            loop: true,
            reverseFrames: true,
            offsetX: Physics?.builderLeftAnimationOffsetX ?? 0,
            offsetY: Physics?.builderLeftAnimationOffsetY ?? 0
        };
        tileIndex += frameCounts.builderFrames * 2;
        
        // 15. Splat
        this.animations.splat = {
            startTile: tileIndex,
            frameCount: frameCounts.splatFrames,
            loop: false
        };
        tileIndex += frameCounts.splatFrames * 2;
        
        // 16. Exit
        this.animations.exiting = {
            startTile: tileIndex,
            frameCount: frameCounts.exitFrames,
            loop: false
        };
        tileIndex += frameCounts.exitFrames * 2;
        
        // 17. Floater Start
        this.animations.floaterStart = {
            startTile: tileIndex,
            frameCount: frameCounts.floaterStartFrames,
            loop: false,
            nextAnimation: 'floaterLoop'
        };
        tileIndex += frameCounts.floaterStartFrames * 2;
        
        // 18. Floater Loop
        this.animations.floaterLoop = {
            startTile: tileIndex,
            frameCount: frameCounts.floaterLoopFrames,
            loop: true
        };
        tileIndex += frameCounts.floaterLoopFrames * 2;
        
        // 19. Bomber / Shrugger source strip
        // The first 9 frames of this strip are the Builder shrug animation.
        this.animations.shrugging = {
            startTile: tileIndex,
            frameCount: 9,
            loop: false
        };
        this.animations.exploding = {
            startTile: tileIndex,
            frameCount: frameCounts.bomberFrames,
            loop: false
        };
        tileIndex += frameCounts.bomberFrames * 2;
        
        // 20. Burning/Fire
        this.animations.burning = {
            startTile: tileIndex,
            frameCount: frameCounts.burningFrames,
            loop: false
        };
        tileIndex += frameCounts.burningFrames * 2;
        
        console.log('Total tiles used:', tileIndex);
    }
    
    // Update animation frame counts from debug panel
    updateFrameCounts(frameCounts) {
		this.frameCounts = frameCounts;
		this.defineAnimations();
		this.applyBomberShrugAnimation();
		console.log('Animation frame counts updated:', frameCounts);
	}
    
    // Get the animation for a lemming's current state
    getAnimation(lemming) {
        const state = lemming.state;
        const direction = lemming.direction;
                 
        // ONE FRAME LATER SPRITE FIX: 
        // We check the fallFrameCount. If it's the very first frame of a fall (0), 
        // we keep the walking animation even though the state is 'falling'.[cite: 1]
        if (state === 'falling' && lemming.fallFrameCount < 1) {
            return direction > 0 ? this.animations.walkRight : this.animations.walkLeft;
        }

        switch (state) {
            case 'walking': return direction > 0 ? this.animations.walkRight : this.animations.walkLeft;
            case 'falling': return this.animations.falling;
            case 'floating':
                return lemming.floaterAnimPhase === 'opening'
                    ? this.animations.floaterStart
                    : this.animations.floaterLoop;
            case 'climbing': return direction > 0 ? this.animations.climbRight : this.animations.climbLeft;
            case 'building': return direction > 0 ? this.animations.buildRight : this.animations.buildLeft;
            case 'shrugging': return this.animations.shrugging;
            case 'bashing': return direction > 0 ? this.animations.bashRight : this.animations.bashLeft;
            case 'digging': return this.animations.digging;
			case 'mining': return direction > 0 ? this.animations.mineRight : this.animations.mineLeft;
            case 'blocking': return this.animations.blocking;
			case 'exploding': return this.animations.exploding;
            case 'drowning': return this.animations.drowning;
            case 'burning': return this.animations.burning;
            case 'splatting': return this.animations.splat;
            case 'exiting': return this.animations.exiting;
            default: return this.animations.falling;
        }
    }
         
    draw(ctx, lemming, x, y) {
        const animation = this.getAnimation(lemming);
        if (!animation) return;
        
        const rawFrame = Math.max(0, lemming.frame);
        const frame = animation.loop
            ? rawFrame % animation.frameCount
            : Math.min(rawFrame, animation.frameCount - 1);
        const topTileIndex = animation.startTile + (frame * 2);
        const bottomTileIndex = topTileIndex + 1;
        const tilesPerRow = 16;
        
        // Draw top then bottom tile
        ctx.drawImage(this.image, (topTileIndex % tilesPerRow) * 8, Math.floor(topTileIndex / tilesPerRow) * 8, 8, 8, x, y, 8, 8);
        ctx.drawImage(this.image, (bottomTileIndex % tilesPerRow) * 8, Math.floor(bottomTileIndex / tilesPerRow) * 8, 8, 8, x, y + 8, 8, 8);
    }
    
    // Draw a single frame of an animation
    drawFrame(ctx, animation, frameNumber, x, y, flipX = false) {
        if (!animation) return;
        
        ctx.save();

		if (flipX) {
			ctx.scale(-1, 1);
			x = -x - this.tileWidth;
		}

		// Use temporary canvas to process transparency.
		// All current lemming frames are 8x16, whether they come from the main atlas
		// as two 8x8 tiles or from a split 8x16 strip.
		if (!this.tempCanvas) {
			this.tempCanvas = document.createElement('canvas');
			this.tempCanvas.width = this.tileWidth;
			this.tempCanvas.height = this.tileHeight * 2;
			this.tempCtx = this.tempCanvas.getContext('2d', { willReadFrequently: true });
		}

		// Clear temp canvas
		this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);

		if (animation.stripImage) {
			const frameWidth = animation.frameWidth || 8;
			const frameHeight = animation.frameHeight || 16;

			this.tempCtx.drawImage(
				animation.stripImage,
				frameNumber * frameWidth, 0,
				frameWidth, frameHeight,
				0, 0,
				frameWidth, frameHeight
			);
		} else {
			// startTile is in tile indices, each frame uses 2 tiles (top, bottom)
			const topTileIndex = animation.startTile + (frameNumber * 2);
			const bottomTileIndex = topTileIndex + 1;

			// Sprite sheet is 16 tiles wide (128 pixels / 8 pixels per tile)
			const tilesPerRow = 16;

			// Calculate positions for top and bottom tiles
			const topTileX = (topTileIndex % tilesPerRow) * this.tileWidth;
			const topTileY = Math.floor(topTileIndex / tilesPerRow) * this.tileHeight;

			const bottomTileX = (bottomTileIndex % tilesPerRow) * this.tileWidth;
			const bottomTileY = Math.floor(bottomTileIndex / tilesPerRow) * this.tileHeight;

			// Draw top tile at y=0
			this.tempCtx.drawImage(
				this.image,
				topTileX, topTileY,
				this.tileWidth, this.tileHeight,
				0, 0,
				this.tileWidth, this.tileHeight
			);

			// Draw bottom tile at y=8
			this.tempCtx.drawImage(
				this.image,
				bottomTileX, bottomTileY,
				this.tileWidth, this.tileHeight,
				0, this.tileHeight,
				this.tileWidth, this.tileHeight
			);
		}
        
        // Get image data and make magenta pixels transparent
        const imageData = this.tempCtx.getImageData(0, 0, this.tileWidth, this.tileHeight * 2);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // If pixel is magenta (255, 0, 255), make it transparent
            if (r > 250 && g < 10 && b > 250) {
                data[i + 3] = 0;
            }
        }
        
        this.tempCtx.putImageData(imageData, 0, 0);
        
        // Draw to main canvas
        ctx.drawImage(this.tempCanvas, x, y);
        
        ctx.restore();
    }
    
    // Draw a lemming with the correct animation
    draw(ctx, lemming, x, y) {
		if (lemming.isBomberBangVisible?.() && this.bomberBangImage) {
			// Bomber_Bang.png is 16x16. The normal lemming body is 8x16,
			// so x - 4 centres it horizontally over the lemming.
			ctx.drawImage(this.bomberBangImage, x - 4, y);
			return;
		}

		const animation = this.getAnimation(lemming);
		if (!animation) return;

		// Get current frame, wrapping if looping and clamping if not.
		let frame = lemming.frame;

		if (animation.loop) {
			frame = frame % animation.frameCount;
		} else {
			frame = Math.min(frame, animation.frameCount - 1);
		}

		if (animation.reverseFrames) {
			frame = animation.frameCount - 1 - frame;
		}

		this.drawFrame(
			ctx,
			animation,
			frame,
			x + (animation.offsetX || 0),
			y + (animation.offsetY || 0),
			false
		);

		const countdownNumber = lemming.getBomberCountdownNumber?.();
		if (countdownNumber && this.bomberCountdownImages?.[countdownNumber]) {
			// Countdown images are 8x8 and overlay the upper sprite.
			ctx.drawImage(this.bomberCountdownImages[countdownNumber], x, y);
		}
	}
}
