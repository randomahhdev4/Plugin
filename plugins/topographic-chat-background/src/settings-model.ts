import { storage } from "@vendetta/plugin";
import { DEFAULT_NOISE, NoiseParams } from "./contours";

export type SettingsState = {
    gridStep: number;
    levels: number;
    levelRange: number;
    speed: number;
    majorEvery: number;
    colorMain: string;
    colorSub: string;
    colorBg: string;
    glow: boolean;
    bgOpacity: number;
    noise: NoiseParams;
};

// Mirrors the reference HTML's DEFAULTS exactly, with one addition
// (bgOpacity) since here the pattern sits behind real chat content instead
// of filling an entire page - and gridStep/levels default a bit lighter
// than the HTML's, since this runs continuously on a phone rather than a
// desktop browser with hardware-accelerated canvas.
export const DEFAULT_SETTINGS: SettingsState = {
    gridStep: 18,
    levels: 7,
    levelRange: 2.8,
    speed: 1.0,
    majorEvery: 4,
    colorMain: "#7869be",
    colorSub: "#5a5a8c",
    colorBg: "#0a0a0c",
    glow: true,
    bgOpacity: 0.55,
    noise: { ...DEFAULT_NOISE },
};

// TopographicBackground calls ensureDefaults() on every render (which
// happens often - MessagesConnected re-renders on most chat activity).
// The check-and-backfill loop below is cheap once, but there's no reason to
// repeat it every single render when it can only ever do real work the
// first time (or right after Import/Reset, which call it directly again).
let ensured = false;

export function ensureDefaults() {
    if (ensured) return;
    ensured = true;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (storage[key] === undefined) {
            const value = (DEFAULT_SETTINGS as any)[key];
            storage[key] = typeof value === "object" ? { ...value } : value;
        }
    }
    // Backfill any individual noise keys added after a user's storage was
    // already initialized, so imported/older configs don't crash on a
    // missing term.
    for (const key of Object.keys(DEFAULT_NOISE)) {
        if (storage.noise[key] === undefined) {
            storage.noise[key] = (DEFAULT_NOISE as any)[key];
        }
    }
}

export function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

export function randomizeNoise(): NoiseParams {
    return {
        freqA: randomRange(0.006, 0.02),
        freqAY: randomRange(0.006, 0.02),
        phaseAx: randomRange(0.05, 0.2),
        phaseAy: randomRange(0.05, 0.2),
        phaseAMul: randomRange(0.8, 2.2),
        freqBx: randomRange(0.01, 0.03),
        freqBy: randomRange(0.01, 0.03),
        phaseB: randomRange(0.08, 0.25),
        ampB: randomRange(0.3, 0.9),
        freqCx: randomRange(0.004, 0.015),
        freqCy: randomRange(0.01, 0.025),
        phaseC: randomRange(0.03, 0.12),
        ampC: randomRange(0.4, 1.0),
        freqD: randomRange(0.006, 0.016),
        dirDx: randomRange(0.3, 1.2),
        dirDy: randomRange(0.8, 1.6),
        phaseD: randomRange(0.06, 0.2),
        ampD: randomRange(0.25, 0.65),
        freqE: randomRange(0.007, 0.018),
        dirEx: randomRange(0.8, 1.8),
        dirEy: randomRange(-1.0, -0.3),
        phaseE: randomRange(0.03, 0.1),
        ampE: randomRange(0.3, 0.7),
        freqFx: randomRange(0.02, 0.045),
        freqFy: randomRange(0.015, 0.035),
        phaseFx: randomRange(0.1, 0.3),
        phaseFy: randomRange(0.08, 0.2),
        ampF: randomRange(0.3, 0.7),
    };
}
