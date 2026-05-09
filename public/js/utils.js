// Utility functions for the game

const Utils = {
    // Load an image and preserve indexed color data
    loadIndexedImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Create a canvas to extract pixel data
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0);
                
                // Get the image data
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                
                resolve({
                    image: img,
                    width: img.width,
                    height: img.height,
                    imageData: imageData,
                    data: imageData.data
                });
            };
            img.onerror = () => reject(new Error(`Could not load image: ${src}`));
            img.src = src;
        });
    },
    
    // Get pixel color at position (returns RGBA object)
    getPixel(imageData, x, y, width) {
        if (x < 0 || y < 0 || x >= width || y >= imageData.height) {
            return { r: 0, g: 0, b: 0, a: 0 };
        }
        
        const index = (y * width + x) * 4;
        return {
            r: imageData.data[index],
            g: imageData.data[index + 1],
            b: imageData.data[index + 2],
            a: imageData.data[index + 3]
        };
    },
    
    // Check if pixel is transparent
    isTransparent(pixel) {
        return pixel.a === 0;
    },
    
    // Check if pixel is "collidable black" vs "non-collidable black"
    // For tileset collision: pure black (0,0,0) with alpha is collidable
    // For sprite rendering: black in RGB PNGs is non-solid (transparent background)
    isCollidable(pixel, isSprite = false) {
        if (isSprite) {
            // In sprites, black is used as transparent background
            return false;
        }
        // In tilesets, black with alpha is solid
        return pixel.a > 0 && pixel.r === 0 && pixel.g === 0 && pixel.b === 0;
    },
    
    // Load a text file
    loadTextFile(path) {
        return fetch(path).then(response => response.text());
    },
    
    // Load a binary file as ArrayBuffer
    loadBinaryFile(path) {
        return fetch(path).then(response => response.arrayBuffer());
    },
    
    // Parse tile behaviors from the .txt file format
    parseTileBehaviors(text) {
        const behaviors = {};
        const lines = text.split('\n');
        let currentTileset = null;
        let currentList = null;
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Comment or empty line
            if (trimmed.startsWith(';') || trimmed === '') {
                // Check if it's a tileset header comment
                const match = trimmed.match(/; ([A-Z0-9]+)/);
                if (match) {
                    currentTileset = match[1];
                    if (!behaviors[currentTileset]) {
                        behaviors[currentTileset] = {
                            nonCollidable: [],
                            steel: [],
                            water: [],
                            toxic: [],
                            oneWayRight: [],
                            oneWayLeft: []
                        };
                    }
                }
                continue;
            }
            
            // List declaration line
            if (trimmed.includes('Data_List')) {
                const listMatch = trimmed.match(/List(\d+)/);
                if (listMatch) {
                    const listNum = parseInt(listMatch[1]);
                    const listTypes = ['nonCollidable', 'steel', 'water', 'toxic', 'oneWayRight', 'oneWayLeft'];
                    currentList = listTypes[listNum];
                }
                continue;
            }
            
            // Data line
            if (trimmed.startsWith('.db') && currentTileset && currentList) {
                // Parse hex values
                const hexValues = trimmed.match(/\$[0-9A-F]+/gi);
                if (hexValues) {
                    for (const hex of hexValues) {
                        const value = parseInt(hex.substring(1), 16);
                        if (value !== 0 && currentList) { // Skip $00 terminator
                            behaviors[currentTileset][currentList].push(value);
                        }
                    }
                }
            }
        }
        
        return behaviors;
    },
    
    // Format time for display
    formatTime(frames, fps = 60) {
        const totalSeconds = Math.floor(frames / fps);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    },
    
    // Clamp a value between min and max
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
};
