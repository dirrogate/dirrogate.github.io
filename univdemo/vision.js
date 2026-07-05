// ==========================================
// SCENE VISION ENGINE (vision.js)
// ==========================================

window.VISION_CLOUD_URL = "http://192.168.1.2:11434/api/generate"; 
window.VISION_CLOUD_MODEL = "gemma3:4b"; 
window.visionAutoScanInterval = null;
window.visionBusy = false;
window.lastCapturedImage = null; 

let _cocoModel = null;
let _visionVideoEl = null;
let _visionCanvasEl = null;
let _visionStream = null;

function ensureVisionElements() {
    if (!_visionVideoEl) {
        _visionVideoEl = document.createElement("video");
        _visionVideoEl.autoplay = true;
        _visionVideoEl.playsInline = true;
        _visionVideoEl.muted = true;
        _visionVideoEl.style.display = "none";
        document.body.appendChild(_visionVideoEl);
    }
    if (!_visionCanvasEl) {
        _visionCanvasEl = document.createElement("canvas");
        _visionCanvasEl.style.display = "none";
        document.body.appendChild(_visionCanvasEl);
    }
}

async function ensureVisionStream() {
    ensureVisionElements();
    if (_visionStream) return _visionStream;
    _visionStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 960 }, height: { ideal: 540 } },
        audio: false
    });
    _visionVideoEl.srcObject = _visionStream;
    await _visionVideoEl.play();
    await new Promise(r => setTimeout(r, 250)); 
    return _visionStream;
}

function stopVisionStream() {
    if (_visionStream) {
        _visionStream.getTracks().forEach(t => t.stop());
        _visionStream = null;
    }
}

function grabAndCompressFrame(maxDim = 640, quality = 0.6) {
    ensureVisionElements();
    const vw = _visionVideoEl.videoWidth, vh = _visionVideoEl.videoHeight;
    if (!vw || !vh) throw new Error("Video stream has no frame yet.");

    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    _visionCanvasEl.width = Math.round(vw * scale);
    _visionCanvasEl.height = Math.round(vh * scale);
    _visionCanvasEl.getContext("2d").drawImage(_visionVideoEl, 0, 0, _visionCanvasEl.width, _visionCanvasEl.height);

    const base64 = _visionCanvasEl.toDataURL("image/jpeg", quality).split(",")[1];
    return { canvas: _visionCanvasEl, base64 };
}

function captureFrameViaFilePicker() {
    return new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = "environment";
        input.style.display = "none";
        document.body.appendChild(input);

        input.onchange = () => {
            const file = input.files[0];
            document.body.removeChild(input);
            if (!file) return reject(new Error("No frame captured."));
            const img = new Image();
            img.onload = () => {
                ensureVisionElements();
                const scale = Math.min(1, 640 / Math.max(img.width, img.height));
                _visionCanvasEl.width = Math.round(img.width * scale);
                _visionCanvasEl.height = Math.round(img.height * scale);
                _visionCanvasEl.getContext("2d").drawImage(img, 0, 0, _visionCanvasEl.width, _visionCanvasEl.height);
                const base64 = _visionCanvasEl.toDataURL("image/jpeg", 0.6).split(",")[1];
                resolve({ canvas: _visionCanvasEl, base64 });
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        };
        input.click();
    });
}

let _oesBlitProgram = null;
let _oesBlitQuadBuf = null;

function ensureOESBlitProgram(gl) {
    if (_oesBlitProgram) return _oesBlitProgram;

    const vsSrc = `
        attribute vec2 aPos;
        varying vec2 vUv;
        void main() {
            vUv = aPos * 0.5 + 0.5;
            gl_Position = vec4(aPos, 0.0, 1.0);
        }
    `;
    
    const fsSrc = `
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D uCameraTex;
        void main() {
            gl_FragColor = texture2D(uCameraTex, vUv);
        }
    `;

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(s);
            gl.deleteShader(s);
            throw new Error("Blit shader compile failed: " + info);
        }
        return s;
    }

    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("Blit program link failed: " + gl.getProgramInfoLog(prog));
    }

    _oesBlitQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, _oesBlitQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    _oesBlitProgram = prog;
    return prog;
}

