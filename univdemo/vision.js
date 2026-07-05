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
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(prevActive);

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
        
        if (renderer && scene && camera && typeof THREE !== 'undefined') {
            try {
                if (typeof animateAvatars === "function") animateAvatars();
                
                const width = view.camera.width;
                const height = view.camera.height;

                const captureCamera = new THREE.PerspectiveCamera();
                captureCamera.matrixAutoUpdate = false;
                captureCamera.matrix.fromArray(view.transform.matrix);
                captureCamera.matrixWorld.copy(captureCamera.matrix);
                
                const elements = view.projectionMatrix;
                const fov = 2 * Math.atan(1.0 / elements[5]) * (180 / Math.PI);
                captureCamera.fov = fov;
                captureCamera.aspect = width / height;
                captureCamera.updateProjectionMatrix();

                scene.updateMatrixWorld(true);

                const renderTarget = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat });
                
                const wasXrEnabled = renderer.xr.enabled;
                renderer.xr.enabled = false;

                const oldTarget = renderer.getRenderTarget();
                renderer.setRenderTarget(renderTarget);

                const oldClearColor = new THREE.Color();
                renderer.getClearColor(oldClearColor);
                const oldClearAlpha = renderer.getClearAlpha();

                renderer.setClearColor(0x000000, 0); 
                renderer.clear();
                
                renderer.render(scene, captureCamera);

                const pixels = new Uint8Array(width * height * 4);
                renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);

                // Restore renderer state precisely
                renderer.setRenderTarget(oldTarget);
                renderer.setClearColor(oldClearColor, oldClearAlpha);
                renderer.xr.enabled = wasXrEnabled;
                
                // CRITICAL FIX FOR PERSPECTIVE SKEW: Force all sprites in the scene to re-bind their uniforms
                // and recompile/re-upload their projection matrices, purging the landscape aspect ratio of captureCamera.
                scene.traverse((node) => {
                    if (node.isSprite) {
                        if (node.material) {
                            node.material.needsUpdate = true;
                        }
                        node.matrixWorldNeedsUpdate = true;
                    }
                });
                
                renderer.resetState();
                renderTarget.dispose();

                const flipped = new Uint8ClampedArray(pixels.length);
                const rowBytes = width * 4;
                for (let y = 0; y < height; y++) {
                    const src = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
                    flipped.set(src, (height - 1 - y) * rowBytes);
                }

                const overlayCanvas = document.createElement("canvas");
                overlayCanvas.width = width;
                overlayCanvas.height = height;
                overlayCanvas.getContext("2d").putImageData(new ImageData(flipped, width, height), 0, 0);

                const ctx = capturedFrame.canvas.getContext("2d");
                ctx.drawImage(overlayCanvas, 0, 0, capturedFrame.canvas.width, capturedFrame.canvas.height);
                capturedFrame.base64 = capturedFrame.canvas.toDataURL("image/jpeg", 0.6).split(",")[1];

            } catch (overlayErr) {
                window.updateLog(`[Vision] Failed to composite virtual scene: ${overlayErr.message}`);
            }
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

window.tryCaptureRemoteFrame = function(renderer) {
    if (!renderer || !renderer.domElement) return;
    try {
        window.visionBusy = true;
        window.updateLog("[Vision] Capturing Remote Mode 3D viewport canvas...");
        
        // Ensure a fresh frame is rendered so preserveDrawingBuffer is filled
        if (window.xrScene && window.xrCamera) {
            renderer.render(window.xrScene, window.xrCamera);
        }

        const dataUrl = renderer.domElement.toDataURL("image/jpeg", 0.6);
        const base64 = dataUrl.split(",")[1];

        const img = new Image();
        img.onload = async () => {
            ensureVisionElements();
            const scale = Math.min(1, 640 / Math.max(img.width, img.height));
            _visionCanvasEl.width = Math.round(img.width * scale);
            _visionCanvasEl.height = Math.round(img.height * scale);
            _visionCanvasEl.getContext("2d").drawImage(img, 0, 0, _visionCanvasEl.width, _visionCanvasEl.height);
            
            const frame = { canvas: _visionCanvasEl, base64 };
            await runVisionPipelineOnFrame(frame, false);
            window.visionBusy = false;
        };
        img.onerror = (e) => {
            window.updateLog("<span style='color:red;'>[Vision] Failed to load remote capture data URL</span>");
            window.visionBusy = false;
        };
        img.src = dataUrl;
    } catch (err) {
        window.updateLog(`<span style="color:#e53e3e;">[Vision] Remote capture error: ${err.message}</span>`);
        window.visionBusy = false;
    }
};

window.requestARCapture = function() {
    if (window.visionBusy) {
        window.updateLog("[Vision] Already capturing — please wait.");
        return;
    }
    if (!window.isARMode || typeof xrSession === "undefined") {
        if (window.xrRenderer) {
            window.tryCaptureRemoteFrame(window.xrRenderer);
        } else {
            window.updateLog("[Vision] 3D Renderer not initialized — cannot take snapshot in Remote Mode.");
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