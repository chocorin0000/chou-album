// ページに置くもの（写真・文字・手書き・線・矢印）と、ページ・アルバム。
// データの形（JSON）は Android 版「超！アルバム」と同じ（バックアップの zip やクラウドで行き来できる）。
// 座標はページの単位（縦長のページは 幅 1000・高さ 1414）。
// 写真・文字・手書きは「真ん中 (cx, cy)・元の大きさ w×h・倍率 s・回転 r（度）」、線・矢印は両端で置く。

export const PHOTO = 0, TEXT = 1, INK = 2, LINE = 3;

// Android の色（符号つき 32 ビットの整数 0xAARRGGBB）⇔ CSS
export function css(c) {
  const u = c >>> 0;
  const a = (u >>> 24) & 255, r = (u >>> 16) & 255, g = (u >>> 8) & 255, b = u & 255;
  return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}
export const argb = hex => (0xFF000000 | parseInt(hex.replace('#', ''), 16)) | 0;
const lum = c => { const u = c >>> 0; return ((u >>> 16) & 255) * 0.3 + ((u >>> 8) & 255) * 0.59 + (u & 255) * 0.11; };
export const isDark = c => lum(c) < 150;
const isVeryLight = c => lum(c) > 200;
/** 縁取りの色: ふつうは白。白・黄色などのとても明るい色には黒っぽい縁 */
export const outlineColor = c => (isDark(c) || !isVeryLight(c)) ? 0xFFFFFFFF | 0 : 0xFF222222 | 0;

const FONT = '-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
export const LINE_H = 1.17; // 文字の行の高さ（文字の大きさに対して。Android の行の高さに近い値）

let measureCtx = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

export class Item {
  constructor() {
    this.type = PHOTO;
    this.cx = 0; this.cy = 0; this.w = 100; this.h = 100; this.s = 1; this.r = 0;
    this.file = null; this.frame = true;
    this.cl = 0; this.ct = 0; this.cr = 1; this.cb = 1;
    this.text = ''; this.fill = false; this.outline = false;
    this.color = 0xFF222222 | 0; this.size = 56;
    this.strokes = [];
    this.x1 = 0; this.y1 = 0; this.x2 = 0; this.y2 = 0; this.arrow = false;
    this._lines = null;
  }

  toJson() {
    const o = { t: this.type, c: this.color, z: this.size };
    if (this.outline) o.ol = true;
    if (this.type === LINE) {
      Object.assign(o, { x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2, a: this.arrow });
      return o;
    }
    Object.assign(o, { cx: this.cx, cy: this.cy, w: this.w, h: this.h, s: this.s, r: this.r });
    if (this.type === PHOTO) {
      o.f = this.file; o.fr = this.frame;
      if (this.cropped()) Object.assign(o, { cl: this.cl, ct: this.ct, cr: this.cr, cb: this.cb });
    } else if (this.type === TEXT) {
      o.x = this.text; o.fi = this.fill;
    } else if (this.type === INK) {
      o.k = this.strokes.map(st => Array.from(st, v => Math.round(v * 10) / 10));
    }
    return o;
  }

  static fromJson(o) {
    const it = new Item();
    const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
    it.type = num(o.t, 0);
    it.color = num(o.c, 0xFF222222 | 0) | 0;
    it.size = num(o.z, 56);
    it.outline = !!o.ol;
    if (it.type === LINE) {
      it.x1 = num(o.x1, 0); it.y1 = num(o.y1, 0); it.x2 = num(o.x2, 0); it.y2 = num(o.y2, 0);
      it.arrow = !!o.a;
      return it;
    }
    it.cx = num(o.cx, 0); it.cy = num(o.cy, 0); it.w = num(o.w, 100); it.h = num(o.h, 100);
    it.s = num(o.s, 1); it.r = num(o.r, 0);
    it.file = typeof o.f === 'string' ? o.f : null;
    it.frame = o.fr !== false;
    it.cl = num(o.cl, 0); it.ct = num(o.ct, 0); it.cr = num(o.cr, 1); it.cb = num(o.cb, 1);
    it.text = typeof o.x === 'string' ? o.x : '';
    it.fill = !!o.fi;
    if (Array.isArray(o.k)) it.strokes = o.k.filter(Array.isArray).map(a => Float32Array.from(a, v => +v || 0));
    return it;
  }

