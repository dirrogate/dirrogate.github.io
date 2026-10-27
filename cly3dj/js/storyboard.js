// #527 DirroComics STORYBOARD (AI). Runs in the VJ desk (vjdesk.html). The VJ ticks clips / pictures in the strip, picks a genre
// and a panel count (8 to 12), and an AI model writes a storyboard: one entry per panel with the source to use, the framing
// (zoom + focus point, as FRAME X / Y / ZOOM), the inking style and the text (narrator captions, speech / thought / shout balloons,
// SFX) with where they sit. The VJ reads it, then ADD (one panel) or ADD ALL: each becomes a new panel at the end of the strip,
// sharing the source's media file. Nothing goes on air by itself; a ⭐ guest's lines still need their YES (the #524 gate).
// Engines (owner, 27 Oct): Gemini (Google's free tier) or the Claude API (paid), called straight from this page with the VJ's own
// key (kept in this browser's storage only). The AI sees a few small JPEG frames per source, never the files themselves.
// ⭐ guest photos go only when 'Send ⭐ guest photos' is ticked (off by default until the terms mention AI processing).

const GENRES = [['noir', 'FILM NOIR'], ['horror', 'HORROR'], ['micro', 'MICRO DRAMA'], ['cyber', 'CYBERPUNK']];
const GENRE_NOTES = {
  noir: 'Film noir: hard-boiled first-person narrator captions, rain, neon, cigarette smoke, betrayal, a record nobody should own. Clipped, cynical lines.',
  horror: 'Horror: dread that builds slowly, something wrong with the music or the crowd, a reveal near the end. Short, frightened lines; SFX that creep.',
  micro: 'Micro drama: a small personal story told fast, like a 60-second vertical drama: a want, an obstacle, a twist, an emotional hook on the last panel.',
  cyber: 'Cyberpunk: neon, chrome, data, corporations, augmented DJs, glitching signals; street slang; the turntables as hacking rigs.'
};
const STYLES = ['halftone', 'hatch', 'benday', 'poster', 'photo'];
const KINDS = { caption: 'cap', narrator: 'cap', cap: 'cap', speech: 'speech', thought: 'thought', shout: 'shout', sfx: 'sfx' };
const PW = 1120, PH = 850, PA = PW / PH;   // the comic panel (comics.js REF)
const LS = k => { try { return JSON.parse(localStorage.getItem('vire.sb.' + k) || 'null'); } catch { return null; } };
const SS = (k, v) => { try { localStorage.setItem('vire.sb.' + k, JSON.stringify(v)); } catch {} };

