import { logger } from "@vendetta";
import { registerCommand } from "@vendetta/commands";

import Settings from "./Settings";

// Diagnostic-only build: no chat patching, no svg, no metro lookups — just
// proof that onLoad ran and the plugin is actually enabled. Once this
// installs and enables cleanly, the real background-rendering logic gets
// layered back on top.

let unregisterCommand: (() => void) | undefined;

export default {
    onLoad: () => {
        unregisterCommand = registerCommand({
            name: "topo-status",
            displayName: "topo-status",
            description: "Confirm Topographic Chat Background is loaded and enabled.",
            displayDescription: "Confirm Topographic Chat Background is loaded and enabled.",
            options: [],
            applicationId: "-1",
            inputType: 0,
            type: 1,
            execute: () => ({
                content: "✅ Topographic Chat Background is loaded and enabled (diagnostic-only build — no background rendering yet).",
            }),
        } as any);

        logger.log("[TopographicChatBackground] Loaded (diagnostic-only build).");
    },
    onUnload: () => {
        unregisterCommand?.();
        unregisterCommand = undefined;
    },
    settings: Settings,
};
