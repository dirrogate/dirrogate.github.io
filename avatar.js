// ==========================================
// AR, 3D & MULTIPLAYER ENGINE (avatar.js)
// ==========================================

let xrSession = null;
let xrRenderer = null;
let xrScene, xrCamera;

// Multiplayer State
window.wsClient = null;
window.localClientId = null;
window.remoteEntities = {};
window.clientRole = "ar_human"; 
window.activeSpeakerId = null; 

// Calibration Landmark State
window.roomOriginOffset = new THREE.Vector3(0, 0, 0);
window.isOriginCalibrated = false;
window.hitTestReticle = null;
window.compassContainer = null;

// Joystick State
window.moveTouch = { active: false, x: 0, y: 0 };
window.lookTouch = { active: false, x: 0, y: 0 };

window.checkXRSupport = function() {
    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
            if (supported) window.updateLog("Diagnostics: AR Core detected. Physical mode unlocked.");
            else window.updateLog("Diagnostics: No AR camera detected. Use 'Remote Room User' mode.");
        });
    } else {
        window.updateLog("Diagnostics: WebXR not available. Use 'Remote Room User' mode.");
    }
};

window.updateARStatus = function(msg) {
    const statusEl = document.getElementById("ar-status-text");
    if (statusEl) statusEl.innerHTML = `> ${msg}`;
};

window.ensureSceneReady = function() {
    if (!xrScene) {
        xrScene = new THREE.Scene();
        
        // Lighting is used by the GLB jellyfish avatar's PBR materials.
        // MeshBasicMaterial parts (glow, name plate) ignore these lights.
        xrScene.add(new THREE.AmbientLight(0x404040, 2.0));
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
        keyLight.position.set(2, 4, 3);
        xrScene.add(keyLight);

        window.updateLog("[Graphics] Scene container pre-initialized early for asynchronous synchronization.");
        
        window.compassContainer = window.createCompass();
        xrScene.add(window.compassContainer);

        const ringGeo = new THREE.RingGeometry(0.12, 0.15, 32);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xdd6b20, side: THREE.DoubleSide });
        window.hitTestReticle = new THREE.Mesh(ringGeo, ringMat);
        window.hitTestReticle.visible = false;
        window.hitTestReticle.matrixAutoUpdate = false; 
        xrScene.add(window.hitTestReticle);
    }
};

// ==========================================
// JELLYFISH AVATAR (GLB, skinned mesh)
//
// Loads simple_jellyfish.glb once and caches the template. Every spawned
// avatar gets its own SkeletonUtils.clone() of the scene (so bone state
// stays independent per avatar) plus its own AnimationMixer playing the
// "StandardMoving" clip on a loop. Material is swapped to a translucent
// MeshBasicMaterial tinted per role (cyan / purple / violet). A soft head
// glow (additive sprite + PointLight) sits at the bell, pulsing while that
// entity is the active speaker.
// ==========================================

const JELLYFISH_GLB_URL = "simple_jellyfish.glb";
const JELLYFISH_CLIP_NAME = "StandardMoving";

// ================================================================
// TUNABLE CONFIG — adjust jellyfish size, floor placement, and
// name-plate / speech-bubble layout here without touching logic.
// ================================================================

// --- Overall size ---
const JELLYFISH_HEIGHT_FEET = 4.1;
const FEET_TO_METERS = 0.3048;
const JELLYFISH_TARGET_HEIGHT = JELLYFISH_HEIGHT_FEET * FEET_TO_METERS;

// --- Floor placement ---
// How far (meters) the lowest tentacle tip sits above the AR floor plane.
const TENTACLE_FLOOR_CLEARANCE = 0.005;

// --- Name plate + speech bubble layout (meters, world-space) ---
const NAME_PLATE_GAP_ABOVE_HEAD = 0.08;
const NAME_PLATE_WORLD_H        = 0.15;
const NAME_BUBBLE_GAP           = 0.05;
const SPEECH_BUBBLE_WORLD_H     = 0.40;
const PLATE_BUBBLE_WORLD_W      = 0.80;

// --- Text sizing (canvas pixels) ---
const NAME_PLATE_FONT_PX           = 28;
const SPEECH_BUBBLE_FONT_PX        = 24;
const SPEECH_BUBBLE_LINE_HEIGHT_PX = 32;

let jellyfishTemplate = null;
let jellyfishLoadingPromise = null;

// Role -> tint color
function getRoleTint(isAgent, role) {
    if (isAgent) return 0x9b72f0;            // violet  — ai_agent
    if (role === "ar_human") return 0x00e5ff; // cyan    — ar_human
    return 0xb24bf3;                          // purple  — remote_human
}