function blitAndReadCameraTexture(gl, cameraTexture, width, height) {
    const prog = ensureOESBlitProgram(gl);

    const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const prevVP = gl.getParameter(gl.VIEWPORT);
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);

    // Three.js keeps its own Vertex Array Objects (VAOs) per geometry, and
    // whichever one it used last is very likely still bound right now. A
    // VAO stores attribute enable/pointer state *inside itself* — so
    // enabling/pointing attribute 0 without first unbinding that VAO
    // doesn't just confuse Three's cache, it permanently overwrites that
    // VAO's own attribute-0 binding (to our quad buffer instead of the
    // sprite's real geometry). That's what was skewing — and, once we
    // also disabled the attribute, hiding entirely — the name plate and
    // speech bubble. Bind the default (null) VAO first so our raw calls
    // can only ever touch our own state, never one of Three's.
    const vaoExt = (!gl.bindVertexArray && gl.getExtension) ? gl.getExtension('OES_vertex_array_object') : null;
    const bindVAO = gl.bindVertexArray
        ? (vao) => gl.bindVertexArray(vao)
        : (vaoExt ? (vao) => vaoExt.bindVertexArrayOES(vao) : null);
    const VAO_BINDING_PNAME = gl.VERTEX_ARRAY_BINDING || (vaoExt && vaoExt.VERTEX_ARRAY_BINDING_OES);
    const prevVAO = (bindVAO && VAO_BINDING_PNAME) ? gl.getParameter(VAO_BINDING_PNAME) : null;
    if (bindVAO) bindVAO(null);

    const fbo = gl.createFramebuffer();
    const outTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
    gl.viewport(0, 0, width, height);

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, _oesBlitQuadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture); 
    gl.uniform1i(gl.getUniformLocation(prog, "uCameraTex"), 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(outTex);

    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
    gl.viewport(prevVP[0], prevVP[1], prevVP[2], prevVP[3]);
    gl.useProgram(prevProg);
    gl.disableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(prevActive);
    if (bindVAO) bindVAO(prevVAO);

    let nonBlackSamples = 0;
    const totalSamples = 200;
    const stepPixels = Math.max(1, Math.floor((width * height) / totalSamples));
    for (let i = 0; i < width * height; i += stepPixels) {
        const off = i * 4;
        if (pixels[off] > 8 || pixels[off + 1] > 8 || pixels[off + 2] > 8) {
            nonBlackSamples++;
            if (nonBlackSamples > 3) break; 
        }
    }
    if (nonBlackSamples <= 3) {
        throw new Error("captured frame was black — camera texture not sampling correctly");
    }

    const flipped = new Uint8ClampedArray(pixels.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
        const src = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
        flipped.set(src, (height - 1 - y) * rowBytes);
    }

    ensureVisionElements();
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = width;
    fullCanvas.height = height;
    fullCanvas.getContext("2d").putImageData(new ImageData(flipped, width, height), 0, 0);

    const scale = Math.min(1, 640 / Math.max(width, height));
    _visionCanvasEl.width = Math.round(width * scale);
    _visionCanvasEl.height = Math.round(height * scale);
    _visionCanvasEl.getContext("2d").drawImage(fullCanvas, 0, 0, _visionCanvasEl.width, _visionCanvasEl.height);

    const base64 = _visionCanvasEl.toDataURL("image/jpeg", 0.6).split(",")[1];
    return { canvas: _visionCanvasEl, base64 };
}

async function runVisionPipelineOnFrame(frame, isAR) {
    window.lastCapturedImage = frame.base64;

    let edgeLabels = [];
    try {
        edgeLabels = await analyzeFrameOnDevice(frame.canvas);
        window.updateLog(`[Vision:edge] Detected: ${edgeLabels.join(", ") || "nothing confident"}`);
    } catch (edgeErr) {
        window.updateLog(`<span style="color:#dd6b20;">[Vision:edge] ${edgeErr.message}</span>`);
    }

    try {
        const narration = await analyzeFrameOnCloud(frame.base64, edgeLabels);
        window.updateLog("[Vision:cloud] Narration received.");
        speakInsight(narration, isAR);
    } catch (cloudErr) {
        window.updateLog(`<span style="color:#e53e3e;">[Vision:cloud] ${cloudErr.message} — speaking edge-only result.</span>`);
        if (edgeLabels.length) {
            speakInsight(`I can make out: ${edgeLabels.join(", ")}. I couldn't reach the deeper vision model for more detail.`, isAR);
        }
    }
}

