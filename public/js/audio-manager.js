// AudioManager: authentic SMS .vgz/.vgm music playback plus non-overlapping WAV SFX.
//
// The music files in assets/music are VGM logs, not normal browser audio files.
// This file includes a small SN76489/SMS PSG renderer so the existing game code
// can ask for high-level cues without knowing anything about VGM parsing.

class AudioManager {
    constructor(options = {}) {
        this.musicBasePath = options.musicBasePath || 'assets/music/';
        this.sfxBasePath = options.sfxBasePath || 'assets/music/';

        // SMS Lemmings is being matched to PAL timing. Some VGM dumps use the
        // NTSC 0x62 frame-wait command, so the renderer normalises frame waits
        // to 50Hz instead of letting those tracks run fast.
        this.vgmFrameRate = options.vgmFrameRate || 50;

        this.context = null;
        this.masterGain = null;
        this.musicGain = null;
        this.sfxGain = null;

        this.musicBuffers = new Map();
        this.sfxBuffers = new Map();

        this.currentMusicSource = null;
        this.currentMusicTag = null;
        this.currentMusicPlaybackId = 0;
        this.musicPlaying = false;
        this.currentMusicOverlaySources = new Set();

        this.currentSfxSource = null;
        this.currentSfxName = null;

        this.isMuted = false;
        this.isHalfVolume = false;
        this.normalMasterVolume = 0.5;
        this.halfMasterVolume = 0.25;

        this.titleRepeatTimer = null;
        this.titleRepeatToken = null;
        this.unlockListenersInstalled = false;
        this.initialized = false;
    }

    async initialize() {
        this.ensureContext();
        this.installUnlockListeners();

        // Preload the two short WAV effects. Missing audio should not stop the game.
        await Promise.all([
            this.loadSfxBuffer('chime', 'sfx_chime.wav'),
            this.loadSfxBuffer('goal', 'sfx_goal.wav'),
            this.loadSfxBuffer('splat', 'sfx_splat.wav'),
            this.loadSfxBuffer('bang', 'sfx_bang.wav'),
            this.loadSfxBuffer('splash', 'sfx_splash.wav')
        ]);

        this.initialized = true;
    }

    ensureContext() {
        if (this.context) return this.context;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            console.warn('WebAudio is not available; music/SFX disabled.');
            return null;
        }

        this.context = new AudioContextClass();
        this.masterGain = this.context.createGain();
        this.musicGain = this.context.createGain();
        this.sfxGain = this.context.createGain();

        this.masterGain.gain.value = this.getMasterVolume();
        this.musicGain.gain.value = 0.75;
        this.sfxGain.gain.value = 0.9;

        this.musicGain.connect(this.masterGain);
        this.sfxGain.connect(this.masterGain);
        this.masterGain.connect(this.context.destination);

