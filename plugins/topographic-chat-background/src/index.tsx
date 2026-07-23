import { findByDisplayName, findByProps } from "@vendetta/metro";
import { React, ReactNative, chroma } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";

import Settings from "./Settings";
import { ensureDefaults, DEFAULT_SETTINGS } from "./settings-model";
import { subscribe, getPaths } from "./engine";

const { Animated, Dimensions, StyleSheet } = ReactNative;

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

    const { width, height } = Dimensions.get("window");
    const [, forceTick] = React.useState(0);

    // Generation itself lives in the shared engine, keyed by size, so it
    // keeps running on its own schedule regardless of how often this
    // particular component instance mounts/unmounts. This effect just
    // subscribes to updates for this size and re-renders when they happen.
    React.useEffect(() => subscribe(width, height, () => forceTick((t) => t + 1)), [width, height]);

    const svg = getSvg();
    const paths = getPaths(width, height);

    const layer = React.useMemo(() => {
        if (!svg) return null;
        const { Svg, Path } = svg;
        const items: any[] = [];
        paths.forEach((d, i) => {
            const isMajor = i % majorEvery === 0;
            if (isMajor) {
                if (glow) {
                    items.push(<Path key={`${i}-glow`} d={d} stroke={colorMain} strokeWidth={4} strokeOpacity={0.25} fill="none" />);
                }
                items.push(<Path key={i} d={d} stroke={colorMain} strokeWidth={1.6} fill="none" />);
            } else {
                items.push(<Path key={i} d={d} stroke={colorSub} strokeWidth={1} strokeOpacity={0.32} fill="none" />);
            }
        });
        return (
            <Svg width={width} height={height}>
                {items}
            </Svg>
        );
    }, [svg, paths, colorMain, colorSub, majorEvery, glow, width, height]);

    if (!svg || !layer) return null;

    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity: bgOpacity }]}>
            {layer}
        </Animated.View>
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

function revealBehindMessages(tree: any): boolean {
    const messagesBg = findInReactTree(tree, (x: any) => x && "HACK_fixModalInteraction" in x.props && x?.props?.style);
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
