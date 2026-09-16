import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PII_KEY_TOKENS,
  PROFILE_FIELDS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  assertNoPii,
  blankProfile,
  encodeState,
  findPiiKeys,
  loadState,
  piiTokenFor,
  serializeState,
  splitKeyParts,
} from "@engine/persistence/index.js";
import type { Profile } from "@engine/types.js";
import { FakeStorage, populatedProfile } from "./fixtures.js";

const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

describe("piiTokenFor", () => {
  it("flags contact fields however they are spelled", () => {
    for (const key of ["email", "Email", "e-mail", "parentEmail", "parent_email", "E_MAIL"]) {
      expect(piiTokenFor(key), key).not.toBeNull();
    }
    for (const key of ["phoneNumber", "homeAddress", "dateOfBirth", "dob", "zipCode", "guardianName"]) {
      expect(piiTokenFor(key), key).not.toBeNull();
    }
  });

  it("does not cry wolf on the fields a profile legitimately has", () => {
    // "ip" is a PII token and "shipId"/"shipName" contain it. A guard that
    // flags the ship gets switched off by the next person who trips on it.
    for (const key of [...PROFILE_FIELDS, "stopId", "shipId", "shipName", "lastWpm", "lastAccuracy", "ikiMs"]) {
      expect(piiTokenFor(key), key).toBeNull();
    }
  });

  it("ignores empty and punctuation-only keys", () => {
    expect(piiTokenFor("")).toBeNull();
    expect(piiTokenFor("---")).toBeNull();
  });

  it("splits camelCase and separators alike", () => {
    expect(splitKeyParts("parentEmail")).toEqual(["parent", "email"]);
    expect(splitKeyParts("parent_e_mail")).toEqual(["parent", "e", "mail"]);
    expect(splitKeyParts("zip-code")).toEqual(["zip", "code"]);
  });
});

describe("findPiiKeys", () => {
  it("reports the path of every offending key", () => {
    expect(findPiiKeys({ a: { b: [{ email: "x" }] } })).toEqual(["a.b[0].email"]);
  });
  it("survives cycles and extreme depth, because it is pointed at fuzz too", () => {
    const cyclic: Record<string, unknown> = { name: "ok" };
    cyclic["self"] = cyclic;
    expect(() => findPiiKeys(cyclic)).not.toThrow();
    let deep: unknown = { email: "buried" };
    for (let i = 0; i < 40; i += 1) deep = { a: deep };
    expect(findPiiKeys(deep, 4)).toEqual([]);
  });
  it("assertNoPii throws with the offending paths and is silent otherwise", () => {
    expect(() => assertNoPii({ profile: { email: "a@b.c" } }, "state")).toThrow(/profile\.email/);
    expect(() => assertNoPii({ profile: { name: "Ada" } })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-18.2 / NFR-3: a profile is name + avatar. No PII exists anywhere.
// ---------------------------------------------------------------------------

describe("AC-18.2 / NFR-3: no PII is ever persisted", () => {
  it("AC-18.2: the serialised payload contains no PII-shaped key", () => {
    const payload = encodeState({
      version: SCHEMA_VERSION,
      profiles: [populatedProfile("a"), blankProfile({ id: "b", createdAt: 1 })],
      activeProfileId: "a",
    });
    expect(findPiiKeys(payload)).toEqual([]);
    assertNoPii(payload, "persisted payload");
  });

  it("AC-18.2: the canonical field list is name + avatar, and would fail if a contact field were added", () => {
    for (const field of PROFILE_FIELDS) {
      expect(piiTokenFor(field), `PROFILE_FIELDS contains ${field}`).toBeNull();
    }
    expect(PROFILE_FIELDS).toContain("name");
    expect(PROFILE_FIELDS).toContain("avatar");
    // The fixture below proves the assertion has teeth.
    expect(piiTokenFor("email")).toBe("email");
  });

  it("AC-18.2: an email smuggled onto a profile object cannot reach storage", () => {
    // NFR-3's structural defence: encoding copies named fields one at a time,
    // so even a profile object carrying a contact field serialises without it.
    const polluted = {
      ...populatedProfile("a"),
      email: "kid@example.com",
      parentPhone: "555-0100",
      birthday: "2015-04-02",
    } as unknown as Profile;
    const json = serializeState({ version: SCHEMA_VERSION, profiles: [polluted], activeProfileId: "a" });
    expect(json).not.toContain("kid@example.com");
    expect(json).not.toContain("555-0100");
    expect(json).not.toContain("2015-04-02");
    expect(findPiiKeys(JSON.parse(json))).toEqual([]);
  });

  it("AC-18.2: PII in a stored payload is dropped on load, not carried forward", () => {
    const hostile = JSON.stringify({
      version: SCHEMA_VERSION,
      activeProfileId: "a",
      profiles: [{ id: "a", name: "Ada", email: "kid@example.com", address: { city: "Lisbon" } }],
    });
    const storage = new FakeStorage({ [STORAGE_KEY]: hostile });
    const result = loadState(storage, { freshProfile: () => blankProfile({ id: "f", createdAt: 0 }) });
    expect(findPiiKeys(result.state)).toEqual([]);
    expect(serializeState(result.state)).not.toContain("kid@example.com");
  });

  it("AC-18.2 / NFR-3: types.ts declares no PII field on Profile", () => {
    // The strongest form of "would fail if someone added one": read the shared
    // contract off disk. Adding `email: string` to Profile turns this red even
    // if nobody remembers this module exists.
    const src = repoFile("src/engine/types.ts");
    const identifiers = [...src.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1] ?? "");
    const offenders = identifiers.filter((id) => piiTokenFor(id) !== null);
    expect(offenders).toEqual([]);
  });

  it("NFR-3: the persistence module declares no PII field either", () => {
    for (const file of ["schema.ts", "load.ts", "store.ts", "migrations.ts", "port.ts"]) {
      const src = repoFile(`src/engine/persistence/${file}`);
      const identifiers = [...src.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1] ?? "");
      const offenders = identifiers.filter((id) => piiTokenFor(id) !== null);
      expect(offenders, file).toEqual([]);
    }
  });

  it("NFR-3: the token list itself is non-empty and normalised", () => {
    expect(PII_KEY_TOKENS.length).toBeGreaterThan(10);
    for (const token of PII_KEY_TOKENS) expect(token).toBe(token.toLowerCase());
  });
});
