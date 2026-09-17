# Shadow voice candidates

Shadow is a small robot co-pilot (D66, D91: charcoal body, cream face rim,
pale-blue eyes and antenna tip). The brief: **male, not deep, slightly robotic
in tone.**

## Shipped

**Liam — `TX3LPaxmHKxFdv7VOQHJ`**, at `stability: 0.92`, `style: 0`,
`use_speaker_boost: false`. All 28 lines are rendered in `src/content/audio/voice/`.

`stability` is the lever that produces "robotic": near 1.0 it flattens prosody
toward monotone. `style: 0` keeps performance out of it. The warmth has to come
from the words, not the delivery — a robot that emotes is a mascot, and the
character sheet is a little utility bot.

## Candidates, same line, same settings

Line: mars.preflightLine — "Belt ahead. Rocks with words on them. Type the word,
the blaster does the rest. Ready when you are."

| file | voice | id | character |
|---|---|---|---|
| **m-liam.mp3** | **Liam** | `TX3LPaxmHKxFdv7VOQHJ` | young, articulate, light — **shipped** |
| m-charlie.mp3 | Charlie | `IKne3meq5aSn9XLyUdCD` | Australian, casual, young |
| m-will.mp3 | Will | `bIHbv24MWmeRgasZH58o` | friendly, mid-weight |
| m-chris.mp3 | Chris | `iP95p4xoKVk53GoZ742B` | casual |

Sam (`yoZ06aMxZJJ28mfd3POQ`) returns 402 — paid plans only.

The four `sarah/alice/matilda/lily` files are an earlier female pass, kept only
so the choice is auditable. Not used.

**I picked Liam on documented voice character, not by listening — I cannot hear
these.** If it is wrong, play the samples and re-run:

    node scripts/render-voice.mjs --live --voice <id> --cap-usd 1

`--stability <0..1>` tunes how mechanical it sounds; 0.92 is the current value.

## Known gap

Rendering is only half the job. **Nothing in `src/` plays these files** — the game
still speaks through the Web Speech stand-in (D88). A file-playback transport is
queued in `gauntlet/queue.md` as item 1.8. Until it lands, these 29 files ship
unused.

## Key limitation

The key is restricted and lacks `voices_read`, so the catalogue could not be
listed; every id above was tested directly against the API. Granting `voices_read`
would let `--list-voices` enumerate everything on the account.
