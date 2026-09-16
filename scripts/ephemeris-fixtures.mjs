#!/usr/bin/env node
/**
 * Regenerate the AC-17.1 reference fixture (architecture section 5, item 4).
 *
 *   node scripts/ephemeris-fixtures.mjs            print the fixture
 *   node scripts/ephemeris-fixtures.mjs --deltas   also measure our error
 *
 * WHY THIS EXISTS. The fixture was hand-pasted, and a hand-pasted fixture is a
 * dead end: if DE441 is superseded, or a fourth epoch is wanted, or the
 * tolerances need re-deriving, nothing committed can do it. A critic flagged
 * exactly that. This script closes it.
 *
 * WHY IT IS NOT SELF-REFERENTIAL. It asks NASA/JPL Horizons for DE441 state
 * VECTORS - a numerically integrated ephemeris - and converts X/Y/Z to
 * lambda/beta/r with nothing but atan2/asin/hypot. The module under test uses
 * approximate Keplerian elements, a completely different method. The two
 * disagreeing by ~0.1 deg in the Jupiter-Saturn great inequality is the
 * evidence that the fixture is independent; a self-generated one would agree
 * to 1e-13.
 *
 * NETWORK. This is the only script in the repo that makes a network call, it
 * is never run by the gauntlet or by npm test, and it hits a free public NASA
 * endpoint with no key. Guardrails (D87) are unaffected: nothing here deploys
 * and nothing here costs money.
 */

import { writeFileSync } from "node:fs";

const HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api";

/** Horizons COMMAND ids. Earth is the Earth-Moon barycentre, as JPL publishes. */
const BODIES = {
  earth: "3",
  mars: "4",
  jupiter: "5",
  saturn: "6",
  uranus: "7",
  neptune: "8",
  pluto: "9",
};

/** The three epochs AC-17.1 pins: J2000, and two dates spanning the mission. */
const EPOCHS = [2451545.0, 2460310.5, 2469807.5];

const RAD = 180 / Math.PI;

async function vectorsAt(command, jd) {
  const url =
    `${HORIZONS}?format=json&COMMAND='${command}'&EPHEM_TYPE=VECTORS` +
    `&CENTER='500@10'&REF_PLANE='ECLIPTIC'&VEC_TABLE='1'&OUT_UNITS='AU-D'` +
    `&TLIST='${jd}'&CSV_FORMAT='YES'&OBJ_DATA='NO'`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Horizons ${res.status} for ${command} @ ${jd}`);
  const { result } = await res.json();

  const body = result.slice(result.indexOf("$$SOE"), result.indexOf("$$EOE"));
  const row = body.split("\n").find((l) => l.includes(","));
  if (!row) throw new Error(`no vector row for ${command} @ ${jd}`);
  const [, , x, y, z] = row.split(",").map((c) => c.trim());
  const source = /DE[- ]?(\d{3})/.exec(result)?.[0] ?? "unknown";
  return { x: Number(x), y: Number(y), z: Number(z), source };
}

/** Cartesian ecliptic -> spherical. atan2/asin/hypot and nothing else. */
function toEcliptic({ x, y, z }) {
  const r = Math.hypot(x, y, z);
  const lambdaDeg = (Math.atan2(y, x) * RAD + 360) % 360;
  const betaDeg = Math.asin(z / r) * RAD;
  return { lambdaDeg, betaDeg, rAu: r };
}

const round = (n, p) => Number(n.toFixed(p));

async function main() {
  const wantDeltas = process.argv.includes("--deltas");
  const rows = [];

  for (const [stop, command] of Object.entries(BODIES)) {
    for (const jd of EPOCHS) {
      const v = await vectorsAt(command, jd);
      const c = toEcliptic(v);
      rows.push({
        stop,
        jd,
        lambdaDeg: round(c.lambdaDeg, 6),
        betaDeg: round(c.betaDeg, 6),
        rAu: round(c.rAu, 8),
        source: v.source,
      });
      process.stderr.write(`  ${stop.padEnd(8)} jd ${jd}  ${v.source}\n`);
      // Courtesy pacing for a free public endpoint.
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  writeFileSync(
    "gauntlet/evidence/ephemeris-reference.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2) + "\n",
  );
  console.log(JSON.stringify(rows, null, 2));

  if (wantDeltas) {
    // Measure OUR error against the fixture, so the tolerance constants in
    // tests/unit/ephemeris/reference.ts are derived numbers rather than
    // numbers someone picked.
    const { heliocentricEclipticAtJd } = await import("../src/engine/ephemeris/index.ts");
    let dl = 0, db = 0, dr = 0;
    for (const row of rows) {
      const ours = heliocentricEclipticAtJd(row.stop, row.jd);
      const wrap = (a) => Math.min(Math.abs(a), 360 - Math.abs(a));
      dl = Math.max(dl, wrap(ours.lambdaDeg - row.lambdaDeg));
      db = Math.max(db, Math.abs(ours.betaDeg - row.betaDeg));
      dr = Math.max(dr, Math.abs(ours.rAu - row.rAu));
    }
    console.error(
      `\nmeasured worst case: dLambda ${dl.toFixed(4)} deg, ` +
      `dBeta ${db.toFixed(4)} deg, dR ${dr.toFixed(4)} AU\n` +
      `AC-17.1 allows 1 deg / 1 deg / 0.05 AU.`,
    );
  }
}

main().catch((e) => {
  console.error(`ephemeris-fixtures failed: ${e.message}`);
  process.exit(1);
});
