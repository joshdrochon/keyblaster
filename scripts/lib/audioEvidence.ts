/**
 * AUDIBLE EVIDENCE FOR THE AUDIO LANE.
 *
 * Three of the user reports this lane answers are things only a person can
 * close: a hum that is "annoying", typing that is not "satisfying", a blast
 * that feels "empty". A passing assertion is not evidence for any of those, so
 * this writes WAV files of exactly what the shipping code produces and puts
 * them where a human can play them.
 *
 * It renders through `tests/unit/audio/offline.ts` - the same harness the unit
 * tests measure with - driving the REAL buses at the REAL bus gains, so what
 * comes out of here is what comes out of the game, not an approximation of it.
 *
 * Run: node scripts/render-audio-evidence.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OfflineAudioContextLike } from "../../tests/unit/audio/offline.js";
import { AmbientBus } from "../../src/game/audio/ambient.js";
import { SfxBus } from "../../src/game/audio/sfx.js";
import { KeystrokeTone } from "../../src/game/audio/keystrokeTone.js";
import { playChirp } from "../../src/game/audio/chirp.js";
import { busSpec } from "../../src/game/audio/graph.js";
import type { GainNodeLike } from "../../src/game/audio/context.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(REPO, "gauntlet/evidence/audio");
const SR = 48000;

/** 16-bit mono PCM WAV. Nothing here needs a library. */
function wav(samples: Float32Array, sampleRate = SR): Buffer {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] as number));
    bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return bytes;
}

function onBus(bus: "ambient" | "sfx" | "voice"): {
  ctx: OfflineAudioContextLike;
  output: GainNodeLike;
} {
  const ctx = new OfflineAudioContextLike(SR);
  const output = ctx.createGain();
  output.gain.value = busSpec("master").gain * busSpec(bus).gain;
  output.connect(ctx.destination);
  return { ctx, output };
}

function write(name: string, samples: Float32Array): void {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `${name}.wav`);
  writeFileSync(path, wav(samples));
  let pk = 0;
  let sq = 0;
  for (const v of samples) {
    pk = Math.max(pk, Math.abs(v));
    sq += v * v;
  }
  const rms = Math.sqrt(sq / samples.length);
  console.log(
    `  ${name.padEnd(28)} ${(samples.length / SR).toFixed(1)}s  peak ${pk.toFixed(4)}  rms ${rms.toFixed(4)}`,
  );
}

console.log(`\nrendering audible evidence into ${OUT.slice(REPO.length + 1)}\n`);

// 1. UR-13. The bed, alone, for long enough to be annoying if it still is.
for (const stop of ["earth", "jupiter", "pluto"] as const) {
  const { ctx, output } = onBus("ambient");
  const bus = new AmbientBus(ctx, output);
  bus.start(stop);
  write(`ur13-bed-${stop}`, ctx.render(25, (_t, dtMs) => bus.advance(dtMs)));
}

// 2. UR-13. The warp takeoff, three variants in a row.
{
  const { ctx, output } = onBus("sfx");
  const bus = new SfxBus(ctx, output);
  for (let k = 0; k < 3; k++) {
    ctx.currentTime = k * 2.2;
    bus.play("warp");
  }
  ctx.currentTime = 0;
  write("ur13-warp-takeoff", ctx.render(8));
}

// 3. UR-30. A FULL BELT of typing, at real cadence. The whole point of this
//    file: a cue that sounds fine once is exactly how you ship something
//    unbearable by word forty, so the evidence is the fortieth word.
{
  const { ctx, output } = onBus("sfx");
  const bus = new SfxBus(ctx, output);
  const tone = new KeystrokeTone(ctx, output);
  let t = 0;
  for (let word = 0; word < 40; word++) {
    const letters = 4 + (word % 4);
    for (let k = 0; k < letters; k++) {
      ctx.currentTime = t;
      bus.play("keystroke");
      tone.correct();
      t += 0.19;
    }
    // One mistyped key every fifth word, so the typo cue is in the belt too.
    if (word % 5 === 4) {
      ctx.currentTime = t;
      bus.play("typo");
      tone.typo();
      t += 0.24;
    }
    ctx.currentTime = t;
    bus.play("lock");
    bus.play("blast");
    tone.reset();
    t += 0.75;
  }
  ctx.currentTime = 0;
  write("ur30-full-belt", ctx.render(t + 1.5));
}

// 3b. UR-34. The switch on its own, and then the A/B a human has to judge:
//     eight correct keys, eight mistyped ones, then the two alternating. If the
//     mistyped key sounds different from the correct one, that is a verdict the
//     sound is delivering and D31 says it must not.
{
  const { ctx, output } = onBus("sfx");
  const bus = new SfxBus(ctx, output);
  const tone = new KeystrokeTone(ctx, output);
  let t = 0;
  for (let k = 0; k < 24; k++) {
    ctx.currentTime = t;
    bus.play("keystroke");
    tone.correct();
    if (k % 6 === 5) tone.reset();
    t += 0.19;
  }
  ctx.currentTime = 0;
  write("ur34-keys-bare", ctx.render(t + 0.6));
}
{
  const { ctx, output } = onBus("sfx");
  const bus = new SfxBus(ctx, output);
  const tone = new KeystrokeTone(ctx, output);
  let t = 0;
  const press = (event: "keystroke" | "typo"): void => {
    ctx.currentTime = t;
    bus.play(event);
    if (event === "keystroke") tone.correct();
    else tone.typo();
    t += 0.24;
  };
  for (let k = 0; k < 8; k++) press("keystroke");
  t += 0.7;
  for (let k = 0; k < 8; k++) press("typo");
  t += 0.7;
  for (let k = 0; k < 8; k++) press(k % 2 === 0 ? "keystroke" : "typo");
  ctx.currentTime = 0;
  write("ur34-typo-vs-correct", ctx.render(t + 0.6));
}

// 4. UR-30. Six blasts alone, so the body and the tail are audible on their own.
{
  const { ctx, output } = onBus("sfx");
  const bus = new SfxBus(ctx, output);
  for (let k = 0; k < 6; k++) {
    ctx.currentTime = k * 1.1;
    bus.play("blast");
  }
  ctx.currentTime = 0;
  write("ur30-blast", ctx.render(7.5));
}

// 5. UR-25. Shadow's chirp, alone and then over the bed he speaks across.
{
  const { ctx, output } = onBus("voice");
  for (let k = 0; k < 3; k++) {
    ctx.currentTime = k * 1.2;
    playChirp(ctx, output);
  }
  ctx.currentTime = 0;
  write("ur25-chirp", ctx.render(4));
}
{
  const ctx = new OfflineAudioContextLike(SR);
  const master = ctx.createGain();
  master.gain.value = busSpec("master").gain;
  master.connect(ctx.destination);
  const ambientBus = ctx.createGain();
  ambientBus.gain.value = busSpec("ambient").gain;
  ambientBus.connect(master);
  const voiceBus = ctx.createGain();
  voiceBus.gain.value = busSpec("voice").gain;
  voiceBus.connect(master);
  const bed = new AmbientBus(ctx, ambientBus);
  bed.start("earth");
  for (let k = 0; k < 3; k++) {
    ctx.currentTime = 0.8 + k * 1.2;
    playChirp(ctx, voiceBus);
  }
  ctx.currentTime = 0;
  write("ur25-chirp-over-bed", ctx.render(5, (_t, dtMs) => bed.advance(dtMs)));
}

console.log("");
