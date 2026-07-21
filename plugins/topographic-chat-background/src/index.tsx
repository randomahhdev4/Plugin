import { findByDisplayName, findByProps } from "@vendetta/metro";
import { React, ReactNative, chroma } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { storage } from "@vendetta/storage";
import { logger } from "@vendetta";

import Settings from "./Settings";
import { DEFAULT_SETTINGS } from "./settings-model";
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

function ensureDefaults() {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (storage[key] === undefined) storage[key] = DEFAULT_SETTINGS[key];
    }
}

function TopographicBackground() {
    // Resolved once, before any hooks run, so the hook count per mount stays
    // constant regardless of whether react-native-svg is available.
    const svg = getSvg();
    if (!svg) return null;
    const { Svg, Path } = svg;

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
function revealBehindMessages(tree: any) {
    const messagesBg = findInReactTree(tree, (x: any) => x && "HACK_fixModalInteraction" in x.props && x?.props?.style);
    if (!messagesBg) return;

    const flattened = ReactNative.StyleSheet.flatten(messagesBg.props.style);
    const transparent = chroma(flattened.backgroundColor || "black").alpha(0).hex();
    messagesBg.props.style = ReactNative.StyleSheet.flatten([messagesBg.props.style, { backgroundColor: transparent }]);
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
            return <TopographicWrapper>{ret}</TopographicWrapper>;
        });

        logger.log("[TopographicChatBackground] Loaded.");
    },
    onUnload: () => {
        unpatch?.();
        unpatch = undefined;
    },
    settings: Settings,
};
