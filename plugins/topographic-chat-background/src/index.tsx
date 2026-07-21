import { findByDisplayName, findByProps } from "@vendetta/metro";
import { React, ReactNative, chroma } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { registerCommand } from "@vendetta/commands";

import Settings from "./Settings";
import { DEFAULT_SETTINGS, ensureDefaults } from "./settings-model";
import { FRAMES, FRAME_VIEWBOX } from "./frames";

const { Animated, Easing, StyleSheet } = ReactNative;

// Resolved lazily (not at module-eval time): if react-native-svg hasn't been
// touched by Discord's own code yet at the moment this plugin is enabled,
// findByProps returns undefined, and destructuring it at the top level would
// throw and take down the whole module before `export default` even runs.
let svgModule: { Svg: any; Path: any } | null = null;
function getSvg() {
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

// Every frame is precomputed at build time (scripts/generate-frames.mjs) -
// there is no noise generation or marching squares happening on-device at
// all anymore. This component's only job at runtime is: pick a frame index,
// crossfade to the next one on a timer, and hand static path strings to SVG.
// That's what makes it lag-free - there's simply no math left to do.
function TopographicBackground() {
    ensureDefaults();

    const speed = storage.driftSpeed ?? DEFAULT_SETTINGS.driftSpeed;
    const opacity = storage.lineOpacity ?? DEFAULT_SETTINGS.lineOpacity;
    const color = storage.lineColor ?? DEFAULT_SETTINGS.lineColor;
    const speedT = Math.min(1, Math.max(0, (speed - 0.0001) / 0.0019));

    const crossfade = React.useRef(new Animated.Value(0)).current;
    const indexRef = React.useRef(0);
    const [, forceTick] = React.useState(0);

    React.useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        // How long a frame sits fully visible before crossfading to the
        // next one in the fixed loop. Faster speed = shorter hold.
        const holdDuration = 14000 - speedT * 9000;
        const crossfadeDuration = 3500;

        function cycle() {
            crossfade.setValue(0);
            Animated.timing(crossfade, {
                toValue: 1,
                duration: crossfadeDuration,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (cancelled || !finished) return;
                indexRef.current = (indexRef.current + 1) % FRAMES.length;
                forceTick((t) => t + 1);
                timer = setTimeout(cycle, holdDuration);
            });
        }

        timer = setTimeout(cycle, holdDuration);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [speedT]);

    const svg = getSvg();
    const currentIndex = indexRef.current;
    const nextIndex = (currentIndex + 1) % FRAMES.length;
    const viewBox = `0 0 ${FRAME_VIEWBOX.width} ${FRAME_VIEWBOX.height}`;

    const currentLayer = React.useMemo(() => {
        if (!svg) return null;
        const { Svg, Path } = svg;
        return (
            <Svg viewBox={viewBox} width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
                {FRAMES[currentIndex].map((d, i) => (
                    <Path key={i} d={d} stroke={color} strokeWidth={2.4} fill="none" />
                ))}
            </Svg>
        );
    }, [svg, color, currentIndex]);

    const nextLayer = React.useMemo(() => {
        if (!svg) return null;
        const { Svg, Path } = svg;
        return (
            <Svg viewBox={viewBox} width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
                {FRAMES[nextIndex].map((d, i) => (
                    <Path key={i} d={d} stroke={color} strokeWidth={2.4} fill="none" />
                ))}
            </Svg>
        );
    }, [svg, color, nextIndex]);

    if (!svg) return null;

    return (
        <>
            <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject, { opacity: Animated.multiply(Animated.subtract(1, crossfade), opacity) }]}
            >
                {currentLayer}
            </Animated.View>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity: Animated.multiply(crossfade, opacity) }]}>
                {nextLayer}
            </Animated.View>
        </>
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

// Tracked so /topo-status can report real, observed facts instead of just
// "onLoad ran" (which is true even if every actual hook failed silently).
const diagnostics = {
    messagesFound: false,
    renderPatchFired: 0,
    revealFound: false,
};

function statusReport(): string {
    const svg = getSvg();
    const lines = [
        "**Topographic Chat Background — status**",
        `MessagesConnected found: ${diagnostics.messagesFound ? "yes" : "no"}`,
        `Render patch fired: ${diagnostics.renderPatchFired} time(s)`,
        `Opaque background layer found & cleared: ${diagnostics.revealFound ? "yes" : "no"}`,
        `react-native-svg resolved: ${svg ? "yes" : "no"}`,
        `Precomputed frames: ${FRAMES.length}`,
    ];

    if (!diagnostics.messagesFound) {
        lines.push("", "⚠️ MessagesConnected wasn't found on load — the patch never attached.");
    } else if (diagnostics.renderPatchFired === 0) {
        lines.push("", "⚠️ Patch attached but hasn't fired yet — open a channel to trigger a re-render.");
    } else if (!diagnostics.revealFound) {
        lines.push("", "⚠️ Render patch is firing, but the opaque background layer wasn't found — contours may be drawn behind an opaque layer.");
    } else if (!svg) {
        lines.push("", "⚠️ Everything else is hooked, but react-native-svg isn't resolved — no lines can be drawn.");
    } else {
        lines.push("", "✅ Fully hooked. If you still don't see anything, check opacity in the plugin settings.");
    }

    return lines.join("\n");
}

let unpatch: (() => void) | undefined;
let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        ensureDefaults();

        const Messages = findByDisplayName("MessagesConnected");
        diagnostics.messagesFound = !!Messages;

        if (!Messages) {
            logger.error("[TopographicChatBackground] Could not find MessagesConnected to patch.");
        } else {
            unpatch = after("render", Messages, (_args: any[], ret: any) => {
                if (!ret) return ret;
                diagnostics.renderPatchFired++;
                diagnostics.revealFound = revealBehindMessages(ret);
                return (
                    <>
                        <TopographicBackground />
                        {ret}
                    </>
                );
            });
        }

        unregisterCommand = registerCommand({
            name: "topo-status",
            displayName: "topo-status",
            description: "Check whether Topographic Chat Background is actually hooked in.",
            displayDescription: "Check whether Topographic Chat Background is actually hooked in.",
            options: [],
            applicationId: "-1",
            inputType: 0,
            type: 1,
            execute: () => ({ content: statusReport() }),
        } as any);

        logger.log("[TopographicChatBackground] Loaded.");
    },
    onUnload: () => {
        unpatch?.();
        unpatch = undefined;
        unregisterCommand?.();
        unregisterCommand = undefined;
    },
    settings: Settings,
};
