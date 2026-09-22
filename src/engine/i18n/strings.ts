import type { Lang } from "../types.js";

/**
 * UI string tables (D45, PRD FR-14).
 *
 * WHY TypeScript and not `i18n/<lang>.json` as architecture section 8 writes
 * it: `resolveJsonModule` is off in tsconfig.json and this lane may not edit
 * tsconfig. A frozen `Record<StringKey, string>` buys something the JSON files
 * cannot: ES and HI are typed against EN's key set, so a missing or misspelled
 * translation is a COMPILE error, not a runtime miss. The shape is identical -
 * a flat key -> string map - so the content pipeline can emit JSON later and
 * these become thin importers.
 *
 * SCOPE: this is a representative set covering the screen inventory
 * (design-brief-v2.md section 11), not the game's content. Story prose, briefings
 * and warp sentences are a separate content-pipeline deliverable (D45, D67);
 * they live in src/content/<lang>/ and are validated against the allowlist.
 *
 * C07: the ship is never named in copy. Anywhere the hull would be named, the
 * string carries `{shipName}` and the caller passes Profile.shipName (default
 * "Lantern"). The one literal "Lantern" in this file is the DEFAULT VALUE the
 * Profile screen offers, which is exactly where a default belongs.
 */

/** English is the source table; every other language is typed against it. */
export const EN = {
  "title.tagline": "Type the way through the solar system.",
  "title.play": "Play",
  "title.settings": "Settings",
  "title.beaconLog": "Beacon Log",

  "profile.heading": "Who is flying today?",
  "profile.pilotName": "Pilot Name",
  "profile.chooseShip": "Choose Your Ship",
  "profile.nameShip": "Name Your Ship",
  "profile.shipNameDefault": "Lantern",

  "map.heading": "Route to Pluto",
  "map.locked": "Locked",
  "map.stars": "{stars} of 3 stars",

  // UR-125: NOT "our ship is fuelled and ready". The button under this line
  // says "Prepare Ship" and leads to a hull check, a systems check and an
  // engine check - a line claiming the ship is already ready contradicts the
  // one control on the screen. It points at the checks instead.
  "briefing.shipReady": "{pilotName}, ready to prepare the ship whenever you are.",
  // UR-122: NOT "Launch". This button is on the BRIEFING and it goes to
  // Pre-flight (`BriefingScene:659`), which is a hull check, a systems check
  // and an engine check - nothing has launched. The screen that launches is
  // Pre-flight itself (`PreflightScene:1026` -> SCENE_KEYS.flight), so the
  // word belongs to the button that ends the ritual, not the one that starts it.
  "briefing.start": "Prepare Ship",

  "preflight.heading": "Warm Up Your Hands",
  "preflight.prompt": "Type the words you see.",

  "flight.hull": "Shield",
  "flight.wpm": "{wpm} words per minute",

  /**
   * ============ THE SCREEN CHARGES A BEACON. IT IS NOT A WARP DRIVE. ============
   *
   * The belt is AT the destination. Clearing Mars' belt means the pilot has
   * already arrived, with Mars-coloured rocks around them, so a drive that
   * carries them somewhere afterwards is a journey to a place they are standing
   * in. Worse, the screen named the stop AFTER this one while the very next
   * scene planted THIS one's beacon - the one line that pointed forward pointed
   * at the wrong planet.
   *
   * The beat is right and only its meaning was wrong. The words the child
   * blasted charge the BEACON, the charged line hands it to the scene that
   * plants it, and the meter's output becomes a physical object one screen
   * later instead of a flourish.
   *
   * THE KEYS ARE NOT RENAMED. `warp.*` is the namespace three languages, nine
   * tests and two scenes already spell; renaming it is a wide mechanical diff
   * with nothing in it for a player. What a player READS is what changed.
   */
  "warp.heading": "Charging The Beacon",
  "warp.prompt": "Type the sentence to charge the beacon.",
  /**
   * KEPT, UNUSED. It was the banner across the top of the frame; both of the
   * screen's instruction lines are one line in Shadow's card now
   * (`warp.coachIntro`). Kept for the same reason `warp.heading` is: restoring
   * the banner should be a layout change, not a translation job. "below" dates
   * it - the card is beneath the sentence, not above it.
   */
  "warp.beltCleared":
    "Asteroid belt cleared. Type the sentence below to charge the beacon.",
  /**
   * WHAT SHADOW SAYS BEFORE HE HAS ANYTHING TO SAY.
   *
   * The screen used to carry two separate instructions - a banner at the top
   * (`warp.beltCleared`) and a hint at the foot (`warp.hint`) - and a coach
   * card that sat empty until the note landed. This is all three of those: the
   * belt is clear, the typing charges the beacon, and a missed letter costs
   * nothing. It is drawn in the note's own row and the note replaces it, so
   * the card's geometry never moves (AC-33).
   *
   * TWO LINES OF `TYPE.body` IS THE BUDGET, in all three languages - that is
   * what `coachRows` reserves for the note, and this string shares the row.
   * `warpCoachCard.test.ts` measures it.
   */
  "warp.coachIntro":
    "The belt is clear, pilot. Type the sentence to charge the beacon. Miss a letter and the sentence just asks for it again.",
  /**
   * The line above the sentence: WHOSE beacon this is. A label, so Title Case,
   * and `{stop}` is the stop the child is standing at - the one the next scene
   * plants - never the one after it.
   */
  "warp.nextStop": "Charging: {stop} Beacon",
  /** At 100%: what the charge is FOR, and where it is about to go. */
  "warp.chargedNext": "Beacon charged. Plant it at {stop}.",
  /**
   * KEPT, UNUSED, like `warp.heading` was kept when its tab came off the
   * screen. It existed because `nextStopId` returned null at Pluto; the beacon
   * being charged is the CURRENT stop, which always exists, so nothing can
   * reach this any more. Deleting it would make restoring a last-stop beat a
   * translation job rather than one line of scene code.
   */
  "warp.chargedLast": "Beacon charged. The last one. Plant it.",

  "beacon.placed": "Beacon placed at {stop}.",

  "results.accuracy": "Accuracy {accuracy}%",
  "results.shipIntact": "The {shipName} came through without a scratch.",
  "results.continue": "Continue",

  "settings.uiLang": "Menu Language",
  "settings.contentLang": "Typing Language",
  "settings.inputMethod": "How You Type Hindi",
  "settings.inputMethodTranslit": "Roman letters (type ghar for घर)",
  "settings.inputMethodInscript": "Devanagari keyboard",
  "settings.contentLangUnavailable": "Pick a Hindi keyboard to type in Hindi.",

  "common.back": "Back",
} as const;

