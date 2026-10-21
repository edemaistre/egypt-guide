/* Egypt Field Guide: offline phone app. Vanilla JS, hash routing, no external requests. */
'use strict';
(function () {
  const SHELL_CACHE = 'shell-v1', AUDIO_CACHE = 'audio-v1';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nb = s => esc(s).replace(/(\d) (km|m|h|min|EUR|BC|AD|kg|tonnes|degrees|s)\b/g, '$1 $2');
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('eg.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('eg.' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  };
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 4.2v15.6L20 12z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 4h4.4v16H6zM13.6 4H18v16h-4.4z" fill="currentColor"/></svg>',
    share: '<svg class="share-ic" viewBox="0 0 18 22" aria-hidden="true"><path d="M9 1v13M4.5 5.5 9 1l4.5 4.5M5 9H2v12h14V9h-3" fill="none" stroke="#2F6F8F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  let D = null;
  const SITE = {}, EP = {}, PH = {}, MAPS = {};
  const state = { audioSaved: new Set(), guideOk: false, guideMissing: 0, busy: false, progress: null, homeScroll: 0, route: '' };
  const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);
  const abs = u => new URL(u, document.baseURI).href;
  const mb = b => (b / 1048576).toFixed(b > 10485760 ? 0 : 1);

  // ---------- small helpers ----------
  function glyph(code) { const a = D.alphabet.find(x => x.code === code); return a ? a.g : ''; }
  function fmt(t) { if (!isFinite(t) || t < 0) t = 0; t = Math.floor(t); const m = Math.floor(t / 60), s = t % 60; return m + ':' + String(s).padStart(2, '0'); }
  function mins(e) { return e.dur ? Math.max(1, Math.round(e.dur / 60)) + ' min' : (e.kind === 'long' ? 'about 10 min' : 'about 5 min'); }
  function toast(msg, action) {
    const t = $('#toast'); t.innerHTML = esc(msg) + (action ? ` <button type="button">${esc(action.label)}</button>` : '');
    t.hidden = false; clearTimeout(toast._t);
    if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.fn(); };
    toast._t = setTimeout(() => { t.hidden = true; }, action ? 12000 : 4000);
  }
  function figure(pid, cls) {
    const p = PH[pid]; if (!p) return '';
    return `<figure class="${cls || ''}"><img src="${esc(p.src)}" alt="${esc(p.caption)}" width="${p.w}" height="${p.h}" loading="lazy" decoding="async">` +
      `<figcaption>${esc(p.caption)}<span class="cred">Photo: ${esc(p.credit)}</span></figcaption></figure>`;
  }
  function diagram(mid) {
    const m = MAPS[mid]; if (!m) return '';
    return `<div class="diagram" data-open-map="${esc(mid)}" role="button" tabindex="0" aria-label="${esc(m.title)}, tap to enlarge">` +
      `<div class="svgbox" data-svg="${esc(mid)}" aria-label="${esc(m.alt)}"></div><span class="zoom-hint">Tap to zoom</span></div>`;
  }

  // ---------- dates ----------
  function egyptToday() {
    const q = new URLSearchParams(location.search).get('today');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const g = t => p.find(x => x.type === t).value;
      return `${g('year')}-${g('month')}-${g('day')}`;
    } catch (e) {
      const d = new Date(Date.now() + 3 * 3600e3); return d.toISOString().slice(0, 10);
    }
  }
  function realDay() {
    const [y, m, d] = egyptToday().split('-').map(Number);
    const [y0, m0, d0] = D.trip.start.split('-').map(Number);
    const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y0, m0 - 1, d0)) / 864e5) + 1;
    return { n: Math.min(D.trip.days, Math.max(1, diff)), before: diff < 1, after: diff > D.trip.days, diff };
  }
  function pickedDay() { const p = LS.get('dayPick', null); return p && p.on === egyptToday() ? p.d : null; }

  // ---------- episodes ----------
  function epInner(id, big, withSave) {
    const e = EP[id]; if (!e) return '';
    const coming = !e.available, played = LS.get('played', {})[id], cur = player.cur === id, on = cur && !audio.paused;
    const meta = `${e.kind === 'long' ? 'Story' : 'Short'} &middot; ${mins(e)}${coming ? ' &middot; coming soon' : ''}${played ? ' &middot; <em>played</em>' : ''}${on ? ' &middot; <em>now playing</em>' : ''}`;
    const btn = `<button type="button" class="ep${big ? ' big' : ''}${coming ? ' coming' : ''}${cur ? ' playing' : ''}" data-play="${id}"${coming ? ' aria-disabled="true"' : ''} aria-label="${on ? 'Pause' : 'Play'} ${esc(e.title)}">` +
      `<span class="pb${e.kind === 'long' ? ' long' : ''}">${on ? ICON.pause : ICON.play}</span><span class="tx"><b>${esc(e.title)}</b><span>${meta}</span></span></button>`;
    if (!withSave || coming) return btn;
    const saved = state.audioSaved.has(id);
    const prog = state.progress && state.progress.ep === id ? Math.round(state.progress.frac * 100) + '%' : null;
    const sb = saved ? `<button type="button" class="save done" disabled>Saved</button>`
      : `<button type="button" class="save" data-save="${id}"${state.busy ? ' disabled' : ''}>${prog || 'Save'}<br><small>${mb(e.size)} MB</small></button>`;
    return `<div class="ep-wrap">${btn}${sb}</div>`;
  }
  function epc(id, opts = {}) { return `<div class="epc" data-ep="${id}" data-big="${opts.big ? 1 : 0}" data-sv="${opts.save ? 1 : 0}">${epInner(id, opts.big, opts.save)}</div>`; }
  function paintEps() { $$('.epc').forEach(el => { el.innerHTML = epInner(el.dataset.ep, el.dataset.big === '1', el.dataset.sv === '1'); }); }

  // ---------- offline (Cache Storage, driven from the page) ----------
  function availEps() { return D.episodes.filter(e => e.available); }
  async function scanCaches() {
    if (!('caches' in window)) { paintOffline(); return; }
    try {
      const ac = await caches.open(AUDIO_CACHE);
      const keys = new Set((await ac.keys()).map(r => r.url.split('?')[0]));
      const ah = LS.get('audioH', {});
      state.audioSaved = new Set(availEps().filter(e => keys.has(abs(e.file)) && (!ah[e.id] || ah[e.id] === e.h)).map(e => e.id));
      const sc = await caches.open(SHELL_CACHE);
      const sk = new Set((await sc.keys()).map(r => r.url.split('?')[0]));
      const gh = LS.get('guideH', {});
      const miss = D.guideAssets.filter(a => !(sk.has(abs(a.u)) && gh[a.u] === a.h));
      state.guideMissing = miss.length; state.guideOk = miss.length === 0;
    } catch (e) { /* private mode or blocked */ }
    paintOffline(); paintEps();
  }
  async function persist() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { } }
  function setProg(frac, detail, ep) { state.progress = { frac, detail, ep }; paintOffline(); }

  async function saveGuide() {
    if (state.busy || !('caches' in window)) return;
    state.busy = true; paintOffline(); paintEps();
    const sc = await caches.open(SHELL_CACHE);
    const sk = new Set((await sc.keys()).map(r => r.url.split('?')[0]));
    const gh = LS.get('guideH', {});
    const todo = D.guideAssets.filter(a => !(sk.has(abs(a.u)) && gh[a.u] === a.h));
    const total = todo.reduce((s, a) => s + a.s, 0) || 1; let done = 0, fails = 0, i = 0;
    setProg(0, `Saving the guide: ${mb(total)} MB`);
    async function worker() {
      while (i < todo.length) {
        const a = todo[i++];
        try {
          const r = await fetch(a.u + '?fresh=' + a.h, { cache: 'no-store' });
          if (!r.ok) throw new Error(r.status);
          await sc.put(a.u, r); gh[a.u] = a.h;
        } catch (e) { fails++; }
        done += a.s; setProg(done / total, `Saving the guide: ${mb(done)} of ${mb(total)} MB`);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    try { const r = await fetch('./?fresh=1', { cache: 'no-store' }); if (r.ok) await sc.put('./', r); } catch (e) { }
    LS.set('guideH', gh); await persist();
    state.busy = false; state.progress = null;
    await scanCaches();
    toast(fails ? `${fails} file(s) did not download. Check the connection and tap again.` : 'Guide saved on this phone.');
  }

  async function fetchEpisode(e, onProg) {
    const r = await fetch(e.file + '?dl=1', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = e.size || +r.headers.get('content-length') || 0;
    let blob;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader(), chunks = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length; onProg(got, total); }
      blob = new Blob(chunks, { type: 'audio/mpeg' });
    } else blob = await r.blob();
    if (e.size && blob.size !== e.size) throw new Error('incomplete');
    const ac = await caches.open(AUDIO_CACHE);
    await ac.put(e.file, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' } }));
    const ah = LS.get('audioH', {}); ah[e.id] = e.h; LS.set('audioH', ah);
    state.audioSaved.add(e.id);
  }
  async function saveAudio(ids) {
    if (state.busy || !('caches' in window)) return;
    const list = ids.map(id => EP[id]).filter(e => e && e.available && !state.audioSaved.has(e.id));
    if (!list.length) { toast('All audio is already saved.'); return; }
    state.busy = true; paintEps();
    const total = list.reduce((s, e) => s + e.size, 0) || 1; let base = 0, fails = 0;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      try {
        await fetchEpisode(e, (got, t) => setProg((base + got) / total, `Episode ${k + 1} of ${list.length}: ${e.title}, ${Math.round(100 * got / (t || 1))}%`, e.id));
        paintEps();
      } catch (err) { fails++; }
      base += e.size; setProg(base / total, `Saved ${k + 1} of ${list.length}`, null);
    }
    await persist();
    state.busy = false; state.progress = null; paintEps(); await scanCaches();
    if (player.cur && state.audioSaved.has(player.cur) && audio.paused) { /* switch the paused episode to the cached copy */ const t = audio.currentTime; audio.src = srcFor(EP[player.cur]); player.pendingSeek = t; }
    toast(fails ? `${fails} episode(s) did not download. Tap again on Wi-Fi.` : (list.length > 1 ? 'All audio saved on this phone.' : 'Episode saved.'));
  }

  function offlineCard(mode) { return `<section class="card offline" data-offline="${mode}"></section>`; }
  function paintOffline() {
    $$('[data-offline]').forEach(el => {
      const mode = el.dataset.offline, av = availEps();
      const audioLeft = av.filter(e => !state.audioSaved.has(e.id));
      const audioMB = mb(audioLeft.reduce((s, e) => s + e.size, 0));
      const allMB = mb(av.reduce((s, e) => s + e.size, 0));
      const guideMB = mb(D.guideAssets.reduce((s, a) => s + a.s, 0));
      const ready = state.guideOk && audioLeft.length === 0;
      let status;
      if (!('caches' in window)) status = 'This browser cannot save the guide for offline use. Open it in Safari.';
      else if (ready) status = 'Ready offline';
      else if (state.guideOk) status = `Guide saved. Audio: ${av.length - audioLeft.length} of ${av.length} episodes saved.`;
      else status = `Not saved yet. Audio: ${av.length - audioLeft.length} of ${av.length} episodes saved.`;
      const p = state.progress;
      const warn = isIOS && !isStandalone() ? `<p class="warn">Add the app to your Home Screen first, then save from inside the app. iPhone keeps the Home Screen app's storage separate from Safari.</p>` : '';
      const coming = D.episodes.length - av.length;
      el.innerHTML = `<div class="card-h">Download for offline</div>${mode === 'full' ? warn : ''}
        <p class="status${ready ? ' ok' : ''}">${ready ? '&#10003; ' : ''}${esc(status)}</p>
        <div class="bar"><i style="width:${p ? Math.round(p.frac * 100) : (ready ? 100 : 0)}%"></i></div>
        <p class="detail">${p ? esc(p.detail) : esc(`Do this once on hotel Wi-Fi. Guide ${guideMB} MB, all audio ${allMB} MB.`)}${coming && !p ? esc(` ${coming} episode(s) still coming.`) : ''}</p>
        <div class="btn-row">
          ${mode === 'full' ? `<button type="button" class="btn" data-act="save-guide"${state.busy || state.guideOk ? ' disabled' : ''}>${state.guideOk ? 'Guide saved' : 'Save the guide'} <small>${state.guideOk ? '' : guideMB + ' MB'}</small></button>` : ''}
          <button type="button" class="btn alt" data-act="save-audio"${state.busy || !audioLeft.length ? ' disabled' : ''}>${audioLeft.length ? 'Save all audio' : 'Audio saved'} <small>${audioLeft.length ? audioMB + ' MB' : ''}</small></button>
        </div>`;
    });
  }

  // ---------- views ----------
  function siteLink(sid) {
    const s = SITE[sid]; if (!s) return '';
    const p = s.hero && PH[s.hero];
    return `<a class="site-link" href="#/site/${sid}">${p ? `<img src="${esc(p.src)}" alt="" loading="lazy">` : '<span class="ph"></span>'}<span><b>${esc(s.name)}</b><span>${esc(s.kicker)}</span></span><span class="chev" aria-hidden="true">&#8250;</span></a>`;
  }
  function questTotals() {
    const q = LS.get('quests', {}); let found = 0, total = 0;
    D.sites.forEach(s => { total += s.quests.length; (q[s.id] || []).forEach((v, i) => { if (v && i < s.quests.length) found++; }); });
    return { found, total };
  }
  function tile(href, code, title, sub, attrs) {
    return `<a class="tile" href="${href}"${attrs || ''}><span class="hg" aria-hidden="true">${glyph(code)}</span><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</a>`;
  }

  function vHome() {
    const rd = realDay(), pk = pickedDay(), n = pk || rd.n, day = D.days[n - 1];
    const install = isStandalone() ? '' : `<section class="card install-card"><div class="card-h">Put it on your iPhone</div><p>Add the guide to your Home Screen in Safari, then save it for offline use. Three taps.</p><a class="btn" href="#/install">Show me how</a></section>`;
    let pre = '';
    if (rd.before) { const k = -rd.diff + 1; pre = `<p class="pre">Day 1 starts Wed 21 Oct. ${k === 1 ? 'Tomorrow.' : k + ' days to go.'}</p>`; }
    else if (rd.after) pre = `<p class="pre">The trip is over. Day 11 is shown.</p>`;
    const label = pk && pk !== rd.n ? `Viewing Day ${n}` : (rd.before || rd.after ? `Day ${n}` : `Today &middot; Day ${n}`);
    const picker = D.days.map(d => `<button type="button" class="${d.n === n ? 'on' : ''}${d.n === rd.n && !rd.before && !rd.after ? ' real' : ''}" data-pick="${d.n}" aria-label="Day ${d.n}">${d.n}</button>`).join('');
    const sites = day.sites.length ? `<div class="sub-h">Sites</div><div class="site-links">${day.sites.map(siteLink).join('')}</div>`
      : (day.read.length ? `<div class="sub-h">Read for today</div><div class="site-links">${day.read.map(siteLink).join('')}</div>` : '');
    const best = day.best.length ? `<div class="sub-h">${esc(day.bestLabel)}</div><div class="eps">${day.best.map(id => epc(id, { big: true })).join('')}</div>` : '';
    const last = n === 11 ? `<div class="sub-h">Day 11</div><a class="site-link" href="#/day/11"><span class="ph"></span><span><b>${esc(D.lastday.title)}</b><span>Checklist and questions for the flight</span></span><span class="chev">&#8250;</span></a>` : '';
    const qt = questTotals();
    const days = D.days.map(d => `<a class="day-row${d.n === rd.n && !rd.before && !rd.after ? ' now' : ''}" href="#/day/${d.n}"><span class="d">Day ${d.n}</span><span class="t"><b>${esc(d.date)}</b>${nb(d.plan)}</span></a>`).join('');
    return `<div class="hero-title"><h1>Egypt</h1><p>Family field guide &middot; 21 to 31 October 2026</p></div>
      ${install}
      <section class="today"><span class="kicker">${label} &middot; ${esc(day.date)}</span>${pre}
        <h2>${n === 11 ? esc(D.lastday.title) : 'Day ' + n}</h2><p class="plan">${nb(day.plan)}</p>
        <div class="picker" role="group" aria-label="Pick a day">${picker}</div>
        ${pk && pk !== rd.n && !rd.before && !rd.after ? `<p><button type="button" class="btn ghost" data-pick="0">Back to today</button></p>` : ''}
        ${best}${sites}${last}
        <p style="margin:14px 0 0"><a class="btn ghost" href="#/day/${n}">Open Day ${n}: maps and all audio</a></p>
      </section>
      <div style="height:14px"></div>
      ${offlineCard('full')}
      <a class="card quest-count" href="#/quests" style="text-decoration:none;color:inherit"><span class="n">${qt.found}/${qt.total}</span><span><b>Look closer</b><br><span class="small">quests found so far. Tick them on each site page.</span></span></a>
      <h2 class="sec-h">All 11 days</h2><div class="days">${days}</div>
      <h2 class="sec-h">The guide</h2>
      <div class="tiles">
        ${tile('#/listen', 'D21', 'Listen', D.series.title)}
        ${tile('#/gods', 'G1', 'Who is who', 'Nine gods to know')}
        ${tile('#/reading', 'G17', 'Reading a wall', 'Six rules')}
        ${tile('#/name', 'M17', 'Your name in hieroglyphs', 'Type it, see it')}
        ${tile('#/kit', 'V31', 'Field kit', 'Sun, water, money')}
        ${tile('#/timeline', 'N35', '3,000 years', 'Who built what')}
        ${tile('#/credits', 'S29', 'Credits', 'Photos and maps')}
        ${tile('#/install', 'Q3', 'Install help', 'Home Screen')}
      </div>
      <h2 class="sec-h">The route</h2>${diagram('map-egypt-route')}
      ${D.pdf ? `<section class="card"><div class="card-h">PDF version, same content</div><p class="small">About ${mb((D.guideAssets.find(a => a.u === D.pdf) || { s: 0 }).s)} MB. It opens in Safari: tap Share, then Save to Files, to keep a copy on the phone.</p><a class="btn ghost" href="${esc(D.pdf)}" target="_blank" rel="noopener">Open the PDF</a></section>` : ''}
      <p class="foot">Version ${esc(D.version)} &middot; built ${esc(D.built)}</p>`;
  }

  function vDay(n) {
    const day = D.days[n - 1]; if (!day) return vNotFound();
    const op = day.region && D.openers[day.region];
    const opener = op ? `<section class="card"><span class="kicker">${esc(op.kicker)}</span><div class="card-h" style="margin-top:4px">${esc(op.title)}</div><p>${nb(op.lead)}</p>${op.rows.map(r => `<div class="item"><b>${esc(r[0])}.</b> ${nb(r[1])}</div>`).join('')}</section>` : '';
    const sites = day.sites.length ? `<h2 class="sec-h">Sites</h2><div class="site-links">${day.sites.map(siteLink).join('')}</div>`
      : (day.read.length ? `<h2 class="sec-h">Read for today</h2><div class="site-links">${day.read.map(siteLink).join('')}</div>` : '');
    const eps = day.episodes.length ? `<h2 class="sec-h">Listen</h2><div class="eps">${day.episodes.map(id => epc(id, { big: true, save: true })).join('')}</div>`
      : (day.best.length ? `<h2 class="sec-h">${esc(day.bestLabel)}</h2><div class="eps">${day.best.map(id => epc(id, { big: true, save: true })).join('')}</div>` : '');
    const maps = day.maps.length ? `<h2 class="sec-h">Maps</h2>${day.maps.map(diagram).join('')}` : '';
    const last = n === 11 ? `<h2 class="sec-h">${esc(D.lastday.title)}</h2>` + D.lastday.cards.map(c => `<section class="card"><div class="card-h">${esc(c.title)}</div>${c.items ? '<ul>' + c.items.map(i => `<li>${nb(i)}</li>`).join('') + '</ul>' : `<p>${nb(c.text)}</p>`}</section>`).join('') : '';
    const nav = `<div class="btn-row" style="margin-top:20px">${n > 1 ? `<a class="btn ghost" href="#/day/${n - 1}">&#8249; Day ${n - 1}</a>` : ''}${n < 11 ? `<a class="btn ghost" href="#/day/${n + 1}">Day ${n + 1} &#8250;</a>` : ''}</div>`;
    return `<div class="site-head"><span class="kicker">${esc(day.date)}</span><h1>Day ${n}</h1><p class="hook">${nb(day.plan)}</p></div>${opener}${last}${sites}${eps}${maps}${nav}`;
  }

  function acc(key, title, body, open, extra) {
    return `<details class="acc" data-acc="${key}"${open ? ' open' : ''}><summary>${esc(title)}${extra ? ` <small>${extra}</small>` : ''}</summary><div class="acc-b">${body}</div></details>`;
  }
  function vSite(sid) {
    const s = SITE[sid]; if (!s) return vNotFound();
    const q = (LS.get('quests', {})[sid]) || [];
    const found = s.quests.filter((_, i) => q[i]).length;
    const facts = s.facts.map(f => `<div class="chip"><span>${esc(f[0])}</span><b>${nb(f[1])}</b></div>`).join('');
    const audioH = s.audio.length ? `<div class="eps" style="margin-bottom:14px">${s.audio.map(id => epc(id, { big: true, save: true })).join('')}</div>` : '';
    const ul = a => '<ul>' + a.map(x => `<li>${nb(x)}</li>`).join('') + '</ul>';
    const quests = s.quests.map((k, i) => `<label class="quest${q[i] ? ' done' : ''}"><input type="checkbox" data-quest="${sid}:${i}"${q[i] ? ' checked' : ''}><span><span class="qk">${esc(k[0])}</span><span class="qt">${nb(k[1])}</span></span></label>`).join('');
    const photos = s.photos.length ? `<h2 class="sec-h">More photos</h2><div class="photos">${s.photos.map(p => figure(p)).join('')}</div>` : '';
    const dg = s.diagrams.map(diagram).join('');
    const day = D.days[s.day - 1];
    return `<div class="site-head"><span class="kicker">${nb(s.kicker)}</span><h1>${esc(s.name)}</h1><p class="hook">${nb(s.hook)}</p></div>
      ${s.hero ? figure(s.hero, 'hero') : ''}
      <div class="chips">${facts}</div>${audioH}
      ${acc('story', 'The story', `<p class="story-t">${esc(s.story.title || '')}</p><p>${nb(s.story.text || '')}</p>`, true)}
      ${acc('walk', 'Walk it', `${dg}<ol class="steps">${s.steps.map(x => `<li>${nb(x)}</li>`).join('')}</ol>`, !!dg, s.steps.length + ' stops')}
      ${acc('miss', "Don't miss", s.dont_miss.map(x => `<div class="item"><b>${esc(x.t)}.</b> ${nb(x.d)}</div>`).join(''), true)}
      ${acc('easy', 'Easy to miss', ul(s.easy), false)}
      ${acc('ask', 'Ask the guide', ul(s.ask), true)}
      ${acc('quests', 'Look closer', quests, false, `<span data-qcount="${sid}">${found} of ${s.quests.length} found</span>`)}
      ${acc('tips', 'Tips', ul(s.tips), false)}
      ${photos}
      <div class="btn-row" style="margin-top:20px">${day ? `<a class="btn ghost" href="#/day/${s.day}">Day ${s.day}: ${esc(day.date)}</a>` : ''}</div>`;
  }

  function vListen() {
    const byDay = {};
    D.episodes.forEach(e => (byDay[e.day] = byDay[e.day] || []).push(e.id));
    const groups = Object.keys(byDay).map(Number).sort((a, b) => a - b).map(d => `<div class="sub-h">Day ${d} &middot; ${esc(D.days[d - 1].date)}</div><div class="eps">${byDay[d].map(id => epc(id, { save: true })).join('')}</div>`).join('');
    const sh = D.episodes.filter(e => e.kind === 'short').length, lg = D.episodes.length - sh;
    return `<div class="site-head"><span class="kicker">Audio series</span><h1>${esc(D.series.title)}</h1><p class="hook">${esc(D.series.tagline)}. ${sh} short episodes and ${lg} longer stories. After one episode ends, the next one for the same day starts.</p></div>
      ${offlineCard('audio')}${groups}`;
  }

  function vGods() {
    const tiles = D.gods.map(g => `<div class="god">${g.photo && PH[g.photo] ? `<img src="${esc(PH[g.photo].src)}" alt="${esc(PH[g.photo].caption)}" loading="lazy">` : '<div class="noimg"></div>'}
      <div class="gb"><h3>${esc(g.name)}</h3><p class="spot">${esc(g.spot)}</p><p class="dom">${esc(g.dom)}</p><p class="wh">Meet: ${esc(g.where)}</p></div>
      ${g.photo && PH[g.photo] ? `<div class="gcred">Photo: ${esc(PH[g.photo].credit)}</div>` : ''}</div>`).join('');
    return `<div class="site-head"><span class="kicker">Gods</span><h1>Who is who</h1><p class="hook">${esc(D.godsLede)}</p></div><div class="gods">${tiles}</div><p class="small" style="margin-top:14px">${esc(D.godsNote)}</p>`;
  }
  function vReading() {
    const r = D.reading;
    return `<div class="site-head"><span class="kicker">Hieroglyphs</span><h1>Reading a wall</h1></div>
      <div class="rules">${r.rules.map((x, i) => `<div class="rule"><b>${i + 1}. ${esc(x[0])}</b> ${nb(x[1])}</div>`).join('')}</div>
      <section class="card"><div class="card-h">${esc(r.card.title)}</div><p>${nb(r.card.text)}</p></section>
      ${r.photos.map(p => figure(p)).join('')}
      <p><a class="btn ghost" href="#/name">Write your name in hieroglyphs</a></p>`;
  }
  function transliterate(name) {
    const s = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '');
    const out = [], keys = [];
    for (let i = 0; i < s.length;) {
      if (s[i] === ' ') { i++; continue; }
      const two = s.substr(i, 2);
      if (D.nameMap[two] && two.length === 2) { out.push(D.nameMap[two]); keys.push(two); i += 2; continue; }
      if (i > 0 && s[i] === s[i - 1]) { i++; continue; } // double letters once
      if (D.nameMap[s[i]]) { out.push(D.nameMap[s[i]]); keys.push(s[i]); }
      i++;
    }
    return { glyphs: out.join(''), keys };
  }
  function vName() {
    const al = D.alphabet.map(a => `<div class="al"><span class="hg">${a.g}</span><b>${esc(a.tr)}</b><i>${esc(a.name)}</i><small>${esc(a.sound)}</small></div>`).join('');
    const last = LS.get('nameTry', '');
    return `<div class="site-head"><span class="kicker">Hieroglyphs</span><h1>Your name in hieroglyphs</h1><p class="hook">${esc(D.nameLede)}</p></div>
      <section class="card namebox"><label class="card-h" for="name-in">Try it</label>
        <input id="name-in" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="24" placeholder="Type a name" value="${esc(last)}">
        <div class="cartouche empty" id="name-out">Your cartouche appears here</div><p class="name-key" id="name-key"></p></section>
      <div class="alpha">${al}</div>
      <section class="card"><div class="card-h">Tricks</div><ul>${D.nameTricks.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
  }
  function paintName() {
    const inp = $('#name-in'); if (!inp) return;
    const r = transliterate(inp.value), out = $('#name-out');
    LS.set('nameTry', inp.value);
    if (r.glyphs) { out.className = 'cartouche'; out.innerHTML = Array.from(r.glyphs).map(g => `<span>${g}</span>`).join(''); $('#name-key').textContent = 'Sounds: ' + r.keys.join(' + '); }
    else { out.className = 'cartouche empty'; out.textContent = 'Your cartouche appears here'; $('#name-key').textContent = ''; }
  }
  function vKit() {
    return `<div class="site-head"><span class="kicker">Practical</span><h1>Field kit</h1></div>` +
      D.kit.map(c => `<section class="card"><div class="card-h">${esc(c.title)}</div><ul>${c.items.map(i => `<li>${nb(i)}</li>`).join('')}</ul></section>`).join('');
  }
  function vTimeline() {
    return `<div class="site-head"><span class="kicker">History</span><h1>Three thousand years in one line</h1></div>${diagram('dia-timeline')}
      <section class="card"><table class="when"><tr><th>Period</th><th>You will see</th></tr>${D.timeline.map(r => `<tr><td>${esc(r[0])}${r[1] ? `<i>${esc(r[1])}</i>` : ''}</td><td>${esc(r[2])}</td></tr>`).join('')}</table></section>`;
  }
  function vQuests() {
    const q = LS.get('quests', {}), t = questTotals();
    const rows = D.sites.filter(s => s.quests.length).map(s => {
      const f = s.quests.filter((_, i) => (q[s.id] || [])[i]).length;
      return `<a class="day-row" href="#/site/${s.id}"><span class="d">${f}/${s.quests.length}</span><span class="t"><b>Day ${s.day}</b>${esc(s.name)}</span></a>`;
    }).join('');
    return `<div class="site-head"><span class="kicker">Look closer</span><h1>${t.found} of ${t.total} found</h1><p class="hook">Each site has small missions. Tick them on the site page when you have done them.</p></div><div class="days">${rows}</div>`;
  }
  function vCredits() {
    const used = Object.keys(PH).sort();
    const rows = used.map(id => { const p = PH[id]; return `<div class="credit-row"><b>${esc(p.caption)}</b>${esc(p.author)}, ${p.license_url ? `<a href="${esc(p.license_url)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license)}. <a href="${esc(p.commons_url)}" target="_blank" rel="noopener">Wikimedia Commons: ${esc(p.title)}</a></div>`; }).join('');
    return `<div class="site-head"><span class="kicker">Credits</span><h1>Photo and map credits</h1><p>${esc(D.credits.intro)}</p><p class="small">Audio: the series ${esc(D.series.title)}, read by Brian. ${used.length} photographs are used in this app.</p></div><section class="card">${rows}</section>`;
  }
  function vInstall() {
    const inst = isStandalone();
    const other = isOtherIOSBrowser ? `<p class="warn">You are in another browser. Copy the link and open it in Safari: only Safari can add it to the Home Screen.</p>` : '';
    return `<div class="site-head"><span class="kicker">Install</span><h1>Put it on your iPhone in 3 taps</h1>
      ${inst ? '<p class="warn" style="background:#e8f0e4">Installed. You are using the Home Screen app.</p>' : `<p class="hook">Open this page in <b>Safari</b>, then:</p>`}</div>${other}
      <ol class="steps3">
        <li><b>Tap Share</b> ${ICON.share}. On iOS 26, tap <span class="kbd">&middot;&middot;&middot;</span> at the bottom right first, then Share. On older iOS, Share is in the bar at the bottom.</li>
        <li><b>Tap Add to Home Screen.</b> Scroll down the list if you do not see it (on iOS 26 it can sit under <span class="kbd">View More</span>).</li>
        <li><b>Tap Add.</b> Leave "Open as Web App" switched on if you see it.</li>
      </ol>
      <section class="card"><div class="card-h">In plain words</div>
        <p><b>iPhone 16:</b> Safari, tap &middot;&middot;&middot; at the bottom right, Share, Add to Home Screen, Add.</p>
        <p><b>iPhone 14:</b> Safari, tap Share (square with an up arrow; on iOS 26 it is behind &middot;&middot;&middot;), Add to Home Screen, Add.</p></section>
      <section class="card"><div class="card-h">Then save it for offline</div>
        <p>Open <b>Egypt</b> from your Home Screen. On hotel Wi-Fi, tap <b>Save the guide</b> and <b>Save all audio</b> on the home page. Wait for "Ready offline".</p>
        <p class="small">The Home Screen app keeps its own storage, separate from Safari, so save from inside the app.</p></section>
      <section class="card"><div class="card-h">The link</div><div class="copyline"><code>${esc(D.appUrl)}</code><button type="button" class="btn ghost" data-act="copy-link">Copy</button></div></section>`;
  }
  function vNotFound() { return `<h1>Not found</h1><p><a href="#/">Back to the start</a></p>`; }

  // ---------- router ----------
  function route() {
    const h = location.hash || '#/';
    const m = h.match(/^#ep=([\w-]+)/);
    if (m) {
      const id = m[1], e = EP[id];
      history.replaceState(null, '', location.pathname + location.search + (e && SITE[e.site] ? '#/site/' + e.site : '#/'));
      render();
      if (e) { loadEp(id, false); openSheet(); }
      return;
    }
    render();
  }
  function render() {
    const h = location.hash || '#/';
    const parts = h.replace(/^#\/?/, '').split('/');
    const prev = state.route;
    if (prev === '' || prev === 'home') state.homeScroll = window.scrollY;
    let html, key = parts[0] || 'home';
    switch (key) {
      case 'home': html = vHome(); break;
      case 'day': html = vDay(+parts[1]); break;
      case 'site': html = vSite(parts[1]); break;
      case 'listen': html = vListen(); break;
      case 'gods': html = vGods(); break;
      case 'reading': html = vReading(); break;
      case 'name': html = vName(); break;
      case 'kit': html = vKit(); break;
      case 'timeline': html = vTimeline(); break;
      case 'quests': html = vQuests(); break;
      case 'credits': html = vCredits(); break;
      case 'install': html = vInstall(); break;
      default: html = vNotFound();
    }
    state.route = key + (parts[1] ? '/' + parts[1] : '');
    $('#view').innerHTML = html;
    $('#backbtn').hidden = key === 'home';
    document.title = key === 'home' ? 'Egypt' : 'Egypt';
    paintOffline(); loadSvgs(); paintName();
    if (key === 'home' && prev !== 'home') window.scrollTo(0, state.homeScroll || 0);
    else if (state.route !== prev) window.scrollTo(0, 0);
  }

  // ---------- svg ----------
  const svgText = new Map();
  async function getSvg(mid) {
    if (svgText.has(mid)) return svgText.get(mid);
    const r = await fetch(MAPS[mid].src); if (!r.ok) throw new Error('svg ' + r.status);
    const t = await r.text(); svgText.set(mid, t); return t;
  }
  function loadSvgs() {
    $$('.svgbox[data-svg]').forEach(async el => {
      try { el.innerHTML = await getSvg(el.dataset.svg); } catch (e) { el.innerHTML = '<p class="small">Map not saved yet. Connect once and tap Save the guide.</p>'; }
    });
  }

  // ---------- map viewer with pinch zoom ----------
  const viewer = { z: 1 };
  async function openViewer(mid) {
    const m = MAPS[mid]; if (!m) return;
    $('#viewer-title').textContent = m.title;
    try { $('#viewer-inner').innerHTML = await getSvg(mid); } catch (e) { return; }
    $('#viewer').hidden = false; document.body.style.overflow = 'hidden'; setZoom(1);
  }
  function closeViewer() { $('#viewer').hidden = true; document.body.style.overflow = ''; $('#viewer-inner').innerHTML = ''; }
  function setZoom(z, cx, cy) {
    const sc = $('#viewer-scroll'), inner = $('#viewer-inner');
    z = Math.max(1, Math.min(6, z));
    const rect = sc.getBoundingClientRect();
    if (cx == null) { cx = rect.width / 2; cy = rect.height / 2; }
    const fx = (sc.scrollLeft + cx) / (inner.offsetWidth || 1), fy = (sc.scrollTop + cy) / (inner.offsetHeight || 1);
    viewer.z = z; inner.style.width = (z * 100) + '%';
    sc.scrollLeft = fx * inner.offsetWidth - cx; sc.scrollTop = fy * inner.offsetHeight - cy;
  }
  function initViewer() {
    const sc = $('#viewer-scroll'); let pinch = null, lastTap = 0;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    sc.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const r = sc.getBoundingClientRect();
        pinch = { d: dist(e.touches), z: viewer.z, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300) { const r = sc.getBoundingClientRect(); setZoom(viewer.z > 1.5 ? 1 : 2.5, e.touches[0].clientX - r.left, e.touches[0].clientY - r.top); e.preventDefault(); }
        lastTap = now;
      }
    }, { passive: false });
    sc.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.z * dist(e.touches) / pinch.d, pinch.cx, pinch.cy); } }, { passive: false });
    sc.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
    ['gesturestart', 'gesturechange'].forEach(ev => $('#viewer').addEventListener(ev, e => e.preventDefault()));
    $('#zoom-in').onclick = () => setZoom(viewer.z * 1.5);
    $('#zoom-out').onclick = () => setZoom(viewer.z / 1.5);
    $('#zoom-reset').onclick = () => setZoom(1);
    $('#viewer-close').onclick = closeViewer;
  }

  // ---------- player ----------
  const audio = new Audio();
  audio.preload = 'metadata';
  const player = { cur: null, pendingSeek: null, lastSave: 0, lastPos: 0 };
  const SPEEDS = [0.8, 1, 1.25, 1.5];
  const rate = () => LS.get('rate', 1);
  function srcFor(e) { return state.audioSaved.has(e.id) ? e.file : e.file + '?net=1'; }
  function queueFor(id) { const e = EP[id]; return D.days[e.day - 1].episodes.filter(x => EP[x] && EP[x].available); }
  function loadEp(id, autoplay) {
    const e = EP[id]; if (!e || !e.available) { if (e) toast('This episode is coming soon.'); return; }
    if (player.cur !== id) {
      savePos();
      player.cur = id; audio.src = srcFor(e);
      const pos = LS.get('pos', {})[id] || 0;
      player.pendingSeek = pos > 5 && (!e.dur || pos < e.dur - 10) ? pos : null;
      audio.defaultPlaybackRate = rate(); audio.playbackRate = rate();
      LS.set('last', id);
      setMeta(e);
    }
    if (autoplay) play();
    $('#mini').hidden = false; document.body.classList.add('has-mini');
    paintPlayer(); paintEps();
  }
  function play() {
    if (player.cur && state.audioSaved.has(player.cur) && audio.src.indexOf('net=1') >= 0) { /* now saved: switch to the cached copy */
      const t = audio.currentTime; audio.src = srcFor(EP[player.cur]); if (t > 1) player.pendingSeek = t;
    }
    if (!navigator.onLine && player.cur && !state.audioSaved.has(player.cur)) { showNote('This episode is not saved on this phone. Connect to Wi-Fi and tap Save, or pick a saved episode.'); }
    const p = audio.play(); if (p && p.catch) p.catch(() => { /* needs a tap on iOS, the button is there */ });
  }
  function toggle(id) {
    if (id && id !== player.cur) { loadEp(id, true); return; }
    if (!player.cur) return;
    if (audio.paused) play(); else audio.pause();
  }
  function savePos() {
    if (!player.cur || !isFinite(audio.currentTime)) return;
    const pos = LS.get('pos', {}); pos[player.cur] = Math.floor(audio.currentTime); LS.set('pos', pos);
  }
  function markPlayed(id) { const p = LS.get('played', {}); if (!p[id]) { p[id] = 1; LS.set('played', p); paintEps(); } }
  function showNote(t) { const n = $('#pl-note'); if (t) { n.textContent = t; n.hidden = false; } else n.hidden = true; }
  function setMeta(e) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: e.title, artist: 'Brian', album: D.series.title,
        artwork: [{ src: abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }, { src: abs('icons/icon-192.png'), sizes: '192x192', type: 'image/png' }]
      });
    } catch (err) { }
  }
  function initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { } };
    set('play', () => play()); set('pause', () => audio.pause());
    set('seekbackward', d => { audio.currentTime = Math.max(0, audio.currentTime - ((d && d.seekOffset) || 15)); });
    set('seekforward', d => { audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + ((d && d.seekOffset) || 30)); });
    set('seekto', d => { if (d && d.seekTime != null) audio.currentTime = d.seekTime; });
    set('previoustrack', () => { if (audio.currentTime > 5) { audio.currentTime = 0; return; } const q = queueFor(player.cur), i = q.indexOf(player.cur); if (i > 0) loadEp(q[i - 1], true); });
    set('nexttrack', () => { const q = queueFor(player.cur), i = q.indexOf(player.cur); if (i >= 0 && i < q.length - 1) loadEp(q[i + 1], true); });
  }
  function paintPlayer() {
    const e = EP[player.cur]; if (!e) return;
    const on = !audio.paused, dur = audio.duration && isFinite(audio.duration) ? audio.duration : (e.dur || 0), t = audio.currentTime || player.pendingSeek || 0;
    $('#mini-title').textContent = e.title;
    $('#mini-sub').textContent = `Day ${e.day} · ${fmt(t)} / ${fmt(dur)}`;
    $('#mini-play').innerHTML = on ? ICON.pause : ICON.play; $('#mini-play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    $('#mini-prog').style.width = (dur ? 100 * t / dur : 0) + '%';
    if ($('#sheet').hidden) return;
    $('#pl-title').textContent = e.title;
    $('#pl-blurb').textContent = e.blurb;
    $('#pl-play').innerHTML = on ? ICON.pause : ICON.play; $('#pl-play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (!player.seeking) $('#pl-seek').value = dur ? Math.round(1000 * t / dur) : 0;
    $('#pl-cur').textContent = fmt(t); $('#pl-dur').textContent = fmt(dur);
    $$('#pl-speed button').forEach(b => b.classList.toggle('on', +b.dataset.rate === rate()));
  }
  function paintQueue() {
    const e = EP[player.cur]; if (!e) return;
    const q = D.days[e.day - 1].episodes;
    $('#pl-qh').textContent = `Day ${e.day} episodes`;
    $('#pl-queue').innerHTML = q.map(id => epc(id, { save: true })).join('');
  }
  function openSheet() { if (!player.cur) return; $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; paintQueue(); paintPlayer(); }
  function closeSheet() { $('#sheet').hidden = true; document.body.style.overflow = ''; }
  function initPlayer() {
    $('#pl-speed').innerHTML = SPEEDS.map(s => `<button type="button" data-rate="${s}">${s}×</button>`).join('');
    $('#mini-play').innerHTML = ICON.play; $('#pl-play').innerHTML = ICON.play;
    $('#mini-play').onclick = () => toggle();
    $('#mini-open').onclick = openSheet;
    $('#pl-close').onclick = closeSheet;
    $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
    $('#pl-play').onclick = () => toggle();
    $('#pl-back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); paintPlayer(); };
    $('#pl-fwd').onclick = () => { audio.currentTime = Math.min((audio.duration || 1e9) - 0.5, audio.currentTime + 30); paintPlayer(); };
    $('#pl-speed').addEventListener('click', e => { const b = e.target.closest('[data-rate]'); if (!b) return; LS.set('rate', +b.dataset.rate); audio.playbackRate = +b.dataset.rate; audio.defaultPlaybackRate = +b.dataset.rate; paintPlayer(); });
    const seek = $('#pl-seek');
    seek.addEventListener('input', () => { player.seeking = true; const d = audio.duration || EP[player.cur].dur || 0; $('#pl-cur').textContent = fmt(d * seek.value / 1000); });
    seek.addEventListener('change', () => { const d = audio.duration || 0; if (d) audio.currentTime = d * seek.value / 1000; player.seeking = false; paintPlayer(); });
    const applySeek = () => { if (player.pendingSeek != null && audio.readyState >= 1) { try { audio.currentTime = player.pendingSeek; player.pendingSeek = null; } catch (e) { } } };
    audio.addEventListener('loadedmetadata', () => { applySeek(); audio.playbackRate = rate(); paintPlayer(); });
    audio.addEventListener('canplay', applySeek);
    audio.addEventListener('play', () => { showNote(null); paintPlayer(); paintEps(); });
    audio.addEventListener('pause', () => { savePos(); paintPlayer(); paintEps(); });
    audio.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - player.lastSave > 4000) { player.lastSave = now; savePos(); }
      if (audio.duration && audio.currentTime / audio.duration > 0.95) markPlayed(player.cur);
      paintPlayer();
      if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration && now - player.lastPos > 5000) {
        player.lastPos = now; try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }); } catch (e) { }
      }
    });
    audio.addEventListener('ended', () => {
      const id = player.cur; markPlayed(id);
      const pos = LS.get('pos', {}); pos[id] = 0; LS.set('pos', pos);
      const q = queueFor(id), i = q.indexOf(id);
      if (i >= 0 && i < q.length - 1) { loadEp(q[i + 1], true); if (!$('#sheet').hidden) paintQueue(); }
      else paintPlayer();
    });
    audio.addEventListener('error', () => {
      if (!player.cur) return;
      showNote(state.audioSaved.has(player.cur) ? 'This episode could not be played. Try again.' : 'This episode is not saved on this phone and there is no connection. Save it on Wi-Fi.');
      paintPlayer();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePos(); });
    initMediaSession();
    const last = LS.get('last', null);
    if (last && EP[last] && EP[last].available) { player.cur = null; loadEp(last, false); }
  }

  // ---------- events ----------
  function initEvents() {
    document.addEventListener('click', e => {
      const t = e.target;
      const pl = t.closest('[data-play]');
      if (pl) { e.preventDefault(); if (pl.getAttribute('aria-disabled') === 'true') { toast('This episode is coming soon.'); return; } toggle(pl.dataset.play); return; }
      const sv = t.closest('[data-save]'); if (sv) { e.preventDefault(); saveAudio([sv.dataset.save]); return; }
      const mp = t.closest('[data-open-map]'); if (mp) { openViewer(mp.dataset.openMap); return; }
      const pk = t.closest('[data-pick]');
      if (pk) { const d = +pk.dataset.pick; LS.set('dayPick', d ? { d, on: egyptToday() } : null); const y = window.scrollY; render(); window.scrollTo(0, y); return; }
      const act = t.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'save-guide') saveGuide();
        if (a === 'save-audio') saveAudio(D.episodes.map(x => x.id));
        if (a === 'copy-link') { try { navigator.clipboard.writeText(D.appUrl).then(() => toast('Link copied.')); } catch (err) { toast(D.appUrl); } }
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (!$('#viewer').hidden) closeViewer(); else if (!$('#sheet').hidden) closeSheet(); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open-map]')) { e.preventDefault(); openViewer(e.target.dataset.openMap); }
    });
    document.addEventListener('change', e => {
      const q = e.target.closest('[data-quest]'); if (!q) return;
      const [sid, i] = q.dataset.quest.split(':'); const all = LS.get('quests', {}); const arr = all[sid] || [];
      arr[+i] = q.checked; all[sid] = arr; LS.set('quests', all);
      q.closest('.quest').classList.toggle('done', q.checked);
      const s = SITE[sid], c = $(`[data-qcount="${sid}"]`);
      if (c) c.textContent = `${s.quests.filter((_, k) => arr[k]).length} of ${s.quests.length} found`;
    });
    document.addEventListener('input', e => { if (e.target.id === 'name-in') paintName(); });
    window.addEventListener('hashchange', () => { closeViewer(); closeSheet(); route(); });
    const net = () => { $('#netbadge').hidden = navigator.onLine; };
    window.addEventListener('online', net); window.addEventListener('offline', net); net();
  }

  // ---------- service worker ----------
  function initSW() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      toast('A new version of the guide is ready.', { label: 'Reload', fn: () => { savePos(); location.reload(); } });
    });
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const r = await fetch('data.json');
      D = await r.json();
    } catch (e) {
      $('#view').innerHTML = '<div class="loading">The guide could not load. Connect to the internet once, then reopen.</div>'; return;
    }
    D.sites.forEach(s => { SITE[s.id] = s; });
    D.episodes.forEach(e => { EP[e.id] = e; });
    Object.assign(PH, D.photos); Object.assign(MAPS, D.maps);
    initEvents(); initViewer();
    await scanCaches();
    initPlayer();
    route();
    initSW();
  }
  boot();
})();