  copy() { return Item.fromJson(JSON.parse(JSON.stringify(this.toJson()))); }

  cropped() { return this.cl > 0.0005 || this.ct > 0.0005 || this.cr < 0.9995 || this.cb < 0.9995; }

  /** 動かす前の形 start から、m0 を中心に k 倍・da 度回して m1 へ */
  transformFrom(start, m0x, m0y, m1x, m1y, k, da, snap = true) {
    const a = da * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    if (this.type === LINE) {
      let dx = start.x1 - m0x, dy = start.y1 - m0y;
      this.x1 = m1x + k * (dx * cos - dy * sin); this.y1 = m1y + k * (dx * sin + dy * cos);
      dx = start.x2 - m0x; dy = start.y2 - m0y;
      this.x2 = m1x + k * (dx * cos - dy * sin); this.y2 = m1y + k * (dx * sin + dy * cos);
      return;
    }
    const dx = start.cx - m0x, dy = start.cy - m0y;
    this.cx = m1x + k * (dx * cos - dy * sin);
    this.cy = m1y + k * (dx * sin + dy * cos);
    this.s = this.clampScale(start.s * k);
    this.r = snap ? snapAngle(start.r + da) : (((start.r + da) % 360) + 360) % 360;
  }

  /** 切り抜く範囲を変える。残った所は、ページの上で同じ場所・同じ大きさのまま */
  applyCrop(ncl, nct, ncr, ncb) {
    const fullW = this.w / (this.cr - this.cl), fullH = this.h / (this.cb - this.ct);
    const dx = ((ncl + ncr) - (this.cl + this.cr)) / 2 * fullW, dy = ((nct + ncb) - (this.ct + this.cb)) / 2 * fullH;
    const c = this.toPage(dx, dy);
    this.cx = c[0]; this.cy = c[1];
    this.w = fullW * (ncr - ncl); this.h = fullH * (ncb - nct);
    this.cl = ncl; this.ct = nct; this.cr = ncr; this.cb = ncb;
  }

  move(dx, dy) {
    if (this.type === LINE) { this.x1 += dx; this.y1 += dy; this.x2 += dx; this.y2 += dy; }
    else { this.cx += dx; this.cy += dy; }
  }

  clampScale(v) {
    const big = Math.max(this.w, this.h);
    return Math.max(24 / big, Math.min(6000 / big, v));
  }

  // ---- 文字の並び ----

  textChanged() { this._lines = null; if (this.type === TEXT) this.prepareText(); }

  font() { return `bold ${this.size}px ${FONT}`; }

  prepareText() {
    const c = mctx();
    c.font = this.font();
    const t = this.text === '' ? ' ' : this.text;
    const lines = t.split('\n');
    let mw = 1;
    for (const l of lines) mw = Math.max(mw, c.measureText(l).width);
    const lw = Math.ceil(mw) + 2;
    this._lines = lines;
    this._lw = lw;
    this.w = lw + this.size * 0.5;
    this.h = lines.length * this.size * LINE_H + this.size * 0.3;
  }

  // ---- 描く ----

