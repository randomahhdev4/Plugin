import { ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { DEFAULT_SETTINGS } from "./settings-model";
import { computeGrid, buildContourPath } from "./contours";

const { InteractionManager } = ReactNative;

// How often a new generation cycle *starts*. The reference HTML recomputes
// every requestAnimationFrame (~60fps) because a desktop browser's
// hardware-accelerated canvas can afford that; SVG path rebuilding + React
// reconciling on a phone cannot. ~2.5fps still reads as slowly evolving
// terrain (a background doesn't need smoothness the way a foreground
// animation would) while keeping real device headroom.
const REGEN_INTERVAL_MS = 400;

// JS is single-threaded in React Native - there's no true parallelism
// available to a plugin without native modules, which aren't an option
// here. What *is* available: computing one contour level per macrotask
// (via setTimeout) instead of all of them in one long synchronous burst.
// Long single bursts are what actually cause felt jank, since they block
// the same JS thread that scroll/gesture handling also needs; splitting
// the same total work into several short bursts with yield points between
// them lets that other work interleave, even though it's still
// cooperative multitasking on one thread, not real concurrency.
const LEVELS_PER_CHUNK = 1;

// Keyed by "widthxheight" (main background uses the full window; the
// settings preview uses its own smaller size) and kept at MODULE scope, not
// component-instance scope. <TopographicBackground/> gets recreated as a
// brand new element every time MessagesConnected re-renders (which happens
// often - new messages, etc.); if the timer/time/paths lived in that
// component's own refs, a remount would silently reset all of it, and
// visible updates would end up depending on how often MessagesConnected
// happens to re-render for unrelated reasons instead of our own interval.
// Storing state here means it survives remounts entirely - only truly
// stops when literally nothing is subscribed to that size.
type EngineState = {
    time: number;
    paths: string[];
    hasGenerated: boolean;
    computing: boolean;
    intervalId: ReturnType<typeof setInterval> | null;
    startCancel: (() => void) | null;
    listeners: Set<() => void>;
};

const engines = new Map<string, EngineState>();

function keyFor(width: number, height: number): string {
    return `${Math.round(width)}x${Math.round(height)}`;
}

function getEngine(key: string): EngineState {
    let e = engines.get(key);
    if (!e) {
        e = { time: 0, paths: [], hasGenerated: false, computing: false, intervalId: null, startCancel: null, listeners: new Set() };
        engines.set(key, e);
    }
    return e;
}

function tick(e: EngineState, width: number, height: number) {
    // A chunked run from the previous tick is still in flight - skip this
    // one rather than starting overlapping work (can happen if a device is
    // slow enough that one full generation takes longer than the interval).
    if (e.computing) return;

    const speed = storage.speed ?? DEFAULT_SETTINGS.speed;
    const dtPerTick = 0.012 * speed * (REGEN_INTERVAL_MS / 16.67);

    // speed=0 means a frozen, unchanging field - once it's been generated
    // once, recomputing the identical grid every tick (and re-rendering
    // every subscriber) is pure waste. Skip until speed changes again.
    if (dtPerTick === 0 && e.hasGenerated) return;

    const gridStep = storage.gridStep ?? DEFAULT_SETTINGS.gridStep;
    const levels = storage.levels ?? DEFAULT_SETTINGS.levels;
    const levelRange = storage.levelRange ?? DEFAULT_SETTINGS.levelRange;
    const noise = storage.noise ?? DEFAULT_SETTINGS.noise;

    e.time += dtPerTick;
    e.computing = true;

    // The noise field itself (computeGrid) is one synchronous pass but
    // cheap relative to marching squares over every level; only the level
    // loop gets chunked.
    const { grid, cols, rows } = computeGrid(width, height, gridStep, e.time, noise);
    const newPaths: string[] = new Array(levels);
    let l = 0;

    function step() {
        const batchEnd = Math.min(levels, l + LEVELS_PER_CHUNK);
        for (; l < batchEnd; l++) {
            const level = -levelRange + (l / (levels - 1)) * (levelRange * 2);
            newPaths[l] = buildContourPath(grid, cols, rows, gridStep, level);
        }
        if (l < levels) {
            setTimeout(step, 0);
        } else {
            e.paths = newPaths;
            e.hasGenerated = true;
            e.computing = false;
            e.listeners.forEach((fn) => fn());
        }
    }
    step();
}

/** Subscribes a component to updates for a given size; returns an unsubscribe function. */
export function subscribe(width: number, height: number, onUpdate: () => void): () => void {
    const key = keyFor(width, height);
    const e = getEngine(key);
    e.listeners.add(onUpdate);

    if (!e.intervalId && !e.startCancel) {
        // Deferred via InteractionManager rather than a flat timeout, so the
        // very first (heaviest) computation waits for whatever transition is
        // actually happening right as this mounts (e.g. opening a channel)
        // to finish, instead of guessing a fixed delay that might be too
        // short on a slow device or unnecessarily long on a fast one.
        if (InteractionManager?.runAfterInteractions) {
            const handle = InteractionManager.runAfterInteractions(() => {
                e.startCancel = null;
                tick(e, width, height);
                e.intervalId = setInterval(() => tick(e, width, height), REGEN_INTERVAL_MS);
            });
            e.startCancel = () => handle.cancel?.();
        } else {
            const id = setTimeout(() => {
                e.startCancel = null;
                tick(e, width, height);
                e.intervalId = setInterval(() => tick(e, width, height), REGEN_INTERVAL_MS);
            }, 50);
            e.startCancel = () => clearTimeout(id);
        }
    }

    return () => {
        e.listeners.delete(onUpdate);
        if (e.listeners.size === 0) {
            if (e.intervalId) {
                clearInterval(e.intervalId);
                e.intervalId = null;
            }
            if (e.startCancel) {
                e.startCancel();
                e.startCancel = null;
            }
        }
    };
}

export function getPaths(width: number, height: number): string[] {
    return getEngine(keyFor(width, height)).paths;
}