function loadJellyfishModel() {
    if (jellyfishLoadingPromise) return jellyfishLoadingPromise;

    jellyfishLoadingPromise = new Promise((resolve, reject) => {
        const loader = new THREE.GLTFLoader();
        loader.load(
            JELLYFISH_GLB_URL,
            (gltf) => {
                // Measure natural height from the GLB as exported (no rotation
                // correction applied here — the correction is applied per-clone
                // in attachJellyfishToGroup so it is never double-applied).
                const box = new THREE.Box3().setFromObject(gltf.scene);
                const size = new THREE.Vector3();
                box.getSize(size);
                // GLB default orientation is already upright, so size.y is
                // the true standing height.
                const naturalHeight = size.y > 0 ? size.y : 1;
                const scale = JELLYFISH_TARGET_HEIGHT / naturalHeight;

                window.updateLog(
                    `[Diag] Jellyfish GLB loaded. naturalHeight=${naturalHeight.toFixed(4)}, ` +
                    `scale=${scale.toFixed(4)}, animations=${gltf.animations.map(a => a.name).join(", ")}`
                );

                jellyfishTemplate = { scene: gltf.scene, animations: gltf.animations, scale };
                resolve(jellyfishTemplate);
            },
            undefined,
            (err) => {
                window.updateLog(`<span style="color:red">[Diag] Jellyfish GLB failed to load: ${err.message || err}</span>`);
                reject(err);
            }
        );
    });

    return jellyfishLoadingPromise;
}

// Replaces every mesh material in the cloned scene with a single translucent
// MeshBasicMaterial tinted for this avatar's role. skinning:true is required
// so the GPU vertex shader applies per-bone skin matrices; without it the
// mesh freezes in bind pose regardless of how the AnimationMixer drives bones.
function applyTranslucentMaterial(root, tintHex) {
    const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(tintHex),
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
        skinning: true,
    });
    root.traverse((node) => {
        if (node.isMesh) node.material = mat;
    });
    return mat;
}

// Builds the bell glow effect: an additive sprite + soft PointLight anchored
// at the top of the model. Returns { sprite, light, baseScale, baseIntensity }
// so animateAvatars() can drive the speaking pulse.
function buildHeadGlow(root, tintHex) {
    const box = new THREE.Box3().setFromObject(root);
    const topY    = box.max.y;
    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128; glowCanvas.height = 128;
    const gctx = glowCanvas.getContext('2d');
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    const c = new THREE.Color(tintHex);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    grad.addColorStop(0,   `rgba(${rgb},0.9)`);
    grad.addColorStop(0.5, `rgba(${rgb},0.35)`);
    grad.addColorStop(1,   `rgba(${rgb},0)`);
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);

    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
    }));

    // Size the glow relative to total jellyfish height so it stays
    // proportional regardless of JELLYFISH_HEIGHT_FEET tuning.
    const HEAD_GLOW_SIZE_FRACTION = 0.22;
    const HEAD_GLOW_SINK_FRACTION = 0.65;
    const glowSize = JELLYFISH_TARGET_HEIGHT * HEAD_GLOW_SIZE_FRACTION;
    glowSprite.scale.set(glowSize, glowSize, 1);
    glowSprite.position.set(centerX, topY - glowSize * HEAD_GLOW_SINK_FRACTION, centerZ);
    glowSprite.renderOrder = 1;
	
//////////////////////////////////////////////////	
//  TURNED LIGHT OFF FOR SAVING DRAW CALL 
////////////////////////////////////////////////
//   const glowLight = new THREE.PointLight(tintHex, 0.6, 1.2, 2);
//   glowLight.position.copy(glowSprite.position);
// return { sprite: glowSprite, light: glowLight, baseScale: glowSize, baseIntensity: 0.6 };
///////////////////////////////////////////////////////

	return { sprite: glowSprite, baseScale: glowSize, baseIntensity: 0.6 };
}

