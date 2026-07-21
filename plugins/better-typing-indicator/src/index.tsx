import { findByProps, findByStoreName } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { showToast } from "@vendetta/ui/toasts";

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

let unpatch: (() => void) | undefined;

export default {
    onLoad: () => {
        ensureDefaults();

        const mod = findByProps("TypingIndicator") as any;
        if (!mod?.TypingIndicator) {
            logger.error("[BetterTypingIndicator] Could not find TypingIndicator to patch.");
            return;
        }

        unpatch = instead("TypingIndicator", mod, (args: any[], origFunc: Function) => {
            if (storage.hideTypingIndicator) return null;

            try {
                const props = args[0];
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

                const users = visibleIds.map((id: string) => UserStore?.getUser?.(id));
                const gotUserCount = users.filter(Boolean).length;

                const names = users.slice(0, 3).map((u: any) => u?.globalName || u?.username || "Someone");

                const avatarUris: string[] = users.map((u: any) => u?.getAvatarURL?.()).filter(Boolean);

                if (avatarUris.length === 0) {
                    // Distinguishes "getUser returned nothing for these IDs"
                    // (Discord may not have cached users you haven't directly
                    // interacted with) from "getUser worked but getAvatarURL
                    // didn't" - single short toast, only on this specific
                    // empty-avatar case, not on every render.
                    showToast(`[BTI] typers=${typerIds.length} gotUser=${gotUserCount}/${visibleIds.length} avatars=0`);
                }

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
                const msg = "[BTI] render error: " + (e && (e as Error).message ? (e as Error).message : String(e));
                logger.error(msg, e);
                showToast(msg);
                return origFunc(...args);
            }
        });

        logger.log("[BetterTypingIndicator] Loaded.");
    },
    onUnload: () => {
        unpatch?.();
        unpatch = undefined;
    },
    settings: Settings,
};
