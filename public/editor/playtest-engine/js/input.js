class InputHandler {
    constructor() {
        this.keyboardKeys = {};
        this.gamepadKeys = {};
        this.mouseKeys = {};
        this.keysPressed = {};
        this.gamepad = null;

        this.pointer = {
            x: 0,
            y: 0,
            insideCanvas: false,
            leftDown: false,
            leftJustPressed: false,
            leftJustReleased: false,
            moved: false,
            wheelSteps: 0,
            activePointerId: null,
            selectSuppressedUntilRelease: false
        };
        this.pointerCanvas = null;
        this.pointerRenderer = null;
		
		

        // Manual pause/menu is allowed even while movement/action buttons are
        // held. Button 1+Button 2 skill cycling is filtered in game.js so that
        // combo still cannot toggle pause.

        this.keyMap = {
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
            'ArrowUp': 'up',
            'ArrowDown': 'down',
            'Space': 'pause',
            'KeyP': 'pause',
            'Enter': 'select',
            'NumpadEnter': 'select',
            'KeyZ': 'select',
            'KeyH': 'select',
            'ShiftLeft': 'button1',
            'ShiftRight': 'button1',
            'Tab': 'speedUp',
            'KeyQ': 'skillPrev',
            'KeyE': 'skillNext',
            'KeyM': 'toggleMute',
            'KeyN': 'toggleHalfVolume',
            'Digit1': 'skill1',
            'Digit2': 'skill2',
            'Digit3': 'skill3',
            'Digit4': 'skill4',
            'Digit5': 'skill5',
            'Digit6': 'skill6',
            'Digit7': 'skill7',
            'Digit8': 'skill8',
            'Digit9': 'rateDown',
            'Digit0': 'rateUp',
            'F1': 'debugPanel',
            'Escape': 'menu'
        };

        this.gamepadActions = [
            'left',
            'right',
            'up',
            'down',
            'select',
            'button1',
            'pause',
            'menu',
            'skillPrev',
            'skillNext',
            'speedUp',
            'toggleMute',
            'toggleHalfVolume',
            'mpTogglePlayer'
        ];

        this.setupEventListeners();
    }

	resetPointerState() {
		this.mouseKeys.select = false;

		this.pointer.leftDown = false;
		this.pointer.leftJustPressed = false;
		this.pointer.leftJustReleased = false;
		this.pointer.activePointerId = null;
		this.pointer.selectSuppressedUntilRelease = false;
	}

	resetAllHeldInputs() {
		this.keyboardKeys = {};
		this.gamepadKeys = {};
		this.mouseKeys = {};
		this.keysPressed = {};
		this.resetPointerState();
	}

    attachPointerTarget(canvas, renderer) {
        this.pointerCanvas = canvas;
        this.pointerRenderer = renderer;
        if (!canvas) return;

        const updatePointerPosition = (event) => {
            const rect = canvas.getBoundingClientRect();
            const logicalWidth = renderer?.logicalWidth || canvas.width || 336;
            const logicalHeight = renderer?.logicalHeight || canvas.height || 192;
            const rectWidth = Math.max(1, rect.width || logicalWidth);
            const rectHeight = Math.max(1, rect.height || logicalHeight);

            const x = Math.floor((event.clientX - rect.left) * logicalWidth / rectWidth);
            const y = Math.floor((event.clientY - rect.top) * logicalHeight / rectHeight);

            this.pointer.x = Math.max(0, Math.min(logicalWidth - 1, x));
            this.pointer.y = Math.max(0, Math.min(logicalHeight - 1, y));
            this.pointer.insideCanvas = event.clientX >= rect.left && event.clientX < rect.right &&
                event.clientY >= rect.top && event.clientY < rect.bottom;
            this.pointer.moved = true;
        };

        canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            canvas.setPointerCapture?.(event.pointerId);
            this.pointer.activePointerId = event.pointerId;
            this.pointer.selectSuppressedUntilRelease = false;
            updatePointerPosition(event);

            if (!this.isPressed('select')) this.keysPressed.select = true;
            this.mouseKeys.select = true;
            this.pointer.leftDown = true;
            this.pointer.leftJustPressed = true;
        });

        canvas.addEventListener('pointermove', (event) => {
            if (this.pointer.activePointerId !== null && event.pointerId !== this.pointer.activePointerId) return;
            updatePointerPosition(event);
        });

        const releasePointer = (event) => {
            if (this.pointer.activePointerId !== null && event.pointerId !== this.pointer.activePointerId) return;
            event.preventDefault();
            updatePointerPosition(event);
            this.mouseKeys.select = false;
            this.pointer.leftDown = false;
            this.pointer.leftJustReleased = true;
            this.pointer.activePointerId = null;
            this.pointer.selectSuppressedUntilRelease = false;
            canvas.releasePointerCapture?.(event.pointerId);
        };

        canvas.addEventListener('pointerup', releasePointer);
        canvas.addEventListener('pointercancel', releasePointer);
        canvas.addEventListener('pointerleave', (event) => {
            if (!this.pointer.leftDown) this.pointer.insideCanvas = false;
        });

        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (rawDelta !== 0) {
                this.pointer.wheelSteps += Math.sign(rawDelta);
            }
        }, { passive: false });

        canvas.addEventListener('contextmenu', event => event.preventDefault());
    }

    consumePointerSelectPress() {
        this.pointer.leftJustPressed = false;
        this.clearPress('select');
        this.mouseKeys.select = false;
        if (this.pointer.leftDown) {
            this.pointer.selectSuppressedUntilRelease = true;
        }
    }

    consumeWheelSteps() {
        const steps = this.pointer.wheelSteps || 0;
        this.pointer.wheelSteps = 0;
        return steps;
    }

    setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            const action = this.keyMap[e.code];
            if (action) {
                e.preventDefault();
                if (!this.isPressed(action)) this.keysPressed[action] = true;
                this.keyboardKeys[action] = true;
            }
        });
		
		window.addEventListener('blur', () => {
			this.resetAllHeldInputs();
		});

		document.addEventListener('visibilitychange', () => {
			if (document.hidden) {
				this.resetAllHeldInputs();
			}
		});

		window.addEventListener('pointerup', () => {
			this.resetPointerState();
		});

		window.addEventListener('pointercancel', () => {
			this.resetPointerState();
		});
		
		canvas.addEventListener('lostpointercapture', () => {
			this.resetPointerState();
			});

        window.addEventListener('keyup', (e) => {
            const action = this.keyMap[e.code];
            if (action) this.keyboardKeys[action] = false;
        });

        window.addEventListener('gamepadconnected', (e) => {
            this.gamepad = e.gamepad;
            console.log(`Gamepad connected: ${e.gamepad.id}`);
        });

        window.addEventListener('gamepaddisconnected', () => {
            this.gamepad = null;
            this.gamepadKeys = {};
            console.log('Gamepad disconnected');
        });
    }

    update() {
        this.updateGamepad();
    }

    updateGamepad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = pads && Array.from(pads).find(Boolean);

        if (!pad) {
            for (const action of this.gamepadActions) {
                this.setGamepadAction(action, false);
            }
            return;
        }

        this.gamepad = pad;

        const axisX = pad.axes[0] || 0;
        const axisY = pad.axes[1] || 0;
        const threshold = 0.45;
        const buttonPressed = (index) => !!pad.buttons[index]?.pressed;

        this.setGamepadAction('left', axisX < -threshold || buttonPressed(14));
        this.setGamepadAction('right', axisX > threshold || buttonPressed(15));
        this.setGamepadAction('up', axisY < -threshold || buttonPressed(12));
        this.setGamepadAction('down', axisY > threshold || buttonPressed(13));

        // Standard mapping for an Xbox-style pad:
        // 0 = A = SMS Button 2 / select
        // 1 = B = SMS Button 1 / held camera turbo
        // 2 = X = debug fast-forward toggle
        // 4/5 = shoulders.
        // 8 = View/Select = menu, 9 = Menu/Start = pause.
        const smsButton2Pressed = buttonPressed(0);
        const smsButton1Pressed = buttonPressed(1);
        this.setGamepadAction('select', smsButton2Pressed);
        this.setGamepadAction('button1', smsButton1Pressed);

        this.setGamepadAction('menu', buttonPressed(8));
        this.setGamepadAction('pause', buttonPressed(9));
        this.setGamepadAction('skillPrev', buttonPressed(4));
        this.setGamepadAction('skillNext', buttonPressed(5));
        this.setGamepadAction('speedUp', buttonPressed(2));
        // Multiplayer prototype: Y switches the locally controlled player.
        // Single-player ignores this action.
        this.setGamepadAction('mpTogglePlayer', buttonPressed(3));
    }

    setGamepadAction(action, pressed) {
        const wasPressed = this.isPressed(action);
        this.gamepadKeys[action] = pressed;

        if (pressed && !wasPressed) {
            this.keysPressed[action] = true;
        }
    }

    isPressed(action) {
        return !!(this.keyboardKeys[action] || this.gamepadKeys[action] || this.mouseKeys[action]);
    }

    wasJustPressed(action) {
        if (this.keysPressed[action]) {
            this.keysPressed[action] = false;
            return true;
        }
        return false;
    }

    peekJustPressed(action) {
        return !!this.keysPressed[action];
    }

    clearPress(action) {
        delete this.keysPressed[action];
    }

    clearPresses() {
        this.keysPressed = {};
        this.pointer.leftJustPressed = false;
        this.pointer.leftJustReleased = false;
        this.pointer.moved = false;
        this.pointer.wheelSteps = 0;

        if (this.pointer.selectSuppressedUntilRelease && this.pointer.leftDown) {
            this.mouseKeys.select = false;
        }
    }
}