  /** img(file) は描ける絵（ImageBitmap など）か null */
  draw(c, img) {
    if (this.type === LINE) { this.drawLine(c); return; }
    c.save();
    c.translate(this.cx, this.cy);
    c.rotate(this.r * Math.PI / 180);
    c.scale(this.s, this.s);
    const w = this.w, h = this.h;
    if (this.type === PHOTO) {
      if (this.frame) {
        const f = Math.max(w, h) * 0.035;
        c.fillStyle = 'rgba(0,0,0,0.19)';
        c.fillRect(-w / 2 - f + f * 0.4, -h / 2 - f + f * 0.6, w + 2 * f, h + 2 * f);
        c.fillStyle = '#fff';
        c.fillRect(-w / 2 - f, -h / 2 - f, w + 2 * f, h + 2 * f);
      }
      const b = img && this.file ? img(this.file) : null;
      if (b) {
        const bw = b.width, bh = b.height;
        const sx = Math.round(this.cl * bw), sy = Math.round(this.ct * bh);
        const sw = Math.max(1, Math.round(this.cr * bw) - sx), sh = Math.max(1, Math.round(this.cb * bh) - sy);
        c.imageSmoothingQuality = 'high';
        c.drawImage(b, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
      } else {
        c.fillStyle = '#BBBBBB';
        c.fillRect(-w / 2, -h / 2, w, h);
      }
    } else if (this.type === TEXT) {
      if (!this._lines) this.prepareText();
      if (this.fill) {
        c.fillStyle = isDark(this.color) ? 'rgba(255,255,255,0.867)' : 'rgba(34,34,34,0.8)';
        roundRect(c, -w / 2, -h / 2, w, h, this.size * 0.25);
        c.fill();
      }
      c.font = this.font();
      c.textBaseline = 'alphabetic';
      const lh = this.size * LINE_H, top = -(this._lines.length * lh) / 2;
      const x0 = -this._lw / 2 + 1;
      const base = i => top + i * lh + this.size * 0.93;
      if (this.outline) {
        c.lineJoin = 'round';
        c.lineWidth = this.size * 0.2;
        c.strokeStyle = css(outlineColor(this.color));
        this._lines.forEach((l, i) => c.strokeText(l, x0, base(i)));
      }
      c.fillStyle = css(this.color);
      this._lines.forEach((l, i) => c.fillText(l, x0, base(i)));
    } else if (this.type === INK) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      if (this.outline) {
        setOutline(c, this.color, this.size);
        for (const st of this.strokes) strokePath(c, st);
      }
      c.lineWidth = this.size;
      c.strokeStyle = css(this.color);
      for (const st of this.strokes) strokePath(c, st);
    }
    c.restore();
  }

  drawLine(c) {
    const { x1, y1, x2, y2, size } = this;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const line = (ax, ay, bx, by) => { c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); };
    if (!this.arrow || len < 1) {
      if (this.outline) { setOutline(c, this.color, size); line(x1, y1, x2, y2); }
      c.lineWidth = size; c.strokeStyle = css(this.color);
      line(x1, y1, x2, y2);
      c.restore();
      return;
    }
    const head = Math.min(Math.max(size * 3.2, 26), len * 0.6);
    const ux = dx / len, uy = dy / len;
    const bx = x2 - ux * head, by = y2 - uy * head, half = head * 0.55;
    const tri = () => {
      c.beginPath(); c.moveTo(x2, y2);
      c.lineTo(bx - uy * half, by + ux * half); c.lineTo(bx + uy * half, by - ux * half); c.closePath();
    };
    const ex = x2 - ux * head * 0.7, ey = y2 - uy * head * 0.7;
    if (this.outline) {
      setOutline(c, this.color, size); line(x1, y1, ex, ey);
      setOutline(c, this.color, size * 0.4); c.fillStyle = c.strokeStyle; tri(); c.fill(); c.stroke();
    }
    c.lineWidth = size; c.strokeStyle = css(this.color); line(x1, y1, ex, ey);
    c.fillStyle = css(this.color); c.lineWidth = size * 0.4; tri(); c.fill(); c.stroke();
    c.restore();
  }

  // ---- 指が当たったか ----

  toLocal(px, py) {
    const dx = px - this.cx, dy = py - this.cy, a = -this.r * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    return [(dx * cos - dy * sin) / this.s, (dx * sin + dy * cos) / this.s];
  }

  toPage(lx, ly) {
    const a = this.r * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), x = lx * this.s, y = ly * this.s;
    return [this.cx + x * cos - y * sin, this.cy + x * sin + y * cos];
  }

  frameW() { return (this.type === PHOTO && this.frame) ? Math.max(this.w, this.h) * 0.035 : 0; }

  corner(sx, sy) { const f = this.frameW(); return this.toPage(sx * (this.w / 2 + f), sy * (this.h / 2 + f)); }

  hit(px, py, tol) {
    if (this.type === LINE) return this.distSeg(px, py) <= this.size / 2 + tol;
    const l = this.toLocal(px, py), f = this.frameW();
    return Math.abs(l[0]) <= this.w / 2 + f + tol / this.s && Math.abs(l[1]) <= this.h / 2 + f + tol / this.s;
  }

  distSeg(px, py) {
    const dx = this.x2 - this.x1, dy = this.y2 - this.y1, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - this.x1) * dx + (py - this.y1) * dy) / l2));
    return Math.hypot(px - (this.x1 + t * dx), py - (this.y1 + t * dy));
  }

  /** ページの上で、この物がかかっている範囲 [左, 上, 右, 下] */
  bounds() {
    if (this.type === LINE) {
      const p = this.size / 2;
      return [Math.min(this.x1, this.x2) - p, Math.min(this.y1, this.y2) - p, Math.max(this.x1, this.x2) + p, Math.max(this.y1, this.y2) + p];
    }
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const c = this.corner(sx, sy);
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    }
    return b;
  }
}

