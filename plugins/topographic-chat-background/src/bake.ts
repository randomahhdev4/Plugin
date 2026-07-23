import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { DEFAULT_SETTINGS } from "./settings-model";
import { computeGrid, buildContourSegments } from "./contours";
import { createFrameBuffer, drawSegments, hexToRgb } from "./rasterizer";
import { quantize, encodeGif } from "./gif-encoder";

const FRAME_COUNT = 10;
const LOOP_SECONDS = 6;
// Sampling `t` around a closed loop (rather than a straight line) means the
// last frame flows back into the first with no visible jump when the GIF
// repeats - same trick used for the earlier precomputed-frames approach,
// just baking an actual file this time instead of shipping static data.
const LOOP_RADIUS = 3.2;

function base64Encode(bytes: Uint8Array): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
        result += chars[b0 >> 2];
        result += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
        result += b1 === undefined ? "=" : chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
        result += b2 === undefined ? "=" : chars[b2 & 63];
    }
    return result;
}

function yieldToJsThread(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export type BakeProgress = (message: string) => void;

/**
 * Renders the current settings to an actual animated GIF file on-device and
 * returns its local path. Unlike the live SVG background, playback of the
 * result costs nothing on the JS thread - it's decoded and looped natively
 * by the platform's own GIF support, the same as any other image.
 */
export async function bakeGif(width: number, height: number, onProgress?: BakeProgress): Promise<string> {
    const gridStep = storage.gridStep ?? DEFAULT_SETTINGS.gridStep;
    const levels = storage.levels ?? DEFAULT_SETTINGS.levels;
    const levelRange = storage.levelRange ?? DEFAULT_SETTINGS.levelRange;
    const majorEvery = storage.majorEvery ?? DEFAULT_SETTINGS.majorEvery;
    const glow = storage.glow ?? DEFAULT_SETTINGS.glow;
    const colorMain = hexToRgb(storage.colorMain ?? DEFAULT_SETTINGS.colorMain);
    const colorSub = hexToRgb(storage.colorSub ?? DEFAULT_SETTINGS.colorSub);
    const colorBg = hexToRgb(storage.colorBg ?? DEFAULT_SETTINGS.colorBg);
    const noise = storage.noise ?? DEFAULT_SETTINGS.noise;

    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));

    const frames: Uint8Array[] = [];

    for (let f = 0; f < FRAME_COUNT; f++) {
        onProgress?.(`Rendering frame ${f + 1}/${FRAME_COUNT}...`);
        await yieldToJsThread();

        const angle = (f / FRAME_COUNT) * Math.PI * 2;
        const t = Math.cos(angle) * LOOP_RADIUS;

        const { grid, cols, rows } = computeGrid(w, h, gridStep, t, noise);
        const buf = createFrameBuffer(w, h, colorBg);

        for (let l = 0; l < levels; l++) {
            const level = -levelRange + (l / (levels - 1)) * (levelRange * 2);
            const segs = buildContourSegments(grid, cols, rows, gridStep, level);
            const isMajor = l % majorEvery === 0;
            if (isMajor) {
                if (glow) drawSegments(buf, w, h, segs, colorMain, 0.25, 4);
                drawSegments(buf, w, h, segs, colorMain, 1, 1.6);
            } else {
                drawSegments(buf, w, h, segs, colorSub, 0.32, 1);
            }
            // Yield partway through a frame too, not just between frames -
            // a single frame at full screen resolution can itself be a
            // meaningful chunk of work at higher detail settings.
            if (l % 2 === 1) await yieldToJsThread();
        }

        frames.push(buf);
    }

    onProgress?.("Building color palette...");
    await yieldToJsThread();
    const { palette, indices } = quantize(frames);

    onProgress?.("Encoding GIF...");
    await yieldToJsThread();
    const delayCentiseconds = Math.max(2, Math.round((LOOP_SECONDS * 100) / FRAME_COUNT));
    const gifFrames = indices.map((idx) => ({ indices: idx, delayCentiseconds }));
    const gifBytes = encodeGif(w, h, palette, gifFrames);

    onProgress?.("Saving to device...");
    await yieldToJsThread();
    const fs = findByProps("writeFile") as any;
    const constants = fs.getConstants();
    const cacheDir = constants.CacheDirPath || constants.CachesDirectoryPath || constants.DocumentsDirPath;
    if (!cacheDir) throw new Error("No writable directory path found on the filesystem module");

    const oldPath = storage.cachedGifPath as string | undefined;
    const path = `${cacheDir}/topo-background-${Date.now()}.gif`;
    const base64 = base64Encode(gifBytes);
    // TurboModule method rejects fewer than its declared arity (confirmed:
    // "expected argument count: 4"), and the 4th argument specifically has
    // to be a string (confirmed: "Expected argument 3 ... to be a string,
    // but got an object" when {} was tried). This looks like Discord's own
    // media-file utility rather than a generic fs module, so a MIME type
    // string is the most plausible shape for a 4th param here.
    await fs.writeFile(path, base64, "base64", "image/gif");

    if (oldPath && oldPath !== path) {
        try {
            await fs.removeFile(oldPath);
        } catch {
            // Best-effort cleanup of the previous bake; a leftover file
            // isn't worth failing the whole operation over.
        }
    }

    return path;
}
