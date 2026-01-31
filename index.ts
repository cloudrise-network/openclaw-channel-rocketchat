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

const plugin = {
  id: "rocketchat",
  name: "Rocket.Chat",
  description: "Rocket.Chat channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenclawPluginApi) {
    setRocketChatRuntime(api.runtime);
    api.registerChannel({ plugin: rocketChatPlugin });
  },
};

export default plugin;
