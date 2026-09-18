import type { Lang } from "@engine/types";

/**
 * Menu copy for the screens this lane owns (D45, AC-14.3).
 *
 * WHY A SECOND TABLE. `src/engine/i18n/strings.ts` ships "a representative set
 * covering the screen inventory", not the whole game's chrome: it has no key
 * for a trophy name, a pause menu, a reset confirm or a storage notice. This
 * lane may not edit `src/engine` (scene-lane brief, "Scope discipline"), so the
 * keys these five screens need live here and are MERGED INTO the engine tables
 * by `i18n.ts`. Lookup, fallback and `{shipName}` interpolation all still go
 * through `@engine/i18n`'s `createTranslator` - this file is a table, not a
 * second i18n implementation. When a later pass folds these keys into the
 * engine table, delete this file and the merge in `i18n.ts`; nothing else
 * changes, because every call site already uses `t(key)`.
 *
 * Every copy line carries `i18n-ignore`: the hard-coded-string checker
 * (AC-14.3) flags user-facing literals in `src/game`, and a string TABLE is the
 * one place in src/game where they are the point. The marker is per line, so
 * the exemption stays visible and narrow instead of blanketing the file.
 *
 * C07: the ship is never named here. Copy that names the hull uses
 * `{shipName}`, bound once per profile in `i18n.ts`.
 *
 * Register: grade 2-3. Short sentences, familiar words, nothing that scolds.
 */

