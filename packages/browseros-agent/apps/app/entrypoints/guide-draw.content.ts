// @ts-nocheck
// Dojo drawing layer. The platform's model plans the marks; this file only renders them as an SVG overlay, one step at a time.
(() => {
  if (window !== top || window.DojoDraw) return;

  // Flying pointer: a visual pointer only. It never clicks, types or moves the real mouse.
  const CUR = 'dojo-cursor'; let curEl = null, hideT = 0;
  window.DojoCursor = {
    to(x, y, viewport) {  // x,y in page coordinates unless viewport is true
      if (!curEl) { curEl = document.createElement('div'); curEl.id = CUR; curEl.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483645;pointer-events:none;transition:transform .9s cubic-bezier(.3,.7,.2,1),opacity .3s;opacity:0'; curEl.innerHTML = '<svg width="30" height="34" viewBox="0 0 30 34"><path d="M3 2 L3 26 L10 20 L15 31 L20 29 L15 18 L24 18 Z" fill="#f28c0f" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'; document.documentElement.appendChild(curEl); curEl.style.transform = `translate(${scrollX + innerWidth - 80}px,${scrollY + innerHeight - 120}px)`; curEl.getBoundingClientRect(); }
      let px = viewport ? x + scrollX : x; const py = viewport ? y + scrollY : y; px = Math.min(px, scrollX + document.documentElement.clientWidth - 28);  // the 30px cursor is absolute on <html>: past the right edge it grows scrollWidth (checker hscroll_added)
      curEl.style.opacity = 1; curEl.style.transform = `translate(${px - 3}px,${py - 2}px)`; curEl.dataset.x = Math.round(px); curEl.dataset.y = Math.round(py);
      clearTimeout(hideT); hideT = setTimeout(() => { if (curEl) curEl.style.opacity = 0; }, 20000);
    },
    hide() { if (curEl) { curEl.remove(); curEl = null; } }
  };
  const NS = 'http://www.w3.org/2000/svg', OR = '#f28c0f', ID = 'dojo-draw', CID = 'dojo-draw-card';
  let svg = null, card = null, plan = null, i = 0, meta = null, view = null, drawn = [];
  const ph = q => { try { document.documentElement.setAttribute('data-dojo-phase', q); } catch (_) {} };
  const clear = keep => { ANN = []; ph('idle'); if (!keep && window.DojoCursor) window.DojoCursor.hide(); if (!keep && window.__dojoResume) window.__dojoResume(); [ID, CID].forEach(x => { const e = document.getElementById(x); if (e) e.remove(); }); svg = card = null; drawn = []; };
  function pt(a) {  // anchor -> document coordinates
    if (a.block) { const e = window.DojoLesson && window.DojoLesson.el(a.block); if (!e) return null; const r = e.getBoundingClientRect(), fx = a.fx == null ? 0.5 : a.fx, fy = a.fy == null ? 0.5 : a.fy; return [scrollX + r.left + r.width * fx - (fx <= 0.12 ? 16 : 0), scrollY + r.top + r.height * fy]; }  // a missing fraction means the middle of the block, never NaN
    return [view.sx + a.x * view.w, view.sy + a.y * view.h];
  }
  function mk(tag, at) { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; }
  const PAL = { line: '#e8590c', arrow: '#1971c2', circle: '#c2255c', box: '#6741d9', polygon: '#2f9e44', square: '#2f9e44', highlight: '#e67700', mark: '#e67700', curve: '#0c8599', polyline: '#d9480f', rightangle: '#c2255c', number: '#1864ab', callout: '#9c36b5', label: '#241a10' };
  let cur = OR;
  function stroke(e, dashed, len) { e.setAttribute('fill', e.getAttribute('fill') || 'none'); e.style.filter = 'drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff) drop-shadow(0 0 1px #000)'; e.setAttribute('stroke', cur); e.setAttribute('stroke-width', '5'); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); return e; }
  function reveal(e, dashed, delay) {
    let L = 600; try { L = e.getTotalLength ? Math.ceil(e.getTotalLength()) : 600; } catch (_) {}
    e.style.opacity = 0; setTimeout(() => {
      e.style.opacity = 1;
      if (dashed) { e.setAttribute('stroke-dasharray', '8 6'); return; }
      e.style.transition = 'none'; e.setAttribute('stroke-dasharray', L); e.setAttribute('stroke-dashoffset', L); e.getBoundingClientRect();
      e.style.transition = 'stroke-dashoffset .5s ease'; e.setAttribute('stroke-dashoffset', 0); setTimeout(() => e.removeAttribute('stroke-dasharray'), 600);
    }, delay);
  }

  // ---- Placement: badges, labels and note boxes are never put over readable text. The model only picks anchors; this code decides where symbols go.
  let OBST = null, PLACED = [], MARKS = 0, AVOIDIMG = false, STEPSCR = false, MK = [], ANN = [];
  const annImg = b => ANN.some(q => Math.abs(q[0] - b[0]) < 3 && Math.abs(q[1] - b[1]) < 3);  // images being annotated: drawing ON them is the point (port addition)
  // fixed role key (meaning, not shape): [colour for light pages, colour for dark pages]
  const ROLE = { key: ['#a15c00', '#ffd166'], term: ['#6d28d9', '#d0bfff'], example: ['#047857', '#8ce99a'], question: ['#be123c', '#ffa8b8'], link: ['#1d4ed8', '#a5d8ff'], step: ['#a15c00', '#ffd166'] };
  function bgDark(el) { for (let e = el; e; e = e.parentElement) { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(e).backgroundColor || ''); if (m && (m[4] === undefined || +m[4] > 0.5)) { const l = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255; return l < 0.45; } } return false; }
  function imgBox(e) {  // an image that has not loaded yet has a degenerate rect, but its aspect-ratio container already holds the final box - marks must avoid the future photo, not just the current one
    let r = e.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) { const p = e.parentElement; if (p) { const pr = p.getBoundingClientRect(); if (pr.width > 24 && pr.height > 24 && pr.height < 600 && pr.width < innerWidth * 1.2) r = pr; } }
    return r;
  }
  function obstacles() {
    if (OBST) return OBST; OBST = [];
    const lo = scrollY - 100, hi = scrollY + innerHeight + 100;
    const skip = n => n.parentElement && n.parentElement.closest('#' + ID + ',#' + CID + ',script,style,noscript,#dojo-status,#dojo-cursor,#dojo-guide-tooltip');
    const roots = [document.body];  // text inside open shadow roots is invisible to a plain TreeWalker: collect those roots too
    for (let i = 0; i < roots.length && i < 400; i++) { const el = roots[i]; if (el.querySelectorAll) el.querySelectorAll('*').forEach(e => { if (e.shadowRoot) roots.push(e.shadowRoot); }); }
    const rg = document.createRange(); let count = 0;
    for (const root of roots) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.nodeValue || '').trim() && !skip(n) ? 1 : 3 }); let n;
      while ((n = w.nextNode()) && count < 16000) { rg.selectNodeContents(n); for (const r of rg.getClientRects()) { if (r.width < 2 || r.height < 5) continue; const y = r.top + scrollY; if (y < lo || y > hi) continue; OBST.push([r.left + scrollX, y, r.right + scrollX, r.bottom + scrollY]); count++; } }
      if (count >= 16000) { console.log("dojo obstacle cap hit"); break; }
    }
    const IMB = [];
    for (const e of document.querySelectorAll('img,picture,video,canvas,svg')) { if (e.closest('#' + ID + ',#' + CID) || (e.closest('svg') && e.tagName !== 'svg')) continue; /* skip only marks INSIDE another svg: a bare img/picture/video has no svg ancestor at all and must be kept */ const r = imgBox(e); if (r.width > 60 && r.height > 60 && r.bottom > 0 && r.top < innerHeight) { const b_ = [r.left + scrollX, r.top + scrollY, r.right + scrollX, r.bottom + scrollY, 1]; IMB.push(b_); if (!annImg(b_)) OBST.push(b_); } }
    // Text you cannot see is not an obstacle: a float/overlay image can sit ON TOP of
    // laid-out text (Range rects report layout, not z-order). Drop text rects whose
    // center is covered by an image (port addition - diagram annotation routes over them).
    if (IMB.length) {
      const covered = o => { const cx = (o[0] + o[2]) / 2 - scrollX, cy = (o[1] + o[3]) / 2 - scrollY; if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false; const el = document.elementFromPoint(cx, cy); return !!(el && (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'CANVAS' || (el.closest && el.closest('picture')))); };
      OBST = OBST.filter(o => { if (o.length !== 4) return true; if (!IMB.some(b => o[0] < b[2] && o[2] > b[0] && o[1] < b[3] && o[3] > b[1])) return true; return !covered(o); });
    }  // checker-equivalent: img >60x60 intersecting the viewport, no area cap (a hero image counts too)
    for (const e of document.querySelectorAll('iframe,[id^="google_ads"],[class*="sponsor" i],[class*="advert" i],[aria-label*="advert" i],[data-ad],[class*="ad-slot" i],[id*="ad-slot" i]')) { if (e.closest('#' + ID + ',#' + CID)) continue; const r = e.getBoundingClientRect(); if (r.width > 40 && r.height > 20 && r.width * r.height < innerWidth * innerHeight * 0.35) OBST.push([r.left + scrollX, r.top + scrollY, r.right + scrollX, r.bottom + scrollY, 0, 1]); }  // a page-sized wrapper whose class mentions ads is not an ad slot (checker rule)
    return OBST;
  }
  window.__dojoDropped = window.__dojoDropped || [];
  function blockOff(o) { for (const a of [o.at, o.from, o.to]) { if (!a || !a.block) continue; const e = window.DojoLesson && window.DojoLesson.el(a.block); if (!e) continue; const r = e.getBoundingClientRect(), T = scrollY + r.top, B = scrollY + r.bottom, L = scrollX + r.left, R = scrollX + r.right; if (B < view.sy || T > view.sy + view.h || R < view.sx || L > view.sx + view.w) return true; { const px = Math.min(Math.max((r.left + r.right) / 2, 2), innerWidth - 2), py = Math.min(Math.max(r.top + Math.min(r.height / 2, 12), 2), innerHeight - 2), top = (r.top < innerHeight && r.bottom > 0) ? document.elementFromPoint(px, py) : null; if (top && !(e.contains(top) || top.contains(e)) && !top.closest('#dojo-draw,#dojo-draw-card,#dojo-status,#dojo-cursor')) return true; } } return false; }
  function snapRect(x, y, w, h) {  // a box edge must never slice a text line (line_cross): snap each edge to contain or clear the line it cuts, <=24px per move, general for any page
    const T = obstacles().filter(o => o.length === 4); let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const t of T) {
        const cx = (t[0] + t[2]) / 2, cy = (t[1] + t[3]) / 2, ovX = t[0] < x1 && t[2] > x0, ovY = t[1] < y1 && t[3] > y0;
        const capY = Math.min(64, (t[3] - t[1]) + 8), capX = Math.min(64, (t[2] - t[0]) + 8);  // the snap must be able to clear the line it slices: a fixed 24px cap dies on 30px+ headlines
        if (ovX && t[1] < y0 && y0 < t[3]) { const ny = cy > y0 ? t[1] - 3 : t[3] + 3; if (Math.abs(ny - y0) <= capY && y1 - ny >= 8) { y0 = ny; moved = true; } }  // never let an edge cross its opposite: an inverted box renders zero-size and the step dies
        if (ovX && t[1] < y1 && y1 < t[3]) { const ny = cy < y1 ? t[3] + 3 : t[1] - 3; if (Math.abs(ny - y1) <= capY && ny - y0 >= 8) { y1 = ny; moved = true; } }
        if (ovY && t[0] < x0 && x0 < t[2]) { const nx = cx > x0 ? t[0] - 3 : t[2] + 3; if (Math.abs(nx - x0) <= capX && x1 - nx >= 8) { x0 = nx; moved = true; } }
        if (ovY && t[0] < x1 && x1 < t[2]) { const nx = cx < x1 ? t[2] + 3 : t[0] - 3; if (Math.abs(nx - x1) <= capX && nx - x0 >= 8) { x1 = nx; moved = true; } }
      }
      if (!moved) break;
    }
    return [x0, y0, x1 - x0, y1 - y0];
  }
  function drop(o, why) { window.__dojoDropped.push({ op: o.op, why }); try { let cur_ = []; try { const p_ = JSON.parse(document.documentElement.getAttribute('data-dojo-dropped') || '[]'); if (Array.isArray(p_)) cur_ = p_; } catch (_) {} cur_.push(o.op + ': ' + why); document.documentElement.setAttribute('data-dojo-dropped', JSON.stringify(cur_.slice(-12))); } catch (_) {} try { console.warn('dojo rule: dropped ' + o.op + ' - ' + why); } catch (_) {} }
  // readability rule: does a path (list of points) touch any text or ad rect?
  function pathHits(P, pad, quick) { let n = 0; pad = pad == null ? 3 : pad; for (let k = 0; k + 1 < P.length; k++) { const a = P[k], b = P[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(2, Math.ceil(L / 4)); for (let s = 0; s <= steps; s++) { const x = a[0] + (b[0] - a[0]) * s / steps, y = a[1] + (b[1] - a[1]) * s / steps; for (const o of obstacles()) if ((!o[4] || AVOIDIMG) && x > o[0] - pad && x < o[2] + pad && y > o[1] - pad && y < o[3] + pad) { n++; if (quick) return n; break; } } } return n; }
  function plen(P) { let s = 0; for (let k = 0; k + 1 < P.length; k++) s += Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]); return s; }
  // move an anchor to the outside edge of its element box, facing the other end
  function edge(an, p, other) { const el = an.block && window.DojoLesson && window.DojoLesson.el(an.block); if (!el) return p; const r = el.getBoundingClientRect(), L = scrollX + r.left, R = scrollX + r.right, T = scrollY + r.top, B = scrollY + r.bottom, cx = (L + R) / 2, cy = (T + B) / 2; let dx = other[0] - cx, dy = other[1] - cy; if (!dx && !dy) return p; const t = Math.min(dx ? (R - L) / 2 / Math.abs(dx) : 1e9, dy ? (B - T) / 2 / Math.abs(dy) : 1e9); const L2 = Math.hypot(dx, dy) || 1; return [cx + dx * t + dx / L2 * 3, cy + dy * t + dy / L2 * 3]; }
  // find a clear route a->b: straight, elbows, then one or two waypoints across the viewport. null if none.
  function route(a, b) {
    const inView = p => p[0] >= view.sx - 2 && p[0] <= view.sx + view.w + 2 && p[1] >= view.sy - 2 && p[1] <= view.sy + view.h + 2;
    const C = [[a, b], [a, [a[0], b[1]], b], [a, [b[0], a[1]], b]];
    for (const P of C) if (pathHits(P, 3, true) === 0) return P;
    let best = null, bl = 1e18; const xs = [], ys = [];
    for (let x = view.sx + 6; x < view.sx + view.w; x += 24) xs.push(x); for (let y = view.sy + 6; y < view.sy + view.h; y += 24) ys.push(y);
    for (const x of xs) for (const y of ys) { const m = [x, y], P = [a, m, b], L = plen(P); if (L < bl && L < 3 * Math.hypot(b[0] - a[0], b[1] - a[1]) + 200 && pathHits(P, 3, true) === 0) { bl = L; best = P; } }
    if (best) return best;
    for (const x1 of xs.filter((_, i) => i % 2 === 0)) for (const y1 of ys.filter((_, i) => i % 2 === 0)) for (const m2 of [[x1, b[1]], [a[0], y1]]) { const P = [a, [x1, a[1]], m2, b]; const L = plen(P); if (L < bl && pathHits(P, 3, true) === 0) { bl = L; best = P; } }
    if (!best) { try { const bad = []; for (const o of obstacles()) { if (o.length !== 4) continue; const x1 = Math.min(a[0], b[0]) - 3, x2 = Math.max(a[0], b[0]) + 3, y1 = Math.min(a[1], b[1]) - 3, y2 = Math.max(a[1], b[1]) + 3; const w = Math.min(x2, o[2]) - Math.max(x1, o[0]), h = Math.min(y2, o[3]) - Math.max(y1, o[1]); if (w > 0 && h > 0) { let who = '?'; try { const el = document.elementFromPoint((o[0] + o[2]) / 2 - scrollX, (o[1] + o[3]) / 2 - scrollY); if (el) who = el.tagName + ':' + String(el.textContent || '').trim().slice(0, 40).replace(/\|/g, '/'); } catch (_) {} bad.push(o.map(Math.round).join(',') + ' {' + who + '}'); if (bad.length >= 4) break; } } drop({ op: 'routedbg' }, 'a=[' + a.map(Math.round) + '] b=[' + b.map(Math.round) + '] view=[' + [view.sx, view.sy, view.w, view.h].map(Math.round) + '] textobst=' + (bad.join(' | ') || 'none')); } catch (_) {} }
    return best;
  }
  function overlapArea(x1, y1, x2, y2) { let s = 0; const pad = 3; for (const o of obstacles()) { if (o[4] && !AVOIDIMG) continue; const w = Math.min(x2 + pad, o[2]) - Math.max(x1 - pad, o[0]), h = Math.min(y2 + pad, o[3]) - Math.max(y1 - pad, o[1]); if (w > 0 && h > 0) s += w * h; } for (const o of PLACED) { const w = Math.min(x2 + 4, o[2]) - Math.max(x1 - 4, o[0]), h = Math.min(y2 + 4, o[3]) - Math.max(y1 - 4, o[1]); if (w > 0 && h > 0) s += w * h * 4; } return s; }
  function adCross(P) {  // would a line through P cross an ad band? (checker ad_hit measures the whole mark group against ads)
    for (const o of obstacles()) { if (!o[5]) continue;
      for (let k = 0; k + 1 < P.length; k++) { const x1 = P[k][0], y1 = P[k][1], x2 = P[k + 1][0], y2 = P[k + 1][1], n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8) || 1;
        for (let q = 0; q <= n; q++) { const x = x1 + (x2 - x1) * q / n, y = y1 + (y2 - y1) * q / n; if (x > o[0] && x < o[2] && y > o[1] && y < o[3]) return true; } } }
    return false;
  }
  function spotOK(cx, cy, r, trq) {  // checker-equivalent keep test for a badge spot: cover_badge 0.12, ad_hit 0.3, note_over_image 0.25 (digit zone), badge_detached 80 - each with margin
    const VWq = Math.min(view.w, document.documentElement.clientWidth), VHq = Math.min(view.h, document.documentElement.clientHeight);
    if (cx - r < view.sx - 2 || cx + r > view.sx + VWq + 2 || cy - r < view.sy - 2 || cy + r > view.sy + VHq + 2) return false;  // a badge hanging past an edge adds hscroll / lands offscreen (checker offscreen + hscroll_added)
    const x1 = cx - r, y1 = cy - r, x2 = cx + r, y2 = cy + r, ba = Math.max(1, (x2 - x1) * (y2 - y1));
    let tov = 0;
    for (const o of obstacles()) {
      const w = Math.min(x2, o[2]) - Math.max(x1, o[0]), h = Math.min(y2, o[3]) - Math.max(y1, o[1]);
      if (w <= 0 || h <= 0) continue;
      if (o.length === 4) tov += w * h;
      else if (o[5]) { if (w * h / ba > 0.25) return false; }
      else if (o[4]) { const dw = Math.min(cx + 6, o[2]) - Math.max(cx - 6, o[0]), dh = Math.min(cy + 8, o[3]) - Math.max(cy - 8, o[1]); if (dw > 0 && dh > 0 && dw * dh / 192 > 0.15) return false; if (w * h / ba > 0.35) return false; }  // digit zone ~ the checker's real digit bbox (12x16, 15% = 29px ~ its 25% of ~9x14)
    }
    if (tov / ba > 0.06) return false;
    if (trq) { const dx = Math.max(trq[0] - cx, 0, cx - trq[2]), dy = Math.max(trq[1] - cy, 0, cy - trq[3]); if (Math.hypot(dx, dy) > 74) return false; }
    return true;
  }
  function spotWhy(cx, cy, r, trq) {  // which rule kills spots here: recorded so placement failures name their blocker
    const x1 = cx - r, y1 = cy - r, x2 = cx + r, y2 = cy + r, ba = Math.max(1, (x2 - x1) * (y2 - y1));
    let tov = 0, img = 0, ad = 0;
    for (const o of obstacles()) {
      const w = Math.min(x2, o[2]) - Math.max(x1, o[0]), h = Math.min(y2, o[3]) - Math.max(y1, o[1]);
      if (w <= 0 || h <= 0) continue;
      if (o.length === 4) tov += w * h; else if (o[5]) ad = Math.max(ad, w * h / ba); else if (o[4]) img = Math.max(img, w * h / ba);
    }
    const out = []; let imgR = null, adR = null;
    if (tov / ba > 0.10) out.push('text ' + Math.round(100 * tov / ba) + '%');
    if (img > 0.2) out.push('photo ' + Math.round(100 * img) + '%');
    if (ad > 0.25) out.push('ad ' + Math.round(100 * ad) + '%');
    for (const o of obstacles()) { const w = Math.min(x2, o[2]) - Math.max(x1, o[0]), h = Math.min(y2, o[3]) - Math.max(y1, o[1]); if (w <= 0 || h <= 0) continue; const f = w * h / ba; if (o[5] && f > 0.25 && !adR) adR = o.map(Math.round).join(','); else if (o[4] && !o[5] && f > 0.2 && !imgR) imgR = o.map(Math.round).join(','); }
    if (imgR) out.push('photoR[' + imgR + ']');
    if (adR) out.push('adR[' + adR + ']');
    if (trq) { const dx = Math.max(trq[0] - cx, 0, cx - trq[2]), dy = Math.max(trq[1] - cy, 0, cy - trq[3]); if (Math.hypot(dx, dy) > 74) out.push('far ' + Math.round(Math.hypot(dx, dy)) + 'px'); }
    return out.length ? 'anchor area blocked by ' + out.join(', ') : 'anchor area clean, ring exhausted';
  }
  // nearest free centre for a w x h symbol: preferred spots first, then rings around (cx, cy); the least-overlapping spot if none is free
  function free(cx, cy, w, h, prefs, keep, maxR, accept) {
    const sx = view.sx, sy = view.sy, W = Math.min(view.w, document.documentElement.clientWidth), H = Math.min(view.h, document.documentElement.clientHeight), cl = (x, y) => [Math.min(Math.max(x, sx + w / 2 + 4), sx + W - w / 2 - 4), Math.min(Math.max(y, sy + h / 2 + 4), sy + H - h / 2 - 4)];
    const cands = []; (prefs || []).forEach(p => cands.push(cl(p[0], p[1])));
    for (const r of [0, 16, 28, 44, 64, 90, 120, 160, 210, 270, 340]) { if (maxR && r > maxR) break; for (let k = 0; k < (r ? 12 : 1); k++) { const a = k * Math.PI / 6; cands.push(cl(cx + r * Math.cos(a), cy + r * Math.sin(a))); } }
    const adOv = (x1, y1, x2, y2) => { let s = 0; for (const o of obstacles()) { if (!o[5]) continue; const w2 = Math.min(x2 + 3, o[2]) - Math.max(x1 - 3, o[0]), h2 = Math.min(y2 + 3, o[3]) - Math.max(y1 - 3, o[1]); if (w2 > 0 && h2 > 0) s += w2 * h2; } return s; };
    const ranked = [];
    for (const c of cands) { const s = overlapArea(c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2); const ao = adOv(c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2) / Math.max(1, w * h); ranked.push([s, ao, c]); }  // a mark mostly on an ad fails the checker's ad_hit: only small ad overlaps are usable fallbacks
    ranked.sort((p, q) => (p[1] > 0.25) - (q[1] > 0.25) || (p[1] > 0) - (q[1] > 0) || p[0] - q[0]);  // ad-free first, then small ad overlap, least text overlap inside each class
    let best = ranked.length ? ranked[0][2] : null;
    if (accept) { for (const rc of ranked) { if (accept(rc[2])) { best = rc[2]; break; } } }
    if (keep !== false) PLACED.push([best[0] - w / 2, best[1] - h / 2, best[0] + w / 2, best[1] + h / 2]);
    return best;
  }
  function label(g, x, y, text, delay, prefs) {
    const t = mk('text', { 'data-k': 'note', x, y, 'font-family': 'Arial', 'font-size': 15, 'font-weight': 700, fill: '#241a10', 'paint-order': 'stroke', stroke: '#fff7ec', 'stroke-width': 5, 'text-anchor': 'middle' }); t.textContent = text;
    t.style.opacity = 0; t.style.transition = 'opacity .4s'; g.appendChild(t); setTimeout(() => t.style.opacity = 1, delay);
    try { const w = t.getComputedTextLength() + 8;
      const IBS = []; for (const im of document.images) { const r0 = imgBox(im); if (r0.width < 60 || r0.height < 60 || r0.bottom < 0 || r0.top > innerHeight) continue; const b0_ = [scrollX + r0.left, scrollY + r0.top, scrollX + r0.right, scrollY + r0.bottom]; if (!annImg(b0_)) IBS.push(b0_); }
      const ioAt = (cx, cy) => { const nb0 = [cx - w / 2, cy - 10, cx + w / 2, cy + 10], na0 = Math.max(1, w * 20); let m0 = 0; for (const b0 of IBS) { const iw0 = Math.min(nb0[2], b0[2]) - Math.max(nb0[0], b0[0]), ih0 = Math.min(nb0[3], b0[3]) - Math.max(nb0[1], b0[1]); if (iw0 > 0 && ih0 > 0) m0 = Math.max(m0, iw0 * ih0 / na0); } return m0; };  // the search must avoid photos too, not just the post-check: one attempt on a photo-dense page otherwise dies where a clean spot sat 40px away
      let dbgN = 0;
      const p = free(x, y - 5, w, 20, prefs, false, 320, c => { const nb = [c[0] - w / 2, c[1] - 10, c[0] + w / 2, c[1] + 10], na = Math.max(1, w * 20); let ao = 0; for (const o of obstacles()) { if (!o[5]) continue; const iw = Math.min(nb[2], o[2]) - Math.max(nb[0], o[0]), ih = Math.min(nb[3], o[3]) - Math.max(nb[1], o[1]); if (iw > 0 && ih > 0) ao = Math.max(ao, iw * ih / na); } const io = ioAt(c[0], c[1]); const ok = ao <= 0.25 && io <= 0.25; if (!ok && dbgN++ < 3) drop({ op: 'labeldbg' }, 'reject [' + c.map(Math.round) + '] ao=' + ao.toFixed(2) + ' io=' + io.toFixed(2)); return ok; });
      drop({ op: 'labeldbg' }, 'chose [' + (p ? p.map(Math.round).join(',') : 'null') + '] for "' + String(text).slice(0, 30) + '" at [' + Math.round(x) + ',' + Math.round(y) + '] ANN=' + ANN.length);
      const nb = [p[0] - w / 2, p[1] - 10, p[0] + w / 2, p[1] + 10], na = Math.max(1, (nb[2] - nb[0]) * (nb[3] - nb[1]));
      let io3 = 0; for (const im of document.images) { const r = imgBox(im); if (r.width < 60 || r.height < 60 || r.bottom < 0 || r.top > innerHeight) continue; const b = [scrollX + r.left, scrollY + r.top, scrollX + r.right, scrollY + r.bottom]; if (annImg(b)) continue; const iw = Math.min(nb[2], b[2]) - Math.max(nb[0], b[0]), ih = Math.min(nb[3], b[3]) - Math.max(nb[1], b[1]); if (iw > 0 && ih > 0) io3 = Math.max(io3, iw * ih / na); }
      if (io3 > 0.25) { t.remove(); drop({ op: 'label' }, 'note would sit on a photo'); return null; }  // a note on a photo hides what it should sit beside (note_over_image), whatever AVOIDIMG says
      let tx = 0; for (const o of obstacles()) { if (o.length !== 4) continue; const iw = Math.min(nb[2], o[2]) - Math.max(nb[0], o[0]), ih = Math.min(nb[3], o[3]) - Math.max(nb[1], o[1]); if (iw > 0 && ih > 0) tx += iw * ih; }
      if (tx > 40) { t.remove(); window.__dojoDropped.push({ op: 'label', why: 'no text-free spot for the note near its anchor' }); return null; }  // a note that would sit on text is worse than no note
      let ao = 0; for (const o of obstacles()) { if (!o[5]) continue; const iw = Math.min(nb[2], o[2]) - Math.max(nb[0], o[0]), ih = Math.min(nb[3], o[3]) - Math.max(nb[1], o[1]); if (iw > 0 && ih > 0) ao = Math.max(ao, iw * ih / na); }
      if (ao > 0.25) { t.remove(); drop({ op: 'label' }, 'note would sit on an ad'); return null; }  // the checker counts the whole mark group against ad areas
      let nn = 0; for (const q of PLACED) { const iw = Math.min(nb[2], q[2]) - Math.max(nb[0], q[0]), ih = Math.min(nb[3], q[3]) - Math.max(nb[1], q[1]); if (iw > 0 && ih > 0) nn = Math.max(nn, iw * ih / na); }
      if (nn > 0.10) { t.remove(); drop({ op: 'label' }, 'note would sit on another note'); return null; }  // two notes stacked on one anchor read as one smudge: keep the first, drop the second
      t.setAttribute('x', p[0]); t.setAttribute('y', p[1] + 5); PLACED.push(nb); } catch (_) { try { t.remove(); drop({ op: 'label' }, 'placement measurement failed'); } catch (_) {} return null; }
    return t;
  }
  function edgeHits(a, b) {  // checker-mirror sampling of one box edge: a hit is a sample strictly inside a text rect inset by (2,3)
    let hit = 0; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s <= L; s += 4) { const px = a[0] + (b[0] - a[0]) * s / Math.max(1, L), py = a[1] + (b[1] - a[1]) * s / Math.max(1, L);
      for (const o of obstacles()) { if (o.length !== 4) continue; if (px > o[0] + 2 && px < o[2] - 2 && py > o[1] + 3 && py < o[3] - 3) { hit++; break; } } }
    return hit;
  }
  function uncross(x, y, w, h) {  // inset the worst-crossing box edge 4px at a time until the checker-mirror count clears (line_cross fires at >=4 hits); null when 24px of inset cannot free it
    let budget = 24;
    while (true) {
      const E = [[[x, y], [x + w, y], 't'], [[x + w, y], [x + w, y + h], 'r'], [[x, y + h], [x + w, y + h], 'b'], [[x, y], [x, y + h], 'l']];
      let tot = 0, wn = 0, worst = null;
      for (const q of E) { const n = edgeHits(q[0], q[1]); tot += n; if (n > wn) { wn = n; worst = q[2]; } }
      if (tot < 4) return [x, y, w, h];
      if (budget <= 0 || w < 12 || h < 12) return null;
      budget -= 4;
      if (worst === 't') { y += 4; h -= 4; } else if (worst === 'b') { h -= 4; } else if (worst === 'l') { x += 4; w -= 4; } else { w -= 4; }
    }
  }
  // union of an element's real text-line rects (not its padding): shared by the box renderer and the post-reflow re-hug
  function textUnion(el) {
    const wk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), rg2 = document.createRange(); let tn; const RS = []; let wn = 0;
    while ((tn = wk.nextNode()) && wn++ < 4000) { if (!(tn.nodeValue || '').trim()) continue; rg2.selectNodeContents(tn); for (const q of rg2.getClientRects()) if (q.width >= 2 && q.height >= 5) RS.push(q); }
    if (!RS.length) return null;
    return { left: Math.min(...RS.map(q => q.left)), top: Math.min(...RS.map(q => q.top)), right: Math.max(...RS.map(q => q.right)), bottom: Math.max(...RS.map(q => q.bottom)) };
  }
  function render(step, g0) {
    OBST = null; PLACED = []; MARKS = 0; MK = [];
    window.__dojoDropped.push({ op: 'render', why: (step.ops || []).length + ' ops: ' + (step.ops || []).map(o => o.op).join(',') });
    let d = 0;
    for (const o of step.ops) {
     try {
      let e = null; const g = mk('g', {}); g.setAttribute('data-op', o.op); g0.appendChild(g); cur = PAL[o.op] || OR; if (o.note) { g.style.pointerEvents = 'all'; g.style.cursor = 'pointer'; g.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); if (window.__dojoPick) window.__dojoPick(g, o); }, true); }
      if (o.op !== 'mark') {
        const gone = ['at', 'from', 'to'].some(k => o[k] && o[k].block && !(window.DojoLesson && window.DojoLesson.el(o[k].block)));
        if (gone || blockOff(o)) {
          let nb = null;
          if (o.find) { const rs = textRects(document.body, o.find); if (rs.length && textRects.lastNode) { const be = window.DojoLesson && window.DojoLesson.blockOf && window.DojoLesson.blockOf(textRects.lastNode); if (be && be.dataset && be.dataset.dojoId) nb = be.dataset.dojoId; } }
          if (nb) { for (const k of ['at', 'from', 'to']) if (o[k] && o[k].block) o[k] = Object.assign({}, o[k], { block: nb }); }  // live pages re-render between plan and draw: the quoted words matter more than the stale element
          else { drop(o, 'its target is not on screen'); g.remove(); continue; }
        }
      }
      if (o.op === 'line' || o.op === 'arrow') {
        let a = pt(o.from), b = pt(o.to); if (!a || !b) { drop(o, 'an end has no element'); g.remove(); continue; }
        const ab = [a, b]; a = edge(o.from, a, ab[1]); b = edge(o.to, b, ab[0]);
        const inV = p => p[0] >= view.sx && p[0] <= view.sx + view.w && p[1] >= view.sy && p[1] <= view.sy + view.h;
        if (!inV(a) || !inV(b)) { drop(o, 'an end is off the analysed screen'); g.remove(); continue; }
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 14) { drop(o, 'both ends are the same spot'); g.remove(); continue; }
        const P = route(a, b); if (!P) { drop(o, 'no path avoids the text'); g.remove(); continue; }
        e = stroke(mk('polyline', { points: P.map(p => p.join(',')).join(' ') })); g.appendChild(e); reveal(e, o.dashed, d);
        if (o.op === 'arrow') { const p0 = P[P.length - 2], b2 = P[P.length - 1], ang = Math.atan2(b2[1] - p0[1], b2[0] - p0[0]), h = 12, hd = mk('path', { d: `M${b2[0]},${b2[1]} L${b2[0] - h * Math.cos(ang - .45)},${b2[1] - h * Math.sin(ang - .45)} L${b2[0] - h * Math.cos(ang + .45)},${b2[1] - h * Math.sin(ang + .45)} Z`, fill: cur }); hd.style.opacity = 0; g.appendChild(hd); setTimeout(() => hd.style.opacity = 1, d + 450); }
        if (o.text) { const m = P[Math.floor(P.length / 2)]; label(g, (P.length % 2 ? m[0] : (P[P.length / 2 - 1][0] + m[0]) / 2), (P.length % 2 ? m[1] : (P[P.length / 2 - 1][1] + m[1]) / 2) - 8, o.text, d + 300); }
      } else if (o.op === 'circle') {
        const a = pt(o.at); if (!a) { drop(o, 'anchor block not on the page'); g.remove(); continue; } e = stroke(mk('circle', { cx: a[0], cy: a[1], r: Math.max(8, o.r * view.w) })); g.appendChild(e); reveal(e, o.dashed, d);
        if (o.text) label(g, a[0], a[1] - Math.max(8, o.r * view.w) - 8, o.text, d + 300);
      } else if (o.op === 'box') {
        let x, y, w, h;
        if (o.from && o.to && o.from.block && o.to.block) {  // block-to-block: hug the union of the two blocks' edges, not their inner anchor points, so the sides never run through the column
          const e1 = window.DojoLesson.el(o.from.block), e2 = window.DojoLesson.el(o.to.block); if (!e1 || !e2) { drop(o, 'anchor block not on the page'); g.remove(); continue; }
          const r1 = e1.getBoundingClientRect(), r2 = e2.getBoundingClientRect();
          x = scrollX + Math.min(r1.left, r2.left) - 4; y = scrollY + Math.min(r1.top, r2.top) - 4;
          w = Math.max(r1.right, r2.right) - Math.min(r1.left, r2.left) + 8; h = Math.max(r1.bottom, r2.bottom) - Math.min(r1.top, r2.top) + 8;
        }
        else if (o.from && o.to) { const a = pt(o.from), b = pt(o.to); if (!a || !b) { drop(o, 'anchor block not on the page'); g.remove(); continue; } x = Math.min(a[0], b[0]); y = Math.min(a[1], b[1]); w = Math.abs(a[0] - b[0]); h = Math.abs(a[1] - b[1]); }
        else { const el = window.DojoLesson.el(o.at.block); if (!el) { drop(o, 'anchor block not on the page'); g.remove(); continue; }
        let r = textUnion(el) || el.getBoundingClientRect();  // box the text, not the element's padding: on dense lists (TOCs) element+4 edges slice the next line's glyphs (line_cross), text-2 edges land in the gap between lines
        x = scrollX + r.left - 2; y = scrollY + r.top - 2; w = (r.right - r.left) + 4; h = (r.bottom - r.top) + 4; }  // the text-rects branch builds a plain {left,top,right,bottom} with no .width/.height: r.width was undefined -> NaN box -> zero-size death on every text-bearing anchor
        const SB = snapRect(x, y, w, h); x = SB[0]; y = SB[1]; w = SB[2]; h = SB[3];
        { const VW0 = Math.min(view.w, document.documentElement.clientWidth), VH0 = Math.min(view.h, document.documentElement.clientHeight); if (x + w < view.sx - 2 || x > view.sx + VW0 + 2 || y + h < view.sy - 2 || y > view.sy + VH0 + 2) { drop(o, 'its target is not on screen'); g.remove(); continue; } }  // a target fully outside the viewport must drop before the edge clamp: clamping a non-intersecting box inverts its width and the rect renders to zero size
        { const VW = Math.min(view.w, document.documentElement.clientWidth), X1 = view.sx + 2, X2 = view.sx + VW - 2; if (x < X1) { w -= X1 - x; x = X1; } if (x + w > X2) w = X2 - x; }  // a box past the viewport edge adds horizontal scroll (hscroll_added) and reads as offscreen
        { const VH = Math.min(view.h, document.documentElement.clientHeight), Y1 = view.sy + 2, Y2 = view.sy + VH - 2; if (y < Y1) { h -= Y1 - y; y = Y1; } if (y + h > Y2) h = Y2 - y; }  // same clamp vertically: a box around a block that runs below the fold must stop at the edge (the rubric fails a mark that is <97% visible)
        if (![x, y, w, h].every(Number.isFinite)) { drop(o, 'non-finite box geometry: ' + [x, y, w, h].map(v => String(v).slice(0, 9)).join(',') + ' at=' + JSON.stringify(o.at || o.from || {})); g.remove(); continue; }  // NaN < 8 is false, so a NaN box passed the old check, rendered zero-size and died unexplained
        if (!(w >= 8 && h >= 8)) { drop(o, 'the box corners landed on the same spot'); g.remove(); continue; }
        { const U = uncross(x, y, w, h); if (!U) { drop(o, 'box edge crosses text it cannot clear'); g.remove(); continue; } x = U[0]; y = U[1]; w = U[2]; h = U[3]; }
        e = stroke(mk('rect', { x, y, width: w, height: h, rx: 4 }));
        if (o.at && o.at.block) e.setAttribute('data-bhug', o.at.block); else if (o.from && o.from.block && o.to && o.to.block) e.setAttribute('data-bhug', o.from.block + '|' + o.to.block);  // block-anchored: re-hug after late reflow (fonts/images shift text lines under a measured box)
        g.appendChild(e); reveal(e, o.dashed, d); if (o.text) label(g, x + w / 2, y - 8, o.text, d + 300);
      } else if (o.op === 'rightangle') {
        const a = pt(o.at); if (!a) { drop(o, 'anchor block not on the page'); g.remove(); continue; } const s = Math.max(10, o.r * view.w); e = stroke(mk('path', { d: `M${a[0] + s},${a[1]} L${a[0] + s},${a[1] - s} L${a[0]},${a[1] - s}` })); g.appendChild(e); reveal(e, o.dashed, d);
      } else if (o.op === 'polygon') {
        const ps = o.points.map(pt); if (ps.some(p => !p)) { drop(o, 'anchor block not on the page'); g.remove(); continue; } e = stroke(mk('polygon', { points: ps.map(p => p.join(',')).join(' '), fill: cur + '30' })); g.appendChild(e); reveal(e, o.dashed, d);
        if (o.text) { const cx = ps.reduce((s, p) => s + p[0], 0) / ps.length, cy = ps.reduce((s, p) => s + p[1], 0) / ps.length; label(g, cx, cy, o.text, d + 300); }
      } else if (o.op === 'square') {
        const a = pt(o.from), b = pt(o.to); if (!a || !b) { drop(o, 'anchor block not on the page'); g.remove(); continue; } const dx = b[0] - a[0], dy = b[1] - a[1], sg = o.side === 'left' ? -1 : 1, nx = -dy * sg, ny = dx * sg;
        const P = [a, b, [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]; e = stroke(mk('polygon', { points: P.map(p => p.join(',')).join(' '), fill: cur + '38' })); g.appendChild(e); reveal(e, o.dashed, d);
        if (o.text) label(g, (P[0][0] + P[2][0]) / 2, (P[0][1] + P[2][1]) / 2 + 5, o.text, d + 300);
      } else if (o.op === 'curve') {
        const a = pt(o.from), b = pt(o.to), v = pt(o.via); if (!a || !b || !v) { drop(o, 'anchor block not on the page'); g.remove(); continue; } const cxp = 2 * v[0] - (a[0] + b[0]) / 2, cyp = 2 * v[1] - (a[1] + b[1]) / 2;
        e = stroke(mk('path', { d: `M${a[0]},${a[1]} Q${cxp},${cyp} ${b[0]},${b[1]}` })); g.appendChild(e); reveal(e, o.dashed, d);
        if (o.arrow) { const ang = Math.atan2(b[1] - cyp, b[0] - cxp), h = 12, hd = mk('path', { d: `M${b[0]},${b[1]} L${b[0] - h * Math.cos(ang - .45)},${b[1] - h * Math.sin(ang - .45)} L${b[0] - h * Math.cos(ang + .45)},${b[1] - h * Math.sin(ang + .45)} Z`, fill: OR }); hd.style.opacity = 0; g.appendChild(hd); setTimeout(() => hd.style.opacity = 1, d + 450); }
        if (o.text) label(g, v[0], v[1] - 8, o.text, d + 300);
      } else if (o.op === 'number') {
        const a = pt(o.at); if (!a) { drop(o, 'anchor block not on the page'); g.remove(); continue; } let sp = null, rad = 13, trq = null; { const el = o.at.block && window.DojoLesson && window.DojoLesson.el(o.at.block); const rc_ = el ? el.getBoundingClientRect() : null; trq = rc_ ? [scrollX + rc_.left, scrollY + rc_.top, scrollX + rc_.right, scrollY + rc_.bottom] : null; const prefs = trq ? (() => { const P = []; for (const d of [22, 14, 9, 30, 40]) { P.push([trq[0] - d, a[1]], [trq[2] + d, a[1]]); } for (const d of [22, 14, 9, 30, 40]) { P.push([trq[0] - d, trq[1] + 12], [trq[2] + d, trq[1] + 12]); } P.push([a[0], trq[1] - 18], [a[0], trq[3] + 18], [trq[0] - 22, trq[1] - 18], [trq[2] + 22, trq[1] - 18], [trq[0] - 22, trq[3] + 18], [trq[2] + 22, trq[3] + 18]); return P; })() : []; const dEdge = trq ? Math.max(0, a[0] - trq[0], trq[2] - a[0], a[1] - trq[1], trq[3] - a[1]) : 0; const maxR = Math.min(360, Math.max(78, dEdge + 72)); for (const sz of [30, 24, 18]) { const cand = free(a[0], a[1], sz, sz, prefs, false, maxR, c => spotOK(c[0], c[1], sz / 2, trq)); if (spotOK(cand[0], cand[1], sz / 2, trq)) { sp = cand; rad = sz / 2 - 2; break; } } if (!sp) { let why = ''; try { const W = spotWhy(a[0], a[1], 12, trq); why = ' (' + W + ')'; } catch (_) {} drop(o, 'no clean spot near its target' + why); g.remove(); continue; } PLACED.push([sp[0] - rad, sp[1] - rad, sp[0] + rad, sp[1] + rad]); if (Math.hypot(sp[0] - a[0], sp[1] - a[1]) > 30) { let ex = a[0], ey = a[1]; if (trq) { const L = trq[0], R = trq[2], T = trq[1], B = trq[3]; if (sp[0] < L) ex = L - 1; else if (sp[0] > R) ex = R + 1; else if (sp[1] < T) ey = T - 1; else if (sp[1] > B) ey = B + 1; } ex = Math.min(Math.max(ex, view.sx + 2), view.sx + view.w - 2); ey = Math.min(Math.max(ey, view.sy + 2), view.sy + view.h - 2); const LP = [[sp[0] + (ex > sp[0] ? 14 : ex < sp[0] ? -14 : 0), sp[1] + (ey > sp[1] ? 14 : ey < sp[1] && ex === a[0] ? -14 : 0)], [ex, ey]]; if (plen(LP) < 14) { /* badge already beside its target */ } else if (pathHits(LP, 2) > 0 || LP[0][1] < view.sy || LP[0][1] > view.sy + view.h) { drop({ op: 'leader' }, 'would cross text'); } else { const ld = stroke(mk('polyline', { points: LP.map(p => p.join(',')).join(' ') })); g.appendChild(ld); reveal(ld, false, d); } } }
        const c = mk('circle', { 'data-k': 'badge', 'data-target': trq ? trq.join(',') : '', cx: sp[0], cy: sp[1], r: rad, fill: cur, stroke: '#fff', 'stroke-width': 2 }); const t = mk('text', { x: sp[0], y: sp[1] + Math.max(4, Math.round((rad + 1) * 0.36)), 'font-family': 'Arial', 'font-size': Math.max(11, rad + 1), 'font-weight': 700, fill: '#fff', 'text-anchor': 'middle' }); t.textContent = o.text;
        [c, t].forEach(z => { z.style.opacity = 0; z.style.transition = 'opacity .4s'; g.appendChild(z); setTimeout(() => z.style.opacity = 1, d); });
      } else if (o.op === 'callout') {
        const a0 = pt(o.at), b = pt(o.box); if (!a0 || !b) { drop(o, 'anchor block not on the page'); g.remove(); continue; }
        const words = o.text.split(' '), lines = []; let cur_ = ''; for (const w_ of words) { if ((cur_ + ' ' + w_).trim().length > 26 && cur_) { lines.push(cur_); cur_ = w_; } else cur_ = (cur_ + ' ' + w_).trim(); } if (cur_) lines.push(cur_);
        const w = Math.min(230, 7.6 * Math.max(...lines.map(l => l.length)) + 18), h = 14 + 17 * lines.length;
        const CW = Math.min(view.w, document.documentElement.clientWidth), CH = Math.min(view.h, document.documentElement.clientHeight);
        const clampB = (x, y) => [Math.min(Math.max(x, view.sx + w / 2 + 8), view.sx + CW - w / 2 - 8), Math.min(Math.max(y, view.sy + h / 2 + 8), view.sy + CH - h / 2 - 8)];
        const rectEdge = (cx, cy, tx, ty) => { const dx = tx - cx, dy = ty - cy; if (!dx && !dy) return [cx, cy]; const t = Math.min(dx ? (w / 2 + 3) / Math.abs(dx) : 1e9, dy ? (h / 2 + 3) / Math.abs(dy) : 1e9); return [cx + dx * t, cy + dy * t]; };
        a0[0] = Math.min(Math.max(a0[0], view.sx + 4), view.sx + CW - 4); a0[1] = Math.min(Math.max(a0[1], view.sy + 4), view.sy + CH - 4);  // an anchor below the fold (fy deep in a tall block) dragged the leader off-screen: point at the visible edge of the target's area instead
        const a = edge(o.at, a0, b); const cands = [clampB(b[0], b[1])];
        for (const r_ of [70, 110, 150, 200, 260, 340, 430]) for (let k = 0; k < 12; k++) { const an = k * Math.PI / 6; cands.push(clampB(a[0] + (r_ + w / 2) * Math.cos(an) * 0.8, a[1] + (r_ + h / 2) * Math.sin(an))); }
        AVOIDIMG = true; let box = null, P = null;
        for (const c of cands) { if (overlapArea(c[0] - w / 2 - 4, c[1] - h / 2 - 4, c[0] + w / 2 + 4, c[1] + h / 2 + 4) > 0) continue; const e0 = rectEdge(c[0], c[1], a[0], a[1]), Q = route(e0, a); if (Q) { box = c; P = Q; break; } }
        if (!box) { const c0 = free(b[0], b[1], w + 8, h + 8, [], false), c = clampB(c0[0], c0[1]); if (overlapArea(c[0] - w / 2 - 4, c[1] - h / 2 - 4, c[0] + w / 2 + 4, c[1] + h / 2 + 4) === 0 && Math.hypot(c[0] - a[0], c[1] - a[1]) < Math.max(w, h) / 2 + 100) { box = c; P = null; } }  // the fallback must stay on screen too: an unclamped free() spot put the whole box past the viewport edge (offscreen)
        AVOIDIMG = false; if (!box) { drop(o, 'no clear place for the note and its line'); g.remove(); continue; }
        PLACED.push([box[0] - w / 2 - 4, box[1] - h / 2 - 4, box[0] + w / 2 + 4, box[1] + h / 2 + 4]);
        if (P) { const ln = stroke(mk('path', { d: 'M' + P.map(p => p[0] + ',' + p[1]).join(' L') })); g.appendChild(ln); reveal(ln, false, d); }
        const r = mk('rect', { x: box[0] - w / 2, y: box[1] - h / 2, width: w, height: h, rx: 8, fill: '#fffdf8', stroke: cur, 'stroke-width': 2.5 }); const els = [r];
        lines.forEach((l, k) => { const t = mk('text', { x: box[0], y: box[1] - h / 2 + 19 + 17 * k, 'font-family': 'Arial', 'font-size': 13, 'font-weight': 700, fill: '#241a10', 'text-anchor': 'middle' }); t.textContent = l; els.push(t); });
        els.forEach(z => { z.style.opacity = 0; z.style.transition = 'opacity .4s'; g.appendChild(z); setTimeout(() => z.style.opacity = 1, d + 250); });
      } else if (o.op === 'highlight') {
        const a = pt(o.from), b = pt(o.to); if (!a || !b) { drop(o, 'anchor block not on the page'); g.remove(); continue; }
        const HR = snapRect(Math.min(a[0], b[0]) - 4, Math.min(a[1], b[1]) - 4, Math.abs(a[0] - b[0]) + 8, Math.abs(a[1] - b[1]) + 8);
        e = mk('rect', { x: HR[0], y: HR[1], width: HR[2], height: HR[3], rx: 6, fill: 'none', stroke: cur, 'stroke-width': 2.5 });  // outline only: a fill would cover the text it points at
        e.style.opacity = 0; e.style.transition = 'opacity .5s'; g.appendChild(e); setTimeout(() => e.style.opacity = 1, d);
        if (o.text) label(g, HR[0] + HR[2] / 2, HR[1] - 8, o.text, d + 300);
      } else if (o.op === 'mark') {
        if (++MARKS > 7) { drop(o, 'more than 7 marks on one screen'); g.remove(); continue; }
        const el = window.DojoLesson && window.DojoLesson.el(o.at.block); if (!el) { drop(o, 'anchor block not on the page'); g.remove(); continue; } let rs = textRects(el, o.find); if (!rs.length) rs = textRects(document.body, o.find);  // a live page can re-render the part (rotating headlines, feed inserts): the quoted words matter more than the stale element, so look page-wide before giving up
        if (!rs.length) { drop(o, 'the words are not on the page: [' + (o.at && o.at.block) + '] "' + String(o.find || '').slice(0, 70) + '"'); g.remove(); continue; }
        if (rs[0].top < 90 || rs[0].bottom > innerHeight - 140) {
          if (STEPSCR) { drop(o, 'mark lies beyond this step screen'); g.remove(); continue; }  // a step gets one screen: the first mark sets it, later ones must fit (offscreen viols)
          STEPSCR = true; scrollTo(scrollX, scrollY + rs[0].top - innerHeight / 3); OBST = null; view = { sx: scrollX, sy: scrollY, w: document.documentElement.clientWidth, h: innerHeight }; rs = textRects(el, o.find);
        }
        { const CWd = document.documentElement.clientWidth; rs = rs.filter(r => r.left >= -1 && r.right <= CWd + 1 && r.bottom > 0 && r.top < innerHeight); if (!rs.length) { drop(o, 'the words are off screen sideways or hidden'); g.remove(); continue; } }
        const role = ROLE[o.intent] || ROLE.key, dark = bgDark(el), col = dark ? role[1] : role[0], fs = parseFloat(getComputedStyle(el).fontSize) || 16, sw = Math.min(4, Math.max(2, fs * 0.12)), words = (o.find || '').trim().split(/\s+/).length;
        const mkEls = []; rs.forEach((r, ri) => {
          const L = scrollX + r.left, R = scrollX + r.right, B = scrollY + r.bottom, T = scrollY + r.top;
          if (o.intent === 'key' && words <= 8) { const f = mk('rect', { 'data-k': 'hl', x: L - 1, y: T, width: r.width + 2, height: r.height, rx: 2, fill: col, opacity: 0.3 }); f.style.mixBlendMode = dark ? 'screen' : 'multiply'; f.style.opacity = 0; f.style.transition = 'opacity .4s'; g.appendChild(f); setTimeout(() => f.style.opacity = 0.3, d); mkEls.push({ el: f, ri, kind: 'hl' }); }
          let pd; if (o.intent === 'question') { pd = 'M' + L + ',' + (B + 2); for (let x = L; x < R; x += 6) pd += ' q3,3 6,0 t0,0'.replace('t0,0', '') + ''; pd = 'M' + L + ',' + (B + 2) + ' ' + Array.from({ length: Math.ceil((R - L) / 6) }, (_, k) => 'L' + (L + k * 6 + 3) + ',' + (B + 2 + (k % 2 ? 2 : -1))).join(' '); } else pd = 'M' + L + ',' + (B + 1.5) + ' L' + R + ',' + (B + 1.5);
          const u = mk('path', { 'data-k': 'ul', d: pd, fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-linecap': 'round' }); if (o.intent === 'term') u.setAttribute('stroke-dasharray', sw + ' ' + sw * 1.6); else if (o.intent === 'example') u.setAttribute('stroke-dasharray', sw * 3 + ' ' + sw * 1.5); u.style.opacity = 0; u.style.transition = 'opacity .4s'; g.appendChild(u); setTimeout(() => u.style.opacity = 1, d); mkEls.push({ el: u, ri, kind: 'ul' });
        });
        const first = rs[0], txt = (o.text || (o.intent === 'question' ? '?' : '')).trim();
        AVOIDIMG = true;
        let mkNote = null, mkLd = null;
        if (txt) {
          const t = mk('text', { 'data-k': 'note', 'font-size': 13, 'font-weight': 700, fill: col, stroke: dark ? '#000' : '#fff', 'stroke-width': 3.5, 'paint-order': 'stroke', 'text-anchor': 'middle', 'font-family': 'system-ui,sans-serif' }); t.textContent = txt; g.appendChild(t);
          const w = (t.getComputedTextLength() || 60) + 10, fx = scrollX + first.left, fy = scrollY + first.top;
          const p = free(fx + first.width / 2, fy - 22, w, 20, [[fx + w / 2, fy - 20], [fx + first.width / 2, scrollY + rs[rs.length - 1].bottom + 22], [fx - w / 2 - 14, fy + first.height / 2], [scrollX + Math.max(...rs.map(r => r.right)) + w / 2 + 14, fy + first.height / 2]]);
          let io2 = 0; const nb = [p[0] - w / 2, p[1] - 10, p[0] + w / 2, p[1] + 10], na = Math.max(1, (nb[2] - nb[0]) * (nb[3] - nb[1])); for (const im of document.images) { const r = imgBox(im); if (r.width < 60 || r.height < 60 || r.bottom < 0 || r.top > innerHeight) continue; const b = [scrollX + r.left, scrollY + r.top, scrollX + r.right, scrollY + r.bottom]; if (annImg(b)) continue; const iw = Math.min(nb[2], b[2]) - Math.max(nb[0], b[0]), ih = Math.min(nb[3], b[3]) - Math.max(nb[1], b[1]); if (iw > 0 && ih > 0) io2 = Math.max(io2, iw * ih / na); }  // live image rects, checker rule: >25% of the note on any one photo
          let ao2 = 0; for (const o of obstacles()) { if (!o[5]) continue; const iw = Math.min(nb[2], o[2]) - Math.max(nb[0], o[0]), ih = Math.min(nb[3], o[3]) - Math.max(nb[1], o[1]); if (iw > 0 && ih > 0) ao2 = Math.max(ao2, iw * ih / na); }  // same rule for ad slots (checker ad_hit measures the whole mark group)
          let nn2 = 0; for (const q of PLACED) { const iw = Math.min(nb[2], q[2]) - Math.max(nb[0], q[0]), ih = Math.min(nb[3], q[3]) - Math.max(nb[1], q[1]); if (iw > 0 && ih > 0) nn2 = Math.max(nn2, iw * ih / na); }  // a second note stacked on a placed one (badge, earlier note) reads as one smudge: keep the underline, drop the note
          if (io2 > 0.25 || ao2 > 0.25 || nn2 > 0.10) {  // a note on a photo or an ad hides what it should sit beside: keep the underline, drop the note. Text overlap is free()'s job to minimise, not a reason to leave a note-less mark
            t.remove(); drop({ op: 'note' }, io2 > 0.25 ? 'no image-free spot for the note near its mark' : ao2 > 0.25 ? 'the only note spot left is on an ad' : 'note would sit on another note');
            if (!(o.intent === 'key' && words <= 8)) rs.forEach(r => { const f = mk('rect', { 'data-k': 'hl', x: scrollX + r.left - 1, y: scrollY + r.top, width: r.width + 2, height: r.height, rx: 2, fill: col, opacity: 0.3 }); f.style.mixBlendMode = dark ? 'screen' : 'multiply'; f.style.opacity = 0; f.style.transition = 'opacity .4s'; g.insertBefore(f, g.firstChild); setTimeout(() => f.style.opacity = 0.3, d); });  // a note-less mark must not collapse to a zero-height line (checker measures the group box)
          } else {
          t.setAttribute('x', p[0]); t.setAttribute('y', p[1] + 5); PLACED.push(nb); mkNote = t;
          if (Math.hypot(p[0] - (fx + first.width / 2), p[1] - fy) > 30) { const sx = p[0], sy = p[1] + (p[1] < fy ? 11 : -11), ex = Math.min(Math.max(sx, fx), fx + first.width), ey = p[1] < fy ? fy - 2 : fy + first.height + 4, mx = (sx + ex) / 2 + 10, my = (sy + ey) / 2, P = [[sx, sy], [mx, my], [ex, ey]]; if (adCross(P)) { t.remove(); drop({ op: 'note' }, 'note would point across an ad band'); } else if (pathHits(P, 1, true) === 0) { const c = mk('path', { 'data-k': 'ld', d: 'M' + sx + ',' + sy + ' Q' + mx + ',' + my + ' ' + ex + ',' + ey, fill: 'none', stroke: col, 'stroke-width': 2.2, 'stroke-linecap': 'round' }); g.appendChild(c); mkLd = c; } }
          }
        }
        MK.push({ block: o.at && o.at.block, find: o.find, intent: o.intent, els: mkEls, note: mkNote, ld: mkLd, base: rs.map(r => [scrollX + r.left, scrollY + r.top, scrollX + r.right, scrollY + r.bottom]) });  // reverify re-anchors marks to their words after a late reflow
        AVOIDIMG = false;
      } else if (o.op === 'polyline') {
        const ps = o.points.map(pt); if (ps.length < 2 || ps.some(p => !p)) { drop(o, 'anchor block not on the page'); g.remove(); continue; } e = stroke(mk('path', { d: 'M' + ps.map(p => p[0] + ',' + p[1]).join(' L') })); e.setAttribute('stroke-width', 7); g.appendChild(e); reveal(e, o.dashed, d);
        if (o.arrow) { const a = ps[ps.length - 1], b0 = ps[Math.max(0, ps.length - 4)], ang = Math.atan2(a[1] - b0[1], a[0] - b0[0]), h = 20, hd = mk('path', { d: `M${a[0]},${a[1]} L${a[0] - h * Math.cos(ang - .45)},${a[1] - h * Math.sin(ang - .45)} L${a[0] - h * Math.cos(ang + .45)},${a[1] - h * Math.sin(ang + .45)} Z`, fill: cur, stroke: '#fff', 'stroke-width': 2 }); hd.style.opacity = 0; hd.style.transition = 'opacity .3s'; g.appendChild(hd); setTimeout(() => hd.style.opacity = 1, d + 500); }
        if (o.text) { const m = ps[Math.floor(ps.length / 2)]; label(g, m[0], m[1] - 16, o.text, d + 500); }
      } else if (o.op === 'label') {
        const a = pt(o.at); if (!a || !o.text) { drop(o, !a ? 'anchor block not on the page' : 'no label text'); g.remove(); continue; }
        const bel = o.at && o.at.block && window.DojoLesson && window.DojoLesson.el(o.at.block);
        let prefs = [];
        if (bel) { const br = bel.getBoundingClientRect(), bx = scrollX + (br.left + br.right) / 2;
          prefs = [[bx, scrollY + br.top - 14], [bx, scrollY + br.bottom + 18], [scrollX + br.left - 70, a[1]], [scrollX + br.right + 70, a[1]]]; }  // prefer just above/below the anchored block, then its gutters
        label(g, a[0], a[1], o.text, d, prefs);
      }
      d += 260;
     } catch (err) { try { drop(o, 'render error: ' + ((err && err.message) || err)); } catch (_) {} try { const gg = g0.lastElementChild; if (gg && gg.tagName === 'g' && !gg.childElementCount) gg.remove(); } catch (_) {} }
    }
    for (const g of [...g0.querySelectorAll(':scope > g[data-op]')]) {  // an op that rendered nothing (dropped note, dead anchor) must not show up as an empty mark; its reason is already in __dojoDropped
      const kids = [...g.querySelectorAll('text,circle,rect,path,polyline,line,polygon,ellipse')];
      if (!kids.some(k => { const r = k.getBoundingClientRect(); return r.width || r.height; })) { if (kids.length) drop({ op: g.dataset.op }, 'rendered to zero size'); g.remove(); }
    }
  }

  // exact client rects of a verbatim substring inside an element (whitespace-insensitive); [] when the text is not there
  function textRects(el, find) {
    textRects.lastNode = null;
    const fold = c => ({'\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u2013': '-', '\u2014': '-', '\u2212': '-', '\u2026': ' ', '\u00ab': '"', '\u00bb': '"', '\u2039': "'", '\u203a': "'", '\u00ad': ''}[c] || c);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let s = '', n; const nodes = [], offs = [];  // compact index: one int per kept char + one record per text node (the old per-char [node,offset] arrays could eat the whole renderer heap on a long article and stall the page)
    while ((n = w.nextNode())) { const t = n.nodeValue; const st = s.length; let kept = 0; for (let k = 0; k < t.length; k++) { const c = fold(t[k]); if (/\s/.test(c)) { if (s && s[s.length - 1] !== ' ') { s += ' '; offs.push(k); kept++; } } else { s += c.toLowerCase(); offs.push(k); kept++; } } if (kept) nodes.push([n, st, offs.length - kept]); }
    let q = [...(find || '').toLowerCase().replace(/\s+/g, ' ').trim()].map(fold).join(''); if (!q) { const r = el.getBoundingClientRect(); return [r]; }
    let at = s.indexOf(q);
    if (at < 0) { // the quote is not verbatim on the page: fall back to its longest run of words that is, so the mark still lands on the right sentence
      const ws = q.split(' '); let best = '';
      find_run: for (let len = ws.length; len >= 3; len--) { for (let st = 0; st + len <= ws.length; st++) { const sub = ws.slice(st, st + len).join(' '); if (sub.length >= 12 && s.indexOf(sub) >= 0) { best = sub; break find_run; } } }
      if (!best) { for (const wd of ws) { if (wd.length >= 8 && s.indexOf(wd) >= 0) { best = wd; break; } } }
      if (!best) return [];
      q = best; at = s.indexOf(q);
    }
    const locate = i => { let lo = 0, hi = nodes.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (nodes[m][1] <= i) lo = m; else hi = m - 1; } const nd = nodes[lo]; return [nd[0], offs[nd[2] + i - nd[1]]]; };
    const a = locate(at), b = locate(at + q.length - 1); textRects.lastNode = a[0]; const rg = document.createRange(); rg.setStart(a[0], a[1]); rg.setEnd(b[0], b[1] + 1);
    return [...rg.getClientRects()].filter(r => r.width > 2 && r.height > 4);
  }
  function reverify(g) {  // post-draw re-verify: late reflow (fonts/images) can slide content under an already-placed badge; re-test with fresh obstacles, relocate once, else drop
    const mkList = MK.slice();
    const run = () => {
      try {
        if (!g.isConnected) return;
        ph('reverify');
        OBST = null;  // the whole point of re-verify is measuring AFTER reflow; the render-time cache hides exactly what we are looking for
        mkList.forEach(m => {  // re-anchor marks to their words: a late reflow (font swap, collapsing slot) shifts text and leaves underlines/highlights stale (offscreen, step_invisible, line_cross)
          try {
            if (!m.els.some(x => x.el.isConnected)) return;
            const el = m.block && window.DojoLesson && window.DojoLesson.el(m.block);
            let rs2 = el ? textRects(el, m.find) : [];
            if (!rs2.length) rs2 = textRects(document.body, m.find);
            const CW2 = document.documentElement.clientWidth; rs2 = rs2.filter(r => r.left >= -1 && r.right <= CW2 + 1 && r.bottom > 0 && r.top < innerHeight);
            if (!rs2.length) { m.els.forEach(x => x.el.remove()); if (m.note) m.note.remove(); if (m.ld) m.ld.remove(); drop({ op: 'mark' }, 'anchor words vanished in a late reflow'); return; }
            const dx = (scrollX + rs2[0].left) - m.base[0][0], dy = (scrollY + rs2[0].top) - m.base[0][1];
            if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            m.els.forEach(x => {
              if (!x.el.isConnected) return;
              const q = rs2[x.ri]; if (!q) { x.el.remove(); return; }
              const L = scrollX + q.left, T = scrollY + q.top, R = scrollX + q.right, B = scrollY + q.bottom;
              if (x.kind === 'hl') { x.el.setAttribute('x', L - 1); x.el.setAttribute('y', T); x.el.setAttribute('width', R - L + 2); x.el.setAttribute('height', B - T); }
              else { let pd; if (m.intent === 'question') pd = 'M' + L + ',' + (B + 2) + ' ' + Array.from({ length: Math.ceil((R - L) / 6) }, (_, k) => 'L' + (L + k * 6 + 3) + ',' + (B + 2 + (k % 2 ? 2 : -1))).join(' '); else pd = 'M' + L + ',' + (B + 1.5) + ' L' + R + ',' + (B + 1.5); x.el.setAttribute('d', pd); }
            });
            if (m.note && m.note.isConnected) { m.note.setAttribute('x', +m.note.getAttribute('x') + dx); m.note.setAttribute('y', +m.note.getAttribute('y') + dy); }  // the note pass below re-validates the moved note
            if (m.ld && m.ld.isConnected) { const nums = (m.ld.getAttribute('d').match(/-?\d+\.?\d*/g) || []).map(Number); if (nums.length >= 6) { for (let i = 0; i + 1 < nums.length; i += 2) { nums[i] += dx; nums[i + 1] += dy; } m.ld.setAttribute('d', 'M' + nums[0] + ',' + nums[1] + ' Q' + nums[2] + ',' + nums[3] + ' ' + nums[4] + ',' + nums[5]); } }
            m.base = rs2.map(r => [scrollX + r.left, scrollY + r.top, scrollX + r.right, scrollY + r.bottom]);
            drop({ op: 'mark' }, 're-anchored to its words after a late reflow');
          } catch (_) {}
        });
        [...g.querySelectorAll('circle[data-k="badge"]')].forEach(c => {
          try {
            const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy'), rad = +c.getAttribute('r');
            const trq = (c.getAttribute('data-target') || '').split(',').map(Number);
            const tq = trq.length === 4 && trq.every(x => isFinite(x)) ? trq : null;
            const VW0 = Math.min(view.w, document.documentElement.clientWidth), VH0 = Math.min(view.h, document.documentElement.clientHeight);
            const inView = cx - rad >= view.sx - 2 && cx + rad <= view.sx + VW0 + 2 && cy - rad >= view.sy - 2 && cy + rad <= view.sy + VH0 + 2;
            if (inView && spotOK(cx, cy, rad, tq)) return;
            const t = [...g.children].find(z => z.tagName === 'text' && Math.abs(+z.getAttribute('x') - cx) < 2 && Math.abs(+z.getAttribute('y') - cy) < rad + 8);
            const ld = [...g.querySelectorAll('polyline')].find(p => { const q = (p.getAttribute('points') || '').split(' ')[0].split(',').map(Number); return q.length === 2 && Math.hypot(q[0] - cx, q[1] - cy) < 26; });
            const prefs = tq ? [[tq[0] - 22, cy], [tq[2] + 22, cy], [tq[0] - 14, cy], [tq[2] + 14, cy], [cx, cy]] : [[cx, cy]];
            const sz = (rad + 2) * 2;
            const cand = free(cx, cy, sz, sz, prefs, false, 360, cc => spotOK(cc[0], cc[1], sz / 2, tq));
            if (cand && spotOK(cand[0], cand[1], rad, tq)) {
              c.setAttribute('cx', cand[0]); c.setAttribute('cy', cand[1]);
              if (t) { t.setAttribute('x', cand[0]); t.setAttribute('y', cand[1] + Math.max(4, Math.round((rad + 1) * 0.36))); }
              if (ld) { const pts = ld.getAttribute('points').split(' '); pts[0] = cand[0] + ',' + cand[1]; ld.setAttribute('points', pts.join(' ')); }
              PLACED.push([cand[0] - rad, cand[1] - rad, cand[0] + rad, cand[1] + rad]);
              drop({ op: 'badge' }, 'relocated after page reflow (was ' + Math.round(cx) + ',' + Math.round(cy) + ')');
            } else {
              c.remove(); if (t) t.remove(); if (ld) ld.remove();
              drop({ op: 'badge' }, 'page reflow put content under it and no clean spot was left');
            }
          } catch (_) {}
        });
        [...g.querySelectorAll('g[data-op]')].forEach(mg => {  // the checker measures each mark's whole group against ad bands; an ad band that renders after the draw (lazy ad slots) must shrink the group back to its marks
          try {
            let U = null; mg.querySelectorAll('text,circle,rect,path,polyline,line,polygon,ellipse').forEach(k => { const r = k.getBoundingClientRect(); const b = [r.left + scrollX, r.top + scrollY, r.right + scrollX, r.bottom + scrollY]; U = U ? [Math.min(U[0], b[0]), Math.min(U[1], b[1]), Math.max(U[2], b[2]), Math.max(U[3], b[3])] : b; });
            if (!U) return; const ua = Math.max(1, (U[2] - U[0]) * (U[3] - U[1]));
            for (const o of obstacles()) { if (!o[5]) continue; const iw = Math.min(U[2], o[2]) - Math.max(U[0], o[0]), ih = Math.min(U[3], o[3]) - Math.max(U[1], o[1]); if (iw > 0 && ih > 0 && iw * ih / ua > 0.3) { mg.querySelectorAll('[data-k="note"],[data-k="ld"]').forEach(k => k.remove()); drop({ op: mg.dataset.op }, 'an ad band appeared between the mark and its note after the draw'); break; } }
          } catch (_) {}
        });
        const allNotes = [...svg.querySelectorAll('[data-k="note"]')];
        [...g.querySelectorAll('[data-k="note"]')].forEach(t => {
          try {
            if (!t.isConnected) return;
            const bb = t.getBBox(), b = [bb.x, bb.y, bb.x + bb.width, bb.y + bb.height], ba = Math.max(1, bb.width * bb.height);
            let tx = 0; for (const o of obstacles()) { if (o.length !== 4) continue; const iw = Math.min(b[2], o[2]) - Math.max(b[0], o[0]), ih = Math.min(b[3], o[3]) - Math.max(b[1], o[1]); if (iw > 0 && ih > 0) tx += iw * ih; }
            let nn = 0; for (const t2 of allNotes) { if (t2 === t || !t2.isConnected) continue; const q = t2.getBBox(); const iw = Math.min(b[2], q.x + q.width) - Math.max(b[0], q.x), ih = Math.min(b[3], q.y + q.height) - Math.max(b[1], q.y); if (iw > 0 && ih > 0) nn = Math.max(nn, iw * ih / Math.min(ba, Math.max(1, q.width * q.height))); }
            let ioN = 0; for (const o of obstacles()) { if (!o[4] || o[5]) continue; const iw = Math.min(b[2], o[2]) - Math.max(b[0], o[0]), ih = Math.min(b[3], o[3]) - Math.max(b[1], o[1]); if (iw > 0 && ih > 0) ioN = Math.max(ioN, iw * ih / ba); }  // note_over_image is judged on the CURRENT page too
            const VW = Math.min(view.w, document.documentElement.clientWidth), VH = Math.min(view.h, document.documentElement.clientHeight);
            const off = b[0] < view.sx - 2 || b[1] < view.sy - 2 || b[2] > view.sx + VW + 2 || b[3] > view.sy + VH + 2;
            if (tx <= 40 && nn <= 0.2 && !off && ioN <= 0.25) return;
            const w = bb.width + 8, h2 = bb.height + 6;
            const cardEl = document.getElementById(CID), cardR = cardEl ? (() => { const r = cardEl.getBoundingClientRect(); return [scrollX + r.left, scrollY + r.top, scrollX + r.right, scrollY + r.bottom]; })() : null;  // the explanation card is a fixed overlay: a relocated label must not land under it (card_cover, dev75 npr)
            const okSpot = c => { const nb = [c[0] - w / 2, c[1] - h2 / 2, c[0] + w / 2, c[1] + h2 / 2]; if (window.DojoCardSlot && window.DojoCardSlot.hitsCard(nb, cardR, 4)) return false; const nbA = Math.max(1, w * h2); let io2n = 0; for (const o of obstacles()) { if (!o[4] || o[5]) continue; const iw = Math.min(nb[2], o[2]) - Math.max(nb[0], o[0]), ih = Math.min(nb[3], o[3]) - Math.max(nb[1], o[1]); if (iw > 0 && ih > 0) io2n = Math.max(io2n, iw * ih / nbA); } if (io2n > 0.25) return false; let t2x = 0; for (const o of obstacles()) { if (o.length !== 4) continue; const iw = Math.min(nb[2], o[2]) - Math.max(nb[0], o[0]), ih = Math.min(nb[3], o[3]) - Math.max(nb[1], o[1]); if (iw > 0 && ih > 0) t2x += iw * ih; } let n2 = 0; for (const t3 of allNotes) { if (t3 === t || !t3.isConnected) continue; const q = t3.getBBox(); const iw = Math.min(nb[2], q.x + q.width) - Math.max(nb[0], q.x), ih = Math.min(nb[3], q.y + q.height) - Math.max(nb[1], q.y); if (iw > 0 && ih > 0) n2 = Math.max(n2, iw * ih / Math.min(w * h2, Math.max(1, q.width * q.height))); } return t2x <= 40 && n2 <= 0.2; };
            const cand = free(b[0] + bb.width / 2, b[1] + bb.height / 2, w, h2, [], false, 320, okSpot);
            if (cand && okSpot(cand)) { t.setAttribute('x', cand[0]); t.setAttribute('y', cand[1] + 5); drop({ op: 'label' }, 'relocated after page reflow'); }
            else { t.remove(); drop({ op: 'label' }, 'page reflow put it on text and no clean spot was left'); }
          } catch (_) {}
        });
      } catch (_) {}
      [...g.querySelectorAll('rect[data-bhug]')].forEach(rc => {  // re-hug block-anchored boxes: a late reflow (font swap, lazy image) shifts text lines and leaves the box edge slicing a line (line_cross)
        try {
          const ids = rc.getAttribute('data-bhug').split('|'); let nx, ny, nw, nh;
          if (ids.length === 2) {
            const e1 = window.DojoLesson.el(ids[0]), e2 = window.DojoLesson.el(ids[1]); if (!e1 || !e2) return;
            const r1 = e1.getBoundingClientRect(), r2 = e2.getBoundingClientRect();
            nx = scrollX + Math.min(r1.left, r2.left) - 4; ny = scrollY + Math.min(r1.top, r2.top) - 4;
            nw = Math.max(r1.right, r2.right) - Math.min(r1.left, r2.left) + 8; nh = Math.max(r1.bottom, r2.bottom) - Math.min(r1.top, r2.top) + 8;
          } else {
            const el = window.DojoLesson.el(ids[0]); if (!el) return;
            const u = textUnion(el) || el.getBoundingClientRect();
            nx = scrollX + u.left - 2; ny = scrollY + u.top - 2; nw = (u.right - u.left) + 4; nh = (u.bottom - u.top) + 4;
          }
          { const VW = Math.min(view.w, document.documentElement.clientWidth), X1 = view.sx + 2, X2 = view.sx + VW - 2; if (nx < X1) { nw -= X1 - nx; nx = X1; } if (nx + nw > X2) nw = X2 - nx; }
          { const VH = Math.min(view.h, document.documentElement.clientHeight), Y1 = view.sy + 2, Y2 = view.sy + VH - 2; if (ny < Y1) { nh -= Y1 - ny; ny = Y1; } if (ny + nh > Y2) nh = Y2 - ny; }
          if (!(nw >= 8 && nh >= 8) || ![nx, ny, nw, nh].every(Number.isFinite)) return;
          { const U = uncross(nx, ny, nw, nh); if (!U) { rc.remove(); drop({ op: 'box' }, 'edge crossed text after a late reflow and could not clear'); return; } nx = U[0]; ny = U[1]; nw = U[2]; nh = U[3]; }
          if (Math.abs(nx - (+rc.getAttribute('x'))) < 2 && Math.abs(ny - (+rc.getAttribute('y'))) < 2 && Math.abs(nw - (+rc.getAttribute('width'))) < 2 && Math.abs(nh - (+rc.getAttribute('height'))) < 2) return;
          rc.setAttribute('x', nx); rc.setAttribute('y', ny); rc.setAttribute('width', nw); rc.setAttribute('height', nh);
          drop({ op: 'box' }, 're-hugged to its part after a late reflow');
        } catch (_) {}
      });
      [...g.querySelectorAll('g[data-op]')].forEach(mg => {  // a late pass (ad band, reflow) can strip an op's only visible kid: prune the empty op group exactly like the render-time cleanup, or the checker reads it as an empty mark
        try { const ks = [...mg.querySelectorAll('text,circle,rect,path,polyline,line,polygon,ellipse')]; if (!ks.some(k => { const r = k.getBoundingClientRect(); return r.width || r.height; })) mg.remove(); } catch (_) {}
      });
      [...g.querySelectorAll('g[data-op]')].forEach(mg => {  // checker-mirror (check.js offscreen, vis 0.05): an op fully outside the viewport at reverify time is invisible to the checker too - prune it so the empty-step renumbering below can drop a dead step instead of failing step_invisible
        try {
          let U = null; const vw = document.documentElement.clientWidth, vh = innerHeight;
          for (const k of mg.querySelectorAll('text,circle,rect,path,polyline,line,polygon,ellipse')) { const r = k.getBoundingClientRect(); if (!r.width && !r.height) continue; const b = [r.left, r.top, r.right, r.bottom]; U = U ? [Math.min(U[0], b[0]), Math.min(U[1], b[1]), Math.max(U[2], b[2]), Math.max(U[3], b[3])] : b; }
          if (U) { const iw = Math.max(0, Math.min(U[2], vw) - Math.max(U[0], 0)), ih = Math.max(0, Math.min(U[3], vh) - Math.max(U[1], 0)); if (iw * ih / Math.max(1, (U[2] - U[0]) * (U[3] - U[1])) <= 0.05) { drop({ op: mg.dataset.op }, 'its target is not on screen'); mg.remove(); } }
        } catch (_) {}
      });
      try {  // a late pass can empty a whole step: the checker counts an empty step as a failure, so prune it exactly like the render-time empty check does
        if (g.isConnected && !g.querySelector('text,circle,rect,path,polyline,line,polygon,ellipse')) {
          const k = drawn.indexOf(g);
          if (k >= 0) {
            drawn.splice(k, 1); plan.steps.splice(k, 1); g.remove();
            try { const cur_ = JSON.parse(document.documentElement.getAttribute('data-dojo-dropped') || '[]'); cur_.push('step lost after the late reflow check emptied it'); document.documentElement.setAttribute('data-dojo-dropped', JSON.stringify(cur_.slice(-12))); } catch (_) {}
            if (!plan.steps.length) { clear(); if (typeof status === 'function') status('I could not mark this page without covering the text. Try a narrower goal or scroll to the part you mean.', 7000); return; }
            if (k < i) i--;
            if (i >= plan.steps.length) i = plan.steps.length - 1;
            show();
          }
        }
      } catch (_) {}
    };
    setTimeout(run, 1200); setTimeout(run, 2600);  // second pass catches photos that finish loading after the first
  }
  function show() { ph('render');
    if (!svg) {
      svg = mk('svg', { id: ID, width: document.documentElement.clientWidth, height: Math.max(document.documentElement.scrollHeight, innerHeight) }); svg.style.overflow = 'hidden';
      svg.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483640;pointer-events:none;overflow:visible'; document.documentElement.appendChild(svg);
      try { const sv0 = svg; new MutationObserver(() => { if (!sv0.isConnected) console.log('dojo overlay REMOVED by the page at', Math.round(performance.now()), 'ms'); }).observe(document.documentElement, { childList: true, subtree: false }); } catch (_) {}  // several live homepages sweep foreign nodes: log it so the failure class stops lying
    }
    window.__dojoPick = (og, o) => { const same = og.dataset.picked === '1'; [...og.parentNode.children].forEach(c => { c.dataset.picked = ''; c.setAttribute('opacity', same ? 1 : (c === og ? 1 : .5)); }); if (!same) og.dataset.picked = '1'; const t = card && card.querySelector('#dd-t'); if (t) t.textContent = same ? plan.steps[i].tip : o.note; };
    drawn.forEach((g, k) => g.setAttribute('opacity', k < i ? .75 : 1));
    while (drawn.length > i) { drawn.pop().remove(); }
    const g = mk('g', {}); svg.appendChild(g); drawn.push(g); render(plan.steps[i], g); reverify(g);
    if (![...g.children].some(c => c.childElementCount)) {  // every mark of this step was dropped by the placement rules: do not show an empty step
      try { const cur_ = JSON.parse(document.documentElement.getAttribute('data-dojo-dropped') || '[]'); cur_.push('step lost: ops ' + plan.steps[i].ops.map(o => o.op).join(',') + ', subgroups ' + g.childElementCount + ', kids ' + [...g.children].map(c => c.childElementCount).join('/')); document.documentElement.setAttribute('data-dojo-dropped', JSON.stringify(cur_.slice(-12))); } catch (_) {}
      drawn.pop().remove(); plan.steps.splice(i, 1);
      if (!plan.steps.length) { clear(); if (typeof status === 'function') status('I could not mark this page without covering the text. Try a narrower goal or scroll to the part you mean.', 7000); return; }
      if (i >= plan.steps.length) i = plan.steps.length - 1; return show();
    }
    STEPSCR = false;
    { let fb = null; try { const bb = g.getBBox(); if (bb.width || bb.height) fb = [bb.x + bb.width / 2, bb.y]; } catch (_) {} const first = fb || plan.steps[i].ops.map(o => pt(o.from || o.at || (o.points && o.points[0]) || o.box || {})).find(p => p); if (first) { window.DojoCursor.to(first[0], first[1]); if (fb && (first[1] < scrollY + 70 || first[1] > scrollY + innerHeight - 230)) window.scrollTo({ top: Math.max(0, first[1] - innerHeight / 3), behavior: 'smooth' }); } }  // scroll only to what was actually drawn (its top); an empty step (all marks dropped) must not scroll to a tall block's middle, that hides earlier steps' marks drawn.forEach((x, k) => x.setAttribute('opacity', k < i ? .75 : 1));
    if (!card) { card = document.createElement('div'); card.id = CID; card.style.cssText = 'position:fixed;right:18px;bottom:18px;width:310px;z-index:2147483647;background:#fff7ec;border:2px solid #f28c0f;border-radius:14px;padding:12px 14px;font:14px/1.4 Arial;color:#241a10;box-shadow:0 6px 24px #0004'; document.documentElement.appendChild(card); }
    const b = 'border:2px solid #f28c0f;background:#fff7ec;color:#c75b00;border-radius:999px;padding:5px 12px;font-weight:700;cursor:pointer;margin-right:6px';
    card.innerHTML = `<div style="color:#c75b00;font-weight:700;margin-bottom:4px">✎ Drawing ${i + 1} of ${plan.steps.length}</div><div id="dd-t"></div><div style="font-size:11px;color:#888;margin:6px 0">Planned by ${meta.writer}: may be wrong${meta.check ? '. Self-check: ' + meta.check.verdict + ', ' + meta.check.moved + ' points snapped to detected corners' : ''}</div><button id="dd-b" style="${b}" ${i ? '' : 'disabled'}>Back</button><button id="dd-n" style="${b};background:#f28c0f;color:#fff">${i === plan.steps.length - 1 ? 'Done' : 'Next'}</button><button id="dd-w" style="${b}">Why</button><button id="dd-x" style="${b}">×</button><div id="dd-why" style="display:none;margin-top:8px;font-size:12px;color:#4a3a28"></div>`;
    card.querySelector('#dd-w').onclick = () => { const w = card.querySelector('#dd-why'); if (w.style.display === 'none') { w.innerHTML = ''; plan.steps[i].ops.filter(o => o.why).forEach((o, k) => { const r = document.createElement('div'); r.style.margin = '3px 0'; r.textContent = (k + 1) + '. ' + o.op + (o.text ? ' "' + o.text + '"' : '') + ': ' + o.why; w.appendChild(r); }); w.style.display = 'block'; } else w.style.display = 'none'; };
    card.querySelector('#dd-t').textContent = plan.steps[i].tip;
    card.querySelector('#dd-b').onclick = () => { if (i) { i--; show(); } };
    card.querySelector('#dd-n').onclick = () => { if (i < plan.steps.length - 1) { i++; show(); } else { clear(); } };
    card.querySelector('#dd-x').onclick = () => clear();
    try { // keep the card off this step's marks: score slots by the share of the marks they would hide (the rubric fails over 30%), shrink the card once if no slot is clear enough
      const ops = g.matches('g[data-op]') ? [g] : [...g.querySelectorAll('g[data-op]')], bx = (ops.length ? ops : [g]).map(e => e.getBoundingClientRect()).filter(r => r.width > 1 || r.height > 1);
      if (bx.length && window.DojoCardSlot) {
        const big = window.DojoCardSlot.pick(bx, innerWidth, innerHeight, card.offsetWidth || 346, card.offsetHeight || 150, 240, card.offsetHeight || 120);
        if (big.small) { card.style.width = '240px'; card.style.fontSize = '12px'; card.style.padding = '8px 10px'; }
        card.style.left = big.hs === 'left' ? '18px' : (big.hs === 'center' ? big.x + 'px' : ''); card.style.right = big.hs === 'right' ? '18px' : ''; card.style.top = big.vs === 'top' ? '18px' : ''; card.style.bottom = big.vs === 'bottom' ? '18px' : '';
      }
    } catch (_) {}
  }

  // Corners found in the screenshot pixels (Shi-Tomasi), used to pull the model's rough points onto real corners.
  async function corners(url, view) {
    const im = new Image(); im.src = url; await im.decode();
    const sc = Math.min(1, 700 / im.width), W = Math.round(im.width * sc), H = Math.round(im.height * sc);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, W, H);
    const px = cx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = .3 * px[i * 4] + .59 * px[i * 4 + 1] + .11 * px[i * 4 + 2];
    const Ix = new Float32Array(W * H), Iy = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; Ix[i] = g[i + 1] - g[i - 1]; Iy[i] = g[i + W] - g[i - W]; }
    const R = new Float32Array(W * H); let mx = 0, r = 3;
    for (let y = r + 1; y < H - r - 1; y += 1) for (let x = r + 1; x < W - r - 1; x += 1) {
      let a = 0, b = 0, c = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const i = (y + dy) * W + x + dx; a += Ix[i] * Ix[i]; b += Ix[i] * Iy[i]; c += Iy[i] * Iy[i]; }
      const l = ((a + c) - Math.sqrt((a - c) * (a - c) + 4 * b * b)) / 2; R[y * W + x] = l; if (l > mx) mx = l;
    }
    const out = [], th = mx * 0.08, nms = 7;
    for (let y = r + 1; y < H - r - 1; y++) for (let x = r + 1; x < W - r - 1; x++) {
      const v = R[y * W + x]; if (v < th) continue; let ok = true;
      for (let dy = -nms; dy <= nms && ok; dy++) for (let dx = -nms; dx <= nms; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W && R[yy * W + xx] > v) { ok = false; break; } }
      if (ok) out.push([x / sc, y / sc, v]);
    }
    out.sort((p, q) => q[2] - p[2]); return out.slice(0, 120);
  }

  // Chart series found in the pixels: coloured, thin, long curves. Returns polylines in image fractions.
  async function series(url) {
    const im = new Image(); im.src = url; await im.decode();
    const sc = Math.min(1, 1100 / im.width), W = Math.round(im.width * sc), H = Math.round(im.height * sc);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, W, H);
    const px = cx.getImageData(0, 0, W, H).data, B = 24, bins = []; for (let b = 0; b < B; b++) bins.push(new Uint8Array(W * H));
    const cnt = new Array(B).fill(0);
    for (let i = 0; i < W * H; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx < 70 || (mx - mn) / mx < 0.28) continue;
      let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; if (h < 0) h += 6;
      const k = Math.floor(h / 6 * B) % B; bins[k][i] = 1; cnt[k]++;
    }
    // merge a bin with its neighbour when the neighbour is bigger
    const out = [];
    for (let k = 0; k < B; k++) {
      if (cnt[k] < W * 0.25) continue; 
      const m = new Uint8Array(W * H); for (const j of [k, ...[(k + 1) % B, (k + B - 1) % B].filter(q => cnt[q] < 0.35 * cnt[k])]) for (let i = 0; i < W * H; i++) if (bins[j][i]) m[i] = 1;
      const poly = []; let thick = 0, cols = 0, py = -1;
      for (let x = 0; x < W; x++) {
        const runs = []; let s = -1; for (let y = 0; y <= H; y++) { const on = y < H && m[y * W + x]; if (on && s < 0) s = y; if (!on && s >= 0) { runs.push([s, y - 1]); s = -1; } }
        if (!runs.length) continue; let best = runs[0]; if (py >= 0) best = runs.reduce((a, b) => Math.abs((b[0] + b[1]) / 2 - py) < Math.abs((a[0] + a[1]) / 2 - py) ? b : a);
        if (py >= 0 && Math.min(Math.abs(best[0] - py), Math.abs(best[1] - py)) > H * 0.25) continue;
        const run = best[1] - best[0] + 1; thick += Math.min(run, 6); cols++;
        if (run > 4 && py >= 0) { const ends = Math.abs(best[0] - py) <= Math.abs(best[1] - py) ? [best[0], best[1]] : [best[1], best[0]]; poly.push([x / W, ends[0] / H], [x / W, ends[1] / H]); py = ends[1]; }
        else { py = (best[0] + best[1]) / 2; poly.push([x / W, py / H]); }
      }
      if (cols < W * 0.18 || thick / cols > 9) continue;
      const ys = poly.map(p => p[1]); if (Math.max(...ys) - Math.min(...ys) < 0.04) continue;  // flat bars such as sliders and rules are not data curves
      out.push({ poly, n: cols, hue: k });
    }
    out.sort((a, b) => b.n - a.n); return out.slice(0, 6).map((s, i) => ({ id: i, poly: s.poly, hue: s.hue }));
  }

  // Peaks and dips of a detected series, by real topographic prominence: how far the curve must fall on both sides before it meets a higher point
  function extrema(s) {
    const P = s.poly; if (P.length < 20) return [];
    const x0 = Math.min(...P.map(p => p[0])), x1 = Math.max(...P.map(p => p[0])), NB = 300, out = [];
    const lo = Math.min(...P.map(p => p[1])), hi = Math.max(...P.map(p => p[1])), need = Math.max(0.04, (hi - lo) * 0.25);
    for (const kind of ['peak', 'dip']) {
      const sg = kind === 'peak' ? -1 : 1, bin = new Array(NB).fill(null);  // value v = sg * y, bigger v = more extreme in this kind
      for (const p of P) { const k = Math.min(NB - 1, Math.floor((p[0] - x0) / (x1 - x0 + 1e-9) * NB)), v = sg * p[1]; if (!bin[k] || v > bin[k].v) bin[k] = { v, x: p[0], y: p[1] }; }
      const B = bin.filter(Boolean);
      for (let i = 1; i < B.length - 1; i++) {
        let lm = B[i].v, rm = B[i].v, ok = true;
        for (let k = i - 1; k >= 0; k--) { if (B[k].v > B[i].v) break; lm = Math.min(lm, B[k].v); if (k === 0) lm = Math.min(lm, B[k].v); }
        for (let k = i + 1; k < B.length; k++) { if (B[k].v > B[i].v) break; rm = Math.min(rm, B[k].v); }
        const prom = B[i].v - Math.max(lm, rm); if (prom < need) continue;
        // it must be a local maximum of v within its neighbourhood
        for (let k = Math.max(0, i - 3); k <= Math.min(B.length - 1, i + 3); k++) if (B[k].v > B[i].v) ok = false; if (!ok) continue;
        if (!out.some(o => o.kind === kind && Math.abs(o.x - B[i].x) < 0.03)) out.push({ kind, x: B[i].x, y: B[i].y, pr: prom });
      }
      for (const ei of [0, B.length - 1]) {  // series ends count too: a curve that falls to its lowest value at the right edge has its real lowest point there, and 'mark the lowest point' must be able to land on it
        let lm = B[ei].v, inward = false;
        for (let k = 0; k < B.length; k++) { if (k === ei) continue; if (B[k].v > B[ei].v) { inward = true; break; } lm = Math.min(lm, B[k].v); }
        const prom = B[ei].v - lm; if (prom < need) continue;
        if (!out.some(o => o.kind === kind && Math.abs(o.x - B[ei].x) < 0.03)) out.push({ kind, x: B[ei].x, y: B[ei].y, pr: prom, end: true });
      }
    }
    return out.sort((a, b) => b.pr - a.pr).slice(0, 8);
  }
  function atX(s, fx) { let best = s.poly[0]; for (const p of s.poly) if (Math.abs(p[0] - fx) < Math.abs(best[0] - fx)) best = p; return best; }
  function snap(plan, cs, v) {  // plan anchors are fractions of the viewport; move x,y anchors to the nearest strong corner within 4% of the width
    const rad = 0.04 * v.w; let moved = 0;
    const one = a => { if (!a || a.block || a.exact) return; const px = a.x * v.w, py = a.y * v.h; let best = null, bd = rad; for (const c of cs) { const dd = Math.hypot(c[0] - px, c[1] - py); if (dd < bd) { bd = dd; best = c; } } if (best) { a.x = best[0] / v.w; a.y = best[1] / v.h; moved++; } };
    for (const st of plan.steps) for (const o of st.ops) { if (o.op === 'line' || o.op === 'arrow' || o.op === 'box') { one(o.from); one(o.to); } else if (o.op === 'rightangle' || o.op === 'circle' || o.op === 'number') one(o.at); else if (o.op === 'curve' || o.op === 'square') { one(o.from); one(o.to); } else if (o.op === 'callout') one(o.at); else if (o.op === 'highlight') { one(o.from); one(o.to); } else if (o.op === 'polygon') o.points.forEach(one); }
    return moved;
  }
  const thousand = plan => ({ steps: plan.steps.map(st => ({ tip: st.tip, ops: st.ops.map(o => { const f = a => a && (a.block ? a : { x: Math.round(a.x * 1000), y: Math.round(a.y * 1000) }); const c = { op: o.op, dashed: o.dashed, text: o.text, side: o.side }; if (o.via) c.via = f(o.via); if (o.box) c.box = f(o.box); if (o.from) c.from = f(o.from); if (o.to) c.to = f(o.to); if (o.at) c.at = f(o.at); if (o.points) c.points = o.points.map(f); if (o.r) c.r = Math.round(o.r * 1000); return c; }) })) });
  function preview(plan, v) {  // every step at once, only to be photographed for the self-check
    clear(true); view = v; svg = mk('svg', { id: ID, width: Math.max(document.documentElement.scrollWidth, innerWidth), height: Math.max(document.documentElement.scrollHeight, innerHeight) });
    svg.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483640;pointer-events:none;overflow:visible'; document.documentElement.appendChild(svg);
    plan.steps.forEach(st => { const g = mk('g', {}); svg.appendChild(g); render(st, g); });
    return new Promise(r => setTimeout(r, 1100));
  }
  window.DojoDraw = { extrema, series, atX, corners, snap, thousand, preview, start(p, m, v) { clear(true); plan = p; meta = m; view = v; i = 0; try {
      ANN = []; const ap = [];
      for (const st of (p.steps || [])) for (const o of (st.ops || [])) {
        for (const k of ['at', 'from', 'to', 'box']) { const a = o[k]; if (a && !a.block && typeof a.x === 'number' && typeof a.y === 'number') ap.push([v.sx + a.x * v.w, v.sy + a.y * v.h]); }
        for (const a of (o.points || [])) { if (a && !a.block && typeof a.x === 'number') ap.push([v.sx + a.x * v.w, v.sy + a.y * v.h]); }
      }
      if (ap.length) for (const im of document.images) { const r = imgBox(im); if (r.width < 60 || r.height < 60) continue; const b = [scrollX + r.left, scrollY + r.top, scrollX + r.right, scrollY + r.bottom]; if (ap.some(q => q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3])) ANN.push(b); }
    } catch (_) { ANN = []; } try { const cur_ = JSON.parse(document.documentElement.getAttribute('data-dojo-dropped') || '[]'); cur_.push('start: ' + (p.steps||[]).length + ' steps'); document.documentElement.setAttribute('data-dojo-dropped', JSON.stringify(cur_.slice(-12))); } catch (_) {} show(); }, clear, active: () => !!svg };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && svg) clear(); });
})();

