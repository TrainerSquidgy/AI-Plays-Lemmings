// Lemming entity class
class Lemming {
    // Floater deployment has been checked visually against the SMS feel.
    // In this engine the umbrella starts after 10px of falling.
    static FLOATER_DEPLOY_DISTANCE = 10;

    constructor(x, y, direction = 1) {
        this.x = x; // Horizontal center anchor
        this.y = y; // Top of the sprite
        this.direction = direction; // 1 = right, -1 = left

        this.state = 'falling';
        this.skill = null;

        this.frame = 0;
        this.frameCounter = 0;
        this.frameDelay = 4;

        this.isClimber = false;
        this.isFloater = false;
        this.floaterAnimPhase = 'inactive';
        this.buildCount = 0;
        this.skillTick = 0;
        this.lastBuilderStepFrame = -1;
        this.shrugHoldTicks = 0;
        
        // Bomber fuse state. fuseValue mirrors ix+10 (pre-ignition countdown).
        // fuseSubTick mirrors ix+16 (4-bit sub-tick counter).
        // fuseCounter mirrors ix+7 in the active explosion state.
        this.fuseValue = 0;
        this.fuseSubTick = 0;
        this.fuseCounter = 0;
		this.explosionSinks = null;
        this.bomberBangTicks = 0;
        this.explodingFromState = null;

        this.fallDistance = 0;
        this.fallFrameCount = 0;
        this.onGround = false;
        this.lastHazardDeathType = null;

        this.width = 8;
        // Logical feet/contact height. The sprite still draws as 16px tall,
        // but SMS feet/contact checks sit a pixel higher than the full art.
        this.height = 15;

        // Walking clearance is smaller than the full sprite. The hair/raised arms
        // shouldn't make walkers turn around in roomy corner/ceiling shapes.
        this.wallCheckHeight = 8;
    }

    update(level) {
        // Goal checks have priority over hazards and skill/death transitions.
        // If an active lemming reaches the exit trigger, it is saved no matter
        // what job it was doing on that tick.
        if (this.tryEnterExit(level)) return;

        // Hazards are handled separately from terrain collision. Water/fire/toxic
        // tiles do not block movement, but they do take control of the lemming.
        if (this.checkHazardDeath(level)) return;

        switch (this.state) {
            case 'falling':   this.updateFalling(level);   break;
            case 'walking':   this.updateWalking(level);   break;
            case 'climbing':  this.updateClimbing(level);  break;
            case 'building':  this.updateBuilding(level);  break;
            case 'shrugging': this.updateShrugging();      break;
            case 'bashing':   this.updateBashing(level);   break;
            case 'mining':    this.updateMining(level);    break;
            case 'digging':   this.updateDigging(level);   break;
            case 'blocking':  this.updateBlocking(level);  break;
            case 'floating':  this.updateFloating(level);  break;
            case 'exploding': this.updateExploding(level); break;
            case 'drowning':  this.updateDrowning();       break;
            case 'burning':   this.updateBurning();        break;
            case 'splatting': this.updateSplatting();      break;
            case 'exiting':   this.updateExiting(level);   break;
        }

        // Some skills/death decisions happen during the state update itself.
        // Re-check after movement so a lemming that reaches the goal on this
        // tick is accepted before splatting, drowning, burning, or exploding
        // can take final control.
        if (this.tryEnterExit(level)) return;

        this.checkHazardDeath(level);
    }

    tryEnterExit(level) {
        const exit = this.findMatchingExit(level);
        if (!exit) return false;

        this.clearBomberFuse?.();
        this.x = exit.x;
        this.state = 'exiting';
        this.frame = 0;
        this.frameCounter = 0;
        this.onGround = false;
        return true;
    }

    findMatchingExit(level) {
        if (['exiting', 'dead', 'saved'].includes(this.state)) return null;

        const exits = level.exitPositions?.length
            ? level.exitPositions
            : (level.exitPos ? [level.exitPos] : []);

        if (exits.length === 0) return null;

        const lemmingTopY = this.y;
        const spriteHeight = Math.max(this.height || 0, 16);
        const lemmingBottomY = this.y + spriteHeight - 1;

        for (const exit of exits) {
            const xDist = Math.abs(this.x - exit.x);
            const exitTopY = Number.isFinite(Number(exit.topY ?? exit.triggerTopY))
                ? Number(exit.topY ?? exit.triggerTopY)
                : exit.y - 4;
            const exitBottomY = Number.isFinite(Number(exit.bottomY ?? exit.triggerBottomY))
                ? Number(exit.bottomY ?? exit.triggerBottomY)
                : exit.y + 12;

            // Tolerance of 1px (walkSpeed) so lemmings never overshoot the exit.
            // Vertically, goals accept overlap with any part of the visible
            // 16px lemming sprite rather than only checking the foot anchor.
            if (xDist < 1 &&
                lemmingBottomY >= exitTopY &&
                lemmingTopY <= exitBottomY) {
                return exit;
            }
        }

        return null;
    }

    canBeTakenByHazard() {
        return ![
            'dead',
            'saved',
            'exiting',
            'drowning',
            'burning'
        ].includes(this.state);
    }

    checkHazardDeath(level) {
        if (!this.canBeTakenByHazard() || !level.checkHazard) return false;

        // Centre-foot catches water/fire surfaces. Mid-body catches taller toxic
        // blocks if a lemming walks/falls into them without the feet sampling first.
        const sampleX = this.x;
        const sampleYs = [
            this.y + this.height - 1,
            this.y + Math.floor(this.height / 2)
        ];

        let hazard = null;
        for (const sampleY of sampleYs) {
            hazard = level.checkHazard(sampleX, sampleY, level.tilesetManager);
            if (hazard) break;
        }

        if (!hazard) return false;

        this.lastHazardDeathType = hazard;

        if (hazard === 'water') {
            this.startDeathAnimation('drowning');
        } else {
            this.startDeathAnimation('burning');
        }

        return true;
    }

    startDeathAnimation(state) {
        this.state = state;
        this.frame = 0;
        this.frameCounter = 0;
        this.onGround = false;
    }

