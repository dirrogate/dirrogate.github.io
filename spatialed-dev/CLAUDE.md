# Cly3DJ SpatialED: decision log

Numbered, append only. One line per change: what, why, numbers, where in the code. Club ports are marked "ported club #3xx" and logged in `ViRe_Custom/CLAUDE.md` too.

1. Forked from Cly3DJ at club decision #330 (5 Oct 2026). Copied `web/`, `tools/`, `blender/` from `ViRe_Custom`. From here on numbers count separately from the club log. Plan: `SpatialED_PLAN.md`.
2. (6 Oct 2026) Plan Part 1 step C, own browser storage so SpatialED and the club app can share a PC, Quest or phone without seeing each other. Backup first: `backups/web_pre_relabel_2026-10-06.zip`. Changes in `web/`:
   - localStorage settings `vire.*` -> `sed.*` (61 places, all js; e.g. sed.handFit, sed.tablet, sed.look, sed.settings, sed.taps).
   - OPFS folders `vire-library/media/press/covers/perf/sky` -> `sed-library/media/press/covers/perf/sky` (storage.js, medialib.js, tools.js, main.js, perfcap.js, skybox.js).
   - main.js taps migration: `k.slice(9)` -> `k.slice(8)` to match the shorter `sed.tap.` prefix.
   - sw.js cache `vire-app-v1` -> `spatialed-app-v1`.
   - net-link.js phone link ID_PREFIX `cly3dj-v1-` -> `cly3dj-sed-v1-` (a SpatialED phone can never pair with the club Quest or the reverse).
   - Names: manifest name "Cly3DJ SpatialED", short_name "SpatialED"; index.html title "Cly3DJ SpatialED"; spectator.html "SpatialED camera"; on-screen "install / reload Cly3DJ" messages say SpatialED.
   - Left alone on purpose: `/vire-music/` (a server URL path for streamed songs, not storage); shader cache keys and audio-worklet names (`vire-mixknob`, `vire-decks`, `vire-pitch`...), which never touch storage; comments, example-record artist "Cly3DJ", PerfCap file header `app: 'Cly3DJ'` (keeps takes readable by the club tools).
   - Effect: SpatialED starts with an empty crate and default settings. No Node restart needed (static files).
3. (6 Oct 2026) Plan Part 1 step D item 9: new folder `dirrogate.github.io/spatialed-dev/` (same file set as cly3dj-dev: index.html, spectator.html, sw.js, manifest, icons, js, models, vendor, examples, plus this CLAUDE.md). Committed locally (commit "spatialed-dev: first test build..."), push from GitHub Desktop. `spatialed/` (release) not created yet: asks first. Online test address once pushed: dirrogate.github.io/spatialed-dev/.
4. (6 Oct 2026) Plan Part 1 step D item 8: Node server `D:\OllamaModels\univdemomaster\server.js` gets an APPS entry `/spatialed` -> `SpatialED_Custom\web`, with its own tapsFile (`web\cly3dj_taps.json`, started as a copy of the club file) and its own WS hub at `/spatialed/ws`. Placed before `/vire-music`; songs still stream from `../vire-music/`. Backup: `server.js.bak-before-spatialed`. Not committed in univdemomaster (that repo already had unrelated uncommitted work). Needs a Node restart once.
5. (6 Oct 2026) Owner: start with an empty crate plus a demo "Lesson", no Rekordbox XMLs. Backup: \`backups/main.js.bak-before-lessoncrate\`.
   - \`web/rekordbox.xml\` and \`web/ViRE_rekordbox.xml\` moved to \`backups/\` (not deleted). The PC crate used to come from these, which is why #2 alone left it full.
   - main.js loadLibrary: on the PC source, no XML is no longer an error; the status reads "Lesson crate (no library XML on the PC)" and the crate starts from emptyLibrary().
   - main.js EXAMPLES: new \`lesson_demo\` "Demo Lesson" (artist SpatialED, genre Lesson, 12", side A only) in its own "Lessons" list. The three club test records (Sleeve Art Demo x2, Test 45) are marked \`club: true\` and hidden by \`SHOW_CLUB_EXAMPLES = false\`, not deleted, so club ports still apply.
   - New \`web/examples/Demo Lesson.mp3\`: 67.5 s, 192 kbps, front cover in ID3. Three instrumental chapters (chords / 120 BPM pulse / melody) starting at 1.0, 23.5 and 46.0 s, with 2.5 s silences between them, so the grooves show two dark chapter bands for the Phase 1 needle-drop test. Instrumental because Piper could not be reached from the session; narration can be baked later.
   - Copied to \`spatialed-dev\` and committed. No Node restart needed.
