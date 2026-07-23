import { findByDisplayName, findByProps } from "@vendetta/metro";
import { React, ReactNative, chroma } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";

import Settings from "./Settings";
import { ensureDefaults, DEFAULT_SETTINGS } from "./settings-model";
import { subscribe, getPaths } from "./engine";
import { mergeByMajor } from "./contours";

const { View, Image, Dimensions, StyleSheet } = ReactNative;

// Resolved lazily (not at module-eval time): if react-native-svg hasn't been
// touched by Discord's own code yet at the moment this plugin is enabled,
// findByProps returns undefined, and destructuring it at the top level would
// throw and take down the whole module before `export default` even runs.
let svgModule: { Svg: any; Path: any } | null = null;
export function getSvg() {
    if (svgModule) return svgModule;
    try {
        const found = findByProps("SvgXml") as any;
        // The <Svg> root element is exported as `default`, not as a `Svg` key.
        if (found?.default && found?.Path) svgModule = { Svg: found.default, Path: found.Path };
    } catch (e) {
        logger.error("[TopographicChatBackground] Failed to resolve react-native-svg.", e);
    }
    return svgModule;
}

export function TopographicBackground() {
    ensureDefaults();

    const majorEvery = storage.majorEvery ?? DEFAULT_SETTINGS.majorEvery;
    const colorMain = storage.colorMain ?? DEFAULT_SETTINGS.colorMain;
    const colorSub = storage.colorSub ?? DEFAULT_SETTINGS.colorSub;
    const glow = storage.glow ?? DEFAULT_SETTINGS.glow;
    const bgOpacity = storage.bgOpacity ?? DEFAULT_SETTINGS.bgOpacity;
    const useCachedGif = !!storage.useCachedGif;
    const cachedGifPath = storage.cachedGifPath as string | undefined;
    const hasBaked = !!cachedGifPath;
    // The actual chat background never falls back to live rendering - only
    // the settings screen's own preview does that, for tuning. Until a bake
    // has actually succeeded once, this renders nothing at all in chat.
    const showingGif = hasBaked && useCachedGif;
    const showingLive = hasBaked && !useCachedGif;

    const { width, height } = Dimensions.get("window");
    const [, forceTick] = React.useState(0);

    // Hooks always run (hooks rule), but the subscription itself only does
    // real work once a bake exists and live mode is actually selected -
    // before the first successful bake, nothing subscribes, nothing
    // generates, nothing renders in chat at all.
    React.useEffect(() => {
        if (!showingLive) return;
        return subscribe(width, height, () => forceTick((t) => t + 1));
    }, [width, height, showingLive]);

    const svg = getSvg();
    const paths = getPaths(width, height);

    const layer = React.useMemo(() => {
        if (!showingLive || !svg) return null;
        const { Svg, Path } = svg;
        const { major, minor } = mergeByMajor(paths, majorEvery);
        return (
            <Svg width={width} height={height}>
                {minor ? <Path d={minor} stroke={colorSub} strokeWidth={1} strokeOpacity={0.32} fill="none" /> : null}
                {major && glow ? <Path d={major} stroke={colorMain} strokeWidth={4} strokeOpacity={0.25} fill="none" /> : null}
                {major ? <Path d={major} stroke={colorMain} strokeWidth={1.6} fill="none" /> : null}
            </Svg>
        );
    }, [showingLive, svg, paths, colorMain, colorSub, majorEvery, glow, width, height]);

    if (showingGif) {
        return (
            <Image
                pointerEvents="none"
                source={{ uri: `file://${cachedGifPath}` }}
                style={[StyleSheet.absoluteFillObject, { opacity: bgOpacity }]}
                resizeMode="cover"
            />
        );
    }

    if (!showingLive || !svg || !layer) return null;

    return (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity: bgOpacity }]}>
            {layer}
        </View>
    );
}

// The message list itself paints an opaque background; without lowering that
// layer's alpha, anything drawn behind it (like our contours) stays hidden.
// This mirrors Revenge's own built-in "custom chat background" patch.
const transparentColorCache = new Map<string, string>();
function getTransparentColor(original: string): string {
    let cached = transparentColorCache.get(original);
    if (!cached) {
        cached = chroma(original || "black").alpha(0).hex();
        transparentColorCache.set(original, cached);
    }
    return cached;
}

const isMessagesBg = (x: any) => x && "HACK_fixModalInteraction" in x.props && x?.props?.style;

function walkPath(tree: any, path: number[]): any {
    let node = tree;
    for (const idx of path) {
        const children = node?.props?.children;
        if (children == null) return null;
        node = Array.isArray(children) ? children[idx] : idx === 0 ? children : null;
        if (!node) return null;
    }
    return node;
}

function findPathTo(tree: any, path: number[] = []): number[] | null {
    if (isMessagesBg(tree)) return path;
    const children = tree?.props?.children;
    if (children == null) return null;
    const arr = Array.isArray(children) ? children : [children];
    for (let i = 0; i < arr.length; i++) {
        const found = findPathTo(arr[i], [...path, i]);
        if (found) return found;
    }
    return null;
}

// Discord's own tree shape is stable across ordinary re-renders (new
// messages, typing state, etc. change content, not structure), so the
// child-index path to this element is almost always the same every time.
// A direct walk down a known path is O(depth); a full findInReactTree scan
// is O(size of the whole rendered subtree) - on every single
// MessagesConnected render, independent of anything the contour background
// itself does. Falls back to a full search if the cached path ever misses
// (tree shape genuinely changed), and re-caches from that.
let cachedPath: number[] | null = null;

function revealBehindMessages(tree: any): boolean {
    let messagesBg = cachedPath ? walkPath(tree, cachedPath) : null;
    if (!messagesBg || !isMessagesBg(messagesBg)) {
        const path = findPathTo(tree);
        if (!path) return false;
        cachedPath = path;
        messagesBg = walkPath(tree, path);
    }
    if (!messagesBg) return false;

    const flattened = StyleSheet.flatten(messagesBg.props.style);
    const transparent = getTransparentColor(flattened.backgroundColor || "black");
    messagesBg.props.style = StyleSheet.flatten([messagesBg.props.style, { backgroundColor: transparent }]);
    return true;
}

let unpatch: (() => void) | undefined;

export default {
    onLoad: () => {
        ensureDefaults();

        const Messages = findByDisplayName("MessagesConnected");
        if (!Messages) {
            logger.error("[TopographicChatBackground] Could not find MessagesConnected to patch.");
            return;
        }

        unpatch = after("render", Messages, (_args: any[], ret: any) => {
            if (!ret) return ret;
            revealBehindMessages(ret);
            return (
                <>
                    <TopographicBackground />
                    {ret}
                </>
            );
        });

        logger.log("[TopographicChatBackground] Loaded.");
    },
    onUnload: () => {
        unpatch?.();
        unpatch = undefined;
    },
    settings: Settings,
};