    // -------------------------------------------------------------------------
    // FALLER (state 2, _LABEL_2F15_)
    //
    // Probes 4 pixel slots downward each tick. Moves by the number of
    // consecutive clear slots found (0–4). Stops and lands at the first solid
    // pixel: no overshoot. ix+9 (fallFrameCount) increments by 3 per tick;
    // when it reaches 9 and the floater flag is set, the floater deploys.
    // -------------------------------------------------------------------------
    updateFalling(level) {
        this.fallFrameCount++;

        if (this.shouldDeployFloater()) {
            this.startFloating();
            return;
        }

        // Probe up to 4 pixels downward, stop at the first solid pixel.
        let moved = 0;
        let collisionY = null;

		for (let i = 0; i < Physics.fallSpeed; i++) {
			const probeY = Math.floor(this.y + this.height + 1);

			if (level.checkCollision(this.x, probeY, level.tilesetManager)) {
				collisionY = probeY;
				break;
			}

			this.y++;
			this.fallDistance++;
			moved++;

			if (this.shouldDeployFloater()) {
				this.startFloating();
				return;
			}
		}

		if (collisionY !== null) {
			// Hit terrain before completing all 4 probes. Snap feet onto the
			// topmost solid pixel before becoming a Walker, otherwise the next
			// walking update visibly drops the lemming down by 1px.
			this.land(level, collisionY);
		}
    }

    findLandingY(level, collisionY) {
        // Walk upward from the collided pixel while the pixel above is also solid,
        // leaving the lemming's feet on the topmost solid pixel.
        let y = Math.floor(collisionY);
        while (y > 0 && level.checkCollision(this.x, y - 1, level.tilesetManager)) {
            y--;
        }
        return y;
    }

    land(level, collisionY = null) {
		if (collisionY !== null && level) {
			const landingY = this.findLandingY(level, collisionY);
			this.y = landingY - (this.height - 1);
		}

		this.onGround = true;
		this.fallFrameCount = 0;

		const maxSafeFall = level.fall_distance || Physics.safeFallDistance;
		if (!this.isFloater && this.fallDistance > maxSafeFall) {
			this.die('splat');
			return;
		}

		this.fallDistance = 0;
		this.floaterAnimPhase = 'inactive';
		this.state = 'walking';
		this.frame = 0;
	}

    // -------------------------------------------------------------------------
    // WALKER (state 1, _LABEL_2E46_)
    //
    // SMS-style walker probe:
    //   1) move forward by 1px,
    //   2) scan upper body from feet Y-9 through Y-4 at the new X,
    //   3) turn around if that slice contains 4+ solid pixels (5+ on Ice),
    //   4) otherwise scan downward from feet Y-3 through Y+4 and snap feet to
    //      the first solid pixel found.
    //
    // This intentionally allows the SMS "slither" up a 7px wall: the first
    // tick can place the feet inside the step, and the next tick corrects onto
    // the top instead of getting stuck in tiny gaps.
    // -------------------------------------------------------------------------
    updateWalking(level) {
		const previousX = this.x;
		const feetY = Math.floor(this.y + this.height - 1);

		// SMS hard top boundary:
		// If feet/anchor Y is above the allowed top boundary, reverse and clamp
		// before running normal wall/step logic.
		if (feetY < this.getTopBoundaryFeetY()) {
			this.clampFeetToTopBoundary();
			this.direction *= -1;
			this.frame = 0;
			this.frameCounter = 0;
			return;
		}

		this.x += Physics.walkSpeed * this.direction;
		const probeX = Math.floor(this.x);

		// Blockers behave like dynamic walls for Walkers.
		// Use a vertical band rather than a single foot pixel so blockers still
		// catch Walkers moving up/down slopes.
		const blockerAhead = this.findBlockingLemmingForWalker(level, probeX, feetY);
		if (blockerAhead) {
			const previousBlocker = this.findBlockingLemmingForWalker(level, Math.floor(previousX), feetY);

			// Preserve the accepted escape behaviour:
			// if the Walker was already inside this blocker hitbox, let it walk out.
			// If it newly enters the blocker hitbox, reverse.
			if (previousBlocker !== blockerAhead) {
				this.x = previousX;
				this.direction *= -1;
				this.frame = 0;
				this.frameCounter = 0;
				return;
			}
		}

		const wallHits = this.countWalkerUpperBodyHits(level, probeX, feetY);
		const wallThreshold = this.isIceLevel(level) ? 5 : 4;

		if (wallHits >= wallThreshold) {
			if (this.isClimber) {
				this.state = 'climbing';
				this.skillTick = 0;
				this.frame = 0;
				this.frameCounter = 0;
				this.onGround = false;
			} else {
				this.x = previousX;
				this.direction *= -1;
			}

			return;
		}

		const floorY = this.findWalkerFloorY(level, probeX, feetY);

		if (floorY === null) {
			this.state = 'falling';
			this.fallDistance = 0;
			this.fallFrameCount = 0;
			this.floaterAnimPhase = 'inactive';
			return;
		}

		this.y = floorY - (this.height - 1);
		this.onGround = true;
	}
	
	findBlockingLemmingForWalker(level, probeX, feetY) {
		// Walker/blocker checks must allow for slope correction.
		// The Walker may be about to snap a few pixels up/down, so a single
		// foot-pixel probe can miss blockers on slopes.
		const probeTop = feetY - 10;
		const probeBottom = feetY + 4;

		return this.findBlockingLemmingAtVerticalSpan(
			level,
			Math.floor(probeX),
			probeTop,
			probeBottom
		);
	}
	
	getTopBoundaryFeetY() {
		// SMS _LABEL_2E46_ / _LABEL_3292_ hard ceiling clamp.
		// If the lemming's feet/anchor Y would go above 16, the skill reverses
		// before normal terrain stepping/checking can happen.
		return Physics.builderTopBoundaryFeetY ?? 16;
	}

	clampFeetToTopBoundary() {
		this.y = this.getTopBoundaryFeetY() - (this.height - 1);
	}

    countWalkerUpperBodyHits(level, x, feetY) {
		let count = 0;

		for (let y = feetY - 9; y <= feetY - 4; y++) {
			if (level.checkCollision(x, y, level.tilesetManager)) {
				count++;
			}
		}

		return count;
	}

    findWalkerFloorY(level, x, feetY) {
        for (let offset = -3; offset <= 4; offset++) {
            const y = feetY + offset;
            if (level.checkCollision(x, y, level.tilesetManager)) {
                return y;
            }
        }

        return null;
    }

    isIceLevel(level) {
        return level?.tileset === 3 || level?.tilesetName === 'Ice';
    }
	
