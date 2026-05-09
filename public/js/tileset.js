// Tileset manager - handles loading and collision detection

class TilesetManager {
    constructor() {
        this.tilesets = {};
        this.behaviors = null;
        this.tileSize = 8; // SMS tiles are 8x8
    }
    
    async initialize() {
        // Load tile behaviors
        const behaviorsText = await Utils.loadTextFile('assets/TileBehaviours.txt');
        this.behaviors = Utils.parseTileBehaviors(behaviorsText);
        
        // Load all tilesets
        const tilesetNames = ['Grass', 'Sand 1', 'Sand 2', 'Fire', 'Ice', 'Brick', 'Sega', 'Fire2'];
        
        for (const name of tilesetNames) {
            await this.loadTileset(name);
        }
        
        console.log('Tilesets loaded:', Object.keys(this.tilesets));
    }
    
    async loadTileset(name) {
        const filename = `assets/${name}.png`;
        const imageData = await Utils.loadIndexedImage(filename);
        
        // Calculate number of tiles (tilesets are arranged in a grid)
        const tilesX = Math.floor(imageData.width / this.tileSize);
        const tilesY = Math.floor(imageData.height / this.tileSize);
        
        // Extract individual tiles
        const tiles = [];
        for (let ty = 0; ty < tilesY; ty++) {
            for (let tx = 0; tx < tilesX; tx++) {
                const tileIndex = ty * tilesX + tx;
                tiles[tileIndex] = this.extractTile(imageData, tx, ty);
            }
        }
        
        // Get behavior info for this tileset
        const behaviorKey = name.toUpperCase().replace(/\s/g, '');
        const tileBehaviors = this.behaviors[behaviorKey] || {
            nonCollidable: [],
            steel: [],
            water: [],
            toxic: [],
            oneWayRight: [],
            oneWayLeft: []
        };
        
        this.tilesets[name] = {
            image: imageData.image,
            imageData: imageData,
            tiles: tiles,
            tilesX: tilesX,
            tilesY: tilesY,
            behaviors: tileBehaviors
        };
    }
    
    extractTile(imageData, tileX, tileY) {
        const tile = {
            x: tileX * this.tileSize,
            y: tileY * this.tileSize,
            pixels: []
        };
        
        // Extract pixel data for collision detection
        for (let y = 0; y < this.tileSize; y++) {
            tile.pixels[y] = [];
            for (let x = 0; x < this.tileSize; x++) {
                const px = tile.x + x;
                const py = tile.y + y;
                const pixel = Utils.getPixel(imageData.imageData, px, py, imageData.width);
                tile.pixels[y][x] = pixel;
            }
        }
        
        return tile;
    }
    
    getBehaviorKey(tilesetName, tilesetIndex = null) {
        // The PNG is shared by Sega 1 and Sega 2, but the behaviour lists are not.
        if (tilesetName === 'Sega') {
            return tilesetIndex === 7 ? 'SEGA2' : 'SEGA1';
        }

        // Fire2 is a second Fire tileset PNG, but it reuses the SMS Fire
        // collision / hazard behaviour lists.
        if (tilesetName === 'Fire2') {
            return 'FIRE';
        }

        return tilesetName.toUpperCase().replace(/\s/g, '');
    }

    getTileBehavior(tilesetName, tileIndex, tilesetIndex = null) {
        const tileset = this.tilesets[tilesetName];
        if (!tileset) return 'solid';

        const behaviorKey = this.getBehaviorKey(tilesetName, tilesetIndex);
        const behaviors = this.behaviors[behaviorKey] || tileset.behaviors;

        // Hazards must win over non-collidable, because several toxic/water tiles
        // also appear in the non-collidable list. They don't block movement, but
        // they still kill the lemming.
        if (behaviors.water.includes(tileIndex)) return 'water';
        if (behaviors.toxic.includes(tileIndex)) return 'toxic';
        if (behaviors.nonCollidable.includes(tileIndex)) return 'empty';
        if (behaviors.steel.includes(tileIndex)) return 'steel';
        if (behaviors.oneWayRight.includes(tileIndex)) return 'oneWayRight';
        if (behaviors.oneWayLeft.includes(tileIndex)) return 'oneWayLeft';

        return 'solid'; // Default to solid/collidable
    }

    isTileHazard(tilesetName, tileIndex, tilesetIndex = null) {
        const behavior = this.getTileBehavior(tilesetName, tileIndex, tilesetIndex);
        return behavior === 'water' || behavior === 'toxic';
    }

    // Check if a pixel is solid (for collision)
    isPixelSolid(tilesetName, tileIndex, pixelX, pixelY, tilesetIndex = null) {
        const behavior = this.getTileBehavior(tilesetName, tileIndex, tilesetIndex);

        // Empty/non-collidable and hazard tiles are never solid.
        // Hazards are handled separately by level.checkHazard().
        if (behavior === 'empty' || behavior === 'water' || behavior === 'toxic') return false;

        // Get the actual pixel from the tile
        const tileset = this.tilesets[tilesetName];
        if (!tileset || !tileset.tiles[tileIndex]) return false;

        const tile = tileset.tiles[tileIndex];
        if (pixelY < 0 || pixelY >= tile.pixels.length) return false;
        if (pixelX < 0 || pixelX >= tile.pixels[0].length) return false;

        const pixel = tile.pixels[pixelY][pixelX];

        // FIX: HTML5 Canvas strips palette indices and converts to RGBA.
        // If the empty air in the tileset is pure black instead of transparent, 
        // we must explicitly ignore it.

        // 1. If it's fully transparent, it's air
        if (pixel.a === 0) return false; 

        // 2. If it's pure black (Index 0 fallback), it's air
        if (pixel.r === 0 && pixel.g === 0 && pixel.b === 0) return false;

        // If it has any color, it's solid terrain!
        return true;
    }

    // Check collision at a world pixel position
    checkPixelCollision(x, y) {
        // Convert world coordinates to tile coordinates
        const tileX = Math.floor(x / this.tileSize);
        const tileY = Math.floor(y / this.tileSize);
        
        // Get pixel position within the tile
        const pixelX = Math.floor(x % this.tileSize);
        const pixelY = Math.floor(y % this.tileSize);
        
        // Get the tile index at this position (need to be passed the tilemap)
        // This method needs the current level's tilemap - we'll need to refactor
        // For now, return a helper method
        return { tileX, tileY, pixelX, pixelY };
    }
    
    drawTile(ctx, tilesetName, tileIndex, x, y, scale = 1) {
        const tileset = this.tilesets[tilesetName];
        if (!tileset) return;
        
        const tilesX = tileset.tilesX;
        const tileX = (tileIndex % tilesX) * this.tileSize;
        const tileY = Math.floor(tileIndex / tilesX) * this.tileSize;
        
        ctx.drawImage(
            tileset.image,
            tileX, tileY,
            this.tileSize, this.tileSize,
            x, y,
            this.tileSize * scale, this.tileSize * scale
        );
    }
}
