import { describe, expect, it } from "vitest";
import { createCoachValidator, validateComposedSentence } from "@engine/coach";
import { coachAllowlist, sightWordList } from "@game/scenes/support/vocab";
import { hasStageBundle, stageBundle } from "@game/scenes/lib/content";
import { STOP_IDS, type StopId } from "@engine/types";

/**
 * THE COACH, MEASURED ON THE DEPLOYED ENDPOINT, AGAINST THE SHIPPED GATES.
 *
 * ================== WHY THIS FILE EXISTS ==================
 * Every other test in this repo proves the gates work. None of them can tell
 * you whether a REAL reply from a REAL model gets through them, and that is
 * the only question a player's screen answers. The coach shipped broken for
 * days with a green suite behind it: a pool cap that refused every request
 * before a token was spent, a ```json fence that broke every parse, a 1200 ms
 * budget against a 2 s call, prompt examples the model copied verbatim, and a
 * note whose one off-list word failed the whole payload and took the composed
 * sentence with it. Not one of those was visible from a unit test, because
 * every one of them looked identical from outside: "the stock sentence".
 *
 * ================== WHY IT IS OPT-IN ==================
 * It spends real money and it talks to the internet, so D87 keeps it off by
 * default. Nothing runs unless `COACH_SWEEP_URL` is set:
 *
 *     COACH_SWEEP_URL=https://keyblaster.vercel.app npx vitest run tests/live
 *
 * At the shipped Haiku pricing a full sweep is about 0.04 USD.
 *
 * ================== WHY VARIED WORDS ==================
 * The first version of this measurement used ONE fixed set of missed words per
 * stop, and reported six stops green while the owner hit failures in play. The
 * hard words are in the prompt, so they shape what the model writes: a stop is
 * only measured by sweeping several sets of them. `SAMPLES` per stop, drawn
 * from that stop's own pool with a fixed seed so a red run is reproducible.
 */

const URL_BASE = process.env["COACH_SWEEP_URL"];
const SAMPLES = Number(process.env["COACH_SWEEP_SAMPLES"] ?? 5);
/** The endpoint's own limiter is 12 per minute per IP; stay under it. */
const PACE_MS = 5_500;
/** Below this the AI beat is not reaching players and someone has to look. */
const MIN_PASS_RATE = 0.8;

interface Reply {
  readonly note?: string;
  readonly variants?: readonly string[];
  readonly sentence?: string;
  readonly error?: string;
}

/** Deterministic pick, so a failure can be reproduced exactly. */
function pick(pool: readonly string[], seed: number, count: number): string[] {
  const out: string[] = [];
  let n = seed;
  const span = Math.min(40, pool.length) - 3;
  while (out.length < count) {
    n = (n * 1103515245 + 12345) % 2147483648;
    const word = pool[3 + (n % span)];
    if (word !== undefined && !out.includes(word)) out.push(word);
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe.skipIf(URL_BASE === undefined)("the coach reaches the child, per stop", () => {
  it(
    "every stop clears both gates on varied runs",
    async () => {
      const validator = createCoachValidator({ allowlist: coachAllowlist("en") });
      const belts = STOP_IDS.filter(
        (s) => hasStageBundle(s) && stageBundle(s).warpSentence !== null,
      );
      const rows: string[] = [];
      let ok = 0;
      let total = 0;

      for (const stop of belts as StopId[]) {
        const bundle = stageBundle(stop);
        const shipped = bundle.warpSentence ?? "";
        const why: string[] = [];
        let stopOk = 0;

        for (let sample = 0; sample < SAMPLES; sample += 1) {
          const words = pick(bundle.pool, sample + 1, 3);
          const missed = words.slice(0, 2);
          const slow = words.slice(2);
          const body = {
            stopId: stop,
            lang: "en",
            missed,
            slow,
            hitRate: 0.8,
            mode: "warp",
            pool: bundle.pool,
            blasted: bundle.pool.slice(0, 3),
            shipped,
          };

          const res = await fetch(`${URL_BASE ?? ""}/api/coach`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const reply = (await res.json()) as Reply;
          total += 1;

          if (reply.error !== undefined) {
            why.push(`err:${reply.error}`);
          } else {
            const payload = validator.validate(reply);
            const sentence = validateComposedSentence(reply.sentence, {
              allowlist: coachAllowlist("en"),
              pool: bundle.pool,
              sightWords: sightWordList("en"),
              practised: [...missed, ...slow, ...body.blasted],
            });
            const echo = reply.sentence === shipped;
            if (payload.ok && sentence.ok && !echo) stopOk += 1;
            else if (!payload.ok) why.push(`note:${payload.reason}`);
            else if (echo) why.push("echo");
            else if (!sentence.ok) why.push(`sent:${sentence.reason}`);
          }
          await sleep(PACE_MS);
        }

        ok += stopOk;
        rows.push(`${stop.padEnd(8)} ${stopOk}/${SAMPLES}  ${why.join(" ")}`);
      }

      const report = `${rows.join("\n")}\nTOTAL ${ok}/${total}`;
      // eslint-disable-next-line no-console
      console.log(report);
      expect(ok / total, report).toBeGreaterThanOrEqual(MIN_PASS_RATE);
    },
    30 * 60_000,
  );
});
