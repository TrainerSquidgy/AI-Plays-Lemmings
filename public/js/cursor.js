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

    // Expanded/custom levels can be taller than the SMS playfield. Reuse the
    // same 16px screen-edge feel vertically, but compute the bottom edge from
    // the live playfield height so the HUD remains separate.
    static CAMERA_EDGE_TOP = 0x10; // 16

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

    getLevelPixelWidth(level) {
        return level ? (level.pixelWidth || level.width * 8) : 896;
    }

    getLevelPixelHeight(level) {
        return level ? (level.pixelHeight || level.height * 8) : 152;
    }

    getCursorMaxY(renderer, level) {
        if (!renderer) return 191;

        const levelBottom = this.getLevelPixelHeight(level) - 1;
        const hudReachBottom = Math.floor(renderer.camera.y + renderer.logicalHeight - 1);

        // Cursor world coordinates double as HUD targeting coordinates. On a
        // vertically scrolled map, allow the cursor to move below the level by
        // just enough to reach the in-canvas HUD at the current camera offset.
        return Math.max(levelBottom, hudReachBottom);
    }

    getCameraEdgeLeft() {
        // Let controller/keyboard cursor movement reach the visible screen edge.
        // The older SMS trigger used 16px/$10, which made sense for the original
        // viewport but walls the remake cursor off from modern HUD/screen edges.
        return 0;
    }

    getCameraEdgeRight(renderer) {
        if (!renderer) return GameCursor.CAMERA_EDGE_RIGHT;
        return Math.max(0, Math.floor(renderer.viewportWidth - 1));
    }

    getCameraEdgeTop() {
        return 0;
    }

    getCameraEdgeBottom(renderer) {
        if (!renderer) return GameCursor.CAMERA_EDGE_TOP;
        return Math.max(0, Math.floor(renderer.viewportHeight - 1));
    }

    reset(renderer, level) {
        const levelWidth = this.getLevelPixelWidth(level);
        const cursorMaxY = this.getCursorMaxY(renderer, level);

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

    update(input, renderer, level, lemmings, options = {}) {
        const levelWidth = this.getLevelPixelWidth(level);
        const cursorMaxY = this.getCursorMaxY(renderer, level);
        const allowCameraScroll = options.allowCameraScroll !== false;
        const suppressDownwardVerticalCameraScroll = options.suppressDownwardVerticalCameraScroll === true;

        const move = this.getMovementVector(input);
        const currentlyHovering = this.updateLemmingStack(lemmings).count > 0;
        const speed = this.getSmsMovementSpeed(move.dx, move.dy, currentlyHovering);

        // Boundary scrolling is a separate SMS path. Horizontal scrolling keeps
        // the original edge-pinned behaviour. Expanded/custom levels also allow
        // vertical camera scrolling when the cursor reaches the top/bottom of
        // the playfield; the HUD remains reachable once no more vertical scroll
        // is available.
        const scroll = this.tryBoundaryScroll(input, renderer, level, move.dx, move.dy, {
            allowCameraScroll,
            suppressDownwardVerticalCameraScroll
        });
        if (scroll.scrolled) {
            if (!scroll.consumedX) this.x += move.dx * speed;
            if (!scroll.consumedY) this.y += move.dy * speed;

            this.x = Math.max(0, Math.min(levelWidth - 1, this.x));
            this.y = Math.max(0, Math.min(cursorMaxY, this.y));
            this.updateLemmingStack(lemmings);
            return this.hoveredLemming;
        }

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

    tryBoundaryScroll(input, renderer, level, dx, dy, options = {}) {
        const allowCameraScroll = options.allowCameraScroll !== false;
        const suppressDownwardVerticalCameraScroll = options.suppressDownwardVerticalCameraScroll === true;
        const result = { scrolled: false, consumedX: false, consumedY: false };
        if (!renderer || !level) return result;

        const levelWidth = this.getLevelPixelWidth(level);
        const levelHeight = this.getLevelPixelHeight(level);
        const maxCameraX = Math.max(0, levelWidth - renderer.viewportWidth);
        const maxCameraY = Math.max(0, levelHeight - renderer.viewportHeight);

        // Convert world cursor co-ordinates to screen-space for edge tests.
        const screenX = this.x - renderer.camera.x;
        const screenY = this.y - renderer.camera.y;

        const scrollSpeed = input.isPressed('button1')
            ? GameCursor.CAMERA_SCROLL_FAST_PX
            : GameCursor.CAMERA_SCROLL_STANDARD_PX;

        const beforeX = renderer.camera.x;
        const beforeY = renderer.camera.y;
        let edgeScreenX = null;
        let edgeScreenY = null;
        let desiredDeltaX = 0;
        let desiredDeltaY = 0;

        const leftEdge = this.getCameraEdgeLeft(renderer);
        const rightEdge = this.getCameraEdgeRight(renderer);
        const topEdge = this.getCameraEdgeTop(renderer);
        const bottomEdge = this.getCameraEdgeBottom(renderer);

        if (dx > 0 && screenX >= rightEdge) {
            edgeScreenX = rightEdge;
            if (renderer.camera.x < maxCameraX) desiredDeltaX = allowCameraScroll ? scrollSpeed : 0;
        } else if (dx < 0 && screenX <= leftEdge) {
            edgeScreenX = leftEdge;
            if (renderer.camera.x > 0) desiredDeltaX = allowCameraScroll ? -scrollSpeed : 0;
        }

        const cursorInsidePlayfield = screenY >= 0 && screenY < renderer.viewportHeight;

        const allowDownwardVerticalScroll = !suppressDownwardVerticalCameraScroll || input.isPressed('button1');

        if (dy > 0 && allowDownwardVerticalScroll && cursorInsidePlayfield && screenY >= bottomEdge && renderer.camera.y < maxCameraY) {
            edgeScreenY = bottomEdge;
            desiredDeltaY = allowCameraScroll ? scrollSpeed : 0;
        } else if (dy < 0 && cursorInsidePlayfield && screenY <= topEdge && renderer.camera.y > 0) {
            edgeScreenY = topEdge;
            desiredDeltaY = allowCameraScroll ? -scrollSpeed : 0;
        }

        if (edgeScreenX === null && edgeScreenY === null) return result;

        renderer.camera.x = Math.max(0, Math.min(maxCameraX, renderer.camera.x + desiredDeltaX));
        renderer.camera.y = Math.max(0, Math.min(maxCameraY, renderer.camera.y + desiredDeltaY));

        const actualDeltaX = renderer.camera.x - beforeX;
        const actualDeltaY = renderer.camera.y - beforeY;

        if (edgeScreenX !== null) {
            // Preserve SMS horizontal behaviour: the cursor stays pinned to the
            // edge trigger even when the camera has reached the map edge.
            this.x = Math.max(0, Math.min(levelWidth - 1, renderer.camera.x + edgeScreenX));
            result.consumedX = true;
        }

        if (edgeScreenY !== null) {
            // If vertical scroll is available, pin at the playfield edge even
            // on display frames where camera movement is gated off. Once the
            // camera reaches the map bottom, edgeScreenY is no longer set and
            // the cursor can move down into the HUD as usual.
            this.y = Math.max(0, Math.min(this.getCursorMaxY(renderer, level), renderer.camera.y + edgeScreenY));
            result.consumedY = true;
        }

        result.scrolled = actualDeltaX !== 0 || actualDeltaY !== 0 || edgeScreenX !== null || edgeScreenY !== null;
        return result;
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
