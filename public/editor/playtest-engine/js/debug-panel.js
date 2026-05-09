// Debug panel JavaScript
const { ipcRenderer } = require('electron');

// All slider inputs
const sliders = {
    walkSpeed: document.getElementById('walkSpeed'),
    climbSpeed: document.getElementById('climbSpeed'),
    maxStepUp: document.getElementById('maxStepUp'),
    maxStepDown: document.getElementById('maxStepDown'),
    gravity: document.getElementById('gravity'),
    terminalVelocity: document.getElementById('terminalVelocity'),
    safeFall: document.getElementById('safeFall'),
    brickWidth: document.getElementById('brickWidth'),
    brickHeight: document.getElementById('brickHeight'),
    stepRise: document.getElementById('stepRise'),
    maxBricks: document.getElementById('maxBricks'),
    digWidth: document.getElementById('digWidth'),
    digDepth: document.getElementById('digDepth'),
    bashWidth: document.getElementById('bashWidth'),
    bashHeight: document.getElementById('bashHeight'),
    mineAngle: document.getElementById('mineAngle'),
    explosionRadius: document.getElementById('explosionRadius'),
    fuseTime: document.getElementById('fuseTime'),
    // Animation frames
    walkFrames: document.getElementById('walkFrames'),
    digFrames: document.getElementById('digFrames'),
    drownFrames: document.getElementById('drownFrames'),
    climberFrames: document.getElementById('climberFrames'),
    basherFrames: document.getElementById('basherFrames'),
    minerFrames: document.getElementById('minerFrames'),
    fallFrames: document.getElementById('fallFrames'),
    blockerFrames: document.getElementById('blockerFrames'),
    builderFrames: document.getElementById('builderFrames'),
    splatFrames: document.getElementById('splatFrames'),
    exitFrames: document.getElementById('exitFrames'),
    floaterStartFrames: document.getElementById('floaterStartFrames'),
    floaterLoopFrames: document.getElementById('floaterLoopFrames'),
    bomberFrames: document.getElementById('bomberFrames'),
    burningFrames: document.getElementById('burningFrames')
};

// Value displays
const displays = {
    walkSpeed: document.getElementById('walkSpeedValue'),
    climbSpeed: document.getElementById('climbSpeedValue'),
    maxStepUp: document.getElementById('maxStepUpValue'),
    maxStepDown: document.getElementById('maxStepDownValue'),
    gravity: document.getElementById('gravityValue'),
    terminalVelocity: document.getElementById('terminalVelocityValue'),
    safeFall: document.getElementById('safeFallValue'),
    brickWidth: document.getElementById('brickWidthValue'),
    brickHeight: document.getElementById('brickHeightValue'),
    stepRise: document.getElementById('stepRiseValue'),
    maxBricks: document.getElementById('maxBricksValue'),
    digWidth: document.getElementById('digWidthValue'),
    digDepth: document.getElementById('digDepthValue'),
    bashWidth: document.getElementById('bashWidthValue'),
    bashHeight: document.getElementById('bashHeightValue'),
    mineAngle: document.getElementById('mineAngleValue'),
    explosionRadius: document.getElementById('explosionRadiusValue'),
    fuseTime: document.getElementById('fuseTimeValue'),
    // Animation frames
    walkFrames: document.getElementById('walkFramesValue'),
    digFrames: document.getElementById('digFramesValue'),
    drownFrames: document.getElementById('drownFramesValue'),
    climberFrames: document.getElementById('climberFramesValue'),
    basherFrames: document.getElementById('basherFramesValue'),
    minerFrames: document.getElementById('minerFramesValue'),
    fallFrames: document.getElementById('fallFramesValue'),
    blockerFrames: document.getElementById('blockerFramesValue'),
    builderFrames: document.getElementById('builderFramesValue'),
    splatFrames: document.getElementById('splatFramesValue'),
    exitFrames: document.getElementById('exitFramesValue'),
    floaterStartFrames: document.getElementById('floaterStartFramesValue'),
    floaterLoopFrames: document.getElementById('floaterLoopFramesValue'),
    bomberFrames: document.getElementById('bomberFramesValue'),
    burningFrames: document.getElementById('burningFramesValue')
};

