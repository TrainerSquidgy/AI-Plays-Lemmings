// Physics configuration: SMS Lemmings verified values.
//
// The game loop runs at 20Hz: one SMS logic update every three 60Hz display
// frames. All movement values here are in SMS pixels per logic tick unless
// noted otherwise.
//
// Sources: Z80 disassembly of Lemmings SMS (Lemmings_sms.asm), verified
// against state handlers in the physics jump table (_DATA_2E1E_) and the
// animation counter jump table (_DATA_3604_).

const Physics = {
    // -------------------------------------------------------------------------
    // LEMMING MOVEMENT
    // -------------------------------------------------------------------------

    // Walker (state 1, _LABEL_2E46_): X += direction each tick.
    walkSpeed: 1,

    // Faller (state 2, _LABEL_2F15_): probes 4 slots downward each tick.
    // Moves by the count of consecutive clear pixels found (max 4).
    fallSpeed: 4,

    // Floater (state 4, _LABEL_3015_): probes Y and Y+1 each tick.
    // Moves 1px down when both slots are clear.
    floaterFallSpeed: 1,

    // Climber (state 3, _LABEL_2F84_): dec (ix+5) each tick = 1px upward.
    climbSpeed: 1,
	climberCycleFrames: 8,
	climberFallOffX: 2,
	climberRearProbeYOffset: 6,
	climberTopScanStartOffset: 2,
	climberTopScanEndOffset: 10,
	climberTopGuardY: 6,
	climberSpriteOffsetX: 3,

    // Digger (state 11, _LABEL_3039_):
	// 12-frame action loop.
	// Frames 0 and 8 stamp terrain.
	// Frames 1 and 9 move down 1px, then run the 7px support scan.
	diggerSpeed: 1,
	diggerCycleFrames: 12,
	diggerStampFrames: [0, 8],
	diggerStepFrames: [1, 9],
	// Miner (state 10, _LABEL_3167_ / animation _LABEL_371E_):
	// The action uses an 18-frame loop. Treat SMS action frames as 1-based:
	//   Frame 3: stamp/destroy terrain.
	//   Frame 4: move 2px forward, 1px down, then perform breakthrough scan.
	// Frames 5-18 do no terrain work.
	minerSpeedX: 2,
	minerSpeedY: 1,
	minerCycleFrames: 18,
	minerEraseFrame: 3,
	minerMoveFrame: 4,

	// Temporary column profile for the 5px Miner mask. SMS actually uses
	// _DATA_23C82_ and stamps that same mask twice, 1px apart, creating a 6px cut.
	// Replace this profile with the exact mask data later if/when we transcribe it.
	minerStampColumnHeights: [13, 13, 13, 13, 13],
    
	// Basher (state 9, _LABEL_3085_): terrain removal/movement fires on
	// sub-frame 4 of an 8-tick cycle. It moves straight horizontally; no
	// terrain-following Y drift.
	basherSpeedX: 2,
	basherSpeedY: 0,
	basherCycleFrames: 28,
	basherStampFrames: [4, 12, 20],
	basherStepFrames: [5, 13, 21],
	
	// Blocker (state 7, _LABEL_3263_): 8-frame animation. Behaviour
    // checks exact foot pixel every 4 logic ticks. Dynamic blocker collision
    // is deliberately not part of level.checkCollision(); only walkers and
    // builders opt into it.
    blockerCycleFrames: 8,
    blockerSupportCheckMask: 0x03,
    blockerHitboxWidth: 8,
    blockerHitboxHeight: 8,
	
    // Builder (state 8, _LABEL_3292_): the ROM runs the Builder work when
    // ix+7 == $09. At that point it checks blockers, scans two 10px wall
    // columns, performs the top-boundary guard, probes the three next brick
    // pixels, writes the 3px bridge stamp, then moves 2px forward / 1px up.
    builderSpeedX: 2,
    builderSpeedY: 1,
    builderCycleFrames: 16,
    builderVisualFrames: 16,
    builderPlaceFrame: 0x09,
    // Kept as a backwards-compatible alias for older debug UI / notes.
    builderStepSubframe: 0x09,
    maxBricks: 12,
    builderShrugFrames: 9,
    builderShrugEndFrame: 0x20,
    builderWallScanHeight: 0x0A,
    builderBonkScanHeight: 0x0A,
    builderWallBonkThreshold: 0x03,
    builderBonkThreshold: 0x03,
    builderTopBoundaryFeetY: 0x10,
    builderVisualFrameOffset: 0,

    // -------------------------------------------------------------------------
    // BOMBER FUSE (state 6, _LABEL_321F_ / _LABEL_367F_)
    //
    // Pre-ignition: ix+10 starts at 1, += 20 every 16 ticks until >= 101.
    //   Sequence: 1 → 21 → 41 → 61 → 81 → 101. That is 5 × 16 = 80 ticks.
    // Active state: ix+7 counts up each tick; explodes at ix+7 == 22.
    // Total: ~102 logic ticks ≈ 5.1 seconds at 60Hz.
    // -------------------------------------------------------------------------
    fuseStartValue: 1,
	fuseIncrement: 20,
	fuseThreshold: 101,
	fusePreIgnitionTicks: 80,

	// Active detonation state lasts 22 logic ticks.
	// Bomber_Shrug.png has 21 visible 8x16 frames; the final frame clamps/holds.
	fuseActiveFrames: 22,
	bomberShrugFrames: 21,

	// Hold the final BANG visual for one logic tick after the crater is stamped,
	// so the renderer gets a chance to draw Bomber_Bang.png before the lemming dies.
	bomberBangTicks: 1,

	// During the visible shrug/detonation wind-up, an unsupported bomber falls
	// collision-safely at 3px per logic tick. It must not sink through terrain.
	bomberShrugFallSpeed: 3,

	// SMS crater is fixed/right-biased, not direction-dependent.
	// SMS crater is fixed/right-biased, not direction-dependent.
	// Bomber crater: verified 16x24 symmetrical mask, centred around
	// the lemming midpoint. # = erase, . = leave intact.
	bomberCraterMask: [
		"................",
		"................",
		"................",
		"......####......",
		"....########....",
		"...##########...",
		"..############..",
		"..############..",
		"..############..",
		".##############.",
		".##############.",
		".##############.",
		".##############.",
		".##############.",
		".##############.",
		".##############.",
		".##############.",
		"..############..",
		"..############..",
		"..############..",
		"...##########...",
		"....########....",
		"......####......",
		"................"
	],
	fuseTotalTicks: 102,
    // -------------------------------------------------------------------------
    // SAFE FALL / COLLISION
    // -------------------------------------------------------------------------

    safeFallDistance: 56,
    maxStepUp: 8,
    maxStepDown: 8,

    // Terrain removal / placement dimensions.
	// Digger removes an exact 7px-wide horizontal strip at foot level. The
	// first 1px dig cycle is always allowed to happen before support checks.
	digWidth: 7,
	digDepth: 1,
	diggerEraseYOffset: 0,

    // Basher stamp shape: 10px high, with a 4px tapered top row and 5px
	// rows beneath it. Right-facing occupies x=0..+4 from the foot X;
	// left-facing mirrors to x=-4..0.
	bashWidth: 5,
	bashHeight: 10,
	basherTopRowWidth: 4,
	basherStartReach: 6,

    // SMS Builder bridge stamp. The original writes via a tiny terrain-stamp
    // data table; keep that shape explicit even though it is currently a 3px
    // horizontal brick.
    builderBrickMask: [
        "###"
    ],
    brickWidth: 3,
    brickHeight: 1,
    // Builder bridge placement is direction-aware. Right-facing placement
    // needed one final visual anchor nudge in v7. Apply the same mirrored
    // nudge to left-facing Builder here: down by 1px, and 1px in the facing
    // direction, while leaving the 2:1 bridge angle and timing untouched.
    builderBrickOffsetX: -2,
    builderBrickRightAnchorOffsetX: 1,
    builderBrickLeftAnchorOffsetX: -1,
    // SMS appears to anchor the bridge on the terrain surface rather than
    // one pixel above it. Both facing directions now share the final downward
    // anchor nudge to match the Builder sprite/bridge contact point.
    builderBrickOffsetY: -1,
    builderBrickRightAnchorOffsetY: 1,
    builderBrickLeftAnchorOffsetY: 1,

    // Draw-only Builder animation offsets. These keep the physics anchor
    // untouched while matching each facing sprite to its bridge anchor.
    // Current sprite sheet sits 1px high in Builder state, so nudge only
    // the Builder animation down one extra pixel. Bridge collision/terrain
    // placement offsets above are deliberately unchanged.
    builderRightAnimationOffsetX: 0,
    builderRightAnimationOffsetY: 0,
    builderLeftAnimationOffsetX: 1,
    builderLeftAnimationOffsetY: 0,

    // Hold the final shrug frame for roughly 60 display frames. Shrugging is
    // checked on the 20Hz logic gate, so 20 logic ticks ~= 60 display frames.
    builderShrugHoldTicks: 20,

    // Legacy/debug probe constants retained for older tools. The current
    // ASM Builder path uses exact wall scan columns X+dir and X, so no
    // left/right correction is applied by the live Builder routine.
    builderStepBlockedScanHeight: 4,
    builderStepBackProbeOffset: 2,
    builderLeftBonkProbeCorrectionX: 0,

   
    // -------------------------------------------------------------------------
    // ELECTRON DEBUG PANEL HOT-RELOAD
    // -------------------------------------------------------------------------
    update(newValues) {
        Object.assign(this, newValues);
    }
};

if (typeof require !== 'undefined') {
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('physics-update', (event, newValues) => {
            Physics.update(newValues);
        });
    } catch (e) {
        // Not running in Electron; ignore.
    }
}
