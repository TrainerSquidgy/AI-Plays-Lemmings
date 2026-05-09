// Keyboard / D-pad controlled selection cursor.
// No mouse input: the cursor is the only way to target lemmings.
//
// All cursor movement values are SMS pixels per game-logic tick (20Hz).
// Camera scroll values are in pixels (1 SMS tile = 8px).

class GameCursor {
    // SMS cursor acceleration tiers (_LABEL_2A5F_, DAEB hold counter):
    //   Frames 1–3  held: 1px/tick  (DAEB < 4)
    //   Frames 4–15 held: 2px/tick  (DAEB 4–15)
    //   Frames 16+  held: 3px/tick orthogonal, 2px/tick diagonal (DAEB >= 16)
    static SPEED_INITIAL  = 1; // px, DAEB 0–3
    static SPEED_MID      = 2; // px, DAEB 4–15
    static SPEED_TOP_ORTH = 3; // px, DAEB 16+ single axis
    static SPEED_TOP_DIAG = 2; // px, DAEB 16+ both axes (capped)
    static SPEED_MAGNET   = 1; // px, hovering over a lemming

    static HOLD_MID_THRESHOLD = 4;  // DAEB value where mid speed begins
    static HOLD_TOP_THRESHOLD = 16; // DAEB value (0x10) where top speed begins

    // Camera scroll triggers (_LABEL_2AF9_):
    // The cursor X is compared against these absolute pixel values (DB58).
    // $10 = 16px left edge, $F8 = 248px right edge.
    static CAMERA_EDGE_LEFT  = 0x10; // 16
    static CAMERA_EDGE_RIGHT = 0xF8; // 248

    // Camera scroll speed in pixels per logic tick (DAEC is in tiles; 1 tile = 8px).
    // L = DBD0 * 4 + 1: DBD0=0 → L=1 tile, DBD0=1 → L=5 tiles.
    static CAMERA_SCROLL_STANDARD_PX = 1 * 8; //  8px (1 tile)
    static CAMERA_SCROLL_FAST_PX     = 5 * 8; // 40px (5 tiles)

    constructor() {
        this.x = 168;
        this.y = 76;
        this.width = 8;
        this.height = 16;

        // DAEB: hold-frame counter. Increments each tick a direction is held;
        // resets to 0 when direction is released or reversed.
        this.directionHoldFrames = 0;
        this.lastMoveX = 0;
        this.lastMoveY = 0;

        // Cursor is hidden during the preview → play camera return, then shown
        // again once it is re-centred at the starting camera position.
        this.visible = true;

        this.hoveredLemming = null;
        this.hoverStackCount = 0;
        this.hoveredLemmingIndex = null;
    }

    reset(renderer, level) {
        const levelWidth = level ? level.width * 8 : 896;
        const cursorMaxY = renderer ? renderer.logicalHeight - 1 : 191;

        this.x = Math.min(levelWidth - 1, Math.max(0, renderer.camera.x + Math.floor(renderer.viewportWidth / 2)));
        this.y = Math.min(cursorMaxY, Math.max(0, renderer.camera.y + Math.floor(renderer.viewportHeight / 2)));
        this.hoveredLemming = null;
        this.hoverStackCount = 0;
        this.hoveredLemmingIndex = null;
        this.directionHoldFrames = 0;
        this.lastMoveX = 0;
        this.lastMoveY = 0;
        this.visible = true;
    }

    setVisible(visible) {
        this.visible = !!visible;
    }

    getCameraEdgeLeft() {
        return 0;
    }

    getCameraEdgeRight(renderer) {
        if (!renderer) return GameCursor.CAMERA_EDGE_RIGHT;
        return Math.max(0, Math.floor(renderer.viewportWidth - 1));
    }

    update(input, renderer, level, lemmings, options = {}) {
        const levelWidth = level ? level.width * 8 : 896;
        const cursorMaxY = renderer ? renderer.logicalHeight - 1 : 191;
        const allowCameraScroll = options.allowCameraScroll !== false;

        const move = this.getMovementVector(input);

        // Boundary scrolling is a separate SMS path. When the cursor is jammed
        // against an edge trigger ($10 or $F8 in screen space), the camera moves
        // and the cursor is held at the edge. Camera moves 1 tile (8px) normally,
        // 5 tiles (40px) while Button 1 is held.
        if (this.tryBoundaryScroll(input, renderer, levelWidth, move.dx, allowCameraScroll)) {
            this.y += move.dy * this.getSmsMovementSpeed(0, move.dy, false);
            this.y = Math.max(0, Math.min(cursorMaxY, this.y));
            this.updateLemmingStack(lemmings);
            return this.hoveredLemming;
        }

        const currentlyHovering = this.updateLemmingStack(lemmings).count > 0;
        const speed = this.getSmsMovementSpeed(move.dx, move.dy, currentlyHovering);

        this.x += move.dx * speed;
        this.y += move.dy * speed;

        this.x = Math.max(0, Math.min(levelWidth - 1, this.x));
        this.y = Math.max(0, Math.min(cursorMaxY, this.y));

        this.updateLemmingStack(lemmings);

        return this.hoveredLemming;
    }

    getMovementVector(input) {
        let dx = 0;
        let dy = 0;

        if (input.isPressed('left'))  dx--;
        if (input.isPressed('right')) dx++;
        if (input.isPressed('up'))    dy--;
        if (input.isPressed('down'))  dy++;

        // Opposing directions cancel cleanly.
        dx = Math.max(-1, Math.min(1, dx));
        dy = Math.max(-1, Math.min(1, dy));

        return { dx, dy };
    }