window.tryCaptureARCameraFrame = async function(frame, referenceSpace, gl, renderer, scene, camera) {
    if (window.visionBusy) return;

    try {
        if (!window.xrGLBinding) throw new Error("no camera-access binding");

        const pose = frame.getViewerPose(referenceSpace);
        if (!pose || !pose.views.length) throw new Error("no viewer pose yet");

        const view = pose.views[0];
        if (!view.camera) throw new Error("view.camera not granted on this device");

        const cameraTexture = window.xrGLBinding.getCameraImage(view.camera);
        if (!cameraTexture) throw new Error("getCameraImage returned null");

        window.visionBusy = true;
        window.updateLog("[Vision] Captured live AR frame in-session — staying in AR.");

        const capturedFrame = blitAndReadCameraTexture(gl, cameraTexture, view.camera.width, view.camera.height);

        // blitAndReadCameraTexture makes raw WebGL calls that bypass
        // Three.js's own internal state cache. Even with the attribute
        // array properly restored above, explicitly resyncing here is the
        // documented-safe pattern whenever raw gl.* calls are mixed with a
        // Three.js renderer, so the next render() call can't rely on any
        // stale cached assumptions about GL state.
        if (renderer && typeof renderer.resetState === "function") {
            renderer.resetState();
        }
        
        if (renderer && typeof THREE !== 'undefined') {
            // Composite the virtual overlay (jellyfish, name plate, speech
            // bubble) onto the real-world photo by reading the *live*
            // xrRenderer's own drawing buffer, instead of re-rendering the
            // scene a second time with a substitute camera + render target.
            // xrRenderer is created with preserveDrawingBuffer:true (see
            // avatar.js), so right after its normal per-frame render — same
            // camera, xr.enabled never touched — the buffer already holds
            // exactly what was rendered from the real device viewpoint.
            // Toggling renderer.xr.enabled off and doing a second render()
            // call mid-session (the previous approach) is what was skewing
            // the name plate / speech bubble sprites; not doing that at all
            // avoids the problem rather than trying to time around it.
            await new Promise((resolve) => {
                requestAnimationFrame(() => {
                    try {
                        const overlayCanvas = document.createElement("canvas");
                        overlayCanvas.width = capturedFrame.canvas.width;
                        overlayCanvas.height = capturedFrame.canvas.height;
                        overlayCanvas.getContext("2d").drawImage(
                            renderer.domElement, 0, 0, overlayCanvas.width, overlayCanvas.height
                        );

                        const ctx = capturedFrame.canvas.getContext("2d");
                        ctx.drawImage(overlayCanvas, 0, 0, capturedFrame.canvas.width, capturedFrame.canvas.height);
                        capturedFrame.base64 = capturedFrame.canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
                    } catch (overlayErr) {
                        window.updateLog(`[Vision] Failed to composite virtual scene: ${overlayErr.message}`);
                    } finally {
                        resolve();
                    }
                });
            });
        }

        await runVisionPipelineOnFrame(capturedFrame, true);

    } catch (err) {
        window.updateLog(`<span style="color:#dd6b20;">[Vision] In-session capture unavailable (${err.message}) — falling back to native camera.</span>`);
        window.visionBusy = false;
        window.captureAndAnalyzeScene(true); 
        return;
    } finally {
        window.visionBusy = false;
    }
};

window.clearCapturedImage = function() {
    if (!window.lastCapturedImage) {
        window.updateLog("[Vision] No snapshot currently stored.");
        return;
    }
    window.lastCapturedImage = null;
    window.updateLog("[Vision] Cleared stored snapshot from memory.");
};

