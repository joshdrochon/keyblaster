import { describe, expect, it } from "vitest";
import { FocusList } from "@game/ui/focus";

/**
 * `onChange` WAS A SLOT, AND THE LAST CALLER SILENTLY WON.
 *
 * `ConfirmDialog` registers `paintRing` on its list; `PauseScene` then
 * registered `publish` on the same list, replacing it. The dialog's focus ring
 * stopped following focus: measured on a built page, focus moved
 * `dialog.cancel` -> `dialog.confirm` while the ring's box stayed at x 790 -
 * the cancel button's - and the confirm button at x 1056 never showed one.
 *
 * Nothing threw and no test failed. A screen lost its selection outline and the
 * only symptom was a player saying one button "doesn't have the yellow
 * outline". That is why this is asserted rather than left to the two callers to
 * remember about each other.
 */
function item(id: string) {
  return {
    id,
    focused: false,
    setFocused(v: boolean) {
      this.focused = v;
    },
    activate() {},
  };
}

describe("FocusList.onChange keeps every listener", () => {
  it("notifies all registrations, not just the most recent", () => {
    const list = new FocusList();
    const seen: string[] = [];
    list.setItems([item("a"), item("b")] as never);
    list.onChange(() => seen.push("first"));
    list.onChange(() => seen.push("second"));
    seen.length = 0;
    list.focus("b");
    expect(
      seen,
      "a later onChange replaced an earlier one, so one owner stopped being told",
    ).toEqual(["first", "second"]);
  });

  it("still notifies when focus moves back", () => {
    const list = new FocusList();
    let count = 0;
    list.setItems([item("a"), item("b")] as never);
    list.onChange(() => (count += 1));
    count = 0;
    list.focus("b");
    list.focus("a");
    expect(count).toBe(2);
  });
});
