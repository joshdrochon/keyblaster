/**
 * Entry point. All it does is boot the game into #app and mark the container
 * booted, which is the scaffold smoke test's contract.
 *
 * Everything real is in src/game/boot.ts. src/engine stays reachable without
 * this file (CLAUDE.md): nothing here is imported by the engine.
 */

import { bootGame } from "./game/boot.js";

const app = document.getElementById("app");

bootGame({ parent: "app" })
  .then(() => {
    if (app) app.dataset["booted"] = "true";
  })
  .catch((error: unknown) => {
    console.error("[kb] boot failed", error);
    if (app) app.dataset["booted"] = "failed";
  });

export {};
