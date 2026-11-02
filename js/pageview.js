// 1 ページを出して、指で操作する画面（Android 版の PageView と同じ動き）。
// 道具: 選ぶ（動かす・2 本指で大きさと向き・角の丸で大きさと向き・何もない所からなぞって囲む）、手書き、線、矢印、文字
import { Item, PHOTO, TEXT, INK, LINE, snapAngle, css, setOutline, strokePath } from './model.js';
import { peekBitmap } from './render.js';
import { toast } from './ui.js';

export const SELECT = 0, PEN = 1, LINE_T = 2, ARROW = 3, TEXT_T = 4;
const G_NONE = 0, G_MOVE = 1, G_HANDLE = 2, G_P1 = 3, G_P2 = 4, G_PINCH = 5, G_DRAW = 6, G_LINE = 7,
  G_PAN = 9, G_ZOOM = 10, G_BAND = 11, G_GMOVE = 12, G_GHANDLE = 13, G_GPINCH = 14;
const ZOOM_MIN = 0.4, ZOOM_MAX = 8;
const BLUE = '#2F8FE0';

export class PageView {
  /** ls = { beforeChange, onChanged, onSelection(item), onGroup(items), onTextTap(item, px, py) } */
  constructor(canvas, ls) {
    this.cv = canvas;
    this.ls = ls;
    this.page = null;
    this.tool = SELECT;
    this.color = 0xFF222222 | 0;
    this.penW = 7; this.lineW = 9;
    this.outline = false;
    this.sel = null;
    this.group = [];
    this.viewMode = false;
    this.dp = 1; // CSS の px が、Android の dp にあたる
    this.k = 1; this.offX = 0; this.offY = 0; this.k0 = 1;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.pending = [];
    this.cur = [];
    this.g = G_NONE;
    this.ptrs = new Map(); // 指の id → {x, y}（canvas の中の CSS px）
    this.lastTapUp = 0; this.selTapUp = 0;
    this.textTapLater = 0;
    this.W = 0; this.H = 0;
    this.raf = 0;
    const on = (t, f) => canvas.addEventListener(t, f, { passive: false });
    on('pointerdown', e => this.pdown(e));
    on('pointermove', e => this.pmove(e));
    on('pointerup', e => this.pup(e, false));
    on('pointercancel', e => this.pup(e, true));
    on('touchstart', e => e.preventDefault()); // iPhone の画面ごとの拡大・スクロールをさせない
  }

  setPage(p) { this.page = p; this.sel = null; this.group = []; this.zoom = 1; this.panX = this.panY = 0; this.invalidate(); }

  /** canvas の大きさを、置き場所に合わせる */
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    this.W = r.width; this.H = r.height;
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.dpr = w / Math.max(1, r.width);
    this.invalidate();
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  fit() {
    if (!this.page || !this.W) return;
    const m = 10 * this.dp, W = this.W, H = this.H, p = this.page;
    this.k0 = Math.min((W - 2 * m) / p.pw, (H - 2 * m) / p.ph);
    this.k = this.k0 * this.zoom;
    const cx0 = (W - p.pw * this.k) / 2, cy0 = (H - p.ph * this.k) / 2;
    this.offX = Math.max(W / 2 - p.pw * this.k, Math.min(W / 2, cx0 + this.panX));
    this.offY = Math.max(H / 2 - p.ph * this.k, Math.min(H / 2, cy0 + this.panY));
    this.panX = this.offX - cx0;
    this.panY = this.offY - cy0;
  }

  resetZoom() { this.zoom = 1; this.panX = this.panY = 0; this.invalidate(); }

  fillZoom() {
    const m = 10 * this.dp;
    return Math.max((this.W - 2 * m) / this.page.pw, (this.H - 2 * m) / this.page.ph) / this.k0;
  }

  /** 「大きく」: 画面いっぱい ⇔ 全体。画面いっぱいにしたら true */
  toggleFill() {
    this.fit();
    const zf = this.fillZoom();
    if (zf <= 1.01 || (Math.abs(this.zoom - zf) < 0.01)) { this.resetZoom(); return false; }
    const m = 10 * this.dp, kk = this.k0 * zf, p = this.page;
    this.zoom = zf;
    this.panX = p.pw * kk > this.W - 2 * m ? m - (this.W - p.pw * kk) / 2 : 0;
    this.panY = p.ph * kk > this.H - 2 * m ? m - (this.H - p.ph * kk) / 2 : 0;
    this.invalidate();
    return true;
  }