	    getFootY() {
        return Math.floor(this.y + this.height - 1);
    }

findBlockingLemmingDuringWalkerStep(level, probeX, previousX, previousFeetY, nextFeetY) {
    const minY = Math.min(previousFeetY, nextFeetY);
    const maxY = Math.max(previousFeetY, nextFeetY);

    const blockerAhead = this.findBlockingLemmingAtVerticalSpan(level, probeX, minY, maxY);
    if (!blockerAhead) {
        return null;
    }

    const previousBlocker = this.findBlockingLemmingAtVerticalSpan(level, previousX, minY, maxY);

    // Preserve the accepted blocker escape behaviour:
    // if a lemming was already inside this blocker hitbox, allow it to walk out.
    // If this step newly enters the blocker hitbox, reverse.
    return previousBlocker === blockerAhead ? null : blockerAhead;
}

	findBlockingLemmingAtVerticalSpan(level, probeX, topY, bottomY) {
		const blockers = level?.activeBlockers;
		if (!Array.isArray(blockers) || blockers.length === 0) {
			return null;
		}

		const width = Physics.blockerHitboxWidth || 8;
		const height = Physics.blockerHitboxHeight || 8;
		const leftOffset = Math.floor(width / 2);

		const spanTop = Math.floor(Math.min(topY, bottomY));
		const spanBottom = Math.floor(Math.max(topY, bottomY));

		for (const blocker of blockers) {
			if (!blocker || blocker === this || blocker.state !== 'blocking') {
				continue;
			}

			const blockerX = Math.floor(blocker.x);
			const blockerFootY = blocker.getFootY
				? blocker.getFootY()
				: Math.floor(blocker.y + blocker.height - 1);

			const left = blockerX - leftOffset;
			const right = left + width - 1;
			const top = blockerFootY - height + 1;
			const bottom = blockerFootY;

			const xOverlaps = probeX >= left && probeX <= right;
			const yOverlaps = spanBottom >= top && spanTop <= bottom;

			if (xOverlaps && yOverlaps) {
				return blocker;
			}
		}

		return null;
	}

    findBlockingLemmingAt(level, probeX, probeY) {
        const blockers = level?.activeBlockers;
        if (!Array.isArray(blockers) || blockers.length === 0) return null;

        const width = Physics.blockerHitboxWidth || 8;
        const height = Physics.blockerHitboxHeight || 8;
        const leftOffset = Math.floor(width / 2);

        for (const blocker of blockers) {
            if (!blocker || blocker === this || blocker.state !== 'blocking') continue;

            const blockerX = Math.floor(blocker.x);
            const blockerFootY = blocker.getFootY
                ? blocker.getFootY()
                : Math.floor(blocker.y + blocker.height - 1);
            const left = blockerX - leftOffset;
            const right = left + width - 1;
            const top = blockerFootY - height + 1;
            const bottom = blockerFootY;

            if (probeX >= left && probeX <= right &&
                probeY >= top && probeY <= bottom) {
                return blocker;
            }
        }

        return null;
    }

    isBlockedByBlocker(level, probeX, probeY) {
        return !!this.findBlockingLemmingAt(level, Math.floor(probeX), Math.floor(probeY));
    }

    // -------------------------------------------------------------------------
    // CLIMBER (state 3, _LABEL_2F84_)
    //
    // Y -= 1 each tick (1px upward). Falls off if wall disappears.
    // Transitions to walker when it crests the top.
    // -------------------------------------------------------------------------
    updateClimbing(level) {
		const cycleFrames = Physics.climberCycleFrames || 8;
		this.frame = this.skillTick % cycleFrames;
		this.frameCounter = 0;

		const x = Math.floor(this.x);
		const feetY = this.getFootY();
		const direction = this.direction;

		const startFallingOffWall = () => {
			this.state = 'falling';
			this.x -= direction * (Physics.climberFallOffX || 2);
			this.direction *= -1;
			this.fallDistance = 0;
			this.fallFrameCount = 0;
			this.floaterAnimPhase = 'inactive';
			this.frame = 0;
			this.frameCounter = 0;
			this.skillTick = 0;
		};

		const rearProbeX = x - direction;
		const rearProbeY = feetY - (Physics.climberRearProbeYOffset || 6);

		// SMS checks the rear/upper probe and a top guard before climbing.
		if (rearProbeY < (Physics.climberTopGuardY ?? 6) ||
			level.checkCollision(rearProbeX, rearProbeY, level.tilesetManager)) {
			startFallingOffWall();
			return;
		}

		let topScanBlocked = false;
		const topScanStart = Physics.climberTopScanStartOffset || 2;
		const topScanEnd = Physics.climberTopScanEndOffset || 10;

		// If X,Y-2 through X,Y-10 are all clear, the climber has crested.
		for (let offset = topScanStart; offset <= topScanEnd; offset++) {
			if (level.checkCollision(x, feetY - offset, level.tilesetManager)) {
				topScanBlocked = true;
				break;
			}
		}

		if (!topScanBlocked) {
			// The clear top scan means the climber is about to crest. In this engine
			// we need one final 1px upward nudge before handing back to Walker, or the
			// walk-out happens one pixel too low.
			this.y -= Physics.climbSpeed || 1;

			const newFeetY = this.getFootY();
			const supportX = Math.floor(this.x);

			// If the top scan cleared but there is no support at the new foot point,
			// do not briefly become Walker and then Faller. Go straight to Faller.
			// This catches ceiling/awkward top-edge cases cleanly.
			if (!level.checkCollision(supportX, newFeetY, level.tilesetManager)) {
				this.state = 'falling';
				this.fallDistance = 0;
				this.fallFrameCount = 0;
				this.floaterAnimPhase = 'inactive';
				this.frame = 0;
				this.frameCounter = 0;
				this.skillTick = 0;
				return;
			}

			this.state = 'walking';
			this.frame = 0;
			this.frameCounter = 0;
			this.skillTick = 0;
			this.onGround = false;
			return;
		}

		// Default climbing movement: pure vertical 1px up, no X movement.
		this.y -= Physics.climbSpeed || 1;
		this.skillTick++;
	}