// Attaches a fully configured jellyfish avatar onto `group` asynchronously.
// The GLB load + SkeletonUtils.clone are async, so body/glow/mixer attach
// onto the group a moment after createDirrogate() returns.
function attachJellyfishToGroup(group, isAgent, role) {
    const tintHex = getRoleTint(isAgent, role);

    loadJellyfishModel().then((template) => {
        const clonedScene = THREE.SkeletonUtils.clone(template.scene);

        // No rotation applied — the GLB's default orientation is correct
        // (bell on top, tentacles hanging down). Do not add rotation here.
        clonedScene.scale.setScalar(template.scale);

        // FLOOR ANCHORING: shift the model so its lowest visual point sits
        // at TENTACLE_FLOOR_CLEARANCE above y = 0, regardless of where the
        // GLB's own origin was authored.
        clonedScene.updateMatrixWorld(true);
        const bodyBox = new THREE.Box3().setFromObject(clonedScene);
        clonedScene.position.y += (TENTACLE_FLOOR_CLEARANCE - bodyBox.min.y);

        const bodyMat = applyTranslucentMaterial(clonedScene, tintHex);
        clonedScene.traverse((node) => { if (node.isMesh) node.renderOrder = 0; });

        const glow = buildHeadGlow(clonedScene, tintHex);

        group.add(clonedScene);
        group.add(glow.sprite);
        group.add(glow.light);

        const mixer = new THREE.AnimationMixer(clonedScene);
        const clip = template.animations.find((a) => a.name === JELLYFISH_CLIP_NAME) || template.animations[0];
        let idleAction = null;
        if (clip) {
            idleAction = mixer.clipAction(clip);
            idleAction.reset();
            idleAction.setLoop(THREE.LoopRepeat, Infinity);
            idleAction.setEffectiveTimeScale(1);
            idleAction.setEffectiveWeight(1);
            idleAction.paused = false;
            idleAction.enabled = true;
            idleAction.play();
            window.updateLog(`[Diag] Jellyfish idle action playing: clip="${clip.name}", duration=${clip.duration.toFixed(3)}s, tracks=${clip.tracks.length}`);
        } else {
            window.updateLog(`<span style="color:#dd6b20">[Diag] Jellyfish GLB has no animation clip to play.</span>`);
        }

        group.jellyfishScene        = clonedScene;
        group.jellyfishMat          = bodyMat;
        group.mixer                 = mixer;
        group.idleAction            = idleAction;
        group.headGlowSprite        = glow.sprite;
        group.headGlowLight         = glow.light;
        group.headGlowBaseScale     = glow.baseScale;
        group.headGlowBaseIntensity = glow.baseIntensity;

        if (!group.floatParts) group.floatParts = [];
        group.floatParts.push({ node: clonedScene, baseY: clonedScene.position.y });
        group.floatParts.push({ node: glow.sprite,  baseY: glow.sprite.position.y });
    }).catch(() => {
        // loadJellyfishModel() already logged the error; the avatar will
        // still show its name plate / speech bubble with no body.
    });
}

