// zip を作る・読む（バックアップのファイル用）。
// 作るときは縮めない（写真の JPEG はもう縮んでいるので）。読むときは、縮めてあるもの（Android 版の zip）も読める。

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  constructor() { this.parts = []; this.size = 0; this.dir = []; this.when = dosTime(new Date()); }

  /** data: Uint8Array・Blob・文字 */
  async add(name, data) {
    let b;
    if (typeof data === 'string') b = new TextEncoder().encode(data);
    else if (data instanceof Blob) b = new Uint8Array(await data.arrayBuffer());
    else b = data;
    const nm = new TextEncoder().encode(name), crc = crc32(b);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, this.when.time, true); h.setUint16(12, this.when.date, true);
    h.setUint32(14, crc, true); h.setUint32(18, b.length, true); h.setUint32(22, b.length, true);
    h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    this.dir.push({ nm, crc, len: b.length, off: this.size });
    this.parts.push(h.buffer, nm, b);
    this.size += 30 + nm.length + b.length;
  }

  finish() {
    const start = this.size;
    let dirSize = 0;
    for (const e of this.dir) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true); h.setUint16(12, this.when.time, true); h.setUint16(14, this.when.date, true);
      h.setUint32(16, e.crc, true); h.setUint32(20, e.len, true); h.setUint32(24, e.len, true);
      h.setUint16(28, e.nm.length, true); h.setUint32(42, e.off, true);
      this.parts.push(h.buffer, e.nm);
      dirSize += 46 + e.nm.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.dir.length, true); end.setUint16(10, this.dir.length, true);
    end.setUint32(12, dirSize, true); end.setUint32(16, start, true);
    this.parts.push(end.buffer);
    return new Blob(this.parts, { type: 'application/zip' });
  }
}

/** zip の中のファイルの一覧（名前・位置）。読むのは read(entry) で */
export async function openZip(blob) {
  const tail = Math.min(blob.size, 65557);
  const tb = new DataView(await blob.slice(blob.size - tail).arrayBuffer());
  let eocd = -1;
  for (let i = tail - 22; i >= 0; i--) if (tb.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip のファイルではないようです');
  const count = tb.getUint16(eocd + 10, true), dirSize = tb.getUint32(eocd + 12, true), dirOff = tb.getUint32(eocd + 16, true);
  const d = new DataView(await blob.slice(dirOff, dirOff + dirSize).arrayBuffer());
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (d.getUint32(p, true) !== 0x02014b50) throw new Error('zip の中が読めません');
    const flags = d.getUint16(p + 8, true), method = d.getUint16(p + 10, true);
    const csize = d.getUint32(p + 20, true), size = d.getUint32(p + 24, true);
    const nl = d.getUint16(p + 28, true), xl = d.getUint16(p + 30, true), cl = d.getUint16(p + 32, true);
    const off = d.getUint32(p + 42, true);
    const raw = new Uint8Array(d.buffer, d.byteOffset + p + 46, nl);
    const name = (flags & 0x0800) ? new TextDecoder().decode(raw) : new TextDecoder().decode(raw); // 日本語の名前は UTF-8 として読む
    entries.push({ name, method, csize, size, off });
    p += 46 + nl + xl + cl;
  }
  return {
    entries,
    async read(e) {
      const h = new DataView(await blob.slice(e.off, e.off + 30).arrayBuffer());
      const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const data = blob.slice(start, start + e.csize);
      if (e.method === 0) return new Uint8Array(await data.arrayBuffer());
      if (e.method !== 8) throw new Error('この zip の縮め方には対応していません');
      if (typeof DecompressionStream === 'undefined') throw new Error('この iOS では、縮めた zip を読めません（iOS 16.4 以降が必要です）');
      const st = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(st).arrayBuffer());
    },
    async text(e) { return new TextDecoder().decode(await this.read(e)); },
  };
}
