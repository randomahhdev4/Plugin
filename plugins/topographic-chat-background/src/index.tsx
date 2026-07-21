import { findByDisplayName, findByProps } from "@vendetta/metro";
import { React, ReactNative, chroma } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { registerCommand } from "@vendetta/commands";

import Settings from "./Settings";
import { DEFAULT_SETTINGS, ensureDefaults } from "./settings-model";
import { buildContourPaths } from "./contours";

const { Animated, Easing, Dimensions, StyleSheet } = ReactNative;

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

// The message list re-renders on basically every chat event (new messages,
// typing indicators, read state, ...). Anything expensive done directly in
// TopographicBackground's render runs on every one of those, not just when
// something we actually care about changes - that was the main source of
// lag. Memoizing the SVG output and the noise-field generation keeps normal
// chat activity from re-triggering any of that work.
function TopographicBackground() {
    // getSvg() can flip from unavailable to available between renders of the
    // SAME mounted instance (it retries on failure). Hooks must never be
    // conditional on that, or React throws "rendered more/fewer hooks than
    // previous render" the moment it resolves mid-lifecycle. So every hook
    // below always runs unconditionally; only the JSX return is conditional.
    ensureDefaults();

    const density = storage.contourDensity ?? DEFAULT_SETTINGS.contourDensity;
    const speed = storage.driftSpeed ?? DEFAULT_SETTINGS.driftSpeed;
    const opacity = storage.lineOpacity ?? DEFAULT_SETTINGS.lineOpacity;
    const color = storage.lineColor ?? DEFAULT_SETTINGS.lineColor;

    const { width, height } = Dimensions.get("window");
    const margin = 0.25;
    const fieldWidth = width * (1 + margin * 2);
    const fieldHeight = height * (1 + margin * 2);

    // 0 (slowest) .. 1 (fastest), reused for both the pan speed and how
    // often the field regenerates, so the "speed" setting feels coherent.
    const speedT = Math.min(1, Math.max(0, (speed - 0.0001) / 0.0019));

    const drift = React.useRef(new Animated.Value(0)).current;
    const crossfade = React.useRef(new Animated.Value(0)).current;
    const seedRef = React.useRef(1);
    const currentPathsRef = React.useRef<string[] | null>(null);
    const nextPathsRef = React.useRef<string[] | null>(null);
    const [, forceTick] = React.useState(0);

    if (!currentPathsRef.current) {
        currentPathsRef.current = buildContourPaths(fieldWidth, fieldHeight, density, 30, 0, 0);
        nextPathsRef.current = buildContourPaths(fieldWidth, fieldHeight, density, 30, 500, 500);
    }

    // Regenerate the field periodically instead of only panning a static
    // one - this is what makes it actually flow/morph rather than just
    // slide. Kept infrequent (8-18s depending on speed) since marching
    // squares + fbm noise, while cheap, isn't free - doing it every frame
    // would reintroduce the lag this pass is fixing.
    React.useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const regenInterval = 18000 - speedT * 10000;
        const crossfadeDuration = 4000;

        function cycle() {
            crossfade.setValue(0);
            Animated.timing(crossfade, {
                toValue: 1,
                duration: crossfadeDuration,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (cancelled || !finished) return;
                currentPathsRef.current = nextPathsRef.current;
                const s = seedRef.current++;
                nextPathsRef.current = buildContourPaths(fieldWidth, fieldHeight, density, 30, s * 41, s * 67);
                forceTick((t) => t + 1);
                timer = setTimeout(cycle, regenInterval);
            });
        }

        timer = setTimeout(cycle, regenInterval);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [fieldWidth, fieldHeight, density, speedT]);

    React.useEffect(() => {
        const duration = 20000 - speedT * 17000;
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(drift, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
                Animated.timing(drift, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [speedT]);

    const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -width * margin] });
    const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -height * margin * 0.6] });

    const svg = getSvg();

    const currentLayer = React.useMemo(() => {
        if (!svg) return null;
        const { Svg, Path } = svg;
        return (
            <Svg width={fieldWidth} height={fieldHeight}>
                {currentPathsRef.current!.map((d, i) => (
                    <Path key={i} d={d} stroke={color} strokeWidth={1.8} fill="none" />
                ))}
            </Svg>
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [svg, color, fieldWidth, fieldHeight, currentPathsRef.current]);

    const nextLayer = React.useMemo(() => {
        if (!svg) return null;
        const { Svg, Path } = svg;
        return (
            <Svg width={fieldWidth} height={fieldHeight}>
                {nextPathsRef.current!.map((d, i) => (
                    <Path key={i} d={d} stroke={color} strokeWidth={1.8} fill="none" />
                ))}
            </Svg>
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [svg, color, fieldWidth, fieldHeight, nextPathsRef.current]);

    if (!svg) return null;

    return (
        <Animated.View
            pointerEvents="none"
            style={{
                position: "absolute",
                left: -width * margin,
                top: -height * margin,
                width: fieldWidth,
                height: fieldHeight,
                transform: [{ translateX }, { translateY }],
            }}
        >
            <Animated.View style={{ position: "absolute", opacity: Animated.multiply(Animated.subtract(1, crossfade), opacity) }}>
                {currentLayer}
            </Animated.View>
            <Animated.View style={{ position: "absolute", opacity: Animated.multiply(crossfade, opacity) }}>{nextLayer}</Animated.View>
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
        lines.push("", "✅ Fully hooked. If you still don't see anything, check density/opacity in the plugin settings.");
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
                // A Fragment, not a wrapping View: an extra layout box here
                // was leaving a stuck gray layer behind after navigating
                // through settings, almost certainly by interfering with
                // how Discord positions its own overlays (e.g. the
                // settings-close backdrop) relative to this subtree.
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