    // -------------------------------------------------------------------------
    // FLOATER (state 4, _LABEL_3015_)
    //
    // Probes Y and Y+1 each tick. Moves 1px down when both are clear.
    // Animation: frames 0–7 on first pass (0–4 = opening, 5–7 = loop start),
    // then 5–7 repeating.
    // -------------------------------------------------------------------------
    updateFloating(level) {
        const openingFrameCount = 4;
        if (this.floaterAnimPhase === 'opening' && this.frame >= openingFrameCount) {
            this.floaterAnimPhase = 'loop';
            this.frame = 0;
            this.frameCounter = 0;
        }

        // 1px downward probe, stop and land on first solid pixel.
        const feetY = Math.floor(this.y + this.height);
		const hitsFeet = level.checkCollision(this.x, feetY, level.tilesetManager);
		const hitsBelowFeet = level.checkCollision(this.x, feetY + 1, level.tilesetManager);

		if (!hitsFeet && !hitsBelowFeet) {
			this.y += Physics.floaterFallSpeed;
			this.fallDistance += Physics.floaterFallSpeed;
		} else {
			this.land(level, hitsFeet ? feetY : feetY + 1);
        }
    }

    // -------------------------------------------------------------------------
    // DIGGER (state 11, _LABEL_3039_)
    //
    // 8-tick physics cycle (ix+7 & 0x07):
    //   Sub-frame 0: terrain removal at current position.
    //   Sub-frame 1: Y += 1 (1px downward). Only position change in the cycle.
    //   All other sub-frames: animation only, no position change.
    // -------------------------------------------------------------------------
		updateDigging(level) {
		const cycleFrames = Physics.diggerCycleFrames || 12;
		const actionFrame = this.skillTick % cycleFrames;

		// Digger owns its animation frame so the visual 12-frame cycle and
		// terrain/action frames cannot drift apart.
		this.frame = actionFrame;
		this.frameCounter = 0;

		const resetToWalking = () => {
			this.state = 'walking';
			this.frame = 0;
			this.frameCounter = 0;
			this.skillTick = 0;
		};

		const isFrameInList = (frames, fallbackFrames) => {
			const frameList = Array.isArray(frames) ? frames : fallbackFrames;
			return frameList.includes(actionFrame);
		};

		if (isFrameInList(Physics.diggerStampFrames, [0, 8])) {
			const feetY = Math.floor(this.y + this.height - 1) + (Physics.diggerEraseYOffset ?? 0);
			const centerX = Math.floor(this.x);

			// SMS Digger stamp is 13 pixels total:
			// row 0: x-3..x+3 at foot level
			// row 1: x-2..x+3 one pixel below
			const rects = [
				{
					x: centerX - 3,
					y: feetY,
					w: 7,
					h: 1
				},
				{
					x: centerX - 2,
					y: feetY + 1,
					w: 6,
					h: 1
				}
			];

			let removalResult = { blocked: false };

			if (level.removeTerrainRects) {
				removalResult = level.removeTerrainRects(rects, {
					skill: 'digger',
					direction: this.direction
				});
			} else if (level.removeTerrainRect) {
				// Fallback: less exact, but keeps older levels from exploding if
				// the multi-rect helper is unavailable.
				removalResult = level.removeTerrainRect(centerX - 3, feetY, 7, 2, {
					skill: 'digger',
					direction: this.direction
				});
			}

			// Steel/blocking pixels anywhere in the 7x2 stamp stop the Digger.
			// Empty air is not a failure.
			if (removalResult?.blocked) {
				resetToWalking();
				return;
			}
		}

		if (isFrameInList(Physics.diggerStepFrames, [1, 9])) {
			this.y += Physics.diggerSpeed || 1;

			const feetY = Math.floor(this.y + this.height - 1);
			const centerX = Math.floor(this.x);
			let hasSupport = false;

			// After stepping down, SMS scans X-3..X+3 at the new foot level.
			// Any single solid pixel keeps the Digger active.
			for (let x = centerX - 3; x <= centerX + 3; x++) {
				if (level.checkCollision(x, feetY, level.tilesetManager)) {
					hasSupport = true;
					break;
				}
			}

			if (!hasSupport) {
				resetToWalking();
				return;
			}
		}

		this.skillTick++;
	}

    updateMining(level) {
    // Restored to the correct 18-frame loop for the Miner!
    const cycleFrames = Physics.minerCycleFrames || 18;
    const actionFrame = (this.skillTick % cycleFrames) + 1;

    // Miner owns its animation frame. 
    this.frame = actionFrame - 1;
    this.frameCounter = 0;

    const startFalling = () => {
        this.state = 'falling';
        this.fallDistance = 0;
        this.fallFrameCount = 0;
        this.floaterAnimPhase = 'inactive';
        this.frame = 0;
        this.frameCounter = 0;
        this.skillTick = 0;
        this.minerNeedsSupportCheck = false;
    };
    
    const resetToWalking = () => {
        this.state = 'walking';
        this.frame = 0;
        this.frameCounter = 0;
        this.skillTick = 0;
        this.minerNeedsSupportCheck = false;
    };

    const getFarSideX = () => {
        const anchorX = Math.floor(this.x);
        const leftPixelsFromAnchor = Math.floor(this.width / 2);
        const rightPixelsFromAnchor = this.width - leftPixelsFromAnchor - 1;

        return this.direction > 0
            ? anchorX - leftPixelsFromAnchor
            : anchorX + rightPixelsFromAnchor;
    };

    const addMinerStampRects = (rects, originX, feetY) => {
        // Staggered heights to create a diagonal, staircase cut
        const heights = Physics.minerStampColumnHeights || [13, 13, 12, 11, 10];

        for (let column = 0; column < heights.length; column++) {
            const height = heights[column];
            const x = this.direction > 0
                ? originX + column
                : originX - column;

            // Add a drop offset: as we move forward, the cut shifts down
            const dropOffset = Math.floor(column / 2); 

            rects.push({
                x,
                y: (feetY - height + 1) + dropOffset,
                w: 1,
                h: height
            });
        }
    };

    const hasMinerFloorSupport = () => {
        const feetY = Math.floor(this.y + this.height - 1);
        
        // Respect direction when scanning the 4 pixels under the body
        const startX = Math.floor(this.x) + (this.direction > 0 ? -1 : -2);

        for (let offset = 0; offset < 4; offset++) {
            if (level.checkCollision(
                startX + offset,
                feetY,
                level.tilesetManager
            )) {
                return true;
            }
        }

        return false;
    };

    if (actionFrame === (Physics.minerEraseFrame ?? 3)) {
        const feetY = Math.floor(this.y + this.height - 1);
        const originX = getFarSideX();
        const rects = [];

        // Frame 3: stamp the same 5px-wide Miner mask twice.
        addMinerStampRects(rects, originX, feetY);
        addMinerStampRects(rects, originX + this.direction, feetY);

        let removalResult = {
            blocked: false,
            hitSolid: false,
            erased: false
        };

        if (level.removeTerrainRects) {
            removalResult = level.removeTerrainRects(rects, {
                skill: 'miner',
                direction: this.direction
            });
        } else if (level.removeTerrainRect) {
            const left = Math.min(...rects.map(rect => rect.x));
            const right = Math.max(...rects.map(rect => rect.x + rect.w));
            const top = Math.min(...rects.map(rect => rect.y));
            const bottom = Math.max(...rects.map(rect => rect.y + rect.h));

            removalResult = level.removeTerrainRect(
                left,
                top,
                right - left,
                bottom - top,
                {
                    skill: 'miner',
                    direction: this.direction
                }
            );
        }

        // Steel and wrong-way One-Way cancel the whole stroke.
        if (removalResult?.blocked) {
            resetToWalking();
            return;
        }
    }

    if (actionFrame === (Physics.minerMoveFrame ?? 4)) {
        // Frame 4: move 2px in the mining direction and 1px down.
        this.x += this.direction * (Physics.minerSpeedX ?? 2);
        this.y += Physics.minerSpeedY ?? 1;

        // Revert to Walker if the 4-pixel floor scan is all air. 
        if (!hasMinerFloorSupport()) {
            startFalling();
            return;
        }
    }

    this.skillTick++;
}

