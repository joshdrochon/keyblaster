// @gauntlet-allow G-pii  — this file DEFINES the banned key list, so it must
// name the forbidden fields. The waiver is printed in every gauntlet report.

/**
 * PII guard (D43, AC-18.2, NFR-3).
 *
 * D43 is "profiles, not accounts": a profile is a name and an avatar. NFR-3 says
 * no PII is stored or transmitted. The structural defence is in schema.ts -
 * serialisation copies named fields one at a time, so an unknown property on an
 * in-memory object cannot reach storage even if someone adds one to the type.
 *
 * This file is the second line: a deep key scan that the unit tests run against
 * the serialised payload, the canonical field list, and the source of
 * types.ts itself. If someone adds `email` to Profile, those tests go red.
 */

/**
 * Key tokens that must never appear in persisted data. Matching is done on a
 * normalised key (lowercased, non-alphanumerics stripped), so `e-mail`,
 * `parentEmail` and `parent_e_mail` all collapse onto "email".
 *
 * COPPA is the reason the list includes the "who and where" fields as well as
 * contact fields (D43 cites it): a birthday plus a first name plus a city is
 * identifying even though no single one of them is an email address.
 */
export const PII_KEY_TOKENS: readonly string[] = [
  "email",
  "mail",
  "birthday",
  "birthdate",
  "dateofbirth",
  "dob",
  "age",
  "phone",
  "telephone",
  "mobile",
  "address",
  "street",
  "postcode",
  "postalcode",
  "zip",
  "city",
  "surname",
  "lastname",
  "familyname",
  "fullname",
  "realname",
  "school",
  "parent",
  "guardian",
  "ssn",
  "gender",
  "photo",
  "geo",
  "latitude",
  "longitude",
  "ip",
  "deviceid",
  "fingerprint",
];

/** Lowercase, drop everything that is not a letter or digit. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The PII token a key matches, or null.
 *
 * Whole-token equality, not substring containment: `ip` as a substring would
 * flag `shipId` and `shipName`, and a guard that cries wolf on the ship gets
 * deleted by the next person who trips over it. Prefix/suffix composition is
 * still caught ("parentEmail" -> "parentemail" contains "parent" and "email"),
 * so the scan tests each token as a word-ish part of the normalised key.
 */
export function piiTokenFor(key: string): string | null {
  const k = normalizeKey(key);
  if (k.length === 0) return null;
  for (const token of PII_KEY_TOKENS) {
    if (k === token) return token;
    // Composite keys: the token must sit on a boundary of the ORIGINAL key
    // (camelCase hump, separator, or start/end) to count. "shipId" must not
    // match "ip"; "parentEmail" must match "parent" and "email".
    for (const part of splitKeyParts(key)) {
      if (part === token) return token;
    }
  }
  return null;
}

/** "parentEmail" -> ["parent", "email"]; "parent_e_mail" -> ["parent","e","mail"]. */
export function splitKeyParts(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+|\s+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 0);
}

/**
 * Walk any value and return the paths of every key that looks like PII.
 * Cycle-safe and depth-bounded, because it is also pointed at fuzzed input.
 */
export function findPiiKeys(value: unknown, maxDepth = 12): string[] {
  const hits: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth || node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const here = path.length === 0 ? key : `${path}.${key}`;
      if (piiTokenFor(key) !== null) hits.push(here);
      walk(child, here, depth + 1);
    }
  };

  walk(value, "", 0);
  return hits;
}

/** Throws with every offending path. Used by tests and by nothing at runtime. */
export function assertNoPii(value: unknown, what = "payload"): void {
  const hits = findPiiKeys(value);
  if (hits.length > 0) {
    throw new Error(`${what} contains PII-shaped keys (NFR-3): ${hits.join(", ")}`);
  }
}
