// Tile Animation Manager
// Handles looping tile animations (torches, water, fire, etc.)
// All animations run at the game's base speed of 25fps

class TileAnimationManager {
    constructor() {
        // Animation images
        this.orangeTorchLeft = null;
        this.orangeTorchRight = null;
        this.greenTorchLeft = null;
        this.greenTorchRight = null;
        this.segaWaterTop = null;
        this.segaWaterBottom = null;
        this.crystalWaterTop = null;
        this.crystalWaterBottom = null;
        this.waterTop = null;
        this.waterBottom = null;
        this.acidTop = null;
        this.acidBottom = null;
        this.fireTop = null;
        this.fireBottom = null;
        
        this.currentFrame = 0;
        this.frameCounter = 0;
        
        // Define which tile IDs get replaced per tileset (decimal)
        this.animatedTiles = {
            'Grass': { 
                orangeTorchLeft: [74], 
                orangeTorchRight: [77],
                waterTop: [109],
                waterBottom: [116]
            },
            'Sand 1': { 
                orangeTorchLeft: [91], 
                orangeTorchRight: [94],
                waterTop: [163],
                waterBottom: [164]
            },
            'Ice': { 
                greenTorchLeft: [94], 
                greenTorchRight: [97],
                crystalWaterTop: [126],
                crystalWaterBottom: [128]
            },
            'Brick': { 
                orangeTorchLeft: [47], 
                orangeTorchRight: [50],
                acidTop: [102],
                acidBottom: [103]
            },
            'Sega': { 
                orangeTorchLeft: [102], 
                orangeTorchRight: [105],
                segaWaterTop: [148],
                segaWaterBottom: [152]
            },
            'Sand 2': { 
                orangeTorchLeft: [129], 
                orangeTorchRight: [132],
                waterTop: [145],
                waterBottom: [148]
            },
            'Fire': {
                fireTop: [112],
                fireBottom: [113]
            },
            'Fire2': {
                fireTop: [112],
                fireBottom: [113]
            }
        };
    }
    
    async load() {
        // Load all tile animations (horizontal strips)
        const greenTorchLeftData = await Utils.loadIndexedImage('assets/greenTorch_Left.png');
        const greenTorchRightData = await Utils.loadIndexedImage('assets/greenTorch_Right.png');
        const orangeTorchLeftData = await Utils.loadIndexedImage('assets/Torch_Left.png');
        const orangeTorchRightData = await Utils.loadIndexedImage('assets/Torch_Right.png');
        const waterTopData = await Utils.loadIndexedImage('assets/Water_Top.png');
        const waterBottomData = await Utils.loadIndexedImage('assets/Water_Bottom.png');
        const segaWaterTopData = await Utils.loadIndexedImage('assets/Sega_Water_Top.png');
        const segaWaterBottomData = await Utils.loadIndexedImage('assets/Sega_Water_Bottom.png');
        const crystalWaterTopData = await Utils.loadIndexedImage('assets/Crystal_Water_Top.png');
        const crystalWaterBottomData = await Utils.loadIndexedImage('assets/Crystal_Water_Bottom.png');
        const acidTopData = await Utils.loadIndexedImage('assets/Acid_Top.png');
        const acidBottomData = await Utils.loadIndexedImage('assets/Acid_Bottom.png');
        const fireTopData = await Utils.loadIndexedImage('assets/Fire_Top.png');
        const fireBottomData = await Utils.loadIndexedImage('assets/Fire_Bottom.png');
        
        this.orangeTorchLeft = orangeTorchLeftData.image;
        this.orangeTorchRight = orangeTorchRightData.image;
        this.greenTorchLeft = greenTorchLeftData.image;
        this.greenTorchRight = greenTorchRightData.image;
        this.waterTop = waterTopData.image;
        this.waterBottom = waterBottomData.image;
        this.segaWaterTop = segaWaterTopData.image;
        this.segaWaterBottom = segaWaterBottomData.image;
        this.crystalWaterTop = crystalWaterTopData.image;
        this.crystalWaterBottom = crystalWaterBottomData.image;
        this.acidTop = acidTopData.image;
        this.acidBottom = acidBottomData.image;
        this.fireTop = fireTopData.image;
        this.fireBottom = fireBottomData.image;
        
        console.log('Tile animations loaded');
    }
    