    // -------------------------------------------------------------------------
    // BASHER (state 9, _LABEL_3085_)
    //
    // 8-tick physics cycle. The terrain work fires on sub-frame 4. Unlike the
    // old stub, the Basher does not step down to follow terrain: it cuts and
    // moves straight horizontally from the lemming's current position.
    //
    // The only continue check for this first SMS-ish pass is the bottom pixel
    // of the next 2px column/slice that would be bashed. If that single pixel
    // has terrain, keep bashing; otherwise revert to Walker.
    // -------------------------------------------------------------------------
    updateBashing(level) {
		const cycleFrames = Physics.basherCycleFrames || 28;
		const actionFrame = this.skillTick % cycleFrames;

		// Basher owns its animation frame so the 28-frame visual loop and
		// the stamp/step action frames cannot drift apart.
		this.frame = actionFrame;
		this.frameCounter = 0;

		const stampFrames = Array.isArray(Physics.basherStampFrames)
			? Physics.basherStampFrames
			: [4, 12, 20];
		const stepFrames = Array.isArray(Physics.basherStepFrames)
			? Physics.basherStepFrames
			: [5, 13, 21];

		const resetToWalking = () => {
			this.state = 'walking';
			this.frame = 0;
			this.frameCounter = 0;
			this.skillTick = 0;
					};

		const startFalling = () => {
			this.state = 'falling';
			this.fallDistance = 0;
			this.fallFrameCount = 0;
			this.floaterAnimPhase = 'inactive';
			this.frame = 0;
			this.frameCounter = 0;
			this.skillTick = 0;
					};

		const removeBasherStamp = () => {
			const footX = Math.floor(this.x);
			const feetY = Math.floor(this.y + this.height - 1);
			const topY = feetY - 10;
			const lowerTopY = feetY - 9;

			// SMS right-facing _DATA_755B:
			//   y=-10: 4px wide, x=0..+3
			//   y=-9..-1: 5px wide, x=0..+4
			// Left-facing mirrors horizontally to x=-3..0 and x=-4..0.
			const rects = this.direction > 0
				? [
					{ x: footX, y: topY, w: 4, h: 1 },
					{ x: footX, y: lowerTopY, w: 5, h: 9 }
				]
				: [
					{ x: footX - 3, y: topY, w: 4, h: 1 },
					{ x: footX - 4, y: lowerTopY, w: 5, h: 9 }
				];

			if (level.removeTerrainRects) {
				return level.removeTerrainRects(rects, {
					skill: 'basher',
					direction: this.direction
				});
			}

			if (level.removeTerrainRect) {
				const left = Math.min(...rects.map(rect => rect.x));
				const right = Math.max(...rects.map(rect => rect.x + rect.w));
				const top = Math.min(...rects.map(rect => rect.y));
				const bottom = Math.max(...rects.map(rect => rect.y + rect.h));

				return level.removeTerrainRect(left, top, right - left, bottom - top, {
					skill: 'basher',
					direction: this.direction
				});
			}

			return { blocked: false, hitSolid: false, erased: false };
		};

		const hasEdgeColumnAhead = () => {
			const feetY = Math.floor(this.y + this.height - 1);
			const probeX = Math.floor(this.x) + (3 * this.direction);

			// After a step, SMS checks 10 pixels downward from Y-10 at X+3*dir.
			// If the whole column is clear, the Basher has reached an edge/end.
			for (let y = feetY - 10; y <= feetY - 1; y++) {
				if (level.checkCollision(probeX, y, level.tilesetManager)) {
					return true;
				}
			}

			return false;
		};

		const hasFootingAfterStep = () => {
			const x = Math.floor(this.x);
			const y = Math.floor(this.y + this.height - 1);
			const probes = [
				[x, y],
				[x, y + 1],
				[x + this.direction, y],
				[x + this.direction, y + 1]
			];

			return probes.some(([probeX, probeY]) =>
				level.checkCollision(probeX, probeY, level.tilesetManager)
			);
		};

		if (stampFrames.includes(actionFrame)) {
			const removalResult = removeBasherStamp();

			// Steel and wrong-way One-Way are handled centrally by the terrain
			// removal helper and cancel the whole Basher stroke.
			if (removalResult?.blocked) {
				resetToWalking();
				return;
			}

					}

		if (stepFrames.includes(actionFrame)) {
			this.x += this.direction * (Physics.basherSpeedX ?? 2);

			// Gravity / fall-through check: if the Basher has punched away all
			// four footing pixels, stop bashing and become a Faller immediately.
			if (!hasFootingAfterStep()) {
				startFalling();
				return;
			}

			// End-of-wall / edge check. If the 10px column ahead is empty, stop
			// bashing and hand back to Walker.
			if (!hasEdgeColumnAhead()) {
				resetToWalking();
				return;
			}
		}

		this.skillTick++;
	}