// Setup event listeners for all sliders
for (const [key, slider] of Object.entries(sliders)) {
    slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        displays[key].textContent = value;
        
        // Check if this is an animation frame slider
        if (key.includes('Frames')) {
            sendAnimationUpdate();
        } else {
            sendPhysicsUpdate();
        }
    });
}

function sendPhysicsUpdate() {
    const values = {};
    for (const [key, slider] of Object.entries(sliders)) {
        if (!key.includes('Frames')) {
            values[key] = parseFloat(slider.value);
        }
    }
    
    ipcRenderer.send('physics-update', values);
}

function sendAnimationUpdate() {
    const values = {
        walkFrames: parseInt(sliders.walkFrames.value),
        digFrames: parseInt(sliders.digFrames.value),
        drownFrames: parseInt(sliders.drownFrames.value),
        climberFrames: parseInt(sliders.climberFrames.value),
        basherFrames: parseInt(sliders.basherFrames.value),
        minerFrames: parseInt(sliders.minerFrames.value),
        fallFrames: parseInt(sliders.fallFrames.value),
        blockerFrames: parseInt(sliders.blockerFrames.value),
        builderFrames: parseInt(sliders.builderFrames.value),
        splatFrames: parseInt(sliders.splatFrames.value),
        exitFrames: parseInt(sliders.exitFrames.value),
        floaterStartFrames: parseInt(sliders.floaterStartFrames.value),
        floaterLoopFrames: parseInt(sliders.floaterLoopFrames.value),
        bomberFrames: parseInt(sliders.bomberFrames.value),
        burningFrames: parseInt(sliders.burningFrames.value)
    };
    
    ipcRenderer.send('animation-update', values);
}

function loadPreset(presetName) {
    const presets = {
        original: {
            walkSpeed: 1.0,
            climbSpeed: 0.5,
            maxStepUp: 4,
            maxStepDown: 6,
            gravity: 0.3,
            terminalVelocity: 4.0,
            safeFall: 48,
            brickWidth: 6,
            brickHeight: 2,
            stepRise: 2,
            maxBricks: 12,
            digWidth: 6,
            digDepth: 1,
            bashWidth: 8,
            bashHeight: 10,
            mineAngle: 45,
            explosionRadius: 16,
            fuseTime: 80
        },
        easy: {
            walkSpeed: 0.8,
            climbSpeed: 0.6,
            maxStepUp: 8,
            maxStepDown: 8,
            gravity: 0.25,
            terminalVelocity: 3.5,
            safeFall: 64,
            brickWidth: 8,
            brickHeight: 2,
            stepRise: 2,
            maxBricks: 15,
            digWidth: 8,
            digDepth: 1,
            bashWidth: 10,
            bashHeight: 12,
            mineAngle: 45,
            explosionRadius: 18,
            fuseTime: 100
        },
        hard: {
            walkSpeed: 1.3,
            climbSpeed: 0.4,
            maxStepUp: 2,
            maxStepDown: 4,
            gravity: 0.35,
            terminalVelocity: 5.0,
            safeFall: 32,
            brickWidth: 5,
            brickHeight: 2,
            stepRise: 2,
            maxBricks: 10,
            digWidth: 5,
            digDepth: 1,
            bashWidth: 6,
            bashHeight: 8,
            mineAngle: 45,
            explosionRadius: 14,
            fuseTime: 60
        }
    };
    
    const preset = presets[presetName];
    if (!preset) return;
    
    for (const [key, value] of Object.entries(preset)) {
        if (sliders[key]) {
            sliders[key].value = value;
            displays[key].textContent = value;
        }
    }
    
    sendPhysicsUpdate();
}

function resetDefaults() {
    loadPreset('original');
}

function exportConfig() {
    const config = {};
    for (const [key, slider] of Object.entries(sliders)) {
        config[key] = parseFloat(slider.value);
    }
    
    const json = JSON.stringify(config, null, 2);
    
    // Copy to clipboard
    navigator.clipboard.writeText(json).then(() => {
        alert('Configuration copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard. Check console for JSON.');
        console.log(json);
    });
}

// Initial physics update
sendPhysicsUpdate();