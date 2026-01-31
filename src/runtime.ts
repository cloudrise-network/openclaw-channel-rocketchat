/**
 * Runtime context for Rocket.Chat plugin
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk";

let rocketChatRuntime: RuntimeEnv | null = null;

export function setRocketChatRuntime(runtime: RuntimeEnv): void {
  rocketChatRuntime = runtime;
}

export function getRocketChatRuntime(): RuntimeEnv {
  if (!rocketChatRuntime) {
    // Return a minimal runtime for standalone usage
    return {
      log: console.log,
      error: console.error,
      exit: (code: number): never => {
        throw new Error(`exit ${code}`);
      },
    } as RuntimeEnv;
  }
  return rocketChatRuntime;
}