    // -------------------------------------------------------------------------
    // BUILDER (state 8, ASM _LABEL_3292_)
    //
    // This mirrors the ROM routine traced as closely as the current JS
    // terrain model allows. The public JS state remains 'building', but the
    // action flow follows the current play-tested rule:
    //   - if 12 bricks have been placed, hand into the existing shrug/finish
    //     visual path;
    //   - only do Builder work when ix+7/action frame == $09;
    //   - check blocker reversal and the hard Y=$10 top clamp before stamping;
    //   - write the 3px bridge stamp at X, X+dir, X+2*dir and Y-1;
    //   - move 2px forward and 1px up;
    //   - then run the two 10px wall/bonk columns, so a Builder gets the
    //     current brick down before horizontal collision ends the build.
    // -------------------------------------------------------------------------
    updateBuilding(level) {
        if (this.buildCount >= (Physics.maxBricks || 12)) {
            this.startShrugging();
            return;
        }

        const actionCycleFrames = Physics.builderCycleFrames || 16;
        const actionFrame = this.positiveModulo(this.skillTick, actionCycleFrames);
        this.updateBuilderVisualFrame(actionFrame);

        if (actionFrame !== (Physics.builderPlaceFrame ?? 0x09)) {
            this.skillTick++;
            return;
        }

        this.runBuilderAsmFrame(level);
    }

    positiveModulo(value, modulo) {
        return ((value % modulo) + modulo) % modulo;
    }

    updateBuilderVisualFrame(actionFrame) {
        const visualFrames = Physics.builderVisualFrames || 16;
        const visualOffset = Physics.builderVisualFrameOffset ?? 0;
        this.frame = this.positiveModulo(actionFrame + visualOffset, visualFrames);
        this.frameCounter = 0;
    }

    runBuilderAsmFrame(level) {
        const currentX = Math.floor(this.x);
        const currentFeetY = this.getFootY();
        const dir = this.direction < 0 ? -1 : 1;

        // _LABEL_343A_: Builder/blocker interaction reverses direction only;
        // it does not cancel the Builder or reset the brick counter.
        if (this.isBlockedByBlocker(level, currentX + dir, currentFeetY)) {
            this.direction *= -1;
            this.skillTick++;
            return;
        }

        // Hard top guard from cp $10. If the Builder is already above the
        // guard, clamp feet to Y=$10, move 2px backwards, then stop/reverse.
        if (currentFeetY < (Physics.builderTopBoundaryFeetY ?? 0x10)) {
            this.clampFeetToTopBoundary();
            this.x -= dir * (Physics.builderSpeedX || 2);
            this.stopBuilding(true);
            return;
        }

        const brickY = currentFeetY - 1;
		const nextBuildCount = this.buildCount + 1;
		const safeX = this.x;
		const safeY = this.y;

		this.placeBuilderAsmBrick(level, currentX, brickY, dir);

		this.buildCount = nextBuildCount;
		this.x += dir * (Physics.builderSpeedX || 2);
		this.y -= (Physics.builderSpeedY || 1);

		// Horizontal/ceiling bonk is deliberately post-place/post-step. The
		// current brick is still stamped, but the lemming must not remain
		// inside the terrain it bonked into. Rewind to the pre-step anchor,
		// then turn around and walk back.
		if (this.shouldBuilderWallBonk(level, this.getFootY())) {
			this.x = safeX;
			this.y = safeY;
			this.stopBuilding(true);
			return;
		}

        if (this.buildCount >= (Physics.maxBricks || 12)) {
            this.startShrugging();
            return;
        }

        this.skillTick++;
    }

    getBuilderProbeXs() {
        const currentX = Math.floor(this.x);
        const dir = this.direction < 0 ? -1 : 1;
        return [currentX + dir, currentX];
    }

    shouldBuilderWallBonk(level, feetY) {
        const threshold = Physics.builderWallBonkThreshold ?? Physics.builderBonkThreshold ?? 3;
        return this.getBuilderProbeXs().some(probeX =>
            this.countBuilderVerticalHits(level, probeX, feetY) >= threshold
        );
    }

    // Back-compat name for any debug/manual hooks that still call it.
    shouldBuilderBonk(level, feetY) {
        return this.shouldBuilderWallBonk(level, feetY);
    }

    countBuilderVerticalHits(level, probeX, feetY) {
        const scanHeight = Physics.builderWallScanHeight ?? Physics.builderBonkScanHeight ?? 10;
        const threshold = Physics.builderWallBonkThreshold ?? Physics.builderBonkThreshold ?? 3;
        let count = 0;

        for (let i = 0; i < scanHeight; i++) {
            const y = Math.floor(feetY) - 1 - i;
            if (this.isBuilderSolidProbe(level, probeX, y)) {
                count++;
                if (count >= threshold) return count;
            }
        }

        return count;
    }

    countBuilderAsmBrickObstructions(level, x, y, dir = this.direction) {
        const pixels = this.getBuilderAsmBrickPixels(level, x, y, dir);
        let count = 0;

        for (const pixel of pixels) {
            if (this.isBuilderSolidProbe(level, pixel.x, pixel.y)) {
                count++;
            }
        }

        return count;
    }

    getBuilderAsmBrickPixels(level, x, y, dir = this.direction) {
        if (typeof level?.getBuilderAsmBrickPixels === 'function') {
            return level.getBuilderAsmBrickPixels(x, y, dir);
        }

        const facing = dir < 0 ? -1 : 1;
        const originX = Math.floor(x);
        const py = Math.floor(y);
        return [0, 1, 2].map(offset => ({
            x: originX + facing * offset,
            y: py
        }));
    }

    placeBuilderAsmBrick(level, x, y, dir = this.direction) {
        if (typeof level?.placeBuilderAsmBrick === 'function') {
            level.placeBuilderAsmBrick(x, y, dir);
            return;
        }

        if (typeof level?.placeBrick === 'function') {
            level.placeBrick(x, y, dir);
        }
    }

    isBuilderSolidProbe(level, x, y) {
        if (typeof level?.checkBaseTerrainCollision === 'function') {
            return level.checkBaseTerrainCollision(x, y, level.tilesetManager);
        }

        return !!level?.checkCollision?.(x, y, level.tilesetManager);
    }

    getBuilderTerrainBehavior(level, x, y) {
        if (typeof level?.getBaseTerrainBehaviorAtPixel === 'function') {
            return level.getBaseTerrainBehaviorAtPixel(x, y);
        }

        return this.isBuilderSolidProbe(level, x, y) ? 'solid' : null;
    }

