# Cly3DJ: project overview

Updated 14 Oct 2026 (decision log up to #346 in `ViRe_Custom/CLAUDE.md`). Written so a new Claude session (for example on Claude cloud) can pick the project up from here: read this file, then the newest entries at the bottom of `CLAUDE.md`.

Cly3DJ is a two-deck vinyl DJ setup for the Meta Quest 3, running in the browser (WebXR). It keeps the old-school vinyl workflow and adds modern help, but never a flat-out auto sync. It started from Vinyl Reality Lite as a visual reference; it is our own app, built with three.js, and copies nothing from Vinyl Reality.

Owner: Clyde DeSouza (c3souza).

## Where things live

- **Source:** `C:\Users\cly3d\Downloads\ViRe_Custom\web` (served locally by the owner's Node server at `localhost:8000/vire/`). The server only serves static files, so code changes never need a restart (say so each time anyway, see Working rules).
- **Decision log:** `ViRe_Custom/CLAUDE.md`, numbered entries, append only (one line per change: what, why, numbers, where in the code).
- **Overview copy on disk:** `ViRe_Custom/PROJECT.md` (same text as this file).
- **Hosting (GitHub Pages):** repo `dirrogate/dirrogate.github.io`, local clone `Documents/GitHub/dirrogate.github.io`.
  - Test builds: `dirrogate.github.io/cly3dj-dev/` (also holds a copy of `CLAUDE.md`).
  - Release: `dirrogate.github.io/cly3dj/` (everything in dev except `CLAUDE.md`).
  - Phone camera page: `…/spectator.html` in either folder.
- **Release flow (owner's rule):** edit in `web/`, copy the changed files to `cly3dj-dev/` and commit there (author "Clyde DeSouza <cly3desouza@gmail.com>", with the Claude co-author lines), then ASK before copying to `cly3dj/`.
  - **From the PC:** the owner pushes both in GitHub Desktop. Claude's shell on the PC can't reach github.com (proxy 403).
  - **From a Claude cloud session (#345):** attach `dirrogate/dirrogate.github.io` to the session, clone it, build on top of `cly3dj-dev/`, commit, and push only after the owner says so. The owner then pulls in GitHub Desktop and copies the changed files back: `cly3dj-dev/js/*` to `ViRe_Custom/web/js/`, `cly3dj-dev/sw.js` to `web/`, and `cly3dj-dev/CLAUDE.md` to `ViRe_Custom/` (not `web/`), so `web/` never falls behind dev.
  - **Reading the Drive copy from the cloud:** the Drive connector's `search_files` with maximum snippets returns a file's text (Markdown-escaped, indents collapsed, the end of very large files cut off). It is good for reading and for checking a rebuild (compare with whitespace collapsed, then match the exact byte size), not for copying files back verbatim.
- **Git lock files:** commits from Claude's shell leave `.git/*.lock` and `tmp_obj_*` files; delete them after every commit (needs the owner's delete permission for the repo folder, asked once per session), or the owner's next push fails.
- **Backups:** `ViRe_Custom/backups/`, per-change folders (`pre-…`) plus full zips. Files Claude can't delete go to `ViRe_Custom/_to_delete/`.
- **Blender sources:** `ViRe_Custom/blender/`. **Renders:** `ViRe_Custom/renders/`. **Tools:** `ViRe_Custom/tools/` (`make_sleeve_demo.py` builds `web/examples/`). **Test panoramas:** `ViRe_Custom/test_panos/`.
- **Models:** decks `web/models/` (GLB turntable, AO bake `turntable_ao.png/json`); avatars `web/models/avatar/avatar_robot_v2.glb` (the Cly3DJ robot, see Video and avatar), the older `avatar_robot.glb` (licensed model as delivered, #245) and `gemini_emboss.png` (its cup crest), `dirroface.glb` (owner's Ready Player Me avatar). Controller and hand models are vendored in `web/vendor/webxr-input-profiles/` (`meta-quest-touch-plus`, `generic-hand`).

## Tech

- three.js r169, vendored (no npm or CDNs).
- Service worker (#222): the whole app is saved on install, network first with a 2.5 s limit. Songs and videos are never cached. New JS files must be added to the `APP` list in `sw.js`.
- Audio: both decks in one AudioWorklet (`deck-worklet.js`: Int16 PCM, motor and platter physics, scratching, 45 wobble), mixer graph in Web Audio.
- Storage: Origin Private File System for songs, videos, the media library and stamped records.
- Phone link: WebRTC data channels plus one video slot (#238), handshake over ntfy.sh.
- Headset frame rate: 72 Hz (#267; 90 Hz dropped ~13 frames per 10 s). Foveation stays 0.5 (owner: don't change it).
- Syntax check: `node --input-type=module --check < file.js`.

## Main code files (web/js)

- `main.js`: scene, decks, mixer, crate, tablet pages (DJ MIXER, VISUALS, TOOLS), stage, sleeves, records in the open, phone host start.
- `xr.js`: WebXR input: grabs (trigger / grip / pinch), pokes, platter and record handling, knobs and faders, controller looks (3D hands, glove, controller), blue tip ball. Movable props (GoPro, chat panel, portal, wall) go through one generic `ctx.props` path (hit / grab / hold / release, plus corner / scaleTo when resizable).
- `ctlhands.js`: the posed generic hand on a controller (grip space placement, finger curls, the thumb-index O, the fixed touch point, HAND FIT offsets).
- `deck-glb.js`, `deck-inst.js`: the GLB turntable (platter dots, strobe lamp, 45 adapter, buttons) and its instancing.
- `deck-worklet.js`: deck physics and audio. `audio.js`: mixer graph.
- `stream.js`: LIVE STREAM to Twitch (WHIP, #331): sources, SHOWTIME! layers, HEADSET CAM mixed reality, PREVIEW rehearsal.
- `gopro.js`: the movable GoPro camera prop (#337). `chat.js`: Twitch chat reader, chat panel and chalkboard (#340, #341).
- `facetwall.js`: the faceted backdrop (#345, wrap / height / distance #346). `portal.js`: the real-world windows cut into it and the dome (#345, up to 6 #346). `beat.js`: bass onsets on the master for the wall's BEAT (#346).
- `robot2.js`, `director.js`: robot avatar and AVACAM. `spectator-host.js` (Quest) / `spectator-client.js` + `phonehands.js` (phone).
- `textures.js`, `models.js`: records, grooves, labels, sleeves, procedural parts.

## The DJ setup

- **Decks:** direct-drive turntables with motor start and brake, 33/45, pitch fader with an X2 button (±8% / ±16%, default ±8%), tonearm and needle, platter physics for scratching, spindle twist and back-cueing. No pitch centre click any more.
- **Frozen feel numbers (#270 to #274, owner: don't change):** thumbstick flick = 0.01% pitch (hold repeats every 80 ms); fine pitch = quarter speed (hold the pitch fader with the trigger and squeeze the same controller's grip, or the other hand's trigger / pinch); platter rim nudge at half strength. (The spindle's 1/64 gearing is gone, see below.)
- **Spindle (#322, owner-approved physics):** the spindle is part of the platter, so pinching it (trigger on the spindle) is a friction torque on a 7.2 mm pin, at most ~0.022 N m, under a quarter of what the quartz servo holds with no speed change. Twist forward = record a little ahead (~1.4 ms per quick twist), pinch still or twist back = a little behind; the speed hardly changes, the dots and the +/- readout show the small blip. No gearing; bigger moves are for the label or the platter side.
- **Sound of the stylus (#320):** a velocity cartridge into RIAA: off-speed moves (back-cue, scratch, nudge, start / stop) get vinyl's tone and level (held record = silent, slow rocks = boomy kick); normal play at the set speed and pitch is untouched.
- **Mixer tablet +/- readout (#319):** the platter's live speed (eased), so nudges and spindle twists show; it reads the fader value when steady.
- **LOCK (one-shot, not auto sync):** averages the two decks' BPM and glides both pitch faders there in 0.4 s (motor speed, no time-stretch); with BEAT 1 tapped on both, the follower's motor then runs up to 8 % faster or slower until its nearest beat meets the lead's (the last pitch fader touched), like a long hand push.
- **Tonearm:** grab the finger lift (trigger) and carry it anywhere over the record; it lands where it is let go (over the lead-in: first groove). Holding it on a playing record drags the needle; lifting the hand by NEEDLE LIFT (DJ TOOLS > HAND FIT, default 7 cm, #323) lifts it off.
- **Hands on the platter (controllers):** trigger on the record, to its edge, holds it while the platter spins on under the slipmat (SL-1200 style) and scratches; the record only comes off with the grip. Touch the platter's side (outside the record) with the tip ball and move it to nudge, no button.
- **45s (#255 to #262):** 7" records and sleeves, a 45s list in the crate, STAMP RECORD 7" / 12", the grabbable 45 adapter (spider); without it a 45 wobbles with wow. Plan: `45s-plan.md`. The slipmat moves with the record (#275).
- **Records:** grooves from each track's loudness (rules fixed: `groove-rendering-rules.md`). Labels and sleeves from ID3 pictures (#231, #232).
- **Mixer:** 2 channels with trim, 3-band EQ with kills, filter, sticky PAN, CUE, BEAT 1, faders, crossfader, master, meters, MIC, LOCK (one-shot meet-in-the-middle sync), SPLIT cue (flashing), RESET MIX (two taps).
- **🎧 MIX knob (#334):** above the crossfader: headphone balance only (left = cue, centre = cue + master both full, right = master), own limiter; master and stream untouched. Meter legend LEVEL sits between the front LEDs.
- **MIC (#334):** LEVEL half of the knob now goes from off up to +20 dB (was +6); DUCK half unchanged.
- **Mixer tablet:** DJ MIXER, VISUALS (tabs incl. AVACAM and SCROLLER, #342), TOOLS home = DJ TOOLS (Record Maker, milk crate, CONTROLLERS look, HAND FIT), VJ TOOLS (scroller, LED wall, neon), STREAM (incl. PORTALS + PORTALS SETUP, #346), CHALKBOARD. Temporary flicker tests on TOOLS home (GLASS TEST, CAM 2ND FRAME, FPS); remove once the flicker question is closed.
- **Moving gear:** with controllers the grip moves gear (decks, mixer, crates, LED wall with tilt); the trigger never does.
- **Stage:** flight case (resizable, top up to 5 ft / 1.52 m, #329), record crate with lid monitor, neon sign, LED wall, up to 6 milk crates, the faceted backdrop and portal (#345); spatial anchor (GEAR HERE re-pins).

## Controllers and hands (#276 to #296)

- **Looks** (DJ TOOLS > CONTROLLERS, or the start page "Controllers look like"; saved as `vire.ctlLook`): 3D HANDS (default), GLOVE (the Cly3DJ robot's glove at 110 %, driven by the hidden 3D hand's joints, cuff closed by a cap) or CONTROLLER (bare Touch Plus). In hand modes the controller model is hidden.
- **The grab (#294, owner: "this works"):** a light grey see-through ball sits on the inner side of the thumb pad. Aim it at a knob, fader or record and press: the index (curled at rest, #295) comes up and the thumb meets it in an O, and the drawn hand slides ~2.8 cm so the O closes round the ball. The ball / touch point is one fixed point in grip space and never moves, so grabs land where you aimed.
- **Buttons:** knobs, faders and pitch faders = trigger; record hold / scratch = trigger; lifting a record off the platter, records lying about, sleeves and the record riding out of a sleeve, gear, power dial, START / STOP = grip only (#316, #324); tap buttons with the ball. The finger rests on button caps instead of going through (drawn hand lifted).
- **Knobs in the 3D HANDS / GLOVE looks (#328):** follow the twist about the controller's own long axis (turn it like a key; the O grip holds the controller level or nose-up, where the old top-down reading weakened or reversed). The CONTROLLER look keeps the old reading.
- **Bare hands (no controllers, #323 to #327):** small grey ball on the index fingertip; fingertip on the grooves = scratch, on the platter side = nudge (both ways); pinch anywhere on the record = hold it while the platter spins, moving the pinch rocks it (back-cue thump), pinch and lift 3 cm takes it off; START / STOP, 33 / 45 / X2 = a deliberate pinch (no taps); target lamp = pinch and hold 1.5 s (it goes dark as soon as it sinks); knobs need half the wrist turn (125 deg full travel); the hand mesh is rebuilt when the Quest swaps hands between slots (was drawn mangled).
- **Hand pose input:** from the select / squeeze events (not gamepad.pressed, which flickers); thumb-stick and A / B touches don't move the thumb (#296).
- **Alignment with the real hand:** not solved; parked by the owner. HAND FIT on the tablet (move / turn, 5 mm / 5 deg steps, saved as `vire.handFit`, sent to the phone) is there for that day.
- **Controller mode ball:** placed from the owner's 1 mm crosshair renders (#285).

## LED wall sources (VISUALS, LED button)

OFF > CLIPS > VIDVINYL > AVACAM > LIVE > SOLO (LIVE and SOLO only while the phone is linked). LED wall can be tilted (#250).

## Backdrop and portal (#345)

- **FACETWALL (`facetwall.js`):** a faceted backdrop in front of the DJ booth that hides the real room from the passthrough camera. 150 deg arc of 9 flat panels, radius 1.85 m round the DJ side of the mixer, 2.15 m tall; from the DJ spot it stands about 0.8 m (ends) to 2.2 m (centre) ahead. Forward-facing only: turning round still shows the real room (chat / chalkboard side). One image runs across all the panels (cyclorama). MODE = FRACTAL (Julia shader on the GPU, 512 x 256 target) or SCREEN (`env.wallSource()`, the same layers as the stream's VIDEOWALL, 20 fps into a 1024 x 456 canvas). Grip / pinch on the panels moves it. Saved as `vire.facetwall`.
- **PORTAL (`portal.js`):** a rectangular real-world window (0.6 x 1.5 m, 0.4x to 4x by its silver corner tab or a second grip) cut into the wall, to park over the owner's floor mirror so HEADSET CAM still shows him. `Portal.cutInto(obj)` cuts it into any mesh (onBeforeCompile discard inside the rectangle; no depth test, a flat always-visible window), so any glb room or cabin later is one call. Thin dark bezel. Starts just in front of the wall's centre panel (behind the neon sign). Saved as `vire.portal`.
- **Tablet (TOOLS > STREAM):** WALL, MODE, PORTAL on both layouts; tap = on / off, double-tap = back to the start spot.
- **#346 PORTALS SETUP (STREAM page > PORTALS SETUP):** toggles PORTALS, WALL, FRACTAL / SCREEN, BEAT, DOME, DEFAULTS (two taps); steppers PORTALS count 1-6, WRAP 60-360 deg (slats ~53 cm fan out / fold in, 360 = all the way round), HEIGHT 0.5-4 m, DISTANCE 1-6 m, DOME SIZE 3-20 m, FRACTAL SPEED and COLOUR CYCLE 0-4x. Each frame any rectangle: trigger / pinch on its silver side handle = width, top handle = height, corner L = both. The cut is a true window per eye / camera: only what lies beyond a frame is removed, so a 360 wall isn't cut behind the DJ, and the dome is cut too. DOME = the VISUALS sky (PANO > SKY, still or video) as a grounded dome round the booth, also in passthrough. BEAT = bass onsets on the master (after the limiter): the wall flashes, the fractal kicks.
- **Review fixes before dev (cloud session):** the first build put the wall and portal behind the DJ (wall yaw PI, portal mixer z +1.9), SCREEN was upside down and 35 % stretched, and the wall could only be grabbed at floor level by the case. Positions saved by that build are kept: double-tap WALL and PORTAL once.

## Video and avatar

- **VideoVinyl** (#177): an MP3 plus a same-titled video follows the record's playhead.
- **The Cly3DJ robot** (#305 to #308): our own robot avatar, an original look designed for Cly3DJ in Blender (`blender/robot_v2/robot_v2.blend`, renders `renders/robot_v2_*.png`). It is built on the base mesh and rig of the AvatarRobot model by EntroPi Games, used with permission (#245), so keep that credit wherever the robot is described. Look: chrome helmet with no headband; headphones in the shape of the dirrogate Gemini logo (black cups, red logo painted on, #308); a chin ridge; breast plate and collar cut into flat sides (three seen from the front, lit by custom normals, #307); black gloves with chrome-painted squares on the finger and thumb backs (a normal map fakes their raised edge, #311) and a chrome back plate; each glove capped on its own geometry (#312, fixed the right glove's stretched fingers) (`ctlhands.chromePads` turns the bright texels chrome); KITT voice bars on the visor with the MIC (#313, #314: bars grow from the centre line and fade to dim red at their ends; medium voice = tall centre bar and two at ~60 %; loud = brighter, pink-white core and five bars). 7.5k triangles in all (head 5.1k, cups 0.2k, 1.1k per glove), drawn twice while AVACAM is on. Path in `robot2.js` `ROBOT_GLB`, used by the Quest robot, the glove look and the phone.
- **AVACAM** (#220): a virtual camera films the robot DJ copying the DJ's head, hands and fingers.
- **Robot on the phone** (#278): tablet DJ CAM page > ROBOT ON PHONE. The Quest sends poses and mic level; the phone poses its own robot. Steps 2 to 4 of `avatar-stage-plan.md` (AVAOTS / AVAFRONT shots, LED wall behind the robot, HDMI output) not built.

## Live stream to Twitch (#331 to #343)

- **Transport:** the Quest goes live by itself: WebRTC to Twitch's WHIP ingest (`https://g.webrtc.live-video.net:4443/v2/offer`, stream key as Bearer; CORS passes from a page). No PC, relay or BeamXR. Owner-tested working on the Quest (13 Oct). Stream key and chat channel on the start page (`vire.twitchKey`, `vire.twitchChannel`, headset only).
- **Sound:** master after the limiter (music + MIC when routed through the mixer), tapped before the headphone mix (`audio.js streamTrack()`), so CUE never reaches the stream. Opus stereo 16- **TOOLS > STREAM page (#331, #372, #373):** status line; sources CARD, AVACAM, SHOWTIME!, VJ SETUP (opens the VISUALS pages), PHONE (SHOWTIME! stays active when HEADSET CAM or PHONE CAM is selected); BACKDROP toggle (NONE / VISUALS / DOME); OBJECTS ▸ button to the SHOWTIME! OBJECTS page; overlays (SCROLLER, NOW PLAYING, LOGO, CHAT); GO LIVE split with PREVIEW; GOPRO + zoom; CAM FIT; PORTALS / PORTALS SETUP (#346); CHAT button (header) to the chat page. END STREAM = two taps.
- **SHOWTIME! (#336, #338, #372, #373):** modular live shot combining a camera pick plus object toggles. Camera picks: GOPRO, FRONT, FADERS, HEADSET CAM, and PHONE CAM folded in. Object toggles (on the SHOWTIME! OBJECTS page): LED WALL, GOPRO (prop), NEON, CHAT PANEL, CHALKBOARD, GEAR, ROBOT. Presets: FULL, LEAN, FIRST PERSON. Backdrop: NONE, VISUALS, or DOME. Scroller appears directly on the 3D LED wall when in shot and facing camera; flat overlay when wall is not in shot or off, never both. HEADSET CAM forces off 3D LED wall and robot. Turntable shells instanced via deckInst (#154) cleanly hidden when GEAR is off.
- **HEADSET CAM (#333, #372):** mixed reality: the Quest camera picture with virtual gear overlaid; under SHOWTIME! the robot and 3D LED wall are automatically forced off so the real room shows, while preserving user object toggles upon switching back.
- **GOPRO (#337, #338, #372):** dual role as both an active camera angle (goproToDjcam) and a physical prop in the scene that other cameras can film with its tally lamp on; hidden only from its own shot.
- **PREVIEW (#339):** the tablet's slide-out screen shows the outgoing frame (~7 fps) with a LIVE / REHEARSAL badge; off air the source is rehearsed (drawn, not sent).
- **Twitch chat (#340, #343):** read-only, anonymous IRC over `wss://irc-ws.chat.twitch.tv:443`, channel dirrogate; emotes from Twitch's CDN; '@dirrogate' and '!request' highlighted. Shown on the tablet CHAT page, on a floating chat panel (grip to move; filmed when the GoPro / AVACAM has it in shot) and as the SHOWTIME! CHAT layer. Replying needs a Twitch login (later).
- **CHALKBOARD (#341, #342):** TOOLS home CHALKBOARD (or the CHAT page) turns the panel into a slate with white / yellow / soft pink chalk and a duster on its ledge; touch to pick, touch the board to write (deeper = thicker, fast strokes skip); WIPE on the CHAT page; resizable 0.5x to 6x by its corner tab or a second grip; part of the scene, so the cameras film it. Drawings are not saved between sessions.
- **Cost (measured on the PC, #334, #372):** live render-time readout (`djcam.ms`) shown on the SHOWTIME! OBJECTS page. Toggles save GPU rendering time.
- **YouTube:** not started (no browser ingest found; may need a relay).

## Spectator phone camera

A Samsung M33 (S22 / S24 planned) films the DJ with the virtual gear composited in (AR or fixed tripod, look matching, virtual set, PerfCap). Details: `spectator-camera-plan.md`, `fixed-cam-switcher-plan.md`, `perfcap-plan.md`, `avatar-stage-plan.md`, `club-switcher-plan.md`. Since #288 the phone draws the DJ's hands like the Quest (3D hands / glove / controllers) instead of cut-outs; realistic hand textures are a later idea. In SHOWTIME! (#372), PHONE CAM receives the calibrated front/back phone feed and Quest overlays decks and selected objects via `pcamPrep`.

## Status (16 Oct)

- Release (cly3dj) has everything up to #343 (released in #344). Dev (cly3dj-dev) also has #345 (commit `64d372d`, pushed from a Claude cloud session) and #346 (PORTALS SETUP, multi-portals, dome, beat); release waits for the owner's go.
- Built 16 Oct (#370, #372, #373):
  - Chalkboard tray auto-orients to lowest edge (#370a).
  - Twitch QR code on CARD plate (#370b).
  - Scroller curve fix matching curved LED wall (#370c).
  - SHOWTIME! modular rebuild (#372, #373): AVACAM wall feedback fix, per-object hide list, Neon always-visible rule when toggled on, scroller on 3D wall vs flat overlay, camera pick row (GOPRO, FRONT, FADERS, HEADSET CAM, PHONE CAM), OBJECTS page (toggles, presets, djcam.ms readout), settings migration (`migrateShowOpts`), and deckInst turntable shell gear toggle cure.
- Parked / waiting: Step (f) club screen (`screen.html` via WebRTC + code), and #371 items (depth test, laser prop, SHOUTS, crowd contours).

## Next steps

1. Owner tests #372 / #373 SHOWTIME! modular redesign:
   - Stream page: BACKDROP cycle (NONE / VISUALS / DOME), OBJECTS ▸ navigation.
   - SHOWTIME! OBJECTS page: Camera pick row, object toggles, PRESETS (FULL, LEAN, FIRST PERSON), and render time readout.
   - Verify GEAR toggle completely removes turntables (including shells via `deckInst`) and mixer.
   - Verify scroller displays on 3D LED wall when facing camera and switches to flat overlay when wall is turned away or toggled off.
   - Verify Neon remains visible in FRONT, GOPRO, and HEADSET views when toggled on.
2. Step (f) CLUB SCREEN (`screen.html` WebRTC receiver with pairing code for Fire TV stick).
3. #371 feature backlog (when unparked): Quest depth test, laser prop, SHOUTS queue / ntfy relay, crowd contours.
1a. Owner tests the 13 Oct stream features on the Quest: SHOWTIME! with the GoPro, PREVIEW, chat panel, chalkboard (write, wipe, resize), 🎧 MIX, mic range; frame rate with SHOWTIME! on. Then YouTube; chat replies (Twitch login); chalkboard saving and on the phone if wanted.
1b. Owner tests on the Quest: bare-hands mode (#323 to #327), spindle torque (#322), cartridge / RIAA sound (#320), 3D-hand knob twist (#328), the robot on the phone. Settle the NEEDLE LIFT value and make it the default.
2. Hand alignment with the real hand. To do (owner, 5 Oct, not built): HAND FIT > CALIBRATE: rest the controller on a flat surface (its last pose is kept), let the Quest switch to hand tracking, wrap the tracked hand round the resting controller for a second; the wrist / finger joints relative to the kept controller pose become each hand's exact fit and finger shape (averaged over ~1 s), replacing the manual HAND FIT offsets. Background: in WebXR hand tracking is off while controllers are held, so there are no hand joints in controller mode; Meta's native hands-on-controllers aren't exposed to web pages.
3. Robot shots on the phone: AVAOTS / AVAFRONT, LED wall behind the robot, HDMI 16:9 output (`avatar-stage-plan.md`).
4. Close the flicker hunt and remove the TOOLS test switches.
5. Hand colliders (saved for later, #299): push the drawn hand / glove out of the mixer, decks and case (one box per hand, eased, off during a grab, phone too); cheap, well under 0.1 ms a frame.
6. Parked: Blender AO rebake (owner: looks fine), realistic hand textures, mixed hands + controllers (multimodal), cabin selector (`quest-director-plan.md`; the portal can be cut into a cabin glb with one `cutInto` call), PerfCap phase 2, YouTube on the LED wall (`youtube-tv-plan.md`), Spout.

## Testing on the PC

- Claude's browser pane: `http://localhost:8000/vire/?r=<anything new>` (cache bust), click **Desktop**, wait ~2 s, then drive it with `window.vire` (decks, setMotor, placeOnDeck, xr, _sleeve, _spider, camera, controls, facetWall, wallTap, portal, portalTap…). Desktop camera presets fight a moved camera; for close-ups render the scene into a separate canvas / renderer.
- Phone role on the PC: `index.html?role=camera`, hooks in `window.spect` (`_robo`, `_ph`).
- Exact placement questions (ball, hand on the controller): render 1 mm crosshair views of the GLB in Python (the owner reads off X / Y), as in #285.
- Cloud session (no PC): serve a copy of `cly3dj-dev/` with `python3 -m http.server`, open it in headless Chromium (Playwright, SwiftShader WebGL), click `#bDesktop`, then render from the DJ's eye (rig 0.05, 1.65, 0.62) with a separate WebGLRenderer. To see what passthrough would show, hide the studio room and use a coloured background as the "real world". Render targets belong to one renderer, so tick the FacetWall fractal with the test renderer too. The 404s for `rekordbox.xml`, `ViRE_rekordbox.xml`, `cly3dj_taps.json` and `/api/taps` are expected on a deploy copy.

## Working rules

- Tell the owner whenever the Node server needs a restart after a code change (so far never: static files).
- Always copy changes to `cly3dj-dev` and commit, then ask before copying to `cly3dj` (release). From a cloud session, also ask before pushing.
- Don't change foveation. The owner DJs with one controller.
- Back up before bigger changes (`backups/pre-…`) and log every change in `CLAUDE.md`.
- Never break the record groove rules.
- Discuss before building when the owner says "don't build yet" or "before you implement".
- For the owner's documents: sans-serif (Calibri 10 pt), underlined sub-headings, no em dashes.