        return this.context;
    }

    installUnlockListeners() {
        if (this.unlockListenersInstalled) return;
        this.unlockListenersInstalled = true;

        const unlock = () => this.unlock();
        window.addEventListener('keydown', unlock, { passive: true });
        window.addEventListener('mousedown', unlock, { passive: true });
        window.addEventListener('touchstart', unlock, { passive: true });
        window.addEventListener('pointerdown', unlock, { passive: true });
    }

    async unlock() {
        const context = this.ensureContext();
        if (!context || context.state !== 'suspended') return;

        try {
            await context.resume();
        } catch (error) {
            console.warn('AudioContext resume failed:', error);
        }
    }

    getLevelTrackFilename(levelNumber, musicOverride = null) {
		const rawTrackNumber = musicOverride ?? levelNumber;
		const trackNumber = ((Math.max(1, Number(rawTrackNumber) || 1) - 1) % 17) + 1;
		return `track_${String(trackNumber).padStart(2, '0')}.vgz`;
	}

	playLevelMusic(levelNumber, musicOverride = null) {
		const filename = this.getLevelTrackFilename(levelNumber, musicOverride);
		this.playMusicFile(filename, {
			tag: 'level',
			loop: true
		});
	}

    playLetsGo() {
        return this.playMusicFile('track_letsgo.vgz', {
            tag: 'letsgo',
            loop: false
        });
    }

    playOhNo() {
        // NUKE's OH NO cue is a one-shot PSG/VGZ cue, but it should behave like
        // an overlay: the current looping level music keeps playing underneath.
        return this.playMusicOverlayFile('track_ohno.vgz', {
            tag: 'ohno'
        });
    }

    playResultMusic(success) {
        return this.playMusicFile(success ? 'track_success.vgz' : 'track_failure.vgz', {
            tag: success ? 'success' : 'failure',
            loop: false
        });
    }

    playTitleMusic() {
        this.stopMusic();
        this.clearTitleRepeatTimer();

        const token = Symbol('title-repeat');
        this.titleRepeatToken = token;

        const playOnceAndQueueRepeat = async () => {
            await this.playMusicFile('track_title.vgz', {
                tag: 'title',
                loop: false
            });

            if (this.titleRepeatToken !== token) return;
            this.titleRepeatTimer = window.setTimeout(playOnceAndQueueRepeat, 30000);
        };

        playOnceAndQueueRepeat();
    }

    clearTitleRepeatTimer() {
        this.titleRepeatToken = null;

        if (this.titleRepeatTimer !== null) {
            window.clearTimeout(this.titleRepeatTimer);
            this.titleRepeatTimer = null;
        }
    }

    async playMusicOverlayFile(filename, options = {}) {
        const context = this.ensureContext();
        if (!context) return false;

        const { tag = filename } = options;

        try {
            await this.unlock();
            const rendered = await this.loadRenderedVgm(filename);

            const source = context.createBufferSource();
            source.buffer = rendered.audioBuffer;
            source.loop = false;

            // Route PSG overlays through the music gain so mute/volume behaviour
            // matches the rest of the VGM music system, without replacing the
            // existing level track.
            source.connect(this.musicGain);
            this.currentMusicOverlaySources.add(source);

            const endedPromise = new Promise(resolve => {
                source.onended = () => {
                    this.currentMusicOverlaySources.delete(source);
                    resolve(true);
                };
            });

            source.start();
            return endedPromise;
        } catch (error) {
            console.warn(`Failed to play music overlay ${filename} (${tag}):`, error);
            return false;
        }
    }

    async playMusicFile(filename, options = {}) {
        const context = this.ensureContext();
        if (!context) return false;

        const { tag = filename, loop = false } = options;
        const playbackId = ++this.currentMusicPlaybackId;

        this.stopMusic({ preservePlaybackId: true });
        this.clearTitleRepeatTimer();
        this.currentMusicTag = tag;
        this.musicPlaying = false;

        try {
            await this.unlock();
            const rendered = await this.loadRenderedVgm(filename);

            if (this.currentMusicPlaybackId !== playbackId) return false;

            const source = context.createBufferSource();
            source.buffer = rendered.audioBuffer;
            source.loop = !!loop;

            if (loop && rendered.loopStartSeconds !== null && rendered.loopEndSeconds !== null &&
                rendered.loopEndSeconds > rendered.loopStartSeconds) {
                source.loopStart = rendered.loopStartSeconds;
                source.loopEnd = rendered.loopEndSeconds;
            }

            source.connect(this.musicGain);
            this.currentMusicSource = source;
            this.musicPlaying = true;

            const endedPromise = new Promise(resolve => {
                source.onended = () => {
                    if (this.currentMusicPlaybackId === playbackId) {
                        this.currentMusicSource = null;
                        this.musicPlaying = false;
                    }
                    resolve(true);
                };
            });

            source.start();

            if (loop) return true;
            return endedPromise;
        } catch (error) {
            console.warn(`Failed to play music ${filename}:`, error);
            if (this.currentMusicPlaybackId === playbackId) {
                this.currentMusicSource = null;
                this.currentMusicTag = null;
                this.musicPlaying = false;
            }
            return false;
        }
    }

    stopMusic(options = {}) {
        const { preservePlaybackId = false } = options;
        if (!preservePlaybackId) this.currentMusicPlaybackId++;
        this.clearTitleRepeatTimer();

        if (this.currentMusicSource) {
            try { this.currentMusicSource.stop(); }
            catch { /* source may already have ended */ }
            this.currentMusicSource = null;
        }

        if (this.currentMusicOverlaySources?.size) {
            for (const source of [...this.currentMusicOverlaySources]) {
                try { source.stop(); }
                catch { /* source may already have ended */ }
            }
            this.currentMusicOverlaySources.clear();
        }

        this.musicPlaying = false;
        this.currentMusicTag = null;
    }

    isMusicPlaying(tag = null) {
        if (!this.musicPlaying) return false;
        return tag === null || this.currentMusicTag === tag;
    }

    async loadRenderedVgm(filename) {
        const context = this.ensureContext();
        if (!context) throw new Error('AudioContext unavailable');

        const cacheKey = `${filename}@${context.sampleRate}@${this.vgmFrameRate}Hz`;
        if (this.musicBuffers.has(cacheKey)) return this.musicBuffers.get(cacheKey);

        const url = `${this.musicBasePath}${filename}`;
        const bytes = await this.fetchBinary(url);
        const vgmBytes = await this.inflateIfNeeded(bytes);
        const renderer = new VgmPsgRenderer(vgmBytes, context.sampleRate, {
            frameRate: this.vgmFrameRate
        });
        const rendered = renderer.renderToAudioBuffer(context);
        this.musicBuffers.set(cacheKey, rendered);
        return rendered;
    }

    async fetchBinary(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return new Uint8Array(await response.arrayBuffer());
    }

    async inflateIfNeeded(bytes) {
        if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;

        if (typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }

        if (typeof require === 'function') {
            const zlib = require('zlib');
            const inflated = zlib.gunzipSync(Buffer.from(bytes));
            return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
        }

        throw new Error('No gzip decompressor available for .vgz playback');
    }

    async loadSfxBuffer(name, filename) {
        const context = this.ensureContext();
        if (!context) return null;
        if (this.sfxBuffers.has(name)) return this.sfxBuffers.get(name);

        try {
            const bytes = await this.fetchBinary(`${this.sfxBasePath}${filename}`);
            const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const buffer = await context.decodeAudioData(arrayBuffer);
            this.sfxBuffers.set(name, buffer);
            return buffer;
        } catch (error) {
            console.warn(`Failed to load SFX ${filename}:`, error);
            return null;
        }
    }

    playChime() {
        return this.playSfx('chime');
    }

    playGoal() {
        return this.playSfx('goal');
    }

    playSplat() {
        return this.playSfx('splat');
    }
  
    playBang() {
        return this.playSfx('bang');
    }

    playSplash() {
        // Splash is deliberately allowed to restart on every call, matching the
        // requested drowning/acid cue behaviour rather than the normal no-overlap
        // SMS-style SFX rule used for chime/goal/splat/bang.
        return this.playSfx('splash', { restart: true });
    }

    getMasterVolume() {
        if (this.isMuted) return 0;
        return this.isHalfVolume ? this.halfMasterVolume : this.normalMasterVolume;
    }

    applyMasterVolume() {
        const context = this.ensureContext();
        if (!context || !this.masterGain) return;
        this.masterGain.gain.value = this.getMasterVolume();
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.applyMasterVolume();
        return this.isMuted;
    }

    getVolumeStage() {
        if (this.isMuted) return 'off';
        return this.isHalfVolume ? 'medium' : 'loud';
    }

    setVolumeStage(stage) {
        if (!['loud', 'medium', 'off'].includes(stage)) return false;
        this.isMuted = stage === 'off';
        this.isHalfVolume = stage === 'medium';
        this.applyMasterVolume();
        return true;
    }

    cycleVolumeStage() {
        const order = ['loud', 'medium', 'off'];
        const index = order.indexOf(this.getVolumeStage());
        const nextStage = order[(index + 1 + order.length) % order.length];
        this.setVolumeStage(nextStage);
        return nextStage;
    }

    toggleHalfVolume() {
        this.isHalfVolume = !this.isHalfVolume;
        if (this.isHalfVolume) this.isMuted = false;
        this.applyMasterVolume();
        return this.isHalfVolume;
    }

    playSfx(name, options = {}) {
        const context = this.ensureContext();
        if (!context) return false;

        const { restart = false } = options;

        // SMS-style rule for this project: no overlapping sound effects.
        // The splash cue is the one exception: it restarts immediately so repeated
        // water/acid deaths always make a fresh splash.
        if (this.currentSfxSource) {
            if (!restart) return false;

            try { this.currentSfxSource.stop(); }
            catch { /* source may already have ended */ }

            this.currentSfxSource = null;
            this.currentSfxName = null;
        }

        const buffer = this.sfxBuffers.get(name);
        if (!buffer) return false;

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.sfxGain);
        this.currentSfxSource = source;
        this.currentSfxName = name;

        source.onended = () => {
            if (this.currentSfxSource === source) {
                this.currentSfxSource = null;
                this.currentSfxName = null;
            }
        };

        this.unlock();
        source.start();
        return true;
    }
}