function createDirrogate(isAgent = false, username = "Unknown", role = "remote_human") {
    const group = new THREE.Group();

    group.floatPhase = Math.random() * Math.PI * 2;
    group.floatParts = [];

    // Null shims so animateAvatars() head-wobble / core-pulse guards
    // (ent.mesh.core, ent.mesh.head) stay false and no-op for this avatar.
    group.head = null;
    group.core = null;

    attachJellyfishToGroup(group, isAgent, role);

    // ===== NAME PLATE + SPEECH BUBBLE (single combined sprite) =====
    // Both are painted into different vertical regions of one canvas so
    // the entire UI overlay costs exactly one draw call.
    //
    // Canvas region layout (top = world +Y due to CanvasTexture flipY):
    //   rows [0 .. bubblePx)               -> speech bubble
    //   rows [bubblePx .. bubblePx+gapPx)  -> empty gap
    //   rows [bubblePx+gapPx .. height)    -> name plate
    const totalPlateWorldH = SPEECH_BUBBLE_WORLD_H + NAME_BUBBLE_GAP + NAME_PLATE_WORLD_H;

    const plateCanvas = document.createElement('canvas');
    plateCanvas.width  = 512;
    plateCanvas.height = Math.round(plateCanvas.width * (totalPlateWorldH / PLATE_BUBBLE_WORLD_W));
    const pctx = plateCanvas.getContext('2d');

    const bubblePx = Math.round(plateCanvas.height * (SPEECH_BUBBLE_WORLD_H / totalPlateWorldH));
    const gapPx    = Math.round(plateCanvas.height * (NAME_BUBBLE_GAP / totalPlateWorldH));
    const namePx   = plateCanvas.height - bubblePx - gapPx;

    const plateTex    = new THREE.CanvasTexture(plateCanvas);
    const plateSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: plateTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
    }));
    plateSprite.scale.set(PLATE_BUBBLE_WORLD_W, totalPlateWorldH, 1);
    // renderOrder = 2 keeps the plate drawn on top of body (0) and glow (1)
    // regardless of camera-distance transparent sorting.
    plateSprite.renderOrder = 2;

    // Anchor sprite bottom to NAME_PLATE_GAP_ABOVE_HEAD above the bell top.
    const headTopY    = TENTACLE_FLOOR_CLEARANCE + JELLYFISH_TARGET_HEIGHT;
    const plateBottomY = headTopY + NAME_PLATE_GAP_ABOVE_HEAD;
    plateSprite.position.set(0, plateBottomY + totalPlateWorldH / 2, 0);

    group.add(plateSprite);
    group.floatParts.push({ node: plateSprite, baseY: plateSprite.position.y });

    // Name plate text is static — drawn once here, never on updateBubble().
    function drawNamePlate() {
        pctx.clearRect(0, bubblePx + gapPx, plateCanvas.width, namePx);
        pctx.fillStyle    = '#ffffff';
        pctx.font         = `bold ${NAME_PLATE_FONT_PX}px sans-serif`;
        pctx.textAlign    = 'center';
        pctx.textBaseline = 'middle';
        pctx.fillText(username, plateCanvas.width / 2, bubblePx + gapPx + namePx / 2);
    }
    drawNamePlate();
    plateTex.needsUpdate = true;

    group.updateBubble = function(text) {
        // Only clear/redraw the bubble region so the name plate never flickers.
        pctx.clearRect(0, 0, plateCanvas.width, bubblePx);

        if (text) {
            pctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            pctx.fillRect(4, 4, plateCanvas.width - 8, bubblePx - 8);
            pctx.strokeStyle = isAgent ? '#9b72f0' : (role === "ar_human" ? '#00e5ff' : '#b24bf3');
            pctx.lineWidth   = 4;
            pctx.strokeRect(4, 4, plateCanvas.width - 8, bubblePx - 8);

            pctx.fillStyle    = '#ffffff';
            pctx.font         = `bold ${SPEECH_BUBBLE_FONT_PX}px monospace`;
            pctx.textAlign    = 'center';
            pctx.textBaseline = 'middle';

            const words = text.split(' ');
            let line = '';
            const lines = [];
            const maxLineWidth = plateCanvas.width - 50;
            for (let i = 0; i < words.length; i++) {
                const testLine = line + words[i] + ' ';
                if (pctx.measureText(testLine).width > maxLineWidth && i > 0) {
                    lines.push(line);
                    line = words[i] + ' ';
                } else {
                    line = testLine;
                }
            }
            lines.push(line);

            const bubbleCenterY = bubblePx / 2;
            const startY = bubbleCenterY - ((lines.length - 1) * SPEECH_BUBBLE_LINE_HEIGHT_PX) / 2;
            for (let i = 0; i < lines.length; i++) {
                pctx.fillText(lines[i], plateCanvas.width / 2, startY + i * SPEECH_BUBBLE_LINE_HEIGHT_PX);
            }
        }

        plateTex.needsUpdate = true;
    };

    return group;
}

window.updateSpeechBubble = function(text, speakerId) {
    let actualText = text;
    let id = speakerId;
    
    if (text && typeof text === 'object') {
        actualText = text.text;
        id = text.speakerId || id;
    }
    
    id = id || window.currentSpeakerId || window.activeSpeakerId;
    
    if (!actualText || actualText.trim() === "") {
        if (id && window.remoteEntities[id]) {
            window.remoteEntities[id].mesh.updateBubble("");
        } else {
            Object.values(window.remoteEntities).forEach(e => e.mesh.updateBubble(""));
        }
        return;
    }
    
    if (id && id !== window.localClientId && window.remoteEntities[id]) {
        window.remoteEntities[id].mesh.updateBubble(actualText);
    }
};

window.createCompass = function() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, 2 * Math.PI);
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#00f5ff';
    ctx.fillRect(126, 10, 4, 236);
    ctx.fillRect(10, 126, 236, 4);

    ctx.beginPath();
    ctx.arc(128, 128, 50, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CENTER', 128, 128);

    const tex   = new THREE.CanvasTexture(canvas);
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    plane.rotation.x = Math.PI / 2;
    plane.position.y = 0.01;
    return plane;
};

window.calibrateRoomCenter = function() {
    if (window.hitTestReticle && window.hitTestReticle.visible) {
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(window.hitTestReticle.matrix);
        window.roomOriginOffset.copy(position);
        window.isOriginCalibrated = true;
        window.updateLog(`[Calibration] Room origin locked to floor plane: [${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}]`);
    } else if (xrCamera) {
        window.roomOriginOffset.set(xrCamera.position.x, 0, xrCamera.position.z);
        window.isOriginCalibrated = true;
        window.updateLog(`[Calibration] Hit-test unavailable. Fallback origin set from camera footprint.`);
    }
    
    if (window.compassContainer) {
        window.compassContainer.position.copy(window.roomOriginOffset);
        window.compassContainer.position.y = 0.01;
    }
};