export const UI_EN = {
  // --- shared chrome -------------------------------------------------------
  "ui.common.hintKeys": "arrows to move · enter to choose · esc to go back", // i18n-ignore
  "ui.common.hintAdjust": "left and right to change", // i18n-ignore
  "ui.common.cancel": "cancel", // i18n-ignore
  "ui.common.on": "on", // i18n-ignore
  "ui.common.off": "off", // i18n-ignore
  "ui.common.percent": "{percent}%", // i18n-ignore

  // --- 1b profile picker ---------------------------------------------------
  "ui.pick.newPilot": "new pilot", // i18n-ignore
  "ui.pick.furthest": "furthest beacon: {stop}", // i18n-ignore
  "ui.pick.noBeacons": "no beacons yet", // i18n-ignore
  "ui.pick.none": "no pilots yet — make the first one", // i18n-ignore
  "ui.pick.fly": "fly", // i18n-ignore
  "ui.pick.remove": "remove pilot", // i18n-ignore
  "ui.pick.removeAsk": "remove {name}? their beacons go too.", // i18n-ignore
  "ui.pick.removeYes": "remove pilot", // i18n-ignore
  "ui.pick.removeNo": "keep pilot", // i18n-ignore

  // --- 2 profile create ----------------------------------------------------
  "ui.create.step": "step {n} of {total}", // i18n-ignore
  "ui.create.chooseLook": "choose your look", // i18n-ignore
  "ui.create.typeName": "type your name", // i18n-ignore
  "ui.create.typeShipName": "type a name for your ship", // i18n-ignore
  "ui.create.next": "next", // i18n-ignore
  "ui.create.launch": "take off", // i18n-ignore
  "ui.create.skins": "skins", // i18n-ignore
  "ui.create.unlockBeacons": "unlocks after {n} beacons", // i18n-ignore
  "ui.create.unlockStars": "unlocks at your first 3-star stop", // i18n-ignore
  "ui.create.unlockChain25": "unlocks at a 25 chain", // i18n-ignore
  "ui.create.unlockChain50": "unlocks at a 50 chain", // i18n-ignore
  "ui.create.unlockRetention": "unlocks when you remember a whole word set", // i18n-ignore

  // --- ships and skins (D79) ----------------------------------------------
  "ui.ship.ship-1": "sparrow", // i18n-ignore
  "ui.ship.ship-2": "kestrel", // i18n-ignore
  "ui.ship.ship-3": "harrier", // i18n-ignore
  "ui.ship.ship-4": "albatross", // i18n-ignore
  "ui.skin.ship-1": "dawn trim", // i18n-ignore
  "ui.skin.ship-2": "deep blue trim", // i18n-ignore
  "ui.skin.ship-3": "frost trim", // i18n-ignore
  "ui.skin.ship-4": "ember trim", // i18n-ignore

  // --- avatars -------------------------------------------------------------
  "ui.avatar.avatar-1": "comet", // i18n-ignore
  "ui.avatar.avatar-2": "moon", // i18n-ignore
  "ui.avatar.avatar-3": "star", // i18n-ignore
  "ui.avatar.avatar-4": "ring", // i18n-ignore
  "ui.avatar.avatar-5": "spark", // i18n-ignore
  "ui.avatar.avatar-6": "wave", // i18n-ignore

  // --- stops ---------------------------------------------------------------
  "ui.stop.earth": "earth", // i18n-ignore
  "ui.stop.mars": "mars", // i18n-ignore
  "ui.stop.jupiter": "jupiter", // i18n-ignore
  "ui.stop.saturn": "saturn", // i18n-ignore
  "ui.stop.uranus": "uranus", // i18n-ignore
  "ui.stop.neptune": "neptune", // i18n-ignore
  "ui.stop.pluto": "pluto", // i18n-ignore

  // --- 10 beacon log -------------------------------------------------------
  "ui.log.heading": "beacon log", // i18n-ignore
  "ui.log.beacons": "beacons", // i18n-ignore
  "ui.log.trophies": "trophies", // i18n-ignore
  "ui.log.lit": "{n} of {total} lit", // i18n-ignore
  "ui.log.notLit": "not lit yet", // i18n-ignore
  "ui.log.coords": "λ {lam}°   β {beta}°   r {r} au", // i18n-ignore
  "ui.log.emptyShadow": "only earth is lit. six more are waiting for us.", // i18n-ignore
  "ui.log.earned": "earned", // i18n-ignore
  "ui.log.notYet": "not yet", // i18n-ignore
  "ui.log.trophyCount": "{n} of {total} earned", // i18n-ignore

  // --- trophies (D80 / AC-6d.1c) ------------------------------------------
  "ui.trophy.firstLight": "first light", // i18n-ignore
  "ui.trophy.firstLight.how": "light earth's beacon", // i18n-ignore
  "ui.trophy.pathfinder": "pathfinder", // i18n-ignore
  "ui.trophy.pathfinder.how": "place your first beacon", // i18n-ignore
  "ui.trophy.beltRunner": "belt runner", // i18n-ignore
  "ui.trophy.beltRunner.how": "cross the main belt without a scratch", // i18n-ignore
  "ui.trophy.ringWeaver": "ring weaver", // i18n-ignore
  "ui.trophy.ringWeaver.how": "three stars at saturn", // i18n-ignore
  "ui.trophy.chain25": "chain 25", // i18n-ignore
  "ui.trophy.chain25.how": "25 words in a row", // i18n-ignore
  "ui.trophy.chain50": "chain 50", // i18n-ignore
  "ui.trophy.chain50.how": "50 words in a row", // i18n-ignore
  "ui.trophy.sharpEye": "sharp eye", // i18n-ignore
  "ui.trophy.sharpEye.how": "clear a belt where two rocks start the same", // i18n-ignore
  "ui.trophy.steadyHull": "steady hull", // i18n-ignore
  "ui.trophy.steadyHull.how": "three clean stops in a row", // i18n-ignore
  "ui.trophy.longMemory": "long memory", // i18n-ignore
  "ui.trophy.longMemory.how": "remember every word that came back", // i18n-ignore
  "ui.trophy.mapMaker": "map maker", // i18n-ignore
  "ui.trophy.mapMaker.how": "light all seven beacons", // i18n-ignore
  "ui.trophy.darkSide": "dark side", // i18n-ignore
  "ui.trophy.darkSide.how": "three stars at uranus", // i18n-ignore
  "ui.trophy.lastLight": "last light", // i18n-ignore
  "ui.trophy.lastLight.how": "place the beacon at pluto", // i18n-ignore

  // --- 11 settings ---------------------------------------------------------
  "ui.settings.heading": "ship controls", // i18n-ignore
  "ui.settings.hull": "your ship", // i18n-ignore
  "ui.settings.hullFlying": "flying now", // i18n-ignore
  "ui.settings.hullEquip": "press enter to fly this one", // i18n-ignore
  "ui.settings.music": "music", // i18n-ignore
  "ui.settings.sfx": "sound", // i18n-ignore
  "ui.settings.keyboardLayout": "keyboard", // i18n-ignore
  "ui.settings.letterCase": "letter case", // i18n-ignore
  "ui.settings.letterCaseLower": "small letters", // i18n-ignore
  "ui.settings.letterCaseUpper": "capital letters", // i18n-ignore
  "ui.settings.letterSpacing": "wider letters", // i18n-ignore
  "ui.settings.reducedMotion": "calm motion", // i18n-ignore
  "ui.settings.colorblind": "colour-safe palette", // i18n-ignore
  "ui.settings.resetProgress": "reset progress", // i18n-ignore
  "ui.settings.resetAsk1": "this clears every beacon, trophy and star for {name}. the pilot stays.", // i18n-ignore
  "ui.settings.resetAsk2": "one more time: clear it all and start the route again?", // i18n-ignore
  "ui.settings.resetYes": "yes, clear it", // i18n-ignore
  "ui.settings.resetNo": "keep my progress", // i18n-ignore
  "ui.settings.resetDone": "progress cleared. earth is still yours to light.", // i18n-ignore
  "ui.settings.layout.qwerty": "qwerty", // i18n-ignore
  "ui.settings.layout.azerty": "azerty", // i18n-ignore
  "ui.settings.layout.qwertz": "qwertz", // i18n-ignore
  "ui.settings.layout.dvorak": "dvorak", // i18n-ignore
  "ui.settings.lang.en": "english", // i18n-ignore
  "ui.settings.lang.es": "español", // i18n-ignore
  "ui.settings.lang.hi": "हिंदी", // i18n-ignore
  "ui.settings.inputMethod.latin": "latin keyboard", // i18n-ignore

  // --- 13 pause ------------------------------------------------------------
  "ui.pause.heading": "paused", // i18n-ignore
  "ui.pause.resume": "back to the belt", // i18n-ignore
  "ui.pause.quit": "quit to map", // i18n-ignore
  "ui.pause.quitAsk": "quit to the map? this belt starts over next time.", // i18n-ignore
  "ui.pause.quitYes": "quit to map", // i18n-ignore
  "ui.pause.quitNo": "keep flying", // i18n-ignore

  // --- 13 toasts -----------------------------------------------------------
  "ui.toast.trophy": "trophy earned — {name}", // i18n-ignore
  "ui.toast.skin": "new skin — {name}", // i18n-ignore

  // --- 14 notices (AC-18.4) ------------------------------------------------
  "ui.notice.fresh": "we could not read the old save, so this one starts fresh.", // i18n-ignore
  "ui.notice.repaired": "we tidied up the save. your beacons are still here.", // i18n-ignore
  "ui.notice.writeFailed": "we cannot save right now, but you can keep flying.", // i18n-ignore
} as const;