class VgmPsgRenderer {
    constructor(bytes, outputSampleRate, options = {}) {
        this.bytes = bytes;
        this.outputSampleRate = outputSampleRate;
        this.frameRate = options.frameRate || 50;
        this.frameWaitSamples = Math.round(44100 / this.frameRate);
        this.commandWarnings = 0;
        this.header = this.readHeader();
    }

    readHeader() {
        const bytes = this.bytes;
        if (bytes.length < 0x40 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'Vgm ') {
            throw new Error('Not a VGM file');
        }

        const version = this.u32(0x08);
        const snClock = this.u32(0x0c) || 3579545;
        const totalSamples = this.u32(0x18);
        const loopOffsetRaw = this.u32(0x1c);
        const loopSamples = this.u32(0x20);
        const dataOffsetRaw = version >= 0x00000150 ? this.u32(0x34) : 0;
        const dataOffset = dataOffsetRaw ? 0x34 + dataOffsetRaw : 0x40;
        const loopOffset = loopOffsetRaw ? 0x1c + loopOffsetRaw : null;
        const noiseFeedback = this.u16(0x28) || 0x0009;
        const noiseShiftWidth = bytes[0x2a] || 16;

        return {
            version,
            snClock,
            totalSamples,
            loopOffset,
            loopSamples,
            dataOffset,
            noiseFeedback,
            noiseShiftWidth
        };
    }