window.connectToRoomBroker = function(laptopIp, role, username) {
    // Unlock the Web Speech API on mobile via a user-gesture-triggered utterance.
    if (window.speechSynthesis) {
        const unlock = new SpeechSynthesisUtterance(" ");
        unlock.volume = 1;
        unlock.rate   = 16;
        window.speechSynthesis.speak(unlock);
    }

    window.clientRole = role;
    window.ensureSceneReady();

    window.wsClient = new WebSocket(`ws://${laptopIp}:8080`);

    window.wsClient.onopen = () => {
        window.wsClient.send(JSON.stringify({ type: 'register', role: role, username: username || "Unknown" }));
        window.updateLog(`[Network] Connected as ${username || "Unknown"} [${role}]`);
    };

    window.wsClient.onclose = () => {
        window.updateLog("<span style='color:#dd6b20;'>[Network] Connection lost. Cleaning up room...</span>");
        Object.keys(window.remoteEntities).forEach(id => removeNetworkEntity(id));
        window.wsClient = null;
        if (window.clientRole === "ar_human" && window.updateARStatus) {
            window.updateARStatus("Connection Lost. Reconnect Required.");
        }
    };

    window.wsClient.onmessage = (event) => {
        try {
            const packet = JSON.parse(event.data);
            if (packet.type === 'welcome') {
                window.localClientId = packet.id;
            } else if (packet.type === 'sync_world') {
                Object.keys(packet.entities).forEach(id => {
                    if (id !== window.localClientId)
                        spawnNetworkEntity(id, packet.entities[id].role, packet.entities[id].username);
                });
            } else if (packet.type === 'spawn') {
                if (packet.id !== window.localClientId)
                    spawnNetworkEntity(packet.id, packet.role, packet.username);
            } else if (packet.type === 'update') {
                updateRemoteTarget(packet.id, packet.position, packet.rotation);
            } else if (packet.type === 'despawn') {
                removeNetworkEntity(packet.id);
            } else if (packet.type === 'text_payload') {
                if (packet.senderId === window.localClientId) return;

                window.activeSpeakerId = packet.senderId;

                const targetCaption = window.clientRole === "ar_human"
                    ? document.getElementById("ar-roomCaption")
                    : document.getElementById("roomCaption");
                if (targetCaption) {
                    targetCaption.innerText = `[${packet.style || "Global"}] ${packet.text}`;
                    targetCaption.style.display = "block";
                }
                if (window.clientRole === "ar_human" && window.updateARStatus) {
                    window.updateARStatus("Remote broadcast received. Playing...");
                }

                if (window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                    Object.values(window.remoteEntities).forEach(e => e.mesh.updateBubble(""));

                    const rawSentences = packet.text.match(/[^.!?\n。！？]+[.!?\n。！？]*/g) || [packet.text];
                    window.speechQueue = rawSentences
                        .map(s => s.trim())
                        .filter(s => s.length > 0)
                        .map(s => ({ text: s, speakerId: packet.senderId }));

                    if (window.speechQueue.length > 0) {
                        window.voiceState = "paused";
                        if (window.toggleVoicePause) window.toggleVoicePause(window.clientRole === "ar_human");
                    }
                }
            }
        } catch (err) {
            console.error("Multiplayer message loop error:", err);
        }
    };
};

window.createShadedEnvironment = function() {
    if (window.clientRole === "ar_human") return;
    
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 8),
        new THREE.MeshBasicMaterial({ color: 0x1a202c })
    );
    floor.rotation.x = -Math.PI / 2;
    xrScene.add(floor);

    const grid = new THREE.GridHelper(8, 16, 0x4fd1c5, 0x4fd1c5);
    grid.position.y = 0.01;
    xrScene.add(grid);

    const wallMat = new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.7, side: THREE.BackSide });
    const walls   = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 8), wallMat);
    walls.position.y = 1.5;
    xrScene.add(walls);

    const table = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.75, 0.9),
        new THREE.MeshBasicMaterial({ color: 0x2b6cb0 })
    );
    table.position.set(0, 0.375, -1.0);
    xrScene.add(table);
};

