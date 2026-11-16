// #724 MOON CASE (Cyber MOONday whodunnit, owner 13 Nov). Runs in the VJ desk (vjdesk.html), section #mcS.
// The bar log of the reserved tables stays on this desk only: nothing about tables, drinks or trips goes on the screens.
// The program only shows the Moon (vjdesk.js 'moon'): it loses a slice per shadow point and fills back per moon drink, for the
// whole room, sent 2 to 4 minutes after the log entry (random) so a glass can't be matched to a slice at once.
// WRITE LINES: Gemini (the storyboard's key and model, vire.sb.*) writes DIRRODJ observations from the log; the VJ picks one and
// SEND puts it on the sine scroller. Rules in the prompt: never name a table, seat, number or count.

const KINDS = {
  moon: { label: 'MOON', pts: -1, tip: 'Clear drink: citrus, salt or sugar rim, sweet mixer, Sprite, lime soda' },
  gmoon: { label: 'GREY → MOON', pts: -1, tip: 'Grey drink the log counts as Moon (the garnish decides)' },
  gdark: { label: 'GREY → DARK', pts: 1, tip: 'Grey drink the log counts as dark (e.g. rum + Coke with a lime wheel)' },
  dark: { label: 'DARK', pts: 1, tip: 'Dark side: Eclipse, Coke, rum, whisky neat, stout' },
  away: { label: 'AWAY', pts: 1, tip: 'Left the table: smoke or toilet' },
  noalibi: { label: 'NO ALIBI', pts: 1, tip: 'No reply / no clear photo when evidence was asked on the screen' }
};
const STOCK = [
  'THE DARK SIDE LIKES TALL GLASSES TONIGHT.',
  'SOMEONE ORDERED SUNLIGHT AND DRANK THE NIGHT.',
  'THE MOON LOST MORE IN TEN MINUTES THAN ALL EVENING.',
  'A LEMON WEDGE IS NOT AN ALIBI.',
  'NOT EVERY EMPTY CHAIR IS A SMOKE BREAK.',
  'THE ICE IS MELTING FASTER AT ONE TABLE.',
  'CLEAR GLASSES TELL THE TRUTH. MOSTLY.',
  'SOMEBODY TOASTED THE DARK AND HOPED NOBODY SAW.',
  'THE MOON IS COUNTING. ARE YOU?',
  'A SALT RIM CAN HIDE A LOT OF SINS.',
  'THE LAST ROUND WAS DARKER THAN THE ONE BEFORE.',
  'NOT EVERYONE IN THE PHOTO WAS IN THE PHOTO.',
  'THE SHADOW DRINKS SLOWLY. THE MOON DRINKS FAST.',
  'TWO TABLES. ONE MOON. NO COINCIDENCES.',
  'CHECK THE GLASSES, NOT THE FACES.',
  'THE MOON FILLED BACK A LITTLE. SOMEONE IS SORRY.',
  'EVERY ALIBI PHOTO HAS A GLASS IN IT. LOOK.',
  'THE DARK SIDE IS PATIENT. THE BAR IS NOT.',
  'SOMEONE IS DRINKING THE NIGHT IN A CLEAR DISGUISE.',
  'FULL MOON TONIGHT. FOR NOW.'
];
const SLICE = 1 / 12;
const LSK = 'vire.moonCase';
const load = () => { try { return JSON.parse(localStorage.getItem(LSK) || 'null'); } catch { return null; } };
const sbGet = k => { try { return JSON.parse(localStorage.getItem('vire.sb.' + k) || 'null'); } catch { return null; } };
const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

