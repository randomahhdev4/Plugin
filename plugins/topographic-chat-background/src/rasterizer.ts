// A minimal software rasterizer: draws alpha-blended line segments directly
// into an RGB pixel buffer. React Native has no Canvas API, so this exists
// purely to turn our already-computed line geometry into actual pixels for
// GIF encoding - not used by the live SVG rendering path at all.

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
    const c = hex.replace("#", "");
    const full = c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c;
    const num = parseInt(full, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function createFrameBuffer(width: number, height: number, bg: RGB): Uint8Array {
    const buf = new Uint8Array(width * height * 3);
    for (let i = 0; i < buf.length; i += 3) {
        buf[i] = bg[0];
        buf[i + 1] = bg[1];
        buf[i + 2] = bg[2];
    }
    return buf;
}

function plot(buf: Uint8Array, width: number, height: number, x: number, y: number, color: RGB, alpha: number) {
    if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;
    const idx = (y * width + x) * 3;
    if (alpha >= 1) {
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        return;
    }
    buf[idx] = buf[idx] + (color[0] - buf[idx]) * alpha;
    buf[idx + 1] = buf[idx + 1] + (color[1] - buf[idx + 1]) * alpha;
    buf[idx + 2] = buf[idx + 2] + (color[2] - buf[idx + 2]) * alpha;
}

// Thickness is approximated by stamping a small filled square at samples
// along the line rather than true stroke geometry - simpler, and more than
// good enough at the widths (1-4px) this pattern actually uses.
function stamp(buf: Uint8Array, width: number, height: number, cx: number, cy: number, radius: number, color: RGB, alpha: number) {
    const r = Math.max(0, Math.round(radius));
    if (r === 0) {
        plot(buf, width, height, Math.round(cx), Math.round(cy), color, alpha);
        return;
    }
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            plot(buf, width, height, Math.round(cx) + dx, Math.round(cy) + dy, color, alpha);
        }
    }
}

/** Draws a batch of line segments (flat [x1,y1,x2,y2,...] array, from buildContourSegments) with a given stroke width and alpha. */
export function drawSegments(
    buf: Uint8Array,
    width: number,
    height: number,
    segments: number[],
    color: RGB,
    alpha: number,
    strokeWidth: number,
) {
    const radius = strokeWidth / 2;
    for (let i = 0; i < segments.length; i += 4) {
        const x1 = segments[i];
        const y1 = segments[i + 1];
        const x2 = segments[i + 2];
        const y2 = segments[i + 3];

        const dist = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(1, Math.ceil(dist));
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            stamp(buf, width, height, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, radius, color, alpha);
        }
    }
}
