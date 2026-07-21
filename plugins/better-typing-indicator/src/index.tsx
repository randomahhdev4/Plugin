import { findByDisplayName, findByProps, findByStoreName } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
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
            showToast("[BetterTypingIndicator] onLoad start");
            ensureDefaults();

            const typingMod = findByProps("TypingIndicator") as any;
            const OriginalTypingIndicator = typingMod?.TypingIndicator;
            diagnostics.moduleFound = !!OriginalTypingIndicator;
            showToast("[BetterTypingIndicator] TypingIndicator module found: " + diagnostics.moduleFound);

            const Messages = findByDisplayName("MessagesConnected") as any;
            diagnostics.messagesFound = !!Messages;
            showToast("[BetterTypingIndicator] MessagesConnected found: " + diagnostics.messagesFound);

            if (!OriginalTypingIndicator || !Messages) {
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
            showToast("[BetterTypingIndicator] patch attached");

            unregisterCommand = registerCommand({
                name: "typing-status",
                displayName: "typing-status",
                description: "Check whether Better Typing Indicator is actually hooked in.",
                displayDescription: "Check whether Better Typing Indicator is actually hooked in.",
                options: [],
                applicationId: "-1",
                inputType: 0,
                type: 1,
                // Command replies are unreliable in this environment
                // (confirmed separately: a correctly-built reply can still
                // never render), so status is shown via toast.
                execute: () => {
                    const summary = diagnostics.renderPatchFired === 0
                        ? "MessagesConnected render patch never fired"
                        : !diagnostics.elementFound
                            ? "render patch firing (" + diagnostics.renderPatchFired + "x), but TypingIndicator element never found in that tree"
                            : diagnostics.customRenderFired === 0
                                ? "element found and retyped, but custom render hasn't fired yet - type in a channel to trigger it"
                                : diagnostics.lastError
                                    ? "custom render firing, but erroring: " + diagnostics.lastError
                                    : "hooked, last visible count " + diagnostics.lastVisibleCount;
                    showToast("[BetterTypingIndicator] " + summary);
                    return undefined;
                },
            } as any);
            showToast("[BetterTypingIndicator] command registered");

            logger.log("[BetterTypingIndicator] Loaded.");
            showToast("[BetterTypingIndicator] onLoad complete");
        } catch (e) {
            const msg = "[BetterTypingIndicator] onLoad THREW: " + (e && (e as Error).message ? (e as Error).message : String(e));
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