/** Every key this lane adds on top of the engine table. */
export type UiStringKey = keyof typeof UI_EN;

export const UI_ES: Record<UiStringKey, string> = {
  "ui.common.hintKeys": "flechas para moverte · enter para elegir · esc para volver", // i18n-ignore
  "ui.common.hintAdjust": "izquierda y derecha para cambiar", // i18n-ignore
  "ui.common.cancel": "cancelar", // i18n-ignore
  "ui.common.on": "sí", // i18n-ignore
  "ui.common.off": "no", // i18n-ignore
  "ui.common.percent": "{percent}%", // i18n-ignore

  "ui.pick.newPilot": "piloto nuevo", // i18n-ignore
  "ui.pick.furthest": "baliza más lejana: {stop}", // i18n-ignore
  "ui.pick.noBeacons": "todavía sin balizas", // i18n-ignore
  "ui.pick.none": "aún no hay pilotos — crea el primero", // i18n-ignore
  "ui.pick.fly": "volar", // i18n-ignore
  "ui.pick.remove": "quitar piloto", // i18n-ignore
  "ui.pick.removeAsk": "¿quitar a {name}? sus balizas también se van.", // i18n-ignore
  "ui.pick.removeYes": "quitar piloto", // i18n-ignore
  "ui.pick.removeNo": "dejar al piloto", // i18n-ignore

  "ui.create.step": "paso {n} de {total}", // i18n-ignore
  "ui.create.chooseLook": "elige tu figura", // i18n-ignore
  "ui.create.typeName": "escribe tu nombre", // i18n-ignore
  "ui.create.typeShipName": "escribe un nombre para tu nave", // i18n-ignore
  "ui.create.next": "siguiente", // i18n-ignore
  "ui.create.launch": "despegar", // i18n-ignore
  "ui.create.skins": "diseños", // i18n-ignore
  "ui.create.unlockBeacons": "se abre con {n} balizas", // i18n-ignore
  "ui.create.unlockStars": "se abre con tu primera parada de 3 estrellas", // i18n-ignore
  "ui.create.unlockChain25": "se abre con una cadena de 25", // i18n-ignore
  "ui.create.unlockChain50": "se abre con una cadena de 50", // i18n-ignore
  "ui.create.unlockRetention": "se abre cuando recuerdas un grupo entero de palabras", // i18n-ignore

  "ui.ship.ship-1": "gorrión", // i18n-ignore
  "ui.ship.ship-2": "cernícalo", // i18n-ignore
  "ui.ship.ship-3": "aguilucho", // i18n-ignore
  "ui.ship.ship-4": "albatros", // i18n-ignore
  "ui.skin.ship-1": "franja del alba", // i18n-ignore
  "ui.skin.ship-2": "franja azul profundo", // i18n-ignore
  "ui.skin.ship-3": "franja de escarcha", // i18n-ignore
  "ui.skin.ship-4": "franja de brasa", // i18n-ignore

  "ui.avatar.avatar-1": "cometa", // i18n-ignore
  "ui.avatar.avatar-2": "luna", // i18n-ignore
  "ui.avatar.avatar-3": "estrella", // i18n-ignore
  "ui.avatar.avatar-4": "anillo", // i18n-ignore
  "ui.avatar.avatar-5": "chispa", // i18n-ignore
  "ui.avatar.avatar-6": "ola", // i18n-ignore

  "ui.stop.earth": "tierra", // i18n-ignore
  "ui.stop.mars": "marte", // i18n-ignore
  "ui.stop.jupiter": "júpiter", // i18n-ignore
  "ui.stop.saturn": "saturno", // i18n-ignore
  "ui.stop.uranus": "urano", // i18n-ignore
  "ui.stop.neptune": "neptuno", // i18n-ignore
  "ui.stop.pluto": "plutón", // i18n-ignore

  "ui.log.heading": "registro de balizas", // i18n-ignore
  "ui.log.beacons": "balizas", // i18n-ignore
  "ui.log.trophies": "trofeos", // i18n-ignore
  "ui.log.lit": "{n} de {total} encendidas", // i18n-ignore
  "ui.log.notLit": "todavía apagada", // i18n-ignore
  "ui.log.coords": "λ {lam}°   β {beta}°   r {r} ua", // i18n-ignore
  "ui.log.emptyShadow": "solo la tierra está encendida. seis más nos esperan.", // i18n-ignore
  "ui.log.earned": "conseguido", // i18n-ignore
  "ui.log.notYet": "todavía no", // i18n-ignore
  "ui.log.trophyCount": "{n} de {total} conseguidos", // i18n-ignore

  "ui.trophy.firstLight": "primera luz", // i18n-ignore
  "ui.trophy.firstLight.how": "enciende la baliza de la tierra", // i18n-ignore
  "ui.trophy.pathfinder": "exploradora", // i18n-ignore
  "ui.trophy.pathfinder.how": "coloca tu primera baliza", // i18n-ignore
  "ui.trophy.beltRunner": "corredora del cinturón", // i18n-ignore
  "ui.trophy.beltRunner.how": "cruza el cinturón sin un rasguño", // i18n-ignore
  "ui.trophy.ringWeaver": "tejedora de anillos", // i18n-ignore
  "ui.trophy.ringWeaver.how": "tres estrellas en saturno", // i18n-ignore
  "ui.trophy.chain25": "cadena 25", // i18n-ignore
  "ui.trophy.chain25.how": "25 palabras seguidas", // i18n-ignore
  "ui.trophy.chain50": "cadena 50", // i18n-ignore
  "ui.trophy.chain50.how": "50 palabras seguidas", // i18n-ignore
  "ui.trophy.sharpEye": "ojo fino", // i18n-ignore
  "ui.trophy.sharpEye.how": "limpia un cinturón con dos rocas que empiezan igual", // i18n-ignore
  "ui.trophy.steadyHull": "casco firme", // i18n-ignore
  "ui.trophy.steadyHull.how": "tres paradas limpias seguidas", // i18n-ignore
  "ui.trophy.longMemory": "memoria larga", // i18n-ignore
  "ui.trophy.longMemory.how": "recuerda cada palabra que volvió", // i18n-ignore
  "ui.trophy.mapMaker": "cartógrafa", // i18n-ignore
  "ui.trophy.mapMaker.how": "enciende las siete balizas", // i18n-ignore
  "ui.trophy.darkSide": "lado oscuro", // i18n-ignore
  "ui.trophy.darkSide.how": "tres estrellas en urano", // i18n-ignore
  "ui.trophy.lastLight": "última luz", // i18n-ignore
  "ui.trophy.lastLight.how": "coloca la baliza en plutón", // i18n-ignore

  "ui.settings.heading": "controles de la nave", // i18n-ignore
  "ui.settings.hull": "tu nave", // i18n-ignore
  "ui.settings.hullFlying": "volando ahora", // i18n-ignore
  "ui.settings.hullEquip": "pulsa enter para volar esta", // i18n-ignore
  "ui.settings.music": "música", // i18n-ignore
  "ui.settings.sfx": "sonido", // i18n-ignore
  "ui.settings.keyboardLayout": "teclado", // i18n-ignore
  "ui.settings.letterCase": "tipo de letra", // i18n-ignore
  "ui.settings.letterCaseLower": "letras pequeñas", // i18n-ignore
  "ui.settings.letterCaseUpper": "letras mayúsculas", // i18n-ignore
  "ui.settings.letterSpacing": "letras más separadas", // i18n-ignore
  "ui.settings.reducedMotion": "movimiento tranquilo", // i18n-ignore
  "ui.settings.colorblind": "paleta segura para el color", // i18n-ignore
  "ui.settings.resetProgress": "borrar el progreso", // i18n-ignore
  "ui.settings.resetAsk1": "esto borra cada baliza, trofeo y estrella de {name}. el piloto se queda.", // i18n-ignore
  "ui.settings.resetAsk2": "una vez más: ¿borrar todo y empezar la ruta otra vez?", // i18n-ignore
  "ui.settings.resetYes": "sí, borrarlo", // i18n-ignore
  "ui.settings.resetNo": "guardar mi progreso", // i18n-ignore
  "ui.settings.resetDone": "progreso borrado. la tierra sigue esperando tu luz.", // i18n-ignore
  "ui.settings.layout.qwerty": "qwerty", // i18n-ignore
  "ui.settings.layout.azerty": "azerty", // i18n-ignore
  "ui.settings.layout.qwertz": "qwertz", // i18n-ignore
  "ui.settings.layout.dvorak": "dvorak", // i18n-ignore
  "ui.settings.lang.en": "english", // i18n-ignore
  "ui.settings.lang.es": "español", // i18n-ignore
  "ui.settings.lang.hi": "हिंदी", // i18n-ignore
  "ui.settings.inputMethod.latin": "teclado latino", // i18n-ignore

  "ui.pause.heading": "en pausa", // i18n-ignore
  "ui.pause.resume": "volver al cinturón", // i18n-ignore
  "ui.pause.quit": "salir al mapa", // i18n-ignore
  "ui.pause.quitAsk": "¿salir al mapa? este cinturón empieza de nuevo la próxima vez.", // i18n-ignore
  "ui.pause.quitYes": "salir al mapa", // i18n-ignore
  "ui.pause.quitNo": "seguir volando", // i18n-ignore

  "ui.toast.trophy": "trofeo conseguido — {name}", // i18n-ignore
  "ui.toast.skin": "diseño nuevo — {name}", // i18n-ignore

  "ui.notice.fresh": "no pudimos leer la partida anterior, así que esta empieza de cero.", // i18n-ignore
  "ui.notice.repaired": "arreglamos la partida guardada. tus balizas siguen aquí.", // i18n-ignore
  "ui.notice.writeFailed": "ahora no podemos guardar, pero puedes seguir volando.", // i18n-ignore
};

