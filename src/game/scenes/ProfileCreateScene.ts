import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { MAX_NAME_LENGTH } from "@engine/persistence";
import { CONTENT_TOP, HEADING_EYEBROW_TOP, HEADING_TOP, MenuScene } from "@game/ui/MenuScene";
import {
  type Control,
  MenuButton,
  TextField,
  Tile,
} from "@game/ui/controls";
import { drawAvatar, drawShip } from "@game/ui/chrome";
import { SHADOW_HEIGHT, drawShadow } from "@game/render/shadow";
import { AVATARS, SHIPS, SKINS, shipDef } from "@game/ui/catalog";
import { unlocksForNewPilot } from "@engine/unlocks/index.js";
import { INK, SPACE, TYPE } from "@game/ui/theme";
import { uiText } from "@game/ui/text";
import type { MenuKey } from "@game/ui/i18n";
import {
  type CreateDraft,
  type CreateStep,
  ENABLED_CREATE_STEPS,
  backFromCreateStep,
  createStepAt,
  freshCreateDraft,
  nextCreateStep,
  showsCreateStepCounter,
} from "./support/createFlow";

/**
 * SCREEN 2 - PROFILE CREATE (inventory row "Profile create": name/avatar, ship
 * pick, ship name, skins locked/unlocked).
 *
 * D72: pick a pilot name and a mark, choose a ship, name the ship. C07: the
 * ship's default name comes from the string table (`profile.shipNameDefault`)
 * and is never written as a literal anywhere in this lane.
 *
 * "It must feel like choosing a pilot, not filling in a form", so it is three
 * short beats with Shadow present rather than one screen of labelled inputs:
 * who you are, what you fly, what you call it. Each beat has ONE question at
 * the top and the gallery underneath.
 *
 * ================== TRIMMED, NOT CUT DOWN ==================
 * Only the FIRST beat is live today. The ship gallery and the ship-name field
 * are unfinished and the owner asked for the flow to stop at what a child can
 * complete, so `support/createFlow.ts` holds the list of enabled beats and
 * everything below derives from it - the heading, whether a step counter is
 * drawn at all, whether the forward button says "Next" or takes off, and where
 * Esc goes. Both hidden beats are still built by the methods below, untouched
 * and still the only copy of themselves; restoring them is the one line marked
 * in that file. Nothing here may hard-code a beat index again, or the flow
 * comes back half-wired (tests/unit/scenes/profileCreateFlow.test.ts).
 *
 * WHAT THE TRIM COSTS, STATED: the four skins are drawn nowhere else in the
 * game, so while the ship beat is off a child cannot see them or what unlocks
 * them. Locked HULLS are still shown, with their unlock sentence, on the
 * Settings equip surface (UR-48).
 *
 * D43 / AC-18.2: THE ONLY TEXT ENTRY IS A NAME. There is no email field here,
 * and nothing on this screen can create one - `TextField` is the only typed
 * control in the kit and it is used exactly twice, for the pilot's name and the
 * ship's name. The persistence schema copies a fixed field list, so even an
 * upstream type change could not carry a contact field into storage.
 *
 * D79 / AC-6d.1b: four ships (1/3/5/7 beacons) and one skin each. A brand-new
 * pilot has ship-1 and no skins, so ships 2-4 and all four skins render DIM
 * with the sentence that unlocks them - visible, readable, focusable, not
 * choosable.
 */

export class ProfileCreateScene extends MenuScene {
  static readonly KEY = SCENE_KEYS.profileCreate;

  /**
   * EVERYTHING THIS SCREEN IS HOLDING, IN ONE OBJECT THAT IS REPLACED ON EVERY
   * MOUNT (UR-113).
   *
   * ================== THE DEFECT ==================
   * The name, the mark and the current beat were class fields with
   * initialisers - `private pilotName = ""` and friends. Phaser constructs each
   * scene ONCE (`boot.ts`: `game.scene.add(key, klass, false)`) and
   * `scene.start` re-runs `create()` on that same instance, so those
   * initialisers ran once per PAGE LOAD, not once per visit. The screen whose
   * entire purpose is a NEW pilot therefore opened holding the previous one's
   * answers: measured in a live session, re-entering after creating "Rin"
   * showed `pilotName: "Rin"`, `avatarId: "avatar-3"` and `step: 2` - a second
   * child was shown the first child's name, could ship it into a profile with
   * one key, and landed on the ship-name beat under a "Take Off" button.
   *
   * Nothing upstream carries it: `pilotName` is written by this file and read
   * by this file, and the store is only touched at `createProfile`. So the
   * draft is not "cleared on entry" - it does not survive entry. `build()` is
   * the only method Phaser re-runs, so that is where the new draft is made,
   * and the fields are gone so there is nowhere else for a value to hide.
   */
  private draft: CreateDraft = freshCreateDraft({
    avatarId: AVATARS[0]?.id ?? "avatar-1",
    shipId: SHIPS[0]?.id ?? "ship-1",
    shipName: "",
  });

