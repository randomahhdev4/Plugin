import { findByProps, findByStoreName } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { registerCommand } from "@vendetta/commands";

import Settings from "./Settings";
import { ensureDefaults } from "./settings-model";

const { View, Image, Text } = ReactNative;

const AVATAR_SIZE = 20;
const OVERLAP = AVATAR_SIZE * 0.5;

function formatLabel(names: string[], hasMore: boolean): string {
    if (hasMore || names.length > 3) return "Several people are typing...";
    if (names.length === 1) return `${names[0]} is typing...`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
    return `${names[0]}, ${names[1]}, and ${names[2]} are typing...`;
}

// Tracked so /typing-status can report real, observed facts. A plain
// function-component patch like this only works if whoever renders
// <TypingIndicator/> looks up the reference fresh each render rather than a
// cached local binding - unverified until it's actually seen firing.
const diagnostics = {
    moduleFound: false,
    patchFired: 0,
    lastError: "",
    lastVisibleCount: 0,
};

let unpatch: (() => void) | undefined;
let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        ensureDefaults();

        const mod = findByProps("TypingIndicator") as any;
        diagnostics.moduleFound = !!mod?.TypingIndicator;
        if (!mod?.TypingIndicator) {
            logger.error("[BetterTypingIndicator] Could not find TypingIndicator to patch.");
            return;
        }

        unpatch = instead("TypingIndicator", mod, (args: any[], origFunc: (...a: any[]) => any) => {
            diagnostics.patchFired++;
            if (storage.hideTypingIndicator) return null;

            // Everything risky happens synchronously in here, inside the try
            // block - including the hook call. This function IS what React
            // calls as the component (it replaced TypingIndicator via
            // `instead`), so calling a hook directly in it is valid, same as
            // any function component body. Wrapping a *returned JSX element*
            // in try/catch would NOT work - JSX only describes an element,
            // React invokes the actual component function later during
            // reconciliation, outside any try/catch here.
            try {
                const props = args[0];
                // TypingIndicator's single argument's exact shape is unknown
                // (Hermes strips source from release bytecode - no way to
                // introspect it directly). Try the common key names; if none
                // work, this throws and falls back to the original below.
                const channelId = props?.channelId ?? props?.channel?.id ?? props?.channel_id;
                if (!channelId) {
                    throw new Error("could not determine channelId, keys: " + JSON.stringify(Object.keys(props || {})));
                }

                const useTypingUserIds = findByProps("useTypingUserIds")?.useTypingUserIds;
                if (typeof useTypingUserIds !== "function") throw new Error("useTypingUserIds hook not found");

                const UserStore = findByStoreName("UserStore") as any;
                const currentUserId = UserStore?.getCurrentUser?.()?.id;

                const rawTyperIds: string[] = useTypingUserIds(channelId) || [];
                const typerIds = rawTyperIds.filter((id: string) => id !== currentUserId);

                if (!typerIds.length) return null;

                const visibleCount = typerIds.length <= 3 ? typerIds.length : Math.min(5, typerIds.length);
                const visibleIds = typerIds.slice(0, visibleCount);
                const hasMore = typerIds.length > visibleIds.length;

                const names = visibleIds.slice(0, 3).map((id: string) => {
                    const u = UserStore?.getUser?.(id);
                    return u?.globalName || u?.username || "Someone";
                });

                const avatarUris: string[] = visibleIds
                    .map((id: string) => UserStore?.getUser?.(id)?.getAvatarURL?.())
                    .filter(Boolean);

                diagnostics.lastVisibleCount = visibleIds.length;
                diagnostics.lastError = "";

                return (
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 4 }}>
                        <View style={{ flexDirection: "row", marginRight: 6 }}>
                            {avatarUris.map((uri, i) => (
                                <Image
                                    key={i}
                                    source={{ uri }}
                                    style={{
                                        width: AVATAR_SIZE,
                                        height: AVATAR_SIZE,
                                        borderRadius: AVATAR_SIZE / 2,
                                        marginLeft: i === 0 ? 0 : -OVERLAP,
                                        borderWidth: 1.5,
                                        borderColor: "#313338",
                                    }}
                                />
                            ))}
                        </View>
                        <Text style={{ color: "#949BA4", fontSize: 13 }}>{formatLabel(names, hasMore)}</Text>
                    </View>
                );
            } catch (e) {
                diagnostics.lastError = e && (e as Error).message ? (e as Error).message : String(e);
                logger.error("[BetterTypingIndicator] Custom render failed, falling back to original.", e);
                return origFunc(...args);
            }
        });

        unregisterCommand = registerCommand({
            name: "typing-status",
            displayName: "typing-status",
            description: "Check whether Better Typing Indicator is actually hooked in.",
            displayDescription: "Check whether Better Typing Indicator is actually hooked in.",
            options: [],
            applicationId: "-1",
            inputType: 0,
            type: 1,
            execute: () => {
                const lines = [
                    "**Better Typing Indicator — status**",
                    `TypingIndicator module found: ${diagnostics.moduleFound ? "yes" : "no"}`,
                    `Patch fired: ${diagnostics.patchFired} time(s)`,
                    `Last visible avatar count: ${diagnostics.lastVisibleCount}`,
                    `Last error: ${diagnostics.lastError || "none"}`,
                ];
                if (diagnostics.patchFired === 0) {
                    lines.push("", "⚠️ Patch has never fired. Either TypingIndicator isn't rendered from a fresh module lookup (patch can't intercept it), or you haven't seen anyone type since enabling.");
                } else if (diagnostics.lastError) {
                    lines.push("", "⚠️ The patch is firing but falling back to the original - see the error above (almost certainly the channelId prop-key guess).");
                } else {
                    lines.push("", "✅ Hooked and rendering successfully.");
                }
                return { content: lines.join("\n") };
            },
        } as any);

        logger.log("[BetterTypingIndicator] Loaded.");
    },
    onUnload: () => {
        unpatch?.();
        unpatch = undefined;
        unregisterCommand?.();
        unregisterCommand = undefined;
    },
    settings: Settings,
};