/** Every UI string the engine knows about. */
export type StringKey = keyof typeof EN;

export const STRING_KEYS: readonly StringKey[] = Object.keys(
  EN,
) as StringKey[];

/**
 * Spanish. Runs longer than English by design (design-brief-v2.md section on
 * i18n: "+25%"); fit.ts is what tests that against a label budget.
 */
export const ES: Record<StringKey, string> = {
  "title.tagline": "Escribe el camino por el sistema solar.",
  "title.play": "jugar",
  "title.settings": "ajustes",
  "title.beaconLog": "registro de balizas",

  "profile.heading": "¿Quién vuela hoy?",
  "profile.pilotName": "nombre del piloto",
  "profile.chooseShip": "elige tu nave",
  "profile.nameShip": "ponle nombre a tu nave",
  // Proper name: not translated, only defaulted (C07).
  "profile.shipNameDefault": "Lantern",

  "map.heading": "ruta a Plutón",
  "map.locked": "bloqueado",
  "map.stars": "{stars} de 3 estrellas",

  "briefing.shipReady": "{pilotName}, lista para preparar la nave cuando quieras.",
  "briefing.start": "preparar nave",

  "preflight.heading": "calienta las manos",
  "preflight.prompt": "Escribe las palabras que ves.",

  "flight.hull": "escudo",
  "flight.wpm": "{wpm} palabras por minuto",

  "warp.heading": "Cargando la baliza",
  "warp.prompt": "Escribe la frase para cargar la baliza.",
  "warp.beltCleared":
    "Cinturón de asteroides limpio. Escribe la frase de abajo para cargar la baliza.",
  "warp.coachIntro":
    "El cinturón está despejado, piloto. Escribe la frase para cargar la baliza. Si fallas una letra, la frase te la vuelve a pedir.",
  // Español no pone mayúscula en cada palabra de un sintagma común, así que la
  // regla aquí es "la etiqueta lleva una mayúscula", y eso es una.
  "warp.nextStop": "Cargando: baliza de {stop}",
  "warp.chargedNext": "Baliza cargada. Plántala en {stop}.",
  "warp.chargedLast": "Baliza cargada. La última. Plántala.",

  "beacon.placed": "Baliza colocada en {stop}.",

  "results.accuracy": "Precisión {accuracy}%",
  "results.shipIntact": "La {shipName} llegó sin un solo rasguño.",
  "results.continue": "continuar",

  "settings.uiLang": "idioma del menú",
  "settings.contentLang": "idioma de escritura",
  "settings.inputMethod": "cómo escribes en hindi",
  "settings.inputMethodTranslit": "letras latinas (escribe ghar para घर)",
  "settings.inputMethodInscript": "teclado devanagari",
  "settings.contentLangUnavailable":
    "Elige un teclado de hindi para escribir en hindi.",

  "common.back": "atrás",
};

