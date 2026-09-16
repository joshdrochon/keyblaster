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
  "title.tagline": "Light the way home.",
  "title.play": "Play",
  "title.settings": "Settings",
  "title.beaconLog": "Beacon Log",

  "profile.heading": "Who is flying today?",
  "profile.pilotName": "Pilot name",
  "profile.chooseShip": "Choose your ship",
  "profile.nameShip": "Name your ship",
  "profile.shipNameDefault": "Lantern",

  "map.heading": "Route to Pluto",
  "map.locked": "Locked",
  "map.stars": "{stars} of 3 stars",

  "briefing.shipReady": "The {shipName} is fuelled and ready.",
  "briefing.start": "Launch",

  "preflight.heading": "Warm up your hands",
  "preflight.prompt": "Type the words you see.",

  "flight.hull": "Hull",
  "flight.wpm": "{wpm} words per minute",

  "warp.heading": "Warp break",
  "warp.prompt": "Type the sentence to charge the warp drive.",

  "beacon.placed": "Beacon placed at {stop}.",

  "results.accuracy": "Accuracy {accuracy}%",
  "results.shipIntact": "The {shipName} came through without a scratch.",
  "results.continue": "Continue",

  "settings.uiLang": "Menu language",
  "settings.contentLang": "Typing language",
  "settings.inputMethod": "How you type Hindi",
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
  "title.tagline": "Ilumina el camino a casa.",
  "title.play": "Jugar",
  "title.settings": "Ajustes",
  "title.beaconLog": "Registro de balizas",

  "profile.heading": "¿Quién vuela hoy?",
  "profile.pilotName": "Nombre del piloto",
  "profile.chooseShip": "Elige tu nave",
  "profile.nameShip": "Ponle nombre a tu nave",
  // Proper name: not translated, only defaulted (C07).
  "profile.shipNameDefault": "Lantern",

  "map.heading": "Ruta a Plutón",
  "map.locked": "Bloqueado",
  "map.stars": "{stars} de 3 estrellas",

  "briefing.shipReady": "La {shipName} está cargada y lista.",
  "briefing.start": "Despegar",

  "preflight.heading": "Calienta las manos",
  "preflight.prompt": "Escribe las palabras que ves.",

  "flight.hull": "Casco",
  "flight.wpm": "{wpm} palabras por minuto",

  "warp.heading": "Pausa de salto",
  "warp.prompt": "Escribe la frase para cargar el motor de salto.",

  "beacon.placed": "Baliza colocada en {stop}.",

  "results.accuracy": "Precisión {accuracy}%",
  "results.shipIntact": "La {shipName} llegó sin un solo rasguño.",
  "results.continue": "Continuar",

  "settings.uiLang": "Idioma del menú",
  "settings.contentLang": "Idioma de escritura",
  "settings.inputMethod": "Cómo escribes en hindi",
  "settings.inputMethodTranslit": "Letras latinas (escribe ghar para घर)",
  "settings.inputMethodInscript": "Teclado devanagari",
  "settings.contentLangUnavailable":
    "Elige un teclado de hindi para escribir en hindi.",

  "common.back": "Atrás",
};

/**
 * Hindi. Grade 2-3 register to match the story's reading level
 * (story-draft-v1.md note 2). Imperatives use the familiar `-o` form a child
 * is addressed with.
 */
export const HI: Record<StringKey, string> = {
  "title.tagline": "घर का रास्ता रोशन करो।",
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