    getSmsMovementSpeed(dx, dy, overSelectableLemming) {
        if (dx === 0 && dy === 0) {
            this.directionHoldFrames = 0;
            this.lastMoveX = 0;
            this.lastMoveY = 0;
            return 0;
        }

        // A fresh direction press or reversal resets the hold counter.
        if (dx !== this.lastMoveX || dy !== this.lastMoveY) {
            this.directionHoldFrames = 1;
            this.lastMoveX = dx;
            this.lastMoveY = dy;
        } else {
            this.directionHoldFrames = Math.min(
                this.directionHoldFrames + 1,
                GameCursor.HOLD_TOP_THRESHOLD // cap at 16; ASM stores 0x10 max
            );
        }

        // Magnet: hovering over a lemming forces 1px regardless of hold duration.
        if (overSelectableLemming) {
            return GameCursor.SPEED_MAGNET;
        }

        // Tier 1: frames 1–3
        if (this.directionHoldFrames < GameCursor.HOLD_MID_THRESHOLD) {
            return GameCursor.SPEED_INITIAL;
        }

        // Tier 2: frames 4–15
        if (this.directionHoldFrames < GameCursor.HOLD_TOP_THRESHOLD) {
            return GameCursor.SPEED_MID;
        }

        // Tier 3: frames 16+
        // Diagonal movement is capped at 2px; orthogonal reaches 3px.
        const movingDiagonally = dx !== 0 && dy !== 0;
        return movingDiagonally
            ? GameCursor.SPEED_TOP_DIAG
            : GameCursor.SPEED_TOP_ORTH;
    }

    tryBoundaryScroll(input, renderer, levelWidth, dx, allowCameraScroll = true) {
        if (dx === 0) return false;

        // Convert world cursor X to screen-space X for edge comparison.
        const screenX = this.x - renderer.camera.x;
        const maxCameraX = Math.max(0, levelWidth - renderer.viewportWidth);

        // Use the live viewport edge so the controller cursor can reach the
        // visible screen bounds instead of being trapped at the old 256px SMS
        // edge-trigger constants.
        const scrollSpeed = input.isPressed('button1')
            ? GameCursor.CAMERA_SCROLL_FAST_PX
            : GameCursor.CAMERA_SCROLL_STANDARD_PX;

        const leftEdge = this.getCameraEdgeLeft(renderer);
        const rightEdge = this.getCameraEdgeRight(renderer);
        let desiredDelta = 0;
        let edgeScreenX = null;

        if (dx > 0 && screenX >= rightEdge) {
            edgeScreenX = rightEdge;
            if (renderer.camera.x < maxCameraX) {
                desiredDelta = allowCameraScroll ? scrollSpeed : 0;
            }
        } else if (dx < 0 && screenX <= leftEdge) {
            edgeScreenX = leftEdge;
            if (renderer.camera.x > 0) {
                desiredDelta = allowCameraScroll ? -scrollSpeed : 0;
            }
        } else {
            return false;
        }

        const beforeX = renderer.camera.x;
        renderer.camera.x = Math.max(0, Math.min(maxCameraX, renderer.camera.x + desiredDelta));
        const actualDelta = renderer.camera.x - beforeX;

        // Cursor stays pinned to the edge pixel even when the camera can no
        // longer scroll (level boundary reached).
        this.x = Math.max(0, Math.min(levelWidth - 1, renderer.camera.x + edgeScreenX));
        return actualDelta !== 0 || edgeScreenX !== null;
    }

    updateLemmingStack(lemmings) {
        const result = this.getLemmingsUnderCursor(lemmings);
        this.hoverStackCount = result.count;
        this.hoveredLemmingIndex = result.id;
        this.hoveredLemming = result.id === null ? null : lemmings[result.id];
        return result;
    }

    getLemmingsUnderCursor(lemmings) {
        // SMS _LABEL_2B52_-style stack scan: loops all slots in order,
        // counts every living lemming inside the cursor footprint, and the
        // last matching slot is the active target.
        const cursorLeft   = this.x - Math.floor(this.width / 2);
        const cursorTop    = this.y - Math.floor(this.height / 2);
        const cursorRight  = cursorLeft + this.width;
        const cursorBottom = cursorTop + this.height;

        let stackCounter = 0;
        let selectedID = null;

        for (let i = 0; i < lemmings.length; i++) {
            const lemming = lemmings[i];
            if (!this.isSelectableLemming(lemming)) continue;

            const xHit = lemming.x >= cursorLeft && lemming.x < cursorRight;
            const yHit = lemming.y >= cursorTop - 12 && lemming.y < cursorBottom - 12;

            if (xHit && yHit) {
                stackCounter++;
                selectedID = i;
            }
        }

        return { count: stackCounter, id: selectedID };
    }

    isSelectableLemming(lemming) {
        return ![
            'dead',
            'saved',
            'exiting',
            'drowning',
            'burning',
            'splatting'
        ].includes(lemming.state);
    }

    getScreenRect(camera) {
        return {
            x: Math.floor(this.x - camera.x - 4),
            y: Math.floor(this.y - camera.y - 8),
            width: this.width,
            height: this.height
        };
    }
}