  private stepNodes: Phaser.GameObjects.GameObject[] = [];
  private stepControls: Control[] = [];

  constructor() {
    super({ key: SCENE_KEYS.profileCreate });
  }

  protected build(): void {
    // C07: the default ship name is a TABLE VALUE, not a literal in a scene.
    this.draft = freshCreateDraft({
      avatarId: AVATARS[0]?.id ?? "avatar-1",
      shipId: SHIPS[0]?.id ?? "ship-1",
      shipName: this.t.t("profile.shipNameDefault"),
    });
    this.shadows.push(
      drawShadow(this, GAME_WIDTH - 230, GAME_HEIGHT - 300, "pointing", {
        scale: 210 / SHADOW_HEIGHT,
        reducedMotion: this.reducedMotion,
        facing: -1,
        depth: this.depth - 2,
      }),
    );
    this.addHint();
    this.renderStep();
  }

  // -- steps ----------------------------------------------------------------

  private clearStep(): void {
    for (const node of this.stepNodes) node.destroy();
    for (const control of this.stepControls) control.destroy();
    this.stepNodes = [];
    this.stepControls = [];
  }

  private track(...nodes: Phaser.GameObjects.GameObject[]): void {
    this.stepNodes.push(...nodes);
  }

  private renderStep(): void {
    this.clearStep();
    const step = this.currentStep();
    const heading = this.headingFor(step);
    this.setHeadingText(this.t.t(heading));

    // THE SHARED HEADING, NOT A SECOND ONE (UR-85).
    //
    // This screen drew its own title at y 116 so a step counter could sit above
    // it, while every other menu draws at `HEADING_TOP`. The picker and this
    // screen are consecutive, so a child watched the title jump 32 px on the
    // way in. The counter is an EYEBROW above the shared line now, which is
    // space the header band already had.
    //
    // The narrower wrap is still this screen's own: Shadow stands at the right
    // and a full-width title would run into him. That is a fact about this
    // screen's furniture, so it is a prop rather than a second drawing.
    //
    // THE COUNTER IS ONLY DRAWN WHEN IT IS TRUE. It said "Step 1 of 3" over a
    // trimmed flow with one beat in it - a line that told a child there were
    // two more screens coming and then took off instead. Both numbers come
    // from the enabled list now, so it cannot be wrong again; it is gone while
    // one beat is enabled and it returns with the others.
    if (showsCreateStepCounter()) {
      this.track(
        uiText(this, SPACE.gutter, HEADING_EYEBROW_TOP, this.t.t("ui.create.step", {
          n: this.draft.step + 1,
          total: ENABLED_CREATE_STEPS.length,
        }), {
          size: TYPE.caption,
          color: INK.textFaint,
          lang: this.uiStyle.lang,
          uppercase: this.uiStyle.uppercase,
          increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
        }).setDepth(this.depth),
      );
    }
    this.track(
      this.addHeading(heading, HEADING_TOP, GAME_WIDTH - SPACE.gutter * 2 - 300),
    );

    const controls =
      step === "pilot"
        ? this.buildPilotStep()
        : step === "ship"
          ? this.buildShipStep()
          : this.buildNameStep();

    this.stepControls = controls;
    this.setControls(controls);
  }

  /**
   * The beat being drawn. Falls back to the first ENABLED beat rather than to
   * beat zero of the full list, so an index that has gone stale - the flow
   * trimmed under a screen that was already open - lands on a beat that exists.
   */
  private currentStep(): CreateStep {
    return createStepAt(this.draft.step) ?? createStepAt(0) ?? "pilot";
  }

  private headingFor(step: CreateStep): MenuKey {
    if (step === "pilot") return "profile.pilotName";
    if (step === "ship") return "profile.chooseShip";
    return "profile.nameShip";
  }