export const UI_HI: Record<UiStringKey, string> = {
  "ui.common.hintKeys": "तीर से चलो · एंटर से चुनो · एस्केप से वापस", // i18n-ignore
  "ui.common.hintAdjust": "बाएँ और दाएँ से बदलो", // i18n-ignore
  "ui.common.cancel": "रहने दो", // i18n-ignore
  "ui.common.on": "चालू", // i18n-ignore
  "ui.common.off": "बंद", // i18n-ignore
  "ui.common.percent": "{percent}%", // i18n-ignore

  "ui.pick.newPilot": "नया पायलट", // i18n-ignore
  "ui.pick.furthest": "सबसे दूर की बीकन: {stop}", // i18n-ignore
  "ui.pick.noBeacons": "अभी कोई बीकन नहीं", // i18n-ignore
  "ui.pick.none": "अभी कोई पायलट नहीं — पहला बनाओ", // i18n-ignore
  "ui.pick.fly": "उड़ो", // i18n-ignore
  "ui.pick.remove": "पायलट हटाओ", // i18n-ignore
  "ui.pick.removeAsk": "{name} को हटाएँ? इनकी बीकन भी चली जाएँगी।", // i18n-ignore
  "ui.pick.removeYes": "पायलट हटाओ", // i18n-ignore
  "ui.pick.removeNo": "पायलट रहने दो", // i18n-ignore

  "ui.create.step": "{total} में से चरण {n}", // i18n-ignore
  "ui.create.chooseLook": "अपना रूप चुनो", // i18n-ignore
  "ui.create.typeName": "अपना नाम लिखो", // i18n-ignore
  "ui.create.typeShipName": "अपने यान का नाम लिखो", // i18n-ignore
  "ui.create.next": "आगे", // i18n-ignore
  "ui.create.launch": "उड़ान भरो", // i18n-ignore
  "ui.create.skins": "रंग-रूप", // i18n-ignore
  "ui.create.unlockBeacons": "{n} बीकन के बाद खुलेगा", // i18n-ignore
  "ui.create.unlockStars": "पहले 3-तारे वाले पड़ाव पर खुलेगा", // i18n-ignore
  "ui.create.unlockChain25": "25 की लड़ी पर खुलेगा", // i18n-ignore
  "ui.create.unlockChain50": "50 की लड़ी पर खुलेगा", // i18n-ignore
  "ui.create.unlockRetention": "पूरा शब्द-समूह याद रहने पर खुलेगा", // i18n-ignore

  "ui.ship.ship-1": "गौरैया", // i18n-ignore
  "ui.ship.ship-2": "बाज़", // i18n-ignore
  "ui.ship.ship-3": "चील", // i18n-ignore
  "ui.ship.ship-4": "अल्बाट्रॉस", // i18n-ignore
  "ui.skin.ship-1": "भोर की धारी", // i18n-ignore
  "ui.skin.ship-2": "गहरी नीली धारी", // i18n-ignore
  "ui.skin.ship-3": "बर्फ़ की धारी", // i18n-ignore
  "ui.skin.ship-4": "अंगारे की धारी", // i18n-ignore

  "ui.avatar.avatar-1": "पुच्छल तारा", // i18n-ignore
  "ui.avatar.avatar-2": "चाँद", // i18n-ignore
  "ui.avatar.avatar-3": "तारा", // i18n-ignore
  "ui.avatar.avatar-4": "छल्ला", // i18n-ignore
  "ui.avatar.avatar-5": "चिंगारी", // i18n-ignore
  "ui.avatar.avatar-6": "लहर", // i18n-ignore

  "ui.stop.earth": "पृथ्वी", // i18n-ignore
  "ui.stop.mars": "मंगल", // i18n-ignore
  "ui.stop.jupiter": "बृहस्पति", // i18n-ignore
  "ui.stop.saturn": "शनि", // i18n-ignore
  "ui.stop.uranus": "अरुण", // i18n-ignore
  "ui.stop.neptune": "वरुण", // i18n-ignore
  "ui.stop.pluto": "प्लूटो", // i18n-ignore

  "ui.log.heading": "बीकन सूची", // i18n-ignore
  "ui.log.beacons": "बीकन", // i18n-ignore
  "ui.log.trophies": "इनाम", // i18n-ignore
  "ui.log.lit": "{total} में से {n} जगीं", // i18n-ignore
  "ui.log.notLit": "अभी नहीं जगी", // i18n-ignore
  "ui.log.coords": "λ {lam}°   β {beta}°   r {r} au", // i18n-ignore
  "ui.log.emptyShadow": "अभी सिर्फ़ पृथ्वी जगी है। छह और हमारा इंतज़ार कर रही हैं।", // i18n-ignore
  "ui.log.earned": "मिल गया", // i18n-ignore
  "ui.log.notYet": "अभी नहीं", // i18n-ignore
  "ui.log.trophyCount": "{total} में से {n} मिले", // i18n-ignore

  "ui.trophy.firstLight": "पहली रोशनी", // i18n-ignore
  "ui.trophy.firstLight.how": "पृथ्वी की बीकन जगाओ", // i18n-ignore
  "ui.trophy.pathfinder": "राह खोजी", // i18n-ignore
  "ui.trophy.pathfinder.how": "अपनी पहली बीकन लगाओ", // i18n-ignore
  "ui.trophy.beltRunner": "पट्टी का धावक", // i18n-ignore
  "ui.trophy.beltRunner.how": "मुख्य पट्टी बिना खरोंच पार करो", // i18n-ignore
  "ui.trophy.ringWeaver": "छल्ला बुनकर", // i18n-ignore
  "ui.trophy.ringWeaver.how": "शनि पर तीन तारे", // i18n-ignore
  "ui.trophy.chain25": "लड़ी 25", // i18n-ignore
  "ui.trophy.chain25.how": "लगातार 25 शब्द", // i18n-ignore
  "ui.trophy.chain50": "लड़ी 50", // i18n-ignore
  "ui.trophy.chain50.how": "लगातार 50 शब्द", // i18n-ignore
  "ui.trophy.sharpEye": "तेज़ नज़र", // i18n-ignore
  "ui.trophy.sharpEye.how": "एक जैसे अक्षर से शुरू होते चट्टानों वाली पट्टी पार करो", // i18n-ignore
  "ui.trophy.steadyHull": "मज़बूत कवच", // i18n-ignore
  "ui.trophy.steadyHull.how": "लगातार तीन साफ़ पड़ाव", // i18n-ignore
  "ui.trophy.longMemory": "लंबी याद", // i18n-ignore
  "ui.trophy.longMemory.how": "लौटकर आया हर शब्द याद रखो", // i18n-ignore
  "ui.trophy.mapMaker": "नक्शा बनाने वाला", // i18n-ignore
  "ui.trophy.mapMaker.how": "सातों बीकन जगाओ", // i18n-ignore
  "ui.trophy.darkSide": "अँधेरा पहलू", // i18n-ignore
  "ui.trophy.darkSide.how": "अरुण पर तीन तारे", // i18n-ignore
  "ui.trophy.lastLight": "आख़िरी रोशनी", // i18n-ignore
  "ui.trophy.lastLight.how": "प्लूटो पर बीकन लगाओ", // i18n-ignore

  "ui.settings.heading": "यान के बटन", // i18n-ignore
  "ui.settings.hull": "तुम्हारा यान", // i18n-ignore
  "ui.settings.hullFlying": "अभी उड़ रहा है", // i18n-ignore
  "ui.settings.hullEquip": "इसे उड़ाने के लिए एंटर दबाओ", // i18n-ignore
  "ui.settings.music": "संगीत", // i18n-ignore
  "ui.settings.sfx": "आवाज़", // i18n-ignore
  "ui.settings.keyboardLayout": "कीबोर्ड", // i18n-ignore
  "ui.settings.letterCase": "अक्षरों का आकार", // i18n-ignore
  "ui.settings.letterCaseLower": "छोटे अक्षर", // i18n-ignore
  "ui.settings.letterCaseUpper": "बड़े अक्षर", // i18n-ignore
  "ui.settings.letterSpacing": "अक्षरों में ज़्यादा जगह", // i18n-ignore
  "ui.settings.reducedMotion": "शांत हलचल", // i18n-ignore
  "ui.settings.colorblind": "रंग-सुरक्षित रंगपट", // i18n-ignore
  "ui.settings.resetProgress": "प्रगति मिटाओ", // i18n-ignore
  "ui.settings.resetAsk1": "इससे {name} की हर बीकन, इनाम और तारा मिट जाएगा। पायलट रहेगा।", // i18n-ignore
  "ui.settings.resetAsk2": "एक बार और: सब मिटाकर रास्ता फिर से शुरू करें?", // i18n-ignore
  "ui.settings.resetYes": "हाँ, मिटा दो", // i18n-ignore
  "ui.settings.resetNo": "मेरी प्रगति रहने दो", // i18n-ignore
  "ui.settings.resetDone": "प्रगति मिट गई। पृथ्वी अब भी तुम्हारी रोशनी का इंतज़ार कर रही है।", // i18n-ignore
  "ui.settings.layout.qwerty": "qwerty", // i18n-ignore
  "ui.settings.layout.azerty": "azerty", // i18n-ignore
  "ui.settings.layout.qwertz": "qwertz", // i18n-ignore
  "ui.settings.layout.dvorak": "dvorak", // i18n-ignore
  "ui.settings.lang.en": "english", // i18n-ignore
  "ui.settings.lang.es": "español", // i18n-ignore
  "ui.settings.lang.hi": "हिंदी", // i18n-ignore
  "ui.settings.inputMethod.latin": "लातीनी कीबोर्ड", // i18n-ignore

  "ui.pause.heading": "रुका हुआ", // i18n-ignore
  "ui.pause.resume": "पट्टी में वापस", // i18n-ignore
  "ui.pause.quit": "नक्शे पर जाओ", // i18n-ignore
  "ui.pause.quitAsk": "नक्शे पर लौटें? यह पट्टी अगली बार शुरू से चलेगी।", // i18n-ignore
  "ui.pause.quitYes": "नक्शे पर जाओ", // i18n-ignore
  "ui.pause.quitNo": "उड़ते रहो", // i18n-ignore

  "ui.toast.trophy": "इनाम मिला — {name}", // i18n-ignore
  "ui.toast.skin": "नया रंग-रूप — {name}", // i18n-ignore

  "ui.notice.fresh": "पुरानी सेव नहीं पढ़ पाए, इसलिए यह नई शुरू हो रही है।", // i18n-ignore
  "ui.notice.repaired": "सेव ठीक कर दी। तुम्हारी बीकन अब भी यहीं हैं।", // i18n-ignore
  "ui.notice.writeFailed": "अभी सेव नहीं कर पा रहे, पर तुम उड़ते रह सकते हो।", // i18n-ignore
};

export const UI_TABLES: Readonly<Record<Lang, Record<UiStringKey, string>>> = {
  en: UI_EN,
  es: UI_ES,
  hi: UI_HI,
};
