import { describe, it } from "vitest";
import { heliocentricEclipticAtJd } from "@engine/ephemeris/index.js";
import ref from "./ref.json" with { type: "json" };

describe("diag", () => {
  it("prints deltas", () => {
    for (const [jd, bodies] of Object.entries(ref as Record<string, Record<string, {lambdaDeg:number;betaDeg:number;rAu:number}>>)) {
      for (const [name, exp] of Object.entries(bodies)) {
        const got = heliocentricEclipticAtJd(name as never, Number(jd));
        let dl = got.lambdaDeg - exp.lambdaDeg;
        if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
        console.log(jd, name.padEnd(8), "dλ", dl.toFixed(4).padStart(9), "dβ", (got.betaDeg-exp.betaDeg).toFixed(4).padStart(9), "dr", (got.rAu-exp.rAu).toFixed(5).padStart(9), "it", got.keplerIterations);
      }
    }
  });
});