window.requestARCapture = function() {
    if (window.visionBusy) {
        window.updateLog("[Vision] Already capturing — please wait.");
        return;
    }

    // NOTE: `window.isARMode` is set to true for BOTH real AR sessions and the
    // Remote 3D viewer (see syncUIState), and `xrSession` is always a defined
    // variable (it's just `null` until a real immersive-ar session starts) —
    // so neither of those ever tells us "we're in Remote mode". clientRole is
    // the only reliable signal, and whether an actual XR session exists.
    if (!window.isARMode || window.clientRole === "remote_human" || !xrSession) {
        // Remote mode isn't a real AR session — there's no device passthrough
        // camera feed to pull from, so a "snapshot" there was previously just
        // screenshotting the virtual 3D room, which isn't a real photo at all.
        // Instead, use the same real-world capture path the flat/2D "Look"
        // button uses: it opens the actual back camera in the background
        // (invisible <video> element, no UI to dismiss) and only falls back
        // to the native camera app if that's unavailable. Either way it
        // returns straight to the Remote 3D view — captureAndAnalyzeScene
        // only ever exits AR/XR when called with isAR=true, so calling it
        // with `false` here never touches the Remote viewer at all.
        if (window.captureAndAnalyzeScene) {
            window.captureAndAnalyzeScene(false);
        } else {
            window.updateLog("[Vision] Capture pipeline not available.");
        }
        return;
    }
    window._pendingARCapture = true;
    window.updateLog("[Vision] Capture armed — grabbing next AR frame...");
};

async function ensureCocoModel() {
    if (!_cocoModel) {
        window.updateLog("[Vision] Loading on-device object detector...");
        _cocoModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        window.updateLog("[Vision] Edge detector ready.");
    }
    return _cocoModel;
}

async function analyzeFrameOnDevice(canvas) {
    const model = await ensureCocoModel();
    const predictions = await model.detect(canvas);
    return predictions.filter(p => p.score > 0.5).map(p => p.class);
}

async function analyzeFrameOnCloud(base64Jpeg, edgeLabels) {
    const hint = edgeLabels && edgeLabels.length
        ? `An on-device detector already flagged: ${edgeLabels.join(", ")}. Use that as a starting point, but look for more.`
        : "";
    const prompt = `You are Dirrogate, an AI companion looking through the wearer's eyes right now. ` +
        `In 2-3 sentences: (1) describe what you actually see, (2) offer one creative or useful observation ` +
        `about the scene (mood, a detail worth noticing, a possible hazard, or an idea it sparks). ` +
        `Speak directly to the wearer, second person, warm and curious tone. ${hint}`;

    window.updateLog(`[Vision:diag] Sending request with model="${window.VISION_CLOUD_MODEL}" to ${window.VISION_CLOUD_URL}`);

    const response = await fetch(window.VISION_CLOUD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: window.VISION_CLOUD_MODEL,
            prompt: prompt,
            images: [base64Jpeg],
            stream: false,
            options: { temperature: 0.4 }
        })
    });
    if (!response.ok) throw new Error(`Cloud vision HTTP ${response.status}`);
    const data = await response.json();
    return (data.response || "").trim();
}

function speakInsight(text, isAR) {
    if (!text) return;
    window.stopAllOperations();

    document.getElementById("styledOutput").innerText = text;
    document.getElementById("ar-styledOutput").innerText = text;
    document.getElementById("styledOutput").setAttribute("data-pct", "100%");
    document.getElementById("ar-styledOutput").setAttribute("data-pct", "100%");

    document.getElementById("actionButtons").style.display = "flex";
    document.getElementById("ar-actionButtons").style.display = "flex";
    document.getElementById("voiceBtn").style.display = "block";
    document.getElementById("ar-voiceBtn").style.display = "block";
    document.getElementById("replayBtn").style.display = "block";
    document.getElementById("ar-replayBtn").style.display = "block";

    window.lastGeneratedText = text;
    window.lastBroadcastStyle = "dirrogate-vision";

    if (window.wsClient && window.wsClient.readyState === 1) {
        window.wsClient.send(JSON.stringify({ type: "broadcast_text", text, style: "dirrogate-vision" }));
    }

    window.toggleVoicePause(isAR);
}

