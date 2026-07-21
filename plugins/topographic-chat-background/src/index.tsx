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

const { View, Animated, Easing, Dimensions } = ReactNative;

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

function TopographicBackground() {
    // getSvg() can flip from unavailable to available between renders of the
    // SAME mounted instance (it retries on failure). Hooks must never be
    // conditional on that, or React throws "rendered more/fewer hooks than
    // previous render" the moment it resolves mid-lifecycle - which is
    // exactly what was crashing the patched chat render after enabling.
    // So every hook below always runs; only the JSX return is conditional.
    ensureDefaults();
    const drift = React.useRef(new Animated.Value(0)).current;

    const density = storage.contourDensity ?? DEFAULT_SETTINGS.contourDensity;
    const speed = storage.driftSpeed ?? DEFAULT_SETTINGS.driftSpeed;
    const opacity = storage.lineOpacity ?? DEFAULT_SETTINGS.lineOpacity;
    const color = storage.lineColor ?? DEFAULT_SETTINGS.lineColor;

    const { width, height } = Dimensions.get("window");
    const margin = 0.25;
    const fieldWidth = width * (1 + margin * 2);
    const fieldHeight = height * (1 + margin * 2);

    const paths = React.useMemo(
        () => buildContourPaths(fieldWidth, fieldHeight, density, 34, 0, 0),
        [fieldWidth, fieldHeight, density],
    );

    React.useEffect(() => {
        const duration = Math.max(6000, 90000 * (1 - Math.min(0.95, speed * 400)));
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(drift, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
                Animated.timing(drift, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [speed]);

    const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -width * margin] });
    const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -height * margin * 0.6] });

    const svg = getSvg();
    if (!svg) return null;
    const { Svg, Path } = svg;

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
            <Svg width={fieldWidth} height={fieldHeight}>
                {paths.map((d, i) => (
                    <Path key={i} d={d} stroke={color} strokeWidth={1.1} fill="none" opacity={opacity} />
                ))}
            </Svg>
        </Animated.View>
    );
}

function TopographicWrapper({ children }: { children: React.ReactNode }) {
    return (
        <View style={{ flex: 1, overflow: "hidden" }}>
            <TopographicBackground />
            {children}
        </View>
    );
}

// The message list itself paints an opaque background; without lowering that
// layer's alpha, anything drawn behind it (like our contours) stays hidden.
// This mirrors Revenge's own built-in "custom chat background" patch.
function revealBehindMessages(tree: any): boolean {
    const messagesBg = findInReactTree(tree, (x: any) => x && "HACK_fixModalInteraction" in x.props && x?.props?.style);
    if (!messagesBg) return false;

    const flattened = ReactNative.StyleSheet.flatten(messagesBg.props.style);
    const transparent = chroma(flattened.backgroundColor || "black").alpha(0).hex();
    messagesBg.props.style = ReactNative.StyleSheet.flatten([messagesBg.props.style, { backgroundColor: transparent }]);
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
                return <TopographicWrapper>{ret}</TopographicWrapper>;
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