function spawnNetworkEntity(id, role, username) {
    if (window.remoteEntities[id]) return;
    const isAgent    = (role === "ai_agent");
    const entityMesh = createDirrogate(isAgent, username, role);
    entityMesh.position.set(1, 0, 1);
    xrScene.add(entityMesh);
    window.remoteEntities[id] = {
        mesh: entityMesh,
        targetPos: new THREE.Vector3(1, 0, 1),
        targetRot: new THREE.Quaternion()
    };
}

function updateRemoteTarget(id, position, rotation) {
    const entity = window.remoteEntities[id];
    if (entity) {
        const basePos = new THREE.Vector3(position[0], 0, position[2]);
        if (window.roomOriginOffset) basePos.add(window.roomOriginOffset);
        entity.targetPos.copy(basePos);

        const q     = new THREE.Quaternion().fromArray(rotation);
        const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
        entity.targetRot.setFromEuler(new THREE.Euler(0, euler.y, 0, 'YXZ'));
    }
}

let lastAnimateTime = null;

function animateAvatars() {
    const now          = Date.now();
    const deltaSeconds = lastAnimateTime === null ? 0 : (now - lastAnimateTime) / 1000;
    lastAnimateTime    = now;
    const time         = now * 0.002;

    Object.keys(window.remoteEntities).forEach(id => {
        const ent = window.remoteEntities[id];

        // Drive the jellyfish idle animation.
        if (ent.mesh.mixer) ent.mesh.mixer.update(deltaSeconds);

        // Procedural avatar shims — no-op for the GLB jellyfish.
        if (ent.mesh.core) {
            const isCurrentSpeaker = (window.currentSpeakerId === id || window.activeSpeakerId === id);
            const remoteIsSpeaking = isCurrentSpeaker && (window.voiceState === "speaking");
            let activePulse = window.pulseIntensity || 0;
            if (remoteIsSpeaking && activePulse <= 0.1) activePulse = Math.abs(Math.sin(now * 0.005)) * 0.8;
            ent.mesh.core.rotation.y += 0.02;
            const scale = 1.0 + (remoteIsSpeaking ? activePulse * 0.5 : 0);
            ent.mesh.core.scale.set(scale, scale, scale);
        }
        if (ent.mesh.head) ent.mesh.head.rotation.y = Math.sin(time) * 0.2;

        // Bell glow pulse while this entity is the active speaker.
        if (ent.mesh.headGlowSprite && ent.mesh.headGlowLight) {
            const isSpeaker  = (window.currentSpeakerId === id || window.activeSpeakerId === id);
            const isSpeaking = isSpeaker && (window.voiceState === "speaking");
            let pulse = window.pulseIntensity || 0;
            if (isSpeaking && pulse <= 0.1) pulse = 0.55 + Math.abs(Math.sin(now * 0.006)) * 0.45;

            const prevPulse = ent.mesh._headGlowPulse || 0;
            const curPulse  = prevPulse + (pulse - prevPulse) * 0.18;
            ent.mesh._headGlowPulse = curPulse;

            const scale = ent.mesh.headGlowBaseScale * (1.0 + curPulse * 0.6);
            ent.mesh.headGlowSprite.scale.set(scale, scale, 1);
            ent.mesh.headGlowLight.intensity = ent.mesh.headGlowBaseIntensity + curPulse * 1.4;

            // Gentle body scale pulse while speaking (12% max extra scale).
            if (ent.mesh.jellyfishScene) {
                const BODY_PULSE_SCALE_AMOUNT = 0.12;
                const bodyBaseScale = ent.mesh.jellyfishBodyBaseScale
                    || (ent.mesh.jellyfishBodyBaseScale = ent.mesh.jellyfishScene.scale.x);
                const bodyScale = bodyBaseScale * (1.0 + curPulse * BODY_PULSE_SCALE_AMOUNT);
                ent.mesh.jellyfishScene.scale.set(bodyScale, bodyScale, bodyScale);
            }
        }

        // Floating bob applied to individual parts rather than the group root
        // so it doesn't fight the network position lerp below.
        if (ent.mesh.floatParts) {
            const bob = Math.sin(now * 0.0012 + ent.mesh.floatPhase) * 0.05;
            ent.mesh.floatParts.forEach(({ node, baseY }) => { node.position.y = baseY + bob; });
        }

        ent.mesh.position.lerp(ent.targetPos, 0.15);
        ent.mesh.quaternion.slerp(ent.targetRot, 0.15);
    });

    if (window.pulseIntensity > 0) window.pulseIntensity -= 0.05;
}

function removeNetworkEntity(id) {
    if (window.remoteEntities[id]) {
        xrScene.remove(window.remoteEntities[id].mesh);
        delete window.remoteEntities[id];
    }
}