  center() { return [this.page.pw / 2, this.page.ph / 2]; }

  // ---- 描く ----

  draw() {
    const c = this.cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#4A4452';
    c.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!this.page) return;
    this.fit();
    const p = this.page, k = this.k;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.translate(this.offX, this.offY);
    c.scale(k, k);
    c.fillStyle = 'rgba(0,0,0,0.33)';
    c.fillRect(6 / k, 8 / k, p.pw, p.ph);
    c.save();
    c.beginPath(); c.rect(0, 0, p.pw, p.ph); c.clip();
    const img = f => peekBitmap(f, () => this.invalidate());
    p.drawAll(c, img);
    // 書きかけの手書き
    const now = this.g === G_DRAW && this.cur.length ? this.cur : null;
    const all = now ? this.pending.concat([now]) : this.pending;
    if (all.length) {
      if (this.outline) { setOutline(c, this.color, this.penW); for (const st of all) strokePath(c, st); }
      c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = this.penW; c.strokeStyle = css(this.color);
      for (const st of all) strokePath(c, st);
    }
    if (this.g === G_LINE) this.lineItem().draw(c, null);
    c.restore();
    if (this.sel && p.items.includes(this.sel)) this.drawSelection(c);
    if (this.group.length) this.drawGroup(c);
    if (this.g === G_BAND) {
      const l = Math.min(this.bx0, this.bx1), t = Math.min(this.by0, this.by1), w = Math.abs(this.bx1 - this.bx0), h = Math.abs(this.by1 - this.by0);
      c.fillStyle = 'rgba(47,143,224,0.09)';
      c.fillRect(l, t, w, h);
      c.setLineDash([8 * this.dp / k, 5 * this.dp / k]);
      c.lineWidth = 2 * this.dp / k; c.strokeStyle = BLUE;
      c.strokeRect(l, t, w, h);
      c.setLineDash([]);
    }
  }

  polygon(c, pts) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }

  drawSelection(c) {
    const s = this.sel, k = this.k, dp = this.dp, hr = 13 * dp / k;
    if (s.type === LINE) { this.handle(c, s.x1, s.y1, hr, false); this.handle(c, s.x2, s.y2, hr, false); return; }
    c.lineWidth = 2.5 * dp / k; c.strokeStyle = BLUE;
    c.setLineDash([10 * dp / k, 6 * dp / k]);
    this.polygon(c, [s.corner(-1, -1), s.corner(1, -1), s.corner(1, 1), s.corner(-1, 1)]);
    c.stroke();
    c.setLineDash([]);
    const cc = s.corner(1, 1);
    this.handle(c, cc[0], cc[1], hr, true);
  }

  handle(c, x, y, r, mark) {
    const k = this.k, dp = this.dp;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = BLUE; c.fill();
    c.lineWidth = 2.5 * dp / k; c.strokeStyle = '#fff'; c.stroke();
    if (mark) {
      const u = r * 0.45;
      c.lineWidth = 2 * dp / k; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - u, y - u); c.lineTo(x + u, y + u); c.stroke();
    }
  }

  drawGroup(c) {
    const k = this.k, dp = this.dp;
    c.lineWidth = 1.5 * dp / k; c.strokeStyle = 'rgba(47,128,237,0.67)';
    for (const it of this.group) {
      if (it.type === LINE) { const b = it.bounds(); c.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }
      else { this.polygon(c, [it.corner(-1, -1), it.corner(1, -1), it.corner(1, 1), it.corner(-1, 1)]); c.stroke(); }
    }
    c.lineWidth = 2.5 * dp / k; c.strokeStyle = BLUE;
    c.setLineDash([10 * dp / k, 6 * dp / k]);
    this.polygon(c, [this.gCorner(-1, -1), this.gCorner(1, -1), this.gCorner(1, 1), this.gCorner(-1, 1)]);
    c.stroke();
    c.setLineDash([]);
    const cc = this.gCorner(1, 1);
    this.handle(c, cc[0], cc[1], 13 * dp / k, true);
  }

  lineItem() {
    const ln = new Item();
    ln.type = LINE;
    ln.arrow = this.tool === ARROW;
    ln.outline = this.outline;
    ln.color = this.color;
    ln.size = this.lineW;
    ln.x1 = this.lx1; ln.y1 = this.ly1; ln.x2 = this.lx2; ln.y2 = this.ly2;
    return ln;
  }

  // ---- 手書きをまとめる ----

  hasPending() { return this.pending.length > 0; }
  undoPendingStroke() { this.pending.pop(); this.invalidate(); }

  /** 書きかけの手書きを、1 つの「手書き」にして置く */
  commitInk() {
    if (!this.pending.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of this.pending) for (let i = 0; i + 1 < st.length; i += 2) {
      x0 = Math.min(x0, st[i]); x1 = Math.max(x1, st[i]); y0 = Math.min(y0, st[i + 1]); y1 = Math.max(y1, st[i + 1]);
    }
    const it = new Item();
    it.type = INK; it.color = this.color; it.size = this.penW; it.outline = this.outline;
    const pad = this.penW;
    it.cx = (x0 + x1) / 2; it.cy = (y0 + y1) / 2;
    it.w = Math.max(x1 - x0 + pad * 2, 20); it.h = Math.max(y1 - y0 + pad * 2, 20);
    it.strokes = this.pending.map(st => Float32Array.from(st, (v, i) => i % 2 ? v - it.cy : v - it.cx));
    this.pending = [];
    this.ls.beforeChange();
    this.page.items.push(it);
    this.ls.onChanged();
    this.invalidate();
  }

  select(it) {
    this.group = [];
    this.sel = it;
    this.ls.onSelection(it);
    this.invalidate();
  }

  // ---- まとめて選ぶ ----

  gCorner(sx, sy) {
    const a = this.ga * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), x = sx * this.ghw, y = sy * this.ghh;
    return [this.gcx + x * cos - y * sin, this.gcy + x * sin + y * cos];
  }

  inGroupFrame(x, y, tol) {
    const a = -this.ga * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), dx = x - this.gcx, dy = y - this.gcy;
    return Math.abs(dx * cos - dy * sin) <= this.ghw + tol && Math.abs(dx * sin + dy * cos) <= this.ghh + tol;
  }

  setGroup(items) {
    if (items.length === 1) { this.select(items[0]); return; }
    this.sel = null;
    this.group = items.slice();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const it of this.group) { const bb = it.bounds(); l = Math.min(l, bb[0]); t = Math.min(t, bb[1]); r = Math.max(r, bb[2]); b = Math.max(b, bb[3]); }
    const pad = 6 * this.dp / this.k;
    this.gcx = (l + r) / 2; this.gcy = (t + b) / 2; this.ghw = (r - l) / 2 + pad; this.ghh = (b - t) / 2 + pad; this.ga = 0;
    this.ls.onSelection(null);
    if (this.group.length) this.ls.onGroup(this.group);
    this.invalidate();
  }

  groupBegin() {
    this.gStart = this.group.map(it => it.copy());
    this.sg = { cx: this.gcx, cy: this.gcy, hw: this.ghw, hh: this.ghh, a: this.ga };
  }

  groupTransform(m0x, m0y, m1x, m1y, kk, da) {
    let lo = 0, hi = Infinity;
    for (const st of this.gStart) {
      if (st.type === LINE) continue;
      lo = Math.max(lo, st.clampScale(0) / st.s);
      hi = Math.min(hi, st.clampScale(Infinity) / st.s);
    }
    if (lo <= hi) kk = Math.max(lo, Math.min(hi, kk));
    const sg = this.sg;
    da = snapAngle(sg.a + da) - sg.a;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    this.group.forEach((it, i) => {
      const st = this.gStart[i];
      it.transformFrom(st, m0x, m0y, m1x, m1y, kk, da, false);
      if (it.type === LINE) it.size = Math.max(1, Math.min(300, st.size * kk));
    });
    const a = da * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), dx = sg.cx - m0x, dy = sg.cy - m0y;
    this.gcx = m1x + kk * (dx * cos - dy * sin);
    this.gcy = m1y + kk * (dx * sin + dy * cos);
    this.ghw = sg.hw * kk; this.ghh = sg.hh * kk; this.ga = sg.a + da;
  }

  bandSelect() {
    const l = Math.min(this.bx0, this.bx1), t = Math.min(this.by0, this.by1), r = Math.max(this.bx0, this.bx1), b = Math.max(this.by0, this.by1);
    const inside = this.page.items.filter(it => {
      const bb = it.bounds(), iw = Math.max(1, bb[2] - bb[0]), ih = Math.max(1, bb[3] - bb[1]);
      const ox = Math.max(0, Math.min(r, bb[2]) - Math.max(l, bb[0])), oy = Math.max(0, Math.min(b, bb[3]) - Math.max(t, bb[1]));
      return ox * oy >= 0.6 * iw * ih;
    });
    if (!inside.length) { toast('囲んだ中に何もありません'); return; }
    this.setGroup(inside);
  }

  // ---- 指 ----

  px(x) { return (x - this.offX) / this.k; }
  py(y) { return (y - this.offY) / this.k; }

  nextHit(x, y, cur) {
    const tol = 8 * this.dp / this.k, hits = [];
    for (let i = this.page.items.length - 1; i >= 0; i--) if (this.page.items[i].hit(x, y, tol)) hits.push(this.page.items[i]);
    if (!hits.length) return null;
    const i = hits.indexOf(cur);
    return hits[i < 0 ? 0 : (i + 1) % hits.length];
  }

  topHit(x, y) {
    const tol = 8 * this.dp / this.k;
    for (let i = this.page.items.length - 1; i >= 0; i--) if (this.page.items[i].hit(x, y, tol)) return this.page.items[i];
    return null;
  }

  near(x, y, hx, hy) { return Math.hypot(x - hx, y - hy) < 26 * this.dp / this.k; }

  pushOnce() { if (!this.pushed) { this.ls.beforeChange(); this.pushed = true; } }

  // pointer → Android の MotionEvent に近い形にする
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  pts() { return [...this.ptrs.values()]; }
  dist() { const [a, b] = this.pts(); return Math.hypot(b.x - a.x, b.y - a.y); }
  angle() { const [a, b] = this.pts(); return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
  mid() { const [a, b] = this.pts(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  pdown(e) {
    if (!this.page) return;
    e.preventDefault();
    try { this.cv.setPointerCapture(e.pointerId); } catch (x) { /* なくてよい */ }
    this.ptrs.set(e.pointerId, this.local(e));
    this.fit();
    const n = this.ptrs.size;
    if (n === 1) this.ev('down', this.local(e), e.timeStamp);
    else if (n === 2) this.ev('pdown', null, e.timeStamp);
  }

  pmove(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    e.preventDefault();
    // 手書きは、間の点も拾う（速く書いても線がなめらかに）
    if (this.g === G_DRAW && e.getCoalescedEvents && this.ptrs.size === 1) {
      const r = this.cv.getBoundingClientRect();
      for (const ce of e.getCoalescedEvents()) this.addPt(this.px(ce.clientX - r.left), this.py(ce.clientY - r.top));
    }
    this.ptrs.set(e.pointerId, this.local(e));
    this.ev('move', this.ptrs.size === 1 ? this.local(e) : this.pts()[0], e.timeStamp);
  }

  pup(e, cancel) {
    if (!this.ptrs.has(e.pointerId)) return;
    e.preventDefault();
    const pos = this.local(e);
    this.ptrs.delete(e.pointerId);
    if (cancel) { this.ev('cancel', pos, e.timeStamp); this.ptrs.clear(); return; }
    if (this.ptrs.size === 0) this.ev('up', pos, e.timeStamp);
    else if (this.ptrs.size === 1) this.ev('pup', this.pts()[0], e.timeStamp);
  }

  ev(type, pos, t) {
    if (this.viewMode) return this.viewTouch(type, pos, t);
    switch (this.tool) {
      case PEN: return this.penTouch(type, pos);
      case LINE_T: case ARROW: return this.lineTouch(type, pos);
      case TEXT_T: return this.textTouch(type, pos);
      default: return this.selectTouch(type, pos, t);
    }
  }

  zoomStart() {
    this.fit();
    this.g = G_ZOOM;
    this.z0 = this.zoom; this.off0X = this.offX; this.off0Y = this.offY;
    const m = this.mid();
    this.zm0x = m.x; this.zm0y = m.y;
    this.zd0 = Math.max(1, this.dist());
  }

  zoomMove() {
    if (this.ptrs.size < 2) return;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.z0 * this.dist() / this.zd0));
    const m = this.mid();
    const nx = m.x - (this.zm0x - this.off0X) * (z / this.z0), ny = m.y - (this.zm0y - this.off0Y) * (z / this.z0);
    this.zoom = z;
    const kk = this.k0 * z;
    this.panX = nx - (this.W - this.page.pw * kk) / 2;
    this.panY = ny - (this.H - this.page.ph * kk) / 2;
    this.invalidate();
  }

  viewTouch(type, pos, t) {
    if (type === 'down') {
      this.g = G_PAN; this.lastX = this.downX = pos.x; this.lastY = this.downY = pos.y; this.moved = false;
    } else if (type === 'pdown') {
      if (this.ptrs.size === 2) this.zoomStart();
      this.moved = true;
    } else if (type === 'move') {
      if (this.g === G_ZOOM) this.zoomMove();
      else if (this.g === G_PAN) {
        this.panX += pos.x - this.lastX; this.panY += pos.y - this.lastY;
        this.lastX = pos.x; this.lastY = pos.y;
        if (Math.hypot(pos.x - this.downX, pos.y - this.downY) > 8 * this.dp) this.moved = true;
        this.invalidate();
      }
    } else if (type === 'pup') {
      this.g = G_PAN; this.lastX = pos.x; this.lastY = pos.y;
    } else if (type === 'up') {
      this.g = G_NONE;
      if (!this.moved) {
        // 2 回タップで、全体が入る大きさ ⇔ 2 倍
        if (t - this.lastTapUp < 320 && Math.hypot(pos.x - this.lastTapX, pos.y - this.lastTapY) < 40 * this.dp) {
          if (this.zoom > 1.05 || this.zoom < 0.95) this.resetZoom();
          else {
            this.fit();
            const px = this.px(pos.x), py = this.py(pos.y), kk = this.k0 * 2;
            this.zoom = 2;
            this.panX = pos.x - px * kk - (this.W - this.page.pw * kk) / 2;
            this.panY = pos.y - py * kk - (this.H - this.page.ph * kk) / 2;
            this.invalidate();
          }
          this.lastTapUp = 0;
        } else { this.lastTapUp = t; this.lastTapX = pos.x; this.lastTapY = pos.y; }
      }
    } else if (type === 'cancel') this.g = G_NONE;
  }

  selectTouch(type, pos, t) {
    const dp = this.dp, items = this.page.items;
    const x = pos ? this.px(pos.x) : 0, y = pos ? this.py(pos.y) : 0;
    if (type === 'down') {
      this.downX = this.lastX = x; this.downY = this.lastY = y;
      this.moved = false; this.pushed = false; this.g = G_NONE;
      if (this.group.length) {
        // まとめて選んでいるとき: 角の丸 → 大きさと向き、枠の中 → まとめて動かす、ほかの物 → それだけ選ぶ、何もない所 → 囲み直す
        const cc = this.gCorner(1, 1), tol = 8 * dp / this.k;
        if (this.near(x, y, cc[0], cc[1])) this.g = G_GHANDLE;
        else if (this.inGroupFrame(x, y, tol) || this.group.some(it => it.hit(x, y, tol))) this.g = G_GMOVE;
        if (this.g !== G_NONE) { this.groupBegin(); return; }
        const h = this.topHit(x, y);
        this.select(h);
        if (h) { this.g = G_MOVE; this.wasSelected = false; this.tapNext = false; this.start = h.copy(); }
        else { this.g = G_BAND; this.bx0 = this.bx1 = x; this.by0 = this.by1 = y; }
        return;
      }
      const sel = this.sel && items.includes(this.sel) ? this.sel : null;
      if (sel) {
        if (sel.type === LINE) {
          if (this.near(x, y, sel.x2, sel.y2)) this.g = G_P2;
          else if (this.near(x, y, sel.x1, sel.y1)) this.g = G_P1;
        } else {
          const cc = sel.corner(1, 1);
          if (this.near(x, y, cc[0], cc[1])) this.g = G_HANDLE;
        }
      }
      this.tapNext = Date.now() - this.selTapUp < 350 && Math.hypot(x - this.selTapX, y - this.selTapY) < 30 * dp / this.k;
      if (this.tapNext && this.textTapLater) { clearTimeout(this.textTapLater); this.textTapLater = 0; }
      if (this.g === G_NONE) {
        const tol = 8 * dp / this.k;
        if (sel && sel.hit(x, y, tol)) {
          // いま選んでいるものの上を押したら、奥にあるものでも、そのまま選んだまま動かせる
          this.wasSelected = !this.tapNext;
          this.g = G_MOVE;
        } else {
          const h = this.topHit(x, y);
          this.wasSelected = false;
          if (h !== this.sel) this.select(h);
          if (h) this.g = G_MOVE;
          else if (!this.tapNext) { this.g = G_BAND; this.bx0 = this.bx1 = x; this.by0 = this.by1 = y; }
        }
      }
      if (this.sel) this.start = this.sel.copy();
    } else if (type === 'pdown') {
      if (this.ptrs.size !== 2) return;
      const [a, b] = this.pts();
      const m0x = (this.px(a.x) + this.px(b.x)) / 2, m0y = (this.py(a.y) + this.py(b.y)) / 2;
      if (this.group.length) {
        this.g = G_GPINCH; this.groupBegin();
      } else if (!this.sel) { this.zoomStart(); return; } // 何も選んでいないときの 2 本指は、ページの拡大・縮小
      else { this.g = G_PINCH; this.start = this.sel.copy(); }
      this.m0x = m0x; this.m0y = m0y; this.d0 = this.dist(); this.a0 = this.angle();
    } else if (type === 'move') {
      if (this.g === G_ZOOM) { this.zoomMove(); return; }
      if (this.g === G_BAND) {
        this.bx1 = x; this.by1 = y;
        if (Math.hypot(x - this.downX, y - this.downY) > 6 * dp / this.k) this.moved = true;
        this.invalidate();
        return;
      }
      const two = this.ptrs.size >= 2;
      let m1x = 0, m1y = 0;
      if (two) { const [a, b] = this.pts(); m1x = (this.px(a.x) + this.px(b.x)) / 2; m1y = (this.py(a.y) + this.py(b.y)) / 2; }
      if (this.g === G_GMOVE || this.g === G_GHANDLE || this.g === G_GPINCH) {
        if (!this.moved && Math.hypot(x - this.downX, y - this.downY) < 6 * dp / this.k && this.g !== G_GPINCH) return;
        this.pushOnce(); this.moved = true;
        if (this.g === G_GPINCH && two) {
          this.groupTransform(this.m0x, this.m0y, m1x, m1y, this.d0 > 0 ? this.dist() / this.d0 : 1, this.angle() - this.a0);
        } else if (this.g === G_GMOVE) {
          for (const it of this.group) it.move(x - this.lastX, y - this.lastY);
          this.gcx += x - this.lastX; this.gcy += y - this.lastY;
        } else if (this.g === G_GHANDLE) {
          const sg = this.sg, a = sg.a * Math.PI / 180;
          const vx0 = sg.hw * Math.cos(a) - sg.hh * Math.sin(a), vy0 = sg.hw * Math.sin(a) + sg.hh * Math.cos(a);
          const vx = x - sg.cx, vy = y - sg.cy;
          const kk = Math.hypot(vx, vy) / Math.max(1, Math.hypot(vx0, vy0));
          const da = (Math.atan2(vy, vx) - Math.atan2(vy0, vx0)) * 180 / Math.PI;
          this.groupTransform(sg.cx, sg.cy, sg.cx, sg.cy, kk, da);
        }
        this.lastX = x; this.lastY = y;
        this.invalidate();
        return;
      }
      const sel = this.sel;
      if (!sel) return;
      if (!this.moved && Math.hypot(x - this.downX, y - this.downY) < 6 * dp / this.k && this.g !== G_PINCH) return;
      if (this.g === G_PINCH && two) {
        this.pushOnce(); this.moved = true;
        sel.transformFrom(this.start, this.m0x, this.m0y, m1x, m1y, this.d0 > 0 ? this.dist() / this.d0 : 1, this.angle() - this.a0);
      } else if (this.g === G_MOVE) {
        this.pushOnce(); this.moved = true;
        sel.move(x - this.lastX, y - this.lastY);
      } else if (this.g === G_HANDLE) {
        this.pushOnce(); this.moved = true;
        const st = this.start, c0 = st.corner(1, 1);
        const vx0 = c0[0] - st.cx, vy0 = c0[1] - st.cy, vx = x - st.cx, vy = y - st.cy;
        const kk = Math.hypot(vx, vy) / Math.max(1, Math.hypot(vx0, vy0));
        const da = (Math.atan2(vy, vx) - Math.atan2(vy0, vx0)) * 180 / Math.PI;
        sel.transformFrom(st, st.cx, st.cy, st.cx, st.cy, kk, da);
      } else if (this.g === G_P1 || this.g === G_P2) {
        this.pushOnce(); this.moved = true;
        if (this.g === G_P1) { sel.x1 = x; sel.y1 = y; } else { sel.x2 = x; sel.y2 = y; }
      }
      this.lastX = x; this.lastY = y;
      this.invalidate();
    } else if (type === 'pup') {
      // 指を 1 本離したら、もう片方の指では動かさない
      if (this.g === G_PINCH || this.g === G_ZOOM || this.g === G_GPINCH) this.g = G_NONE;
    } else if (type === 'up') {
      if (this.g === G_BAND) {
        this.g = G_NONE;
        if (this.moved) this.bandSelect();
        this.selTapUp = 0;
        this.invalidate();
        return;
      }
      if (this.moved) { this.ls.onChanged(); this.selTapUp = 0; }
      else if (this.group.length) this.selTapUp = 0;
      else {
        if (this.tapNext) {
          // すばやく 2 回目: 重なっている中で 1 つ奥のものを選ぶ
          const h = this.nextHit(x, y, this.sel);
          if (h && h !== this.sel) this.select(h);
        } else if (this.g === G_MOVE && this.wasSelected && this.sel && this.sel.type === TEXT) {
          // 選んである文字を、もう一度タップしたら直す（すぐ 2 回目が来たら、奥を選ぶほうにする）
          const tt = this.sel;
          this.textTapLater = setTimeout(() => {
            this.textTapLater = 0;
            if (this.sel === tt && this.page.items.includes(tt)) this.ls.onTextTap(tt, tt.cx, tt.cy);
          }, 360);
        }
        this.selTapUp = Date.now(); this.selTapX = x; this.selTapY = y;
      }
      this.g = G_NONE;
      this.invalidate();
    } else if (type === 'cancel') {
      if (this.moved && this.g !== G_BAND) this.ls.onChanged();
      this.g = G_NONE;
      this.invalidate();
    }
  }

  penTouch(type, pos) {
    if (type === 'down') {
      if (this.sel || this.group.length) this.select(null);
      this.g = G_DRAW;
      this.cur = [];
      this.addPt(this.px(pos.x), this.py(pos.y));
    } else if (type === 'move' && this.g === G_DRAW) {
      this.addPt(this.px(pos.x), this.py(pos.y));
    } else if (type === 'up' && this.g === G_DRAW) {
      this.pending.push(this.cur.slice());
      this.cur = [];
      this.g = G_NONE;
      this.ls.onPending && this.ls.onPending();
    } else if (type === 'pdown' || type === 'cancel') {
      this.g = G_NONE; // 2 本目の指が触れたら、その線はやめる
      this.cur = [];
    }
    this.invalidate();
  }

  addPt(x, y) {
    const c = this.cur, n = c.length;
    if (n >= 2 && Math.hypot(x - c[n - 2], y - c[n - 1]) < 1.2) return;
    c.push(x, y);
  }

  lineTouch(type, pos) {
    if (type === 'down') {
      if (this.sel || this.group.length) this.select(null);
      this.g = G_LINE;
      this.lx1 = this.lx2 = this.px(pos.x); this.ly1 = this.ly2 = this.py(pos.y);
    } else if (type === 'move' && this.g === G_LINE) {
      this.lx2 = this.px(pos.x); this.ly2 = this.py(pos.y);
    } else if (type === 'up' && this.g === G_LINE) {
      this.lx2 = this.px(pos.x); this.ly2 = this.py(pos.y);
      this.g = G_NONE;
      if (Math.hypot(this.lx2 - this.lx1, this.ly2 - this.ly1) > 12 * this.dp / this.k) {
        this.ls.beforeChange();
        this.page.items.push(this.lineItem());
        this.ls.onChanged();
      }
    } else if (type === 'cancel' || type === 'pdown') this.g = G_NONE;
    this.invalidate();
  }

  textTouch(type, pos) {
    if (type === 'down') { this.downX = this.px(pos.x); this.downY = this.py(pos.y); }
    else if (type === 'up') {
      const x = this.px(pos.x), y = this.py(pos.y);
      if (Math.hypot(x - this.downX, y - this.downY) < 12 * this.dp / this.k) {
        const h = this.topHit(x, y);
        if (h && h.type === TEXT) this.ls.onTextTap(h, h.cx, h.cy);
        else this.ls.onTextTap(null, Math.max(0, Math.min(this.page.pw, x)), Math.max(0, Math.min(this.page.ph, y)));
      }
    }
  }
}
