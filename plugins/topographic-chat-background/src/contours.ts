// Perlin-noise field + marching squares, producing SVG path `d` strings per
// contour level. Computed once per field (not per frame) — panning is done
// with a transform, not by recomputing the field every tick.

function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function hash(x: number, y: number): number {
    const seed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return Math.floor(seed % 2147483647);
}

function gradientDot(ix: number, iy: number, x: number, y: number): number {
    const gradientX = hash(ix, iy) % 4;
    const gradientY = hash(ix + 1, iy + 2) % 4;
    const dx = x - ix;
    const dy = y - iy;
    const angle = (gradientX * 0.5 + gradientY * 0.25) % 4;
    switch (angle) {
        case 0:
            return dx + dy;
        case 1:
            return -dx + dy;
        case 2:
            return -dx - dy;
        default:
            return dx - dy;
    }
}

function perlinNoise(x: number, y: number): number {
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

// Fractal Brownian motion: sums a few octaves of noise at increasing
// frequency/decreasing amplitude. This is what makes procedural terrain
// look organic instead of blobby - cheap to compute since it only runs
// once per field generation, not per frame.
function fbm(x: number, y: number): number {
    let total = 0;
    let amplitude = 0.6;
    let frequency = 1;
    let maxValue = 0;
    for (let i = 0; i < 3; i++) {
        total += perlinNoise(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.15;
    }
    return total / maxValue;
}

function marchState(values: number[], level: number): number {
    let state = 0;
    if (values[0] >= level) state |= 1;
    if (values[1] >= level) state |= 2;
    if (values[2] >= level) state |= 4;
    if (values[3] >= level) state |= 8;
    return state;
}

function interpolatePoint(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    value1: number,
    value2: number,
    level: number,
): [number, number] {
    if (Math.abs(value2 - value1) < 1e-8) return [x1, y1];
    const t = (level - value1) / (value2 - value1);
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
}

const EDGE_MAP: Record<number, number[]> = {
    1: [3, 0],
    2: [0, 1],
    3: [3, 1],
    4: [1, 2],
    5: [3, 2],
    6: [0, 2],
    7: [3, 0, 2],
    8: [2, 3],
    9: [0, 2],
    10: [0, 1],
    11: [1, 2],
    12: [3, 1],
    13: [0, 3],
    14: [2, 1],
};

/** Builds one SVG `d` attribute string per contour level for a noise field covering `width`x`height`. */
export function buildContourPaths(
    width: number,
    height: number,
    density: number,
    cellSize: number,
    seedOffsetX: number,
    seedOffsetY: number,
): string[] {
    const cols = Math.max(8, Math.round(width / cellSize));
    const rows = Math.max(8, Math.round(height / cellSize));
    const scale = 0.06;

    const field: number[][] = [];
    for (let y = 0; y <= rows; y++) {
        const row: number[] = [];
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
                d += `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} `;
                for (let i = 1; i < pts.length; i++) {
                    d += `L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} `;
                }
            }
        }
        return d;
    });
}