    // Legacy helpers retained for older debug/manual hooks. The exact ASM path
    // above no longer uses the earlier frame-$03 split-clearance system.
    checkBuilderEarlyClearance(level) {
        return this.shouldBuilderWallBonk(level, this.getFootY()) ? 'turn' : 'clear';
    }

    checkBuilderPlacementClearance(level, nextX, nextFeetY) {
        return this.shouldBuilderWallBonk(level, nextFeetY) ? 'ceiling' : 'clear';
    }

    isBuilderHardCeilingBlocked(level, feetY) {
        return false;
    }

    isBuilderStepBackBlocked(level, nextX, nextFeetY) {
        return false;
    }

    wouldBuilderBrickCollide(level, x, feetY) {
        const pixels = this.getBuilderAsmBrickPixels(level, x, Math.floor(feetY) - 1, this.direction);
        return pixels.some(pixel => this.isBuilderSolidProbe(level, pixel.x, pixel.y));
    }

    getBuilderBrickFallbackPixels(x, feetY, dir = 1) {
        return this.getBuilderAsmBrickPixels(null, x, Math.floor(feetY) - 1, dir);
    }

    stopBuilding(turnAround = false) {
        if (turnAround) this.direction *= -1;
        this.state = 'walking';
        this.buildCount = 0;
        this.skillTick = 0;
        this.lastBuilderStepFrame = -1;
        this.shrugHoldTicks = 0;
        this.frame = 0;
        this.frameCounter = 0;
    }

    bonkBuilder() {
        this.stopBuilding(true);
    }

    startShrugging() {
        this.state = 'shrugging';
        this.skillTick = 0;
        this.lastBuilderStepFrame = -1;
        this.shrugHoldTicks = 0;
        this.frame = 0;
        this.frameCounter = 0;
    }

    updateShrugging() {
        const finalShrugFrame = Math.max(0, (Physics.builderShrugFrames || 9) - 1);

        if (this.frame < finalShrugFrame) {
            this.frame++;
            this.skillTick++;
            return;
        }

        this.shrugHoldTicks++;
        if (this.shrugHoldTicks < (Physics.builderShrugHoldTicks || 10)) return;

        this.state = 'walking';
        this.buildCount = 0;
        this.skillTick = 0;
        this.lastBuilderStepFrame = -1;
        this.shrugHoldTicks = 0;
        this.frame = 0;
        this.frameCounter = 0;
    }

    // -------------------------------------------------------------------------
    // BLOCKER (state 7, _LABEL_3263_)
    //
    // Stationary. Turns other lemmings that walk into it.
    // Falls if terrain beneath it is removed (checks every 4 global ticks via
    // DAD9 & 0x03 in the original, approximated here as every tick with the
    // ground check).
    // -------------------------------------------------------------------------
        updateBlocking(level) {
        const checkMask = Physics.blockerSupportCheckMask ?? 0x03;

        if ((this.skillTick & checkMask) !== 0) {
            this.skillTick++;
            return;
        }

        const footX = Math.floor(this.x);
        const footY = this.getFootY();

        // SMS checks exactly the blocker's own foot pixel, not a broad
        // support area and not one pixel below the feet.
        if (!level.checkCollision(footX, footY, level.tilesetManager)) {
            this.skillTick = 0;
            this.frame = 0;
            this.frameCounter = 0;

            if (this.isFloater) {
                this.fallDistance = Lemming.FLOATER_DEPLOY_DISTANCE;
                this.startFloating();
            } else {
                this.state = 'falling';
                this.fallDistance = 0;
                this.fallFrameCount = 0;
                this.floaterAnimPhase = 'inactive';
            }
            return;
        }

        this.skillTick++;
    }

    // -------------------------------------------------------------------------
    // BOMBER (state 6, _LABEL_321F_ / _LABEL_367F_)
    //
    // Entered via assignSkill('bomber'), which sets fuseValue = 1.
    // Pre-ignition phase: fuseSubTick counts 0..15 each tick; every 16 ticks
    //   fuseValue += 20. When fuseValue >= 101, state becomes 'exploding'.
    // Active phase ('exploding'): fuseCounter increments each tick.
    //   At fuseCounter == 22 the lemming explodes.
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
	// BOMBER (fuse flag + state 6 detonation)
	// -------------------------------------------------------------------------
	isOutOfPlayForBomberFuse() {
		return [
			'dead',
			'saved',
			'exiting',
			'drowning',
			'burning',
			'splatting'
		].includes(this.state);
	}

	clearBomberFuse() {
		this.fuseValue = 0;
		this.fuseSubTick = 0;
		this.fuseCounter = 0;
		this.explosionSinks = null;
		this.bomberBangTicks = 0;
        this.explodingFromState = null;
	}

	getBomberCountdownNumber() {
		if (this.fuseValue <= 0 || this.state === 'exploding') return null;

		const fuseStep = Math.max(
			0,
			Math.min(4, Math.floor((this.fuseValue - 1) / (Physics.fuseIncrement || 20)))
		);

		// Assets are named Bomber_5.png down to Bomber_1.png.
		return 5 - fuseStep;
	}
	
	isBomberBangVisible() {
		return this.state === 'exploding' && this.bomberBangTicks > 0;
	}
	
	stampBomberCrater(level) {
		const mask = Physics.bomberCraterMask;

		if (!level.removeTerrainRects || !Array.isArray(mask)) {
			if (level.removeTerrain) {
				level.removeTerrain(
					this.x,
					this.y + Math.floor(this.height / 2),
					Physics.explosionRadius || 16,
					Physics.explosionRadius || 16,
					{ skill: 'bomber' }
				);
			}
			return;
		}

		// The verified crater is 16x24 and centred around the lemming midpoint.
		const originX = Math.floor(this.x) - 8;
		const originY = Math.floor(this.y + this.height / 2) - 9;
		const rects = [];

		for (let rowIndex = 0; rowIndex < mask.length; rowIndex++) {
			const row = mask[rowIndex];
			let runStart = -1;

			for (let column = 0; column <= row.length; column++) {
				const shouldErase = row[column] === '#';

				if (shouldErase && runStart < 0) {
					runStart = column;
				}

				if ((!shouldErase || column === row.length) && runStart >= 0) {
					rects.push({
						x: originX + runStart,
						y: originY + rowIndex,
						w: column - runStart,
						h: 1
					});

					runStart = -1;
				}
			}
		}

		level.removeTerrainRects(rects, {
			skill: 'bomber',
			direction: this.direction
		});
	}