let lastPos      = new THREE.Vector3();
let lastRot      = new THREE.Quaternion();
let lastSendTime = 0;

window.sendLocalTelemetry = function() {
    if (!window.wsClient || window.wsClient.readyState !== 1 || !xrCamera) return;

    const now = Date.now();
    if (now - lastSendTime < 50) return;

    const pos = new THREE.Vector3().copy(xrCamera.position);
    if (window.roomOriginOffset) pos.sub(window.roomOriginOffset);
    const rot = xrCamera.quaternion;

    if (lastPos.distanceTo(pos) < 0.01 && lastRot.angleTo(rot) < 0.02) return;

    lastPos.copy(pos);
    lastRot.copy(rot);
    lastSendTime = now;

    window.wsClient.send(JSON.stringify({
        type:     'telemetry',
        position: pos.toArray(),
        rotation: rot.toArray()
    }));
};

window.setupVirtualJoysticks = function() {
    const zone = document.getElementById("joystick-zone");
    if (!zone) return;
    zone.style.display = "block";

    const moveZone = document.getElementById("move-stick");
    const moveKnob = document.getElementById("move-knob");
    const lookZone = document.getElementById("look-stick");
    const lookKnob = document.getElementById("look-knob");

    function attachStick(stickZone, knob, stateRef) {
        let isMouseDown = false;
        stickZone.addEventListener("touchstart",  (e) => { e.preventDefault(); stateRef.active = true; updateStick(e.targetTouches[0], stickZone, knob, stateRef); }, { passive: false });
        stickZone.addEventListener("touchmove",   (e) => { e.preventDefault(); updateStick(e.targetTouches[0], stickZone, knob, stateRef); }, { passive: false });
        stickZone.addEventListener("touchend",    (e) => { e.preventDefault(); stateRef.active = false; stateRef.x = 0; stateRef.y = 0; knob.style.transform = `translate(0px, 0px)`; });
        stickZone.addEventListener("mousedown",   (e) => { e.preventDefault(); isMouseDown = true; stateRef.active = true; updateStick(e, stickZone, knob, stateRef); });
        window.addEventListener(  "mousemove",    (e) => { if (isMouseDown) { e.preventDefault(); updateStick(e, stickZone, knob, stateRef); } });
        window.addEventListener(  "mouseup",      (e) => { if (isMouseDown) { isMouseDown = false; stateRef.active = false; stateRef.x = 0; stateRef.y = 0; knob.style.transform = `translate(0px, 0px)`; } });
    }

    function updateStick(evt, stickZone, knob, stateRef) {
        const rect      = stickZone.getBoundingClientRect();
        const dx        = evt.clientX - (rect.left + rect.width  / 2);
        const dy        = evt.clientY - (rect.top  + rect.height / 2);
        const maxRadius = 35;
        const distance  = Math.min(Math.sqrt(dx * dx + dy * dy), maxRadius);
        const angle     = Math.atan2(dy, dx);
        const finalX    = Math.cos(angle) * distance;
        const finalY    = Math.sin(angle) * distance;
        knob.style.transform = `translate(${finalX}px, ${finalY}px)`;
        stateRef.x = finalX / maxRadius;
        stateRef.y = finalY / maxRadius;
    }

    attachStick(moveZone, moveKnob, window.moveTouch);
    attachStick(lookZone, lookKnob, window.lookTouch);
};

function syncXRRendererToViewport() {
    if (!xrRenderer || !xrCamera) return;
    xrRenderer.setSize(window.innerWidth, window.innerHeight);
    xrCamera.aspect = window.innerWidth / window.innerHeight;
    xrCamera.updateProjectionMatrix();
}

let xrResizeListenerAttached = false;

