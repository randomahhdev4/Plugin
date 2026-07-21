import { findByDisplayName, findByProps, findByStoreName } from "@vendetta/metro";
import { ReactNative, clipboard } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { storage } from "@vendetta/plugin";
import { logger } from "@vendetta";
import { registerCommand } from "@vendetta/commands";
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

// Tracked so /typing-status can report real, observed facts.
const diagnostics = {
    moduleFound: false,
    messagesFound: false,
    renderPatchFired: 0,
    elementFound: false,
    customRenderFired: 0,
    lastError: "",
    lastVisibleCount: 0,
};

let unpatch: (() => void) | undefined;
let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        // Revenge's plugin loader appears to swallow onLoad exceptions
        // somewhere that never surfaces to the user (confirmed with Better
        // Eval: a command reply that's built correctly can still never be
        // shown). Toasts are the one channel that's been reliable through
        // every diagnostic this session, so onLoad is fully guarded and
        // checkpointed with them instead of trusting anything else.
        try {
            ensureDefaults();

            const typingMod = findByProps("TypingIndicator") as any;
            const OriginalTypingIndicator = typingMod?.TypingIndicator;
            diagnostics.moduleFound = !!OriginalTypingIndicator;

            const Messages = findByDisplayName("MessagesConnected") as any;
            diagnostics.messagesFound = !!Messages;

            if (!OriginalTypingIndicator || !Messages) {
                // Several rapid-fire toasts were clipping/overwriting each
                // other rather than displaying in full, which is what made
                // earlier diagnostics look inconsistent. One short toast
                // per outcome instead.
                showToast("[BTI] load failed: mod=" + diagnostics.moduleFound + " msg=" + diagnostics.messagesFound);
                logger.error("[BetterTypingIndicator] Missing a required target, aborting patch.");
                return;
            }

            function renderCustom(props: any): any {
                diagnostics.customRenderFired++;
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
                    return OriginalTypingIndicator(props);
                }
            }

            // Patching the TypingIndicator module export directly doesn't
            // work if whoever renders <TypingIndicator/> already captured a
            // local reference to the original function at their own module
            // load time (a plain function export, unlike a class's
            // prototype method, has no guaranteed fresh lookup on every
            // render). Instead, patch MessagesConnected - already proven
            // reliable by the other plugin in this repo - and find the
            // actual <TypingIndicator/> ELEMENT INSTANCE inside its
            // rendered output, mutating its `.type` directly. React reads
            // `.type` off the element at reconciliation time, not off any
            // external reference, so this works regardless of the binding
            // question above.
            unpatch = after("render", Messages, (_args: any[], ret: any) => {
                diagnostics.renderPatchFired++;
                try {
                    const typingElement = findInReactTree(ret, (x: any) => x && x.type === OriginalTypingIndicator);
                    if (typingElement) {
                        diagnostics.elementFound = true;
                        typingElement.type = renderCustom;
                    }
                } catch (e) {
                    diagnostics.lastError = e && (e as Error).message ? (e as Error).message : String(e);
                    logger.error("[BetterTypingIndicator] Failed to locate/patch typing element.", e);
                }
                return ret;
            });

            unregisterCommand = registerCommand({
                name: "typing-status",
                displayName: "typing-status",
                description: "Copy a full diagnostic report to your clipboard.",
                displayDescription: "Copy a full diagnostic report to your clipboard.",
                options: [],
                applicationId: "-1",
                inputType: 0,
                type: 1,
                // Both command replies and rapid/long toasts turned out to
                // be unreliable in this environment (replies never render
                // at all; toasts clip or get replaced by the next one
                // before they're readable). Clipboard has no such limit -
                // paste the result directly instead of reading it on-screen.
                execute: () => {
                    const lines = [
                        "moduleFound=" + diagnostics.moduleFound,
                        "messagesFound=" + diagnostics.messagesFound,
                        "renderPatchFired=" + diagnostics.renderPatchFired,
                        "elementFound=" + diagnostics.elementFound,
                        "customRenderFired=" + diagnostics.customRenderFired,
                        "lastVisibleCount=" + diagnostics.lastVisibleCount,
                        "lastError=" + (diagnostics.lastError || "none"),
                    ];
                    clipboard.setString(lines.join("\n"));
                    showToast("[BTI] status copied to clipboard");
                    return undefined;
                },
            } as any);

            logger.log("[BetterTypingIndicator] Loaded.");
            showToast("[BTI] loaded ok");
        } catch (e) {
            const msg = "[BTI] onLoad threw: " + (e && (e as Error).message ? (e as Error).message : String(e));
            logger.error(msg, e);
            showToast(msg);
        }
    },
    onUnload: () => {
        unpatch?.();
        unpatch = undefined;
        unregisterCommand?.();
        unregisterCommand = undefined;
    },
    settings: Settings,
};
