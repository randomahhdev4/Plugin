// Minimal GIF89a encoder (global color table + LZW-compressed frames +
// NETSCAPE2.0 loop extension), written from the GIF89a spec directly since
// this needs to run as plain bundled JS on-device - no npm dependency, no
// Canvas/Node APIs. Takes RGB pixel buffers (from rasterizer.ts) in, hands
// back a raw byte array ready to be base64-encoded and written to a file.

export type RGB = [number, number, number];

function colorDistSq(a: RGB, b: RGB): number {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}

/**
 * Builds a shared palette (<=256 colors) across all frames and maps every
 * pixel to a palette index. Our art has a genuinely small color range
 * (background + a couple of line colors, blended by anti-aliasing/stroke
 * stamping into a modest number of intermediate shades), so this starts by
 * just collecting unique colors; only falls back to reducing per-channel
 * precision (posterizing) if that set is actually too big to fit.
 */
export function quantize(frames: Uint8Array[], maxColors = 256): { palette: RGB[]; indices: Uint8Array[] } {
    function build(shift: number): { palette: RGB[]; map: Map<number, number> } | null {
        const map = new Map<number, number>();
        const palette: RGB[] = [];
        for (const frame of frames) {
            for (let i = 0; i < frame.length; i += 3) {
                const r = (frame[i] >> shift) << shift;
                const g = (frame[i + 1] >> shift) << shift;
                const b = (frame[i + 2] >> shift) << shift;
                const key = (r << 16) | (g << 8) | b;
                if (!map.has(key)) {
                    if (palette.length >= maxColors) return null;
                    map.set(key, palette.length);
                    palette.push([r, g, b]);
                }
            }
        }
        return { palette, map };
    }

    let shift = 0;
    let built = build(shift);
    while (!built && shift < 8) {
        shift += 1;
        built = build(shift);
    }
    // Should be unreachable in practice (shift=8 collapses everything to
    // one color), but guarantees termination regardless of input.
    if (!built) built = { palette: [[0, 0, 0]], map: new Map([[0, 0]]) };

    const { palette, map } = built;
    const indices = frames.map((frame) => {
        const out = new Uint8Array(frame.length / 3);
        for (let i = 0, p = 0; i < frame.length; i += 3, p++) {
            const r = (frame[i] >> shift) << shift;
            const g = (frame[i + 1] >> shift) << shift;
            const b = (frame[i + 2] >> shift) << shift;
            const key = (r << 16) | (g << 8) | b;
            let idx = map.get(key);
            if (idx === undefined) {
                // Only reachable if quantization shift still left an edge
                // case uncaptured; fall back to nearest palette entry.
                let best = 0;
                let bestDist = Infinity;
                for (let pi = 0; pi < palette.length; pi++) {
                    const d = colorDistSq([r, g, b], palette[pi]);
                    if (d < bestDist) {
                        bestDist = d;
                        best = pi;
                    }
                }
                idx = best;
            }
            out[p] = idx;
        }
        return out;
    });

    return { palette, indices };
}

class ByteWriter {
    bytes: number[] = [];
    u8(v: number) {
        this.bytes.push(v & 0xff);
    }
    u16le(v: number) {
        this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    }
    str(s: string) {
        for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i));
    }
    bytesRaw(arr: number[] | Uint8Array) {
        for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i]);
    }
}

// Standard LZW-GIF variable-code-width compression: code size starts at
// paletteBits+1 (minimum 2), grows by one bit whenever the dictionary fills
// the current width, and resets via the clear code when it hits the 12-bit
// ceiling (4096 entries) - exactly the classic GIF89a LZW algorithm.
function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dict = new Map<string, number>();

    function resetDict() {
        dict = new Map<string, number>();
        nextCode = endCode + 1;
        codeSize = minCodeSize + 1;
    }

    const out: number[] = [];
    let bitBuf = 0;
    let bitCount = 0;
    function emit(code: number) {
        bitBuf |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
            out.push(bitBuf & 0xff);
            bitBuf >>= 8;
            bitCount -= 8;
        }
    }

    resetDict();
    emit(clearCode);

    let w = "" + indices[0];
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const wk = w + "," + k;
        if (dict.has(wk)) {
            w = wk;
        } else {
            emit(w.indexOf(",") === -1 ? Number(w) : (dict.get(w) as number));
            if (nextCode < 4096) {
                dict.set(wk, nextCode);
                nextCode++;
                if (nextCode - 1 === 1 << codeSize && codeSize < 12) {
                    codeSize++;
                }
            } else {
                emit(clearCode);
                resetDict();
            }
            w = "" + k;
        }
    }
    emit(w.indexOf(",") === -1 ? Number(w) : (dict.get(w) as number));
    emit(endCode);
    if (bitCount > 0) out.push(bitBuf & 0xff);

    return out;
}

function writeSubBlocks(w: ByteWriter, data: number[]) {
    let i = 0;
    while (i < data.length) {
        const chunk = data.slice(i, i + 255);
        w.u8(chunk.length);
        w.bytesRaw(chunk);
        i += 255;
    }
    w.u8(0);
}

export type GifFrame = { indices: Uint8Array; delayCentiseconds: number };

/** Assembles a full animated GIF89a file (infinite loop) from indexed frames sharing one palette. */
export function encodeGif(width: number, height: number, palette: RGB[], frames: GifFrame[]): Uint8Array {
    const paletteBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length))));
    const paletteSize = 1 << paletteBits;

    const w = new ByteWriter();
    w.str("GIF89a");
    w.u16le(width);
    w.u16le(height);
    // Global color table present, color resolution = paletteBits, sorted=0, size = paletteBits-1
    w.u8(0x80 | ((paletteBits - 1) << 4) | (paletteBits - 1));
    w.u8(0); // background color index
    w.u8(0); // pixel aspect ratio

    for (let i = 0; i < paletteSize; i++) {
        const c = palette[i] || [0, 0, 0];
        w.u8(c[0]);
        w.u8(c[1]);
        w.u8(c[2]);
    }

    // NETSCAPE2.0 application extension: loop forever.
    w.u8(0x21);
    w.u8(0xff);
    w.u8(11);
    w.str("NETSCAPE2.0");
    w.u8(3);
    w.u8(1);
    w.u16le(0);
    w.u8(0);

    for (const frame of frames) {
        w.u8(0x21); // extension introducer
        w.u8(0xf9); // graphic control label
        w.u8(4); // block size
        w.u8(0x00); // no transparency, no disposal preference
        w.u16le(frame.delayCentiseconds);
        w.u8(0); // transparent color index (unused)
        w.u8(0); // block terminator

        w.u8(0x2c); // image descriptor
        w.u16le(0);
        w.u16le(0);
        w.u16le(width);
        w.u16le(height);
        w.u8(0); // no local color table

        const minCodeSize = Math.max(2, paletteBits);
        w.u8(minCodeSize);
        const lzw = lzwEncode(frame.indices, minCodeSize);
        writeSubBlocks(w, lzw);
    }

    w.u8(0x3b); // trailer
    return new Uint8Array(w.bytes);
}