window.startWebXR = async function() {
    try {
        if (!xrRenderer) {
            xrRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
            xrRenderer.setPixelRatio(window.devicePixelRatio);
            xrRenderer.setSize(window.innerWidth, window.innerHeight);
        }

        if (!xrCamera) xrCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

        syncXRRendererToViewport();

        if (!xrResizeListenerAttached) {
            window.addEventListener("resize", syncXRRendererToViewport);
            xrResizeListenerAttached = true;
        }

        window.ensureSceneReady();

        document.body.classList.add("webxr-overlay-active");
        document.body.appendChild(xrRenderer.domElement);
        document.getElementById("ar-hud").style.display = "block";

        if (window.clientRole === "remote_human") {

            window.updateLog("[System] Launching Remote 3D Viewer...");
            xrRenderer.xr.enabled = false;

            const calibrateBtnRemote = document.getElementById('ar-calibrate-btn');
            if (calibrateBtnRemote) calibrateBtnRemote.style.display = 'none';

            xrCamera.position.set(0, 1.37, 2.5);
            window.createShadedEnvironment();
            window.setupVirtualJoysticks();

            xrRenderer.setAnimationLoop(() => {
                if (window.moveTouch.active) {
                    const euler = new THREE.Euler().setFromQuaternion(xrCamera.quaternion, 'YXZ');
                    const yaw   = euler.y;
                    const dx    = window.moveTouch.x * 0.07;
                    const dz    = window.moveTouch.y * 0.07;
                    const moveX =  dx * Math.cos(yaw) + dz * Math.sin(yaw);
                    const moveZ = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
                    const newX  = Math.max(-3.8, Math.min(3.8, xrCamera.position.x + moveX));
                    const newZ  = Math.max(-3.8, Math.min(3.8, xrCamera.position.z + moveZ));
                    xrCamera.position.set(newX, 1.37, newZ);
                }

                if (window.lookTouch.active) {
                    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
                    euler.setFromQuaternion(xrCamera.quaternion);
                    euler.y -= window.lookTouch.x * 0.04;
                    euler.x -= window.lookTouch.y * 0.03;
                    const maxPitch = 20 * (Math.PI / 180);
                    euler.x = Math.max(-maxPitch, Math.min(maxPitch, euler.x));
                    euler.z = 0;
                    xrCamera.quaternion.setFromEuler(euler);
                }

                animateAvatars();
                window.sendLocalTelemetry();
                xrRenderer.render(xrScene, xrCamera);
            });

        } else {

            window.updateLog("[System] Launching AR Core Camera...");
            xrRenderer.xr.enabled = true;

            const calibrateBtnAR = document.getElementById('ar-calibrate-btn');
            if (calibrateBtnAR) calibrateBtnAR.style.display = 'inline-block';

            const sessionInit = {
                requiredFeatures: ['local-floor'],
                optionalFeatures: ['dom-overlay', 'hit-test'],
                domOverlay: { root: document.getElementById('ar-hud') }
            };

            const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
            xrRenderer.xr.setReferenceSpaceType('local-floor');
            await xrRenderer.xr.setSession(session);

            xrSession = session;

            const viewerSpace = await session.requestReferenceSpace('viewer');
            window.xrHitTestSource = await session.requestHitTestSource({ space: viewerSpace });

            window.updateARStatus("Floor mapped. Ready for manual spatial calibration.");

            xrRenderer.setAnimationLoop((timestamp, frame) => {
                if (frame && window.xrHitTestSource && !window.isOriginCalibrated) {
                    const referenceSpace = xrRenderer.xr.getReferenceSpace();
                    const hitResults     = frame.getHitTestResults(window.xrHitTestSource);
                    if (hitResults.length > 0) {
                        const pose = hitResults[0].getPose(referenceSpace);
                        if (window.hitTestReticle) {
                            window.hitTestReticle.visible = true;
                            window.hitTestReticle.matrix.fromArray(pose.transform.matrix);
                        }
                    } else {
                        if (window.hitTestReticle) window.hitTestReticle.visible = false;
                    }
                } else {
                    if (window.hitTestReticle) window.hitTestReticle.visible = false;
                }

                animateAvatars();
                window.sendLocalTelemetry();
                xrRenderer.render(xrScene, xrCamera);
            });

            session.addEventListener('end', window.onXRSessionEnded);
        }
    } catch (e) {
        window.updateLog(`<span style="color:red">3D/AR Initialization Failed: ${e.message}</span>`);
    }
};

window.stopWebXR = function() {
    if (window.clientRole === "remote_human") {
        xrRenderer.setAnimationLoop(null);
        if (xrRenderer.domElement.parentNode) xrRenderer.domElement.parentNode.removeChild(xrRenderer.domElement);
        document.body.classList.remove("webxr-overlay-active");
        document.getElementById("ar-hud").style.display = "none";
        const stickZone = document.getElementById("joystick-zone");
        if (stickZone) stickZone.style.display = "none";
    } else {
        if (xrSession) xrSession.end();
    }
};

window.onXRSessionEnded = function() {
    xrSession = null;
    if (xrRenderer && xrRenderer.domElement.parentNode) xrRenderer.domElement.parentNode.removeChild(xrRenderer.domElement);
    document.body.classList.remove("webxr-overlay-active");
    document.getElementById("ar-hud").style.display = "none";
};