window.captureAndAnalyzeScene = async function(isAR = false) {
    if (window.visionBusy) return;
    window.visionBusy = true;

    const wasInAR = isAR && window.isARMode;
    if (wasInAR) {
        window.updateLog("[Vision] Pausing AR session to free the camera for a scene capture...");
        if (window.exitXR) window.exitXR();
        await new Promise(r => setTimeout(r, 400)); 
    }

    window.updateLog("[Vision] Capturing frame...");

    try {
        let frame;
        if (wasInAR) {
            frame = await captureFrameViaFilePicker();
        } else {
            try {
                await ensureVisionStream();
                frame = grabAndCompressFrame();
            } catch (streamErr) {
                window.updateLog(`<span style="color:#dd6b20;">[Vision] Live camera unavailable (${streamErr.message}) — falling back to tap-to-capture.</span>`);
                frame = await captureFrameViaFilePicker();
            }
        }

        // In Remote Mode there's no device passthrough camera feed, so the
        // 3D room (floor/walls/table) and the real-world photo have no
        // shared coordinate system — compositing them "correctly" isn't
        // possible. What we CAN do: hide the opaque room decor, render just
        // the jellyfish avatars (translucent, no solid background) from the
        // viewer's current 3D vantage point, and lay that over the photo —
        // same idea as the in-session AR overlay, adapted for Remote mode.
        if (!wasInAR && window.clientRole === "remote_human" && window.xrRenderer && window.xrScene && window.xrCamera) {
            try {
                const hiddenNodes = [];
                window.xrScene.traverse((node) => {
                    if (node.userData && node.userData.isEnvironmentDecor && node.visible) {
                        node.visible = false;
                        hiddenNodes.push(node);
                    }
                });

                window.xrRenderer.render(window.xrScene, window.xrCamera);

                const overlayCanvas = document.createElement("canvas");
                overlayCanvas.width = frame.canvas.width;
                overlayCanvas.height = frame.canvas.height;
                overlayCanvas.getContext("2d").drawImage(
                    window.xrRenderer.domElement, 0, 0, overlayCanvas.width, overlayCanvas.height
                );

                // Restore decor visibility and re-render immediately so the
                // live Remote view doesn't visibly flash "empty room".
                hiddenNodes.forEach((node) => { node.visible = true; });
                window.xrRenderer.render(window.xrScene, window.xrCamera);

                const ctx = frame.canvas.getContext("2d");
                ctx.drawImage(overlayCanvas, 0, 0, frame.canvas.width, frame.canvas.height);
                frame.base64 = frame.canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
            } catch (overlayErr) {
                window.updateLog(`[Vision] Failed to composite avatar overlay: ${overlayErr.message}`);
            }
        }

        await runVisionPipelineOnFrame(frame, false);

        if (wasInAR) {
            window.updateLog("[Vision] Scene analysis complete. Tap '🔮 Project Dirrogate' to re-enter AR.");
        }
    } catch (err) {
        window.updateLog(`<span style="color:#e53e3e;">[Vision] Capture failed: ${err.message}</span>`);
    } finally {
        window.visionBusy = false;
    }
};

window.toggleAutoScan = function() {
    if (window.visionAutoScanInterval) {
        window.stopAutoScan();
    } else {
        window.startAutoScan(5000);
    }
};

function updateAutoScanButtonUI() {
    const btn = document.getElementById("autoScanBtn");
    if (!btn) return;
    if (window.visionAutoScanInterval) {
        btn.textContent = "⏸ Stop Auto-scan";
        btn.style.background = "#e53e3e";
    } else {
        btn.textContent = "▶ Start Auto-scan (every 5s)";
        btn.style.background = "#2f855a";
    }
}

window.startAutoScan = function(intervalMs = 5000) {
    if (window.isARMode) {
        window.updateLog("<span style='color:#dd6b20;'>[Vision] Auto-scan isn't available in AR mode (camera is owned by AR passthrough). Use the Look button instead — it will pause AR, capture, and let you resume.</span>");
        updateAutoScanButtonUI();
        return;
    }
    window.stopAutoScan();
    window.visionAutoScanInterval = setInterval(() => window.captureAndAnalyzeScene(false), intervalMs);
    window.updateLog(`[Vision] Auto-scan started, every ${intervalMs / 1000}s.`);
    updateAutoScanButtonUI();
};

window.stopAutoScan = function() {
    if (window.visionAutoScanInterval) {
        clearInterval(window.visionAutoScanInterval);
        window.visionAutoScanInterval = null;
        window.updateLog("[Vision] Auto-scan stopped.");
    }
    updateAutoScanButtonUI();
};

window.addEventListener("beforeunload", stopVisionStream);