/** 0°・90°・180°・270° の近く（4° 以内）なら、ぴったりにする */
export function snapAngle(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  for (let q = 0; q <= 360; q += 90) if (Math.abs(d - q) < 4) return q === 360 ? 0 : q;
  return d;
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}

export function setOutline(c, col, w) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.lineWidth = w + Math.max(7, w * 0.9);
  c.strokeStyle = css(outlineColor(col));
}

/** 点と点のあいだを、なめらかにつなぐ（Android の Item.path と同じ） */
export function strokePath(c, st) {
  if (st.length < 2) return;
  c.beginPath();
  c.moveTo(st[0], st[1]);
  if (st.length === 2) { c.lineTo(st[0] + 0.1, st[1]); c.stroke(); return; }
  for (let i = 2; i + 3 < st.length; i += 2) {
    c.quadraticCurveTo(st[i], st[i + 1], (st[i] + st[i + 2]) / 2, (st[i + 1] + st[i + 3]) / 2);
  }
  c.lineTo(st[st.length - 2], st[st.length - 1]);
  c.stroke();
}

// ---- ページ ----

export class Page {
  constructor() { this.id = ''; this.pw = 1000; this.ph = 1414; this.bg = 0xFFFFFFFF | 0; this.created = 0; this.updated = 0; this.items = []; }

  itemsJson() { return JSON.stringify(this.items.map(it => it.toJson())); }
  setItemsJson(s) { this.items = JSON.parse(s).map(o => Item.fromJson(o)); }

  toJson() {
    return JSON.stringify({ v: 1, pw: this.pw, ph: this.ph, bg: this.bg, created: this.created, updated: this.updated, items: this.items.map(it => it.toJson()) });
  }

  static fromJson(id, s) {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    const p = new Page();
    p.id = String(id);
    p.pw = +o.pw || 1000; p.ph = +o.ph || 1414;
    p.bg = (typeof o.bg === 'number' ? o.bg : 0xFFFFFFFF) | 0;
    p.created = +o.created || 0; p.updated = +o.updated || 0;
    p.items = (Array.isArray(o.items) ? o.items : []).map(x => Item.fromJson(x));
    return p;
  }

  /** ページ全体を描く（c はページの座標にしてから呼ぶ） */
  drawAll(c, img) {
    c.fillStyle = css(this.bg);
    c.fillRect(0, 0, this.pw, this.ph);
    for (const it of this.items) it.draw(c, img);
  }
}

// ---- アルバム ----

export class Album {
  constructor() { this.id = ''; this.title = ''; this.created = 0; this.bg = 0xFFFFFFFF | 0; this.pages = []; }
  toJson() { return JSON.stringify({ v: 1, title: this.title, created: this.created, bg: this.bg, pages: this.pages }); }
  static fromJson(id, s) {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    const a = new Album();
    a.id = String(id);
    a.title = typeof o.title === 'string' ? o.title : '';
    a.created = +o.created || 0;
    a.bg = (typeof o.bg === 'number' ? o.bg : 0xFFFFFFFF) | 0;
    a.pages = (Array.isArray(o.pages) ? o.pages : []).map(String);
    return a;
  }
}

/** Java の String.hashCode と同じ（アルバムの印を Android とそろえる） */
export function javaHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export const COLORS = ['#222222', '#FFFFFF', '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#EC407A'].map(argb);
export const WIDTH_NAMES = ['細', '中', '太'];
export const PEN_W = [4, 7, 12], LINE_W = [5, 9, 15];
export const PAPER = ['#FFFFFF', '#FFF8E7', '#E8D5B5', '#FFF3B0', '#FBE3EA', '#DDEEF8', '#E3F1DF', '#EAE3F5', '#D9D9D9', '#1F2A44', '#1E3A2F', '#2B2B2B'].map(argb);
export const PAPER_NAMES = ['白', 'クリーム', 'クラフト紙', '黄色', '桃色', '水色', 'うす緑', 'うす紫', '灰色', '紺', '深緑', '黒'];
