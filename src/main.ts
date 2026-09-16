/**
 * Boot entry. Scenes are registered in FIRST TASK 4 (screen-inventory order).
 * Kept deliberately thin: src/engine must stay reachable without this file.
 */
const app = document.getElementById("app");
if (app) {
  app.dataset["booted"] = "true";
}
export {};
