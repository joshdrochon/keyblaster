# What is left, in order

Deadline: **Fri 2026-09-18 23:59 CDT**. Written Wed evening.

This is the only document you need to read first. `gauntlet/queue.md` has the
engineering backlog; `gauntlet/escalations.md` has 47 write-ups; `docs/tickets.md`
has ~330 computed tickets. None of that tells you what to *do next*. This does.

---

## 1. The one that decides eligibility — DEPLOY

**Without this the submission's central claim is false.** The hackathon asks for
an AI-powered learning tool. The AI is built and switched off.

| where | variable | value |
|---|---|---|
| serverless env | `ANTHROPIC_API_KEY` | your key. **Never** in the client bundle (NFR-4) |
| build env | `VITE_COACH_ENDPOINT` | `/api/coach` |

`chooseTransport` already prefers the proxy when an endpoint is configured, so
**deploying with those two set switches the AI on with no code change.** The
model id (`claude-haiku-4-5-20251001`) is correct — C11's worry about a
date-suffixed hallucination is resolved, so there is no silent-400-into-fallback
trap waiting.

I have never deployed and never will (D87). This is yours.

**Verify it actually ran.** The fallback is designed to be invisible, which is
right for a child and wrong for a demo: if the endpoint is down you see the
canned text and cannot tell. Play one warp break after deploying and confirm the
sentence is built from words you just typed.

---

## 2. Record the demo video — 2–3 minutes

A hackathon requirement. Suggested shape, in the order that shows the strongest
material first:

1. **Title → Earth → first belt.** Establishes the loop in 20 seconds.
2. **Miss some words deliberately.** This is the setup for the payoff.
3. **The warp break** — the sentence composed from *the words you just missed*.
   Say out loud that it is generated per child, and that every word of it passed
   an allowlist before a seven-year-old saw it. **This is the AI claim; give it
   the most time.**
4. **The beacon and the map lighting up.** The emotional beat.
5. **Settings**, briefly — it reads as the ship's console, not a web form.

What to say about safety, because it plays well to engineer judges: a language
model writes text that children read, and four gates check every word of its
output against a curated allowlist before it is shown. That is a harder problem
than the generation and we solved it.

---

## 3. Play it yourself before you submit

Not the tests — the game. Earth to Pluto, as a child would. Everything found
tonight that mattered was found by someone looking at the screen.

The board will say ~330 tickets and a high pass rate. Do not trust that over
your own eyes; the suite was green over an unplayable game, over asteroids
invisible against open sky, over a voice pipeline that shipped no audio, and
over six reports of the same edge bars.

---

## 4. Optional, in value order if time remains

| | what | why |
|---|---|---|
| a | **Error-pattern analysis in the coach** | The second defensible AI claim. Today the coach gets a flat list of missed words; noticing that a child misses `th` across unrelated words, or collapses on words over six letters, is pattern recognition a template cannot do. |
| b | **Judge the seven music tracks** | I generated them and cannot hear them. If one is wrong for its stop — too tense, too sad, wrong energy for a child — say which and I regenerate it for pennies. |
| c | **Work the escalation queue** | ~47 write-ups, each with options, evidence and a lean. Most need a yes/no. An hour would clear the majority. |

---

## Known and deliberate, so nothing surprises you

- **Spanish and Hindi are cut** from the shipped menu (D95). The content is
  complete, translated and still under test; restoring it also needs the content
  globs widened (C14) because `contentLang` currently reaches nothing.
- **Windows narrower than 16:9 keep top and bottom bars.** The world widens but
  never narrows, because narrowing crops: the Beacon Log runs 384px off the
  right edge at 1440. Side bars are gone at every ratio.
- **The most common warp break has no voice.** Seven mock coach templates
  interpolate the child's own missed word, so they are shapes rather than
  sentences and cannot be pre-rendered. Under D98 they are silent rather than
  spoken by the platform voice. Deploying (§1) replaces them with real model
  output and closes this.
- **`P-22.9` and `L-6e.1` need a headed 60fps capture** you have to run; a
  headless renderer cannot produce that evidence. Both are escalated.
- **The world art is a first cut of a new grammar** (D97, space rather than
  terrain) and has not had a blind critic yet.

---

## What was actually fixed tonight, if a judge asks what changed

- The game was **uncompletable** — no stop unlocked the next.
- The belt was **100% unsurvivable** for a grade-2 typist. The game never
  learned a child's typing speed: 100 stalls in 100 runs, now 0.
- **Asteroids were invisible** on six of seven stops; on two they matched the
  sky exactly.
- **Trophies could never be earned**; twelve were defined and none reachable.
- **No audio shipped at all** — the voice files were never emitted by the build.
- **Sky-borne text ran at 1.19:1 contrast** across five screens.
- There was **no music**.

Six of those were a single defect class: a complete, unit-tested,
coverage-gated engine module that nothing in the running game ever called. There
is now an architectural test that fails when a persisted field has no live
writer, which is the guard that would have caught all six.