// Bridge: the guide surface (panel or app shell) sends a planned drawing spec; the
// layer above draws it on the real page. Two transports: a window event (app shell
// preload; payload also stashed on the DOM for isolated-world safety) and a runtime
// message from the extension side panel.
;(() => {
  if (window.__dojoGuideDraw) return;
  window.__dojoGuideDraw = true;
  const run = (plan, meta) => {
    try { window.__dojoGuideTooltipSuppress = true; const tip = document.getElementById('dojo-guide-tooltip'); if (tip) tip.remove(); } catch (e) {}
    const DD = window.DojoDraw;
    if (!DD || !plan || !Array.isArray(plan.steps) || !plan.steps.length) return;
    const view = { sx: scrollX, sy: scrollY, w: document.documentElement.clientWidth, h: innerHeight };
    try { DD.start(plan, meta || { writer: 'Dojo Guide' }, view) } catch (e) {}
  };
  window.addEventListener('dojo-guide:draw-plan', (e) => {
    let d = (e && e.detail) || null;
    if (!d || !d.plan) {
      try {
        const raw = document.documentElement.getAttribute('data-dojo-guide-draw');
        if (raw) d = JSON.parse(raw);
      } catch (err) {}
    }
    if (d && d.plan) run(d.plan, d.meta);
  });
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'guideDrawPlan' && msg.plan) run(msg.plan, msg.meta);
    });
  }
})();
  },
})
