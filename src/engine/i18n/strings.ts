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
  "title.play": "play",
  "title.settings": "settings",
  "title.beaconLog": "beacon log",

  "profile.heading": "Who is flying today?",
  "profile.pilotName": "pilot name",
  "profile.chooseShip": "choose your ship",
  "profile.nameShip": "name your ship",
  "profile.shipNameDefault": "Lantern",

  "map.heading": "route to Pluto",
  "map.locked": "locked",
  "map.stars": "{stars} of 3 stars",

  "briefing.shipReady": "The {shipName} is fuelled and ready.",
  "briefing.start": "launch",

  "preflight.heading": "warm up your hands",
  "preflight.prompt": "Type the words you see.",

  "flight.hull": "hull",
  "flight.wpm": "{wpm} words per minute",

  "warp.heading": "warp break",
  "warp.prompt": "Type the sentence to charge the warp drive.",
  /*
   * D30. The break is the most important five seconds in the game and it used
   * to say neither of the two things a player needs to know. These three do:
   * the belt is GONE, this typing is what charges the drive, and the drive
   * being full means you are ABOUT TO TRAVEL, to a named place.
   */
  "warp.beltCleared":
    "Asteroid belt cleared. Type the sentence below to charge the warp drive.",
  "warp.nextStop": "Destination: {stop}.",
  "warp.chargedNext": "Warp drive charged. Next stop: {stop}.",
  "warp.chargedLast": "Warp drive charged. The last jump. Hold on.",

  "beacon.placed": "Beacon placed at {stop}.",

  "results.accuracy": "Accuracy {accuracy}%",
  "results.shipIntact": "The {shipName} came through without a scratch.",
  "results.continue": "continue",

  "settings.uiLang": "menu language",
  "settings.contentLang": "typing language",
  "settings.inputMethod": "how you type Hindi",
  "settings.inputMethodTranslit": "Roman letters (type ghar for घर)",
  "settings.inputMethodInscript": "Devanagari keyboard",
  "settings.contentLangUnavailable": "Pick a Hindi keyboard to type in Hindi.",

  "common.back": "back",
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

  "briefing.shipReady": "La {shipName} está cargada y lista.",
  "briefing.start": "despegar",

  "preflight.heading": "calienta las manos",
  "preflight.prompt": "Escribe las palabras que ves.",

  "flight.hull": "casco",
  "flight.wpm": "{wpm} palabras por minuto",

  "warp.heading": "pausa de salto",
  "warp.prompt": "Escribe la frase para cargar el motor de salto.",
  "warp.beltCleared": "Cinturón limpio. Escribe para cargar el motor de salto.",
  "warp.nextStop": "Destino: {stop}.",
  "warp.chargedNext": "Motor de salto cargado. Próxima parada: {stop}.",
  "warp.chargedLast": "Motor de salto cargado. El último salto. Agárrate.",

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

  "briefing.shipReady": "{shipName} में ईंधन भरा है, उड़ने को तैयार।",
  "briefing.start": "उड़ान भरो",

  "preflight.heading": "हाथ गरम करो",
  "preflight.prompt": "जो शब्द दिखें उन्हें लिखो।",

  "flight.hull": "कवच",
  "flight.wpm": "{wpm} शब्द प्रति मिनट",

  "warp.heading": "वार्प विराम",
  "warp.prompt": "वार्प इंजन भरने के लिए वाक्य लिखो।",
  "warp.beltCleared": "पट्टी साफ़ हो गई। वार्प इंजन भरने के लिए यह लिखो।",
  "warp.nextStop": "गंतव्य: {stop}।",
  "warp.chargedNext": "वार्प इंजन भर गया। अगला पड़ाव: {stop}।",
  "warp.chargedLast": "वार्प इंजन भर गया। आख़िरी छलांग। सँभल जाओ।",

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
