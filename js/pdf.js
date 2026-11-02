// アルバムのページを 1 つの PDF にする（1 ページに、そのページの絵を JPEG のまま 1 枚）。Android 版の Pdf.java と同じ形
import { renderPage } from './render.js';
import { toBlob } from './store.js';

const LONG_SIDE = 2000, QUALITY = 0.85;
const enc = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };

function utf16(s) {
  let h = '<FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return h + '>';
}

/** pages は並び順のページ。progress(i, n) は 1 ページごとに呼ぶ */
export async function albumPdf(title, pages, progress) {
  const parts = [];
  let size = 0;
  const offsets = [0, 0]; // 1: Catalog、2: Pages（最後に書く）
  const kids = [];
  const raw = s => { const b = typeof s === 'string' ? enc(s) : s; parts.push(b); size += b.length; };
  const newObj = () => { offsets.push(0); return offsets.length; };
  const begin = n => { offsets[n - 1] = size; raw(n + ' 0 obj\n'); };
  raw('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  let i = 0;
  for (const p of pages) {
    if (progress) progress(i, pages.length);
    i++;
    const width = p.pw >= p.ph ? LONG_SIDE : Math.round(LONG_SIDE * p.pw / p.ph);
    const cv = await renderPage(p, width);
    const jpg = new Uint8Array(await (await toBlob(cv, 'image/jpeg', QUALITY)).arrayBuffer());
    const bw = cv.width, bh = cv.height;
    cv.width = cv.height = 0;
    const pw = p.pw >= p.ph ? 841.89 : 595.28, ph = pw * p.ph / p.pw;
    const img = newObj(), content = newObj(), page = newObj();
    begin(img);
    raw(`<< /Type /XObject /Subtype /Image /Width ${bw} /Height ${bh} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    raw(jpg);
    raw('\nendstream\nendobj\n');
    const cs = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
    begin(content);
    raw(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n`);
    begin(page);
    raw(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>\nendobj\n`);
    kids.push(page);
  }
  begin(1);
  raw('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  raw(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>\nendobj\n`);
  const info = newObj();
  begin(info);
  raw(`<< /Title ${utf16(title)} /Producer ${utf16('超！アルバム')} >>\nendobj\n`);
  const xref = size;
  let x = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) x += String(o).padStart(10, '0') + ' 00000 n \n';
  x += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  raw(x);
  return new Blob(parts, { type: 'application/pdf' });
}
