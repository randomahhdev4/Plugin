import { ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { DEFAULT_SETTINGS } from "./settings-model";
import { buildAllContourPaths } from "./contours";

const { InteractionManager } = ReactNative;

// How often the expensive part (marching squares over the whole grid) runs.
// The reference HTML recomputes every requestAnimationFrame (~60fps) because
// a desktop browser's hardware-accelerated canvas can afford that; SVG path
// string rebuilding + React reconciling on a phone cannot. ~2.5fps still
// reads as slowly evolving terrain (a background doesn't need smoothness the
// way a foreground animation would) while keeping real device headroom.
const REGEN_INTERVAL_MS = 400;

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
        e = { time: 0, paths: [], hasGenerated: false, intervalId: null, startCancel: null, listeners: new Set() };
        engines.set(key, e);
    }
    return e;
}

function tick(e: EngineState, width: number, height: number) {
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
    e.paths = buildAllContourPaths(width, height, gridStep, levels, levelRange, e.time, noise);
    e.hasGenerated = true;
    e.listeners.forEach((fn) => fn());
}

/** Subscribes a component to updates for a given size; returns an unsubscribe function. */
export function subscribe(width: number, height: number, onUpdate: () => void): () => void {
    const key = keyFor(width, height);
    const e = getEngine(key);
    e.listeners.add(onUpdate);

    if (!e.intervalId && !e.startCancel) {
        // Deferred via InteractionManager rather than a flat timeout, so the
        // very first (synchronous, most expensive) computation waits for
        // whatever transition is actually happening right as this mounts
        // (e.g. opening a channel) to finish, instead of guessing a fixed
        // delay that might be too short on a slow device or unnecessarily
        // long on a fast one.
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
