// Hatch animation manager
// The hatch is 5 tiles wide × 3 tiles tall, with 5 animation frames
// Each frame displays for 4 game frames (at 25fps)

class HatchAnimation {
    constructor() {
        this.image = null;
        this.currentFrame = 0;
        this.frameCounter = 0;
        this.framesPerAnimFrame = 4; // Each animation frame shows for 4 game frames
        this.totalFrames = 6;  // 6 frames total (0-5)
        this.isPlaying = false;
        this.hasFinished = false;
        
        // Dimensions
        this.frameWidth = 40;  // 5 tiles × 8 pixels
        this.frameHeight = 24; // 3 tiles × 8 pixels
        
        // Position (top-left anchor point)
        this.x = 0;
        this.y = 0;
    }
    
    async load(path) {
        const imageData = await Utils.loadIndexedImage(path);
        this.image = imageData.image;
        console.log('Hatch animation loaded:', path);
    }
    
    setPosition(x, y) {
        // Position is top-left of the 5×3 tile area
        this.x = x;
        this.y = y;
    }
    
    reset() {
        this.currentFrame = 0;
        this.frameCounter = 0;
        this.isPlaying = false;
        this.hasFinished = false;
    }
    
    start() {
        if (!this.isPlaying && !this.hasFinished) {
            this.isPlaying = true;
            this.currentFrame = 0;
            this.frameCounter = 0;
            console.log('Hatch animation started');
        }
    }
    
    update() {
        if (!this.isPlaying || this.hasFinished) return;
        
        this.frameCounter++;
        
        if (this.frameCounter >= this.framesPerAnimFrame) {
            this.frameCounter = 0;
            this.currentFrame++;
            
            // Check if animation finished
            if (this.currentFrame >= this.totalFrames) {
                this.currentFrame = this.totalFrames - 1; // Stay on last frame
                this.isPlaying = false;
                this.hasFinished = true;
                console.log('Hatch animation finished');
            }
        }
    }
    
    draw(ctx, cameraX, cameraY) {
        if (!this.image) return;
        
        // Calculate source position in sprite sheet (vertical strip)
        const srcX = 0;
        const srcY = this.currentFrame * this.frameHeight;
        
        // Calculate screen position
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Draw current frame
        ctx.drawImage(
            this.image,
            srcX, srcY,
            this.frameWidth, this.frameHeight,
            screenX, screenY,
            this.frameWidth, this.frameHeight
        );
    }
}