    renderToAudioBuffer(context) {
        const timing = this.measureTiming();
        const totalVgmSamples = timing.totalSamples || this.header.totalSamples || 1;
        const outputLength = Math.max(1, Math.ceil(totalVgmSamples * this.outputSampleRate / 44100) + 8);
        const output = new Float32Array(outputLength);
        const synth = new Sn76489Synth({
            sampleRate: this.outputSampleRate,
            clock: this.header.snClock,
            feedback: this.header.noiseFeedback,
            shiftWidth: this.header.noiseShiftWidth
        });

        let outputIndex = 0;
        let frameRemainder = 0;

        this.walkCommands({
            onPsgWrite: value => synth.write(value),
            onWait: waitSamples => {
                const exactFrames = waitSamples * this.outputSampleRate / 44100 + frameRemainder;
                const frames = Math.floor(exactFrames);
                frameRemainder = exactFrames - frames;

                for (let i = 0; i < frames && outputIndex < output.length; i++) {
                    output[outputIndex++] = synth.nextSample();
                }
            }
        });

        const finalOutput = outputIndex > 0 ? output.slice(0, outputIndex) : new Float32Array(1);
        const audioBuffer = context.createBuffer(1, finalOutput.length, this.outputSampleRate);
        audioBuffer.copyToChannel(finalOutput, 0);

        const loopStartSamples = timing.loopStartSamples;
        const loopStartSeconds = loopStartSamples !== null
            ? loopStartSamples / 44100
            : null;
        const loopEndSeconds = finalOutput.length / this.outputSampleRate;

        return {
            audioBuffer,
            loopStartSeconds,
            loopEndSeconds
        };
    }

