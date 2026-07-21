import { findByProps, findByStoreName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
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

let matchedOnce = false;

function makeRenderCustom(OriginalTypingIndicator: Function) {
    return function renderCustom(props: any): any {
        if (!matchedOnce) {
            matchedOnce = true;
            showToast("[BTI] element patch matched - rendering custom");
        }
        if (storage.hideTypingIndicator) return null;

        try {
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
            return OriginalTypingIndicator(props);
        }
    };
}

// Neither patching TypingIndicator's module export directly (never
// intercepted - whoever renders it must hold a reference captured at their
// own module-load time) nor searching MessagesConnected's render tree
// (never contains the element - it's rendered by something else entirely,
// unidentified) worked. This escalates to patching element CREATION itself:
// React.createElement, and separately the jsx/jsxs functions used by the
// newer automatic JSX transform (unclear which one Discord's bundle uses).
// Either way, `type` is always the first argument, so the same check works
// for both signatures - whichever one actually gets called for
// <TypingIndicator/>, wherever it's authored, gets caught here.
function patchElementCreation(mod: any, methodName: string, OriginalTypingIndicator: Function, RenderCustom: Function) {
    if (!mod || typeof mod[methodName] !== "function") return undefined;
    return instead(methodName, mod, (args: any[], orig: Function) => {
        if (args[0] === OriginalTypingIndicator) {
            args = [RenderCustom, ...args.slice(1)];
        }
        return orig(...args);
    });
}

let unpatches: Array<() => void> = [];

export default {
    onLoad: () => {
        ensureDefaults();

        const typingMod = findByProps("TypingIndicator") as any;
        const OriginalTypingIndicator = typingMod?.TypingIndicator;
        if (!OriginalTypingIndicator) {
            logger.error("[BetterTypingIndicator] Could not find TypingIndicator to patch.");
            return;
        }

        const RenderCustom = makeRenderCustom(OriginalTypingIndicator);

        const jsxRuntime = (findByProps("jsxs") || findByProps("jsx")) as any;

        unpatches = [
            patchElementCreation(React, "createElement", OriginalTypingIndicator, RenderCustom),
            patchElementCreation(jsxRuntime, "jsx", OriginalTypingIndicator, RenderCustom),
            patchElementCreation(jsxRuntime, "jsxs", OriginalTypingIndicator, RenderCustom),
        ].filter(Boolean) as Array<() => void>;

        logger.log(`[BetterTypingIndicator] Loaded, ${unpatches.length} element-creation patch(es) attached.`);
    },
    onUnload: () => {
        unpatches.forEach((fn) => fn());
        unpatches = [];
    },
    settings: Settings,
};
