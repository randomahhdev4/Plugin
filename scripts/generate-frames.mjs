// Build-time frame generator. All the noise + marching-squares math that
// used to run on-device (and lag) now runs once, here, in Node. The plugin
// just plays back the resulting static path data at runtime - no computation
// left to do, so there's nothing left to lag.
import { writeFile } from "fs/promises";

const VIEWBOX = { width: 1080, height: 2400 };
const FRAME_COUNT = 6;
const DENSITY = 9;
const CELL_SIZE = 30;
const LOOP_RADIUS = 5.5; // how much the noise field varies around the loop; tuned by eye.

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function hash(x, y) {
    const seed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return Math.floor(seed % 2147483647);
}

function gradientDot(ix, iy, x, y) {
    const gradientX = hash(ix, iy) % 4;
    const gradientY = hash(ix + 1, iy + 2) % 4;
    const dx = x - ix;
    const dy = y - iy;
    const angle = (gradientX * 0.5 + gradientY * 0.25) % 4;
    switch (angle) {
        case 0: return dx + dy;
        case 1: return -dx + dy;
        case 2: return -dx - dy;
        default: return dx - dy;
    }
}

function perlinNoise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const u = fade(x - x0);
    const v = fade(y - y0);
    const n00 = gradientDot(x0, y0, x, y);
    const n01 = gradientDot(x0, y0 + 1, x, y);
    const n10 = gradientDot(x0 + 1, y0, x, y);
    const n11 = gradientDot(x0 + 1, y0 + 1, x, y);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

function fbm(x, y) {
    let total = 0, amplitude = 0.6, frequency = 1, maxValue = 0;
    for (let i = 0; i < 4; i++) {
        total += perlinNoise(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.15;
    }
    return total / maxValue;
}

function marchState(values, level) {
    let state = 0;
    if (values[0] >= level) state |= 1;
    if (values[1] >= level) state |= 2;
    if (values[2] >= level) state |= 4;
    if (values[3] >= level) state |= 8;
    return state;
}

function interpolatePoint(x1, y1, x2, y2, value1, value2, level) {
    if (Math.abs(value2 - value1) < 1e-8) return [x1, y1];
    const t = (level - value1) / (value2 - value1);
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
}

const EDGE_MAP = {
    1: [3, 0], 2: [0, 1], 3: [3, 1], 4: [1, 2], 5: [3, 2], 6: [0, 2],
    7: [3, 0, 2], 8: [2, 3], 9: [0, 2], 10: [0, 1], 11: [1, 2], 12: [3, 1],
    13: [0, 3], 14: [2, 1],
};

function buildContourPaths(width, height, density, cellSize, seedOffsetX, seedOffsetY) {
    const cols = Math.max(8, Math.round(width / cellSize));
    const rows = Math.max(8, Math.round(height / cellSize));
    const scale = 0.045;

    const field = [];
    for (let y = 0; y <= rows; y++) {
        const row = [];
        for (let x = 0; x <= cols; x++) {
            row.push(fbm(x * scale + seedOffsetX, y * scale + seedOffsetY));
        }
        field.push(row);
    }

    const stepX = width / cols;
    const stepY = height / rows;
    const levels = Array.from({ length: density }, (_, i) => (i + 1) / (density + 1) - 0.5);

    return levels.map((level) => {
        let d = "";
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const topLeft = field[y][x];
                const topRight = field[y][x + 1];
                const bottomRight = field[y + 1][x + 1];
                const bottomLeft = field[y + 1][x];
                const values = [topLeft, topRight, bottomRight, bottomLeft];
                const state = marchState(values, level);
                if (state === 0 || state === 15) continue;

                const cx = x * stepX;
                const cy = y * stepY;
                const edges = [
                    interpolatePoint(cx, cy, cx + stepX, cy, topLeft, topRight, level),
                    interpolatePoint(cx + stepX, cy, cx + stepX, cy + stepY, topRight, bottomRight, level),
                    interpolatePoint(cx + stepX, cy + stepY, cx, cy + stepY, bottomRight, bottomLeft, level),
                    interpolatePoint(cx, cy + stepY, cx, cy, bottomLeft, topLeft, level),
                ];

                const order = EDGE_MAP[state];
                if (!order) continue;

                const pts = order.map((i) => edges[i]);
                d += `M${Math.round(pts[0][0])},${Math.round(pts[0][1])} `;
                for (let i = 1; i < pts.length; i++) {
                    d += `L${Math.round(pts[i][0])},${Math.round(pts[i][1])} `;
                }
            }
        }
        return d;
    });
}

// Sample the noise field's offset along a circle (not a straight line), so
// frame[FRAME_COUNT-1] flows continuously back into frame[0] - a seamless
// loop with no jump, instead of needing to ping-pong or snap.
const frames = [];
for (let i = 0; i < FRAME_COUNT; i++) {
    const angle = (i / FRAME_COUNT) * Math.PI * 2;
    const offsetX = Math.cos(angle) * LOOP_RADIUS;
    const offsetY = Math.sin(angle) * LOOP_RADIUS;
    frames.push(buildContourPaths(VIEWBOX.width, VIEWBOX.height, DENSITY, CELL_SIZE, offsetX, offsetY));
    process.stdout.write(`frame ${i + 1}/${FRAME_COUNT}\r`);
}
console.log(`\nGenerated ${FRAME_COUNT} frames.`);

const out = `// Generated by scripts/generate-frames.mjs - do not edit by hand.
// Run \`npm run generate-frames\` to regenerate.
export const FRAME_VIEWBOX = { width: ${VIEWBOX.width}, height: ${VIEWBOX.height} };
export const FRAMES: string[][] = ${JSON.stringify(frames)};
`;

const outPath = new URL("../plugins/topographic-chat-background/src/frames.ts", import.meta.url);
await writeFile(outPath, out);

const sizeKB = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`Wrote ${outPath.pathname} (${sizeKB} KB)`);