  /** Beat 1: who is flying. A name field and six marks to pick from. */
  private buildPilotStep(): Control[] {
    const controls: Control[] = [];
    const width = Math.min(760, GAME_WIDTH - SPACE.gutter * 2);

    const field = new TextField(
      this,
      this.uiStyle,
      "create.name",
      SPACE.gutter,
      CONTENT_TOP,
      this.depth,
      {
        label: this.t.t("ui.create.typeName"),
        width,
        value: this.draft.pilotName,
        maxLength: MAX_NAME_LENGTH,
        placeholder: this.t.t("profile.pilotName"),
        onChange: (value) => {
          this.draft.pilotName = value;
        },
      },
    );
    controls.push(field);

    this.track(
      uiText(this, SPACE.gutter, 420, this.t.t("ui.create.chooseLook"), {
        size: TYPE.body,
        color: INK.textDim,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      }).setDepth(this.depth),
    );

    const tileW = 220;
    AVATARS.forEach((avatar, i) => {
      const tile = new Tile(
        this,
        this.uiStyle,
        `create.avatar.${avatar.id}`,
        SPACE.gutter + i * (tileW + SPACE.gap),
        480,
        this.depth,
        {
          label: this.t.t(avatar.nameKey),
          width: tileW,
          glyphHeight: 120,
          selected: this.draft.avatarId === avatar.id,
          glyph: (scene, x, y) =>
            drawAvatar(scene, x, y, 108, avatar.id, this.uiStyle.accent),
          onPress: () => {
            this.draft.avatarId = avatar.id;
            for (const c of this.stepControls) {
              if (c instanceof Tile && c.id.startsWith("create.avatar.")) {
                c.setSelected(c.id === `create.avatar.${avatar.id}`);
              }
            }
            this.publish();
          },
        },
      );
      controls.push(tile);
    });

    controls.push(this.forwardButton(760));
    return controls;
  }

  /** Beat 2: what you fly. Four hulls, four skins, locks explained in words. */
  private buildShipStep(): Control[] {
    const controls: Control[] = [];
    // A pilot who does not exist yet owns exactly what `blankProfile` grants:
    // their starting hull and no skins. Unlocks are per profile (D79), so a new
    // pilot never inherits another pilot's ships - which is what this line used
    // to do, reading `app.profile()`, i.e. whichever pilot is currently active.
    // Harmless while nothing could fill those lists; a younger sibling opening
    // the game on their brother's save the moment `applyUnlocks` went live.
    const { ships: unlockedShips, skins: unlockedSkins } = unlocksForNewPilot();

    const tileW = 260;
    SHIPS.forEach((ship, i) => {
      const locked = !unlockedShips.includes(ship.id);
      const tile = new Tile(
        this,
        this.uiStyle,
        `create.ship.${ship.id}`,
        SPACE.gutter + i * (tileW + SPACE.gap),
        CONTENT_TOP,
        this.depth,
        {
          label: this.t.t(ship.nameKey),
          detail: locked
            ? this.t.t(ship.unlockKey, { n: ship.unlockBeacons })
            : undefined,
          width: tileW,
          glyphHeight: 190,
          locked,
          selected: this.draft.shipId === ship.id,
          glyph: (scene, x, y) =>
            drawShip(scene, x, y, 150, ship.colors, locked),
          onPress: () => this.selectShip(ship.id),
        },
      );
      controls.push(tile);
    });

    this.track(
      uiText(this, SPACE.gutter, 620, this.t.t("ui.create.skins"), {
        size: TYPE.body,
        color: INK.textDim,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      }).setDepth(this.depth),
    );

    SKINS.forEach((skin, i) => {
      const locked = !unlockedSkins.includes(skin.id);
      const tile = new Tile(
        this,
        this.uiStyle,
        `create.skin.${skin.id}`,
        SPACE.gutter + i * (tileW + SPACE.gap),
        680,
        this.depth,
        {
          label: this.t.t(skin.nameKey),
          // The unlock sentence is shown whether or not it is locked, because
          // the point of a mastery reward is that you can see what earns it
          // (D73, and Deci/Koestner/Ryan on informational rewards).
          detail: this.t.t(skin.unlockKey),
          width: tileW,
          glyphHeight: 150,
          locked,
          selected: !locked && this.draft.shipId === skin.shipId,
          glyph: (scene, x, y) =>
            drawShip(scene, x, y, 120, skin.colors, locked),
          onPress: () => this.selectShip(skin.shipId),
        },
      );
      controls.push(tile);
    });

    controls.push(this.forwardButton(900));
    return controls;
  }

  private selectShip(shipId: string): void {
    this.draft.shipId = shipId;
    for (const c of this.stepControls) {
      if (c instanceof Tile && c.id.startsWith("create.ship.")) {
        c.setSelected(c.id === `create.ship.${shipId}`);
      }
    }
    this.publish();
  }