export function initStoryboard(ctx) {
  const { $, esc, cx, cxRead } = ctx;
  const css = document.createElement('style');
  css.textContent = `#sbS textarea { width:100%; min-height:54px; font:14px system-ui; color:var(--fg); background:#1c2230; border:1px solid var(--line); border-radius:8px; padding:6px; box-sizing:border-box; }
  #sbSrc { display:flex; gap:8px; overflow-x:auto; padding:6px 2px; } .sbT { flex:0 0 auto; width:124px; border:2px solid var(--line); border-radius:8px; padding:2px; cursor:pointer; background:#0f131c; font:700 11px system-ui; color:var(--mute); }
  .sbT img { width:116px; height:66px; object-fit:cover; display:block; border-radius:5px; background:#000; } .sbT.on { border-color:#f2c94c; color:#f2c94c; } .sbT.off { opacity:.35; cursor:not-allowed; }
  #sbOut { display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:8px; margin-top:8px; }
  .sbP { border:1px solid #2b3550; border-radius:8px; padding:7px; background:#121826; font-size:12px; } .sbP.done { opacity:.5; } .sbP img { width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:5px; background:#000; }
  .sbP .shot { color:var(--mute); margin:4px 0; } .sbP .ln { margin:3px 0; } .sbP .ln b { color:#f2c94c; font-size:10px; margin-right:4px; } .sbP .ln i { color:#9cc8ff; font-style:normal; }
  #sbKey { width:240px; } #sbModel { max-width:260px; }`;
  document.head.appendChild(css);
  const sec = document.createElement('section'); sec.id = 'sbS'; sec.style.cssText = 'margin:0 16px 16px';
  sec.innerHTML = `<h2>DirroComics storyboard (AI) <span class="note" style="text-transform:none;letter-spacing:0">tick clips and pictures in the strip, pick a genre, WRITE; then add the panels you like</span></h2>
  <div class="row"><span class="sp">Engine</span><select id="sbEng"><option value="gemini">Gemini (Google, free tier)</option><option value="claude">Claude API (Anthropic, paid)</option></select>
    <span class="sp">Model</span><select id="sbModel"></select><button id="sbList" title="Ask the engine which models this key can use">↻ MODELS</button>
    <input type="password" id="sbKey" placeholder="API key" autocomplete="off"><button id="sbKeySave" title="Kept in this browser on this laptop only">SAVE KEY</button><span id="sbKeySt" class="sp"></span></div>
  <div class="row"><span class="sp">Genre</span><select id="sbGenre">${GENRES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span class="sp">Panels</span><select id="sbN">${[8, 9, 10, 11, 12].map(n => `<option${n === 10 ? ' selected' : ''}>${n}</option>`).join('')}</select>
    <label class="sp"><input type="checkbox" id="sbStars"> Send ⭐ guest photos</label>
    <button id="sbAll">TICK ALL</button><button id="sbNone">TICK NONE</button></div>
  <div id="sbSrc"></div>
  <textarea id="sbNotes" maxlength="1200" placeholder="Cast and story notes (optional), e.g. 'The man in the gas mask is DIRRODJ, the DJ. The robot is his sidekick. Start in 1958, end in the club tonight.'"></textarea>
  <div class="row"><button id="sbGo" class="on">WRITE STORYBOARD</button><button id="sbAddAll">ADD ALL TO STRIP</button><button id="sbClear">DISCARD</button><span id="sbMsg" class="note" style="margin:0"></span></div>
  <div id="sbHead" class="note"></div><div id="sbOut"></div>`;
  $('cxS').after(sec);

  // ---- settings (this laptop only)
  let eng = LS('eng') || 'gemini', keys = LS('keys') || {}, models = LS('models') || {}, pick = LS('pick') || {}, ticked = new Set(LS('ticked') || []), board = LS('board');
  $('sbEng').value = eng; $('sbGenre').value = LS('genre') || 'noir'; $('sbN').value = String(LS('n') || 10); $('sbNotes').value = LS('notes') || '';
  const say = t => { $('sbMsg').textContent = t; };
  function engUi() {
    $('sbKey').value = ''; $('sbKey').placeholder = keys[eng] ? 'key saved (…' + keys[eng].slice(-4) + ')' : (eng === 'gemini' ? 'Gemini API key (Google AI Studio)' : 'Claude API key (console)');
    $('sbKeySt').textContent = eng === 'gemini' ? 'Free tier: Google may use what is sent to improve its products.' : 'Paid per use; billed to your Anthropic account.';
    const list = models[eng] || []; $('sbModel').innerHTML = list.length ? list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('') : '<option value="">press ↻ MODELS</option>';
    if (pick[eng] && list.includes(pick[eng])) $('sbModel').value = pick[eng];
  }
  engUi();
  $('sbEng').onchange = e => { eng = e.target.value; SS('eng', eng); engUi(); };
  $('sbModel').onchange = e => { pick[eng] = e.target.value; SS('pick', pick); };
  $('sbKeySave').onclick = () => { const k = $('sbKey').value.trim(); if (!k) { delete keys[eng]; say('Key removed'); } else { keys[eng] = k; say('Key saved on this laptop'); } SS('keys', keys); engUi(); if (k) listModels(); };
  $('sbList').onclick = () => listModels();
  for (const [id, k] of [['sbGenre', 'genre'], ['sbN', 'n']]) $(id).onchange = e => SS(k, id === 'sbN' ? +e.target.value : e.target.value);
  $('sbNotes').oninput = e => SS('notes', e.target.value);

  async function listModels() {
    const key = keys[eng]; if (!key) { say('Save an API key first'); return; }
    say('Asking for the model list…');
    try {
      let list = [];
      if (eng === 'gemini') {
        const j = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })).json();
        if (j.error) throw new Error(j.error.message);
        list = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini|gemma/i.test(m.name) && !/tts|image|live|embed|audio|transcribe|native/i.test(m.name)).map(m => m.name.replace(/^models\//, ''));
        const ver = n => +((n.match(/(\d+(?:\.\d+)?)/) || [, 0])[1]);
        list.sort((a, b) => (/flash/.test(b) && !/lite/.test(b)) - (/flash/.test(a) && !/lite/.test(a)) || ver(b) - ver(a));
      } else {
        const j = await (await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: claudeHeaders(key) })).json();
        if (j.error) throw new Error(j.error.message);
        list = (j.data || []).map(m => m.id);
        list.sort((a, b) => /haiku/.test(b) - /haiku/.test(a));
      }
      if (!list.length) throw new Error('no models for this key');
      models[eng] = list; SS('models', models); if (!pick[eng] || !list.includes(pick[eng])) { pick[eng] = list[0]; SS('pick', pick); }
      engUi(); say(`${list.length} models. Using ${pick[eng]}.`);
    } catch (e) { say('Model list failed: ' + e.message); }
  }
  const claudeHeaders = key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' });

  // ---- sources: the strip's panels, ticked by the VJ
  let srcKey = '';
  function srcUi() {
    const C = ctx.CX; if (!C) return; const P = C.panels, th = ctx.thumbs(), allow = $('sbStars').checked;
    const k = [P.map(p => p.id).join(','), [...ticked].join(','), allow, Object.keys(th).length].join('|'); if (k === srcKey) return; srcKey = k;
    $('sbSrc').innerHTML = P.map((p, i) => { const off = p.star && !allow; return `<div class="sbT${ticked.has(p.id) && !off ? ' on' : ''}${off ? ' off' : ''}" data-id="${p.id}" title="${off ? '⭐ guest photo: tick Send ⭐ guest photos to use it' : esc(p.name || '')}"><img src="${th[p.id] || ''}" alt="">${i + 1} · ${p.star ? '⭐ ' : ''}${p.kind === 'video' ? 'CLIP' : 'PICTURE'}${ticked.has(p.id) && !off ? ' ✓' : ''}</div>`; }).join('') || '<div class="note">Import clips and pictures into the strip first.</div>';
    for (const d of $('sbSrc').children) if (d.dataset.id) d.onclick = () => { if (d.classList.contains('off')) return; ticked.has(d.dataset.id) ? ticked.delete(d.dataset.id) : ticked.add(d.dataset.id); SS('ticked', [...ticked]); srcUi(); };
  }
  $('sbStars').onchange = () => { srcKey = ''; srcUi(); };
  $('sbAll').onclick = () => { for (const p of (ctx.CX && ctx.CX.panels) || []) if (!p.star || $('sbStars').checked) ticked.add(p.id); SS('ticked', [...ticked]); srcKey = ''; srcUi(); };
  $('sbNone').onclick = () => { ticked.clear(); SS('ticked', []); srcKey = ''; srcUi(); };
  setInterval(srcUi, 800);

  // ---- frames for the AI: stills once, clips at three moments; the eye's own picture for side by side / RGB+D
  async function framesOf(p) {
    const f = await cxRead(p.file); if (!f) return [];
    const url = URL.createObjectURL(f), out = [];
    try {
      const ew = (p.sbs === 1 || p.sbs === 3 ? 0.5 : p.sbs === 2 ? 0.5 : 1);
      const snap = (el, w, h) => { const sw = w * ew, k = Math.min(1, 640 / Math.max(sw * (p.sbs === 2 ? 2 : 1), h)), cw = Math.round(sw * (p.sbs === 2 ? 2 : 1) * k), ch = Math.round(h * k), c = document.createElement('canvas'); c.width = cw; c.height = ch; c.getContext('2d').drawImage(el, 0, 0, sw, h, 0, 0, cw, ch); return c.toDataURL('image/jpeg', 0.72).split(',')[1]; };
      if (p.kind === 'video') {
        const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
        await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('video')); setTimeout(ok, 8000); });
        const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
        for (const t of [0.1, 0.5, 0.9].map(x => Math.min(d - 0.05, d * x))) { v.currentTime = t; await new Promise(ok => { v.onseeked = ok; setTimeout(ok, 2500); }); out.push({ t: Math.round(t * 10) / 10, data: snap(v, v.videoWidth, v.videoHeight) }); }
        out.dur = Math.round(d * 10) / 10;
      } else {
        const im = new Image(); await new Promise((ok, no) => { im.onload = ok; im.onerror = () => no(new Error('image')); im.src = url; });
        out.push({ data: snap(im, im.naturalWidth, im.naturalHeight) });
      }
    } finally { URL.revokeObjectURL(url); }
    return out;
  }

  // ---- the request
  function systemText(n, genre) {
    return [
      'You are the writer and layout artist of DIRROCOMICS, a live comic strip made during a DJ set in a nightclub. House style: CyberGrunge meets Steampunk, a time-travel trip back to 1950s and 60s newsprint comics: halftone dots, cream paper, typewriter captions, hand-lettered balloons, big SFX.',
      `Write a storyboard of exactly ${n} panels in this genre. ${GENRE_NOTES[genre]}`,
      'You get numbered SOURCES (video clips shown as a few frames, or still pictures). Every panel must use one source; a source may be reused with different framing (wide, medium, close-up) to make new panels. Tell a clear story with a beginning, a turn and an ending; the last panel should land a punchline, twist or hook.',
      'Text on a panel: at most 3 items. Kinds: "caption" (narrator box, max 18 words), "speech", "thought", "shout" (max 12 words each), "sfx" (one or two words, comic sound effects like KRRSSHH!, THOOM, BZZT). Use SFX where something happens.',
      'Who may talk: only the characters named in the cast notes, guests marked STAR (use their comic name as the speaker), a narrator (captions only) and invented off-panel voices. Real people in the pictures who are not named must never be given speech or thoughts; they can be described in captions as the crowd or background.',
      'Never write sexual content, slurs, or anything that mocks a real person\'s looks, body or identity. Keep it fun for a club audience.',
      'Coordinates are fractions of the SOURCE picture: x 0 = left, 1 = right; y 0 = top, 1 = bottom.',
      'Reply with JSON only, no other text, in this shape:',
      '{"title": "short title", "logline": "one sentence", "panels": [{"src": 1, "shot": "what we see and why, one sentence", "zoom": 1.0, "focus": [0.5, 0.5], "style": "halftone|hatch|benday|poster|photo", "text": [{"kind": "caption|speech|thought|shout|sfx", "text": "...", "speaker": "name or null", "at": [x, y], "to": [x, y]}]}]}',
      'zoom is 1 (whole picture) to 3 (tight close-up) and focus is the centre of the framing. For speech, thought and shout, "to" is the speaker\'s mouth or head (the balloon\'s tail points there) and "at" is where the balloon sits, in empty space near them, not over faces. For captions, "at" is near the top or bottom edge. For sfx, "at" is where the action is. Keep "at" inside the framing.'
    ].join('\n');
  }
  async function write() {
    const C = ctx.CX; if (!C) { say('No DirroVJ connected'); return; }
    const key = keys[eng], model = $('sbModel').value; if (!key) { say('Save an API key first'); return; } if (!model) { say('Press ↻ MODELS first'); return; }
    const allow = $('sbStars').checked, src = C.panels.filter(p => ticked.has(p.id) && (!p.star || allow));
    if (!src.length) { say('Tick at least one clip or picture'); return; } if (src.length > 16) { say('At most 16 sources'); return; }
    const n = +$('sbN').value, genre = $('sbGenre').value, stars = (C.stars || []).filter(s => !s.wd);
    $('sbGo').disabled = true;
    try {
      say('Reading the frames…'); const parts = [];
      const castStars = stars.filter(s => src.some(p => p.star === s.dev) || allow).map(s => `${s.name} (STAR, genre ${s.genre}${s.lines && s.lines.length ? ', their own lines: ' + s.lines.map(l => '"' + l + '"').join(' / ') : ''})`);
      parts.push({ text: `Genre: ${GENRES.find(g => g[0] === genre)[1]}. Panels: ${n}.\nCast notes from the VJ: ${$('sbNotes').value.trim() || '(none)'}\n${castStars.length ? 'STAR guests who agreed to be characters: ' + castStars.join('; ') : 'No STAR guests.'}` });
      const srcs = [];
      for (let i = 0; i < src.length; i++) {
        say(`Reading the frames: source ${i + 1} / ${src.length}…`);
        const p = src[i], fr = await framesOf(p), st = p.star && stars.find(s => s.dev === p.star);
        if (!fr.length) continue; srcs.push(p);
        parts.push({ text: `SOURCE ${srcs.length}: ${p.kind === 'video' ? `video clip, ${fr.dur} s, frames at ${fr.map(f => f.t + ' s').join(', ')}` : 'still picture'}${st ? `, the photo of STAR guest ${st.name}` : ''}` });
        for (const f of fr) parts.push({ img: f.data });
      }
      if (!srcs.length) throw new Error('could not read the ticked media');
      say(`Writing with ${model}…`);
      const t0 = performance.now(), sys = systemText(n, genre); let text = '', usage = '';
      if (eng === 'gemini') {
        const body = { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: parts.map(x => x.img ? { inlineData: { mimeType: 'image/jpeg', data: x.img } } : { text: x.text }) }], generationConfig: { responseMimeType: 'application/json', temperature: 0.9 } };
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json(); if (j.error) throw new Error(j.error.message);
        text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(x => x.text || '').join('');
        if (j.usageMetadata) usage = `${j.usageMetadata.promptTokenCount || 0} in / ${j.usageMetadata.candidatesTokenCount || 0} out tokens`;
      } else {
        const body = { model, max_tokens: 6000, system: sys, messages: [{ role: 'user', content: parts.map(x => x.img ? { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: x.img } } : { type: 'text', text: x.text }) }] };
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: claudeHeaders(key), body: JSON.stringify(body) });
        const j = await r.json(); if (j.error) throw new Error(j.error.message);
        text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
        if (j.usage) usage = `${j.usage.input_tokens || 0} in / ${j.usage.output_tokens || 0} out tokens`;
      }
      const sb = parse(text, srcs.length); if (!sb.panels.length) throw new Error('the reply had no panels');
      sb.src = srcs.map(p => p.id); sb.genre = genre; sb.model = model; sb.at = Date.now();
      board = sb; SS('board', board); show();
      say(`Storyboard ready: ${sb.panels.length} panels in ${((performance.now() - t0) / 1000).toFixed(0)} s${usage ? ' · ' + usage : ''}. Read it, then ADD the panels you want.`);
    } catch (e) { say('Storyboard failed: ' + e.message); } finally { $('sbGo').disabled = false; }
  }
  $('sbGo').onclick = write;

  const num = (v, d, lo, hi) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const pt = (a, d) => Array.isArray(a) && a.length >= 2 ? [num(a[0], d[0], 0, 1), num(a[1], d[1], 0, 1)] : d;
  function parse(text, nSrc) {
    let j; const m = String(text).match(/\{[\s\S]*\}/); try { j = JSON.parse(m ? m[0] : text); } catch { throw new Error('the reply was not valid JSON'); }
    const panels = (Array.isArray(j.panels) ? j.panels : []).slice(0, 12).map(p => ({
      src: Math.round(num(p.src, 1, 1, nSrc)), shot: String(p.shot || '').slice(0, 300), zoom: num(p.zoom, 1, 1, 3), focus: pt(p.focus, [0.5, 0.5]),
      style: STYLES.includes(String(p.style).toLowerCase()) ? String(p.style).toLowerCase() : '',
      text: (Array.isArray(p.text) ? p.text : []).slice(0, 4).map(t => ({ kind: KINDS[String(t.kind || '').toLowerCase()] || 'cap', text: String(t.text || '').slice(0, 160), speaker: t.speaker && t.speaker !== 'null' ? String(t.speaker).slice(0, 40) : '', at: pt(t.at, [0.3, 0.2]), to: Array.isArray(t.to) ? pt(t.to, [0.5, 0.5]) : null })).filter(t => t.text)
    }));
    return { title: String(j.title || '').slice(0, 80), logline: String(j.logline || '').slice(0, 300), panels };
  }

  // ---- show and assemble
  function show() {
    if (!board) { $('sbHead').textContent = ''; $('sbOut').innerHTML = ''; return; }
    const C = ctx.CX, th = ctx.thumbs(), KN = { cap: 'CAPTION', speech: 'SPEECH', thought: 'THOUGHT', shout: 'SHOUT', sfx: 'SFX' };
    $('sbHead').innerHTML = `<b style="color:#f2c94c">${esc(board.title || 'Untitled')}</b> · ${esc(GENRES.find(g => g[0] === board.genre)?.[1] || '')} · ${esc(board.logline || '')} <span class="sp">(${esc(board.model || '')})</span>`;
    $('sbOut').innerHTML = board.panels.map((p, i) => { const id = board.src[p.src - 1], ok = C && C.panels.some(x => x.id === id);
      return `<div class="sbP${p.added ? ' done' : ''}"><img src="${(ok && th[id]) || ''}" alt=""><div><b>PANEL ${i + 1}</b> · source ${p.src} · zoom ${p.zoom.toFixed(1)}${p.style ? ' · ' + p.style.toUpperCase() : ''}</div><div class="shot">${esc(p.shot)}</div>`
        + p.text.map(t => `<div class="ln"><b>${KN[t.kind]}</b>${t.speaker ? `<i>${esc(t.speaker)}:</i> ` : ''}${esc(t.text)}</div>`).join('')
        + `<div class="row"><button data-sba="${i}"${ok ? '' : ' disabled title="Its source is no longer in the strip"'}>${p.added ? 'ADD AGAIN' : 'ADD'}</button></div></div>`; }).join('');
    for (const b of document.querySelectorAll('[data-sba]')) b.onclick = () => add([+b.dataset.sba]);
  }
  function crop(sp, p) {   // the framing (comics.js euv): zoom + focus -> FRAME X / Y / ZOOM, and a source point -> a panel point
    const ea = (sp.sbs === 1 || sp.sbs === 3 ? sp.w / 2 : sp.w) / Math.max(1, sp.h), z = p.zoom; let cw, ch;
    if (ea > PA) { ch = 1 / z; cw = PA / ea / z; } else { cw = 1 / z; ch = ea / PA / z; }
    const ox = Math.max(0, Math.min(1 - cw, p.focus[0] - cw / 2)), oy = Math.max(0, Math.min(1 - ch, p.focus[1] - ch / 2));
    return { fx: p.focus[0], fy: p.focus[1], zoom: z, map: ([x, y]) => [(x - ox) / cw, (y - oy) / ch] };
  }
  const r3 = v => Math.round(v * 1000) / 1000, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  function itemsFor(sp, p, cr, stars) {
    const out = [], capTop = p.text.some(t => t.kind === 'cap' && cr.map(t.at)[1] <= 0.5);
    for (const t of p.text) {
      const it = { t: t.kind, text: t.text }; let [x, y] = cr.map(t.at);
      if (t.kind === 'cap') { Object.assign(it, { s: 28, w: 0.44 }); x = cl(x, 0.24, 0.76); y = y > 0.5 ? 0.9 : 0.09; }
      else if (t.kind === 'sfx') { Object.assign(it, { s: t.text.length > 8 ? 90 : 120, r: Math.round(Math.random() * 16 - 12) }); x = cl(x, 0.15, 0.85); y = cl(y, 0.15, 0.85); }
      else {
        Object.assign(it, { s: t.kind === 'shout' ? 36 : 32, w: t.text.length > 40 ? 0.34 : 0.28 }); x = cl(x, 0.17, 0.83); y = cl(y, capTop ? 0.32 : 0.12, 0.6);   // below a top caption
        const to = t.to ? cr.map(t.to) : [x + 0.12, y + 0.2]; it.tx = r3(cl(to[0], 0.02, 0.98)); it.ty = r3(cl(to[1], 0.05, 0.98));
        const st = t.speaker && stars.find(s => s.name.toLowerCase() === t.speaker.toLowerCase());
        if (st) it.star = st.dev;   // a guest's line: hidden until they say YES (ASK on the panel)
      }
      it.x = r3(x); it.y = r3(y); out.push(it);
    }
    return out;
  }
  function add(list) {
    const C = ctx.CX; if (!C || !board) return; const stars = (C.stars || []).filter(s => !s.wd); let n = 0, asks = 0;
    for (const i of list) {
      const p = board.panels[i], sp = C.panels.find(x => x.id === board.src[p.src - 1]); if (!sp) continue;
      const cr = crop(sp, p), items = itemsFor(sp, p, cr, stars); asks += items.filter(it => it.star).length;
      cx('sbadd', { src: sp.id, v: { fx: r3(cr.fx), fy: r3(cr.fy), zoom: r3(cr.zoom), items, ...(p.style ? { style: p.style } : {}) } });
      p.added = true; n++;
    }
    SS('board', board); show(); say(`${n} panel${n === 1 ? '' : 's'} added at the end of the strip${asks ? `; ${asks} ⭐ guest line${asks === 1 ? ' needs' : 's need'} ASK and their YES before they show` : ''}.`);
  }
  $('sbAddAll').onclick = () => { if (board) add(board.panels.map((_, i) => i).filter(i => !board.panels[i].added)); };
  $('sbClear').onclick = () => { if (board && !confirm('Discard this storyboard?')) return; board = null; SS('board', null); show(); say(''); };
  show();
  return { show, _parse: parse, _crop: crop, _items: itemsFor, _add: add, _board: () => board, _set: b => { board = b; show(); } };
}