/**
 * Hindi. Grade 2-3 register to match the story's reading level
 * (story-draft-v1.md note 2). Imperatives use the familiar `-o` form a child
 * is addressed with.
 */
export const HI: Record<StringKey, string> = {
  "title.tagline": "सौर मंडल का रास्ता टाइप करो।",
  "title.play": "खेलो",
  "title.settings": "सेटिंग्स",
  "title.beaconLog": "बीकन सूची",

  "profile.heading": "आज कौन उड़ान भर रहा है?",
  "profile.pilotName": "पायलट का नाम",
  "profile.chooseShip": "अपना यान चुनो",
  "profile.nameShip": "अपने यान को नाम दो",
  "profile.shipNameDefault": "Lantern",

  "map.heading": "प्लूटो का रास्ता",
  "map.locked": "बंद",
  "map.stars": "3 में से {stars} तारे",

  "briefing.shipReady": "{pilotName}, जब तुम कहो, जहाज़ तैयार कर लेते हैं।",
  "briefing.start": "जहाज़ तैयार करो",

  "preflight.heading": "हाथ गरम करो",
  "preflight.prompt": "जो शब्द दिखें उन्हें लिखो।",

  "flight.hull": "ढाल",
  "flight.wpm": "{wpm} शब्द प्रति मिनट",

  // "बीकन" is the word every other Hindi string in this table already uses for
  // a beacon ("beacon.placed", "title.beaconLog"), and "लगाओ" is the verb that
  // screen uses for planting one, so the two halves of the beat match.
  "warp.heading": "बीकन भर रहे हैं",
  "warp.prompt": "बीकन भरने के लिए वाक्य लिखो।",
  "warp.beltCleared": "क्षुद्रग्रह पट्टी साफ़ हो गई। बीकन भरने के लिए नीचे का वाक्य लिखो।",
  "warp.coachIntro":
    "पट्टी साफ़ हो गई, पायलट। बीकन भरने के लिए वाक्य लिखो। कोई अक्षर चूक जाए तो वाक्य उसे फिर से माँगता है।",
  "warp.nextStop": "भर रहे हैं: {stop} का बीकन",
  "warp.chargedNext": "बीकन भर गया। इसे {stop} पर लगाओ।",
  "warp.chargedLast": "बीकन भर गया। आख़िरी वाला। इसे लगाओ।",

  "beacon.placed": "{stop} पर बीकन लगा।",

  "results.accuracy": "शुद्धता {accuracy}%",
  "results.shipIntact": "{shipName} पर एक खरोंच भी नहीं आई।",
  "results.continue": "आगे बढ़ो",

  "settings.uiLang": "मेन्यू की भाषा",
  "settings.contentLang": "लिखने की भाषा",
  "settings.inputMethod": "हिंदी कैसे लिखोगे",
  "settings.inputMethodTranslit": "रोमन अक्षर (घर के लिए ghar लिखो)",
  "settings.inputMethodInscript": "देवनागरी कीबोर्ड",
  "settings.contentLangUnavailable": "हिंदी लिखने के लिए हिंदी कीबोर्ड चुनो।",

  "common.back": "वापस",
};

/**
 * A table may be partial: that is the only way the missing-key policy in
 * translate.ts can ever fire, and a half-finished translation drop must not
 * fail to typecheck at the boundary.
 */
export type StringTable = Readonly<Partial<Record<StringKey, string>>>;

export const TABLES: Readonly<Record<Lang, StringTable>> = {
  en: EN,
  es: ES,
  hi: HI,
};

/** Fallback for a key missing from the selected language, in prod only. */
export const FALLBACK_LANG: Lang = "en";