    update() {
        // Update every 8 frames at 60fps = 7.5fps animation
        this.frameCounter++;
        if (this.frameCounter >= 8) {
            this.frameCounter = 0;
            this.currentFrame = (this.currentFrame + 1) % 3;
        }
    }
    
    shouldAnimate(tilesetName, tileId) {
        const tileset = this.animatedTiles[tilesetName];
        if (!tileset) return false;
        
        // Check all animation types
        if (tileset.orangeTorchLeft && tileset.orangeTorchLeft.includes(tileId)) return true;
        if (tileset.orangeTorchRight && tileset.orangeTorchRight.includes(tileId)) return true;
        if (tileset.greenTorchLeft && tileset.greenTorchLeft.includes(tileId)) return true;
        if (tileset.greenTorchRight && tileset.greenTorchRight.includes(tileId)) return true;
        if (tileset.waterTop && tileset.waterTop.includes(tileId)) return true;
        if (tileset.waterBottom && tileset.waterBottom.includes(tileId)) return true;
        if (tileset.segaWaterTop && tileset.segaWaterTop.includes(tileId)) return true;
        if (tileset.segaWaterBottom && tileset.segaWaterBottom.includes(tileId)) return true;
        if (tileset.crystalWaterTop && tileset.crystalWaterTop.includes(tileId)) return true;
        if (tileset.crystalWaterBottom && tileset.crystalWaterBottom.includes(tileId)) return true;
        if (tileset.acidTop && tileset.acidTop.includes(tileId)) return true;
        if (tileset.acidBottom && tileset.acidBottom.includes(tileId)) return true;
        if (tileset.fireTop && tileset.fireTop.includes(tileId)) return true;
        if (tileset.fireBottom && tileset.fireBottom.includes(tileId)) return true;
        
        return false;
    }
    
    getAnimationImage(tilesetName, tileId) {
        const tileset = this.animatedTiles[tilesetName];
        if (!tileset) return null;
        
        if (tileset.orangeTorchLeft && tileset.orangeTorchLeft.includes(tileId)) return this.orangeTorchLeft;
        if (tileset.orangeTorchRight && tileset.orangeTorchRight.includes(tileId)) return this.orangeTorchRight;
        if (tileset.greenTorchLeft && tileset.greenTorchLeft.includes(tileId)) return this.greenTorchLeft;
        if (tileset.greenTorchRight && tileset.greenTorchRight.includes(tileId)) return this.greenTorchRight;
        if (tileset.waterTop && tileset.waterTop.includes(tileId)) return this.waterTop;
        if (tileset.waterBottom && tileset.waterBottom.includes(tileId)) return this.waterBottom;
        if (tileset.acidTop && tileset.acidTop.includes(tileId)) return this.acidTop;
        if (tileset.acidBottom && tileset.acidBottom.includes(tileId)) return this.acidBottom;
        if (tileset.fireTop && tileset.fireTop.includes(tileId)) return this.fireTop;
        if (tileset.fireBottom && tileset.fireBottom.includes(tileId)) return this.fireBottom;
		if (tileset.segaWaterTop && tileset.segaWaterTop.includes(tileId)) return this.segaWaterTop;
		if (tileset.segaWaterBottom && tileset.segaWaterBottom.includes(tileId)) return this.segaWaterBottom;
		if (tileset.crystalWaterTop && tileset.crystalWaterTop.includes(tileId)) return this.crystalWaterTop;
		if (tileset.crystalWaterBottom && tileset.crystalWaterBottom.includes(tileId)) return this.crystalWaterBottom;
        
        return null;
    }
    
    getFrameCount(tilesetName, tileId) {
        // Fire_Bottom has 2 frames, everything else has 3
        const tileset = this.animatedTiles[tilesetName];
        if (tileset && tileset.fireBottom && tileset.fireBottom.includes(tileId)) {
            return 2;
        }
        return 3;
    }
    
    drawTile(ctx, tilesetName, tileId, x, y) {
        const image = this.getAnimationImage(tilesetName, tileId);
        if (!image) return false;
        
        // Each frame is 8x8, HORIZONTAL strip
        // Fire_Bottom has 2 frames, everything else has 3
        const frameCount = this.getFrameCount(tilesetName, tileId);
        const frame = this.currentFrame % frameCount;
        const srcX = frame * 8;
        const srcY = 0;
        
        ctx.drawImage(image, srcX, srcY, 8, 8, x, y, 8, 8);
        return true;
    }
}
