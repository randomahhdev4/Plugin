// Ported directly from the reference HTML's canvas implementation (6-term
// layered sine/cosine noise field + marching squares), producing SVG path
// `d` strings instead of drawing to a canvas. Kept numerically identical so
// the look matches exactly - only the output format differs.

export type NoiseParams = {
    freqA: number; freqAY: number; phaseAx: number; phaseAy: number; phaseAMul: number;
    freqBx: number; freqBy: number; phaseB: number; ampB: number;
    freqCx: number; freqCy: number; phaseC: number; ampC: number;
    freqD: number; dirDx: number; dirDy: number; phaseD: number; ampD: number;
    freqE: number; dirEx: number; dirEy: number; phaseE: number; ampE: number;
    freqFx: number; freqFy: number; phaseFx: number; phaseFy: number; ampF: number;
};

export const DEFAULT_NOISE: NoiseParams = {
    freqA: 0.012, freqAY: 0.015, phaseAx: 0.11, phaseAy: 0.09, phaseAMul: 1.5,
    freqBx: 0.021, freqBy: 0.017, phaseB: 0.17, ampB: 0.6,
    freqCx: 0.0083, freqCy: 0.0191, phaseC: 0.08, ampC: 0.7,
    freqD: 0.010, dirDx: 0.7, dirDy: 1.3, phaseD: 0.13, ampD: 0.45,
    freqE: 0.013, dirEx: 1.4, dirEy: -0.6, phaseE: 0.06, ampE: 0.5,
    freqFx: 0.031, freqFy: 0.027, phaseFx: 0.21, phaseFy: 0.14, ampF: 0.5,
};

function sampleNoise(x: number, y: number, t: number, sinA: number, cosA: number, n: NoiseParams): number {
    return (
        Math.sin(x * n.freqA + sinA) * Math.cos(y * n.freqAY + cosA) +
        Math.sin(x * n.freqBx - y * n.freqBy + t * n.phaseB) * n.ampB +
        Math.cos(x * n.freqCx + y * n.freqCy - t * n.phaseC) * n.ampC +
        Math.sin((x * n.dirDx + y * n.dirDy) * n.freqD + t * n.phaseD) * n.ampD +
        Math.cos((x * n.dirEx + y * n.dirEy) * n.freqE - t * n.phaseE) * n.ampE +
        Math.sin(x * n.freqFx + t * n.phaseFx) * Math.sin(y * n.freqFy - t * n.phaseFy) * n.ampF
    );
}

export function computeGrid(
    width: number,
    height: number,
    gridStep: number,
    t: number,
    n: NoiseParams,
): { grid: Float32Array; cols: number; rows: number } {
    const cols = Math.ceil(width / gridStep) + 2;
    const rows = Math.ceil(height / gridStep) + 2;
    const grid = new Float32Array(cols * rows);

    const sinA = Math.sin(t * n.phaseAx) * n.phaseAMul;
    const cosA = Math.cos(t * n.phaseAy) * n.phaseAMul;

    let idx = 0;
    for (let j = 0; j < rows; j++) {
        const y = j * gridStep;
        for (let i = 0; i < cols; i++) {
            const x = i * gridStep;
            grid[idx++] = sampleNoise(x, y, t, sinA, cosA, n);
        }
    }
    return { grid, cols, rows };
}

/** Builds one SVG path `d` string for a single contour level, matching the HTML's marching-squares switch exactly. */
export function buildContourPath(grid: Float32Array, cols: number, rows: number, gridStep: number, level: number): string {
    let d = "";
    const gs = gridStep;

    for (let j = 0; j < rows - 1; j++) {
        const rowOff = j * cols;
        const rowOff2 = rowOff + cols;
        const y0 = j * gs;
        const y1 = y0 + gs;

        for (let i = 0; i < cols - 1; i++) {
            const v00 = grid[rowOff + i];
            const v10 = grid[rowOff + i + 1];
            const v11 = grid[rowOff2 + i + 1];
            const v01 = grid[rowOff2 + i];

            let idx = 0;
            if (v00 > level) idx |= 1;
            if (v10 > level) idx |= 2;
            if (v11 > level) idx |= 4;
            if (v01 > level) idx |= 8;
            if (idx === 0 || idx === 15) continue;

            const x0 = i * gs;
            const x1 = x0 + gs;
            let tx = 0, ty = 0, rx = 0, ry = 0, bx = 0, by = 0, lx = 0, ly = 0;

            switch (idx) {
                case 1:
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    d += `M${lx.toFixed(1)},${ly.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)} `;
                    break;
                case 2:
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    d += `M${tx.toFixed(1)},${ty.toFixed(1)} L${rx.toFixed(1)},${ry.toFixed(1)} `;
                    break;
                case 3:
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    d += `M${lx.toFixed(1)},${ly.toFixed(1)} L${rx.toFixed(1)},${ry.toFixed(1)} `;
                    break;
                case 4:
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    d += `M${rx.toFixed(1)},${ry.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} `;
                    break;
                case 5:
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    d += `M${lx.toFixed(1)},${ly.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)} `;
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    d += `M${rx.toFixed(1)},${ry.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} `;
                    break;
                case 6:
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    d += `M${tx.toFixed(1)},${ty.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} `;
                    break;
                case 7:
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    d += `M${lx.toFixed(1)},${ly.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} `;
                    break;
                case 8:
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    d += `M${bx.toFixed(1)},${by.toFixed(1)} L${lx.toFixed(1)},${ly.toFixed(1)} `;
                    break;
                case 9:
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    d += `M${tx.toFixed(1)},${ty.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} `;
                    break;
                case 10:
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    d += `M${tx.toFixed(1)},${ty.toFixed(1)} L${lx.toFixed(1)},${ly.toFixed(1)} `;
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    d += `M${bx.toFixed(1)},${by.toFixed(1)} L${rx.toFixed(1)},${ry.toFixed(1)} `;
                    break;
                case 11:
                    bx = x0 + (x1 - x0) * (level - v01) / (v11 - v01); by = y1;
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    d += `M${bx.toFixed(1)},${by.toFixed(1)} L${rx.toFixed(1)},${ry.toFixed(1)} `;
                    break;
                case 12:
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    d += `M${rx.toFixed(1)},${ry.toFixed(1)} L${lx.toFixed(1)},${ly.toFixed(1)} `;
                    break;
                case 13:
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    rx = x1; ry = y0 + (y1 - y0) * (level - v10) / (v11 - v10);
                    d += `M${tx.toFixed(1)},${ty.toFixed(1)} L${rx.toFixed(1)},${ry.toFixed(1)} `;
                    break;
                case 14:
                    tx = x0 + (x1 - x0) * (level - v00) / (v10 - v00); ty = y0;
                    lx = x0; ly = y0 + (y1 - y0) * (level - v00) / (v01 - v00);
                    d += `M${tx.toFixed(1)},${ty.toFixed(1)} L${lx.toFixed(1)},${ly.toFixed(1)} `;
                    break;
            }
        }
    }
    return d;
}

/** Builds one path string per contour level, evenly spaced across [-levelRange, levelRange]. */
export function buildAllContourPaths(
    width: number,
    height: number,
    gridStep: number,
    levels: number,
    levelRange: number,
    t: number,
    noise: NoiseParams,
): string[] {
    const { grid, cols, rows } = computeGrid(width, height, gridStep, t, noise);
    const paths: string[] = [];
    for (let l = 0; l < levels; l++) {
        const level = -levelRange + (l / (levels - 1)) * (levelRange * 2);
        paths.push(buildContourPath(grid, cols, rows, gridStep, level));
    }
    return paths;
}
