// ==========================================
// SPEECH & TTS ENGINE (speech.js)
// ==========================================

window.speechQueue = [];
window.currentSentence = "";
window.currentCharIndex = 0; 
window.currentSpeakerId = null; // Bound to active data chunk
window.voiceState = "idle";
window.pulseIntensity = 0.0;
window.utteranceRetainer = []; 
window.isReplaying = false;

window.availableVoices = [];
window.populateVoiceList = function() {
    const voiceSelect = document.getElementById("voiceSelect");
    if (!voiceSelect) return;
    const currentSelection = voiceSelect.value; 

    window.availableVoices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    window.availableVoices.sort((a, b) => (b.localService === true ? 1 : 0) - (a.localService === true ? 1 : 0));
    
    voiceSelect.innerHTML = "";
    window.availableVoices.forEach((voice) => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})${voice.localService ? '' : ' ☁ network'}`;
        option.value = voice.name;
        voiceSelect.appendChild(option);
    });

    if (currentSelection && Array.from(voiceSelect.options).some(opt => opt.value === currentSelection)) {
        voiceSelect.value = currentSelection;
    }
};

if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = window.populateVoiceList;
}

window.flushSpeech = function() {
    window.speechSynthesis.cancel();
    window.speechQueue = [];
    window.currentSentence = "";
    window.currentCharIndex = 0;
    window.currentSpeakerId = null;
    window.activeSpeakerId = null; // keep in sync with currentSpeakerId so a stale remote ID can't leak into later local playback
    window.voiceState = "idle";
    window.pulseIntensity = 0;
    window.isReplaying = false;
    if(window.updateSpeechBubble) window.updateSpeechBubble("", null);
    window.updateVoiceToggleUI("idle");
    
    const rc = document.getElementById("roomCaption");
    const arc = document.getElementById("ar-roomCaption");
    if(rc) rc.style.display = "none";
    if(arc) arc.style.display = "none";
};

window.toggleVoicePause = function(isAR = false) {
    if (window.voiceState === "speaking") {
        window.voiceState = "paused";
        window.speechSynthesis.cancel();
        
        if (window.currentSentence) {
            let slicedText = window.currentSentence;
            
            if (window.currentCharIndex > 0 && window.currentCharIndex < window.currentSentence.length) {
                let textUpToPause = window.currentSentence.substring(0, window.currentCharIndex);
                let lastPauseMark = Math.max(
                    textUpToPause.lastIndexOf(','), 
                    textUpToPause.lastIndexOf(';'), 
                    textUpToPause.lastIndexOf('-'),
                    textUpToPause.lastIndexOf('，'), 
                    textUpToPause.lastIndexOf('、')  
                );
                
                if (lastPauseMark !== -1) {
                    slicedText = window.currentSentence.substring(lastPauseMark + 1).trim();
                }
            }
            if (slicedText.length > 0) {
                window.speechQueue.unshift({ text: slicedText, speakerId: window.currentSpeakerId });
            }
        }
        window.updateVoiceToggleUI("paused");
        window.updateLog("Readout paused.");
    } 
    else if (window.voiceState === "paused") {
        window.voiceState = "speaking";
        window.updateVoiceToggleUI("speaking");
        window.updateLog("Readout resumed.");
        playNextSentence();
    } 
    else if (window.voiceState === "idle") {
        const targetBox = isAR ? document.getElementById("ar-styledOutput") : document.getElementById("styledOutput");
        if (!targetBox) return;
        
        const fullText = targetBox.innerText.trim();
        if (!fullText || fullText === "Awaiting handoff execution...") return;

        let rawSentences = fullText.match(/[^.!?\n。！？]+[.!?\n。！？]*/g) || [fullText];
        window.speechQueue = rawSentences.map(s => s.trim()).filter(s => s.length > 0).map(s => ({
            text: s,
            speakerId: null // Local user self-readout
        }));
        
        if (window.speechQueue.length > 0) {
            window.voiceState = "speaking";
            window.updateVoiceToggleUI("speaking");
            playNextSentence();
        }
    }
};

window.playNextSentence = playNextSentence; // expose so replaySimulation() in index.html can invoke it

function playNextSentence() {
    if (window.voiceState !== "speaking") return;

    if (window.speechQueue.length === 0) {
        window.voiceState = "idle";
        window.currentSpeakerId = null;
        window.activeSpeakerId = null; // clear here too, not just currentSpeakerId, so the next local playback starts clean
        window.isReplaying = false;
        
        document.getElementById("styledOutput").classList.remove("typewriter-cursor");
        document.getElementById("ar-styledOutput").classList.remove("typewriter-cursor");
        
        window.updateVoiceToggleUI("idle");
        if(window.updateSpeechBubble) window.updateSpeechBubble("", null);
        
        const rc = document.getElementById("roomCaption");
        const arc = document.getElementById("ar-roomCaption");
        if(rc) rc.style.display = "none";
        if(arc) arc.style.display = "none";
        
        window.updateLog("Voice readout complete.");
        return;
    }

    let activeItem = window.speechQueue.shift();
    window.currentSentence = activeItem.text;
    window.currentSpeakerId = activeItem.speakerId;
    
    if(window.updateSpeechBubble) window.updateSpeechBubble(window.currentSentence, window.currentSpeakerId);

    if (window.isReplaying && window.appendReplayText) {
        window.appendReplayText(window.currentSentence);
    }

    let utterance = new SpeechSynthesisUtterance(window.currentSentence);
    window.utteranceRetainer.push(utterance);
    // Trim the retainer to avoid unbounded memory growth — keep the last 20
    // entries so the browser can't GC active utterances while still releasing old ones.
    if (window.utteranceRetainer.length > 20) window.utteranceRetainer.splice(0, window.utteranceRetainer.length - 20);

    const selectedVoiceSelect = document.getElementById("voiceSelect");
    if (selectedVoiceSelect) {
        const freshVoices = window.speechSynthesis.getVoices();
        const freshVoice = freshVoices.find(v => v.name === selectedVoiceSelect.value);
        if (freshVoice) utterance.voice = freshVoice;
    }

    utterance.onboundary = (e) => {
        if(e.name === 'word') {
            window.pulseIntensity = 1.0;
            window.currentCharIndex = e.charIndex; 
        }
    };

    utterance.onend = () => {
        if (window.voiceState === "speaking") setTimeout(playNextSentence, 50);
    };

    utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
            window.updateLog(`<span style="color:red;">TTS Error: ${e.error}</span>`);
            if (window.voiceState === "speaking") setTimeout(playNextSentence, 50);
        }
    };

    window.speechSynthesis.speak(utterance);
}

window.updateVoiceToggleUI = function(state) {
    const flatBtn = document.getElementById("voiceBtn");
    const arBtn = document.getElementById("ar-voiceBtn");

    let label = "🔊 Read Aloud";
    let color = "#3182ce";

    if (state === "speaking") {
        label = "⏸ Pause";
        color = "#e53e3e";
    } else if (state === "paused") {
        label = "▶ Resume";
        color = "#38a169";
    }

    if (flatBtn) { flatBtn.innerText = label; flatBtn.style.background = color; }
    if (arBtn) { arBtn.innerText = label; arBtn.style.background = color; }
};