    measureTiming() {
        let totalSamples = 0;
        let loopStartSamples = null;

        this.walkCommands({
            onCommandOffset: offset => {
                if (this.header.loopOffset !== null && offset === this.header.loopOffset && loopStartSamples === null) {
                    loopStartSamples = totalSamples;
                }
            },
            onWait: waitSamples => { totalSamples += waitSamples; }
        });

        if (loopStartSamples === null && this.header.loopOffset !== null) {
            const fromHeader = this.header.totalSamples - this.header.loopSamples;
            if (fromHeader >= 0 && this.header.loopSamples > 0) loopStartSamples = fromHeader;
        }

        return { totalSamples, loopStartSamples };
    }

    walkCommands(handlers = {}) {
        const bytes = this.bytes;
        let offset = this.header.dataOffset;
        let running = true;

        while (running && offset < bytes.length) {
            handlers.onCommandOffset?.(offset);
            const command = bytes[offset++];

            if (command >= 0x70 && command <= 0x7f) {
                handlers.onWait?.((command & 0x0f) + 1);
                continue;
            }

            switch (command) {
                case 0x4f: // Game Gear stereo; ignored for mono mix.
                    offset += 1;
                    break;

                case 0x50: // SN76489/SMS PSG write.
                    handlers.onPsgWrite?.(bytes[offset]);
                    offset += 1;
                    break;

                case 0x61: {
                    let waitSamples = this.u16(offset);

                    // Some PAL SMS dumps still express each video frame as the
                    // NTSC-sized 735-sample wait. Normalise exact frame waits so
                    // the music follows the project's confirmed 50Hz baseline.
                    if (this.frameRate === 50 && waitSamples === 735) {
                        waitSamples = this.frameWaitSamples;
                    }

                    handlers.onWait?.(waitSamples);
                    offset += 2;
                    break;
                }

                case 0x62:
                case 0x63:
                    handlers.onWait?.(this.frameWaitSamples);
                    break;

                case 0x66:
                    running = false;
                    break;

                case 0x67: { // data block: 0x67 0x66 type size32 data...
                    if (bytes[offset] === 0x66) offset += 1;
                    offset += 1; // type
                    const size = this.u32(offset);
                    offset += 4 + size;
                    break;
                }

                case 0xe0:
                    offset += 4;
                    break;

                default:
                    offset = this.skipKnownCommand(command, offset);
                    break;
            }
        }
    }

    skipKnownCommand(command, offset) {
        // Common two-byte register writes for other VGM chips. SMS Lemmings music
        // should be PSG-only, but skipping these keeps the parser aligned if a file
        // contains harmless metadata/chip writes the PSG renderer ignores.
        if ((command >= 0x51 && command <= 0x5f) ||
            (command >= 0xa0 && command <= 0xbf)) {
            return offset + 2;
        }

        // DAC stream control ranges. These are not expected for SMS PSG tracks.
        if (command >= 0x90 && command <= 0x95) {
            return offset + 4;
        }

        if (this.commandWarnings < 5) {
            console.warn(`Unsupported VGM command 0x${command.toString(16).padStart(2, '0')} at 0x${(offset - 1).toString(16)}`);
            this.commandWarnings++;
        }

        // Stop rather than guessing and desynchronising the command stream.
        return this.bytes.length;
    }

    u16(offset) {
        const b = this.bytes;
        return (b[offset] || 0) | ((b[offset + 1] || 0) << 8);
    }

    u32(offset) {
        const b = this.bytes;
        return ((b[offset] || 0) |
            ((b[offset + 1] || 0) << 8) |
            ((b[offset + 2] || 0) << 16) |
            ((b[offset + 3] || 0) << 24)) >>> 0;
    }
}