export function initMoonCase() {
  const root = document.getElementById('mcS'); if (!root) return;
  const bc = new BroadcastChannel('dirrovj');
  const S = Object.assign({ tables: ['TABLE 1', 'TABLE 2'], log: [], walk: {}, on: true, shown: 1, pend: [], lines: [], minD: 2, maxD: 4, codes: [], ev: null, seen: {} }, load() || {});
  // #767 table codes: a short code per reserved table, printed on a tent card; guests type it on the STAR sheet with their photo.
  const ABC = 'ACDEFGHJKMNPQRTUVWXY34679', mkCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => ABC[b % ABC.length]).join('');
  const fixCodes = () => { S.codes = S.codes || []; S.tables.forEach((_, i) => { if (!S.codes[i]) S.codes[i] = mkCode(); }); };
  fixCodes();
  let stars = [], starImgs = {};
  const tableOf = code => S.codes.indexOf(String(code || '').toUpperCase());
  bc.addEventListener('message', e => { const m = e.data || {};
    if (m.k === 'state' && m.C && m.C.stars) { stars = m.C.stars; let ch = false; for (const s of stars) if (!S.seen[s.cid]) { S.seen[s.cid] = Date.now(); ch = true; } if (ch) { save(); drawEv(); } }
    else if (m.k === 'cxlist' && m.starImgs) { starImgs = m.starImgs; drawEv(); } });
  const save = () => { try { localStorage.setItem(LSK, JSON.stringify(S)); } catch {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const score = i => S.log.filter(e => e.tb === i).reduce((a, e) => a + KINDS[e.k].pts, 0);
  const target = () => { let v = 1; for (const e of S.log) if (e.tb >= 0) v = Math.max(0, Math.min(1, v - KINDS[e.k].pts * SLICE)); return v; };
  const sendMoon = () => bc.postMessage({ k: 'moon', on: !!S.on, v: S.shown });

  root.innerHTML = `
    <h2>Moon case <span class="note" style="text-transform:none;letter-spacing:0">bar log stays on this desk · only the Moon goes on the program</span></h2>
    <div class="row"><input type="text" id="mcDrink" maxlength="40" placeholder="drink (optional): rum + Coke, lime wheel" style="flex:1"><label class="kv"><span>seat</span><input type="number" id="mcSeat" min="0" max="4" value="0" style="width:44px"></label></div>
    <div id="mcTabs"></div>
    <div class="row"><span class="sp" style="white-space:nowrap">WALK-IN</span><input type="text" id="mcWalk" maxlength="24" placeholder="name or description" style="flex:1"><button id="mcWalkM" title="A walk-in's moon drink: 3 = MoonSaver badge">+ MOON</button></div>
    <div class="note" id="mcSaver"></div>
    <div class="row"><button id="mcOn" title="Show the Moon on the program (all buses, Twitch, DirroTV)">MOON ON PROGRAM</button><button id="mcNow" title="Send the waiting changes to the Moon now">UPDATE NOW</button><span class="sp" id="mcMoon" style="flex:1"></span><button id="mcUndo">UNDO</button><button id="mcNew" title="Clear the log, the Moon back to full (click twice)">NEW NIGHT</button></div>
    <div class="row"><button id="mcEv" title="Puts the evidence call on the scroller and opens a 5 minute window: STAR photos with a table code count as alibis">EVIDENCE CALL</button><button id="mcCards" title="Tent cards with each table's code, to print">TABLE CARDS</button><button id="mcCodes" title="New codes for every table (click twice)">NEW CODES</button><span class="sp" id="mcEvSt" style="flex:1"></span></div>
    <div id="mcEvL"></div>
    <div class="row"><button id="mcWrite" title="Gemini writes DIRRODJ lines from the log (uses the AI storyboard's Gemini key)">WRITE LINES (AI)</button><button id="mcStock" title="Six lines from the stock list">STOCK LINES</button><span class="sp" id="mcAiSt" style="flex:1"></span></div>
    <div id="mcLines"></div>
    <details><summary class="note" style="cursor:pointer">Log (desk only)</summary><div id="mcLog" class="note" style="max-height:180px;overflow:auto"></div></details>`;
  const $ = id => root.querySelector('#' + id);

  function addEntry(tb, k) {
    S.log.push({ t: Date.now(), tb, k, d: $('mcDrink').value.trim(), seat: +$('mcSeat').value || 0 });
    $('mcDrink').value = '';
    const delay = (S.minD + Math.random() * (S.maxD - S.minD)) * 60000;
    S.pend.push({ at: Date.now() + delay, v: target() });
    save(); draw();
  }
  function tick() {
    const now = Date.now(); let ch = false;
    while (S.pend.length && S.pend[0].at <= now) { S.shown = S.pend.shift().v; ch = true; }
    if (ch) { save(); sendMoon(); }
    drawMoonLine();
  }
  function drawMoonLine() {
    const p = S.pend.length ? Math.max(0, Math.round((S.pend[0].at - Date.now()) / 1000)) : 0;
    $('mcMoon').textContent = `Moon on screen ${Math.round(S.shown * 100)}% · true ${Math.round(target() * 100)}%` + (S.pend.length ? ` · next change in ${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` : '');
  }
  function draw() {
    $('mcTabs').innerHTML = S.tables.map((n, i) => `<div class="row" style="flex-wrap:wrap"><input type="text" data-tn="${i}" value="${esc(n)}" maxlength="24" style="width:120px"><b class="sp" title="Table code (on the tent card)" style="min-width:52px;font-family:monospace">${esc(S.codes[i] || '')}</b><b class="sp" style="min-width:58px" title="Shadow points (desk only)">${score(i) > 0 ? '+' : ''}${score(i)}</b>` +
      Object.entries(KINDS).map(([k, K]) => `<button data-add="${i}:${k}" title="${esc(K.tip)}">${K.label}</button>`).join('') + '</div>').join('');
    root.querySelectorAll('[data-tn]').forEach(el => el.onchange = () => { S.tables[+el.dataset.tn] = el.value.trim().toUpperCase() || 'TABLE ' + (+el.dataset.tn + 1); save(); });
    root.querySelectorAll('[data-add]').forEach(el => el.onclick = () => { const [i, k] = el.dataset.add.split(':'); addEntry(+i, k); });
    const lead = S.tables.map((n, i) => [n, score(i)]).sort((a, b) => b[1] - a[1]);
    $('mcLog').innerHTML = `<b>Leaning thief: ${esc(lead[0][1] > lead[1][1] ? lead[0][0] : 'tied')}</b><br>` + S.log.slice().reverse().map(e => `${hhmm(e.t)} · ${esc(S.tables[e.tb] || '')}${e.seat ? ' seat ' + e.seat : ''} · ${KINDS[e.k].label}${e.d ? ' · ' + esc(e.d) : ''}`).join('<br>');
    const sav = Object.entries(S.walk).map(([n, c]) => `${esc(n)} ${c}${c >= 3 ? ' 🌕 MOONSAVER' : ''}`);
    $('mcSaver').innerHTML = sav.length ? 'Walk-ins: ' + sav.join(' · ') : '';
    $('mcOn').classList.toggle('on', !!S.on);
    drawLines(); drawMoonLine();
  }
  function drawLines() {
    $('mcLines').innerHTML = S.lines.map((l, i) => `<div class="row"><span style="flex:1">${esc(l)}</span><button data-ls="${i}">SEND</button><button data-lx="${i}">✕</button></div>`).join('');
    root.querySelectorAll('[data-ls]').forEach(el => el.onclick = () => { const l = S.lines[+el.dataset.ls]; bc.postMessage({ k: 'say', t: l.slice(0, 120) }); S.lines.splice(+el.dataset.ls, 1); save(); drawLines(); });
    root.querySelectorAll('[data-lx]').forEach(el => el.onclick = () => { S.lines.splice(+el.dataset.lx, 1); save(); drawLines(); });
  }
  // #767 EVIDENCE CALL: a scroller line, then 5 minutes; photos arriving with a table code are that table's alibi.
  const EV_MS = 5 * 60000;
  function evPhotos() { if (!S.ev) return []; return stars.filter(s => !s.wd && s.table && S.seen[s.cid] >= S.ev.t0 && S.seen[s.cid] <= S.ev.t0 + EV_MS); }
  function drawEv() {
    if (!S.ev) { $('mcEvSt').textContent = 'Codes: ' + S.tables.map((n, i) => n + ' ' + S.codes[i]).join(' · '); $('mcEvL').innerHTML = ''; return; }
    const left = Math.max(0, S.ev.t0 + EV_MS - Date.now()), open = left > 0, P = evPhotos();
    $('mcEvSt').textContent = open ? `Evidence window open ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : 'Evidence window closed ' + hhmm(S.ev.t0 + EV_MS);
    $('mcEvL').innerHTML = S.tables.map((n, i) => { const mine = P.filter(s => tableOf(s.table) === i);
      return `<div class="row" style="flex-wrap:wrap"><b style="min-width:120px">${esc(n)}</b>${mine.map(s => `<img src="${starImgs[s.cid] || ''}" title="${esc(s.name)} ${hhmm(S.seen[s.cid])}" style="height:44px;border-radius:4px">`).join('')}` +
        (mine.length ? `<span class="sp">${mine.length} photo${mine.length > 1 ? 's' : ''}</span>` : open ? '<span class="sp">waiting…</span>' : (S.ev.done || {})[i] ? '<span class="sp">NO ALIBI logged</span>' : `<button data-na="${i}" title="No photo came in: log NO ALIBI">NO ALIBI?</button>`) + '</div>'; }).join('') +
      (() => { const w = P.filter(s => tableOf(s.table) < 0); return w.length ? `<div class="note">Unknown codes: ${w.map(s => esc(s.table) + ' (' + esc(s.name) + ')').join(', ')}</div>` : ''; })();
    root.querySelectorAll('[data-na]').forEach(el => el.onclick = () => { const i = +el.dataset.na; S.ev.done = S.ev.done || {}; S.ev.done[i] = 1; addEntry(i, 'noalibi'); drawEv(); });
  }
  $('mcEv').onclick = () => { S.ev = { t0: Date.now() }; save(); bc.postMessage({ k: 'say', t: 'EVIDENCE CALL: SEND A STAR PHOTO WITH YOUR TABLE CODE IN 5 MINUTES. NO PHOTO, NO ALIBI.' }); drawEv(); };
  let codeArm = 0;
  $('mcCodes').onclick = () => { if (Date.now() - codeArm > 3000) { codeArm = Date.now(); $('mcCodes').textContent = 'CLICK AGAIN'; setTimeout(() => $('mcCodes').textContent = 'NEW CODES', 3000); return; } S.codes = []; fixCodes(); save(); draw(); drawEv(); };
  $('mcCards').onclick = () => { const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<title>Table cards</title><style>body{font-family:sans-serif;margin:0}.c{page-break-after:always;height:95vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}h1{font-size:44px;margin:0}.k{font:900 160px monospace;letter-spacing:12px;margin:20px 0}p{font-size:22px;max-width:640px}</style>` +
      S.tables.map((n, i) => `<div class="c"><h1>${esc(n)}</h1><div class="k">${esc(S.codes[i])}</div><p>Cyber MOONday. When the screen calls for evidence, open Dirrogram, tap ⭐ STAR and send a photo with this table code.</p></div>`).join('')); w.document.close(); w.print(); };
  $('mcWalkM').onclick = () => { const n = $('mcWalk').value.trim(); if (!n) return; S.walk[n] = (S.walk[n] || 0) + 1; save(); draw(); };
  $('mcOn').onclick = () => { S.on = !S.on; save(); sendMoon(); draw(); };
  $('mcNow').onclick = () => { if (S.pend.length) { S.shown = S.pend[S.pend.length - 1].v; S.pend = []; save(); sendMoon(); } draw(); };
  $('mcUndo').onclick = () => { if (!S.log.length) return; S.log.pop(); S.pend.push({ at: Date.now() + 60000, v: target() }); save(); draw(); };
  let newArm = 0;
  $('mcNew').onclick = () => { if (Date.now() - newArm > 3000) { newArm = Date.now(); $('mcNew').textContent = 'CLICK AGAIN'; setTimeout(() => $('mcNew').textContent = 'NEW NIGHT', 3000); return; }
    S.log = []; S.walk = {}; S.pend = []; S.shown = 1; S.lines = []; save(); sendMoon(); draw(); };
  $('mcStock').onclick = () => { const p = STOCK.slice().sort(() => Math.random() - 0.5).slice(0, 6); S.lines = p.concat(S.lines).slice(0, 12); save(); drawLines(); };
  $('mcWrite').onclick = async () => {
    const key = (sbGet('keys') || {}).gemini, model = (sbGet('pick') || {}).gemini || 'gemini-2.5-flash';
    if (!key) { $('mcAiSt').textContent = 'No Gemini key: save one in the AI storyboard section'; return; }
    const now = Date.now(), recent = S.log.filter(e => now - e.t < 30 * 60000);
    const facts = recent.map(e => `${hhmm(e.t)} ${S.tables[e.tb]}${e.seat ? ' seat ' + e.seat : ''}: ${KINDS[e.k].label}${e.d ? ' (' + e.d + ')' : ''}`).join('\n') || '(nothing logged in the last 30 minutes)';
    const sys = 'You are DIRRODJ, a robot DJ narrating a playful film-noir whodunnit in a nightclub: someone is stealing the Moon on Cyber MOONday. ' +
      'Two reserved tables play. Dark drinks (neat, dark spirits, Coke, stout) and leaving the table feed the dark side; clear drinks (citrus, salt or sugar rims, Sprite, lime soda) feed the Moon. ' +
      'Grey drinks look clear but count dark, or the other way. From the bartender\'s private log, write 6 short, witty, cryptic observations for a scrolling screen. ' +
      'Strict rules: never name or number a table, a seat, a person or a drink count; never say which table leads; hint at patterns (glass shapes, colours, garnish, timing, empty chairs, photos) so the crowd must look at the real tables. ' +
      'Each line under 70 characters, plain ASCII, capital letters, no emoji, no hashtags. Nothing sexual, no slurs, no mocking looks. ' +
      'Reply as JSON: {"lines":["..."]}.';
    const user = `Time now ${hhmm(now)}. Moon on screen ${Math.round(S.shown * 100)}%.\nLog, last 30 minutes:\n${facts}\nLines already used tonight (do not repeat): ${S.lines.join(' | ') || 'none'}`;
    $('mcAiSt').textContent = 'Writing with ' + model + '…';
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', temperature: 1.0 } }) });
      const j = await r.json(); if (j.error) throw new Error(j.error.message);
      const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(x => x.text || '').join('');
      let lines = []; try { lines = JSON.parse(text).lines || []; } catch { lines = text.split('\n'); }
      lines = lines.map(l => String(l).replace(/^[-*\d.\s"]+|"$/g, '').trim().toUpperCase()).filter(l => l && l.length <= 90).slice(0, 6);
      if (!lines.length) throw new Error('no lines in the reply');
      S.lines = lines.concat(S.lines).slice(0, 12); save(); drawLines();
      $('mcAiSt').textContent = 'Pick one and SEND';
    } catch (e) { $('mcAiSt').textContent = 'AI: ' + e.message; }
  };
  draw(); drawEv(); sendMoon(); setInterval(() => { tick(); if (S.ev) drawEv(); }, 1000);
  setInterval(sendMoon, 5000);
}