  /** Beat 3: what you call it. Pre-filled with the default (C07). */
  private buildNameStep(): Control[] {
    const controls: Control[] = [];
    const width = Math.min(760, GAME_WIDTH - SPACE.gutter * 2);
    const ship = shipDef(this.draft.shipId);

    this.track(
      drawShip(this, GAME_WIDTH * 0.66, 470, 320, ship.colors, false).setDepth(
        this.depth,
      ),
    );

    const field = new TextField(
      this,
      this.uiStyle,
      "create.shipName",
      SPACE.gutter,
      280,
      this.depth,
      {
        label: this.t.t("ui.create.typeShipName"),
        width,
        value: this.draft.shipName,
        maxLength: MAX_NAME_LENGTH,
        placeholder: this.t.t("profile.shipNameDefault"),
        onChange: (value) => {
          this.draft.shipName = value;
        },
      },
    );
    controls.push(field);

    controls.push(this.forwardButton(470));
    return controls;
  }

  /**
   * THE ONE BUTTON THAT MOVES THIS SCREEN ON, IN BOTH OF ITS MOODS.
   *
   * A beat with another beat after it carries "Next". The LAST enabled beat
   * carries the confirm - the same "Take Off" the ship-name beat always had,
   * same id, same size, same string table entry (there is no new copy here:
   * `ui.create.launch` is already translated three ways). Which mood it is in
   * is `nextCreateStep`'s answer, never a beat index, so with the flow trimmed
   * to one beat the confirm lands on "choose your look" by construction rather
   * than by a second rule that could disagree.
   *
   * THE ID CARRIES THE BEAT on a "Next", because one shared id would make the
   * beats indistinguishable to anything reading the screen - a screen reader
   * announcing the same control, or a test that cannot tell whether the beat it
   * asked for has been drawn yet.
   *
   * It is a plain `MenuButton` in the scene's own focus order, so the focus
   * behaviour every other control on this screen has (UR-110/111,
   * `ui/focusPop.ts`) is the behaviour it has: nothing about the confirm is
   * forked.
   */
  private forwardButton(y: number): MenuButton {
    const commits = nextCreateStep(this.draft.step) === "commit";
    return new MenuButton(
      this,
      this.uiStyle,
      commits ? "create.launch" : `create.next.${this.draft.step}`,
      SPACE.gutter,
      y,
      this.depth,
      commits
        ? {
            label: this.t.t("ui.create.launch"),
            size: TYPE.heading,
            minWidth: 360,
            onPress: () => this.advance(),
          }
        : {
            label: this.t.t("ui.create.next"),
            minWidth: 280,
            onPress: () => this.advance(),
          },
    );
  }

  private advance(): void {
    const next = nextCreateStep(this.draft.step);
    if (next === "commit") {
      this.createProfile();
      return;
    }
    this.draft.step = next;
    this.renderStep();
  }

  /**
   * Commit. `createProfile` also selects the new pilot (the store does that on
   * purpose so the caller does not need a second round trip), and `flush`
   * writes immediately rather than waiting out the 250 ms debounce - a child
   * who closes the tab the moment they take off still has a pilot.
   */
  private createProfile(): void {
    const store = this.app.services.store;
    const created = store.createProfile({
      // Blank falls back to the schema's default name; no validation dialog,
      // because "you did it not-right" is the one thing this game never says.
      name: this.draft.pilotName.trim(),
      avatar: this.draft.avatarId,
      shipId: this.draft.shipId,
      shipName: this.draft.shipName.trim() || this.t.t("profile.shipNameDefault"),
    });
    this.app.services.context.profileId = created.id;
    store.flush();
    // Earth is the launchpad and the tutorial beat (D57), so a brand-new pilot
    // goes there rather than to the map.
    if (!this.goTo(SCENE_KEYS.earthActivation)) this.goTo(SCENE_KEYS.map);
  }

  /**
   * Esc steps back through the ENABLED beats, then out to the picker
   * (AC-18.1). With one beat enabled that is a single press to leave, which is
   * the whole of "the screen stays keyboard-returnable" on a one-screen flow.
   */
  protected goBack(): void {
    const back = backFromCreateStep(this.draft.step);
    if (back === "exit") {
      this.goTo(SCENE_KEYS.profilePicker);
      return;
    }
    this.draft.step = back;
    this.renderStep();
  }

  override snapshot(): Record<string, unknown> {
    return {
      ...super.snapshot(),
      // The index into the ENABLED beats, and the beat's name beside it - an
      // index alone stopped meaning the same thing the moment two beats could
      // be hidden, and a test that reads `step: 0` should be able to see WHICH
      // beat that is.
      step: this.draft.step,
      stepName: this.currentStep(),
      enabledSteps: [...ENABLED_CREATE_STEPS],
      pilotName: this.draft.pilotName,
      avatarId: this.draft.avatarId,
      shipId: this.draft.shipId,
      shipName: this.draft.shipName,
    };
  }
}