class Sn76489Synth {
    constructor(options = {}) {
        this.sampleRate = options.sampleRate || 44100;
        this.clock = options.clock || 3579545;
        this.feedback = options.feedback || 0x0009;
        this.shiftWidth = options.shiftWidth || 16;

        this.toneRegisters = [0, 0, 0];
        this.volumeRegisters = [15, 15, 15, 15];
        this.tonePhases = [0, 0, 0];
        this.toneWritten = [false, false, false];
        this.noiseWritten = false;
        this.noisePhase = 0;
        this.noiseControl = 0;
        this.noiseShiftRegister = 1 << (this.shiftWidth - 1);
        this.latchedChannel = 0;
        this.latchedIsVolume = false;

        this.volumeTable = Array.from({ length: 16 }, (_, volume) => {
            if (volume >= 15) return 0;
            return Math.pow(10, (-2 * volume) / 20);
        });
    }

    write(value) {
        value &= 0xff;

        if (value & 0x80) {
            this.latchedChannel = (value >> 5) & 0x03;
            this.latchedIsVolume = !!(value & 0x10);
            const data = value & 0x0f;

            if (this.latchedIsVolume) {
                this.volumeRegisters[this.latchedChannel] = data;
            } else if (this.latchedChannel < 3) {
                this.toneRegisters[this.latchedChannel] =
                    (this.toneRegisters[this.latchedChannel] & 0x3f0) | data;
                this.toneWritten[this.latchedChannel] = true;
            } else {
                this.noiseControl = data & 0x07;
                this.noiseWritten = true;
                this.resetNoise();
            }
            return;
        }

        if (this.latchedIsVolume) {
            this.volumeRegisters[this.latchedChannel] = value & 0x0f;
            return;
        }

        if (this.latchedChannel < 3) {
            this.toneRegisters[this.latchedChannel] =
                (this.toneRegisters[this.latchedChannel] & 0x00f) | ((value & 0x3f) << 4);
            this.toneWritten[this.latchedChannel] = true;
        }
    }

    resetNoise() {
        this.noiseShiftRegister = 1 << (this.shiftWidth - 1);
        this.noisePhase = 0;
    }

    nextSample() {
        let mix = 0;

        for (let channel = 0; channel < 3; channel++) {
            const volume = this.volumeTable[this.volumeRegisters[channel]];
            if (volume <= 0) continue;

            const period = this.toneRegisters[channel];
			if (!this.toneWritten[channel]) continue;

			const safePeriod = Math.max(1, period);
			const frequency = this.clock / (32 * safePeriod);

			// Very small PSG periods can be used as a high-frequency carrier with
			// volume changes. Rendering that carrier as a raw square wave aliases into
			// a nasty buzz, but skipping it entirely silences short cues like Let's Go.
			// Keep the volume envelope and drop the carrier.
			if (safePeriod <= 1 || frequency >= this.sampleRate * 0.45) {
				mix += volume;
				continue;
			}

			this.tonePhases[channel] += frequency / this.sampleRate;
			this.tonePhases[channel] -= Math.floor(this.tonePhases[channel]);
			mix += (this.tonePhases[channel] < 0.5 ? 1 : -1) * volume;
        }

        const noiseVolume = this.volumeTable[this.volumeRegisters[3]];
        if (noiseVolume > 0 && this.noiseWritten) {
            this.advanceNoise();
            mix += ((this.noiseShiftRegister & 1) ? 1 : -1) * noiseVolume;
        }

        return Math.max(-1, Math.min(1, mix * 0.18));
    }

    advanceNoise() {
        const rate = this.noiseControl & 0x03;
        const frequency = rate === 3
            ? this.clock / (32 * Math.max(2, this.toneRegisters[2] || 2))
            : this.clock / (512 << rate);

        this.noisePhase += frequency / this.sampleRate;

        while (this.noisePhase >= 1) {
            this.noisePhase -= 1;
            const whiteNoise = !!(this.noiseControl & 0x04);
            let feedbackBit;

            if (whiteNoise) {
                feedbackBit = this.parity(this.noiseShiftRegister & this.feedback);
            } else {
                feedbackBit = this.noiseShiftRegister & 1;
            }

            this.noiseShiftRegister >>= 1;
            this.noiseShiftRegister |= feedbackBit << (this.shiftWidth - 1);
        }
    }

    parity(value) {
        value ^= value >> 8;
        value ^= value >> 4;
        value &= 0x0f;
        return (0x6996 >> value) & 1;
    }
}

window.AudioManager = AudioManager;
