import { findByName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/storage";
import { logger } from "@vendetta";

import Settings from "./Settings";
import { DEFAULT_SETTINGS } from "./settings-model";

const { View, Animated, Easing, StyleSheet } = ReactNative;

// Fill in any missing keys on first run so the UI + renderer always have values.
function ensureDefaults() {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (storage[key] === undefined) storage[key] = DEFAULT_SETTINGS[key];
    }
}

/**
 * A single "peak": a set of concentric rings. Stacking a few peaks of rings
 * reads as a topographic contour map, and it is cheap (a handful of Views),
 * unlike a per-frame canvas which React Native does not offer.
 */
function Peak({ x, y, rings, spacing, color, opacity }) {
    const items = [];
    for (let i = rings; i >= 1; i--) {
        const size = i * spacing;
        items.push(
            <View
                key={i}
                style={{
                    position: "absolute",
                    left: -size / 2,
                    top: -size / 2,
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderWidth: 1,
                    borderColor: color,
                    opacity,
                }}
            />,
        );
    }
    return <View style={{ position: "absolute", left: `${x}%`, top: `${y}%` }}>{items}</View>;
}

function TopographicBackground() {
    ensureDefaults();
    const drift = React.useRef(new Animated.Value(0)).current;

    const density = storage.contourDensity ?? DEFAULT_SETTINGS.contourDensity;
    const speed = storage.driftSpeed ?? DEFAULT_SETTINGS.driftSpeed;
    const opacity = storage.lineOpacity ?? DEFAULT_SETTINGS.lineOpacity;
    const color = storage.lineColor ?? DEFAULT_SETTINGS.lineColor;
    const spacing = 26;

    React.useEffect(() => {
        // driftSpeed is a small fraction; map it onto a slow, looping duration.
        const duration = Math.max(4000, 60000 * (1 - Math.min(0.95, speed * 400)));
        const loop = Animated.loop(
            Animated.timing(drift, {
                toValue: 1,
                duration,
                easing: Easing.linear,
                useNativeDriver: true,
            }),
        );
        loop.start();
        return () => loop.stop();
    }, [speed]);

    const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 40] });
    const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 24] });

    // A few peaks spread across the view give the layered-contour look.
    const peaks = [
        { x: 18, y: 22 },
        { x: 72, y: 34 },
        { x: 40, y: 68 },
        { x: 85, y: 80 },
    ];

    return (
        <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { transform: [{ translateX }, { translateY }], overflow: "hidden" }]}
        >
            {peaks.map((p, i) => (
                <Peak
                    key={i}
                    x={p.x}
                    y={p.y}
                    rings={density}
                    spacing={spacing}
                    color={color}
                    opacity={opacity}
                />
            ))}
        </Animated.View>
    );
}

// Discord's chat area component. The exact export name drifts between Discord
// builds, so try a few known candidates and patch the first that resolves.
const CHAT_CANDIDATES = ["MessagesWrapperConnected", "MessagesWrapper", "ChannelChat", "Chat"];

let unpatch: (() => void) | undefined;

export default {
    onLoad: () => {
        ensureDefaults();

        let target: any;
        let found: string | undefined;
        for (const name of CHAT_CANDIDATES) {
            target = findByName(name, false);
            if (target?.default || typeof target === "function") {
                found = name;
                break;
            }
        }

        if (!target) {
            logger.error(
                `[TopographicChatBackground] Could not locate a chat component to patch. Tried: ${CHAT_CANDIDATES.join(", ")}. The plugin loaded, but has nothing to draw on.`,
            );
            return;
        }

        const component = target.default ? target : { default: target };

        // Prepend our background as the first sibling so it renders *behind*
        // the real chat content (later siblings paint on top in RN).
        unpatch = after("default", component, (_args, res) => {
            if (!res) return res;
            return (
                <View style={{ flex: 1 }}>
                    <TopographicBackground />
                    {res}
                </View>
            );
        });

        logger.log(`[TopographicChatBackground] Loaded, patched "${found}".`);
    },
    onUnload: () => {
        unpatch?.();
        unpatch = undefined;
    },
    settings: Settings,
};
