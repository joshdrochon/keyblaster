import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from "@game/sceneKeys";
import { MAX_NAME_LENGTH } from "@engine/persistence";
import { MenuScene } from "@game/ui/MenuScene";
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

type Step = 0 | 1 | 2;

export class ProfileCreateScene extends MenuScene {
  static readonly KEY = SCENE_KEYS.profileCreate;

  private step: Step = 0;
  private pilotName = "";
  private avatarId = AVATARS[0]?.id ?? "avatar-1";
  private shipId = SHIPS[0]?.id ?? "ship-1";
  private shipName = "";
  private stepNodes: Phaser.GameObjects.GameObject[] = [];
  private stepControls: Control[] = [];

  constructor() {
    super({ key: SCENE_KEYS.profileCreate });
  }

  protected build(): void {
    // C07: the default ship name is a TABLE VALUE, not a literal in a scene.
    this.shipName = this.t.t("profile.shipNameDefault");
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
    const heading = this.headingFor(this.step);
    this.setHeadingText(this.t.t(heading));

    this.track(
      uiText(this, SPACE.gutter, 74, this.t.t("ui.create.step", {
        n: this.step + 1,
        total: 3,
      }), {
        size: TYPE.caption,
        color: INK.textFaint,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
      }).setDepth(this.depth),
      uiText(this, SPACE.gutter, 116, this.t.t(heading), {
        size: TYPE.display,
        lang: this.uiStyle.lang,
        uppercase: this.uiStyle.uppercase,
        increasedLetterSpacing: this.uiStyle.increasedLetterSpacing,
        wrapWidth: GAME_WIDTH - SPACE.gutter * 2 - 300,
      }).setDepth(this.depth),
    );

    const controls =
      this.step === 0
        ? this.buildPilotStep()
        : this.step === 1
          ? this.buildShipStep()
          : this.buildNameStep();

    this.stepControls = controls;
    this.setControls(controls);
  }

  private headingFor(step: Step): MenuKey {
    if (step === 0) return "profile.pilotName";
    if (step === 1) return "profile.chooseShip";
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
      250,
      this.depth,
      {
        label: this.t.t("ui.create.typeName"),
        width,
        value: this.pilotName,
        maxLength: MAX_NAME_LENGTH,
        placeholder: this.t.t("profile.pilotName"),
        onChange: (value) => {
          this.pilotName = value;
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
          selected: this.avatarId === avatar.id,
          glyph: (scene, x, y) =>
            drawAvatar(scene, x, y, 108, avatar.id, this.uiStyle.accent),
          onPress: () => {
            this.avatarId = avatar.id;
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

    controls.push(this.nextButton(this.t.t("ui.create.next"), 760));
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
        250,
        this.depth,
        {
          label: this.t.t(ship.nameKey),
          detail: locked
            ? this.t.t(ship.unlockKey, { n: ship.unlockBeacons })
            : undefined,
          width: tileW,
          glyphHeight: 190,
          locked,
          selected: this.shipId === ship.id,
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
          selected: !locked && this.shipId === skin.shipId,
          glyph: (scene, x, y) =>
            drawShip(scene, x, y, 120, skin.colors, locked),
          onPress: () => this.selectShip(skin.shipId),
        },
      );
      controls.push(tile);
    });

    controls.push(this.nextButton(this.t.t("ui.create.next"), 900));
    return controls;
  }

  private selectShip(shipId: string): void {
    this.shipId = shipId;
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
    const ship = shipDef(this.shipId);

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
        value: this.shipName,
        maxLength: MAX_NAME_LENGTH,
        placeholder: this.t.t("profile.shipNameDefault"),
        onChange: (value) => {
          this.shipName = value;
        },
      },
    );
    controls.push(field);

    const launch = new MenuButton(
      this,
      this.uiStyle,
      "create.launch",
      SPACE.gutter,
      470,
      this.depth,
      {
        label: this.t.t("ui.create.launch"),
        size: TYPE.heading,
        minWidth: 360,
        onPress: () => this.createProfile(),
      },
    );
    controls.push(launch);
    return controls;
  }

  /**
   * The id carries the step. Every beat has a "next", and one shared id would
   * make the three of them indistinguishable to anything reading the screen -
   * a screen reader announcing the same control, or a test that cannot tell
   * whether the beat it asked for has actually been drawn yet.
   */
  private nextButton(label: string, y: number): MenuButton {
    return new MenuButton(
      this,
      this.uiStyle,
      `create.next.${this.step}`,
      SPACE.gutter,
      y,
      this.depth,
      { label, minWidth: 280, onPress: () => this.advance() },
    );
  }

  private advance(): void {
    if (this.step === 2) return;
    this.step = (this.step + 1) as Step;
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
      name: this.pilotName.trim(),
      avatar: this.avatarId,
      shipId: this.shipId,
      shipName: this.shipName.trim() || this.t.t("profile.shipNameDefault"),
    });
    this.app.services.context.profileId = created.id;
    store.flush();
    // Earth is the launchpad and the tutorial beat (D57), so a brand-new pilot
    // goes there rather than to the map.
    if (!this.goTo(SCENE_KEYS.earthActivation)) this.goTo(SCENE_KEYS.map);
  }

  /** Esc steps back through the beats, then out to the picker (AC-18.1). */
  protected goBack(): void {
    if (this.step > 0) {
      this.step = (this.step - 1) as Step;
      this.renderStep();
      return;
    }
    this.goTo(SCENE_KEYS.profilePicker);
  }

  override snapshot(): Record<string, unknown> {
    return {
      ...super.snapshot(),
      step: this.step,
      pilotName: this.pilotName,
      avatarId: this.avatarId,
      shipId: this.shipId,
      shipName: this.shipName,
    };
  }
}