	startExploding() {
        this.explodingFromState = this.state;
		this.state = 'exploding';
		this.fuseCounter = 0;
		this.frame = 0;
		this.frameCounter = 0;

		this.explosionSinks = null;
		this.bomberBangTicks = 0;
	}

	updateBomberFuse() {
		if (this.fuseValue <= 0) return;

		if (this.isOutOfPlayForBomberFuse()) {
			this.clearBomberFuse();
			return;
		}

		this.fuseSubTick = (this.fuseSubTick + 1) & 0x0F;

		if (this.fuseSubTick !== 0) return;

		this.fuseValue += Physics.fuseIncrement || 20;

		if (this.fuseValue >= (Physics.fuseThreshold || 101)) {
			this.startExploding();
		}
	}

	updateExploding(level) {
        if (this.bomberBangTicks > 0) {
            this.bomberBangTicks--;

            if (this.bomberBangTicks <= 0) {
                this.clearBomberFuse();
                this.die('exploded');
            }

            return;
        }

        if (this.explodingFromState !== 'climbing') {
            // During the visible shrug/detonation wind-up the bomber obeys normal
            // terrain collision. If unsupported, it drops at the bomber shrug speed;
            // if terrain is reached, it stops on top instead of sinking through it.
            this.applyBomberShrugGravity(level);
        }

        this.frame = Math.min(
            this.fuseCounter,
            (Physics.bomberShrugFrames || 21) - 1
        );
        this.frameCounter = 0;
        this.fuseCounter++;

        if (this.fuseCounter >= (Physics.fuseActiveFrames || 22)) {
            this.stampBomberCrater(level);
            this.bomberBangTicks = Physics.bomberBangTicks || 1;
        }
    }

    applyBomberShrugGravity(level) {
        if (!level?.checkCollision) return;

        const speed = Physics.bomberShrugFallSpeed || 3;

        for (let i = 0; i < speed; i++) {
            const probeY = Math.floor(this.y + this.height + 1);

            if (level.checkCollision(this.x, probeY, level.tilesetManager)) {
                const landingY = this.findLandingY(level, probeY);
                this.y = landingY - (this.height - 1);
                return;
            }

            this.y++;
        }
    }

    // -------------------------------------------------------------------------
    // DEATH / EXIT ANIMATIONS
    // -------------------------------------------------------------------------
    updateExiting() {
        if (this.frame >= 7) this.state = 'saved';
    }

    updateDrowning() {
        if (this.frame >= 16) this.state = 'dead';
    }

    updateBurning() {
        if (this.frame >= 7) this.state = 'dead';
    }

    updateSplatting() {
        if (this.frame >= 10) this.state = 'dead';
    }

    die(cause) {
		if (cause !== 'exploded') {
			this.clearBomberFuse?.();
		}

		this.frame = 0;
		this.frameCounter = 0;

		if (cause === 'splat') this.state = 'splatting';
		else if (cause === 'exploded') this.state = 'dead';
		else this.state = cause + 'ing';
	}

    // -------------------------------------------------------------------------
    // FLOATER HELPERS
    // -------------------------------------------------------------------------
    shouldDeployFloater() {
        return this.isFloater && this.fallDistance >= Lemming.FLOATER_DEPLOY_DISTANCE;
    }

    startFloating() {
        if (this.state === 'floating') return;
        this.state = 'floating';
        this.floaterAnimPhase = 'opening';
        this.frame = 0;
        this.frameCounter = 0;
    }

    // -------------------------------------------------------------------------
    // SKILL ASSIGNMENT
    // Mirrors the $7A80 skill application table in ROM.
    // Climber and Floater set persistent flags (ix+1 bits 0/1).
    // Bomber arms the pre-ignition fuse (ix+10 = 1).
    // All others directly set the state (ix+0).
    // -------------------------------------------------------------------------
    // Called every display frame (60fps), independently of the 20Hz physics gate.
    // Advances the sprite animation counter so lemmings animate at ~15fps
    // (frameDelay=4 at 60fps) regardless of the physics tick rate.
    updateAnimation() {
		if (this.state === 'digging' ||
			this.state === 'mining' ||
			this.state === 'bashing' ||
			this.state === 'building' ||
			this.state === 'shrugging' ||
			this.state === 'climbing' ||
			this.state === 'exploding') {

			return;
		}

		this.frameCounter++;
		if (this.frameCounter >= this.frameDelay) {
			this.frameCounter = 0;
			this.frame++;
		}
	}

    assignSkill(skill) {
        if (skill === 'climber') {
            this.isClimber = true;
        } else if (skill === 'floater') {
            this.isFloater = true;
            if (this.state === 'falling' && this.shouldDeployFloater()) {
                this.startFloating();
            }
        } else if (skill === 'bomber') {
			// Bomber is a fuse flag, not a normal action state.
			// The lemming keeps its current state until detonation.
			this.fuseValue = Physics.fuseStartValue || 1;
			this.fuseSubTick = 0;
			this.fuseCounter = 0;
			this.explosionSinks = null;
			this.bomberBangTicks = 0;
            this.explodingFromState = null;
        } else if (skill === 'blocker') {
            this.state = 'blocking';
            this.skillTick = 0;
            this.frame = 0;
            this.frameCounter = 0;
        } else if (skill === 'builder') {
            this.state = 'building';
            this.buildCount = 0;
            this.skillTick = 0;
            this.lastBuilderStepFrame = -1;
            this.shrugHoldTicks = 0;
            this.frame = 0;
            this.frameCounter = 0;
        } else if (skill === 'basher') {
			this.state = 'bashing';
			this.skillTick = 0;
			this.frame = 0;
			this.frameCounter = 0;

			// Startup grace lets the first Basher stroke connect with terrain a few
			// pixels ahead, rather than requiring the lemming to hug the wall.
		} else if (skill === 'miner') {
			this.state = 'mining';
			this.skillTick = 0;
			this.frame = 0;
			this.frameCounter = 0;
			this.minerNeedsSupportCheck = false;
		} else if (skill === 'digger') {
            this.state = 'digging';
            this.skillTick = 0;
            this.frame = 0;
            this.frameCounter = 0;
        }
    }
}
