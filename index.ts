/**
 * Rocket.Chat channel plugin for OpenClaw
 * 
 * Provides integration with self-hosted Rocket.Chat instances via REST API
 * for sending messages and the Realtime/DDP API for receiving messages.
 */

import type { OpenclawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { rocketChatPlugin } from "./src/channel.js";
import { setRocketChatRuntime } from "./src/runtime.js";

// Re-export send/react functions for OpenClaw message tool
export { reactMessageRocketChat, sendMessageRocketChat } from "./src/rocketchat/send.js";

const plugin = {
  id: "openclaw-channel-rocketchat",
  name: "Rocket.Chat",
  description: "Rocket.Chat channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenclawPluginApi) {
    setRocketChatRuntime(api.runtime);
    api.registerChannel({ plugin: rocketChatPlugin });
  },
};

export default plugin;
